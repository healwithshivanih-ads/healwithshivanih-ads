#!/usr/bin/env python3
"""Standalone audit: find app_menu dish cells across ALL clients' plans whose
FIRST '+'-joined component is a bare tempering/spice ingredient rather than a
real dish — the exact defect class behind "Garlic (1 clove crushed)" showing
up as a lunch title instead of "Pointed gourd sabzi" (fixed in ochre-overlays
/client-app.ts by matching the whole cell, not just pills[0], but any ALREADY
GENERATED week with this shape still has the malformed data underneath and is
worth the coach's eyes).

Read-only. Scans every plan YAML under all 5 status buckets (drafts, ready,
published, superseded, revoked) for every client. Not part of `fmdb validate`.

Run: python scripts/audit-dish-titles.py [--client-id ID]
"""
import os
import re
import sys
import glob
import argparse
import yaml

PLAN_BUCKETS = ("drafts", "ready", "published", "superseded", "revoked")

# Same list used in the generate-app-menu.py / generate-week-menu.py prompt
# guardrails — bare tempering/spice words that should never lead a dish cell.
_BARE_SPICE_RE = re.compile(
    r"^(garlic|ginger|turmeric|haldi|cumin|jeera|mustard seeds?|rai|hing|"
    r"asafoetida|curry leaves?|black pepper|pepper|cinnamon|cloves?|"
    r"cardamom|bay leaf|coriander seeds?|fennel( seeds?)?|saunf|"
    r"carom seeds?|ajwain|salt)$",
    re.IGNORECASE,
)
# Mirrors DISH_PORTION_RE in client-app.ts closely enough for an audit: any
# "(...)" with a digit or a household-unit word gets stripped before testing.
_PORTION_RE = re.compile(
    r"\(\s*[^)]*?(?:\d|½|¼|¾|⅓|⅔|bowls?|cups?|glass(es)?|katori|tbsp|tsp|"
    r"teaspoons?|tablespoons?|pieces?|small|large|medium|ml|grams?|\bg\b|"
    r"slices?|handful|palm|pinch|clove)[^)]*?\)",
    re.IGNORECASE,
)


def _plans_root():
    env = os.environ.get("FMDB_PLANS_DIR")
    return os.path.abspath(os.path.expanduser(env)) if env else os.path.expanduser("~/fm-plans")


def _is_bare_spice(pill: str) -> bool:
    title = _PORTION_RE.sub(" ", pill)
    title = re.sub(r"\s+", " ", title).strip()
    return bool(title) and bool(_BARE_SPICE_RE.match(title))


def _scan_menu(client_id: str, plan_slug: str, bucket: str, app_menu: dict, hits: list):
    for week in app_menu.get("weeks") or []:
        wk = week.get("week")
        for day in week.get("days") or []:
            for slot in day.get("slots") or []:
                cell = str(slot.get("dish") or "").strip()
                if not cell:
                    continue
                pills = [p.strip() for p in cell.split(" + ") if p.strip()]
                if len(pills) < 2:
                    continue  # a single-component cell can't have "a spice leading a dish"
                if _is_bare_spice(pills[0]):
                    hits.append({
                        "client_id": client_id,
                        "plan_slug": plan_slug,
                        "bucket": bucket,
                        "week": wk,
                        "slot": slot.get("slot"),
                        "leading_component": pills[0],
                        "cell": cell,
                    })


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--client-id", default=None, help="restrict to one client")
    args = ap.parse_args()

    root = _plans_root()
    hits = []
    scanned = 0
    for bucket in PLAN_BUCKETS:
        for fp in sorted(glob.glob(os.path.join(root, bucket, "*.yaml"))):
            try:
                plan = yaml.safe_load(open(fp, encoding="utf-8"))
            except Exception as e:
                print(f"  ! could not parse {fp}: {e}", file=sys.stderr)
                continue
            if not isinstance(plan, dict):
                continue
            client_id = plan.get("client_id") or ""
            if args.client_id and client_id != args.client_id:
                continue
            app_menu = plan.get("app_menu")
            if not isinstance(app_menu, dict):
                continue
            scanned += 1
            _scan_menu(client_id, plan.get("slug") or os.path.basename(fp), bucket, app_menu, hits)

    print(f"Scanned {scanned} plan(s) with an app_menu under {root}\n")
    if not hits:
        print("No dish cells found with a bare spice/tempering ingredient leading the list. Clean.")
        return 0

    print(f"{len(hits)} suspect dish cell(s) found:\n")
    for h in hits:
        print(f"- client={h['client_id']!r} plan={h['plan_slug']!r} bucket={h['bucket']} "
              f"week={h['week']} slot={h['slot']!r}")
        print(f"    leads with: {h['leading_component']!r}")
        print(f"    full cell:  {h['cell']}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
