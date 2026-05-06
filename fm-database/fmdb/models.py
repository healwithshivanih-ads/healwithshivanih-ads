from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .enums import (
    CookingAdjustmentCategory,
    DoseUnit,
    EntityStatus,
    EvidenceTier,
    HomeRemedyCategory,
    InteractionType,
    MechanismCategory,
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
