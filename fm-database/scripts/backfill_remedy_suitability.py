#!/usr/bin/env python3
"""One-shot backfill of demographic suitability onto home_remedies (2026-06-10).

NO AI involved — the sex/stage classification below was hand-curated in
session by reading every flagged remedy's full indications list (the
"golden-milk problem": a remedy that merely LISTS perimenopause as one
indication among general ones stays unisex; only remedies whose PURPOSE
is sex/stage-specific get gated).

avoid_in is mechanical-conservative: pregnancy/lactation/children tagged
whenever the word appears in the free-text contraindications (verified:
no negated "safe in pregnancy" phrasing exists in the catalogue), except
remedies whose suitable_stages ARE that stage.

Only files that gain a non-default value are rewritten (yaml round-trip,
sort_keys=False — same precedent as apply-cleanup.py).

Run:  .venv/bin/python scripts/backfill_remedy_suitability.py [--dry-run]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
REMEDIES = ROOT / "data" / "home_remedies"

# ── hand-curated sex/stage gates (reviewed 2026-06-10) ──────────────────────

FEMALE_STAGED: dict[str, list[str]] = {
    # pregnancy-only
    "coconut-lemon-morning-sickness-drink": ["pregnancy"],
    "isabgol-warm-milk-pregnancy-constipation": ["pregnancy"],
    "punarnava-gokshura-pregnancy-edema-tea": ["pregnancy"],
    "rose-milk-morning-sickness": ["pregnancy"],
    # lactation / postpartum
    "shatavari-kalpa-lactation-tonic": ["lactation"],
    # menstruating (incl. perimenopausal cycles)
    "aloe-vera-menstrual-prep": ["menstruating", "perimenopausal"],
    "raspberry-hibiscus-heavy-flow-tea": ["menstruating", "perimenopausal"],
    "roasted-cumin-aloe-menstrual-remedy": ["menstruating", "perimenopausal"],
    # cyclic breast tenderness + mastitis prevention while breastfeeding
    "castor-oil-breast-massage": ["menstruating", "perimenopausal", "lactation"],
    # menopause transition
    "pomegranate-lime-hot-flash-drink": ["perimenopausal", "postmenopausal"],
    "shatavari-vidari-menopause-churan": ["perimenopausal", "postmenopausal"],
}
FEMALE_ANY: list[str] = [
    "shatavari-vidari-libido-tonic",   # "low libido in women" — every indication female
]
MALE_ANY: list[str] = [
    "hibiscus-horsetail-prostate-tea",  # all indications BPH/prostatitis
]

PREG_RE = re.compile(r"pregnan", re.I)
LACT_RE = re.compile(r"lactation|breastfeed|breast-feed|nursing mother", re.I)
CHILD_RE = re.compile(r"\bchild(?:ren)?\b|\binfant", re.I)


def main() -> int:
    dry = "--dry-run" in sys.argv
    changed = 0
    summary: dict[str, int] = {"female": 0, "male": 0, "avoid_pregnancy": 0, "avoid_lactation": 0, "avoid_children": 0}
    for path in sorted(REMEDIES.glob("*.yaml")):
        d = yaml.safe_load(path.read_text())
        slug = d.get("slug") or path.stem
        patch: dict = {}

        if slug in FEMALE_STAGED:
            patch["suitable_sex"] = "female"
            patch["suitable_stages"] = FEMALE_STAGED[slug]
            summary["female"] += 1
        elif slug in FEMALE_ANY:
            patch["suitable_sex"] = "female"
            summary["female"] += 1
        elif slug in MALE_ANY:
            patch["suitable_sex"] = "male"
            summary["male"] += 1

        stages = set(patch.get("suitable_stages") or [])
        contras = " | ".join(d.get("contraindications") or [])
        avoid: list[str] = []
        if PREG_RE.search(contras) and "pregnancy" not in stages:
            avoid.append("pregnancy")
            summary["avoid_pregnancy"] += 1
        if LACT_RE.search(contras) and "lactation" not in stages:
            avoid.append("lactation")
            summary["avoid_lactation"] += 1
        if CHILD_RE.search(contras):
            avoid.append("children")
            summary["avoid_children"] += 1
        if avoid:
            patch["avoid_in"] = avoid

        if not patch:
            continue
        changed += 1
        if dry:
            print(f"{slug}: {patch}")
            continue
        # insert after aggravates_dosha to keep the demographic block together
        keys = list(d.keys())
        anchor = "aggravates_dosha" if "aggravates_dosha" in keys else "balances_dosha"
        out: dict = {}
        for k in keys:
            out[k] = d[k]
            if k == anchor:
                for pk, pv in patch.items():
                    out[pk] = pv
        if anchor not in keys:
            out.update(patch)
        path.write_text(yaml.safe_dump(out, sort_keys=False, allow_unicode=True, width=88))

    print(f"\n{'DRY RUN — ' if dry else ''}{changed} files patched | {summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
