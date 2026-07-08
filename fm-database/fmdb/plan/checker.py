"""Deterministic plan checks against the catalogue.

What this checks (no AI required):
- Every slug referenced in the plan resolves to a real catalogue entity
  (using alias-aware resolution where the entity supports it)
- Catalogue entries with `evidence_tier: confirm_with_clinician` flagged
  as authored without explicit clinician acknowledgement
- Supplement contraindications cross-referenced against the client's
  active conditions and current medications

Findings have severities:
- CRITICAL  blocks transition out of draft
- WARNING   non-blocking but requires explicit ack to publish
- INFO      surfaced for the coach's awareness, no ack required

The AI sanity check (next milestone) layers on top, evaluating things
like coaching-translation accuracy and plan-vs-assessment coherence.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ..validator import Loaded, _resolve_index
from .models import Client, Plan, HypothesizedDriver


Severity = Literal["CRITICAL", "WARNING", "INFO"]


@dataclass
class Finding:
    severity: Severity
    section: str          # which section of the plan
    field: str            # which field in that section
    detail: str           # human-readable explanation
    target: str = ""      # the offending slug or value (for ack tracking)

    def render(self) -> str:
        return f"[{self.severity:8s}] {self.section}.{self.field}: {self.detail}"

    @property
    def ack_id(self) -> str:
        """Stable identifier for `plan ack --finding-id ...`."""
        return f"{self.section}:{self.field}:{self.target}"


def auto_fix_plan_routing(plan: Plan, catalogue: Loaded) -> list[dict]:
    """Mutates `plan` in place to correct common slug-routing errors that
    would otherwise be flagged CRITICAL by check_plan. Returns a list of
    fix descriptions for the caller to log / persist.

    Fixes applied:
      - Mechanism slugs found in primary_topics / contributing_topics →
        moved to hypothesized_drivers (where they belong). Both legacy
        plans (created before generate-draft.py's catalogue-aware
        routing) and plans hand-edited by the coach can land in this
        state; auto-fixing here removes the manual cleanup step.

    Slugs that don't resolve as topics AND don't resolve as mechanisms
    are left in place — plan-check will still flag them as CRITICAL
    (unknown topic) and the coach needs to address them.
    """
    topic_idx = _resolve_index(catalogue.topics)
    mech_idx = _resolve_index(catalogue.mechanisms)
    fixes: list[dict] = []

    for field_name in ("primary_topics", "contributing_topics"):
        original = list(getattr(plan, field_name))
        kept: list[str] = []
        for slug in original:
            if slug in topic_idx:
                kept.append(slug)
                continue
            if slug in mech_idx:
                # Route to hypothesized_drivers (dedup by mechanism slug)
                if not any(hd.mechanism == slug for hd in plan.hypothesized_drivers):
                    plan.hypothesized_drivers.append(HypothesizedDriver(
                        mechanism=slug,
                        reasoning=(
                            f"Auto-routed from {field_name} on "
                            f"{plan.slug}: '{slug}' is a mechanism in the "
                            "catalogue, not a topic."
                        ),
                    ))
                fixes.append({
                    "field": field_name,
                    "slug": slug,
                    "action": "moved_to_hypothesized_drivers",
                })
                continue
            # Unknown — leave for plan-check to flag
            kept.append(slug)
        setattr(plan, field_name, kept)

    return fixes


# ---------------------------------------------------------------------------
# Dietary-preference consistency
# ---------------------------------------------------------------------------
# Real-use bug 2026-05-20: cl-007 (Archana, "Eggetarian") got a plan that
# said "eat chicken / mutton / fish 4-5 days/week" + "bone broth daily" —
# meat prescribed to a vegetarian. Carried over from a non-vegetarian
# client's iron template. Also seen on Nidhi's plan: a vegetarian client
# whose nutrition.reduce list said "avoid red meat" — not harmful, just
# silly noise that erodes trust ("you clearly didn't read my file").
#
# This check catches both:
#   - CRITICAL: a forbidden food RECOMMENDED in nutrition.add / lifestyle
#   - INFO:     a forbidden food listed in nutrition.reduce (irrelevant
#               noise — the client never eats it anyway; trim for polish)

import re as _re

# Word-boundary token sets. Keys are food groups; values are the trigger
# words. Matched case-insensitively with \b boundaries so "egg" does not
# fire on "eggplant" / "eggetarian", and "ham" does not fire on "hamper".
_DIET_TOKENS: dict[str, list[str]] = {
    "meat_poultry": [
        "chicken", "mutton", "lamb", "beef", "pork", "goat", "turkey",
        "bacon", "ham", "salami", "sausage", "kheema", "keema", "meat",
        "meats", "poultry", "venison", "duck",
    ],
    "fish_seafood": [
        "fish", "prawn", "prawns", "shrimp", "crab", "lobster", "salmon",
        "mackerel", "sardine", "sardines", "tuna", "seafood", "anchovy",
        "anchovies", "oyster", "squid",
    ],
    "animal_broth": ["bone broth", "bone-broth", "meat broth", "chicken broth"],
    "egg": ["egg", "eggs", "egg yolk", "egg white", "omelette", "omelet"],
    "dairy": [
        "milk", "paneer", "cheese", "yogurt", "yoghurt", "curd", "cream",
        "whey", "casein", "buttermilk",
    ],
    "honey": ["honey"],
    "root_veg": [
        "onion", "garlic", "potato", "carrot", "radish", "turnip",
        "beetroot", "beet", "ginger root", "root vegetable",
    ],
}

# Which food groups each diet forbids being RECOMMENDED.
_DIET_FORBIDS: dict[str, set[str]] = {
    "vegan": {"meat_poultry", "fish_seafood", "animal_broth", "egg",
              "dairy", "honey"},
    "vegetarian": {"meat_poultry", "fish_seafood", "animal_broth", "egg"},
    "eggetarian": {"meat_poultry", "fish_seafood", "animal_broth"},
    "jain": {"meat_poultry", "fish_seafood", "animal_broth", "egg",
             "root_veg"},
    "pescatarian": {"meat_poultry"},
}

# Supplement slugs / display-name fragments that are animal-derived and
# therefore questionable for a vegetarian-spectrum client.
_ANIMAL_SUPPLEMENT_HINTS = [
    "fish-oil", "fish oil", "cod-liver", "cod liver", "krill",
    "bovine", "gelatin", "gelatine", "collagen", "bone-broth",
    "desiccated-liver", "oyster",
]


def _normalise_diet(pref: str | None) -> str | None:
    """Map a freeform dietary_preference string to a canonical diet key.
    Returns None when the preference is empty / unrecognised (check skipped)."""
    if not pref:
        return None
    p = pref.strip().lower()
    if not p:
        return None
    if "vegan" in p:
        return "vegan"
    if "jain" in p:
        return "jain"
    if "eggetarian" in p or "ovo" in p or "egg-etarian" in p:
        return "eggetarian"
    if "pescatarian" in p or "pescetarian" in p:
        return "pescatarian"
    # "non-vegetarian" / "non veg" / "nonveg" → nothing forbidden, skip.
    if "non" in p and "veg" in p:
        return "non_vegetarian"
    if "vegetarian" in p or p == "veg":
        return "vegetarian"
    return None


# Negation cues. When one of these appears just before a food word, the
# food is being EXCLUDED, not recommended — e.g. "no meat, fish or
# poultry", "stand-in for bone broth", "instead of chicken". The check
# must not fire on those. Bare "free" is deliberately NOT a cue (it would
# wrongly suppress "free-range chicken").
_NEGATION_CUES = [
    "no ", "not ", "non-", "non ", "without", "avoid", "skip", "never",
    "exclud", "minus ", "instead of", "stand-in", "stand in", "rather than",
    "replace", "free of", "free from", "-free", "sans ", "omit",
]


def _is_negated(low_text: str, match_start: int, match_end: int) -> bool:
    """True when the food word at [match_start:match_end] sits in an
    exclusionary context (preceded by a negation cue within ~40 chars,
    or immediately followed by '-free' / ' free')."""
    before = low_text[max(0, match_start - 40):match_start]
    if any(cue in before for cue in _NEGATION_CUES):
        return True
    after = low_text[match_end:match_end + 6]
    if after.startswith("-free") or after.startswith(" free"):
        return True
    return False


def _diet_hits(text: str, groups: set[str]) -> list[tuple[str, str]]:
    """Return (group, matched_word) for every forbidden token RECOMMENDED in
    text, using word-boundary matching. Multi-word tokens matched as
    phrases. Mentions in an exclusionary context are skipped (see
    _is_negated) — 'no meat' must not be flagged as recommending meat."""
    hits: list[tuple[str, str]] = []
    low = text.lower()
    for group in groups:
        for word in _DIET_TOKENS.get(group, []):
            pattern = r"\b" + _re.escape(word) + r"\b"
            for m in _re.finditer(pattern, low):
                if _is_negated(low, m.start(), m.end()):
                    continue
                hits.append((group, word))
                break  # one hit per word is enough
    return hits


def _check_dietary_consistency(
    plan: Plan, client: Client | None, findings: list[Finding]
) -> None:
    """Flag plan content that contradicts the client's dietary_preference.

    Two failure modes, both seen in real use:
      1. A forbidden food RECOMMENDED (nutrition.add / lifestyle_practices /
         nutrition.pattern). Severity CRITICAL — meat in a vegetarian's
         plan destroys coach credibility and the client cannot follow it.
      2. A forbidden food listed in nutrition.reduce. Severity INFO — not
         harmful (the client never eats it), just irrelevant noise that
         signals the plan wasn't tailored. Trim it for polish.
    Also WARNING on animal-derived supplements (fish oil etc.) for a
    vegetarian-spectrum client — suggest a plant/algae alternative.
    """
    if client is None:
        return
    diet = _normalise_diet(getattr(client, "dietary_preference", None))
    if diet is None or diet == "non_vegetarian":
        return  # unknown or unrestricted — nothing to check
    forbids = _DIET_FORBIDS.get(diet, set())
    if not forbids:
        return
    diet_label = diet.replace("_", "-")

    # --- 1. Forbidden foods RECOMMENDED (nutrition.add) ---
    for item in plan.nutrition.add:
        for group, word in _diet_hits(item, forbids):
            findings.append(Finding(
                "CRITICAL", "nutrition", "add",
                (f"recommends {word!r} but the client is {diet_label} — "
                 f"this food is not eaten on that diet. Replace with a "
                 f"{diet_label}-appropriate alternative."),
                target=word,
            ))

    # --- Forbidden foods recommended in lifestyle practices ---
    for prac in plan.lifestyle_practices:
        blob = f"{prac.name} {prac.details}"
        for group, word in _diet_hits(blob, forbids):
            findings.append(Finding(
                "CRITICAL", "lifestyle_practices", "name",
                (f"practice {prac.name!r} references {word!r} — not eaten "
                 f"on a {diet_label} diet. Reword for this client."),
                target=word,
            ))

    # --- Forbidden foods in the nutrition pattern blurb ---
    for group, word in _diet_hits(plan.nutrition.pattern, forbids):
        findings.append(Finding(
            "CRITICAL", "nutrition", "pattern",
            (f"nutrition pattern mentions {word!r} but the client is "
             f"{diet_label}. Rewrite the pattern description."),
            target=word,
        ))

    # --- 2. Forbidden foods in nutrition.reduce → irrelevant noise (INFO) ---
    for item in plan.nutrition.reduce:
        for group, word in _diet_hits(item, forbids):
            findings.append(Finding(
                "INFO", "nutrition", "reduce",
                (f"'reduce {word}' is redundant — a {diet_label} client "
                 f"already never eats it. Remove it so the plan reads as "
                 f"genuinely tailored, not generic."),
                target=word,
            ))

    # --- 3. Animal-derived supplements for a vegetarian-spectrum client ---
    # Skipped entirely when the client told us at intake they accept
    # animal-derived supplements (animal_derived_supplements_ok == "yes").
    # When "no" the WARNING escalates to CRITICAL — they explicitly
    # refused these. When unset / "unsure", stays WARNING.
    accepts_animal_supp = str(
        getattr(client, "animal_derived_supplements_ok", "") or ""
    ).strip().lower()
    if diet in ("vegan", "vegetarian", "eggetarian", "jain") and accepts_animal_supp != "yes":
        supp_severity: Severity = (
            "CRITICAL" if accepts_animal_supp == "no" else "WARNING"
        )
        for supp in plan.supplement_protocol:
            blob = (
                f"{supp.supplement_slug} {supp.display_name or ''} "
                f"{supp.form}"
            ).lower()
            for hint in _ANIMAL_SUPPLEMENT_HINTS:
                if hint in blob:
                    refused = accepts_animal_supp == "no"
                    findings.append(Finding(
                        supp_severity, "supplement_protocol", "supplement_slug",
                        (f"{supp.supplement_slug!r} appears animal-derived "
                         f"({hint!r}) — the client is {diet_label} and "
                         + ("told us at intake they do NOT accept "
                            "animal-derived supplements. Swap to a "
                            "plant/algae alternative (e.g. algal omega-3 "
                            "for fish oil)."
                            if refused else
                            "their intake form did not confirm they accept "
                            "animal-derived supplements. Confirm with them, "
                            "or swap to a plant/algae alternative (e.g. "
                            "algal omega-3 for fish oil).")),
                        target=supp.supplement_slug,
                    ))
                    break


# ---------------------------------------------------------------------------
# Food-first redundancy
# ---------------------------------------------------------------------------
# Standing coach rule (2026-05-20): food is prioritised over supplements
# wherever food can do the job. The AI prompts (suggester + plan-chat)
# enforce this at generation time; this deterministic check is the
# catch-net for the clearest case — a supplement that is ALSO covered by
# a food already in nutrition.add. Currently scoped to selenium / Brazil
# nuts (the documented example); extend the map as more clear cases emerge.
#
# Map: supplement slug → (food keyword in nutrition.add, human food name).
_FOOD_FIRST_REDUNDANT: dict[str, tuple[str, str]] = {
    "selenium": ("brazil nut", "Brazil nuts"),
}


def _check_food_first_redundancy(plan: Plan, findings: list[Finding]) -> None:
    """INFO when a supplement is in the protocol AND the food that can
    replace it is already in nutrition.add — the supplement is redundant
    under the food-first rule."""
    add_blob = " ".join(plan.nutrition.add).lower()
    for supp in plan.supplement_protocol:
        entry = _FOOD_FIRST_REDUNDANT.get(supp.supplement_slug)
        if not entry:
            continue
        food_kw, food_name = entry
        if food_kw in add_blob:
            findings.append(Finding(
                "INFO", "supplement_protocol", "supplement_slug",
                (f"{supp.supplement_slug!r} is in the protocol but "
                 f"{food_name} are already in nutrition.add — under the "
                 f"food-first rule the supplement is redundant. Drop the "
                 f"supplement and keep the food, unless a therapeutic dose "
                 f"above food levels is genuinely needed."),
                target=supp.supplement_slug,
            ))


# Heavy-metal chelation / mobilising agents. Per The Autoimmune Solution
# (Appendix B) and standard FM practice, mobilising stored metals before the
# gut is healed and detox/elimination pathways are open risks reabsorption —
# "run, don't walk, from any provider who wants to chelate you first." This is a
# non-negotiable SAFETY rule, so it lives in the deterministic checker (always
# fires, blocks/gates) rather than as an evidence-graph claim (ranked + capped
# at MAX_CLAIMS, so it may never reach the assess prompt).
_CHELATION_TOKENS = ("dmsa", "dmps", "edta", "dimercapto", "chelat")
_MOULD_MCAS_TOKENS = ("mould", "mold", "mcas", "mast cell", "cirs", "mycotoxin")


def _check_aggressive_detox(
    plan: Plan, client: Client | None, findings: list[Finding]
) -> None:
    """WARNING when the protocol contains a chelation / metal-mobilising agent.

    Mobilising stored heavy metals before the gut is healed and detox pathways
    are supported can drive reabsorption and harm — highest-risk with a
    mould/MCAS history. WARNING (requires ack to publish), never a silent pass.
    """
    for item in plan.supplement_protocol:
        haystack = " ".join(
            str(x).lower()
            for x in (
                item.supplement_slug,
                getattr(item, "display_name", "") or "",
                getattr(item, "coach_rationale", "") or "",
            )
        )
        if not any(tok in haystack for tok in _CHELATION_TOKENS):
            continue
        detail = (
            f"{item.supplement_slug!r} looks like a chelation / metal-mobilising "
            "agent. Confirm the gut is healed and detox + elimination pathways are "
            "open and supported BEFORE mobilising stored metals — doing it first "
            "risks reabsorption (The Autoimmune Solution, Appendix B). Sequence "
            "gut-first; this is clinician-supervised territory."
        )
        # Escalate the NOTE (not the severity) when the client's history flags
        # mould / mast-cell involvement — the highest-risk scenario.
        if client is not None:
            hist = " ".join(
                str(x).lower()
                for x in (
                    list(getattr(client, "medical_history", []) or [])
                    + list(getattr(client, "active_conditions", []) or [])
                    + [getattr(client, "reported_triggers", "") or ""]
                )
            )
            if any(tok in hist for tok in _MOULD_MCAS_TOKENS):
                detail += (
                    " Client history flags mould/mast-cell involvement — do NOT "
                    "run aggressive detox until immune status is known."
                )
        findings.append(
            Finding(
                "WARNING", "supplement_protocol", "aggressive_detox",
                detail, target=item.supplement_slug,
            )
        )


# Gluten in an autoimmune client. Per The Autoimmune Solution (ch. 5), even
# trace gluten can keep anti-self antibodies elevated for weeks in autoimmune /
# gluten-reactive conditions, so gluten avoidance must be 100% — a
# non-negotiable rule that belongs in the checker, not the evidence graph.
# Only unambiguous gluten grains are listed (bread/pasta excluded — GF versions
# are common); `_is_negated` already suppresses "gluten-free" / "avoid gluten".
_AUTOIMMUNE_CONDITION_TOKENS = (
    "autoimmun", "hashimoto", "graves", "lupus", "sle", "rheumatoid",
    "psoriasis", "psoriatic", "sjogren", "sjögren", "multiple sclerosis",
    "celiac", "coeliac", "crohn", "ulcerative colitis", "inflammatory bowel",
    "type 1 diabetes", "t1dm", "vitiligo", "alopecia areata", "thyroiditis",
    "myasthenia", "scleroderma", "ankylosing spondylitis", "antiphospholipid",
    "addison", "pernicious anemia",
)
_GLUTEN_TOKENS = (
    "gluten", "wheat", "atta", "maida", "roti", "chapati", "chapathi",
    "phulka", "paratha", "naan", "seitan", "barley", "rye", "semolina",
    "suji", "sooji", "rava", "spelt", "kamut", "triticale", "couscous",
    "bulgur", "dalia", "daliya",
)


def _gluten_hits(text: str) -> list[str]:
    """Gluten-bearing tokens RECOMMENDED in text (word-boundary; skips
    exclusionary/"-free" contexts via _is_negated)."""
    low, out = text.lower(), []
    for word in _GLUTEN_TOKENS:
        for m in _re.finditer(r"\b" + _re.escape(word) + r"\b", low):
            if _is_negated(low, m.start(), m.end()):
                continue
            out.append(word)
            break
    return out


def _check_gluten_in_autoimmune(
    plan: Plan, client: Client | None, findings: list[Finding]
) -> None:
    """WARNING when a gluten-bearing food is recommended to a client whose
    conditions/history flag autoimmunity. WARNING (not CRITICAL) because
    food-string matching is fuzzy and a reintroduction phase can be a genuine
    exception — but it requires explicit ack to publish, enforcing the rule."""
    if client is None:
        return
    cond_blob = " ".join(
        str(x).lower()
        for x in (
            list(getattr(client, "active_conditions", []) or [])
            + list(getattr(client, "medical_history", []) or [])
        )
    )
    if not any(tok in cond_blob for tok in _AUTOIMMUNE_CONDITION_TOKENS):
        return  # rule applies only to autoimmune / spectrum clients

    seen: set[str] = set()

    def _flag(section: str, field: str, word: str, ctx: str) -> None:
        if word in seen:
            return
        seen.add(word)
        findings.append(Finding(
            "WARNING", section, field,
            (f"{ctx} {word!r} (gluten-bearing), but the client has an autoimmune "
             "condition — gluten should be removed 100%. Even trace gluten can "
             "keep anti-self antibodies elevated for weeks (The Autoimmune "
             "Solution, ch. 5). Swap for a gluten-free alternative, or ack if this "
             "is a deliberate reintroduction."),
            target=word,
        ))

    for item in plan.nutrition.add:
        for w in _gluten_hits(item):
            _flag("nutrition", "add", w, "recommends")
    for prac in plan.lifestyle_practices:
        for w in _gluten_hits(f"{prac.name} {prac.details}"):
            _flag("lifestyle_practices", "name", w, f"practice {prac.name!r} references")
    for w in _gluten_hits(plan.nutrition.pattern):
        _flag("nutrition", "pattern", w, "nutrition pattern mentions")


def check_plan(plan: Plan, client: Client | None, catalogue: Loaded) -> list[Finding]:
    """Run deterministic checks. Returns findings sorted by severity."""
    findings: list[Finding] = []

    # ---------- Sanity-check the client's active_conditions list ----------
    # Real-use bug 2026-05-16: cl-006 (Geetika) had Type 1 diabetes + Type 2
    # diabetes + Insulinoma co-listed (clinically incompatible). The AI's
    # plan generator then surfaced safety warnings about this bogus combo.
    # Cleaner to catch the bad data here at check-time so coach sees a
    # WARNING on the plan editor BEFORE the AI runs downstream.
    if client is not None:
        existing_conds = list(getattr(client, "active_conditions", []) or [])

        # Clinically-incompatible pairs that are almost always extraction
        # noise rather than dual diagnoses.
        INCOMPATIBLE_PAIRS = [
            ({"type 1 diabetes", "t1dm"}, {"type 2 diabetes", "t2dm"}),
            ({"insulinoma"}, {"type 1 diabetes", "t1dm", "type 2 diabetes", "t2dm",
                              "prediabetes"}),
        ]
        for a_set, b_set in INCOMPATIBLE_PAIRS:
            a_hit = next((c for c in existing_conds
                          if any(t in c.lower() for t in a_set)), None)
            b_hit = next((c for c in existing_conds
                          if any(t in c.lower() for t in b_set)), None)
            if a_hit and b_hit:
                findings.append(Finding(
                    "WARNING", "client", "active_conditions",
                    (f"Co-listed clinically-incompatible conditions: "
                     f"{a_hit!r} + {b_hit!r}. Likely extraction noise — "
                     f"verify with the client and prune the bogus entry "
                     f"from client.yaml.active_conditions."),
                ))

        # "At risk for X" framings — coach assessments, not diagnoses.
        for c in existing_conds:
            cl = c.lower()
            if "at risk for " in cl or "at risk of " in cl:
                findings.append(Finding(
                    "INFO", "client", "active_conditions",
                    (f"{c!r} reads as a coach assessment, not a confirmed "
                     f"diagnosis. Consider moving to notes_for_coach or "
                     f"presenting_symptoms."),
                ))

        # Substring-duplicate detection (e.g. "Prediabetes" alongside
        # "Prediabetes (HbA1c 6.20%)") — surface so coach can keep the
        # one with more detail.
        for i, a in enumerate(existing_conds):
            al = a.lower().strip()
            for j, b in enumerate(existing_conds):
                if i >= j: continue
                bl = b.lower().strip()
                if al == bl or al in bl or bl in al:
                    findings.append(Finding(
                        "INFO", "client", "active_conditions",
                        (f"Possible duplicate: {a!r} and {b!r}. Keep "
                         f"whichever carries more detail."),
                    ))
                    break  # one warning per pair is enough

    # ---------- Build resolution indexes (alias-aware) ----------
    # All entity kinds that carry .aliases get alias-aware lookup so a
    # plan can reference "niacin-b3" and resolve to canonical "niacin"
    # without a CRITICAL "unknown slug" finding.
    topic_idx = _resolve_index(catalogue.topics)
    mech_idx = _resolve_index(catalogue.mechanisms)
    sym_idx = _resolve_index(catalogue.symptoms)
    supp_idx = _resolve_index(catalogue.supplements)
    ca_idx = _resolve_index(catalogue.cooking_adjustments)
    hr_idx = _resolve_index(catalogue.home_remedies)
    ts_idx = _resolve_index(getattr(catalogue, "tissue_salts", []) or [])
    claim_slugs = {c.slug for c in catalogue.claims}     # Claim has no aliases
    supp_by_slug = {s.slug: s for s in catalogue.supplements}

    def _xref(section, field, target, idx_or_set, kind):
        if isinstance(idx_or_set, dict):
            ok = target in idx_or_set
        else:
            ok = target in idx_or_set
        if not ok:
            findings.append(Finding(
                "CRITICAL", section, field,
                f"references unknown {kind} {target!r}", target=target,
            ))

    # ---------- Assessment ----------
    for slug in plan.primary_topics:
        _xref("assessment", "primary_topics", slug, topic_idx, "topic")
    for slug in plan.contributing_topics:
        _xref("assessment", "contributing_topics", slug, topic_idx, "topic")
    for slug in plan.presenting_symptoms:
        _xref("assessment", "presenting_symptoms", slug, sym_idx, "symptom")
    for hd in plan.hypothesized_drivers:
        _xref("assessment", "hypothesized_drivers.mechanism",
              hd.mechanism, mech_idx, "mechanism")

    # ---------- Nutrition (CookingAdjustment + HomeRemedy slugs) ----------
    for slug in plan.nutrition.cooking_adjustments:
        _xref("nutrition", "cooking_adjustments", slug, ca_idx, "cooking_adjustment")
    for slug in plan.nutrition.home_remedies:
        _xref("nutrition", "home_remedies", slug, hr_idx, "home_remedy")

    # ---------- Ayurveda section (slug xref + dosha-mismatch safety) ----------
    if plan.ayurveda:
        for slug in plan.ayurveda.remedies:
            _xref("ayurveda", "remedies", slug, hr_idx, "home_remedy")

    # ---------- Tissue-salts section (Schüssler) ----------
    # Every salt_slug must resolve to a catalogue TissueSalt (alias-aware). The
    # suggester is subgraph-bound and generate-draft drops unknown slugs, so this
    # is a safety net for hand-edits / future drift.
    if plan.tissue_salts:
        for _it in plan.tissue_salts.salts:
            _xref("tissue_salts", "salt_slug", _it.salt_slug, ts_idx, "tissue_salt")

    # Dosha mismatch: a remedy whose `aggravates_dosha` intersects the client's
    # currently-aggravated doshas (vikruti) is a safety concern — e.g. a heating
    # kapha-clearing tea recommended to a pitta-aggravated client. Covers BOTH
    # nutrition.home_remedies and the Ayurveda section's remedies. Fires only
    # when the client has a constitution assessment with structured
    # vikruti_doshas; silent otherwise (no false positives on un-assessed clients).
    hr_by_slug = {h.slug: h for h in catalogue.home_remedies}
    vikruti_doshas: set[str] = set()
    if client and isinstance(client.ayurveda_assessment, dict):
        vikruti_doshas = {
            str(d).lower()
            for d in (client.ayurveda_assessment.get("vikruti_doshas") or [])
        }
    if vikruti_doshas:
        remedy_slugs = list(plan.nutrition.home_remedies)
        if plan.ayurveda:
            remedy_slugs += list(plan.ayurveda.remedies)
        _seen: set[str] = set()
        for slug in remedy_slugs:
            if slug in _seen:
                continue
            _seen.add(slug)
            canonical = hr_idx.get(slug)
            hr = hr_by_slug.get(canonical) if canonical else None
            if not hr:
                continue  # unknown slug already flagged CRITICAL by _xref
            aggravated = {d.value for d in hr.aggravates_dosha} & vikruti_doshas
            if aggravated:
                findings.append(Finding(
                    "WARNING", "ayurveda", "remedies",
                    f"{slug!r} aggravates {'/'.join(sorted(aggravated))}, but the client "
                    f"is currently {'/'.join(sorted(vikruti_doshas))}-aggravated (vikruti) — "
                    "this remedy may worsen the imbalance. Confirm or swap for a "
                    "dosha-appropriate alternative.",
                    target=slug,
                ))

        # Same dosha-mismatch check for SUPPLEMENTS in the protocol — supplements
        # now carry balances/aggravates_dosha energetics too (rasa/virya/vipaka).
        for item in plan.supplement_protocol:
            canonical = supp_idx.get(item.supplement_slug)
            supp = supp_by_slug.get(canonical) if canonical else None
            if not supp:
                continue
            agg = {d.value for d in getattr(supp, "aggravates_dosha", []) or []} & vikruti_doshas
            if agg:
                findings.append(Finding(
                    "WARNING", "supplement_protocol", "aggravates_dosha",
                    f"{item.supplement_slug!r} aggravates {'/'.join(sorted(agg))}, but the client "
                    f"is currently {'/'.join(sorted(vikruti_doshas))}-aggravated (vikruti) — "
                    "consider a dosha-appropriate alternative or pair it with a pacifying anupana.",
                    target=item.supplement_slug,
                ))

    # Low-confidence constitution advisory: the client is on the Ayurveda track
    # and the plan carries an Ayurveda section, but the constitution read is weak
    # (low / pending the dosha quiz). Flag it so the coach decides whether to
    # confirm the type first or reconsider including the Ayurveda layer at all.
    if plan.ayurveda and client and getattr(client, "ayurveda_enabled", False):
        _assess = client.ayurveda_assessment if isinstance(
            getattr(client, "ayurveda_assessment", None), dict) else {}
        _conf = str(_assess.get("prakruti_confidence") or "").lower()
        if _conf in ("low", "pending_quiz"):
            _adv = str(_assess.get("advisory") or "").strip()
            findings.append(Finding(
                "WARNING", "ayurveda", "constitution",
                _adv or (
                    "constitution read is provisional/low-confidence — send the dosha quiz "
                    "to establish prakruti, or reconsider including the Ayurveda layer for "
                    "this client."
                ),
            ))

    # ---------- Education modules ----------
    for em in plan.education:
        if em.target_kind == "topic":
            _xref("education", "target_slug", em.target_slug, topic_idx, "topic")
        elif em.target_kind == "mechanism":
            _xref("education", "target_slug", em.target_slug, mech_idx, "mechanism")
        elif em.target_kind == "claim":
            _xref("education", "target_slug", em.target_slug, claim_slugs, "claim")
        else:
            findings.append(Finding(
                "CRITICAL", "education", "target_kind",
                f"target_kind must be topic|mechanism|claim, got {em.target_kind!r}",
                target=em.target_slug,
            ))

    # ---------- Supplement protocol ----------
    for item in plan.supplement_protocol:
        # start_week sanity — phased protocols set this; it must land
        # inside the plan window or the supplement never gets introduced.
        sw = getattr(item, "start_week", 1) or 1
        if sw < 1:
            findings.append(Finding(
                "WARNING", "supplement_protocol", "start_week",
                f"{item.supplement_slug!r} has start_week {sw} (< 1) — "
                "weeks are 1-indexed. Set to 1 to start immediately.",
                target=item.supplement_slug,
            ))
        elif sw > plan.plan_period_weeks:
            findings.append(Finding(
                "WARNING", "supplement_protocol", "start_week",
                f"{item.supplement_slug!r} starts in week {sw} but the plan "
                f"is only {plan.plan_period_weeks} weeks long — it would "
                "never actually be introduced. Lower start_week or extend "
                "the plan period.",
                target=item.supplement_slug,
            ))

        # Alias-aware: resolve to canonical slug; if not in index at all,
        # genuinely unknown.
        canonical_supp = supp_idx.get(item.supplement_slug)
        if canonical_supp is None:
            findings.append(Finding(
                "CRITICAL", "supplement_protocol", "supplement_slug",
                f"references unknown supplement {item.supplement_slug!r}",
                target=item.supplement_slug,
            ))
            continue

        supp = supp_by_slug[canonical_supp]

        # Evidence-tier honesty: confirm_with_clinician supplements warrant a flag
        if supp.evidence_tier.value == "confirm_with_clinician":
            findings.append(Finding(
                "WARNING", "supplement_protocol", "evidence_tier",
                f"{item.supplement_slug!r} is tagged 'confirm_with_clinician' in the "
                "catalogue — coach is authoring this without clinician sign-off. "
                "Acknowledge if intentional.",
                target=item.supplement_slug,
            ))

        # Contraindication check vs client conditions
        if client:
            client_conditions_lower = {c.lower() for c in client.active_conditions}
            client_meds_lower = {m.lower() for m in client.current_medications}
            for cond in supp.contraindications.conditions:
                if cond.lower() in client_conditions_lower:
                    findings.append(Finding(
                        "CRITICAL", "supplement_protocol", "contraindications",
                        f"{item.supplement_slug!r} is contraindicated with client's "
                        f"active condition {cond!r}",
                        target=item.supplement_slug,
                    ))
            for med_inter in supp.interactions.with_medications:
                if med_inter.medication.lower() in client_meds_lower:
                    findings.append(Finding(
                        "WARNING" if med_inter.type.value != "avoid_together" else "CRITICAL",
                        "supplement_protocol", "interactions.with_medications",
                        f"{item.supplement_slug!r} interacts with client's medication "
                        f"{med_inter.medication!r}: {med_inter.reason}",
                        target=item.supplement_slug,
                    ))

        # Form sanity: declared form contains at least one catalogue form word.
        # The AI often writes descriptive strings like "KSM-66 standardized
        # extract capsule" — we accept these as long as a catalogue form token
        # appears anywhere in the string (case-insensitive substring match).
        if item.form:
            valid_forms = {f.value for f in supp.forms_available}
            form_lower = item.form.lower()
            if valid_forms and not any(vf in form_lower for vf in valid_forms):
                findings.append(Finding(
                    "WARNING", "supplement_protocol", "form",
                    f"{item.supplement_slug!r} doesn't list {item.form!r} as an "
                    f"available form (catalogue has: {sorted(valid_forms)})",
                    target=item.supplement_slug,
                ))

    # ---------- Tracking ----------
    # symptoms_to_monitor accepts a mix of:
    #   - catalogue symptom slugs (validated against sym_idx)
    #   - freeform monitoring instructions for the client letter (skipped)
    # Heuristic: an entry containing a space or sentence-ending punctuation
    # is clearly prose, not a slug. Same pattern as tracking.habits (freeform
    # by design — see CLAUDE.md: "Practices and tracking habits are FREEFORM
    # strings, NOT entity types").
    for entry in plan.tracking.symptoms_to_monitor:
        if " " in entry or any(ch in entry for ch in ".—"):
            continue  # freeform monitoring instruction, not a slug
        _xref("tracking", "symptoms_to_monitor", entry, sym_idx, "symptom")

    # ---------- Internal coherence ----------
    if not plan.primary_topics:
        findings.append(Finding(
            "WARNING", "assessment", "primary_topics",
            "no primary_topics declared — assessment is unanchored",
        ))
    # Only flag an empty presenting_symptoms list when the plan also lacks
    # any primary_topics — i.e. the entire assessment block is bare. If
    # primary_topics exist, the coach has clearly anchored the plan even
    # without symptom slugs, and the warning was just noise.
    if not plan.presenting_symptoms and not plan.primary_topics:
        findings.append(Finding(
            "INFO", "assessment", "presenting_symptoms",
            "presenting_symptoms is empty — add the symptom slugs the client "
            "presented with (or carry them over from the assess session's "
            "selected_symptoms).",
        ))
    if (plan.supplement_protocol and not plan.hypothesized_drivers):
        findings.append(Finding(
            "WARNING", "assessment", "hypothesized_drivers",
            "supplements declared without any hypothesized_drivers — what's the rationale?",
        ))

    # ---------- Dietary-preference consistency ----------
    _check_dietary_consistency(plan, client, findings)

    # ---------- Food-first redundancy ----------
    _check_food_first_redundancy(plan, findings)

    # ---------- Aggressive-detox / chelation safety ----------
    _check_aggressive_detox(plan, client, findings)

    # ---------- Gluten in an autoimmune client (100% rule) ----------
    _check_gluten_in_autoimmune(plan, client, findings)

    # Sort: CRITICAL first, then WARNING, then INFO
    severity_order = {"CRITICAL": 0, "WARNING": 1, "INFO": 2}
    findings.sort(key=lambda f: (severity_order[f.severity], f.section, f.field))
    return findings
