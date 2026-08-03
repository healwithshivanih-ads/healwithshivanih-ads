"""Condition ↔ food cautions — the negative half of a recipe's `good_for`.

`meal_foods.py::relevant_meal_foods()` finds foods that HELP a condition. This
is its missing counterpart: foods that warrant CAUTION for one. Ragi reaching a
hypothyroid client's weekly menu is the case that prompted it — the knowledge
was in claims/murray-goitrogens-cooked-vs-raw.yaml as prose that gated nothing,
while generate-week-menu rule 11 actively rotates millets and ragi-roti scores
well on `good_for: [blood-sugar-regulation]`.

Data lives in fm-database/data/_food_cautions.yaml; its header carries the
design rules. Two that shape this module:

  * IT DOWN-RANKS AND SURFACES, NEVER HARD-FILTERS. recipe_select.py's contract
    is "HARD filters are SAFETY only: dietary preference, allergens,
    foods-to-avoid". Nothing here removes a recipe from a client's library. The
    coach promotes a caution into `foods_to_avoid` if she agrees — that is the
    hard filter, and it stays hers.

  * PREPARATION IS THE INTERESTING AXIS, NOT SEVERITY. A cooked ragi roti is a
    different clinical object from a raw millet porridge, and a caution that
    could not say so would be a blunt ban — which is the failure mode
    foods-to-avoid.ts exists to prevent. `preparation_clears: cooked` on a
    cooked dish DEMOTES the hit to `monitor` rather than dropping it, because
    the residual concerns (frequency, levothyroxine timing) survive cooking.

Food matching goes through `nutrients_lib.NutrientTable` — the same alias index
that resolves all ~729 ingredient spellings in the recipe library. This module
adds no second matching surface; see the standing invariant in CLAUDE.md.

Public API
----------
    load_cautions(root=None)            -> list[Caution]            (active only)
    review_queue(root=None)             -> list[Caution]            (needs_review)
    live_cautions(client, plan=None)    -> list[Caution]            (condition match)
    screen_recipe(recipe, live, ...)    -> list[CautionHit]
    screen_text(text, live, ...)        -> list[CautionHit]
    score_penalty(hits)                 -> float                    (≤ 0.0)
    prompt_block(live)                  -> str                      (menu drafters)
    remedy_contraindication_hits(r, c)  -> list[str]                 (home-remedy gap)

Pure stdlib + pyyaml. No API calls. Every public function degrades to
""/[]/0.0 when the data file is missing, so a stripped checkout behaves exactly
as it did before this module existed.
"""
from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

try:
    import yaml
except Exception:                                   # pragma: no cover
    yaml = None                                     # type: ignore[assignment]

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

_FMDB_DATA = Path(__file__).resolve().parent.parent.parent / "fm-database" / "data"

# Penalties are calibrated against recipe_select.py's own scale: a dosha match
# is +3.0, the good_for ceiling is +4.0, an aggravating dosha is -2.0. So
# `moderate` roughly cancels one positive signal and `avoid` outweighs any
# single one — neither can remove a recipe, which is the point.
_PENALTY = {"avoid": -6.0, "moderate": -3.0, "monitor": -0.5}

# Cooking verbs, for recipes that don't record `cook_time_min` (letter-pack
# recipes and bare menu dish strings). Mirrors the intent of the verb scan in
# foods-to-avoid.ts; kept deliberately small — a false "cooked" only demotes a
# caution to `monitor`, it never silences one.
_COOK_VERBS = re.compile(
    r"\b(cook|boil|simmer|steam|saut[eé]|fry|roast|bake|grill|toast|temper|"
    r"pressure.?cook|steamed|boiled|roasted|baked|griddle|tava|dry.?roast)\w*\b",
    re.I,
)
# Dish FORMS that are eaten raw. Used only on bare menu dish strings, which
# carry no steps and no cook_time_min. In an Indian meal slot essentially
# everything is cooked — roti, dosa, khichdi, sabzi, dal, upma — so for a dish
# string the default is COOKED and this list is what overrides it. Without the
# inversion "Ragi roti" scanned as raw (no cooking verb in the words "Ragi
# roti"), which fired the full raw-goitrogen warning on a griddled flatbread.
_RAW_FORMS = re.compile(
    r"\b(salad|kachumber|koshimbir|smoothie|juice|raita|chutney|raw|uncooked|"
    r"sprouts?|fresh fruit|soaked)\b",
    re.I,
)

# A cooked staple's real risk is not any one meal — it is being the base of
# every meal. Nothing per-dish can see that, so `screen_menu` counts across the
# week. Threshold is per-caution occurrences in a 7-day menu; 5+ means it is
# functionally the daily grain, which is exactly what the coach flagged about
# ragi. Deliberately not 7 — "most days" is already the staple pattern.
STAPLE_THRESHOLD = 5


@dataclass
class Caution:
    id: str
    label: str
    severity: str
    mechanism: str
    preparation_clears: str | None
    foods: list[str]
    condition_terms: list[str]
    coach_note: str
    #  Guidance that helps but does not inactivate — never changes severity.
    preparation_note: str = ""
    claims: list[str] = field(default_factory=list)
    drugs: list[str] = field(default_factory=list)
    status: str = "active"
    #  Populated by `live_cautions` — which of the client's own condition
    #  strings triggered this. Shown to the coach so a match is never mystery.
    matched_conditions: list[str] = field(default_factory=list)


@dataclass
class CautionHit:
    """One caution tripped by one recipe / dish string."""
    caution: Caution
    #  ingredient keys from _ingredient_nutrients.yaml that tripped it
    foods: list[str]
    #  severity AFTER preparation is taken into account — this is the one to use
    effective_severity: str
    #  True when `preparation_clears` was satisfied by the dish
    prepared_safely: bool

    @property
    def id(self) -> str:
        return self.caution.id

    def line(self) -> str:
        foods = ", ".join(self.foods)
        if self.prepared_safely:
            return (
                f"{self.caution.label} — {foods} (prepared as advised; watch "
                f"frequency)"
            )
        return f"{self.caution.label} — {foods}"


# ─────────────────────────────────────────────────────────── loading

def _data_dir(root: Path | str | None = None) -> Path:
    return Path(root) if root else _FMDB_DATA


def _load_raw(root: Path | str | None = None) -> list[dict]:
    if yaml is None:
        return []
    p = _data_dir(root) / "_food_cautions.yaml"
    if not p.exists():
        return []
    try:
        doc = yaml.safe_load(p.read_text()) or {}
    except Exception:
        return []
    out = doc.get("cautions")
    return out if isinstance(out, list) else []


def _to_caution(c: dict) -> Caution | None:
    try:
        return Caution(
            id=str(c["id"]),
            label=str(c.get("label") or c["id"]),
            severity=str(c.get("severity") or "moderate"),
            mechanism=str(c.get("mechanism") or ""),
            preparation_clears=(c.get("preparation_clears") or None),
            foods=[str(f) for f in (c.get("foods") or [])],
            condition_terms=[str(t).lower() for t in (c.get("condition_terms") or [])],
            coach_note=" ".join(str(c.get("coach_note") or "").split()),
            preparation_note=" ".join(str(c.get("preparation_note") or "").split()),
            claims=[str(x) for x in (c.get("claims") or [])],
            drugs=[str(x) for x in (c.get("drugs") or [])],
            status=str(c.get("status") or "active"),
        )
    except Exception:
        return None


def load_cautions(root: Path | str | None = None) -> list[Caution]:
    """Every ACTIVE caution. `needs_review` entries are deliberately excluded —
    they exist for the coach's queue and must never reach a gate."""
    out = [_to_caution(c) for c in _load_raw(root)]
    return [c for c in out if c and c.status == "active"]


def review_queue(root: Path | str | None = None) -> list[Caution]:
    """Cautions parked for coach review — real knowledge, not yet claim-backed."""
    out = [_to_caution(c) for c in _load_raw(root)]
    return [c for c in out if c and c.status == "needs_review"]


# ─────────────────────────────────────────────────────── condition match

def _condition_text(client: dict, plan: dict | None = None) -> str:
    """Everything about this client that could name a condition.

    `active_conditions` is the primary source. `medical_history` is included
    because a resolved/in-remission diagnosis still constrains food (a
    Hashimoto's client in remission is still hypothyroid), and the plan's
    topics are included because the assessment routinely names a condition the
    intake did not.
    """
    parts: list[str] = []
    for k in ("active_conditions", "medical_history"):
        v = client.get(k)
        if isinstance(v, list):
            parts += [str(x) for x in v]
        elif v:
            parts.append(str(v))
    for k in ("primary_topics", "contributing_topics"):
        for t in ((plan or {}).get(k) or []):
            parts.append(str(t).replace("-", " "))
    return " | ".join(parts).lower()


def live_cautions(
    client: dict, plan: dict | None = None, root: Path | str | None = None
) -> list[Caution]:
    """The cautions that apply to THIS client, with the matching condition
    strings attached so the coach can see why each one fired."""
    blob = _condition_text(client, plan)
    if not blob.strip():
        return []
    out: list[Caution] = []
    for c in load_cautions(root):
        matched = sorted({t for t in c.condition_terms if t in blob})
        if matched:
            c.matched_conditions = matched
            out.append(c)
    return out


# ────────────────────────────────────────────────────────── food match

_TABLE_CACHE: dict[str, Any] = {}


def _table():
    """The shared ingredient alias index. Cached — building it walks 201
    entries and is pure, so rebuilding per recipe would be waste."""
    if "t" not in _TABLE_CACHE:
        try:
            from nutrients_lib import NutrientTable
            _TABLE_CACHE["t"] = NutrientTable()
        except Exception:
            _TABLE_CACHE["t"] = None
    return _TABLE_CACHE["t"]


def _ingredient_keys(texts: Iterable[str]) -> set[str]:
    """Resolve free-text ingredient/dish phrases to canonical ingredient keys."""
    tab = _table()
    if tab is None:
        return set()
    try:
        from nutrients_lib import normalize_item
    except Exception:                               # pragma: no cover
        return set()
    keys: set[str] = set()
    for t in texts:
        t = str(t or "").strip()
        if not t:
            continue
        k = tab.match(normalize_item(t))
        if k:
            keys.add(k)
    return keys


def _recipe_texts(recipe: dict) -> list[str]:
    out = [str(recipe.get("name") or "")]
    out += [str(x) for x in (recipe.get("main_ingredients") or [])]
    for ing in recipe.get("ingredients") or []:
        out.append(str(ing.get("item", "")) if isinstance(ing, dict) else str(ing))
    return out


def _is_cooked(recipe: dict, default_cooked: bool = False) -> bool:
    """`cook_time_min` when recorded, else a verb scan over the steps.

    Deliberately generous: over-calling "cooked" demotes a caution to
    `monitor`, it never silences one, so the failure mode is a softer note
    rather than a missed one.

    `default_cooked` inverts the fallback for bare dish strings — see
    `_RAW_FORMS`. It is never set on a real recipe, which has steps to scan.
    """
    ct = recipe.get("cook_time_min")
    if isinstance(ct, (int, float)):
        return ct > 0
    blob = " ".join(str(s) for s in (recipe.get("steps") or []))
    blob += " " + str(recipe.get("method") or "") + " " + str(recipe.get("name") or "")
    if _COOK_VERBS.search(blob):
        return True
    if default_cooked:
        return not _RAW_FORMS.search(blob)
    return False


def _prepared_safely(
    caution: Caution, recipe: dict, default_cooked: bool = False
) -> bool:
    """Only `cooked` demotes, and only where the source says INACTIVATES.

    Oxalate deliberately has no clearing preparation — soaking reduces it, and
    an earlier draft that treated "reduces" as "clears" let a scan for the word
    "soak" hit the paneer soaking in palak-paneer and quietly downgrade a real
    spinach caution. See `_food_cautions.yaml` header rule 3.
    """
    if caution.preparation_clears == "cooked":
        return _is_cooked(recipe, default_cooked)
    return False


def screen_recipe(
    recipe: dict, live: list[Caution], default_cooked: bool = False
) -> list[CautionHit]:
    """Which of this client's live cautions does this recipe trip?"""
    if not live:
        return []
    keys = _ingredient_keys(_recipe_texts(recipe))
    if not keys:
        return []
    hits: list[CautionHit] = []
    for c in live:
        matched = sorted(keys & set(c.foods))
        if not matched:
            continue
        safe = _prepared_safely(c, recipe, default_cooked)
        hits.append(
            CautionHit(
                caution=c,
                foods=matched,
                effective_severity="monitor" if safe else c.severity,
                prepared_safely=safe,
            )
        )
    return hits


def screen_text(text: str, live: list[Caution]) -> list[CautionHit]:
    """Screen a bare dish string ("Ragi roti (2) + dal (1 bowl)").

    Menu dish strings carry no steps and no cook_time_min, so preparation is
    read from the words alone. A dish named "Ragi roti" reads as cooked; "Ragi
    porridge" does not.
    """
    if not live or not str(text or "").strip():
        return []
    parts = [p.strip() for p in re.split(r"\+|,", str(text)) if p.strip()]
    pseudo = {"name": str(text), "main_ingredients": parts, "steps": [str(text)]}
    return screen_recipe(pseudo, live, default_cooked=True)


def score_penalty(hits: list[CautionHit]) -> float:
    """Total down-rank for a recipe. Always ≤ 0. Never removes anything."""
    return sum(_PENALTY.get(h.effective_severity, 0.0) for h in hits)


@dataclass
class StapleFlag:
    """A cautioned food that has become the week's default, not an occasional."""
    caution: Caution
    food_counts: dict[str, int]
    dishes: list[str]

    @property
    def total(self) -> int:
        return sum(self.food_counts.values())

    def line(self) -> str:
        foods = ", ".join(
            f"{k} ×{v}" for k, v in sorted(
                self.food_counts.items(), key=lambda kv: -kv[1]
            )
        )
        return (
            f"{self.caution.label}: {foods} across {self.total} meals this week — "
            f"that is a staple, not an occasional. {self.caution.coach_note}"
        )


def screen_menu(
    dishes: Iterable[str], live: list[Caution], threshold: int = STAPLE_THRESHOLD
) -> list[StapleFlag]:
    """Frequency check across a whole week's dish strings.

    The per-dish screen cannot answer the question the coach actually asked
    about ragi. A cooked ragi roti is fine; ragi as THE flour — breakfast,
    lunch and dinner, seven days — is the thing that is counter-advised, and
    every individual dish in that week looks innocent. Only the count sees it.
    """
    if not live:
        return []
    counts: dict[str, dict[str, int]] = {}
    seen: dict[str, list[str]] = {}
    for d in dishes:
        for hit in screen_text(str(d), live):
            per = counts.setdefault(hit.caution.id, {})
            for f in hit.foods:
                per[f] = per.get(f, 0) + 1
            seen.setdefault(hit.caution.id, []).append(str(d))
    by_id = {c.id: c for c in live}
    out: list[StapleFlag] = []
    for cid, per in counts.items():
        if sum(per.values()) >= threshold:
            out.append(StapleFlag(by_id[cid], per, seen.get(cid, [])))
    out.sort(key=lambda f: -f.total)
    return out


# ────────────────────────────────────────────── menu-drafter prompt block

#  Key suffixes that describe the TABLE's bookkeeping, not the food. Stripping
#  them turns `millet-generic` into "millet" and `chickpeas-cooked` into
#  "chickpeas"; nothing else about the key is touched.
_KEY_QUALIFIERS = (" generic", " cooked", " soaked", " thin")


def plain_food_names(keys: Iterable[str]) -> list[str]:
    """Coach/model-readable names for ingredient keys.

    Derived from the KEY, not the shortest alias. Aliases are matching fodder,
    not display names — the shortest alias for `chicken` is "leg", which named
    a purine caution "lamb, fish, prawns, leg". The key is the canonical
    identifier and reads correctly nearly always. Mirrors `plainFoodNames` in
    src/lib/fmdb/food-cautions.ts.
    """
    out: list[str] = []
    for k in keys:
        name = str(k).replace("-", " ").strip()
        for q in _KEY_QUALIFIERS:
            if name.endswith(q):
                name = name[: -len(q)].strip()
        out.append(name or str(k))
    #  de-dupe, order preserved — `millet-generic` and `millet-cooked` both
    #  read as "millet", and repeating it in a prompt is noise.
    seen: set[str] = set()
    return [n for n in out if not (n in seen or seen.add(n))]


def prompt_block(live: list[Caution]) -> str:
    """The FOOD CAUTIONS block injected into the weekly/app menu drafters.

    Phrased as frequency-and-preparation guidance rather than a ban list, so it
    composes with rule 11 (millets for rotation) instead of contradicting it —
    an all-millet week is the thing to prevent, not millets.
    """
    if not live:
        return ""
    lines: list[str] = []
    for c in live:
        names = plain_food_names(c.foods)
        foods = ", ".join(names[:12]) + ("…" if len(names) > 12 else "")
        prep = " Always COOKED, never raw." if c.preparation_clears == "cooked" else ""
        note = f" {c.preparation_note}" if c.preparation_note else ""
        lines.append(
            f"- {c.label} [{c.severity}] — {foods}.{prep} {c.coach_note}{note}"
        )
    return "\n".join(lines)


# ───────────────────────────────────────── home-remedy contraindications

def remedy_contraindication_hits(remedy: dict, client: dict) -> list[str]:
    """Free-text `contraindications` on a home remedy vs this client's record.

    A live gap this module closes: `meal_foods.py` selected kitchen_remedy /
    vegetable_juice foods for a client's menu without ever reading the
    `contraindications` field those 224 entries all carry. golden-milk lists
    "active gallbladder disease" and "oxalate-restricted diets" and was woven
    into menus regardless.

    Conservative by construction — it matches the DISTINCTIVE words of a
    contraindication against the client's conditions and medications, so it
    reports what it can defend and stays quiet otherwise.
    """
    blob = _condition_text(client)
    for k in ("current_medications", "medications", "known_allergies"):
        v = client.get(k)
        if isinstance(v, list):
            blob += " | " + " | ".join(str(x).lower() for x in v)
        elif v:
            blob += " | " + str(v).lower()
    if not blob.strip():
        return []
    out: list[str] = []
    for c in (remedy.get("contraindications") or []):
        text = str(c or "").strip()
        if not text:
            continue
        # Distinctive words only: 5+ chars, minus the connective vocabulary
        # every contraindication string shares.
        words = [
            w for w in re.findall(r"[a-z]{5,}", text.lower())
            if w not in _STOPWORDS
        ]
        if any(w in blob for w in words):
            out.append(text)
    return out


_STOPWORDS = {
    "active", "acute", "avoid", "chronic", "condition", "conditions", "during",
    "insufficient", "restricted", "severe", "significant", "these", "those",
    "unless", "using", "while", "with", "without", "data", "safety", "diets",
    "diet", "disease", "history", "known", "refer", "clinician", "effect",
    "levels", "level", "based", "cases", "under", "above", "before", "after",
}
