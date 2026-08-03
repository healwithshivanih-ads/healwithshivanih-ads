#!/usr/bin/env python3
"""Audit — and recover — allergy answers that never reached the live record.

Two jobs, both read-only unless --apply is passed.

1. RECOVER stranded intake answers. A client who typed an allergy into the
   intake form has that answer preserved verbatim in the audit session
   (`sessions/<date>-NNN-intake-form.yaml` → `ai_analysis.raw_intake_payload`),
   even when it never landed on `client.yaml`. Measured 2026-08-03: cl-017
   answered "slight intolerance towards milk not milk products" on 2026-06-15
   and the live field is empty — the reconcile coach-edit guard now returns
   `skipped_coach_newer` (coach `updated_at` Jul 29 > submission Jun 15), so
   re-running reconcile can never recover it. This does.

2. FLAG prose that reads like an allergy — and stops there.
   `foods_to_avoid` is where the coach actually records exclusions, but it
   mixes registers: "Onion, Garlic" is a Jain preference, "Brinjal, Rice,
   Wheat" is a protocol phase, "Brinjal (used to get itchy tongue as a kid)"
   is an oral allergy. Promoting these automatically would invent clinical
   facts and turn `author_gate`'s HARD allergen block into noise, so
   candidates are printed for the coach to confirm and NEVER written.

Usage:
    python3 audit-allergy-capture.py             # report only
    python3 audit-allergy-capture.py --apply     # write recovered answers (1) only
"""
from __future__ import annotations

import argparse
import glob
import os
import re
import sys
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
PLANS_ROOT = Path(os.environ.get("FMDB_PLANS_DIR") or (Path.home() / "fm-plans"))
sys.path.insert(0, str(FMDB_ROOT))

import yaml  # noqa: E402

from fmdb.plan.allergies import resolve_allergies  # noqa: E402

# Words that mark a described reaction as ALLERGIC rather than a dislike or a
# protocol exclusion. Deliberately narrow: this list decides only what gets
# shown to the coach, and a long list would bury the real ones.
# ── coach-confirmed promotions ───────────────────────────────────────────────
# Prose the coach reviewed on 2026-08-03 and confirmed as allergy-tier, with
# the wording SHE would use. Written only under --write-confirmed, and only
# onto a client who is still `unknown`, so re-running can never overwrite a
# later answer.
#
# Deliberately a hand-written table, not derived. The whole argument for
# keeping allergies separate from `foods_to_avoid` is that severity cannot be
# read off prose mechanically — so the promotion step is a human decision with
# a name and a date on it, and the script only carries it out.
#
# Each entry keeps the allergen noun FIRST (that is what `author_gate`
# tokenises and scans supplement names for) and the evidence in parentheses.
# The surrounding prose stays in `foods_to_avoid` / `reported_triggers`
# untouched — this adds a severity signal, it does not move the record.
_CONFIRMED_PROMOTIONS: dict[str, list[str]] = {
    # "Brinjal (used to get itchy tongue as a kid)" — oral allergy syndrome.
    "cl-019": ["Brinjal (itchy tongue since childhood)"],
    # "Gluten constipation, dairy allergies acne" — names dairy as an allergy.
    # Gluten is recorded as an intolerance/trigger, not promoted here.
    "cl-018": ["Dairy (reported as an allergy — acne flare)"],
    # "Skin itching flared after ragi dosa breakfast on 2026-05-14 … confirmed
    # histamine bucket overflow on top of baseline Allegra/eczema." Already
    # carried in foods_to_avoid as "a confirmed clinical trigger".
    "cl-006": ["Ragi / finger millet (confirmed skin-itching flare, 2026-05-14)"],
}

_ALLERGY_MARKERS = (
    "allerg",           # "dairy allergies acne"
    "itchy",            # "used to get itchy tongue as a kid"
    "itching",
    "hives",
    "urticaria",
    "anaphyla",
    "swelling",
    "rash",
    "wheez",
    "throat clos",
    "intoleran",        # weaker, but the coach should still see it
)


def _person_dirs() -> list[Path]:
    out: list[Path] = []
    for base in ("clients", "prospects"):
        d = PLANS_ROOT / base
        if d.is_dir():
            out += [p for p in sorted(d.iterdir()) if (p / "client.yaml").is_file()]
    return out


def _load(p: Path) -> dict:
    with (p / "client.yaml").open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _stranded_intake_answer(person: Path) -> list[str]:
    """Allergies the client typed into the intake form, newest submission first.

    Returns [] when there is no submission or the client left it blank.
    """
    files = sorted(glob.glob(str(person / "sessions" / "*-intake-form.yaml")))
    for fp in reversed(files):
        try:
            with open(fp, "r", encoding="utf-8") as f:
                sdata = yaml.safe_load(f) or {}
        except Exception:
            continue
        payload = (sdata.get("ai_analysis") or {}).get("raw_intake_payload") or {}
        if not isinstance(payload, dict):
            continue
        vals = payload.get("known_allergies")
        if isinstance(vals, list):
            cleaned = [str(v).strip() for v in vals if str(v).strip()]
            if cleaned:
                return cleaned
    return []


def _prose_candidates(data: dict) -> list[tuple[str, str]]:
    """(field, sentence) pairs whose wording describes an allergic reaction."""
    hits: list[tuple[str, str]] = []
    for field in ("foods_to_avoid", "reported_triggers"):
        raw = str(data.get(field) or "").strip()
        if not raw:
            continue
        for sentence in re.split(r"[;.\n]", raw):
            s = sentence.strip()
            if not s or not any(m in s.lower() for m in _ALLERGY_MARKERS):
                continue
            # Skip bulk exclusion lists. cl-006's "SOVA FOOD INTOLERANCE — RED
            # list: <40 foods>" matches on "intoleran" but is a protocol phase,
            # not an allergy — and printing it buries the one-line hits that
            # actually need a decision.
            if s.count(",") > 8:
                continue
            hits.append((field, s))
    return hits


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="write recovered intake answers onto client.yaml")
    ap.add_argument("--write-confirmed", action="store_true",
                    help="also write the coach-confirmed prose promotions above")
    args = ap.parse_args()

    recovered: list[str] = []
    promoted: list[str] = []
    candidates: list[str] = []
    unscreened: list[str] = []

    def _save(person: Path, data: dict) -> None:
        with (person / "client.yaml").open("w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)

    for person in _person_dirs():
        cid = person.name
        data = _load(person)
        status, items = resolve_allergies(data)

        # ── 1. recover a stranded intake answer ──
        if status == "unknown":
            stranded = _stranded_intake_answer(person)
            if stranded:
                recovered.append(f"{cid}: {stranded}")
                if args.apply:
                    data["known_allergies"] = stranded
                    _save(person, data)
                continue    # no longer unscreened

        # ── 2. apply a coach-confirmed promotion ──
        # Guarded on `unknown`: a client who has since been screened properly
        # keeps their own answer, so this is safe to re-run.
        if status == "unknown" and cid in _CONFIRMED_PROMOTIONS:
            entries = _CONFIRMED_PROMOTIONS[cid]
            promoted.append(f"{cid}: {entries}")
            if args.write_confirmed:
                data["known_allergies"] = entries
                _save(person, data)
            continue

        if status == "unknown":
            unscreened.append(cid)

        # ── 3. flag remaining prose (never written) ──
        for field, sentence in _prose_candidates(data):
            candidates.append(f"{cid}  [{field}]  {sentence}   (currently: {status})")

    verb = "WROTE" if args.apply else "RECOVERABLE"
    print(f"{verb} — stranded intake answers ({len(recovered)}):")
    for r in recovered or ["  (none)"]:
        print(f"  {r}")

    verb = "WROTE" if args.write_confirmed else "PENDING"
    print(f"\n{verb} — coach-confirmed prose promotions ({len(promoted)}):")
    for p_ in promoted or ["  (none)"]:
        print(f"  {p_}")

    print(f"\nPROSE CANDIDATES — coach confirms, script never writes ({len(candidates)}):")
    for c in candidates or ["  (none)"]:
        print(f"  {c}")

    print(f"\nSTILL UNSCREENED ({len(unscreened)}):")
    print("  " + (", ".join(unscreened) or "(none)"))

    if not args.apply and recovered:
        print("\nRe-run with --apply to write the recovered answers.")
    if not args.write_confirmed and promoted:
        print("Re-run with --write-confirmed to write the confirmed promotions.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
