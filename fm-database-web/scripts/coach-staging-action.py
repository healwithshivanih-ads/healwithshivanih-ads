#!/usr/bin/env python3
"""Project a COACH-facing view of every person into the Fly-synced tree.

WHY THIS IS A SEPARATE SCRIPT FROM app-staging-action.py
--------------------------------------------------------
app-staging-action.py projects CLIENT-facing artifacts and is carefully
audited to STRIP coach-private material (notes_for_coach, ai_sanity_check).
This script projects the coach's own view — which is made of exactly the
material that one removes. Merging them would be one careless edit away from
leaking coach notes into a client's app. Different direction, different file,
different allowlist, different output tree.

WHAT THIS EXISTS FOR
--------------------
The coach mobile app (/m) runs on Fly so it works when the Mac is asleep. The
Mac is authoritative; this pushes a small read-model to Fly on a schedule.
Text for all 21 people is ~4 MB, so the whole thing is rewritten each run
rather than diffed.

TIER A+B (the coach's decision, 2026-08-02):
  A — identity, contacts, glance card, plan status
  B — latest-session SOAP material, session summaries, WhatsApp thread

NEVER PROJECTED — this is the line that keeps Tier B from becoming "the whole
record on a public box". Enforced by _assert_clean() on every write, not just
by the allowlist, so a future field added to a nested dict cannot ride along:
  notes_for_coach · ai_sanity_check · ai_analysis · chat_log ·
  intake_form_draft · api_usage · uploaded files

Actions (stdin JSON):
  {"action": "refresh"}                  # rebuild the whole projection
  {"action": "refresh", "dry_run": true} # report counts, write nothing
Output: {"ok": bool, "people": int, "bytes": int, "error": str?}

NO-OP when FMDB_COACH_DIR is unset.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path

import yaml

# ── Tier A: fields copied verbatim from client.yaml ────────────────────────
# Deliberately explicit. A field not listed here does not reach Fly, which is
# the same discipline _APP_CLIENT_KEYS uses for the client app.
_COACH_CLIENT_KEYS = (
    "client_id",
    "display_name",
    "sex",
    "date_of_birth",
    "age_band",
    "city",
    "country",
    "timezone",
    "mobile_number",
    "email",
    "intake_date",
    "next_contact_date",
    "engagement_status",
    "active_conditions",
    "medical_history",
    "known_allergies",
    # NOT in the client-app allowlist — the coach needs it on the glance card
    # (drug/supplement interactions), the client's own app never shows it.
    "current_medications",
    "goals",
    "dietary_preference",
    "foods_to_avoid",
    "non_negotiables",
)

# Any of these appearing anywhere in the output is a bug, not a style issue.
_FORBIDDEN_KEYS = frozenset(
    {
        "notes_for_coach",
        "ai_sanity_check",
        "ai_analysis",
        "chat_log",
        "intake_form_draft",
        "api_usage",
        "status_history",
        "catalogue_snapshot",
        "intake_insights",
    }
)

_MAX_SESSIONS = 12  # newest N; the phone never scrolls further back
_MAX_WA_MESSAGES = 40
# The KIND tag tells us what a session is.
_KIND_RE = re.compile(r"\[(?:source|session_type):\s*([a-z_]+)\]")
# Every OTHER bracketed tag is routing metadata written by the send pipeline
# ([plan: ...], [window: ...], [template: ...], [sent_at: ...], [supplement_order]).
# On a phone card that is a wall of machine text with the actual sentence
# buried in it, so it is stripped before the text is ever projected.
_META_RE = re.compile(r"\[[a-z_]+(?::[^\]]*)?\]\s*")
# Outbound sends are logged as quick notes. They are worth keeping — "what did
# I last send her" — but they are messages, not sessions, so they get their
# own kind rather than masquerading as clinical contact.
_OUTBOUND_HINT = re.compile(r"\btemplate:\s*fm_", re.I)


def _coach_dir() -> Path | None:
    env = os.environ.get("FMDB_COACH_DIR")
    return Path(env).expanduser().resolve() if env else None


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    return Path(env).expanduser().resolve() if env else Path.home() / "fm-plans"


def _jsonable(value):
    """YAML gives real date/datetime objects; JSON does not take them."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    return value


def _assert_clean(payload, where: str) -> None:
    """Refuse to write anything containing a coach-private key.

    Belt AND braces: the allowlist above already excludes these, but nested
    structures (a session, a plan) are copied wholesale in places, and this
    catches a field that arrives later inside one of them. Raises rather than
    filtering — a silent strip would hide the mistake.
    """
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key in _FORBIDDEN_KEYS:
                raise ValueError(f"coach-private key '{key}' would be staged at {where}")
            _assert_clean(value, f"{where}.{key}")
    elif isinstance(payload, list):
        for i, item in enumerate(payload):
            _assert_clean(item, f"{where}[{i}]")


def _read_yaml(path: Path) -> dict:
    try:
        return yaml.safe_load(path.read_text()) or {}
    except Exception:
        return {}


def _people(auth: Path) -> list[tuple[str, Path, str]]:
    """(id, dir, kind) for everyone — clients AND prospects.

    The client-app staging only covers people who were sent an app link. The
    coach's list must show everybody, or it isn't a contacts list.
    """
    out: list[tuple[str, Path, str]] = []
    for kind, sub in (("client", "clients"), ("prospect", "prospects")):
        base = auth / sub
        if not base.is_dir():
            continue
        for d in sorted(base.iterdir()):
            if d.is_dir() and (d / "client.yaml").exists():
                out.append((d.name, d, kind))
    return out


def _sessions(person_dir: Path) -> list[dict]:
    """Newest-first session summaries. Drops ai_analysis / chat_log entirely."""
    sdir = person_dir / "sessions"
    if not sdir.is_dir():
        return []
    rows = []
    for f in sorted(sdir.glob("*.yaml"), reverse=True)[:_MAX_SESSIONS]:
        s = _read_yaml(f)
        raw = (s.get("presenting_complaints") or "").strip()
        tag = _KIND_RE.search(raw)
        kind = tag.group(1) if tag else "session"
        if _OUTBOUND_HINT.search(raw):
            kind = "message sent"
        # Strip the kind tag, then every remaining routing tag, then collapse
        # the blank lines those left behind.
        text = _META_RE.sub("", _KIND_RE.sub("", raw)).strip()
        text = re.sub(r"\n{3,}", "\n\n", text)
        if not text:
            continue  # nothing left once the machine text went — not worth a card
        rows.append(
            {
                "id": s.get("session_id") or f.stem,
                "date": _jsonable(s.get("date")),
                "kind": kind,
                "complaints": text,
                "coach_notes": (s.get("coach_notes") or "").strip(),
                "symptoms": s.get("selected_symptoms") or [],
                "requested_labs": s.get("requested_labs") or [],
                "five_pillars": _jsonable(s.get("five_pillars")),
            }
        )
    return rows


def _whatsapp(sessions: list[dict]) -> dict:
    """Inbound WhatsApp, which lands in sessions tagged whatsapp_webhook."""
    msgs = []
    for s in sessions:
        if s["kind"] != "whatsapp_webhook":
            continue
        for line in s["complaints"].splitlines():
            line = line.strip()
            if line.startswith("Received:"):
                msgs.append({"at": s["date"], "text": line[len("Received:"):].strip()})
    return {"count": len(msgs), "messages": msgs[:_MAX_WA_MESSAGES]}


def _plan_for(person_id: str, plans: list[dict]) -> dict | None:
    mine = [p for p in plans if p.get("client_id") == person_id]
    if not mine:
        return None
    published = [p for p in mine if p.get("status") == "published"]
    p = (published or mine)[0]
    return {
        "slug": p.get("slug"),
        "status": p.get("status"),
        "period_start": _jsonable(p.get("plan_period_start")),
        "period_weeks": p.get("plan_period_weeks"),
        "meal_plan_started_on": _jsonable(p.get("meal_plan_started_on")),
        "supplement_count": len(p.get("supplement_protocol") or []),
        "practice_count": len(p.get("lifestyle_practices") or []),
    }


def _load_plans(auth: Path) -> list[dict]:
    out = []
    for bucket in ("published", "ready", "drafts"):
        d = auth / bucket
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.yaml")):
            p = _read_yaml(f)
            if p:
                # Strip coach-private plan keys at the source.
                for k in _FORBIDDEN_KEYS:
                    p.pop(k, None)
                p.setdefault("status", bucket.rstrip("s"))
                out.append(p)
    return out


def _card(person_id: str, person_dir: Path, kind: str, plans: list[dict]) -> dict:
    c = _read_yaml(person_dir / "client.yaml")
    glance = {k: _jsonable(c.get(k)) for k in _COACH_CLIENT_KEYS if c.get(k) is not None}
    sessions = _sessions(person_dir)
    return {
        "id": person_id,
        "kind": kind,
        "glance": glance,
        "plan": _plan_for(person_id, plans),
        "sessions": sessions,
        "whatsapp": _whatsapp(sessions),
        "staged_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }


def _index_row(card: dict) -> dict:
    g = card["glance"]
    latest = card["sessions"][0]["date"] if card["sessions"] else None
    return {
        "id": card["id"],
        "kind": card["kind"],
        "name": g.get("display_name") or card["id"],
        "mobile": g.get("mobile_number"),
        "email": g.get("email"),
        "engagement_status": g.get("engagement_status"),
        "next_contact_date": g.get("next_contact_date"),
        "last_session": latest,
        "plan_status": (card["plan"] or {}).get("status"),
        "conditions": (g.get("active_conditions") or [])[:3],
        # NOT an unread count — real read-state lives in
        # _whatsapp_inbox_state.yaml and is wired in a later step.
        "recent_whatsapp": card["whatsapp"]["count"],
    }


def _drain_outbox(auth: Path, out_dir: Path) -> int:
    """Merge notes written on the phone back into the authoritative store.

    The coach app runs on Fly, where the authoritative tree does not live. A
    note she types there is dropped into <FMDB_COACH_DIR>/_outbox/ and carried
    to the Mac by the existing fm-plans Mutagen session. This drains it.

    Direction matters: the projection is otherwise Mac → Fly, so this is the
    ONE reverse path. It mirrors what app-staging-action.py already does for
    client app check-ins.

    Failure mode is deliberately "leave it in the outbox": a note that cannot
    be written stays put and is retried next run, rather than being lost. The
    file is only unlinked after the session YAML is on disk.
    """
    box = out_dir / "_outbox"
    if not box.is_dir():
        return 0

    drained = 0
    for f in sorted(box.glob("*.json")):
        try:
            note = json.loads(f.read_text())
            person_id = str(note.get("client_id") or "")
            text = (note.get("text") or "").strip()
            if not person_id or not text or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,63}", person_id):
                f.unlink()  # unusable; nothing to retry
                continue

            person_dir = auth / "clients" / person_id
            if not person_dir.is_dir():
                person_dir = auth / "prospects" / person_id
            if not person_dir.is_dir():
                continue  # person not on this host yet — retry next run

            sdir = person_dir / "sessions"
            sdir.mkdir(parents=True, exist_ok=True)
            day = (note.get("created_at") or "")[:10] or date.today().isoformat()
            n = 1
            while (sdir / f"{person_id}-{day}-{n:03d}.yaml").exists():
                n += 1
            target = sdir / f"{person_id}-{day}-{n:03d}.yaml"

            yaml.safe_dump(
                {
                    "session_id": target.stem,
                    "client_id": person_id,
                    "date": day,
                    "created_at": note.get("created_at") or datetime.now().astimezone().isoformat(),
                    # Same tagging convention every other capture path uses, so
                    # existing readers classify it without changes.
                    "presenting_complaints": "[source: coach_mobile]\n" + text,
                    "coach_notes": "",
                    "selected_symptoms": [],
                    "selected_topics": [],
                    "uploaded_files": [],
                    "requested_labs": [],
                    "expected_reports": [],
                    "chat_log": [],
                    "ai_analysis": {},
                    "api_usage": {},
                },
                target.open("w"),
                sort_keys=False,
                allow_unicode=True,
            )
            f.unlink()
            drained += 1
        except Exception:
            # Keep the file; next run retries. Never lose a coach's note.
            continue
    return drained


def refresh(dry_run: bool = False) -> dict:
    out_dir = _coach_dir()
    if out_dir is None:
        return {"ok": True, "skipped": "FMDB_COACH_DIR unset", "people": 0, "bytes": 0}

    auth = _plans_root()
    # Drain BEFORE projecting, so a note written on the phone shows up in the
    # same run that carries it back rather than a cycle later.
    drained = 0 if dry_run else _drain_outbox(auth, out_dir)
    plans = _load_plans(auth)

    cards, index = [], []
    for person_id, person_dir, kind in _people(auth):
        card = _card(person_id, person_dir, kind, plans)
        _assert_clean(card, person_id)
        cards.append(card)
        index.append(_index_row(card))

    index.sort(key=lambda r: (r["name"] or "").lower())
    _assert_clean(index, "index")

    written = 0
    if not dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)
        for card in cards:
            p = out_dir / f"{card['id']}.json"
            body = json.dumps(card, ensure_ascii=False, indent=1)
            p.write_text(body)
            written += len(body)
        body = json.dumps(index, ensure_ascii=False, indent=1)
        (out_dir / "index.json").write_text(body)
        written += len(body)
        # Drop cards for people who no longer exist.
        keep = {f"{c['id']}.json" for c in cards} | {"index.json"}
        for stale in out_dir.glob("*.json"):
            if stale.name not in keep:
                stale.unlink()
    else:
        written = sum(len(json.dumps(c, ensure_ascii=False)) for c in cards)

    return {
        "ok": True,
        "people": len(cards),
        "bytes": written,
        "notes_drained": drained,
        "dry_run": dry_run,
    }


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"bad stdin: {exc}"}))
        return

    action = payload.get("action", "refresh")
    try:
        if action == "refresh":
            print(json.dumps(refresh(bool(payload.get("dry_run")))))
        else:
            print(json.dumps({"ok": False, "error": f"unknown action: {action}"}))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))


if __name__ == "__main__":
    main()
