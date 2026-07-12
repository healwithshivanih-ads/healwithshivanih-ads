"""Condition-matched *morning rituals* for a client's plan.

Coach directive 2026-07-12: standing morning food rituals (warm ghee water,
soaked black raisins, etc.) should be suggested automatically and matched to
each client's picture — the way a small salad is now universal, but SAFER,
because these are constitution/condition-specific. A blanket rule would harm
some clients (ghee for a vegan or fatty-liver client, raisins for a diabetic).

So this is a small curated library with explicit per-ritual GATES:
- indications  : substrings that must appear in the client's topics/conditions
- contra_flags : computed client flags (vegan, metabolic, weight_loss, …) that
                 disqualify the ritual
- contra_text  : substrings in topics/conditions that disqualify it

Unlike `meal_foods.relevant_meal_foods` (which weaves dish-foods into the
rotating weekly MENU), these rituals are standing entries written to
`plan.nutrition.custom_remedies` — the app renders them in the daily routine,
and menu regeneration never touches that field.

`relevant_morning_rituals(plan, client, max_n=2) -> list[ritual dict]` best-first.
`ensure_morning_rituals(plan, client) -> list[str]` idempotently APPENDS any
matched ritual not already present (by name); never removes or edits existing
entries, so coach-authored / hand-added rituals are preserved and never
duplicated. Pure stdlib; no API, no catalogue read.

Contraindication gating is deliberately TOPIC-SLUG based (primary/contributing
topics), NOT free-text active_conditions, to dodge the negation trap — a
condition note like "NO insulin resistance" or "prediabetes DEFUSED" must not
false-positive a metabolic gate. Topics are clean slugs.
"""
from __future__ import annotations

from typing import Any

# Each ritual carries the exact client-facing shape written to custom_remedies
# (name/kind/ingredients/preparation/timing/reason) + matching metadata.
# `name` MUST stay stable — it is the idempotency key against existing entries.
RITUALS: list[dict[str, Any]] = [
    {
        "name": "Warm ghee water on waking",
        "kind": "drink",
        "ingredients": "½ tsp cow's ghee, 1 cup warm (not hot) water",
        "preparation": "Stir ½ teaspoon of ghee into a cup of warm water until it melts.",
        "timing": "First thing on waking, on an empty stomach — before your morning tea. Sip it slowly while it's warm.",
        "reason": (
            "A gentle, grounding way to start the day — it lubricates digestion and eases "
            "dryness and acidity. Keep it to ½ tsp; if it ever brings on reflux, pause it and let me know."
        ),
        "indications": ("anxiet", "stress", "dyspepsia", "maldigest", "hypochlorhydria", "constipat", "insomnia", "vata"),
        "contra_flags": ("vegan", "dairy_free", "weight_loss", "fatty_liver", "dyslipidemia"),
        "contra_text": (),
        "priority": 1,
    },
    {
        "name": "Soaked black raisins on waking",
        "kind": "food",
        "ingredients": "8–10 black raisins (kishmish), ½ cup water",
        "preparation": "Soak the raisins in water overnight. In the morning, eat the raisins and drink the soaking water.",
        "timing": "In the morning on an empty stomach, before breakfast.",
        "reason": (
            "Cooling and gentle — it supports easy digestion and regularity, is soothing for the bladder, "
            "and adds a little natural iron."
        ),
        "indications": (
            "constipat", "acidity", "gerd", "reflux", "anxiet", "stress", "iron",
            "anaemia", "anemia", "cystitis", "urinary", "uti", "interstitial",
        ),
        "contra_flags": ("metabolic", "weight_loss"),
        "contra_text": (),
        "priority": 2,
    },
    {
        "name": "Soaked chia water on waking",
        "kind": "drink",
        "ingredients": "1 tsp chia seeds, 1 cup water",
        "preparation": "Stir the chia into a cup of water and let it sit 10–15 minutes until gel-like (or soak overnight).",
        "timing": "In the morning on an empty stomach, soon after mixing.",
        "reason": (
            "A cooling, high-fibre start that steadies digestion and blood sugar and keeps things regular. "
            "Drink it soon after mixing, before it thickens too much."
        ),
        "indications": (
            "constipat", "insulin", "prediabet", "diabet", "dyslipidem", "triglycer",
            "cholesterol", "blood sugar", "metabolic", "pcos", "polycystic", "fatty-liver", "nafld",
        ),
        "contra_flags": (),
        "contra_text": (),
        "priority": 3,
    },
    {
        "name": "Methi (fenugreek) water on waking",
        "kind": "drink",
        "ingredients": "1 tsp fenugreek (methi) seeds, 1 cup water",
        "preparation": "Soak the seeds in water overnight. In the morning, strain and drink the water (you can chew the softened seeds too).",
        "timing": "In the morning on an empty stomach, before breakfast.",
        "reason": (
            "A traditional support for steady blood sugar. It's slightly bitter, which is normal — "
            "start with a small amount and see how you feel."
        ),
        "indications": (
            "insulin", "prediabet", "diabet", "pcos", "polycystic", "blood sugar",
            "dyslipidem", "triglycer", "cholesterol", "metabolic",
        ),
        # methi is heating/irritant — skip for acid/reflux and bladder pictures
        "contra_flags": (),
        "contra_text": (
            "gerd", "reflux", "acidity", "dyspepsia", "hypochlorhydria",
            "cystitis", "interstitial", "urinary", "uti", "pregnan",
        ),
        "priority": 4,
    },
    {
        "name": "Soaked figs on waking",
        "kind": "food",
        "ingredients": "2 dried figs (anjeer), ½ cup water",
        "preparation": "Soak the figs in water overnight. In the morning, eat the figs and drink the soaking water.",
        "timing": "In the morning on an empty stomach, before breakfast.",
        "reason": (
            "Soft, mineral-rich and full of fibre — a gentle way to support strong bones and muscles "
            "and easy digestion as we age."
        ),
        "indications": ("sarcopenia", "muscle", "osteoporos", "bone", "constipat", "tendinopath", "frail"),
        "contra_flags": ("metabolic", "weight_loss"),
        "contra_text": (),
        "priority": 5,
    },
]

_METABOLIC_TOPIC_MARKERS = (
    "insulin-resist", "insulin_resist", "prediabet", "pre-diabet", "diabet",
    "pcos", "polycystic", "metabolic-syndrome", "fatty-liver", "nafld",
    "dyslipidem", "hypertriglycerid", "hyperlipidem",
    "blood-sugar", "blood_sugar", "glucose", "glycemi", "glycaemi", "dysglycemia",
)


def _as_list(v: Any) -> list[str]:
    if isinstance(v, list):
        return [str(x) for x in v]
    return [str(v)] if v else []


def _topics_blob(plan: dict) -> str:
    slugs: list[str] = []
    for k in ("primary_topics", "contributing_topics"):
        slugs += _as_list(plan.get(k))
    return " ".join(s.lower() for s in slugs)


def _is_weight_loss(plan: dict, client: dict, topics_blob: str) -> bool:
    wl = plan.get("weight_loss")
    if isinstance(wl, dict) and wl.get("enabled"):
        return True
    if any(m in topics_blob for m in ("weight-loss", "weight-management", "obes", "overweight")):
        return True
    goals = " ".join(_as_list(client.get("goals"))).lower()
    return "weight loss" in goals or "lose weight" in goals or "weight-loss" in goals


def _compute_flags(plan: dict, client: dict, topics_blob: str) -> dict[str, bool]:
    diet = str(client.get("dietary_preference") or "").lower()
    vegan = "vegan" in diet
    return {
        "vegan": vegan,
        "dairy_free": vegan or "dairy-free" in diet or "dairy free" in diet,
        "metabolic": any(m in topics_blob for m in _METABOLIC_TOPIC_MARKERS),
        "fatty_liver": "fatty-liver" in topics_blob or "nafld" in topics_blob,
        "dyslipidemia": any(m in topics_blob for m in ("dyslipidem", "hypertriglycerid", "hyperlipidem")),
        "weight_loss": _is_weight_loss(plan, client, topics_blob),
    }


def relevant_morning_rituals(plan: dict, client: dict, max_n: int = 2) -> list[dict]:
    """Return up to max_n condition-matched morning rituals, best-first.

    A ritual qualifies when it has ≥1 indication hit AND passes every gate
    (no contra_flag set, no contra_text hit). Client-facing fields only.
    """
    topics_blob = _topics_blob(plan)
    cond_text = " | ".join(
        _as_list(client.get("active_conditions")) + _as_list(client.get("goals"))
    ).lower()
    hay = topics_blob + " | " + cond_text
    flags = _compute_flags(plan, client, topics_blob)

    scored: list[tuple[int, int, dict]] = []
    for r in RITUALS:
        if any(flags.get(f) for f in r["contra_flags"]):
            continue
        if any(t in hay for t in r["contra_text"]):
            continue
        ind_hits = [i for i in r["indications"] if i in hay]
        if not ind_hits:
            continue
        score = len(ind_hits)
        scored.append((score, r["priority"], r))

    scored.sort(key=lambda x: (-x[0], x[1]))
    out: list[dict] = []
    for _score, _prio, r in scored[:max_n]:
        out.append({k: r[k] for k in ("name", "kind", "ingredients", "preparation", "timing", "reason")})
    return out


def _norm(name: Any) -> str:
    return str(name or "").strip().lower()


def ensure_morning_rituals(plan: dict, client: dict, max_n: int = 2) -> list[str]:
    """Idempotently append matched rituals to plan.nutrition.custom_remedies.

    Additive only — never removes or edits existing entries, and never adds a
    ritual whose name already appears (so coach hand-adds are preserved and
    never duplicated). Returns the names actually added.
    """
    matched = relevant_morning_rituals(plan, client, max_n)
    nutrition = plan.setdefault("nutrition", {}) or {}
    plan["nutrition"] = nutrition
    remedies = nutrition.setdefault("custom_remedies", []) or []
    nutrition["custom_remedies"] = remedies

    existing = {_norm(r.get("name")) for r in remedies if isinstance(r, dict)}
    added: list[str] = []
    for entry in matched:
        if _norm(entry["name"]) in existing:
            continue
        remedies.append(entry)
        existing.add(_norm(entry["name"]))
        added.append(entry["name"])
    return added
