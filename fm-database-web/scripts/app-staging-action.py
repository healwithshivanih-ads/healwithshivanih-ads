#!/usr/bin/env python3
"""Stage CLIENT-FACING plan artifacts into the Fly-synced staging tree.

Why: after the intake staging cutover (FMDB_PLANS_DIR=/data/fm-plans-staging
on Fly), the public machine no longer holds published plans, letters or
sessions — which broke every token-gated client surface on the public host:
/app/<letter_token>, /letter/<token>, /recipes/<slug>, /supplements/<slug>.

This shim extends the staging philosophy (only active clients, only the
minimum data) to the client app: when the coach shares an app/letter link,
the client's OWN client-facing artifacts are staged; a per-minute refresh
keeps them current and mirrors app check-ins back to the authoritative
store; revoking the plan purges them from Fly.

What gets staged per client (and nothing else):
  - published/<plan_slug>-v*.yaml  — SANITIZED: notes_for_coach +
    ai_sanity_check stripped (coach-private; no client surface reads them)
  - clients/<id>/client.yaml       — app-relevant keys merged over any
    existing intake stub (never clobbers a live intake_form_draft); includes a
    TRIMMED health_snapshots (date + lab_values + measurements only) for the
    lab vault + body charts, plus lab_reference_ranges
  - clients/<id>/meal-plans/<plan_slug>*  — letter .md/.html (+ recipes etc.)
  - clients/<id>/sessions/*        — only sessions carrying poll_response /
    checkin_response (the app's wellbeing trend), copy-if-missing
  - supplement_links.yaml          — buy links for /supplements
  - clients/<id>/_app_staged.yaml  — marker {plan_slug, staged_at}; intake
    purge keeps the dir alive when this exists

Actions (stdin JSON):
  {"action": "stage", "client_id": str, "plan_slug": str}
  {"action": "refresh"}        # re-stage all marked clients + reverse-mirror
                               # app check-ins; purge if plan unpublished
Output: {"ok": bool, ...counts, "error": str?}
NO-OP when FMDB_STAGING_DIR is unset.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / "fm-plans"


def _staging_root() -> "Path | None":
    env = os.environ.get("FMDB_STAGING_DIR")
    if not env:
        return None
    return Path(env).expanduser().resolve()


# client.yaml keys the client app's loader reads (superset of the intake
# stub keys so a merged file serves both surfaces).
_APP_CLIENT_KEYS = (
    "client_id",
    "display_name",
    "date_of_birth",
    "age_band",
    "sex",
    "email",
    "mobile_number",
    "city",
    "country",
    "intake_date",
    "next_contact_date",
    "active_conditions",
    "goals",
    "dietary_preference",
    "foods_to_avoid",
    "non_negotiables",
    "ayurveda_constitution",
    "ayurveda_assessment",
    "cycle_status",
    "pregnancy_status",
    "lactation_started",
    "app_token",
    "app_token_created_at",
    "lab_reference_ranges",
    # consult-tier ("discovery") app: tier + credit window + the Starting Map.
    # engagement_status drives the Fly tier resolver (signed_up → package);
    # discovery_call_date drives the 15-day upgrade-credit countdown;
    # discovery_summary is the client-facing orientation artifact (no protocol).
    "engagement_status",
    "discovery_call_date",
    "discovery_summary",
    # "one app link, intake inside": the discovery onboarding stage resolver reads
    # these. intake_token → the in-app "Start my intake" link (already a public Fly
    # credential — the intake form is a public Fly route); intake_submitted_at →
    # advances the stage past onboarding. Both non-PHI; the raw intake_form_draft is
    # still NOT projected. expires_at/short_code keep the staged intake link valid.
    "intake_token",
    "intake_token_expires_at",
    "intake_short_code",
    "intake_submitted_at",
    # app-read fields beyond the original intake-stub set (audited across
    # client-app.ts + recipes.ts on 2026-06-15 — these ARE consumed by the app)
    "known_allergies",
    "medical_history",
    "measurements",
    "ayurveda_enabled",
    "mindbody_eft",  # mind-body drip coach override: auto | unlocked | locked
    "mindbody_sleep",
    "plan_modules",  # gates app layers (e.g. schussler_salts tissue-salt section)
    # plan end-game (graduation → maintenance/grace/library). The app-mode
    # resolver (app-mode.ts) reads maintenance_status + maintenance_paid_through
    # to drive MAINTENANCE/GRACE/LIBRARY; back_on_track_plan is the self-serve
    # flare-reset card shown in the maintenance + library floors. Non-PHI.
    "maintenance_status",
    "maintenance_started_on",
    "maintenance_paid_through",
    "maintenance_term_months",
    "back_on_track_plan",
)

# Coach-only fields stripped from the plan before it reaches the public Fly box —
# never client-facing, and would otherwise serialise into the app's RSC payload.
_PLAN_PRIVATE_KEYS = ("notes_for_coach", "ai_sanity_check", "status_history", "catalogue_snapshot")


def _published_files(root: Path, plan_slug: str) -> list[Path]:
    d = root / "published"
    if not d.exists():
        return []
    return sorted(d.glob(f"{plan_slug}-v*.yaml"))


def _latest_published_slug_for(yaml, root: Path, client_id: str) -> str:
    """Highest-version published plan slug for a client, or "" if none. Lets a
    staged discovery client auto-upgrade to package staging the moment a plan
    ships, even if the publish path didn't explicitly re-stage them."""
    d = root / "published"
    if not d.exists():
        return ""
    best_slug, best_v = "", -1
    for p in sorted(d.glob("*-v*.yaml")):
        try:
            data = yaml.safe_load(p.read_text()) or {}
        except Exception:
            continue
        if data.get("client_id") != client_id:
            continue
        v = data.get("version")
        v = v if isinstance(v, int) else 0
        if v > best_v:
            best_v = v
            best_slug = str(data.get("slug") or p.stem.rsplit("-v", 1)[0])
    return best_slug


def _intake_active(d: dict) -> bool:
    """Is an intake / top-up in progress? True when a token exists AND hasn't
    expired. A finalized client whose single-use token was cleared (or whose
    top-up token has since expired) is NOT active, so its staged client.yaml gets
    minimised. Conservative on missing/unparseable expiry (treat as active)."""
    d = d or {}
    tok = str(d.get("intake_token") or "").strip()
    if not tok:
        return False
    exp = str(d.get("intake_token_expires_at") or "").strip()
    if not exp:
        return True
    try:
        dt = datetime.fromisoformat(exp.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt > datetime.now(timezone.utc)
    except Exception:
        return True


def _stage_one(yaml, auth: Path, stag: Path, client_id: str, plan_slug: str) -> dict:
    counts = {"plan_files": 0, "letters": 0, "sessions_staged": 0}

    # plan-less "discovery" (consult-tier) client: an app_token but no published
    # plan. Stage ONLY the trimmed client.yaml (app_token + discovery fields +
    # lab vault) — no published plan, no letters. plan_slug == "" signals this;
    # the app's loader resolves tier from engagement_status + plan presence.
    discovery = not plan_slug

    # 1. sanitized published plan(s) — package clients only
    if not discovery:
        plan_published = False
        (stag / "published").mkdir(parents=True, exist_ok=True)
        for p in _published_files(auth, plan_slug):
            d = yaml.safe_load(p.read_text()) or {}
            for k in _PLAN_PRIVATE_KEYS:
                d.pop(k, None)
            (stag / "published" / p.name).write_text(
                yaml.safe_dump(d, sort_keys=False, allow_unicode=True)
            )
            counts["plan_files"] += 1
            plan_published = True
        if not plan_published:
            return {"ok": False, "error": f"plan not published: {plan_slug}", **counts}
        # Purge sibling staged plans for this client from an earlier phase.
        # _refresh's purge below only fires for the marker's OWN plan_slug
        # going unpublished — a superseded slug's marker gets overwritten to
        # the new slug on re-stage, so the old file was never revisited and
        # lingered forever. A client should only ever have ONE staged
        # published plan; anything else here is a stale orphan (2026-07-02 —
        # cl-005 got stuck on a leftover superseded copy this way).
        for p in (stag / "published").glob("*-v*.yaml"):
            if p.name.startswith(f"{plan_slug}-v"):
                continue
            try:
                sib = yaml.safe_load(p.read_text()) or {}
            except Exception:
                continue
            if sib.get("client_id") == client_id:
                p.unlink(missing_ok=True)

    # 2. client.yaml — app keys merged over any existing staging stub
    auth_client = auth / "clients" / client_id / "client.yaml"
    if not auth_client.exists():
        return {"ok": False, "error": f"client not found: {client_id}", **counts}
    adata = yaml.safe_load(auth_client.read_text()) or {}
    sdir = stag / "clients" / client_id
    sdir.mkdir(parents=True, exist_ok=True)
    s_client = sdir / "client.yaml"
    existing = {}
    if s_client.exists():
        try:
            existing = yaml.safe_load(s_client.read_text()) or {}
        except Exception:
            existing = {}
    # PHI minimisation (2026-06-15): once intake is finished, rebuild the staged
    # client.yaml from ONLY the app-relevant allowlist (_APP_CLIENT_KEYS +
    # trimmed health_snapshots) — the raw intake submission (intake_form_draft +
    # the Tier-1 screening inventories, medication / reproductive / COVID history,
    # body-signs, etc.) is NOT projected to the public Fly box. While an intake or
    # top-up is in progress we keep the existing file intact so the public intake
    # form's live draft + prefill survive; the next refresh after submit minimises.
    intake_active = _intake_active(adata) or _intake_active(existing)
    merged = dict(existing) if intake_active else {}
    for k in _APP_CLIENT_KEYS:
        if k in adata:
            merged[k] = adata[k]
        elif intake_active:
            # key removed in authoritative (e.g. a coach reset a mind-body
            # override back to auto) → drop it from the preserved staged file too,
            # so removals propagate even while an intake/top-up is in progress.
            merged.pop(k, None)
    merged["client_id"] = client_id
    # Trimmed health snapshots — ONLY what the client app reads (the lab vault
    # + body-composition charts): each snapshot's date + lab_values +
    # measurements. Drops source / linked_session_id / medications / conditions
    # to keep the PHI footprint on the public Fly box minimal.
    snaps = adata.get("health_snapshots")
    if isinstance(snaps, list):
        trimmed_snaps = []
        for snap in snaps:
            if not isinstance(snap, dict):
                continue
            t = {}
            if snap.get("date") is not None:
                t["date"] = snap.get("date")
            if isinstance(snap.get("lab_values"), list):
                t["lab_values"] = snap.get("lab_values")
            if isinstance(snap.get("measurements"), dict):
                t["measurements"] = snap.get("measurements")
            if t.get("lab_values") or t.get("measurements"):
                trimmed_snaps.append(t)
        if trimmed_snaps:
            merged["health_snapshots"] = trimmed_snaps
        else:
            merged.pop("health_snapshots", None)
    else:
        merged.pop("health_snapshots", None)
    s_client.write_text(yaml.safe_dump(merged, sort_keys=False, allow_unicode=True))

    # 3. letters (md + html + sidecars) + the send log. The app trusts ONLY
    # letters recorded in _send_log.yaml, and sent letters sometimes carry a
    # successor plan slug — so stage the log plus every file matching the
    # published slug OR any slug that appears in the log.
    auth_mp = auth / "clients" / client_id / "meal-plans"
    # discovery clients have no plan_slug → an empty prefix would match EVERY
    # file; skip letters entirely for them (they have no plan/letters anyway).
    if not discovery and auth_mp.exists():
        smp = sdir / "meal-plans"
        smp.mkdir(parents=True, exist_ok=True)
        prefixes = {plan_slug}
        send_log = auth_mp / "_send_log.yaml"
        if send_log.exists():
            shutil.copy2(send_log, smp / "_send_log.yaml")
            try:
                for entry in yaml.safe_load(send_log.read_text()) or []:
                    s = (entry or {}).get("plan_slug")
                    if s:
                        prefixes.add(s)
            except Exception:
                pass
        for f in auth_mp.iterdir():
            if f.is_file() and any(f.name.startswith(p) for p in prefixes):
                shutil.copy2(f, smp / f.name)
                counts["letters"] += 1

    # 4. app-relevant sessions (wellbeing trend), copy-if-missing
    auth_sess = auth / "clients" / client_id / "sessions"
    if auth_sess.exists():
        ssess = sdir / "sessions"
        ssess.mkdir(parents=True, exist_ok=True)
        for f in sorted(auth_sess.glob("*.yaml")):
            dest = ssess / f.name
            if dest.exists():
                continue
            try:
                sdata = yaml.safe_load(f.read_text()) or {}
            except Exception:
                continue
            if sdata.get("poll_response") or sdata.get("checkin_response") or sdata.get("msq_response"):
                shutil.copy2(f, dest)
                counts["sessions_staged"] += 1

    # 5. buy links for /supplements
    links = auth / "supplement_links.yaml"
    if links.exists():
        shutil.copy2(links, stag / "supplement_links.yaml")

    # 5b. coach app-overrides (hidden remedy suggestions) — the app loader
    # filters from this, so Fly must carry it (added 2026-06-12)
    ov = auth / "clients" / client_id / "app-overrides.yaml"
    if ov.exists():
        shutil.copy2(ov, sdir / "app-overrides.yaml")

    # 5c. lab orders — the coach creates `recommended` orders on the Mac; the
    # client pays on Fly (the webhook flips them to `paid`, reverse-mirrored back
    # in _refresh). Forward-stage newest-wins: a coach edit propagates, but a Fly
    # `paid` status (already mirrored to auth before this runs in _refresh) is
    # preserved rather than clobbered back to `recommended`.
    auth_orders = auth / "clients" / client_id / "orders"
    if auth_orders.exists():
        sord = sdir / "orders"
        sord.mkdir(parents=True, exist_ok=True)
        for f in auth_orders.glob("*.yaml"):
            dest = sord / f.name
            try:
                if (not dest.exists()) or f.stat().st_mtime > dest.stat().st_mtime:
                    shutil.copy2(f, dest)
            except Exception:
                pass

    # 5d. maintenance payments (one-time orders + quarterly subscription records).
    # Created on Fly at pay/charge time; _refresh reverse-mirrors them to auth
    # before this runs. Forward-stage newest-wins keeps the staging copy consistent
    # (and propagates a coach-side comp) without clobbering a fresher Fly status.
    auth_maint = auth / "clients" / client_id / "maintenance"
    if auth_maint.exists():
        smnt = sdir / "maintenance"
        smnt.mkdir(parents=True, exist_ok=True)
        for f in auth_maint.glob("*.yaml"):
            dest = smnt / f.name
            try:
                if (not dest.exists()) or f.stat().st_mtime > dest.stat().st_mtime:
                    shutil.copy2(f, dest)
            except Exception:
                pass

    # 6. marker
    (sdir / "_app_staged.yaml").write_text(
        yaml.safe_dump(
            {"client_id": client_id, "plan_slug": plan_slug, "staged_at": datetime.now(timezone.utc).isoformat()},
            sort_keys=False,
        )
    )
    return {"ok": True, **counts}


def _refresh(yaml, auth: Path, stag: Path) -> dict:
    out = {"refreshed": 0, "checkins_mirrored": 0, "purged": 0, "errors": []}
    clients_dir = stag / "clients"
    if not clients_dir.exists():
        return {"ok": True, **out}
    for sdir in sorted(clients_dir.iterdir()):
        marker = sdir / "_app_staged.yaml"
        if not marker.exists():
            continue
        try:
            m = yaml.safe_load(marker.read_text()) or {}
        except Exception:
            continue
        client_id = m.get("client_id") or sdir.name
        plan_slug = m.get("plan_slug") or ""

        # reverse-mirror: app check-ins + MSQ submissions written on Fly →
        # authoritative store
        ssess = sdir / "sessions"
        auth_sess = auth / "clients" / client_id / "sessions"
        if ssess.exists() and (auth / "clients" / client_id).exists():
            auth_sess.mkdir(parents=True, exist_ok=True)
            for pattern in ("*-app-checkin.yaml", "*-app-msq.yaml", "*-app-travel.yaml"):
                for f in sorted(ssess.glob(pattern)):
                    dest = auth_sess / f.name
                    if not dest.exists():
                        shutil.copy2(f, dest)
                        out["checkins_mirrored"] += 1

        # reverse-mirror: lab orders updated on Fly (client paid → the webhook
        # flipped the order to `paid`) → authoritative store. Newest-wins by mtime
        # so a Fly status advance comes back. Runs BEFORE _stage_one re-stages, so
        # the Mac is current before it gets forward-staged again.
        sord = sdir / "orders"
        auth_ord = auth / "clients" / client_id / "orders"
        if sord.exists() and (auth / "clients" / client_id).exists():
            auth_ord.mkdir(parents=True, exist_ok=True)
            for f in sorted(sord.glob("*.yaml")):
                dest = auth_ord / f.name
                try:
                    if (not dest.exists()) or f.stat().st_mtime > dest.stat().st_mtime:
                        shutil.copy2(f, dest)
                        out["checkins_mirrored"] += 1
                except Exception as e:
                    out["errors"].append(f"{client_id} order-mirror: {e}")

        # reverse-mirror: maintenance payments written on Fly — both one-time
        # ORDERS (webhook flipped to paid) and quarterly SUBSCRIPTION charges
        # (subscription.charged set paid_through) → authoritative store, then
        # RECONCILE the latest window into client.yaml (the authoritative home of
        # maintenance_paid_through, which is one-way Mac→Fly). Newest-wins by mtime;
        # reconcile is idempotent (only advances the date forward). Unified rule:
        # a record's paid_through is non-null ⟺ a real payment landed, so we fold
        # in any record carrying a paid_through (pending/created records have null).
        smaint = sdir / "maintenance"
        auth_maint = auth / "clients" / client_id / "maintenance"
        auth_cdir = auth / "clients" / client_id
        if smaint.exists() and auth_cdir.exists():
            auth_maint.mkdir(parents=True, exist_ok=True)
            best_paid_through = None
            for f in sorted(smaint.glob("*.yaml")):
                dest = auth_maint / f.name
                try:
                    if (not dest.exists()) or f.stat().st_mtime > dest.stat().st_mtime:
                        shutil.copy2(f, dest)
                        out["checkins_mirrored"] += 1
                    # Fold paid_through from the STAGING source `f` (kept current with
                    # Fly = the payment write-origin), NOT the mtime-gated `dest` copy:
                    # if the copy was skipped (Mac mtime >= Fly mtime), reading dest
                    # would miss a fresh renewal and let coverage silently drift. Value
                    # is max-wins, so reading the freshest source is always correct.
                    rec = yaml.safe_load(f.read_text()) or {}
                    pt = rec.get("paid_through")
                    if isinstance(pt, str) and (best_paid_through is None or pt > best_paid_through):
                        best_paid_through = pt
                except Exception as e:
                    out["errors"].append(f"{client_id} maint-mirror: {e}")
            # fold the latest paid window into client.yaml (authoritative)
            cpath = auth_cdir / "client.yaml"
            if best_paid_through and cpath.exists():
                try:
                    cdoc = yaml.safe_load(cpath.read_text()) or {}
                    cur = cdoc.get("maintenance_paid_through")
                    if not isinstance(cur, str) or best_paid_through > cur:
                        cdoc["maintenance_paid_through"] = best_paid_through
                        cdoc["maintenance_status"] = "active"
                        if not cdoc.get("maintenance_started_on"):
                            from datetime import timedelta
                            cdoc["maintenance_started_on"] = (
                                datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
                            ).strftime("%Y-%m-%d")
                        cpath.write_text(yaml.safe_dump(cdoc, sort_keys=False, allow_unicode=True))
                        out["checkins_mirrored"] += 1
                except Exception as e:
                    out["errors"].append(f"{client_id} maint-reconcile: {e}")

        # reverse-mirror: app open timestamps (adoption tracking) — UNION
        # merge, never overwrite: Fly appends new opens between cron runs
        # while the authoritative copy holds the full history.
        s_opens = sdir / "_app_opens.yaml"
        a_opens = auth / "clients" / client_id / "_app_opens.yaml"
        if s_opens.exists() and (auth / "clients" / client_id).exists():
            try:
                fly_list = (yaml.safe_load(s_opens.read_text()) or {}).get("opens") or []
                auth_list = []
                if a_opens.exists():
                    auth_list = (yaml.safe_load(a_opens.read_text()) or {}).get("opens") or []
                merged = sorted(set(str(x) for x in auth_list) | set(str(x) for x in fly_list))[-2000:]
                if merged != auth_list:
                    a_opens.write_text(yaml.safe_dump({"opens": merged}, sort_keys=False))
            except Exception as e:
                out["errors"].append(f"{client_id} opens-merge: {e}")

        # reverse-mirror: push subscription (written on Fly when the client
        # toggles notifications on/off in settings) → authoritative store.
        # Fly is the sole writer; newest wins.
        s_push = sdir / "_push_subscription.yaml"
        a_push = auth / "clients" / client_id / "_push_subscription.yaml"
        if s_push.exists() and (auth / "clients" / client_id).exists():
            try:
                if (not a_push.exists()) or s_push.stat().st_mtime > a_push.stat().st_mtime:
                    shutil.copy2(s_push, a_push)
                    out["checkins_mirrored"] += 1
            except Exception as e:
                out["errors"].append(f"{client_id} push-mirror: {e}")

        # reverse-mirror: reminder preferences (written on Fly when the client
        # sets time-of-day reminders in settings) → authoritative store, where
        # the app-reminders cron reads them. Fly is the sole writer; newest
        # wins. NB: the cron's own _reminders_fired.yaml is Mac-only and is
        # deliberately NOT synced here — keeping fired-state off Fly prevents a
        # preference edit from clobbering it and causing a double-fire.
        s_rem = sdir / "_reminders.yaml"
        a_rem = auth / "clients" / client_id / "_reminders.yaml"
        if s_rem.exists() and (auth / "clients" / client_id).exists():
            try:
                if (not a_rem.exists()) or s_rem.stat().st_mtime > a_rem.stat().st_mtime:
                    shutil.copy2(s_rem, a_rem)
                    out["checkins_mirrored"] += 1
            except Exception as e:
                out["errors"].append(f"{client_id} reminders-mirror: {e}")

        # reverse-mirror: app-installed flag (written on Fly when the app runs
        # in standalone / home-screen mode → real adoption signal). Fly is the
        # sole writer (it preserves first_installed_at across confirmations);
        # newest wins, same as push.
        s_inst = sdir / "_app_installed.yaml"
        a_inst = auth / "clients" / client_id / "_app_installed.yaml"
        if s_inst.exists() and (auth / "clients" / client_id).exists():
            try:
                if (not a_inst.exists()) or s_inst.stat().st_mtime > a_inst.stat().st_mtime:
                    shutil.copy2(s_inst, a_inst)
                    out["checkins_mirrored"] += 1
            except Exception as e:
                out["errors"].append(f"{client_id} installed-mirror: {e}")

        # plan revoked / superseded → purge the app artifacts from Fly
        if plan_slug and not _published_files(auth, plan_slug):
            for p in (stag / "published").glob(f"{plan_slug}-v*.yaml"):
                p.unlink(missing_ok=True)
            shutil.rmtree(sdir / "meal-plans", ignore_errors=True)
            marker.unlink(missing_ok=True)
            out["purged"] += 1
            continue

        # discovery client (marker carries no plan) who now HAS a published plan
        # → upgrade the marker's plan so they re-stage as a full package client.
        # Their bookmarked /app link then flips from the discovery surface to the
        # full app in place. Belt-and-braces if the publish path didn't re-stage.
        if not plan_slug:
            upgraded = _latest_published_slug_for(yaml, auth, client_id)
            if upgraded:
                plan_slug = upgraded

        # otherwise re-stage so coach edits (doses, new letters, lab results, the
        # discovery summary) stay fresh — package (plan_slug set) OR discovery
        # (plan_slug ""). Wrapped so a single client's malformed / half-written
        # YAML (this cron runs every minute and can catch a plan or client.yaml
        # mid-save) can't raise out of _stage_one and abort the WHOLE refresh —
        # that silently freezes EVERY other client's app data on Fly until the
        # next clean run. Isolate per-client; surface the failure loudly.
        try:
            res = _stage_one(yaml, auth, stag, client_id, plan_slug)
        except Exception as e:
            out["errors"].append(f"{client_id}: stage failed (retry next run): {e}")
            continue
        if res.get("ok"):
            out["refreshed"] += 1
        else:
            out["errors"].append(f"{client_id}: {res.get('error')}")
    return {"ok": True, **out}


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    stag = _staging_root()
    if stag is None:
        json.dump({"ok": True, "staging_disabled": True}, sys.stdout)
        return 0
    try:
        import yaml  # type: ignore
    except ImportError as e:
        json.dump({"ok": False, "error": f"pyyaml: {e}"}, sys.stdout)
        return 1

    auth = _plans_root()
    action = payload.get("action") or ""
    if action == "stage":
        client_id = (payload.get("client_id") or "").strip()
        # plan_slug optional: "" stages a plan-less consult-tier ("discovery")
        # client (client.yaml + lab vault only).
        plan_slug = (payload.get("plan_slug") or "").strip()
        if not client_id:
            json.dump({"ok": False, "error": "client_id required"}, sys.stdout)
            return 2
        json.dump(_stage_one(yaml, auth, stag, client_id, plan_slug), sys.stdout)
        return 0
    if action == "refresh":
        json.dump(_refresh(yaml, auth, stag), sys.stdout)
        return 0
    json.dump({"ok": False, "error": f"unknown action: {action}"}, sys.stdout)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
