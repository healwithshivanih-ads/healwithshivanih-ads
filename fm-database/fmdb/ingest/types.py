"""Lightweight transport types for the extraction pipeline.

The extractor returns dict-like candidates rather than fully-validated
Pydantic objects, because LLM output is incomplete and would otherwise
fail validation on lifecycle fields (version, updated_at, updated_by) that
the staging layer fills in. The staging writer composes the candidate
dict with defaults, then validates against the Pydantic model before
writing — so by the time a YAML lands in `staging/`, it's already valid.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


EntityType = str  # one of: "supplements", "topics", "claims", "sources", "mechanisms", "symptoms"
ENTITY_TYPES: tuple[EntityType, ...] = ("sources", "topics", "mechanisms", "symptoms", "claims", "supplements")


@dataclass
class ExtractionResult:
    """What an extractor returns from a single document."""

    sources: list[dict[str, Any]] = field(default_factory=list)
    topics: list[dict[str, Any]] = field(default_factory=list)
    mechanisms: list[dict[str, Any]] = field(default_factory=list)
    symptoms: list[dict[str, Any]] = field(default_factory=list)
    claims: list[dict[str, Any]] = field(default_factory=list)
    supplements: list[dict[str, Any]] = field(default_factory=list)
    usage: dict[str, Any] = field(default_factory=dict)  # input/output/cache tokens, model, stop_reason

    def is_empty(self) -> bool:
        return not (self.sources or self.topics or self.mechanisms or self.symptoms or self.claims or self.supplements)

    def by_type(self) -> dict[EntityType, list[dict[str, Any]]]:
        return {
            "sources": self.sources,
            "topics": self.topics,
            "mechanisms": self.mechanisms,
            "symptoms": self.symptoms,
            "claims": self.claims,
            "supplements": self.supplements,
        }


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
