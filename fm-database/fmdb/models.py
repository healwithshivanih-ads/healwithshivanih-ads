from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .enums import (
    DoseUnit,
    EntityStatus,
    EvidenceTier,
    InteractionType,
    SupplementCategory,
    SupplementForm,
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
