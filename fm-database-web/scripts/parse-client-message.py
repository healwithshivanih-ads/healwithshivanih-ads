#!/usr/bin/env python3
"""Parse a client's WhatsApp/text message into structured clinical notes.

Reads JSON from stdin:
{
  "client_id": str,
  "message_text": str,
  "dry_run": bool   (optional)
}

Writes JSON to stdout:
{
  "ok": bool,
  "symptoms_improved": [str, ...],
  "symptoms_persisting": [str, ...],
  "symptoms_new": [str, ...],
  "adherence_notes": str | null,
  "questions": [str, ...],
  "mood_note": str | null,
  "protocol_flag": str | null,
  "quick_note_text": str,
  "error": str | null
}
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))

# Load .env so ANTHROPIC_API_KEY is available
try:
    from dotenv import load_dotenv
    load_dotenv(FMDB_ROOT / ".env", override=True)
except ImportError:
    env_path = FMDB_ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("export "):
                line = line[7:]
            if "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


DRY_RUN_RESPONSE = {
    "ok": True,
    "symptoms_improved": ["bloating", "energy levels"],
    "symptoms_persisting": ["constipation", "brain fog in afternoons"],
    "symptoms_new": ["occasional mild headaches"],
    "adherence_notes": "Taking all supplements except skipping morning walk most days",
    "questions": ["Can I take magnesium at dinner instead of bedtime?"],
    "mood_note": "Feeling more positive overall, less anxious",
    "protocol_flag": "Consider reviewing morning movement habit — consistent barrier",
    "quick_note_text": (
        "Client update (WhatsApp):\n"
        "✓ Improving: bloating, energy levels\n"
        "→ Persisting: constipation, afternoon brain fog\n"
        "⚠ New: occasional mild headaches\n"
        "Adherence: taking supplements; skipping morning walk\n"
        "Mood: more positive, less anxious\n"
        "Question: magnesium timing (dinner vs bedtime?)\n"
        "Flag: morning movement adherence barrier — worth discussing"
    ),
    "error": None,
}

SYSTEM_PROMPT = """You are a clinical assistant helping a functional medicine coach parse client messages.

Extract structured clinical information from the client's text. Be precise and concise.
Use simple phrases, not full sentences. Do not invent information not in the message.

Output a JSON object with these fields:
- symptoms_improved: list[str] — symptoms the client says are better (e.g. "bloating", "energy")
- symptoms_persisting: list[str] — symptoms still present or unchanged
- symptoms_new: list[str] — any new or worsening symptoms mentioned
- adherence_notes: str | null — what they are/aren't doing from their protocol (supplements, lifestyle)
- questions: list[str] — questions the client is asking
- mood_note: str | null — emotional/mental state if mentioned
- protocol_flag: str | null — anything that suggests a protocol adjustment may be needed
- quick_note_text: str — a clean formatted quick note (2-8 lines) for the coach's record.
  Format: start with "Client update (WhatsApp):", then bullet lines using:
  ✓ Improving: ...
  → Persisting: ...
  ⚠ New: ...
  Adherence: ...
  Mood: ...
  Question: ...
  Flag: ...
  Only include sections that have content.

Return ONLY valid JSON. No prose, no markdown."""


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON input: {e}"}, sys.stdout)
        return 2

    message_text = payload.get("message_text", "").strip()
    dry_run = payload.get("dry_run", False)

    if not message_text:
        json.dump({"ok": False, "error": "message_text is required"}, sys.stdout)
        return 2

    if dry_run:
        json.dump(DRY_RUN_RESPONSE, sys.stdout)
        return 0

    try:
        import anthropic
        from _api_guard import require_api_authorized  # cost guard C
        require_api_authorized("parse-client-message.py")
        client = anthropic.Anthropic()

        response = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": f"Parse this client message and return structured JSON:\n\n{message_text}",
                }
            ],
        )

        text = response.content[0].text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()

        result = json.loads(text)
        result["ok"] = True
        result.setdefault("error", None)
        json.dump(result, sys.stdout)
        return 0

    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"AI returned invalid JSON: {e}"}, sys.stdout)
        return 1
    except Exception as e:
        json.dump({"ok": False, "error": str(e)[:400]}, sys.stdout)
        return 1


if __name__ == "__main__":
    sys.exit(main())
