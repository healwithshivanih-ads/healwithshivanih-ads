"""Condition-matched *daily rituals* for a client's plan — CATALOGUE-DRIVEN.

Coach directive 2026-07-12: standing morning food rituals (warm ghee water,
soaked black raisins, etc.) should be suggested automatically and matched to
each client's picture — the way a small salad is now universal, but SAFER,
because these are constitution/condition-specific. A blanket rule would harm
some clients (ghee for a vegan or fatty-liver client, raisins for a diabetic).

**Rewrite 2026-07-13 — the ritual definitions now live in the CATALOGUE.**
Instead of a hardcoded 5-ritual list, this module loads every HomeRemedy flagged
`daily_ritual: true` (route: internal) from `fm-database/data/home_remedies/`,
gates each per client, ranks, and appends the best matches to
`plan.nutrition.custom_remedies`. **Adding a new tea/drink ritual (e.g. a nettle
morning tea) is now a pure data operation** — author a home_remedy with
`daily_ritual: true` + `indications` + gates and it auto-surfaces for matching
clients. No code change.

A ritual must pass EVERY gate to qualify:
- **relevance**  : ≥1 `indications` token matches the client's topics /
                   active_conditions / goals.
- **ritual_avoid**: each token is a computed diet/metabolic flag (vegan,
                   dairy_free, metabolic, fatty_liver, dyslipidemia, weight_loss)
                   checked against the client's flags, OR a condition keyword
                   (reflux, acidity, cystitis, …) substring-matched against the
                   client blob. Any hit withholds the ritual.
- **avoid_in**   : the client's life stage (or a pregnancy/lactation text
                   signal) is not excluded.
- **suitable_sex**: matches the client's sex (or 'any').
- **suitable_stages**: if set, the client's stage must be one of them.

Ranked by (indication-hit count desc, ritual_priority asc, slug), capped at
max_n. Idempotent-append: never removes / edits existing custom_remedies and
never adds a ritual whose name already appears (so coach hand-adds and
already-present rituals are preserved and never duplicated).

Contraindication gating stays deliberately conservative — for relevance we
match against topics + active_conditions + goals; for exclusion we match loosely
(substring) so a contraindicated ritual is withheld rather than risk being shown.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import yaml

# Resolve the catalogue home_remedies dir. Honour FMDB_CATALOGUE_DIR (set by the
# coach UI / web app), else the sibling fm-database/data.
FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
_CATALOGUE_DIR = Path(os.environ.get("FMDB_CATALOGUE_DIR") or (FMDB_ROOT / "data"))
_HOME_REMEDIES_DIR = _CATALOGUE_DIR / "home_remedies"

# Computed diet/metabolic flags a ritual's `ritual_avoid` may reference.
_DIET_FLAGS = ("vegan", "dairy_free", "metabolic", "fatty_liver", "dyslipidemia", "weight_loss")
# Categories rendered as a "drink" (else "food") in the client-facing shape.
_DRINK_CATEGORIES = {"infused_water", "herbal_tea", "kashayam", "vegetable_juice"}

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


# ── Catalogue load (cached per process) ───────────────────────────────────────
_RITUAL_CACHE: list[dict] | None = None


def _load_daily_rituals() -> list[dict]:
    """Load catalogue HomeRemedy YAMLs flagged `daily_ritual` (route internal,
    status active) as plain dicts. Cached; robust to a single malformed file."""
    global _RITUAL_CACHE
    if _RITUAL_CACHE is not None:
        return _RITUAL_CACHE
    out: list[dict] = []
    if _HOME_REMEDIES_DIR.is_dir():
        for p in sorted(_HOME_REMEDIES_DIR.glob("*.yaml")):
            try:
                doc = yaml.safe_load(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(doc, dict):
                continue
            if not doc.get("daily_ritual"):
                continue
            if str(doc.get("status", "active")).lower() != "active":
                continue
            if str(doc.get("route", "internal")).lower() != "internal":
                continue
            out.append(doc)
    _RITUAL_CACHE = out
    return out


def _tokens(s: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", str(s).lower()) if len(t) >= 4]


def _client_life_stages(client: dict) -> set[str]:
    """Best-effort mapping of a client to LifeStage tokens for avoid_in gating."""
    stages: set[str] = set()
    ps = str(client.get("pregnancy_status") or "").lower()
    if "pregnan" in ps or "trimester" in ps:
        # guard against "not pregnant" / "non-pregnant"
        if "not" not in ps and "non-" not in ps and "no " not in ps:
            stages.add("pregnancy")
    if client.get("lactation_started") or "lactat" in ps or "breastfeed" in ps:
        stages.add("lactation")
    cyc = str(client.get("cycle_status") or "").lower()
    if "postmeno" in cyc or "post-meno" in cyc:
        stages.add("postmenopausal")
    elif "perimeno" in cyc or "peri-meno" in cyc:
        stages.add("perimenopausal")
    elif "menstru" in cyc or "regular" in cyc or "cycl" in cyc:
        stages.add("menstruating")
    return stages


def _ind_match(ind: str, hay_str: str, hay_tokens: set[str]) -> bool:
    """Relevance match: whole-slug substring (len>=5) OR an exact word token.
    Word-token equality avoids short-substring false hits (e.g. 'iron' in
    'environment')."""
    ind = str(ind).lower().strip()
    if not ind:
        return False
    if len(ind) >= 5 and ind in hay_str:
        return True
    return any(t in hay_tokens for t in _tokens(ind))


def relevant_morning_rituals(plan: dict, client: dict, max_n: int = 2) -> list[dict]:
    """Return up to max_n catalogue-driven daily rituals, best-first.

    A ritual qualifies with ≥1 indication match AND passing every gate
    (ritual_avoid, avoid_in, suitable_sex, suitable_stages). Client-facing
    fields only."""
    topics_blob = _topics_blob(plan)
    cond_text = " | ".join(
        _as_list(client.get("active_conditions")) + _as_list(client.get("goals"))
    ).lower()
    hay = topics_blob + " | " + cond_text
    hay_tokens = set(re.split(r"[^a-z0-9]+", hay))
    flags = _compute_flags(plan, client, topics_blob)
    active_flags = {f for f in _DIET_FLAGS if flags.get(f)}
    stages = _client_life_stages(client)
    sex = str(client.get("sex") or "").strip().lower()

    scored: list[tuple[int, int, str, dict]] = []
    for r in _load_daily_rituals():
        # ── life-stage hard gate (structured avoid_in + text fallback) ──
        avoid_in = [str(x).lower() for x in _as_list(r.get("avoid_in"))]
        if any((st in stages) or (len(st) >= 6 and st[:6] in hay) for st in avoid_in):
            continue
        # ── suitable_stages: if declared, client stage must be among them ──
        suit_stages = [str(x).lower() for x in _as_list(r.get("suitable_stages"))]
        if suit_stages and not (stages & set(suit_stages)):
            continue
        # ── suitable_sex ──
        ss = str(r.get("suitable_sex") or "any").lower()
        if ss == "female" and sex not in ("f", "female"):
            continue
        if ss == "male" and sex not in ("m", "male"):
            continue
        # ── ritual_avoid: diet flags (vs client flags) + condition text (vs hay) ──
        skip = False
        for tok in (str(x).lower().strip() for x in _as_list(r.get("ritual_avoid"))):
            if not tok:
                continue
            if tok in _DIET_FLAGS:
                if tok in active_flags:
                    skip = True
                    break
            elif tok in hay:
                skip = True
                break
        if skip:
            continue
        # ── relevance: ≥1 indication match ──
        hits = [i for i in _as_list(r.get("indications")) if _ind_match(i, hay, hay_tokens)]
        if not hits:
            continue
        prio = int(r.get("ritual_priority") or 100)
        scored.append((len(hits), prio, str(r.get("slug") or ""), r))

    scored.sort(key=lambda x: (-x[0], x[1], x[2]))
    return [_to_custom_remedy(r) for _hits, _prio, _slug, r in scored[:max_n]]


def _to_custom_remedy(r: dict) -> dict:
    """Map a catalogue HomeRemedy dict to the custom_remedies output shape."""
    cat = str(r.get("category") or "").lower()
    kind = "drink" if cat in _DRINK_CATEGORIES else "food"
    return {
        "name": str(r.get("display_name") or "").strip(),
        "kind": kind,
        "ingredients": str(r.get("typical_dose") or "").strip(),
        "preparation": str(r.get("preparation") or "").strip(),
        "timing": str(r.get("timing_notes") or "").strip(),
        "reason": str(r.get("summary") or "").strip(),
    }


def _norm(name: Any) -> str:
    return str(name or "").strip().lower()


def ensure_morning_rituals(plan: dict, client: dict, max_n: int = 2) -> list[str]:
    """Idempotently append matched rituals to plan.nutrition.custom_remedies.

    Additive only — never removes or edits existing entries, and never adds a
    ritual whose name already appears (so coach hand-adds are preserved and
    never duplicated). Returns the names actually added."""
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
