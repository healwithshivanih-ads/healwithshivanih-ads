#!/usr/bin/env python3
"""Guard against silent re-inflation of the assess API payload.

The assess synthesize() call is input-token dominated (~90% of cost). Two
regressions would quietly balloon it:
  1. Reverting the compact JSON serialization back to json.dumps(indent=2)
     — ~25% pure whitespace waste.
  2. Raising the subgraph entity caps (MAX_TOPICS / MAX_CLAIMS / …) so the
     per-selection subgraph grows.

This script fails (exit 1) if either happens, so cost can't creep unnoticed.
Run: fm-database/.venv/bin/python scripts/check-assess-payload-size.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fmdb.validator import load_all  # noqa: E402
from fmdb.assess.subgraph import build_subgraph  # noqa: E402

# Representative "rich" selection — a multi-driver client (Samaa-like). The
# subgraph is deterministic given (selection, catalogue), so this ceiling is a
# stable regression fence. ~101K tokens today; ceiling leaves headroom for
# catalogue growth but trips if the caps are loosened materially.
SELECTION_SYMPTOMS = ["fatigue", "weight-gain", "acne", "insomnia"]
SELECTION_TOPICS = ["insulin-resistance", "hashimotos-thyroiditis", "pcos"]
SUBGRAPH_TOKEN_CEILING = 130_000
CHARS_PER_TOKEN = 3.6  # rough English/JSON heuristic; only needs to be stable

failures: list[str] = []


def _tok(s: str) -> int:
    return int(len(s) / CHARS_PER_TOKEN)


# ── 1. subgraph size fence ────────────────────────────────────────────────
cat = load_all(ROOT / "data")
sg = build_subgraph(cat, symptom_slugs=SELECTION_SYMPTOMS, topic_slugs=SELECTION_TOPICS)
compact = json.dumps(sg, separators=(",", ":"), default=str)
pretty = json.dumps(sg, indent=2, default=str)
compact_tok = _tok(compact)
ws_waste = 1 - len(compact) / len(pretty)

print(f"subgraph compact ≈ {compact_tok:,} tokens (ceiling {SUBGRAPH_TOKEN_CEILING:,})")
print(f"indent=2 would add {ws_waste*100:.0f}% whitespace (why we use compact)")
if compact_tok > SUBGRAPH_TOKEN_CEILING:
    failures.append(
        f"subgraph grew to ~{compact_tok:,} tokens (> {SUBGRAPH_TOKEN_CEILING:,}). "
        "A cap in fmdb/assess/subgraph.py was likely loosened."
    )

# ── 2. compact-serialization fence on the real call sites ─────────────────
suggester = (ROOT / "fmdb/assess/suggester.py").read_text()
# Every json.dumps that serializes a big payload/context must use compact
# separators. Flag any indent= usage in this file (the AI-call payload builder).
for m in re.finditer(r"json\.dumps\([^)]*indent\s*=", suggester):
    ctx = suggester[max(0, m.start() - 40): m.start() + 60].replace("\n", " ")
    failures.append(f"suggester.py uses json.dumps(indent=…) — re-inflates the payload: …{ctx}…")

if not re.search(r'separators=\(",",\s*":"\)', suggester):
    failures.append("suggester.py no longer uses compact separators=(\",\",\":\") — check the payload dumps.")

# ── verdict ───────────────────────────────────────────────────────────────
if failures:
    print("\nFAIL — assess payload may have re-inflated:")
    for f in failures:
        print("  ✗", f)
    sys.exit(1)

print("\nOK — assess payload compact + within size budget.")
