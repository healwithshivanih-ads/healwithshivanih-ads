"""Dairy reactions — a milk-PROTEIN allergy is not LACTOSE intolerance.

TS mirror: ``fm-database-web/src/lib/fmdb/dairy-reaction.ts``. Keep the signal
regex, the three type values and the behaviour table in lockstep.

Why this exists (2026-10-23, cl-906). The client had "Milk" in
``known_allergies`` and "Milk & mushroom causes allergy" in ``foods_to_avoid``.
The coach wanted to swap her protein powder for a lactose-free high-protein
milk (concentrated cow's milk — ~3x the milk protein of ordinary milk) or a
beta-lactoglobulin whey shot. Both are fine for lactose intolerance and unsafe
for a true milk-protein allergy, and nothing in the record said which she had.
Clients routinely call lactose intolerance an "allergy".

Measured while building this: neither word was doing anything anyway. The
recipe filter matched the allergy term "milk" against the recipe allergen tag
"dairy" by substring, which never matches, so the client was being served
paneer and curd; and the free-text avoid string never splits on "&". So the
answer to "milk allergy?" was being ignored in BOTH directions.

The intake now asks the discriminating question — what happens, how soon, and
whether curd / paneer / ghee are OK — and stores ``dairy_reaction_type``:

    lactose_intolerance  — avoid lactose only. Lactose-free milk, curd, paneer,
                           ghee and whey ISOLATE are fine.
    milk_protein_allergy — no milk protein at all: milk (lactose-free milk is
                           still milk protein), curd, paneer, cheese, whey,
                           casein. Ghee only if the client said ghee is fine.
    unsure               — treated exactly like the allergy until the coach
                           confirms. A dairy word in the record with no type
                           recorded reads as ``unsure`` too (``inferred``).

Curd is the strongest discriminator: it carries the whole milk protein (whey
AND casein) with less lactose, so a client who eats curd happily is not
milk-protein allergic. Paneer is mostly casein with almost no lactose. Ghee is
nearly protein-free, so reacting to ghee points hard at a protein allergy,
while tolerating it proves little.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Optional

DAIRY_REACTION_TYPES = ("lactose_intolerance", "milk_protein_allergy", "unsure")

#: Raw intake answers (storage keys — never rename).
SYMPTOM_KEYS_GUT = ("bloating_gas", "loose_stools", "stomach_cramps", "nausea")
SYMPTOM_KEYS_ALLERGY = (
    "hives_rash", "itching_mouth_throat", "swelling", "wheezing_breathless",
    "vomiting", "eczema_flare",
)
SYMPTOM_KEYS = SYMPTOM_KEYS_GUT + SYMPTOM_KEYS_ALLERGY
TIMING_KEYS = ("within_minutes", "within_2_hours", "several_hours", "not_sure")
TOLERANCE_KEYS = ("yes", "no", "unsure")

#: Client-record fields this module reads.
RAW_FIELDS = (
    "dairy_reaction_symptoms", "dairy_reaction_timing",
    "tolerates_curd", "tolerates_paneer", "tolerates_ghee",
)

# A dairy word in allergy / avoid text. Plant milks and milk thistle are not
# dairy; "buttermilk" is (it is matched via "milk" only when not preceded by a
# plant word, and \b keeps "buttermilk" out of the \bmilk match — buttermilk is
# caught by its own alternative).
_PLANT = r"(?<!coconut )(?<!almond )(?<!oat )(?<!soy )(?<!soya )(?<!rice )(?<!cashew )(?<!peanut )(?<!plant )(?<!nut )"
DAIRY_SIGNAL = re.compile(
    rf"\b(?:dairy|lactose|casein|whey|paneer|cheese|curd|dahi|yogh?urt|buttermilk|{_PLANT}milk(?!\s*thistle))\b",
    re.IGNORECASE,
)


def _text(v: Any) -> str:
    if isinstance(v, (list, tuple)):
        return " ; ".join(str(x) for x in v if x is not None)
    return str(v or "")


def has_dairy_signal(*texts: Any) -> bool:
    """True when any of ``texts`` (strings or lists) names milk / dairy."""
    return any(DAIRY_SIGNAL.search(_text(t)) for t in texts)


def is_dairy_term(term: Any) -> bool:
    """One allergy-list entry that is about dairy ("Milk", "lactose")."""
    return bool(DAIRY_SIGNAL.search(str(term or "")))


def derive_dairy_reaction_type(
    symptoms: Optional[Iterable[str]],
    timing: Optional[str] = None,
    curd: Optional[str] = None,
    paneer: Optional[str] = None,
    ghee: Optional[str] = None,
) -> Optional[str]:
    """The intake answers → a type. ``None`` when nothing was answered.

    Order matters — anything that points at the immune system wins:
      1. an allergy-type sign (hives, itching, swelling, wheeze, vomiting,
         eczema flare) → milk_protein_allergy
      2. a reaction to ghee (almost no lactose) → milk_protein_allergy
      3. a reaction to BOTH curd and paneer (full milk protein, little
         lactose) → milk_protein_allergy
      4. gut-only, and curd or paneer eaten without trouble → lactose
         intolerance (curd fine + paneer not = contradictory → unsure)
      5. anything else answered → unsure
    ``timing`` is recorded for the coach and does not change the result: gut
    symptoms within the hour fit lactose intolerance as well as an allergy.
    """
    syms = {str(s) for s in (symptoms or []) if str(s) in SYMPTOM_KEYS}
    tol = {k: (v if v in TOLERANCE_KEYS else None)
           for k, v in (("curd", curd), ("paneer", paneer), ("ghee", ghee))}
    answered = bool(syms) or any(tol.values()) or (timing in TIMING_KEYS)
    if not answered:
        return None
    if syms & set(SYMPTOM_KEYS_ALLERGY):
        return "milk_protein_allergy"
    if tol["ghee"] == "no":
        return "milk_protein_allergy"
    if tol["curd"] == "no" and tol["paneer"] == "no":
        return "milk_protein_allergy"
    if tol["curd"] == "yes" and tol["paneer"] == "no":
        return "unsure"
    if tol["curd"] == "yes" or tol["paneer"] == "yes":
        return "lactose_intolerance"
    return "unsure"


def resolve_dairy(client: Optional[dict]) -> Optional[dict]:
    """How every consumer should treat dairy for this client, or ``None`` when
    dairy is not an issue on the record.

    Returns ``{kind, source, ghee_ok}`` where ``source`` is ``recorded`` (the
    intake or the coach set the type) or ``inferred`` (a dairy word sits in the
    allergies / avoid text with no type recorded — read as ``unsure``).
    """
    client = client or {}
    kind = client.get("dairy_reaction_type")
    source = "recorded"
    if kind not in DAIRY_REACTION_TYPES:
        if not has_dairy_signal(
            client.get("known_allergies"), client.get("allergies"),
            client.get("foods_to_avoid"), client.get("reported_triggers"),
        ):
            return None
        kind, source = "unsure", "inferred"
    ghee = client.get("tolerates_ghee")
    if kind == "lactose_intolerance":
        ghee_ok = True
    elif kind == "milk_protein_allergy":
        ghee_ok = ghee == "yes"
    else:  # unsure — only an explicit "ghee bothers me" takes ghee away
        ghee_ok = ghee != "no"
    return {"kind": kind, "source": source, "ghee_ok": ghee_ok}


def treats_as_allergy(dairy: Optional[dict]) -> bool:
    return bool(dairy) and dairy["kind"] in ("milk_protein_allergy", "unsure")


def allergen_items_for_matching(items: list, dairy: Optional[dict]) -> list:
    """The real-allergen list a recipe / supplement matcher should use.

    For lactose intolerance the dairy words ("Milk") come OFF the absolute
    list — the lactose rule replaces them. For an allergy (or unsure) they are
    normalised to also carry "dairy", which is how the recipe library tags it;
    "milk" alone never substring-matched the "dairy" tag.
    """
    if not dairy:
        return list(items)
    if dairy["kind"] == "lactose_intolerance":
        return [i for i in items if not is_dairy_term(i)]
    out = list(items)
    if "dairy" not in {str(i).lower() for i in out}:
        out.append("dairy")
    return out


# Ingredient text that carries real lactose. Curd, paneer, ghee, butter,
# buttermilk and hard cheese are low-lactose and stay allowed.
_LACTOSE_HEAVY = re.compile(
    rf"(?<!lactose-free )(?<!lactose free )\b{_PLANT}milk(?!\s*thistle)\b"
    rf"|\b{_PLANT}cream\b|\b(?:malai|khoa|khoya|mawa|rabri)\b",
    re.IGNORECASE,
)
_MILK_PROTEIN = re.compile(
    rf"\b(?:{_PLANT}milk(?!\s*thistle)|{_PLANT}cream|buttermilk|chaas|curd|dahi|yogh?urt|raita|lassi|"
    r"paneer|cheese|malai|khoa|khoya|mawa|rabri|whey|casein|chhena|chenna|kheer)\b",
    re.IGNORECASE,
)
_GHEE = re.compile(
    rf"\bghee\b|\b{_PLANT}(?<!cocoa )(?<!seed )(?<!sunflower )(?<!apple )butter\b", re.IGNORECASE
)


def text_is_dairy_safe(text: str, dairy: Optional[dict]) -> bool:
    """Is a dish / ingredient text safe for this client's dairy status?"""
    if not dairy:
        return True
    t = str(text or "")
    if dairy["kind"] == "lactose_intolerance":
        return not _LACTOSE_HEAVY.search(t)
    if _MILK_PROTEIN.search(t):
        return False
    if not dairy["ghee_ok"] and _GHEE.search(t):
        return False
    return True


def recipe_dairy_ok(recipe: dict, ingredient_text: str, dairy: Optional[dict]) -> bool:
    """Recipe-level check: the curated allergen tag plus the full ingredients."""
    if not dairy:
        return True
    if treats_as_allergy(dairy):
        tags = {str(a).lower() for a in (recipe.get("contains_allergens") or [])}
        if "dairy" in tags:
            return False
    return text_is_dairy_safe(ingredient_text, dairy)


_KIND_LABEL = {
    "lactose_intolerance": "lactose intolerance (NOT a milk allergy)",
    "milk_protein_allergy": "a true milk-PROTEIN allergy",
    "unsure": "a dairy reaction of UNCONFIRMED type",
}


def dairy_prompt_line(client: Optional[dict]) -> str:
    """One line for an AI prompt. Empty string when dairy is not an issue."""
    d = resolve_dairy(client)
    if not d:
        return ""
    kind = d["kind"]
    if kind == "lactose_intolerance":
        return (
            "Dairy: LACTOSE INTOLERANCE, not a milk allergy — avoid ordinary milk, "
            "cream, khoa/malai and milk sweets. Lactose-free milk, curd, paneer, "
            "buttermilk, ghee and whey ISOLATE are fine; do not remove dairy wholesale "
            "or refuse whey isolate for this reason."
        )
    ghee = ("Ghee is OK (the client said so)." if d["ghee_ok"]
            else "No ghee or butter either.")
    if kind == "milk_protein_allergy":
        return (
            "Dairy: TRUE MILK-PROTEIN ALLERGY — ABSOLUTE. No milk (lactose-free and "
            "high-protein milks are still milk protein), curd, buttermilk, paneer, "
            f"cheese, whey or casein, in food or supplements. {ghee}"
        )
    why = ("dairy appears in the allergies / avoid list but the type was never asked"
           if d["source"] == "inferred" else "the client's answers did not settle it")
    return (
        f"Dairy: reaction of UNCONFIRMED type ({why}). Treat it as a milk-protein "
        "allergy until the coach confirms — no milk (including lactose-free / "
        f"high-protein milk), curd, paneer, cheese, whey or casein. {ghee}"
    )


def coach_label(client: Optional[dict]) -> str:
    """Short coach-facing label, or ''."""
    d = resolve_dairy(client)
    if not d:
        return ""
    label = _KIND_LABEL[d["kind"]]
    if d["source"] == "inferred":
        label += " — dairy is on the record but the type was never asked"
    return label


def dairy_context(client: Optional[dict]) -> Optional[dict]:
    """The structured block AI callers put in their client context (assess,
    chat, rework, follow-up, plan-chat, plan AI check). ``None`` when dairy is
    not an issue — the key is then omitted, so the prompt is unchanged."""
    client = client or {}
    d = resolve_dairy(client)
    if not d:
        return None
    out = {
        "type": d["kind"],
        "source": d["source"],
        "ghee_ok": d["ghee_ok"],
        "rule": dairy_prompt_line(client),
    }
    answers = {f: client.get(f) for f in RAW_FIELDS if client.get(f)}
    if answers:
        out["intake_answers"] = answers
    return out
