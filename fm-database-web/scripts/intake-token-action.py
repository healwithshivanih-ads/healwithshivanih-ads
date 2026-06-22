#!/usr/bin/env python3
"""Client-facing intake form: token lifecycle + draft save + submission.

Reads JSON from stdin:
{
  "action": "generate" | "lookup" | "save_draft" | "submit"
            | "promote_draft" | "revoke",
  ...action-specific fields
}

Actions:

  generate {client_id, ttl_days?}
    → Generate a fresh URL-safe token, write to client.intake_token.
      Replaces any existing un-submitted token. Returns:
      {ok, token, expires_at, url_path}

  lookup {token}
    → Resolve token → client.yaml snapshot for prefilling the form.
      Refuses if token expired or already submitted.
      Returns: {ok, client_id, display_name, intake_form_draft, prefill: {...}}

  save_draft {token, draft}
    → Persist `draft` dict into client.intake_form_draft (overwrite).
      For save-per-section autosave.
      Returns: {ok, saved_at}

  submit {token, payload}
    → Final submit. Merges `payload` fields into client.yaml (additive on
      list fields, overwrite on scalars when payload has a non-empty value),
      writes the raw payload to a tagged quick_note session, sets
      intake_submitted_at, clears intake_token to revoke the link.
      Returns: {ok, client_id, fields_updated, session_id}

  promote_draft {client_id}
    → Coach rescues a stranded intake_form_draft (client filled the form
      but never tapped Submit). Runs the same merge as `submit`, resolved
      by client_id so an expired token can't block recovery.
      Returns: {ok, client_id, fields_updated, session_id, promoted_from_draft}

  revoke {client_id}
    → Coach manually invalidates the token. Returns: {ok}

Writes JSON to stdout:
  {ok: bool, ...action-specific fields, error?: str}
"""
from __future__ import annotations

import json
import os
import secrets
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# Path to other scripts in the same dir — auto-insights fires via subprocess
# rather than importing so we don't drag generate-intake-insights' deps into
# this shim's module graph.
SCRIPT_DIR = Path(__file__).resolve().parent

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / "fm-plans"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client_yaml(client_id: str) -> Path:
    return _plans_root() / "clients" / client_id / "client.yaml"


def _load_client(client_id: str) -> dict:
    p = _client_yaml(client_id)
    if not p.exists():
        raise FileNotFoundError(f"client not found: {client_id}")
    import yaml  # type: ignore
    with p.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _save_client(client_id: str, data: dict) -> None:
    import yaml  # type: ignore
    p = _client_yaml(client_id)
    data["updated_at"] = _now_iso()
    data["updated_by"] = data.get("updated_by") or "intake-form"
    # Atomic write (audit Phase-1b): the public intake form autosaves the WHOLE
    # client.yaml every ~5s; a direct truncate-then-write left it corrupt on a
    # crash mid-write (PHI loss). temp+os.replace makes each save crash-safe.
    from atomic_write import write_text_atomic
    write_text_atomic(p, yaml.safe_dump(data, sort_keys=False, allow_unicode=True))


# ── intake profile photo ─────────────────────────────────────────────────────
#
# The client can attach a profile photo on the intake form. It rides the SUBMIT
# payload as a base64 JPEG (`client_photo_b64`) — NOT the /api/intake/upload
# route, because that route's binary files never cross the Fly→Mac staging
# boundary (the reconciler only mirrors client.yaml + the submission payload).
# Carrying the photo inside the submit payload means it lands in the audit
# session's raw_intake_payload, so when the Mac reconciler re-runs _apply_submit
# the photo is decoded into the AUTHORITATIVE store too.
#
# Written to clients/<id>/photo.jpg — the exact file the coach dashboard avatar
# reads (/api/client-photo/<id>) and the companion app falls back to. The client
# can later set a DIFFERENT app-only photo (clients/<id>/_app_photo.jpg) which
# never touches this file, so there's no backward flow from the app to the coach.
_PHOTO_OTHER_EXTS = ("jpeg", "png", "webp", "gif")
_MAX_PHOTO_BYTES = 8 * 1024 * 1024  # 8 MB decoded — the form downscales to ~480px


def _write_intake_profile_photo(client_id: str, b64: str) -> bool:
    """Decode a base64 photo from the intake submit payload and write it to
    clients/<id>/photo.jpg (the canonical coach-account photo). Best-effort:
    returns False (and never raises) on any decode/write problem so a bad photo
    can never block the intake submission itself."""
    if not isinstance(b64, str) or not b64.strip():
        return False
    import base64
    raw = b64.strip()
    # Tolerate a data-URL prefix ("data:image/jpeg;base64,....").
    if raw.startswith("data:"):
        comma = raw.find(",")
        if comma != -1:
            raw = raw[comma + 1 :]
    try:
        blob = base64.b64decode(raw, validate=False)
    except Exception:
        return False
    if not blob or len(blob) > _MAX_PHOTO_BYTES:
        return False
    try:
        client_dir = _plans_root() / "clients" / client_id
        client_dir.mkdir(parents=True, exist_ok=True)
        dest = client_dir / "photo.jpg"
        from atomic_write import write_bytes_atomic  # type: ignore
        write_bytes_atomic(dest, blob)
        # Drop any stale coach photo in another extension so /api/client-photo
        # (which probes jpg → jpeg → png → webp in order) resolves to ours.
        for ext in _PHOTO_OTHER_EXTS:
            other = client_dir / f"photo.{ext}"
            if other.exists():
                try:
                    other.unlink()
                except OSError:
                    pass
        return True
    except Exception:
        return False


_SHORT_CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def _all_intake_short_codes() -> set[str]:
    """Collect every intake_short_code in use across all clients."""
    import yaml  # type: ignore
    codes: set[str] = set()
    clients_dir = _plans_root() / "clients"
    if not clients_dir.exists():
        return codes
    for sub in clients_dir.iterdir():
        yml = sub / "client.yaml"
        if not yml.exists():
            continue
        try:
            with yml.open("r", encoding="utf-8") as f:
                d = yaml.safe_load(f) or {}
            code = d.get("intake_short_code")
            if code:
                codes.add(str(code))
        except Exception:
            pass
    return codes


def _generate_short_code_unique(length: int = 7) -> str:
    """Generate a collision-free base62 short code."""
    existing = _all_intake_short_codes()
    for _ in range(100):
        code = "".join(secrets.choice(_SHORT_CODE_ALPHABET) for _ in range(length))
        if code not in existing:
            return code
    # Astronomically unlikely, but fail loudly rather than silently re-use.
    raise RuntimeError("could not generate a unique short code after 100 attempts")


def _find_client_by_token(token: str) -> tuple[str, dict] | None:
    """Scan all clients/<id>/client.yaml for matching intake_token."""
    import yaml  # type: ignore
    clients_dir = _plans_root() / "clients"
    if not clients_dir.exists():
        return None
    for sub in clients_dir.iterdir():
        if not sub.is_dir():
            continue
        yml = sub / "client.yaml"
        if not yml.exists():
            continue
        try:
            with yml.open("r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
        except Exception:
            continue
        if data.get("intake_token") == token:
            return data.get("client_id") or sub.name, data
    return None


# ── staging layer (scope Fly to active intakes only) ─────────────────────────
#
# Goal: the public intake form on Fly should only ever hold clients with an
# OPEN form, and that data should evaporate from Fly once the coach finalises
# (or the token is revoked / expires). The full authoritative ~/fm-plans store
# stays on the Mac and is NOT synced to Fly.
#
# Mechanism: a separate staging dir (FMDB_STAGING_DIR, e.g. ~/fm-plans-staging)
# is the ONLY tree Mutagen mirrors to Fly. The Mac copies a minimal per-client
# stub into staging when a token is issued; a cron reconciler mirrors drafts +
# submissions back into the authoritative store; finalise/revoke/expiry delete
# the staging dir on the Mac (Mutagen propagates the removal to Fly, leaving the
# authoritative copy untouched).
#
# CRITICAL: every function here is a NO-OP when FMDB_STAGING_DIR is unset, so
# this whole feature is dormant until the env var is set in Phase 2. Existing
# behaviour (single-tree, full replica) is unchanged until then.

# Fields the public form needs to render + round-trip. Everything else in
# client.yaml (plans, AI rework, provenance, health snapshots, …) stays on the
# Mac and never crosses to Fly.
_STAGING_STUB_KEYS = (
    "client_id",
    "display_name",
    "date_of_birth",
    "sex",
    "email",
    "mobile_number",
    "city",
    "country",
    "active_conditions",
    "medical_history",
    "current_medications",
    "known_allergies",
    "goals",
    "dietary_preference",
    "animal_derived_supplements_ok",
    "foods_to_avoid",
    "non_negotiables",
    "family_history",
    # Ayurveda layer master switch + the decoupled dosha-quiz collection
    # flag — both mirrored so the Fly intake form (which reads the staging
    # stub, not the authoritative client.yaml) knows whether to render the
    # inline dosha section.
    "ayurveda_enabled",
    "collect_dosha_quiz",
    "timeline_events",
    # intake lifecycle fields that lookup/save_draft/submit read
    "intake_token",
    "intake_token_expires_at",
    "intake_short_code",
    "intake_full_unlocked_at",
    "intake_submitted_at",
    "intake_last_submitted_at",
    "intake_first_opened_at",
    "intake_finalised_at",
    "intake_form_draft",
    "engagement_status",
)


def _staging_root() -> "Path | None":
    env = os.environ.get("FMDB_STAGING_DIR")
    if not env:
        return None
    return Path(env).expanduser().resolve()


def _staging_client_yaml(client_id: str) -> "Path | None":
    root = _staging_root()
    if root is None:
        return None
    return root / "clients" / client_id / "client.yaml"


def _write_staging_stub(client_id: str, data: dict) -> bool:
    """Mirror the form-relevant subset of an authoritative client.yaml into the
    Fly-synced staging dir. No-op (returns False) when FMDB_STAGING_DIR is unset."""
    p = _staging_client_yaml(client_id)
    if p is None:
        return False
    import yaml  # type: ignore
    stub = {k: data[k] for k in _STAGING_STUB_KEYS if k in data}
    stub["client_id"] = client_id
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as f:
        yaml.safe_dump(stub, f, sort_keys=False, allow_unicode=True)
    return True


def _purge_staging(client_id: str) -> bool:
    """Delete a client's staging dir (Mac-side delete → Mutagen propagates the
    removal to Fly; the authoritative copy in a DIFFERENT tree is untouched).
    No-op (returns False) when FMDB_STAGING_DIR is unset or the dir is absent.

    App-staged clients (clients whose companion app is live — marker
    _app_staged.yaml, see app-staging-action.py) keep their dir: only the
    intake-specific data evaporates (intake_* keys + form sessions); the
    plan/letter artifacts the app serves stay until the plan is revoked."""
    root = _staging_root()
    if root is None:
        return False
    import shutil
    d = root / "clients" / client_id
    if not d.exists():
        return False
    if (d / "_app_staged.yaml").exists():
        import yaml  # type: ignore
        cy = d / "client.yaml"
        if cy.exists():
            try:
                data = yaml.safe_load(cy.read_text()) or {}
                for k in list(data.keys()):
                    if k.startswith("intake_"):
                        data.pop(k, None)
                cy.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True))
            except Exception:
                pass
        sess = d / "sessions"
        if sess.exists():
            for f in sess.glob("*-intake-form.yaml"):
                f.unlink()
        return True
    shutil.rmtree(d, ignore_errors=True)
    return True


def _staging_last_submitted_payload(client_id: str) -> dict:
    """The raw form payload from the most recent submission, read from the
    audit session the Fly-side _apply_submit wrote into the staging tree
    (same `ai_analysis.raw_intake_payload` contract as _last_submitted_payload,
    but rooted at FMDB_STAGING_DIR). Returns {} when none."""
    root = _staging_root()
    if root is None:
        return {}
    import yaml  # type: ignore
    sessions_dir = root / "clients" / client_id / "sessions"
    try:
        files = sorted(sessions_dir.glob("*-intake-form.yaml"))
    except Exception:
        return {}
    if not files:
        return {}
    try:
        with files[-1].open("r", encoding="utf-8") as f:
            sdata = yaml.safe_load(f) or {}
        payload = ((sdata.get("ai_analysis") or {}).get("raw_intake_payload")) or {}
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _should_purge_staging(adata: dict) -> bool:
    """An intake's staging copy should exist only while the form is live.
    Live = authoritative has an active token, not finalised, not expired.
    Returns True once it's finalised / revoked (token cleared) / expired."""
    if adata.get("intake_finalised_at"):
        return True
    if not adata.get("intake_token"):
        return True  # revoked, or token cleared
    exp = adata.get("intake_token_expires_at")
    if exp:
        try:
            e = datetime.fromisoformat(str(exp))
            if e.tzinfo is None:
                e = e.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > e:
                return True
        except Exception:
            pass
    return False


def _reconcile_one(client_id: str) -> dict:
    """Bring a single client's staging state into the authoritative store.

    Runs on the Mac, where _plans_root() = authoritative (~/fm-plans) and
    _staging_root() = the Fly-synced staging tree. Two things happen:

      1. Live-watch mirror — copy intake_form_draft + intake_first_opened_at
         from staging into the authoritative client.yaml, so the coach UI keeps
         seeing fields populate as the client types (~1 min lag on cron).
      2. Submission merge — if staging shows a newer submission than we've
         reconciled, re-run the exact _apply_submit merge against the
         authoritative store (derives conditions/symptoms, writes the audit
         session, fires insights). Idempotent via intake_staging_reconciled_at.

    No-op when staging is disabled or the client has no staging dir."""
    sp = _staging_client_yaml(client_id)
    if sp is None or not sp.exists():
        return {"client_id": client_id, "actions": [], "reason": "no_staging"}
    import yaml  # type: ignore
    try:
        with sp.open("r", encoding="utf-8") as f:
            sdata = yaml.safe_load(f) or {}
    except Exception as e:
        return {"client_id": client_id, "actions": [], "error": f"staging_read: {e}"}
    try:
        adata = _load_client(client_id)
    except FileNotFoundError:
        return {"client_id": client_id, "actions": [], "error": "authoritative_missing"}

    actions: list[str] = []

    # 1. live-watch mirror (draft + first-opened)
    changed = False
    for k in ("intake_form_draft", "intake_first_opened_at"):
        sv = sdata.get(k)
        if sv is not None and sv != adata.get(k):
            adata[k] = sv
            changed = True
    if changed:
        actions.append("draft_mirrored")

    # 2. submission merge (re-run _apply_submit against authoritative)
    s_last = sdata.get("intake_last_submitted_at") or sdata.get("intake_submitted_at")
    if s_last and s_last != adata.get("intake_staging_reconciled_at"):
        raw = _staging_last_submitted_payload(client_id)
        # mark BEFORE merge so the marker is persisted by _apply_submit's save
        adata["intake_staging_reconciled_at"] = s_last
        if raw:
            _apply_submit(client_id, adata, raw)  # saves authoritative + writes session
            actions.append("submission_merged")
            return {"client_id": client_id, "actions": actions}
        # No raw payload recoverable — carry the submission markers at least.
        if sdata.get("intake_submitted_at") and not adata.get("intake_submitted_at"):
            adata["intake_submitted_at"] = sdata["intake_submitted_at"]
        adata["intake_last_submitted_at"] = s_last
        changed = True
        actions.append("submission_marker_only")

    if changed:
        _save_client(client_id, adata)
    if not actions:
        actions.append("noop")
    return {"client_id": client_id, "actions": actions}


# ── action: generate ─────────────────────────────────────────────────────────

def action_generate(payload: dict) -> dict:
    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "client_id required"}
    ttl_days = int(payload.get("ttl_days") or 14)
    try:
        data = _load_client(client_id)
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}

    token = secrets.token_urlsafe(24)  # ~32 chars URL-safe
    expires = datetime.now(timezone.utc) + timedelta(days=ttl_days)
    data["intake_token"] = token
    data["intake_token_expires_at"] = expires.isoformat()
    # Short code — 7 random base62 chars (~42 bits). Collision-checked against
    # all existing clients. A new code is always issued with each new token so
    # the short URL stays in sync. If a collision is found we retry (extremely
    # unlikely at practice scale, but correct to check).
    short_code = _generate_short_code_unique()
    data["intake_short_code"] = short_code
    # NB: do NOT clear `intake_submitted_at`. It is a historical event —
    # "this client submitted at least once." Previously this line set it
    # to None on every regenerate, which destroyed the UI's ability to
    # show two-stage state correctly (Nidhi case 2026-05-19: pre-
    # discovery submitted May 15 → coach unlocked full + regenerated
    # token May 18 → submitted_at went to null → IntakeProgressCard
    # then showed "⏰ Link expired before she submitted", which was
    # wrong — she'd submitted ages ago). The card now reads `_last`
    # for "most recent activity" and `intake_submitted_at` for "ever
    # submitted." Coach's explicit `finalise` is the only thing that
    # locks state; regenerating a link should never erase history.
    #
    # The token + expiry change alone is enough to re-open the form
    # for editing; we DON'T need to lie about submission status.
    # Enable the auto-reminder cron for this client — coach is actively
    # sending an intake link, so the daily nudge is appropriate until they
    # submit. Reset reminder history so the new token gets its own 2-strike
    # quota. Coach can disable per-client via the SendIntakeFormButton UI
    # (intake_reminder_enabled toggle).
    data["intake_reminder_enabled"] = True
    data["intake_reminders_sent_at"] = []
    # v0.75 — DO NOT auto-flip engagement_status here. Sending an intake
    # link used to imply signup, but with the two-stage form (pre-discovery
    # → full), generating a token can happen BEFORE the discovery call (so
    # coach has data going in) and the client may not actually convert.
    # Coach flips engagement_status manually via the EngagementPicker after
    # the discovery call; unlock_full_intake() handles the signup transition.
    #
    # EXCEPTION — `unlock_full=True`: for direct signups (referrals, returning
    # clients, family-of-existing, anyone who's already committed and skips
    # the discovery call). Stamps intake_full_unlocked_at + engagement
    # signed_up in the same atomic write so the token they receive serves
    # the full form on first open.
    unlock_full = bool(payload.get("unlock_full"))
    if unlock_full:
        if not data.get("intake_full_unlocked_at"):
            data["intake_full_unlocked_at"] = _now_iso()
        data["engagement_status"] = "signed_up"
    _save_client(client_id, data)

    # Mirror a minimal stub into the Fly-synced staging tree so the public
    # form can resolve this token. No-op when FMDB_STAGING_DIR is unset (the
    # legacy full-replica mode). Non-fatal: log loudly if it fails — the token
    # is issued either way, but on Fly the form would 404 without the stub.
    try:
        _write_staging_stub(client_id, data)
    except Exception as e:
        print(f"[intake-token-action] staging stub write failed for {client_id}: {e}", file=sys.stderr)

    return {
        "ok": True,
        "unlock_full": unlock_full,
        "token": token,
        "short_code": short_code,
        "expires_at": expires.isoformat(),
        "url_path": f"/intake/{token}",
    }


# ── action: lookup ───────────────────────────────────────────────────────────

def _prefill_from_client(data: dict) -> dict:
    """Subset of client.yaml safe to send to the public form. Avoids leaking
    things like AI rework_suggestion or unrelated provenance."""
    return {
        "display_name": data.get("display_name") or "",
        "date_of_birth": str(data.get("date_of_birth") or ""),
        "sex": data.get("sex") or "",
        "email": data.get("email") or "",
        "mobile_number": data.get("mobile_number") or "",
        "city": data.get("city") or "",
        "country": data.get("country") or "",
        # Allow coach pre-fill to flow if she's started a stub
        "active_conditions": data.get("active_conditions") or [],
        "medical_history": data.get("medical_history") or [],
        "current_medications": data.get("current_medications") or [],
        "known_allergies": data.get("known_allergies") or [],
        "goals": data.get("goals") or [],
        "dietary_preference": data.get("dietary_preference") or "",
        "animal_derived_supplements_ok": data.get("animal_derived_supplements_ok") or "",
        "foods_to_avoid": data.get("foods_to_avoid") or "",
        "non_negotiables": data.get("non_negotiables") or "",
        "family_history": data.get("family_history") or "",
    }


def _last_submitted_payload(client_id: str) -> dict:
    """The most recent intake-form submission's raw payload, recovered
    from the audit session that _write_quick_note_session writes
    (`<date>-NNN-intake-form.yaml` → `ai_analysis.raw_intake_payload`).

    Why this exists: after a client submits, `intake_form_draft` is
    cleared, so a re-open re-populates from `prefill`. But
    `_prefill_from_client` only carries a minimal subset — no body
    composition, no timeline, no deep clinical fields — so without this
    a re-opened submitted intake showed most answers blank. The raw
    payload is already in the exact form-field shape, so merging it into
    `prefill` makes re-open a faithful round-trip of the whole form.

    Returns {} when there is no prior submission."""
    sessions_dir = _plans_root() / "clients" / client_id / "sessions"
    try:
        files = sorted(sessions_dir.glob("*-intake-form.yaml"))
    except Exception:
        return {}
    if not files:
        return {}
    try:
        import yaml  # type: ignore
        with files[-1].open("r", encoding="utf-8") as f:
            sdata = yaml.safe_load(f) or {}
        payload = ((sdata.get("ai_analysis") or {}).get("raw_intake_payload")) or {}
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def action_lookup(payload: dict) -> dict:
    token = (payload.get("token") or "").strip()
    if not token:
        return {"ok": False, "error": "token required"}
    hit = _find_client_by_token(token)
    if hit is None:
        return {"ok": False, "error": "invalid_or_expired", "message": "Link not found or already used."}
    client_id, data = hit
    # PATH A: previously-submitted intakes can still be re-opened for editing
    # until the coach explicitly finalises. The form copy promises this
    # ("you can keep editing until our session begins") so the lookup must
    # honour it. Only refuse if coach has explicitly locked.
    if data.get("intake_finalised_at"):
        return {"ok": False, "error": "locked", "message": "Form locked by your coach. Contact them to reopen if needed."}
    expires_iso = data.get("intake_token_expires_at")
    if expires_iso:
        try:
            exp = datetime.fromisoformat(str(expires_iso))
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > exp:
                return {"ok": False, "error": "expired", "message": "Link expired. Contact your coach for a new one."}
        except Exception:
            pass
    # Stamp first-opened timestamp — once. Lets coach see on the client
    # Overview "client opened the form" vs "still hasn't clicked the
    # link". Subsequent reopens (e.g. client comes back to edit a draft)
    # don't overwrite this; the saved-draft timestamp covers that.
    if not data.get("intake_first_opened_at"):
        data["intake_first_opened_at"] = _now_iso()
        try:
            _save_client(client_id, data)
        except Exception:
            # Best effort — even if we can't persist, the lookup itself
            # should succeed (the client is staring at a loading form).
            pass
    # v0.75 — two-stage form gate. If the coach has unlocked the full intake
    # (typically after package signup), serve the full form. Otherwise serve
    # the lighter pre-discovery form.
    #
    # Belt-and-braces: if the client is already marked signed_up but the
    # full-intake gate wasn't explicitly flipped (e.g. coach used the
    # EngagementPicker but forgot the unlock button, or marked signup
    # AFTER issuing a pre-discovery token), treat them as full. Avoids
    # the bug where a signed-up client opens their old link and gets
    # the pre-discovery form by mistake.
    is_signed_up = (data.get("engagement_status") or "").lower() == "signed_up"
    stage = "full" if (data.get("intake_full_unlocked_at") or is_signed_up) else "pre_discovery"
    # v0.75.4 — `previously_submitted` lets the full intake show a
    # "welcome back" banner instead of "Begin" when a client returns
    # after submitting pre-discovery. The data they shared is preserved
    # in client.yaml (and surfaced as `prefill` below).
    previously_submitted = bool(data.get("intake_submitted_at"))
    # Prefill = the minimal client.yaml subset, then (for a previously-
    # submitted intake) the client's full last submission overlaid on
    # top. The raw payload is already in form-field shape and is the
    # client's own input, so echoing it back is a faithful, leak-free
    # round-trip of every answer — body composition, deep clinical
    # fields, supplements — that the minimal subset used to drop.
    prefill = _prefill_from_client(data)
    if previously_submitted:
        raw = dict(_last_submitted_payload(client_id))
        # timeline_events: keep the fuller client.yaml set. Later
        # transcript / coach additions routinely exceed what the intake
        # form itself carried, so don't let the submission's list
        # clobber it.
        raw.pop("timeline_events", None)
        prefill = {**prefill, **raw}
    # Always surface the current client.yaml timeline (covers coach
    # pre-stubs as well as the post-submit fuller set).
    tl = data.get("timeline_events")
    if tl:
        prefill["timeline_events"] = tl
    return {
        "ok": True,
        "client_id": client_id,
        "display_name": data.get("display_name") or "",
        "coach_name": data.get("assigned_coach") or "Shivani",
        "intake_form_draft": data.get("intake_form_draft") or {},
        "prefill": prefill,
        "stage": stage,
        "previously_submitted": previously_submitted,
        # The full intake renders the dosha self-assessment inline (see
        # intake-form.tsx doshaInline) when EITHER the Ayurveda layer is on
        # OR collect_dosha_quiz is set (the decoupled, default-on-for-new
        # data-collection switch), instead of re-sending a separate
        # ?focus=dosha link. On Fly `data` is the staging stub, so this
        # only works because both keys are in _STAGING_STUB_KEYS.
        "ayurveda_enabled": bool(data.get("ayurveda_enabled")),
        "collect_dosha_quiz": bool(data.get("collect_dosha_quiz")),
    }


# ── action: save_draft ───────────────────────────────────────────────────────

def action_save_draft(payload: dict) -> dict:
    token = (payload.get("token") or "").strip()
    draft = payload.get("draft") or {}
    if not token:
        return {"ok": False, "error": "token required"}
    if not isinstance(draft, dict):
        return {"ok": False, "error": "draft must be an object"}
    hit = _find_client_by_token(token)
    if hit is None:
        return {"ok": False, "error": "invalid_or_expired"}
    client_id, data = hit
    # PATH A: still-editable until coach finalises (see action_lookup).
    if data.get("intake_finalised_at"):
        return {"ok": False, "error": "locked"}
    saved_at = _now_iso()
    data["intake_form_draft"] = draft
    data["intake_form_draft_saved_at"] = saved_at
    _save_client(client_id, data)
    return {"ok": True, "saved_at": saved_at}


# ── action: submit ───────────────────────────────────────────────────────────

# Fields that map 1:1 from form payload → client.yaml (overwrite when payload
# has a non-empty value, otherwise keep existing).
_SCALAR_FIELDS = [
    "display_name",
    "date_of_birth",
    "sex",
    "email",
    "mobile_number",
    "address_line1", "address_line2", "city", "state", "pincode", "country",
    "dietary_preference", "animal_derived_supplements_ok",
    "foods_to_avoid", "non_negotiables", "reported_triggers",
    "family_history",
    # Deep clinical narrative fields
    "digestion_notes", "sleep_notes", "energy_pattern", "menstrual_notes",
    "stress_response", "childhood_history", "toxic_exposures",
    "what_has_worked", "what_hasnt_worked",
    # Lifestyle exposures + mental-health care (single-string radios/text)
    "smoking_status", "smoking_detail", "alcohol_intake",
    "current_mental_health_care",
    # Intimate / urinary health (women only) — single-select frequency
    "vaginal_yeast_frequency",
    # Cycle / pregnancy
    "cycle_status", "cycle_regularity",
    "pregnancy_status",
    "notes",
    # ── v0.72 intake additions: scalar (text + radio = single string) ──
    "weight_trend_current", "weight_change_trigger",
    "covid_vaccine_reaction_detail",
    "cold_heat_tolerance",
    "time_to_fall_asleep", "snore_or_apnoea", "restless_legs",
    "cgm_owned", "caffeine_dependency", "morning_state",
    "hair_loss_pattern", "hair_texture_change",
    "belly_fat_pattern",
    "period_pain_impact", "pmdd_signs",
    "sun_exposure_daily", "sunscreen_use", "vit_d_supplement", "barefoot_outdoors",
    "recent_labs_when", "willing_to_share_labs", "willing_to_test_further",
    "bowel_historical",
    # ── v0.75.2 Tier 1 screening scalars ──
    "lean_test_supine_hr", "lean_test_standing_hr",
    "large_fish_frequency",
]

# Date-typed scalars — same overwrite rules but cast through ISO.
_DATE_FIELDS = [
    "last_menstrual_period",
    "pregnancy_due_date",
    "lactation_started",
    "menopause_started",
]

# Int scalars
_INT_FIELDS = [
    "cycle_length_days",
    # ── v0.72 intake additions ──
    "bowel_frequency_per_day",
    "period_pain_severity",       # 1-10 slider
    "readiness_confidence",       # 1-10 slider
]

# Float scalars (kg measurements)
_FLOAT_FIELDS = [
    "weight_highest_adult", "weight_lowest_adult",
]

# List fields — merged additively (case-insensitive dedup).
_LIST_FIELDS = [
    "active_conditions",
    "medical_history",
    "current_medications",
    # current_supplements: the form collects it (string[]) and the Client
    # model has had the field since v2.4, but the handler never wired it
    # — so every client's "supplements I currently take" answer was
    # silently dropped. Additive merge, same as current_medications.
    "current_supplements",
    "known_allergies",
    "goals",
]

# v0.72 chip-array fields — same merge rules as _LIST_FIELDS but listed
# separately for clarity since they're all client-form additions.
_INTAKE_LIST_FIELDS = [
    "work_pattern",
    "family_specific_conditions",
    "covid_history", "covid_long_symptoms",
    "covid_vaccine_history", "covid_vaccine_brand", "covid_vaccine_reactions",
    "postprandial_pattern",
    "wake_time_pattern", "sleep_tracker_owned", "energy_crashes",
    "bowel_pattern", "hair_other", "nail_signs",
    "acne_pattern", "skin_signs",
    "pain_locations", "headache_type", "pain_pattern", "pain_quality",
    "histamine_signals", "chemical_sensitivity", "oral_signs",
    "eye_signs",
    "repro_diagnoses", "perimenopause_inventory",
    "vaginal_signs",
    "recent_labs_done",
    # ── v0.75.2 Tier 1 screening chip-arrays ──
    "beighton_self_score", "beighton_supplemental",
    "hr_devices_owned", "lean_test_symptoms",
    "pem_screen", "mould_exposure",
    # ── v0.75.5 Tier 2 screening chip-arrays ──
    "ace_signals", "stop_bang_signals", "endometriosis_signals",
]

# Int-array fields (Bristol type can be 1-7, multi-tick)
_INTAKE_INT_LIST_FIELDS = ["bristol_stool_typical"]

# Repeater fields — list of structured dicts. Overwrite-on-submit (not
# additive merge) because the form is the source of truth for these.
_INTAKE_REPEATER_FIELDS = [
    "contraception_history",       # list[ContraceptionEntry]
    "pregnancies",                 # list[PregnancyEntry]
    "glp1_medications",
    "acid_suppressants",
    "nsaids_daily",
    "antibiotics_last_12mo",
    "hormonal_contraception_hrt",
    "thyroid_medication",
    "psych_medications",
    "biologics_immunosuppressants",
    "statins_bp_diabetes",
]


def _canonicalise_condition(s: str) -> str:
    """D2 fix 2026-05-23 — semantic key for active_conditions dedup.
    Strips parens content + punctuation + whitespace + lowercases, AND
    tokenises so word-order variants normalise (so "Depression / anxiety
    (on treatment)" matches "Anxiety/Depression (on treatment)"). Without
    this, Kshitija cl-010 ended up with both phrasings stacked + the
    auto-derived "Suspected: …" variants on top.

    Used ONLY for active_conditions merge — not for general list fields
    (we don't want "vitamin D" and "vitamin D3" to collide on the
    supplements list, for example)."""
    import re
    s2 = re.sub(r"\(.*?\)", "", s).lower()
    s2 = re.sub(r"[^a-z0-9 ]+", " ", s2)
    s2 = re.sub(r"\s+", " ", s2).strip()
    # Tokenise + sort so "depression anxiety" == "anxiety depression"
    tokens = sorted(t for t in s2.split() if t and t not in {"on", "treatment", "the", "a", "of"})
    return " ".join(tokens)


def _merge_lists(existing: list[str] | None, incoming: list[str] | None, semantic_dedup: bool = False) -> tuple[list[str], bool]:
    existing = existing or []
    # DEFENCE: if a caller mis-types and passes a string instead of a list,
    # `for x in <string>` iterates CHARACTERS and we end up with the
    # field stored as 50+ single-character entries (Archana cl-007 was
    # hit by exactly this — `goals` ballooned to 56 entries: 2 real + 54
    # chars from a third string-typed goal). Wrap a bare string in a
    # single-element list, and log loudly so the source can be found.
    if isinstance(incoming, str):
        print(
            f"WARN: _merge_lists received a STRING (not list) — wrapping. "
            f"value={incoming[:80]!r}",
            file=sys.stderr,
        )
        incoming = [incoming]
    elif incoming is None:
        incoming = []
    elif not isinstance(incoming, list):
        print(
            f"WARN: _merge_lists got non-list/non-string ({type(incoming).__name__}) — coercing to empty.",
            file=sys.stderr,
        )
        incoming = []
    incoming = [str(x).strip() for x in incoming if str(x).strip()]
    if not incoming:
        return existing, False
    if semantic_dedup:
        # D2 — token-sorted canonical key catches "Depression / anxiety
        # (on treatment)" ≡ "Anxiety/Depression (on treatment)" etc.
        existing_keys = {_canonicalise_condition(e) for e in existing}
        added: list[str] = []
        seen_in_added: set[str] = set()
        for x in incoming:
            key = _canonicalise_condition(x)
            if key in existing_keys or key in seen_in_added:
                continue
            added.append(x)
            seen_in_added.add(key)
    else:
        lower = {e.lower() for e in existing}
        added = [x for x in incoming if x.lower() not in lower]
    if not added:
        return existing, False
    return existing + added, True


_DRUG_INDEX_CACHE: dict | None = None


def _build_drug_index() -> dict:
    """Load drug_depletions catalogue once + build alias → entry index.

    Returns a dict of:
      {
        'aliases': { lowercase_alias_or_name: drug_dict, ... },
        'all': [drug_dict, ...],
      }
    Falls back to empty dict on any IO error — handler must work even if
    catalogue is unreadable.
    """
    global _DRUG_INDEX_CACHE
    if _DRUG_INDEX_CACHE is not None:
        return _DRUG_INDEX_CACHE
    import yaml  # type: ignore
    out_aliases: dict = {}
    out_all: list = []
    try:
        cat_dir = FMDB_ROOT / "data" / "drug_depletions"
        if cat_dir.exists():
            for p in cat_dir.glob("*.yaml"):
                try:
                    with p.open() as f:
                        d = yaml.safe_load(f) or {}
                except Exception:
                    continue
                if not isinstance(d, dict):
                    continue
                name = (d.get("drug_name") or "").strip()
                aliases = [name] + [str(a) for a in (d.get("drug_aliases") or [])]
                for a in aliases:
                    a = (a or "").strip().lower()
                    if a and a not in out_aliases:
                        out_aliases[a] = d
                out_all.append(d)
    except Exception:
        pass
    _DRUG_INDEX_CACHE = {"aliases": out_aliases, "all": out_all}
    return _DRUG_INDEX_CACHE


def _match_drug(med_text: str) -> dict | None:
    """Substring-match a medication free-text string against the catalogue
    alias index. Longest alias wins to avoid 'metformin' inside 'metformin xr'
    matching the shorter entry when a more specific one exists.
    """
    idx = _build_drug_index()
    text = (med_text or "").strip().lower()
    # GUARD: too-short med text would falsely match any short alias
    # (e.g. catalogue has 't4' as a levothyroxine alias — if a corrupted
    # current_medications entry was 't', this matcher would happily
    # flag levothyroxine for everyone with that garbage entry). 3-char
    # floor mirrors the TS-side guard in checkMedicationImpactsAction
    # (see Archana cl-007 phantom-match incident 2026-05-23).
    if len(text) < 3:
        return None
    best: tuple[int, dict] | None = None
    for alias, drug in idx["aliases"].items():
        if alias and len(alias) >= 2 and alias in text:
            if best is None or len(alias) > best[0]:
                best = (len(alias), drug)
    return best[1] if best else None


def _derive_conditions_from_intake(payload: dict) -> list[str]:
    """Infer present diseases from medications + goals + form signals.

    Two-stage lookup:

    1. CATALOGUE lookup (preferred) — scan client.current_medications and
       all medication repeater fields against drug_depletions/*.yaml.
       Each matching drug contributes its condition_implications[].label
       (gated by confidence: high → definite, moderate → "suspected …",
       low → ignored).

    2. FALLBACK heuristics — for free-text fields with no drug match
       (goals, chief_complaint), keep the original keyword rules so we
       still catch "high HbA1c", "high BP" etc. mentioned in prose.
    """
    out: list[str] = []

    def add(label: str) -> None:
        if not any(c.lower() == label.lower() for c in out):
            out.append(label)

    # D7 fix 2026-05-23 — when a condition is matched from FREE TEXT
    # (goals, chief_complaint, notes) it must be prefixed "Suspected:"
    # because the client's wording is the LEAST authoritative source.
    # Pranati cl-009 wrote `"? Diabetes"` and `"Recurrence of
    # hypertension after 3 yrs"` in her goals; the matcher caught the
    # bare words "diabet" / "hypertens" and added BOTH as confirmed
    # diagnoses. Going forward: free-text matches → Suspected, structured
    # medication matches → confirmed (medication on chart implies a
    # treating clinician already diagnosed). Additionally we skip the
    # add entirely when the client's wording explicitly says "?" near
    # the matched word — that's the client wondering whether they have
    # it, not asserting it.
    def add_from_freetext(label: str, matched_text: str, source: str) -> None:
        # Question-mark sentinel — "? Diabetes" / "Diabetes ?" / "do I
        # have diabetes" — client is asking, not telling. Skip.
        if "?" in source and label.lower().split(":", 1)[-1].strip()[:6] in source.lower():
            return
        # Otherwise add as Suspected — coach reviews and promotes.
        prefixed = f"Suspected: {label}" if not label.lower().startswith("suspected") else label
        if not any(c.lower() == prefixed.lower() for c in out):
            # If the confirmed version is already present (from a
            # medication match upstream), DON'T re-add the suspected
            # version on top.
            if any(c.lower() == label.lower() for c in out):
                return
            out.append(prefixed)
        _ = matched_text  # currently unused; kept for future audit logging

    # ── Stage 1: catalogue-driven drug → condition lookup ──
    def _collect_med_strings(payload: dict) -> list[str]:
        """Flatten all medication-bearing fields into a list of strings."""
        strs: list[str] = []
        med_fields = (
            "current_medications", "medications",
            "glp1_medications", "acid_suppressants", "nsaids_daily",
            "antibiotics_last_12mo", "hormonal_contraception_hrt",
            "thyroid_medication", "psych_medications",
            "biologics_immunosuppressants", "statins_bp_diabetes",
        )
        for fld in med_fields:
            v = payload.get(fld) or []
            if isinstance(v, list):
                for entry in v:
                    if isinstance(entry, dict):
                        s = (entry.get("name") or "").strip()
                        if s: strs.append(s)
                    elif entry:
                        strs.append(str(entry))
        return strs

    try:
        med_strings = _collect_med_strings(payload)
        for med_text in med_strings:
            drug = _match_drug(med_text)
            if not drug:
                continue
            for impl in (drug.get("condition_implications") or []):
                conf = (impl.get("confidence") or "moderate").lower()
                if conf == "low":
                    continue  # too non-specific to auto-populate
                label = (impl.get("label") or "").strip()
                if not label:
                    continue
                if conf == "moderate":
                    label = f"Suspected: {label}"
                add(label)
    except Exception as e:
        print(f"[intake-token-action] catalogue drug lookup failed: {e}", file=sys.stderr)

    def med_names(field: str) -> str:
        v = payload.get(field) or []
        if not isinstance(v, list):
            return ""
        parts = []
        for entry in v:
            if isinstance(entry, dict):
                parts.append(str(entry.get("name") or ""))
            else:
                parts.append(str(entry))
        return " | ".join(parts).lower()

    # Free-text fields where the client may describe their condition
    goals_text = " ".join(payload.get("goals") or []).lower() if isinstance(payload.get("goals"), list) else str(payload.get("goals") or "").lower()
    chief = (payload.get("chief_complaint") or "").lower()
    notes = (payload.get("notes") or "").lower()
    free_text = " ".join([goals_text, chief, notes])

    # Aggregated med strings per category
    bp_diab = med_names("statins_bp_diabetes")
    thyroid = med_names("thyroid_medication")
    glp1 = med_names("glp1_medications")
    psych = med_names("psych_medications")
    biologics = med_names("biologics_immunosuppressants")
    hrt = med_names("hormonal_contraception_hrt")
    acid = med_names("acid_suppressants")
    current = " ".join(payload.get("current_medications") or []).lower() if isinstance(payload.get("current_medications"), list) else str(payload.get("current_medications") or "").lower()
    all_meds = " | ".join([bp_diab, thyroid, glp1, psych, biologics, hrt, acid, current])

    DIABETES_KEYS = (
        "metformin", "janumet", "januvia", "sitagliptin", "glipizide",
        "glimepiride", "gliclazide", "pioglitazone", "vildagliptin",
        "linagliptin", "saxagliptin", "empagliflozin", "dapagliflozin",
        "canagliflozin", "insulin glargine", "humalog", "lantus",
        " insulin ", " insulin,", " insulin/", "insulin pen",
        "for diabetes", "diabetes med", "diabetic med",
    )
    # Medication-driven → confirmed. Free-text → Suspected (per D7 fix).
    if any(k in all_meds for k in DIABETES_KEYS):
        add("Diabetes")
    if glp1.strip():  # any GLP1 entry present → likely diabetes or obesity
        if "ozempic" in glp1 or "mounjaro" in glp1 or "tirzepatide" in glp1 or "semaglutide" in glp1 or "wegovy" in glp1 or "saxenda" in glp1:
            add("Diabetes" if "diabetes" in (goals_text + chief) else "Obesity")
    if any(k in free_text for k in ("diabet", "hba1c", "blood sugar", "sugar med", "sugar is high", "fasting glucose")):
        add_from_freetext("Diabetes", "diabet/HbA1c", free_text)

    STATIN_KEYS = ("atorvastatin", "rosuvastatin", "simvastatin", "pitavastatin", "lovastatin", "pravastatin", " statin", "fenofibrate", "ezetimibe")
    if any(k in all_meds for k in STATIN_KEYS):
        add("Dyslipidaemia")
    if any(k in free_text for k in ("high cholesterol", "dyslipid", "ldl is high", "triglycerides")):
        add_from_freetext("Dyslipidaemia", "cholesterol/dyslipid", free_text)

    BP_KEYS = (
        "telmisartan", "olmesartan", "losartan", "valsartan", "candesartan",
        "amlodipine", "nifedipine", "cilnidipine",
        "ramipril", "enalapril", "lisinopril", "perindopril",
        "metoprolol", "bisoprolol", "atenolol", "carvedilol", "nebivolol",
        "hydrochlorothiazide", "indapamide", "chlorthalidone",
        "for bp", "for blood pressure", "dilnip", "telma", "amlong",
    )
    if any(k in all_meds for k in BP_KEYS):
        add("Hypertension")
    if any(k in free_text for k in ("hypertens", "high bp", "blood pressure med")):
        add_from_freetext("Hypertension", "hypertens/high bp", free_text)

    if thyroid.strip() or any(k in all_meds for k in ("levothyroxine", "eltroxin", "thyronorm", "synthroid", "liothyronine", "armour")):
        add("Hypothyroidism")
    if any(k in free_text for k in ("hashimoto", "hypothyroid", "thyroid is")):
        add_from_freetext("Hypothyroidism", "hashimoto/hypothyroid", free_text)

    if biologics.strip():
        add("Autoimmune disease (on immunomodulator)")
    if psych.strip() or any(k in all_meds for k in ("sertraline", "fluoxetine", "escitalopram", "venlafaxine", "duloxetine", "mirtazapine", "bupropion", " ssri", " snri")):
        add("Anxiety/Depression (on treatment)")
    if acid.strip() or any(k in all_meds for k in ("pantoprazole", "omeprazole", "esomeprazole", "rabeprazole", "lansoprazole", " ppi", "ranitidine", "famotidine")):
        add("Acid reflux / GERD")

    # Cycle / menopause status from explicit form field
    cs = (payload.get("cycle_status") or "").lower()
    if cs in ("postmenopausal", "surgical_menopause"):
        add("Postmenopausal")
    elif cs == "perimenopausal":
        add("Perimenopausal")

    return out


def _derive_symptoms_from_intake(payload: dict) -> list[str]:
    """Map structured intake-form signals to symptom catalogue slugs.

    The intake form has rich symptom-like signals scattered across structured
    fields (pain_locations, pain_quality, hair_loss_pattern, bristol stool,
    wake_time_pattern, etc.). Without this mapping, the coach lands on the
    Full Assessment page with `selected_symptoms: []` and has to re-enter
    everything the client already reported.

    We map only to slugs known to exist in the catalogue. Conservative on
    purpose — better to miss a symptom than to emit broken slugs the
    validator rejects.
    """
    out: list[str] = []

    def add(slug: str) -> None:
        if slug not in out:
            out.append(slug)

    def has(field: str, value: str) -> bool:
        v = payload.get(field) or []
        if isinstance(v, list):
            return any(str(x).lower().strip() == value.lower() for x in v)
        if isinstance(v, str):
            return v.lower().strip() == value.lower()
        return False

    def has_substr(field: str, substr: str) -> bool:
        v = payload.get(field) or []
        if isinstance(v, list):
            return any(substr.lower() in str(x).lower() for x in v)
        if isinstance(v, str):
            return substr.lower() in v.lower()
        return False

    # ── Pain: quality + location ──
    pq = payload.get("pain_quality") or []
    if isinstance(pq, list):
        pql = [str(x).lower() for x in pq]
        if any("pins and needles" in q or "tingling" in q or "numb" in q for q in pql):
            add("numbness-tingling")
        if any("stiff" in q for q in pql):
            add("joint-stiffness-and-swelling")
        if any("ache" in q or "dull" in q for q in pql):
            add("joint-pain")
    # If pain_locations populated at all (any body region), surface joint-pain
    pl = payload.get("pain_locations") or []
    if isinstance(pl, list) and len(pl) > 0 and "joint-pain" not in out:
        add("joint-pain")
    if has_substr("pain_pattern", "wakes me at night"):
        add("sleep-disruption")

    # ── Sleep ──
    wt = payload.get("wake_time_pattern") or []
    if isinstance(wt, list):
        wtl = [str(x).lower() for x in wt]
        if any("3am" in w or "wake around" in w or "consistently" in w for w in wtl):
            add("insomnia")
        if any("urinate" in w or "urinat" in w for w in wtl):
            add("nocturia")
    if has("time_to_fall_asleep", "30_60") or has("time_to_fall_asleep", "over_60"):
        add("insomnia")

    # ── Energy / fatigue (uses daytime-fatigue, lethargy aliases "fatigue") ──
    ep = (payload.get("energy_pattern") or "").lower()
    if "slump" in ep or "crash" in ep or "tired" in ep or "fatigue" in ep:
        add("daytime-fatigue")
    if has_substr("energy_crashes", "afternoon") or has_substr("energy_crashes", "post-meal"):
        add("daytime-fatigue")

    # ── GI ──
    bs = payload.get("bristol_stool_typical") or []
    if isinstance(bs, list):
        # Bristol 6 or 7 = loose / diarrhea; 1 or 2 = constipation
        if any(int(x) in (6, 7) for x in bs if str(x).isdigit()):
            add("diarrhea")
    dn = (payload.get("digestion_notes") or "").lower()
    if "loose" in dn or "loosie" in dn or "diarrh" in dn:
        add("diarrhea")
    if "bloat" in dn:
        add("bloating")

    # ── Hair / skin / oral ──
    if has("hair_loss_pattern", "diffuse_thinning") or has("hair_loss_pattern", "patchy"):
        add("hair-loss")
    if has_substr("hair_other", "facial hair"):
        add("facial-hair")
    if has_substr("oral_signs", "white coating"):
        add("white-tongue-coating")

    # ── Urinary ──
    if has_substr("wake_time_pattern", "urinate"):
        add("frequent-urination")

    # ── Mood / stress ──
    sr = (payload.get("stress_response") or "").lower()
    if "shut down" in sr or "overwhelm" in sr or "anxio" in sr:
        add("stress-sensitivity")

    # ══════════════════════════════════════════════════════════════════════
    # Expanded structured-field mapping — parity with the Analyse page helper
    # (src/lib/fmdb/intake-symptoms.ts). The two callers intentionally mirror
    # each other; keep them in sync.
    # ══════════════════════════════════════════════════════════════════════
    def txt(field: str) -> str:
        v = payload.get(field)
        return str(v).lower() if v else ""

    # Hair — ANY reported loss pattern (clumps_shower, widening_part, …)
    hl = txt("hair_loss_pattern")
    if hl and hl not in ("none", "no", "no_loss", "no concerns"):
        add("hair-loss")

    # Energy / fatigue
    if payload.get("energy_crashes"):
        add("chronic-fatigue")
        if has_substr("energy_crashes", "meal"):
            add("daytime-fatigue")
    if has_substr("postprandial_pattern", "sleepy"):
        add("daytime-fatigue")

    # Bowel — constipation + occult blood were previously unhandled
    if (has_substr("bowel_pattern", "constipation")
            or has_substr("bowel_pattern", "straining")
            or has_substr("bowel_pattern", "incomplete")):
        add("constipation")
    if has_substr("bowel_pattern", "loose") or has_substr("bowel_pattern", "diarrh"):
        add("diarrhea")
    if has_substr("bowel_pattern", "blood"):
        add("rectal-bleeding")
    bs2 = payload.get("bristol_stool_typical") or []
    if isinstance(bs2, list) and any(int(x) in (1, 2) for x in bs2 if str(x).isdigit()):
        add("constipation")

    # Digestion notes (free text)
    if "constipat" in txt("digestion_notes"):
        add("constipation")
    if "acid" in txt("digestion_notes"):
        add("heartburn")
    if "headache" in txt("digestion_notes"):
        add("headache")

    # Headache
    if payload.get("headache_type"):
        add("headache")

    # Sleep — fragmented / multiple waking
    if has_substr("wake_time_pattern", "multiple") or has_substr("wake_time_pattern", "wake"):
        add("insomnia")

    # Pain — widespread / spinal → chronic-pain
    if isinstance(pl, list) and (
        len(pl) >= 3
        or any(k in " ".join(str(x).lower() for x in pl)
               for k in ("back", "scapula", "sacrum", "spine"))
    ):
        add("chronic-pain")

    # Histamine / food sensitivity
    if payload.get("histamine_signals"):
        add("food-sensitivities")
        add("histamine-intolerance")

    # Menstrual
    if has_substr("endometriosis_signals", "heavy") or has_substr("endometriosis_signals", "clot"):
        add("heavy-periods")
    if (has_substr("endometriosis_signals", "pain")
            or has_substr("repro_diagnoses", "endometriosis")
            or has_substr("repro_diagnoses", "adenomyosis")):
        add("dysmenorrhea")
    pps = payload.get("period_pain_severity")
    try:
        if pps is not None and float(pps) >= 4:
            add("dysmenorrhea")
    except (TypeError, ValueError):
        pass

    # Intimate / urinary health (women only) — yeast / microbiome / dryness
    yeast_freq = txt("vaginal_yeast_frequency")
    if (has_substr("vaginal_signs", "frequent yeast")
            or has_substr("vaginal_signs", "paneer")
            or has_substr("vaginal_signs", "cottage cheese")
            or "2–3" in yeast_freq or "4 or more" in yeast_freq):
        add("chronic-candida-infections")
    if (has_substr("vaginal_signs", "unusual or increased discharge")
            or has_substr("vaginal_signs", "greyish")):
        add("vaginal-discharge")
    if has_substr("vaginal_signs", "itching"):
        add("vaginal-itching")
    if has_substr("vaginal_signs", "vaginal dryness"):
        add("vaginal-dryness")
    if has_substr("vaginal_signs", "frequent urine") or has_substr("vaginal_signs", "uti"):
        add("urinary-tract-infections")

    # Constitutional / skin / weight
    if "cold" in txt("cold_heat_tolerance"):
        add("cold-intolerance")
    if has_substr("skin_signs", "dry"):
        add("dry-skin")
    if "gain" in txt("weight_trend_current"):
        add("unexplained-weight-gain")

    # ── Validate against the symptom catalogue — never emit an unknown slug ──
    try:
        valid = {p.stem for p in (FMDB_ROOT / "data" / "symptoms").glob("*.yaml")}
        if valid:
            out = [s for s in out if s in valid]
    except Exception:
        pass

    return out


def _write_quick_note_session(client_id: str, payload: dict) -> str:
    """Append a tagged session capturing the raw intake payload for audit."""
    import yaml  # type: ignore
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    sessions_dir = _plans_root() / "clients" / client_id / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    # Pick next NNN suffix for today
    existing = sorted(sessions_dir.glob(f"{today}-*.yaml"))
    suffix = len(existing) + 1
    session_id = f"{today}-{suffix:03d}-intake-form"
    yml = sessions_dir / f"{session_id}.yaml"
    # Compact summary line for human scanning
    summary_lines = []
    for k in ["digestion_notes", "sleep_notes", "energy_pattern",
              "stress_response", "what_has_worked", "what_hasnt_worked"]:
        v = (payload.get(k) or "").strip()
        if v:
            summary_lines.append(f"**{k.replace('_', ' ').title()}** — {v[:300]}")
    coach_notes = "[source: client_intake_form]\n\n" + "\n\n".join(summary_lines or ["(no narrative fields filled)"])

    derived_symptoms = _derive_symptoms_from_intake(payload)
    session_data = {
        "session_id": session_id,
        "client_id": client_id,
        "date": today,
        "session_type": "quick_note",
        "presenting_complaints": "[source: client_intake_form] Client-submitted intake questionnaire.",
        "coach_notes": coach_notes,
        "selected_symptoms": derived_symptoms,
        "selected_topics": [],
        "uploaded_files": [],
        "measurements_snapshot": payload.get("measurements") or {},
        "ai_analysis": {"raw_intake_payload": payload},
        "chat_log": [],
        "generated_plan_slug": None,
        "five_pillars": payload.get("five_pillars") or None,
        "version": 1,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "updated_by": "intake-form",
    }
    with yml.open("w", encoding="utf-8") as f:
        yaml.safe_dump(session_data, f, sort_keys=False, allow_unicode=True)
    return session_id


def _measurements_from_intake(submitted: dict) -> dict:
    """Canonical measurements dict built from the intake form's FLAT
    body-composition fields.

    The form sends height / weight / waist / hip / BP as TOP-LEVEL keys
    (height_cm | height_ft + height_in, weight_now_kg | weight_now_lb,
    waist_cm | waist_in, hip_cm | hip_in, bp_systolic, bp_diastolic) —
    NOT as a nested `measurements` dict. Each row accepts metric OR
    imperial; imperial is converted to metric here so everything
    downstream (BMI, calorie targets, waist:hip) just works.

    Before 2026-05-20 the submit handler only read a nested `measurements`
    dict that the form never builds — so every client's intake body-comp
    answers were silently dropped. This helper is the fix.
    """
    def _num(key: str):
        v = submitted.get(key)
        if v in (None, "", 0, "0"):
            return None
        try:
            f = float(v)
        except (TypeError, ValueError):
            return None
        return f if f > 0 else None

    out: dict = {}

    # v0.75.7 — IMPERIAL WINS when present. The form now shows imperial
    # inputs only (kg / ft+in / inches); a stale cm value on a returning
    # intake would silently override the client's new imperial entry if
    # we checked cm first. So we prefer imperial whenever it's set, and
    # fall back to cm only when imperial is empty.

    # Height — (ft, in) → cm, else cm direct.
    h_cm = None
    ft, inch = _num("height_ft"), _num("height_in")
    if ft is not None or inch is not None:
        h_cm = round((ft or 0) * 30.48 + (inch or 0) * 2.54, 1)
    if h_cm is None:
        h_cm = _num("height_cm")
    if h_cm:
        out["height_cm"] = h_cm

    # Weight — kg direct (universal in India), else lb → kg.
    # Kg stays first here because the form's only weight input IS kg —
    # lb only exists as a legacy fallback for old data.
    w_kg = _num("weight_now_kg")
    if w_kg is None:
        lb = _num("weight_now_lb")
        if lb is not None:
            w_kg = round(lb * 0.453592, 1)
    if w_kg:
        out["weight_kg"] = w_kg

    # Waist — in → cm, else cm direct.
    waist = None
    waist_in_v = _num("waist_in")
    if waist_in_v is not None:
        waist = round(waist_in_v * 2.54, 1)
    if waist is None:
        waist = _num("waist_cm")
    if waist:
        out["waist_cm"] = waist

    # Hip — in → cm, else cm direct.
    hip = None
    hip_in_v = _num("hip_in")
    if hip_in_v is not None:
        hip = round(hip_in_v * 2.54, 1)
    if hip is None:
        hip = _num("hip_cm")
    if hip:
        out["hip_cm"] = hip

    # Blood pressure — form keys bp_systolic / bp_diastolic.
    sys_bp = _num("bp_systolic")
    if sys_bp:
        out["blood_pressure_systolic"] = int(round(sys_bp))
    dia_bp = _num("bp_diastolic")
    if dia_bp:
        out["blood_pressure_diastolic"] = int(round(dia_bp))

    return out


def action_submit(payload_in: dict) -> dict:
    """Submit intake. PATH A behaviour (2026-05-15): submit is NOT final.
    The form copy promises the client they can keep editing until the
    appointment, so re-submits are allowed and overwrite previous values.
    The token stays active until either (a) coach calls action_finalise,
    (b) intake_token_expires_at passes, or (c) the intake-token's TTL
    is naturally exhausted.

    Tracks:
      - intake_submitted_at — first submit only (used by UI to show "✓ Form
        submitted on ..." pill)
      - intake_last_submitted_at — every submit (used by cron auto-reminder
        to skip clients who edited within the last 7d)

    Fires auto-insights at the end if ANTHROPIC_API_KEY is set."""
    token = (payload_in.get("token") or "").strip()
    submitted = payload_in.get("payload") or {}
    if not token:
        return {"ok": False, "error": "token required"}
    if not isinstance(submitted, dict):
        return {"ok": False, "error": "payload must be an object"}
    hit = _find_client_by_token(token)
    if hit is None:
        return {"ok": False, "error": "invalid_or_expired"}
    client_id, data = hit
    # No more "already_submitted" early-return — Path A allows re-submit.
    # Coach's explicit finalise action is what locks the form.
    is_finalised = bool(data.get("intake_finalised_at"))
    if is_finalised:
        return {"ok": False, "error": "intake_locked_by_coach"}
    return _apply_submit(client_id, data, submitted)


def _apply_submit(client_id: str, data: dict, submitted: dict) -> dict:
    """Core intake-promotion logic — merges a submitted payload into the
    real top-level client fields, marks the submit timestamps, clears the
    draft, writes the audit session, and fires auto-insights.

    Shared by two entry points:
      - action_submit      — client taps Submit on the public form (token-auth)
      - action_promote_draft — coach promotes a stranded intake_form_draft
                               for a client who filled but never submitted
                               (client_id-auth, no token needed)

    Both resolve (client_id, data) their own way, then hand the actual
    merge to this function so the two paths can never drift apart."""
    is_first_submit = not data.get("intake_submitted_at")

    fields_updated: list[str] = []

    # ── scalar fields ──
    for field in _SCALAR_FIELDS:
        if field in submitted:
            new_val = submitted.get(field)
            if isinstance(new_val, str):
                new_val = new_val.strip()
            if new_val:  # non-empty wins
                if data.get(field) != new_val:
                    data[field] = new_val
                    fields_updated.append(field)

    # ── date fields ── (store as ISO string; Pydantic Optional[date] will coerce on load)
    for field in _DATE_FIELDS:
        if field in submitted:
            v = (submitted.get(field) or "").strip() if isinstance(submitted.get(field), str) else None
            if v:
                data[field] = v
                fields_updated.append(field)

    # ── int fields ──
    for field in _INT_FIELDS:
        if field in submitted and submitted[field] not in (None, ""):
            try:
                v = int(submitted[field])
                data[field] = v
                fields_updated.append(field)
            except (TypeError, ValueError):
                pass

    # ── float fields (kg / measurements) ──
    for field in _FLOAT_FIELDS:
        if field in submitted and submitted[field] not in (None, ""):
            try:
                v = float(submitted[field])
                data[field] = v
                fields_updated.append(field)
            except (TypeError, ValueError):
                pass

    # ── list fields (additive merge — case-insensitive dedup) ──
    # D2 — active_conditions gets semantic dedup (token-sorted, parens
    # stripped, stopwords removed) so phrasing variants of the same
    # condition collapse. Other list fields keep strict case-insensitive
    # dedup (e.g. supplements where "vitamin D" vs "vitamin D3" matter).
    for field in _LIST_FIELDS:
        if field in submitted:
            merged, changed = _merge_lists(
                data.get(field),
                submitted.get(field),
                semantic_dedup=(field == "active_conditions"),
            )
            if changed:
                data[field] = merged
                fields_updated.append(field)

    # ── v0.72 chip-array fields (overwrite on submit — form is source of
    # truth for these, not additive like legacy condition lists). Form
    # submitting empty array clears the field; not submitting the field
    # leaves it alone. ──
    for field in _INTAKE_LIST_FIELDS:
        if field in submitted:
            incoming = submitted.get(field)
            if isinstance(incoming, list):
                cleaned = [str(x).strip() for x in incoming if str(x).strip()]
                if data.get(field) != cleaned:
                    data[field] = cleaned
                    fields_updated.append(field)

    # ── int-array fields (Bristol type 1-7 multi) ──
    for field in _INTAKE_INT_LIST_FIELDS:
        if field in submitted:
            incoming = submitted.get(field)
            if isinstance(incoming, list):
                cleaned: list[int] = []
                for x in incoming:
                    try:
                        n = int(x)
                        if 1 <= n <= 7:
                            cleaned.append(n)
                    except (TypeError, ValueError):
                        pass
                cleaned = sorted(set(cleaned))   # dedup + sort
                if data.get(field) != cleaned:
                    data[field] = cleaned
                    fields_updated.append(field)

    # ── repeater fields (medication category entries, contraception,
    # pregnancies). Form submits a list of dicts; we accept it verbatim
    # after light validation. Source of truth = form on submit. ──
    for field in _INTAKE_REPEATER_FIELDS:
        if field in submitted:
            incoming = submitted.get(field)
            if isinstance(incoming, list):
                # Filter out empty rows (no meaningful content). Each repeater
                # has its own "is this row blank?" heuristic, but a safe
                # generic: skip rows that are entirely empty/None values.
                cleaned_rows: list[dict] = []
                for row in incoming:
                    if not isinstance(row, dict):
                        continue
                    # Keep the row if any value is truthy / non-empty.
                    if any(v not in (None, "", [], {}) for v in row.values()):
                        cleaned_rows.append(row)
                if data.get(field) != cleaned_rows:
                    data[field] = cleaned_rows
                    fields_updated.append(field)

    # ── dosha self-assessment (lifelong-frame quiz → prakruti) ──
    # dict {quiz_key: "vata"|"pitta"|"kapha"}. Overwrite-on-submit. Validate
    # values; stamp completion time so the coach sees the quiz is done.
    if "dosha_self_assessment" in submitted:
        incoming_dosha = submitted.get("dosha_self_assessment")
        if isinstance(incoming_dosha, dict):
            cleaned = {
                str(k): str(v).lower()
                for k, v in incoming_dosha.items()
                if str(v).lower() in ("vata", "pitta", "kapha")
            }
            if cleaned and data.get("dosha_self_assessment") != cleaned:
                data["dosha_self_assessment"] = cleaned
                data["dosha_self_assessment_completed_at"] = _now_iso()
                fields_updated.append("dosha_self_assessment")
                # Auto-derive prakruti from tally and write to
                # ayurveda_constitution_read so the dashboard shows it.
                from collections import Counter
                tally = Counter(cleaned.values())
                total = sum(tally.values()) or 1
                ranked = tally.most_common()  # [(dosha, count), ...]
                top_pct = ranked[0][1] / total if ranked else 0
                second_pct = ranked[1][1] / total if len(ranked) > 1 else 0
                # Dual constitution if second dosha ≥ 25%; else single
                if len(ranked) >= 2 and second_pct >= 0.25:
                    label = f"{ranked[0][0].capitalize()}-{ranked[1][0].capitalize()}"
                elif ranked:
                    label = ranked[0][0].capitalize()
                else:
                    label = ""
                if label:
                    data["ayurveda_constitution_read"] = {
                        "prakruti_label": label,
                        "prakruti_confidence": "high",
                        "method": "dosha_quiz",
                        "derived_at": _now_iso(),
                        "tally": {d: round(n / total * 100) for d, n in tally.items()},
                    }
                    # Also update the top-level field coaches read in letters/plans
                    data["ayurveda_constitution"] = label
                    fields_updated.append("ayurveda_constitution_read")

    # ── timeline events (additive merge by event-text dedup) ──
    incoming_timeline = submitted.get("timeline_events") or []
    if isinstance(incoming_timeline, list) and incoming_timeline:
        existing_timeline = data.get("timeline_events") or []
        existing_keys = {(str(t.get("year") or ""), (t.get("event") or "").lower().strip())
                         for t in existing_timeline if isinstance(t, dict)}
        added = 0
        for ev in incoming_timeline:
            if not isinstance(ev, dict):
                continue
            text = (ev.get("event") or "").strip()
            if not text:
                continue
            key = (str(ev.get("year") or ""), text.lower())
            if key in existing_keys:
                continue
            existing_timeline.append({
                "year": ev.get("year"),
                "date": ev.get("date") or None,
                "event": text,
                "category": ev.get("category") or "life_event",
            })
            existing_keys.add(key)
            added += 1
        if added:
            data["timeline_events"] = existing_timeline
            fields_updated.append("timeline_events")

    # ── measurements (overwrite individual fields when provided) ──
    # The form sends body-comp as FLAT top-level fields (height_cm,
    # weight_now_kg, waist_cm, hip_cm, bp_systolic, …) with metric-OR-
    # imperial per row — NOT a nested `measurements` dict. Build the
    # canonical dict from those (imperial converted to metric). A nested
    # `measurements` dict, if any caller ever sends one, sits underneath
    # as a fallback.
    incoming_meas = {
        **(submitted.get("measurements") or {}),
        **_measurements_from_intake(submitted),
    }
    if isinstance(incoming_meas, dict) and incoming_meas:
        existing_meas = data.get("measurements") or {}
        meas_keys = ["height_cm", "weight_kg", "waist_cm", "hip_cm",
                     "blood_pressure_systolic", "blood_pressure_diastolic",
                     "resting_heart_rate"]
        meas_changed = False
        for k in meas_keys:
            v = incoming_meas.get(k)
            if v not in (None, "", 0):
                try:
                    existing_meas[k] = float(v) if "." in str(v) or k in ("height_cm", "weight_kg", "waist_cm", "hip_cm") else int(v)
                    meas_changed = True
                except (TypeError, ValueError):
                    pass
        if meas_changed:
            existing_meas["measured_on"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            existing_meas["notes"] = ((existing_meas.get("notes") or "") +
                                      " [auto-captured from client_intake_form]").strip()
            data["measurements"] = existing_meas
            fields_updated.append("measurements")

    # ── five pillars (overwrite if any non-null values) ──
    # Form uses friendlier short keys; the Pydantic FivePillarsAssessment
    # model uses verbose ones. Remap before writing so the client.yaml
    # round-trips through Client(**yaml) without ValidationError.
    _FP_KEY_MAP = {
        "stress": "stress_level",
        "movement_days": "movement_days_per_week",
    }
    _FP_ALLOWED = {
        "sleep_quality", "sleep_hours", "sleep_notes",
        "stress_level", "stress_type", "stress_notes",
        "movement_days_per_week", "movement_type", "movement_intensity",
        "nutrition_quality", "nutrition_notes",
        "connection_quality", "connection_notes",
        "notes",
    }
    incoming_fp = submitted.get("five_pillars") or {}
    if isinstance(incoming_fp, dict) and any(v not in (None, "") for v in incoming_fp.values()):
        remapped: dict = {}
        for k, v in incoming_fp.items():
            mapped = _FP_KEY_MAP.get(k, k)
            if mapped in _FP_ALLOWED:
                remapped[mapped] = v
        if remapped:
            data["five_pillars"] = remapped
            fields_updated.append("five_pillars")

    # ── profile photo (base64 JPEG in the submit payload) ──
    # Decode → clients/<id>/photo.jpg, the canonical coach-account photo. Set
    # photo_filename so the client-detail header (which gates on that field)
    # shows it; the list + analyse avatars already probe the file on disk.
    # Best-effort: a bad photo never blocks the submit. The base64 stays in the
    # raw payload (NOT copied onto client.yaml) so the Mac reconciler can decode
    # it into the authoritative store; we never persist the blob as a field.
    if submitted.get("client_photo_b64"):
        if _write_intake_profile_photo(client_id, submitted["client_photo_b64"]):
            if data.get("photo_filename") != "photo.jpg":
                data["photo_filename"] = "photo.jpg"
            fields_updated.append("client_photo")

    # ── auto-derive active_conditions from medications + goals ──
    # Clients often don't tick the conditions checkbox even when they're
    # on the literal medication. Union-merge so we never overwrite what
    # the client explicitly ticked.
    try:
        derived_conditions = _derive_conditions_from_intake(submitted)
        if derived_conditions:
            merged, changed = _merge_lists(data.get("active_conditions"), derived_conditions)
            if changed:
                data["active_conditions"] = merged
                if "active_conditions" not in fields_updated:
                    fields_updated.append("active_conditions")
                fields_updated.append(f"active_conditions_auto_derived: {derived_conditions}")
    except Exception as e:  # non-fatal — log on stderr, continue
        print(f"[intake-token-action] _derive_conditions_from_intake failed: {e}", file=sys.stderr)

    # ── mark submitted (Path A — KEEP token active for re-edits) ──
    now_iso = _now_iso()
    if is_first_submit:
        data["intake_submitted_at"] = now_iso
    data["intake_last_submitted_at"] = now_iso
    # intake_token stays — coach calls action_finalise to lock.
    data["intake_form_draft"] = None
    _save_client(client_id, data)

    # ── write audit session ──
    try:
        session_id = _write_quick_note_session(client_id, submitted)
    except Exception as e:  # non-fatal: client.yaml is the source of truth
        session_id = f"(failed to write session: {e})"

    # ── auto-fire AI insights generation (Haiku) — ONLY on the FIRST submit, or
    # if insights don't exist yet (recovery). Re-submits do NOT auto-regenerate:
    # per coach decision intake_insights regeneration is MANUAL (the 🔄 Refresh
    # button on IntakeInsightsCard). Intakes autosave + the token allows re-edits,
    # so firing on every submit paid for a Haiku call per re-submit that the coach
    # never asked for. Best-effort: failures logged on stderr; submit still ok. ──
    insights_status = "skipped (no api key)"
    should_fire_insights = is_first_submit or not data.get("intake_insights")
    if not should_fire_insights:
        insights_status = "skipped (re-submit; insights are manual after the first)"
    elif os.environ.get("ANTHROPIC_API_KEY"):
        try:
            result = subprocess.run(
                [sys.executable, str(SCRIPT_DIR / "generate-intake-insights.py")],
                input=json.dumps({"client_id": client_id}),
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
            if result.returncode == 0:
                insights_status = "ok"
            else:
                insights_status = f"err: {(result.stderr or 'no stderr')[:200]}"
                print(f"[intake-token-action] auto-insights failed: {insights_status}", file=sys.stderr)
        except Exception as e:
            insights_status = f"exc: {e}"
            print(f"[intake-token-action] auto-insights exception: {e}", file=sys.stderr)

    return {
        "ok": True,
        "client_id": client_id,
        "fields_updated": fields_updated,
        "session_id": session_id,
        "is_first_submit": is_first_submit,
        "insights_status": insights_status,
    }


# ── action: promote_draft (coach rescues a stranded intake draft) ────────────

def action_promote_draft(payload: dict) -> dict:
    """Coach-triggered: promote a stranded `intake_form_draft` into the real
    client fields by running the exact same merge as a client-side submit.

    Why this exists: the intake form auto-saves a draft as the client fills
    it, but the final Submit is a separate tap. A client who fills the whole
    form and then closes the tab (mistaking "Saved ✓" for "done") leaves all
    their answers invisible in `client.intake_form_draft` — no top-level
    fields, no intake session, dashboard panels misfire. This action lets the
    coach recover that data in one click.

    Resolves by client_id, NOT token: the coach is acting, so an expired
    intake token must not block recovery. Idempotent-ish — re-running after a
    successful promote is a no-op (draft was cleared)."""
    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "client_id required"}
    try:
        data = _load_client(client_id)
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}
    if data.get("intake_finalised_at"):
        return {"ok": False, "error": "intake_locked_by_coach"}
    draft = data.get("intake_form_draft")
    if not isinstance(draft, dict) or not draft:
        return {"ok": False, "error": "no_draft_to_promote"}
    result = _apply_submit(client_id, data, draft)
    if result.get("ok"):
        result["promoted_from_draft"] = True
    return result


# ── action: finalise (coach explicitly locks the intake) ─────────────────────

def action_finalise(payload: dict) -> dict:
    """Coach-triggered: lock the intake form. Clears intake_token so the
    client can no longer edit via the public link, and stamps
    intake_finalised_at. Idempotent — safe to call twice."""
    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "client_id required"}
    # Pull any last-second staging edits into the authoritative store before we
    # lock + purge, so finalising can never strand a final submission on Fly.
    # No-op when staging is disabled.
    try:
        _reconcile_one(client_id)
    except Exception as e:
        print(f"[intake-token-action] finalise reconcile failed for {client_id}: {e}", file=sys.stderr)
    try:
        data = _load_client(client_id)
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}
    if not data.get("intake_submitted_at"):
        return {"ok": False, "error": "cannot finalise — client has not submitted yet"}
    data["intake_token"] = None
    data["intake_token_expires_at"] = None
    data["intake_finalised_at"] = _now_iso()
    _save_client(client_id, data)
    # Form is locked — it no longer needs to exist on Fly. Mac-side delete;
    # Mutagen propagates the removal. No-op when staging is disabled.
    try:
        _purge_staging(client_id)
    except Exception as e:
        print(f"[intake-token-action] finalise purge failed for {client_id}: {e}", file=sys.stderr)
    return {"ok": True, "client_id": client_id, "intake_finalised_at": data["intake_finalised_at"]}


# ── action: reopen_finalised_intake (B9 fix 2026-05-23) ─────────────────────

def action_reopen_finalised_intake(payload: dict) -> dict:
    """Coach-triggered: undo a finalise so the intake form can be re-issued.

    The action_finalise path locks an intake (clears the token, stamps
    intake_finalised_at). There was no inverse — once locked, coach had
    no UI path to send the client a fresh editable link. The send-and-
    unlock panel said "open Coach exam and re-unlock" but that button
    never existed.

    This action clears intake_finalised_at so the coach-side gates
    (`!isFinalised`) reopen — the Send-pre-discovery / Skip-full-intake
    buttons then become visible again, and a new token can be minted.

    Idempotent — safe to call when already not finalised.
    """
    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "client_id required"}
    try:
        data = _load_client(client_id)
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}
    was_finalised = bool(data.get("intake_finalised_at"))
    data["intake_finalised_at"] = None
    _save_client(client_id, data)
    return {
        "ok": True,
        "client_id": client_id,
        "was_finalised": was_finalised,
    }


# ── action: unlock_full_intake (v0.75 — flip pre_discovery → full) ───────────

def action_unlock_full_intake(payload: dict) -> dict:
    """Coach-triggered: flip the intake form from pre-discovery to full.
    Typically called after the client signs up for the package — opens the
    deeper sections (FM body systems, ACE-lite, timeline, etc.) on the
    same intake URL. Also flips engagement_status to 'signed_up' as the
    canonical "they're in the programme" marker.

    Idempotent — safe to call twice. If the client has no intake_token yet,
    coach should generate one first (use action_generate).
    """
    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "client_id required"}
    try:
        data = _load_client(client_id)
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}
    now = _now_iso()
    if not data.get("intake_full_unlocked_at"):
        data["intake_full_unlocked_at"] = now
    data["engagement_status"] = "signed_up"
    _save_client(client_id, data)
    return {
        "ok": True,
        "client_id": client_id,
        "intake_full_unlocked_at": data["intake_full_unlocked_at"],
        "engagement_status": "signed_up",
    }


# ── action: mark_discovery_session_complete (v0.75 — journey marker) ─────────

def action_mark_discovery_session_complete(payload: dict) -> dict:
    """Coach marks that the discovery call has happened. Stamps
    discovery_session_completed_at. Pure visibility — no side effects on the
    intake form or engagement status."""
    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "client_id required"}
    try:
        data = _load_client(client_id)
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}
    if not data.get("discovery_session_completed_at"):
        data["discovery_session_completed_at"] = _now_iso()
    _save_client(client_id, data)
    return {"ok": True, "client_id": client_id, "discovery_session_completed_at": data["discovery_session_completed_at"]}


# ── action: mark_discovery_lab_pack_sent (v0.75 — journey marker) ────────────

def action_mark_discovery_lab_pack_sent(payload: dict) -> dict:
    """Coach marks that the discovery-promised lab recommendation has been
    delivered (WhatsApp, email, or in-app). Pure visibility — no side
    effects on the intake form or engagement status."""
    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "client_id required"}
    try:
        data = _load_client(client_id)
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}
    if not data.get("discovery_lab_pack_sent_at"):
        data["discovery_lab_pack_sent_at"] = _now_iso()
    _save_client(client_id, data)
    return {"ok": True, "client_id": client_id, "discovery_lab_pack_sent_at": data["discovery_lab_pack_sent_at"]}


# ── action: revoke ───────────────────────────────────────────────────────────

def action_revoke(payload: dict) -> dict:
    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "client_id required"}
    # Capture anything the client saved before we pull the link + purge.
    try:
        _reconcile_one(client_id)
    except Exception as e:
        print(f"[intake-token-action] revoke reconcile failed for {client_id}: {e}", file=sys.stderr)
    try:
        data = _load_client(client_id)
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}
    data["intake_token"] = None
    data["intake_token_expires_at"] = None
    _save_client(client_id, data)
    try:
        _purge_staging(client_id)
    except Exception as e:
        print(f"[intake-token-action] revoke purge failed for {client_id}: {e}", file=sys.stderr)
    return {"ok": True}


# ── action: reconcile_from_staging (single client) ───────────────────────────

def action_reconcile_from_staging(payload: dict) -> dict:
    """Reconcile ONE client's staging copy into the authoritative store, then
    purge the staging dir if the form is no longer live. Mac-side only."""
    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "client_id required"}
    if _staging_root() is None:
        return {"ok": True, "staging_disabled": True}
    r = _reconcile_one(client_id)
    purged = False
    try:
        adata = _load_client(client_id)
    except FileNotFoundError:
        adata = {}
    if _should_purge_staging(adata):
        purged = _purge_staging(client_id)
    return {"ok": True, "purged": purged, **r}


# ── action: reconcile_all (cron — every minute) ──────────────────────────────

def action_reconcile_all(payload: dict) -> dict:
    """Iterate every client in the staging tree: mirror drafts/submissions into
    the authoritative store, then sweep (purge) any whose form is finalised /
    revoked / expired. Driven by the per-minute cron. No-op when staging is
    disabled."""
    root = _staging_root()
    if root is None:
        return {"ok": True, "staging_disabled": True, "reconciled": [], "purged": []}
    clients_dir = root / "clients"
    if not clients_dir.exists():
        return {"ok": True, "reconciled": [], "purged": []}
    reconciled: list[dict] = []
    purged: list[str] = []
    errors: list[dict] = []
    for sub in sorted(clients_dir.iterdir()):
        if not sub.is_dir():
            continue
        cid = sub.name
        try:
            reconciled.append(_reconcile_one(cid))
            try:
                adata = _load_client(cid)
            except FileNotFoundError:
                adata = {}
            if _should_purge_staging(adata) and _purge_staging(cid):
                purged.append(cid)
        except Exception as e:
            errors.append({"client_id": cid, "error": f"{type(e).__name__}: {e}"})
    out = {"ok": True, "reconciled": reconciled, "purged": purged}
    if errors:
        out["errors"] = errors
    return out


# ── dispatcher ───────────────────────────────────────────────────────────────

ACTIONS = {
    "generate": action_generate,
    "lookup": action_lookup,
    "save_draft": action_save_draft,
    "submit": action_submit,
    "promote_draft": action_promote_draft,
    "finalise": action_finalise,
    "reopen_finalised_intake": action_reopen_finalised_intake,
    "revoke": action_revoke,
    # v0.75 — two-stage intake flow + discovery journey markers
    "unlock_full_intake": action_unlock_full_intake,
    "mark_discovery_session_complete": action_mark_discovery_session_complete,
    "mark_discovery_lab_pack_sent": action_mark_discovery_lab_pack_sent,
    # staging layer — scope Fly to active intakes (no-op until FMDB_STAGING_DIR set)
    "reconcile_from_staging": action_reconcile_from_staging,
    "reconcile_all": action_reconcile_all,
}


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2
    action = (payload.get("action") or "").strip()
    fn = ACTIONS.get(action)
    if fn is None:
        json.dump({"ok": False, "error": f"unknown action: {action!r}; expected one of {list(ACTIONS)}"}, sys.stdout)
        return 2
    try:
        out = fn(payload)
    except Exception as e:
        json.dump({"ok": False, "error": f"{type(e).__name__}: {e}"}, sys.stdout)
        return 1
    json.dump(out, sys.stdout)
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
