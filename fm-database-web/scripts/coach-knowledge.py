#!/usr/bin/env python3
"""Coach knowledge shim — stage a short clinical observation into the catalogue.

Reads JSON from stdin:
  { "text": str }

Writes JSON to stdout:
  { "ok": bool, "batch_id": str | null, "stdout": str, "stderr": str, "error": str | null }

Internally:
  1. Writes the coach's text to a temp markdown file.
  2. Calls `fmdb ingest` with source-id=coach-shivani, source-type=expert_consensus,
     source-quality=moderate, and a specialised instruction prompt.
  3. Returns the batch_id so the Next.js UI can display BatchPanel for review/approve.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))
PYTHON = str(FMDB_ROOT / ".venv" / "bin" / "python")

SOURCE_ID = "coach-shivani"
SOURCE_TITLE = "Coach Shivani — Clinical Observations & Practice Notes"
SOURCE_TYPE = "expert_consensus"
SOURCE_QUALITY = "moderate"

# Specialised extraction instructions — tells the LLM what to do with a
# short, free-form clinical observation rather than a long document.
INSTRUCTIONS = """This is a SHORT CLINICAL OBSERVATION from a functional medicine coach, not a long document.

Your job: extract whatever catalogue entities are implied by the observation.

PRIORITY ORDER:
1. If the observation is a CLINICAL TIP or PROTOCOL NOTE about a specific
   entity that almost certainly already exists in the catalogue
   (e.g. "In cases of unexplained hair loss, check for H.Pylori"):
   - Emit a CLAIM whose `statement` captures the clinical rule
     (e.g. "Unexplained hair loss may be associated with H. pylori infection")
   - Set `coaching_translation` to the actionable coach phrasing
   - Set `notes_for_coach` to the exact wording of the original observation
   - Link `linked_to_topics` to the relevant topic slug(s) — infer from context
   - Evidence tier: `fm_specific_thin` unless the observation references a study

2. If the observation mentions a NEW symptom, mechanism, topic, or supplement
   not yet likely in the catalogue, emit the appropriate entity type.

3. If the observation contains a PRACTICAL PREPARATION TIP (e.g. "soak methi
   seeds overnight, drink the water first thing"):
   - Put the tip in `notes_for_coach` on the most relevant supplement or topic
   - Also emit a Claim capturing the benefit (e.g. "Soaking fenugreek seeds
     overnight and consuming the soaking water on an empty stomach may support
     blood sugar regulation")

SLUG RULES: lowercase, hyphenated ASCII. Claim slugs should read like short
assertions (e.g. `hair-loss-check-h-pylori`, `fenugreek-overnight-soak-blood-sugar`).

Emit ONLY what the observation clearly implies. Prefer 1-3 high-quality entities
over many speculative ones. It is fine to return zero entities of some types."""


def run_cli(*args: str) -> tuple[str, str, int]:
    env = os.environ.copy()
    env.setdefault("FMDB_EXTRACTOR", "anthropic")
    result = subprocess.run(
        [PYTHON, "-m", "fmdb.cli"] + list(args),
        capture_output=True, text=True, cwd=str(FMDB_ROOT), env=env,
    )
    return result.stdout, result.stderr, result.returncode


def emit(payload: dict) -> int:
    json.dump(payload, sys.stdout, default=str)
    return 0 if payload.get("ok") else 1


def main() -> int:
    raw = sys.stdin.read().strip()
    try:
        inp = json.loads(raw) if raw else {}
    except json.JSONDecodeError as e:
        return emit({"ok": False, "error": f"JSON parse: {e}"})

    text = (inp.get("text") or "").strip()
    if not text:
        return emit({"ok": False, "error": "text is required"})

    # Write to temp markdown file — fmdb ingest expects a file path
    with tempfile.NamedTemporaryFile(
        suffix=".md",
        delete=False,
        mode="w",
        encoding="utf-8",
    ) as f:
        tmp_path = f.name
        f.write(f"# Coach Observation\n\n{text}\n")

    try:
        stdout, stderr, code = run_cli(
            "ingest", tmp_path,
            "--source-id", SOURCE_ID,
            "--source-title", SOURCE_TITLE,
            "--source-type", SOURCE_TYPE,
            "--source-quality", SOURCE_QUALITY,
            "--instructions", INSTRUCTIONS,
        )
    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except Exception:
            pass

    # Parse batch_id from stdout (format: "Staged batch <id>\n...")
    batch_id = None
    for line in stdout.splitlines():
        if "batch" in line.lower():
            parts = line.split()
            if parts:
                batch_id = parts[-1]
                break

    return emit({
        "ok": code == 0,
        "batch_id": batch_id,
        "stdout": stdout,
        "stderr": stderr,
        "error": stderr.strip() if code != 0 else None,
    })


if __name__ == "__main__":
    sys.exit(main())
