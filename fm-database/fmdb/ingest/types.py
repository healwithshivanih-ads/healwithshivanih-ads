"""Lightweight transport types for the extraction pipeline.

The extractor returns dict-like candidates rather than fully-validated
Pydantic objects, because LLM output is incomplete and would otherwise
fail validation on lifecycle fields (version, updated_at, updated_by) that
the staging layer fills in. The staging writer composes the candidate
dict with defaults, then validates against the Pydantic model before
writing — so by the time a YAML lands in `staging/`, it's already valid.

INVARIANT — adding an entity type is a ONE-LINE change to ENTITY_TYPES.
`ExtractionResult.by_type()` and `.is_empty()` both derive from that tuple
via getattr, and the staging loop iterates `EXTRACTED_TYPES`. Before this was
enforced, `drug_depletions` and `lab_tests` were listed in ENTITY_TYPES and
requested in the extractor's tool schema, but were absent from `by_type()` —
so the model produced them, they were billed for, and staging silently
discarded every one. Keep the derivation; never hand-maintain parallel lists.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


EntityType = str

#: Every entity type the pipeline can stage. `sources` is registered by the
#: staging layer from the IngestRequest rather than produced by the extractor.
ENTITY_TYPES: tuple[EntityType, ...] = (
    "sources",
    "topics",
    "mechanisms",
    "symptoms",
    "claims",
    "supplements",
    "drug_depletions",
    "lab_tests",
    "somatic_practices",
    "somatic_maps",
)

#: The subset the AI extractor actually emits — everything except `sources`.
EXTRACTED_TYPES: tuple[EntityType, ...] = tuple(e for e in ENTITY_TYPES if e != "sources")


@dataclass
class ExtractionResult:
    """What an extractor returns from a single document."""

    sources: list[dict[str, Any]] = field(default_factory=list)
    topics: list[dict[str, Any]] = field(default_factory=list)
    mechanisms: list[dict[str, Any]] = field(default_factory=list)
    symptoms: list[dict[str, Any]] = field(default_factory=list)
    claims: list[dict[str, Any]] = field(default_factory=list)
    supplements: list[dict[str, Any]] = field(default_factory=list)
    drug_depletions: list[dict[str, Any]] = field(default_factory=list)
    lab_tests: list[dict[str, Any]] = field(default_factory=list)
    somatic_practices: list[dict[str, Any]] = field(default_factory=list)
    somatic_maps: list[dict[str, Any]] = field(default_factory=list)
    usage: dict[str, Any] = field(default_factory=dict)  # input/output/cache tokens, model, stop_reason

    def by_type(self) -> dict[EntityType, list[dict[str, Any]]]:
        """Every entity bucket keyed by type. Derived from ENTITY_TYPES."""
        return {e: (getattr(self, e, None) or []) for e in ENTITY_TYPES}

    def is_empty(self) -> bool:
        return not any(self.by_type().values())


@dataclass
class IngestRequest:
    """A single document to extract from."""

    document_text: str
    source_id: str  # canonical id this document maps to in the Source registry
    source_title: str
    source_type: str  # one of SourceType enum values
    source_quality: str  # one of SourceQuality enum values
    source_extra: dict[str, Any] = field(default_factory=dict)  # url, doi, internal_path, etc.
    instructions: str = ""  # optional extra instructions to the extractor
    # Binary attachments (PDFs, images) — Claude reads these directly via the
    # API as document/image content blocks. Each item: {filename, mime_type, data_b64}.
    attachments: list[dict[str, Any]] = field(default_factory=list)
