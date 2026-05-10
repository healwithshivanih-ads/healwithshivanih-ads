from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .enums import (
    CookingAdjustmentCategory,
    DepletionSeverity,
    DoseUnit,
    DrugClass,
    EntityStatus,
    EvidenceTier,
    HomeRemedyCategory,
    InteractionType,
    MechanismCategory,
    ProtocolCategory,
    SourceQuality,
    SourceType,
    SupplementCategory,
    SupplementForm,
    SymptomCategory,
    SymptomSeverity,
    TakeWithFood,
    Timing,
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
    linked_kind: Optional[str] = None    # topic | mechanism | symptom | supplement | claim | cooking_adjustment | home_remedy
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
    summary: str
    indications: list[str] = Field(default_factory=list)         # symptom slugs or topic slugs
    contraindications: list[str] = Field(default_factory=list)   # free-text condition descriptors
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
    category: SupplementCategory
    forms_available: list[SupplementForm]
    typical_dose_range: dict[str, DoseRange]
    timing_options: list[Timing]
    take_with_food: TakeWithFood = TakeWithFood.optional
    contraindications: Contraindications = Field(default_factory=Contraindications)
    interactions: Interactions = Field(default_factory=Interactions)
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
