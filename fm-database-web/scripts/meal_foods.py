"""Condition-relevant *meal foods* for a DETAILED client's weekly menu.

Coach directive 2026-06-15 (kitchari / buttermilk): foods you eat as a dish —
`kitchen_remedy` + `vegetable_juice` home-remedies — belong in a detailed
client's MEALS, not on the standalone remedy "shelf". The app loader
(client-app.ts) drops those two categories from the shelf for detailed plans;
this helper is the other half — it tells the menu generators which of those
foods are condition-relevant so they get woven into the menu as dishes.

It mirrors the app shelf's category gate + a trimmed version of its relevance
match (the NEED_RULES groups that meal-foods actually serve) so the SAME foods
that stop appearing as remedies reappear as meals.

`relevant_meal_foods(plan, client) -> list[{slug, name, why, indications}]`
sorted best-first. Pure stdlib + pyyaml; no API.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

_FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"

MEAL_FOOD_CATEGORIES = {"kitchen_remedy", "vegetable_juice"}

# (label, condition-term keywords, indication keywords). Mirrors the
# client-app.ts NEED_RULES, trimmed to groups meal-foods plausibly serve.
_NEED: list[tuple[str, tuple[str, ...], tuple[str, ...]]] = [
    ("digestion", ("digest", "gut", "ibs", "dysbiosis", "agni", "indigestion"),
     ("digest", "gut", "agni", "dysbiosis", "ibs", "absorption", "appetite")),
    ("constipation", ("constipation",),
     ("constipat", "sluggish bowel", "elimination", "laxative")),
    ("loose stools", ("diarrh", "loose stool"), ("diarrh", "loose stool")),
    ("bloating", ("bloat", "gas", "flatulence"), ("bloat", "gas", "flatulence")),
    ("acidity", ("acidity", "gerd", "heartburn", "reflux"),
     ("acid", "heartburn", "reflux", "gerd", "hyperacid")),
    ("blood sugar", ("blood sugar", "diabet", "insulin", "glucose"),
     ("blood sugar", "glucose", "diabet", "insulin")),
    ("cholesterol", ("cholesterol", "lipid"), ("cholesterol", "lipid", "triglycer")),
    ("blood pressure", ("blood pressure", "hypertension", " bp"),
     ("hypertens", "blood pressure", "cardiovascular")),
    ("energy", ("fatigue", "energy", "tired", "debility"),
     ("fatigue", "energy", "debility", "vitality", "nourish")),
    ("skin", ("skin",), ("skin", "complexion")),
    ("immunity", ("immun", "cold", "cough"), ("immun", "cold", "cough")),
    ("iron", ("iron", "anaemia", "anemia"), ("iron", "anaemia", "anemia", "haemoglobin")),
    ("joints", ("joint", "knee", "arthrit"), ("joint", "knee", "arthrit", "stiffness")),
    ("sleep", ("sleep", "insomnia"), ("insomnia", "sleep")),
    ("anxiety", ("anxiet", "stress", "panic"),
     ("anxiet", "stress", "nervous", "calm", "tension")),
    ("recovery", ("recovery", "illness", "fever", "cleanse", "detox"),
     ("recovery", "illness", "fever", "convalescen", "cleans", "detox", "reset")),
]


def _as_list(v: Any) -> list[str]:
    if isinstance(v, list):
        return [str(x) for x in v]
    if v:
        return [str(v)]
    return []


def _doshas_from_plan(plan: dict) -> set[str]:
    ayur = plan.get("ayurveda") or {}
    text = " ".join(
        str(ayur.get(k) or "")
        for k in ("current_imbalance", "balancing_focus", "dietary_guidance")
    ).lower()
    return {d for d in ("vata", "pitta", "kapha") if d in text}


def _diet_excludes(client: dict) -> list[str]:
    diet = str(client.get("dietary_preference") or "").lower()
    pats: list[str] = []
    if any(x in diet for x in ("vegetarian", "vegan", "jain", "eggetarian")):
        pats += ["bone broth", "chicken", "mutton", "fish", "meat", "prawn", "liver"]
    if ("vegetarian" in diet or "vegan" in diet or "jain" in diet) and "eggetarian" not in diet:
        pats += ["egg"]
    if "vegan" in diet:
        pats += ["milk", "ghee", "curd", "yoghurt", "yogurt", "buttermilk", "paneer", "honey", "lassi"]
    if "jain" in diet:
        pats += ["garlic", "onion"]
    return pats


def relevant_meal_foods(
    plan: dict, client: dict, max_n: int = 5, catalogue_root: Path | None = None
) -> list[dict]:
    root = catalogue_root or _FMDB_ROOT / "data"
    d = Path(root) / "home_remedies"
    if not d.exists():
        return []

    terms = _as_list(client.get("active_conditions")) + _as_list(client.get("goals"))
    for k in ("primary_topics", "contributing_topics"):
        terms += [t.replace("-", " ") for t in _as_list(plan.get(k))]
    cond = " | ".join(terms).lower()
    needs = [n for n in _NEED if any(t in cond for t in n[1])]
    if not needs:
        return []

    doshas = _doshas_from_plan(plan)
    excludes = _diet_excludes(client)

    out: list[dict] = []
    for f in sorted(d.glob("*.yaml")):
        try:
            r = yaml.safe_load(f.read_text()) or {}
        except Exception:
            continue
        if r.get("category") not in MEAL_FOOD_CATEGORIES:
            continue
        agg = [str(x).lower() for x in (r.get("aggravates_dosha") or [])]
        if doshas and any(a in doshas for a in agg):
            continue  # don't push a dosha-aggravating food
        name = str(r.get("display_name") or r.get("slug") or "")
        ind_list = [str(x) for x in (r.get("indications") or [])]
        ind_text = " | ".join(ind_list).lower()
        summ = str(r.get("summary") or "").lower()
        blob = name.lower() + " | " + summ
        if excludes and any(x in blob for x in excludes):
            continue
        matched = [n[0] for n in needs if any(k in ind_text or k in summ for k in n[2])]
        if not matched:
            continue
        bal = [str(x).lower() for x in (r.get("balances_dosha") or [])]
        bal_hit = len([x for x in bal if x in doshas]) if doshas else 0
        score = len(matched) * 10 + bal_hit
        why = "for your " + " and ".join(matched[:2]) + (
            f" (and {len(matched) - 2} more)" if len(matched) > 2 else ""
        )
        out.append(
            {
                "slug": r.get("slug"),
                "name": name,
                "why": why,
                "indications": ind_list[:2],
                "score": score,
            }
        )

    out.sort(key=lambda x: (-x["score"], x["name"]))
    return out[:max_n]
