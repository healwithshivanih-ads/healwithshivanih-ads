#!/usr/bin/env python3
"""Deterministically add a default household portion to any menu component
that still lacks one. No API — a rule-based fallback for when the AI backfill
can't run (workspace usage cap) or to fill the gaps it left.

A component is "bare" if it has no leading number, no "(qty)" bracket, and no
size word (small/large bowl/cup). Each bare component gets a sensible default
by food type. Touches plan.app_menu + plan.app_menu_pending.

Usage: fill-menu-portions.py [--plan <file>]... [--dry-run]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
from pathlib import Path

PLANS_DIR = Path(os.environ.get("FMDB_PLANS_DIR") or (Path.home() / "fm-plans")) / "published"

# food keyword → default single-serving portion
RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\b(roti|bhakri|bhakhri|phulka|chapati|paratha|thepla|dosa|chilla|cheela|idli|uttapam|appam|puri)\b", re.I), "(2)"),
    (re.compile(r"\b(rice|pulao|pulav|biryani|khichdi|khichri|upma|poha|pongal|dalia|oats|porridge)\b", re.I), "(1 bowl)"),
    (re.compile(r"\b(dal|daal|sambar|sambhar|rasam|kadhi|rajma|chole|chana|stew|soup|curry|sabzi|subzi|sabji|bhaji|paneer|tofu|usal|chaat)\b", re.I), "(1 bowl)"),
    (re.compile(r"\b(chutney|raita|pickle|achar|podi|thecha|salsa|dip)\b", re.I), "(2 tbsp)"),
    (re.compile(r"\b(chaas|buttermilk|lassi|milk|tea|chai|kashayam|kadha|sherbet|juice|coffee|smoothie|water|kanji)\b", re.I), "(1 cup)"),
    (re.compile(r"\b(makhana|chikki|ladoo|laddu|murmura|chivda|sev)\b", re.I), "(small bowl)"),
    (re.compile(r"\b(nuts?|almonds?|walnuts?|cashews?|seeds?|pista|peanuts?)\b", re.I), "(small handful)"),
    (re.compile(r"\b(kiwi|apple|banana|orange|guava|pear|papaya|pomegranate|fruit)\b", re.I), "(1)"),
    (re.compile(r"\b(salad|sprouts?|cucumber|carrot|tomato|raw veg|greens?|spinach|palak)\b", re.I), "(1 bowl)"),
    (re.compile(r"\b(egg|omelette|omelet|bhurji|scramble)\b", re.I), "(2)"),
    (re.compile(r"\b(curd|dahi|yogurt|yoghurt)\b", re.I), "(small bowl)"),
    (re.compile(r"\b(ghee|oil|butter|honey)\b", re.I), "(1 tsp)"),
]
# things that are seasonings / already-implicit — never get a portion
SKIP = re.compile(r"\b(rock salt|black salt|sendha|to taste|pinch|lemon|lime|ginger|turmeric|haldi|tempering|tadka|garnish|cinnamon|prebiotic|probiotic|supplement|capsule|tablet)\b", re.I)


def _has_qty(comp: str) -> bool:
    c = comp.strip()
    if "(" in c:
        return True
    if re.match(r"^\s*[\d½¼¾⅓⅔]", c):
        return True
    if re.search(r"\b(small|large|big|little|half|quarter)\b.*\b(bowl|cup|glass|katori|handful|piece)\b", c, re.I):
        return True
    return False


def _fill(dish: str) -> str:
    parts = [p.strip() for p in dish.split("+")]
    out = []
    for p in parts:
        if not p or _has_qty(p) or SKIP.search(p):
            out.append(p)
            continue
        portion = next((q for rx, q in RULES if rx.search(p)), "(1 serving)")
        out.append(f"{p} {portion}")
    return " + ".join(x for x in out if x)


def _walk(plan: dict) -> int:
    n = 0
    am = plan.get("app_menu")
    weeks = (am.get("weeks") if isinstance(am, dict) else None) or []
    pend = plan.get("app_menu_pending")
    pend_days = (pend.get("days") if isinstance(pend, dict) else None) or []
    day_lists = [d for w in weeks for d in (w.get("days") or [])] + pend_days
    for day in day_lists:
        for slot in day.get("slots") or []:
            if isinstance(slot, dict) and slot.get("dish"):
                new = _fill(slot["dish"])
                if new != slot["dish"]:
                    slot["dish"] = new
                    n += 1
    return n


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="append", default=[])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    import yaml  # type: ignore

    files = args.plan or [f for f in sorted(glob.glob(str(PLANS_DIR / "*.yaml"))) if not f.endswith(".bak-portions")]
    summary = []
    for f in files:
        try:
            plan = yaml.safe_load(Path(f).read_text()) or {}
        except yaml.YAMLError:
            continue
        if not isinstance(plan, dict) or not (plan.get("app_menu") or {}).get("weeks"):
            continue
        n = _walk(plan)
        name = os.path.basename(f).split("-plan")[0]
        if n and not args.dry_run:
            bak = Path(f).with_suffix(".yaml.bak-fill")
            if not bak.exists():
                bak.write_text(Path(f).read_text())
            tmp = Path(f).with_suffix(".yaml.tmp")
            tmp.write_text(yaml.safe_dump(plan, sort_keys=False, allow_unicode=True))
            os.replace(tmp, f)
        summary.append(f"{name}: {n} components filled" + (" (dry-run)" if args.dry_run else ""))
    print(json.dumps({"ok": True, "summary": summary}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
