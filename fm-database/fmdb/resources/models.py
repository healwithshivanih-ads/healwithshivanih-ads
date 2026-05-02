"""Resource — a shareable artifact in the coach's toolkit.

Examples: cheatsheets, intake forms, breathwork scripts, recipes,
slide decks, lab order templates, useful YouTube videos.

Shapes supported:
- File on disk (file_path)
- External URL (url)
- Inline text body (text)
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Resource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str
    title: str
    kind: str                                # cheatsheet | form | script | recipe | slide_deck | protocol | video | article | lab_form | other
    audience: str = "both"                   # client | coach | both
    description: str = ""

    # Content — exactly one of these should be populated
    file_path: Optional[str] = None          # absolute path on disk (string for serialization)
    url: Optional[str] = None
    text: Optional[str] = None               # inline markdown body

    related_topics: list[str] = Field(default_factory=list)
    related_mechanisms: list[str] = Field(default_factory=list)
    related_supplements: list[str] = Field(default_factory=list)
    related_symptoms: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)

    shareable: bool = True                   # is this safe to send to clients as-is?
    license_notes: str = ""                  # e.g., "VitaOne-copyrighted; share via course link"
    size_bytes: Optional[int] = None         # auto-filled for file-based
    mime_type: Optional[str] = None

    version: int = 1
    status: str = "active"                   # active | archived | superseded
    created_at: datetime
    updated_at: datetime
    updated_by: str

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not v or not all(c.isalnum() or c == "-" for c in v) or not v.islower():
            raise ValueError(f"slug must be lowercase alphanumeric with hyphens, got {v!r}")
        return v
