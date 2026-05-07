#!/usr/bin/env python3
"""Draft a warm WhatsApp follow-up message after a coaching session.

Reads JSON from stdin:
{
  "client_id": str,
  "session_id": str,
  "session_type": "check_in" | "full_assessment" | "quick_note" | "pre_intake",
  "dry_run": bool  (optional — returns mock message without API call)
}

Writes JSON to stdout:
{
  "ok": bool,
  "message": str | null,   # the drafted WhatsApp text
  "error": str | null
}
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

FMDB_ROOT = Path("/Users/shivani/code/healwithshivanih-ads/fm-database")
sys.path.insert(0, str(FMDB_ROOT))


def plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / "fm-plans"


def _load_env():
    """Load .env from fm-database root so ANTHROPIC_API_KEY is available."""
    env_path = FMDB_ROOT / ".env"
    if not env_path.exists():
        return
    try:
        from dotenv import load_dotenv
        load_dotenv(env_path, override=True)
    except ImportError:
        # Manual parse — strips `export ` prefix
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            line = line.removeprefix("export ").strip()
            if "=" in line:
                k, _, v = line.partition("=")
                v = v.strip().strip('"').strip("'")
                os.environ.setdefault(k.strip(), v)


def _load_session(root: Path, client_id: str, session_id: str) -> dict | None:
    """Load a session YAML file and return as dict."""
    try:
        import yaml
        session_path = root / "clients" / client_id / "sessions" / f"{session_id}.yaml"
        if not session_path.exists():
            return None
        with session_path.open() as f:
            return yaml.safe_load(f) or {}
    except Exception:
        return None


def _load_client(root: Path, client_id: str) -> dict | None:
    try:
        import yaml
        client_path = root / "clients" / client_id / "client.yaml"
        if not client_path.exists():
            return None
        with client_path.open() as f:
            return yaml.safe_load(f) or {}
    except Exception:
        return None


def _build_context(client: dict, session: dict, session_type: str) -> str:
    """Build a concise context block for the AI prompt."""
    parts: list[str] = []

    name = client.get("display_name") or client.get("client_id") or "the client"
    parts.append(f"Client: {name}")
    if client.get("active_conditions"):
        parts.append(f"Conditions: {', '.join(client['active_conditions'])}")
    if client.get("goals"):
        parts.append(f"Goals: {', '.join(client['goals'])}")

    parts.append(f"\nSession type: {session_type.replace('_', ' ')}")
    parts.append(f"Date: {session.get('date', 'today')}")

    complaints = session.get("presenting_complaints") or ""
    # Strip internal tags
    import re
    complaints = re.sub(r"^\[session_type:[^\]]+\]\s*", "", complaints, flags=re.I)
    complaints = re.sub(r"^\[source:[^\]]+\]\s*", "", complaints, flags=re.I)
    if complaints.strip():
        parts.append(f"\nSession notes:\n{complaints.strip()[:800]}")

    # Five pillars
    fp = session.get("five_pillars")
    if fp and isinstance(fp, dict):
        fp_parts: list[str] = []
        if fp.get("sleep_quality"): fp_parts.append(f"sleep quality {fp['sleep_quality']}/5")
        if fp.get("sleep_hours"):   fp_parts.append(f"{fp['sleep_hours']}h sleep")
        if fp.get("stress_level"):  fp_parts.append(f"stress {fp['stress_level']}/5")
        if fp.get("movement_days_per_week") is not None: fp_parts.append(f"movement {fp['movement_days_per_week']}d/wk")
        if fp.get("nutrition_quality"): fp_parts.append(f"nutrition {fp['nutrition_quality']}/5")
        if fp.get("connection_quality"): fp_parts.append(f"connection {fp['connection_quality']}/5")
        if fp_parts:
            parts.append(f"Five pillars: {' · '.join(fp_parts)}")

    coach_notes = session.get("coach_notes") or ""
    # Strip lab request line
    coach_notes = re.sub(r"\[Requested labs:[^\]]+\]", "", coach_notes).strip()
    if coach_notes:
        parts.append(f"\nCoach notes: {coach_notes[:400]}")

    # Active plan slug mentioned?
    plan_slug = session.get("generated_plan_slug")
    if plan_slug:
        parts.append(f"Plan generated: {plan_slug}")

    return "\n".join(parts)


def _draft_message(context: str, session_type: str, client_name: str) -> str:
    """Call Claude Haiku to draft the WhatsApp message."""
    _load_env()

    import anthropic
    client = anthropic.Anthropic()

    first_name = client_name.split()[0] if client_name else "there"
    type_label = session_type.replace("_", " ")

    system = (
        "You are Shivani Hari, a functional medicine health coach. "
        "Draft a warm, personal WhatsApp follow-up message to send after a coaching session. "
        "Guidelines:\n"
        "- Write as Shivani, first person (I/we)\n"
        "- Warm and encouraging, not clinical\n"
        "- 3-5 sentences max — short enough for WhatsApp\n"
        "- Acknowledge what was discussed today\n"
        "- Give 1-2 clear next steps or encouragements\n"
        "- End with an open door ('message me any time', 'reach out if anything comes up')\n"
        "- Use the client's first name once at the start\n"
        "- NO bullet points, NO headers — flowing natural message\n"
        "- DO NOT use emoji (the coach will add if she wants)\n"
        "- Speak in the tone of a caring, knowledgeable health mentor"
    )

    prompt = (
        f"Draft a WhatsApp follow-up message after a {type_label} with this client.\n\n"
        f"Context:\n{context}\n\n"
        f"Client's first name: {first_name}\n\n"
        "Write only the message text — no subject line, no greeting prefix, no quotes."
    )

    msg = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=300,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )

    return msg.content[0].text.strip()


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "message": None, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    client_id: str = payload.get("client_id") or ""
    session_id: str = payload.get("session_id") or ""
    session_type: str = payload.get("session_type") or "check_in"
    dry_run: bool = bool(payload.get("dry_run"))

    if not client_id or not session_id:
        json.dump({"ok": False, "message": None, "error": "client_id and session_id required"}, sys.stdout)
        return 2

    if dry_run:
        json.dump({
            "ok": True,
            "message": "Hi [Name]! It was so lovely checking in with you today. Keep up the great work with the supplements — your consistency is what will drive the change. Reach out any time if anything comes up. Looking forward to your next update!",
            "error": None,
        }, sys.stdout)
        return 0

    root = plans_root()
    client = _load_client(root, client_id)
    if not client:
        json.dump({"ok": False, "message": None, "error": f"client not found: {client_id}"}, sys.stdout)
        return 2

    session = _load_session(root, client_id, session_id)
    if not session:
        json.dump({"ok": False, "message": None, "error": f"session not found: {session_id}"}, sys.stdout)
        return 2

    client_name = client.get("display_name") or client.get("client_id") or "there"

    try:
        context = _build_context(client, session, session_type)
        message = _draft_message(context, session_type, client_name)
        json.dump({"ok": True, "message": message, "error": None}, sys.stdout)
        return 0
    except Exception as e:
        json.dump({"ok": False, "message": None, "error": str(e)[:300]}, sys.stdout)
        return 1


if __name__ == "__main__":
    sys.exit(main())
