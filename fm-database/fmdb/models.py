from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .enums import (
    CautionKind,
    CautionSeverity,
    CookingAdjustmentCategory,
    DepletionSeverity,
    Dosha,
    DoseUnit,
    DrugClass,
    ImplicationConfidence,
    EntityStatus,
    EvidenceTier,
    HomeRemedyCategory,
    InteractionType,
    RemedyRoute,
    LabPanelCategory,
    MechanismCategory,
    ProtocolCategory,
    Rasa,
    SafetyStatus,
    SourceQuality,
    SourceType,
    SupplementCategory,
    SupplementForm,
    SymptomCategory,
    SymptomSeverity,
    TakeWithFood,
    Timing,
    TissueSaltCategory,
    Vipaka,
    Virya,
    SuitableSex,
    LifeStage,
)


class DoseRange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    min: float
    max: float
    unit: DoseUnit


class SupplementInteraction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str
    type: InteractionType
    hours: Optional[int] = None
    reason: Optional[str] = None


class FoodInteraction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    food_slug: str
    type: InteractionType
    hours: Optional[int] = None
    reason: Optional[str] = None


class MedicationInteraction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    medication: str
    type: InteractionType
    reason: Optional[str] = None


class Contraindications(BaseModel):
    model_config = ConfigDict(extra="forbid")
    conditions: list[str] = Field(default_factory=list)
    medications: list[str] = Field(default_factory=list)
    life_stages: list[str] = Field(default_factory=list)


class Interactions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    with_supplements: list[SupplementInteraction] = Field(default_factory=list)
    with_foods: list[FoodInteraction] = Field(default_factory=list)
    with_medications: list[MedicationInteraction] = Field(default_factory=list)


class SourceCitation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    quote: Optional[str] = None
    location: Optional[str] = None


class MindMapNode(BaseModel):
    """A node in a hand-curated MindMap tree. Recursive — nodes can have
    children that are themselves nodes."""
    model_config = ConfigDict(extra="forbid")

    label: str
    children: list["MindMapNode"] = Field(default_factory=list)
    # Optional bridge to another catalogue entity — when set, the renderer
    # makes this node clickable / re-centerable.
    linked_kind: Optional[str] = None    # topic | mechanism | symptom | supplement | claim | cooking_adjustment | home_remedy | protocol | lab_test | lab_panel
    linked_slug: Optional[str] = None
    notes: str = ""                       # coach-facing detail surfaced on hover/click


class MindMap(BaseModel):
    """A hand-curated mind map representing one clinical condition viewed
    from multiple lenses (anatomy, root causes, presentation, treatment, etc.).

    Distinct from the auto-generated catalogue-graph mind maps — those derive
    from cross-reference links; these are intentionally authored trees that
    capture clinical thinking at a level the bare catalogue can't.

    Stored at data/mindmaps/<slug>.yaml.
    """
    model_config = ConfigDict(extra="forbid")

    slug: str
    display_name: str
    description: str = ""
    aliases: list[str] = Field(default_factory=list)
    related_topics: list[str] = Field(default_factory=list)
    related_mechanisms: list[str] = Field(default_factory=list)
    tree: list[MindMapNode]                # top-level branches
    sources: list[SourceCitation] = Field(default_factory=list)
    evidence_tier: EvidenceTier
    version: int = 1
    status: EntityStatus = EntityStatus.active
    updated_at: date
    updated_by: str

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"slug must be lowercase ascii alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"slug has malformed hyphens: {v!r}")
        return v


# Allow the recursive children field to resolve
MindMapNode.model_rebuild()


class CookingAdjustment(BaseModel):
    """A swap or technique change in cooking — cookware, oil, water, prep method."""
    model_config = ConfigDict(extra="forbid")

    slug: str
    display_name: str
    aliases: list[str] = Field(default_factory=list)
    category: CookingAdjustmentCategory
    summary: str
    benefits: list[str] = Field(default_factory=list)
    swap_from: list[str] = Field(default_factory=list)   # what this REPLACES
    how_to_use: str = ""
    cautions: list[str] = Field(default_factory=list)
    linked_to_topics: list[str] = Field(default_factory=list)
    linked_to_mechanisms: list[str] = Field(default_factory=list)
    sources: list[SourceCitation] = Field(default_factory=list)
    evidence_tier: EvidenceTier
    version: int = 1
    status: EntityStatus = EntityStatus.active
    updated_at: date
    updated_by: str

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"slug must be lowercase ascii alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"slug has malformed hyphens: {v!r}")
        return v


class HomeRemedy(BaseModel):
    """A traditional / Ayurvedic / kitchen remedy — churans, infused waters, teas, kashayams."""
    model_config = ConfigDict(extra="forbid")

    slug: str
    display_name: str
    aliases: list[str] = Field(default_factory=list)
    category: HomeRemedyCategory
    # How the remedy is used — internal (eaten/drunk) vs external (applied to
    # the body). Orthogonal to category. Defaults to internal so existing
    # entries (teas/waters/churans/juices) load unchanged; external remedies
    # (oil massage, nasya, oil pulling, eyewash, steam, soaks, pastes) set this.
    route: RemedyRoute = RemedyRoute.internal
    summary: str
    indications: list[str] = Field(default_factory=list)         # symptom slugs or topic slugs
    contraindications: list[str] = Field(default_factory=list)   # free-text condition descriptors
    # ── Dosha suitability (Ayurveda safety/matching key) ──────────────────────
    # Many traditional remedies are dosha-specific: a heating kapha-clearing
    # tea (cinnamon/trikatu) is good FOR kapha but AGGRAVATES pitta. These
    # structured tags let the plan checker flag a remedy whose aggravates_dosha
    # intersects the client's current imbalance (vikruti), and let the
    # suggester rank remedies by the client's dosha. Empty = dosha-neutral /
    # not yet tagged (no flag fires). Populated from the remedy's prose
    # (summary / indications / contraindications already state the dosha).
    balances_dosha: list[Dosha] = Field(default_factory=list)    # doshas this remedy pacifies/suits
    aggravates_dosha: list[Dosha] = Field(default_factory=list)  # doshas this remedy can worsen
    # ── Demographic suitability (hard gates for client-facing surfaces) ───────
    # suitable_sex: who the remedy is FOR (default any). suitable_stages:
    # non-empty = ONLY for these life stages (a menstrual-cramps tea is
    # [menstruating, perimenopausal]; a morning-sickness drink is [pregnancy]).
    # avoid_in: hard safety exclusions regardless of indications — a client
    # whose stage matches avoid_in must never be offered the remedy (the
    # free-text contraindications stay as the human-readable layer; this is
    # the machine-enforceable one). Defaults keep all existing entries valid.
    suitable_sex: SuitableSex = SuitableSex.any
    suitable_stages: list[LifeStage] = Field(default_factory=list)
    avoid_in: list[LifeStage] = Field(default_factory=list)
    # ── Full Ayurvedic energetics (parity with Supplement) ────────────────────
    # The balances/aggravates_dosha tags above are the functional matching key;
    # these capture WHY (dravyaguna). All optional / empty = not yet tagged, so
    # existing remedies load unchanged. virya (heating/cooling) is the most
    # decisive and is consistent with the dosha tags (heating → aggravates pitta,
    # balances vata/kapha; cooling → the reverse).
    rasa: list[Rasa] = Field(default_factory=list)               # taste(s) — shad rasa
    virya: Optional[Virya] = None                                # heating/cooling potency
    vipaka: Optional[Vipaka] = None                              # post-digestive effect
    prabhava: str = ""                                           # special action not explained by rasa/virya/vipaka
    ayurvedic_actions: list[str] = Field(default_factory=list)   # karma — e.g. dipana, carminative, nervine
    preparation: str = ""
    typical_dose: str = ""                                       # free-text (varies wildly)
    duration: str = ""                                            # free-text suggested duration
    timing_notes: str = ""
    linked_to_topics: list[str] = Field(default_factory=list)
    linked_to_mechanisms: list[str] = Field(default_factory=list)
    sources: list[SourceCitation] = Field(default_factory=list)
    evidence_tier: EvidenceTier
    version: int = 1
    status: EntityStatus = EntityStatus.active
    updated_at: date
    updated_by: str

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"slug must be lowercase ascii alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"slug has malformed hyphens: {v!r}")
        return v


class TissueSalt(BaseModel):
    """A Schüssler / biochemic tissue salt (cell salt) — a low-potency mineral
    preparation (typically 6X / D6) used as a gentle adjunct in the biochemic
    tradition. Covers the canonical 12 core cell salts, the extended
    supplementary salts, and India's pre-mixed Bio-Combination (BC 1–28) tablets.

    NOT functional-medicine evidence — the biochemic system is traditional /
    empirical. Every entry is tiered fm_specific_thin (🟠) and framed as an
    optional gentle adjunct, never a prescription or a substitute for care. The
    suggester only ever picks FROM this catalogue (subgraph-bound) so client
    letters can never invent a salt or an indication.

    Stored at data/tissue_salts/<slug>.yaml.
    """
    model_config = ConfigDict(extra="forbid")

    slug: str
    display_name: str                                            # e.g. "Calcium Fluoride (No. 1)"
    aliases: list[str] = Field(default_factory=list)             # "Calc Fluor", "Schüssler Salt No. 1", "Cell Salt 1", "Ferr Phos"
    category: TissueSaltCategory
    salt_number: Optional[int] = None                            # 1–12 core, 13+ supplementary, or the BC number
    mineral_compound: str = ""                                   # e.g. "Calcium fluoride (CaF₂)"
    standard_potency: str = ""                                   # e.g. "6X (D6)" — single salts; "3X / 6X" for some BC
    tissue_affinity: list[str] = Field(default_factory=list)     # tissues traditionally associated (elastic fibres, bone surface, etc.)
    # Traditional / biochemic indications — coaching-framed, descriptive ("traditionally
    # used to support …"), never diagnostic. The suggester surfaces these as optional
    # adjuncts only.
    key_indications: list[str] = Field(default_factory=list)
    facial_signs: list[str] = Field(default_factory=list)        # Antlitzanalyse facial-diagnosis cues (educational layer)
    typical_use: str = ""                                        # tablet terms — "3–4 tabs 6X dissolved under the tongue, 2–4×/day"
    combines_with: list[str] = Field(default_factory=list)       # other tissue_salt slugs commonly paired
    component_salts: list[str] = Field(default_factory=list)     # for BC formulas: the single tissue_salt slugs inside
    cautions: list[str] = Field(default_factory=list)            # lactose base, evidence caveat, not-a-substitute, etc.
    india_brands: list[str] = Field(default_factory=list)        # SBL, Dr. Reckeweg, Schwabe, Bakson, …
    linked_to_topics: list[str] = Field(default_factory=list)
    linked_to_symptoms: list[str] = Field(default_factory=list)
    notes_for_coach: str = ""
    notes_for_client: str = ""
    sources: list[SourceCitation] = Field(default_factory=list)
    evidence_tier: EvidenceTier
    version: int = 1
    status: EntityStatus = EntityStatus.active
    updated_at: date
    updated_by: str

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"slug must be lowercase ascii alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"slug has malformed hyphens: {v!r}")
        return v


class ProtocolPhase(BaseModel):
    """One phase of a multi-phase protocol (e.g. 5R: Remove → Replace → Reinoculate → Repair → Rebalance)."""
    model_config = ConfigDict(extra="forbid")

    name: str                                            # e.g. "Remove" / "Phase 1: Foundation"
    weeks: Optional[int] = None                          # weeks this phase typically runs
    summary: str = ""                                    # 1-2 sentence overview
    key_actions: list[str] = Field(default_factory=list) # bullet points of what to do


class Protocol(BaseModel):
    """A structured FM protocol — 5R, AIP, Whole30, weight-loss reset, adrenal recovery, etc.
    A coach picks ONE protocol when their pattern matches the indications and uses it as the
    spine of a 4–12 week plan. Protocols are catalogue-level (curated by Shivani); a Plan
    references a Protocol via Plan.attached_protocols (slug list).
    """
    model_config = ConfigDict(extra="forbid")

    slug: str
    display_name: str
    aliases: list[str] = Field(default_factory=list)
    category: ProtocolCategory
    summary: str                                                  # 1-3 sentences — what this protocol DOES
    indications: list[str] = Field(default_factory=list)          # when to use (free text or symptom/topic slugs)
    contraindications: list[str] = Field(default_factory=list)    # when NOT to use
    typical_duration_weeks: Optional[int] = None                  # total length end-to-end
    phases: list[ProtocolPhase] = Field(default_factory=list)     # multi-phase protocols
    key_steps: list[str] = Field(default_factory=list)            # for simple/single-phase protocols
    foods_to_emphasise: list[str] = Field(default_factory=list)
    foods_to_remove: list[str] = Field(default_factory=list)
    supplements_typically_used: list[str] = Field(default_factory=list)  # supplement slugs
    expected_outcomes: list[str] = Field(default_factory=list)
    cautions: list[str] = Field(default_factory=list)
    # ---- Sequencing (FM-physician thinking) ----
    # prerequisites: complete these protocols FIRST. e.g. weight-loss-metabolic-reset
    # has prerequisite [adrenal-recovery-protocol] when client has HPA dysregulation —
    # fasting + restriction worsen cortisol if adrenal isn't reset first.
    prerequisites: list[str] = Field(default_factory=list)
    # recommended_followup: protocols to consider AFTER this one is complete.
    # e.g. 5R → cycle-sync-protocol (gut healing first, then hormone optimisation).
    recommended_followup: list[str] = Field(default_factory=list)
    # incompatible_with: NEVER combine with these protocols simultaneously.
    # Restrictive elimination diets shouldn't stack (AIP + weight-loss = both
    # caloric deficit + nutrient deficit). Coach picks one.
    incompatible_with: list[str] = Field(default_factory=list)
    linked_to_topics: list[str] = Field(default_factory=list)
    linked_to_mechanisms: list[str] = Field(default_factory=list)
    linked_to_symptoms: list[str] = Field(default_factory=list)
    sources: list[SourceCitation] = Field(default_factory=list)
    evidence_tier: EvidenceTier
    notes_for_coach: str = ""
    version: int = 1
    status: EntityStatus = EntityStatus.active
    updated_at: date
    updated_by: str

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"slug must be lowercase ascii alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"slug has malformed hyphens: {v!r}")
        return v


class NutrientDepletion(BaseModel):
    """One nutrient a drug depletes / impairs absorption of."""
    model_config = ConfigDict(extra="forbid")

    nutrient: str                                                # e.g. "B12", "magnesium", "CoQ10"
    severity: DepletionSeverity = DepletionSeverity.moderate
    mechanism: str = ""                                          # 1-line mechanism (gastric acid suppression, etc.)
    monitoring_recommendation: str = ""                          # what lab + how often
    typical_supplement_dose: str = ""                            # if standard-of-care to supplement


class ConditionImplication(BaseModel):
    """A diagnosis implied by the presence of this medication.

    Captures "this drug almost always means the client has X" so the
    intake handler can auto-populate active_conditions and Assess /
    SOAP can surface "implied diagnoses" when no explicit session
    driver exists yet.

    Example (cromolyn): label="Histamine intolerance / MCAS",
    confidence=high, topic_slug="histamine-intolerance-mcas".
    """
    model_config = ConfigDict(extra="forbid")

    label: str                                                # human-readable diagnosis label
    confidence: ImplicationConfidence = ImplicationConfidence.moderate
    rationale: str = ""                                       # 1-2 sentences why this drug implies this dx
    topic_slug: Optional[str] = None                          # canonical topic — links into catalogue when present


class ProtocolCaution(BaseModel):
    """A constraint on the FM protocol implied by this medication.

    Drives plan-check (warns when supplement_protocol / meal plan / lab
    orders violate the constraint) and meal-plan generator (binds the
    `item` text as a hard constraint in the AI prompt).

    `item` is a free-text string for v1 (e.g. "Aged cheese, fermented
    foods, leftover meat, wine, kombucha"). v2 may lift this to
    catalogue slugs once coverage patterns are clearer.
    """
    model_config = ConfigDict(extra="forbid")

    kind: CautionKind
    item: str                                                 # what to avoid / prefer / monitor (free text)
    severity: CautionSeverity = CautionSeverity.warning
    reason: str = ""                                          # 1-line WHY — surfaced in plan-check findings


class DrugDepletion(BaseModel):
    """A medication and the nutrients it depletes / interferes with.

    Surfaced in the client Overview as auto-flags when a client lists a
    matching medication. Coach sees: which nutrients to monitor, what to
    supplement, what timing-separations matter (e.g. levothyroxine 4h
    apart from calcium / iron).

    Lookup: when client.current_medications contains an entry, we match
    case-insensitively against drug_name + drug_aliases. A single drug-
    class entry (e.g. "ppi") can declare aliases for ALL members of that
    class so coaches don't need a record per brand.
    """
    model_config = ConfigDict(extra="forbid")

    slug: str
    drug_name: str                                               # canonical e.g. "Levothyroxine"
    drug_aliases: list[str] = Field(default_factory=list)        # brand names + abbreviations
    drug_class: DrugClass
    summary: str = ""                                            # 1-2 sentences for context
    depletes: list[NutrientDepletion] = Field(default_factory=list)
    # ── v0.74: drug → likely diagnosis + protocol constraints ──
    # When client.current_medications matches this drug, the intake handler
    # adds each condition_implication.label to active_conditions and the
    # plan-check / meal-plan generator consult protocol_cautions.
    condition_implications: list[ConditionImplication] = Field(default_factory=list)
    protocol_cautions: list[ProtocolCaution] = Field(default_factory=list)
    timing_separations: list[str] = Field(default_factory=list)  # "Take 4h apart from calcium / iron / coffee"
    contraindicated_supplements: list[str] = Field(default_factory=list)  # supplement slugs to AVOID with this drug
    monitoring_labs: list[str] = Field(default_factory=list)     # e.g. "B12 every 6 months", "homocysteine annually"
    coach_notes: str = ""
    linked_to_topics: list[str] = Field(default_factory=list)
    linked_to_mechanisms: list[str] = Field(default_factory=list)
    sources: list[SourceCitation] = Field(default_factory=list)
    evidence_tier: EvidenceTier
    version: int = 1
    status: EntityStatus = EntityStatus.active
    updated_at: date
    updated_by: str

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"slug must be lowercase ascii alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"slug has malformed hyphens: {v!r}")
        return v


class TitrationStep(BaseModel):
    """One row of the supplement titration schedule. Doses are INTEGER counts of
    the product unit (capsule / tablet / scoop) — India coaches can't compound
    custom mg amounts; titration must work within whole-product increments.
    """
    model_config = ConfigDict(extra="forbid")

    week: int                                                    # 1-indexed, week from start
    morning: int = 0                                             # # of units
    midday: int = 0
    evening: int = 0
    bedtime: int = 0
    notes: str = ""                                              # e.g. "with food", "if no GI symptoms"


class TitrationProtocol(BaseModel):
    """A multi-week ramp schedule for a supplement, expressed as integer counts
    of commercially-available product units (vitaone / amazon / iherb).

    Why this matters: in India, FM coaches don't have access to compounding
    pharmacies. Titration has to use whole capsules / tablets / scoops at known
    strengths. Ashwagandha comes in 300mg or 600mg caps; can't titrate from 0
    to 600mg in 50mg steps. The schedule respects this constraint.

    Multiple titration protocols may exist for the same Supplement when the
    indication / target dose / pacing differs (e.g. ashwagandha for adrenal
    recovery vs ashwagandha for thyroid support — different ramps).
    """
    model_config = ConfigDict(extra="forbid")

    slug: str
    display_name: str
    supplement_slug: str                                         # Supplement entity reference
    purpose: str                                                 # 1-2 sentences — why titrate / when to use
    indications: list[str] = Field(default_factory=list)         # symptom slugs / topic slugs / free-text triggers
    contraindications: list[str] = Field(default_factory=list)
    product_strength: str                                        # e.g. "300mg per capsule", "400mg per tablet", "5g per scoop"
    available_at: list[str] = Field(default_factory=list)        # e.g. ["vitaone", "amazon-india", "iherb"]
    target_dose_label: str                                       # human-readable target — "600mg/day"
    target_total_per_day: str = ""                               # parseable total — "600mg" / "1500mg" / "10g"
    schedule: list[TitrationStep] = Field(default_factory=list)
    splittable: bool = False                                     # capsule can be opened + halved (powder inside)
    cautions: list[str] = Field(default_factory=list)
    monitoring: list[str] = Field(default_factory=list)          # what coach should watch for / labs
    notes_for_coach: str = ""
    linked_to_topics: list[str] = Field(default_factory=list)
    linked_to_mechanisms: list[str] = Field(default_factory=list)
    sources: list[SourceCitation] = Field(default_factory=list)
    evidence_tier: EvidenceTier
    version: int = 1
    status: EntityStatus = EntityStatus.active
    updated_at: date
    updated_by: str

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"slug must be lowercase ascii alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"slug has malformed hyphens: {v!r}")
        return v


class LabTest(BaseModel):
    """A single lab biomarker with both conventional + FM-optimal ranges.
    Reusable across many LabPanels. Surfaced in the client UI when
    interpreting uploaded lab values — coach can show 'TSH 4.2 — within
    lab's 0.4–4.5 normal but FM-optimal is 1.0–2.0' side-by-side.
    """
    model_config = ConfigDict(extra="forbid")

    slug: str
    display_name: str                                            # short — "TSH"
    full_name: str                                               # full — "Thyroid Stimulating Hormone"
    aliases: list[str] = Field(default_factory=list)             # alt names + abbreviations
    units: str                                                   # "mIU/L", "ng/mL", "%"
    sample_type: str = ""                                        # "blood", "urine", "saliva", "stool"
    # Conventional reference range (lab's printed range)
    conventional_low: Optional[float] = None
    conventional_high: Optional[float] = None
    # FM-optimal range (functional medicine target)
    fm_optimal_low: Optional[float] = None
    fm_optimal_high: Optional[float] = None
    # When values fall outside optimal but within conventional, FM still flags
    interpretation_low: str = ""                                 # what low values mean clinically
    interpretation_high: str = ""                                # what high values mean clinically
    when_to_order: str = ""                                      # FM indications
    fasting_required: bool = False
    typical_cost_inr: Optional[int] = None                       # rough cost for India context
    linked_to_topics: list[str] = Field(default_factory=list)
    linked_to_mechanisms: list[str] = Field(default_factory=list)
    sources: list[SourceCitation] = Field(default_factory=list)
    evidence_tier: EvidenceTier
    notes_for_coach: str = ""
    # Client-app visibility gate. Default True = shown in the client-facing
    # Lab Vault. Set False for markers too sensitive/alarming to surface in a
    # self-serve client app (tumour markers, disease-propensity scores, DXA
    # fat composition, cardiac-injury / infectious / psych-drug levels) — those
    # stay coach-only. Coach-side surfaces ignore this flag and show everything.
    client_visible: bool = True
    version: int = 1
    status: EntityStatus = EntityStatus.active
    updated_at: date
    updated_by: str

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"slug must be lowercase ascii alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"slug has malformed hyphens: {v!r}")
        return v


class LabPanel(BaseModel):
    """A pre-curated FM lab panel — collection of LabTests for a clinical
    scenario (Hashimoto workup, perimenopause workup, general FM baseline,
    etc.). Coach picks one in /assess or client intake to scaffold lab
    orders without manually picking each test.

    A `general_wellness` panel is the baseline FM 'first appointment'
    workup for clients with vague goals (weight loss, energy, prevention)
    and no specific complaint — gives the coach a comprehensive
    starting picture.
    """
    model_config = ConfigDict(extra="forbid")

    slug: str
    display_name: str
    category: LabPanelCategory
    summary: str                                                 # 1-3 sentences — what this panel reveals
    indications: list[str] = Field(default_factory=list)         # when to order
    tests: list[str] = Field(default_factory=list)               # LabTest slugs (core panel)
    optional_tests: list[str] = Field(default_factory=list)      # LabTest slugs (add-on / context-dependent)
    fasting_required: bool = False
    estimated_cost_inr: Optional[int] = None                     # rough panel cost in INR
    typical_turnaround_days: Optional[int] = None
    linked_to_topics: list[str] = Field(default_factory=list)
    linked_to_mechanisms: list[str] = Field(default_factory=list)
    notes_for_coach: str = ""
    sources: list[SourceCitation] = Field(default_factory=list)
    evidence_tier: EvidenceTier
    version: int = 1
    status: EntityStatus = EntityStatus.active
    updated_at: date
    updated_by: str

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"slug must be lowercase ascii alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"slug has malformed hyphens: {v!r}")
        return v


class Symptom(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str
    display_name: str
    aliases: list[str] = Field(default_factory=list)
    category: SymptomCategory
    severity: SymptomSeverity = SymptomSeverity.common
    description: str
    when_to_refer: str = ""
    linked_to_topics: list[str] = Field(default_factory=list)
    linked_to_mechanisms: list[str] = Field(default_factory=list)
    notes_for_coach: str = ""
    sources: list[SourceCitation] = Field(default_factory=list)
    version: int = 1
    status: EntityStatus = EntityStatus.active
    updated_at: date
    updated_by: str

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"slug must be lowercase ascii alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"slug has malformed hyphens: {v!r}")
        return v


class Mechanism(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str
    display_name: str
    aliases: list[str] = Field(default_factory=list)
    category: MechanismCategory
    summary: str
    upstream_drivers: list[str] = Field(default_factory=list)
    downstream_effects: list[str] = Field(default_factory=list)
    related_mechanisms: list[str] = Field(default_factory=list)
    linked_to_topics: list[str] = Field(default_factory=list)
    notes_for_coach: str = ""
    sources: list[SourceCitation] = Field(default_factory=list)
    evidence_tier: EvidenceTier
    version: int = 1
    status: EntityStatus = EntityStatus.active
    updated_at: date
    updated_by: str

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"slug must be lowercase ascii alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"slug has malformed hyphens: {v!r}")
        return v


class Claim(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str
    statement: str
    evidence_tier: EvidenceTier
    rationale: str
    coaching_translation: str = ""
    out_of_scope_notes: str = ""
    caveats: list[str] = Field(default_factory=list)
    linked_to_topics: list[str] = Field(default_factory=list)
    linked_to_mechanisms: list[str] = Field(default_factory=list)
    linked_to_supplements: list[str] = Field(default_factory=list)
    sources: list[SourceCitation] = Field(default_factory=list)
    version: int = 1
    status: EntityStatus = EntityStatus.active
    updated_at: date
    updated_by: str

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"slug must be lowercase ascii alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"slug has malformed hyphens: {v!r}")
        return v


class Topic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str
    display_name: str
    aliases: list[str] = Field(default_factory=list)
    summary: str
    common_symptoms: list[str] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    related_topics: list[str] = Field(default_factory=list)
    key_mechanisms: list[str] = Field(default_factory=list)
    coaching_scope_notes: str = ""
    clinician_scope_notes: str = ""
    notes_for_coach: str = ""
    sources: list[SourceCitation] = Field(default_factory=list)
    evidence_tier: EvidenceTier
    version: int = 1
    status: EntityStatus = EntityStatus.active
    updated_at: date
    updated_by: str

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"slug must be lowercase ascii alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"slug has malformed hyphens: {v!r}")
        return v


class Source(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    source_type: SourceType
    quality: SourceQuality
    authors: list[str] = Field(default_factory=list)
    year: Optional[int] = None
    publisher: Optional[str] = None
    url: Optional[str] = None
    internal_path: Optional[str] = None
    doi: Optional[str] = None
    notes: str = ""
    version: int = 1
    status: EntityStatus = EntityStatus.active
    updated_at: date
    updated_by: str

    @field_validator("id")
    @classmethod
    def _id_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"id must be lowercase ascii alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"id has malformed hyphens: {v!r}")
        return v


class Supplement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str
    display_name: str
    # Alternate names / regional synonyms — used by the alias-aware validator
    # so `linked_to_supplements: methi` resolves to the canonical `fenugreek`
    # supplement, and `linked_to_supplements: bacopa-monnieri` resolves to
    # `brahmi`. Same pattern as topics / mechanisms / symptoms.
    aliases: list[str] = Field(default_factory=list)
    category: SupplementCategory
    forms_available: list[SupplementForm]
    typical_dose_range: dict[str, DoseRange]
    timing_options: list[Timing]
    take_with_food: TakeWithFood = TakeWithFood.optional
    contraindications: Contraindications = Field(default_factory=Contraindications)
    interactions: Interactions = Field(default_factory=Interactions)
    # Pregnancy / lactation safety overlay — drives auto-flag in the plan
    # editor + client overview when the client's PregnancyStatus indicates
    # any contraindication / caution. Default `unknown` is conservative —
    # coach treats unknown supplements as caution until catalogue is updated.
    pregnancy_safety: SafetyStatus = SafetyStatus.unknown
    lactation_safety: SafetyStatus = SafetyStatus.unknown
    pregnancy_safety_note: str = ""                              # 1-2 sentence rationale
    # ── Ayurvedic energetics (dravyaguna) ──────────────────────────────────
    # Captured from Ayurvedic materia medica (e.g. The Yoga of Herbs). Lets the
    # suggester match a herb's energetics to the client's dosha/vikruti and the
    # plan checker flag a heating herb for a pitta client — the same structured
    # approach as HomeRemedy.balances_dosha. All optional; empty/None = not yet
    # tagged (no flag fires), so the 351 existing supplements load unchanged.
    rasa: list[Rasa] = Field(default_factory=list)               # taste(s) — shad rasa
    virya: Optional[Virya] = None                                # heating/cooling potency
    vipaka: Optional[Vipaka] = None                              # post-digestive effect
    prabhava: str = ""                                           # special action not explained by rasa/virya/vipaka
    balances_dosha: list[Dosha] = Field(default_factory=list)    # doshas this herb pacifies/suits
    aggravates_dosha: list[Dosha] = Field(default_factory=list)  # doshas this herb can worsen
    ayurvedic_actions: list[str] = Field(default_factory=list)   # karma — e.g. diaphoretic, nervine, expectorant
    linked_to_topics: list[str] = Field(default_factory=list)
    linked_to_mechanisms: list[str] = Field(default_factory=list)
    linked_to_claims: list[str] = Field(default_factory=list)
    notes_for_coach: str = ""
    notes_for_client: str = ""
    sources: list[SourceCitation] = Field(default_factory=list)
    evidence_tier: EvidenceTier
    version: int = 1
    status: EntityStatus = EntityStatus.active
    updated_at: date
    updated_by: str

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"slug must be lowercase ascii alphanumeric with hyphens, got {v!r}")
        if v.startswith("-") or v.endswith("-") or "--" in v:
            raise ValueError(f"slug has malformed hyphens: {v!r}")
        return v

    @field_validator("typical_dose_range")
    @classmethod
    def _dose_keys_are_known_forms(cls, v: dict[str, DoseRange]) -> dict[str, DoseRange]:
        valid = {f.value for f in SupplementForm}
        for key in v:
            if key not in valid:
                raise ValueError(f"unknown supplement form in typical_dose_range: {key!r}")
        return v
