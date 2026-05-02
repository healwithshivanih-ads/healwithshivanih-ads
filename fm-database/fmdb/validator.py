"""Validation: parse YAMLs into Pydantic, then run cross-checks.

Two classes of finding:
- ERRORS    block validate / approve. They mean the data is malformed:
              schema failures, duplicate slugs, self-references, missing
              required source citations, internal cross-field violations.
- WARNINGS  do NOT block. Unresolved cross-references (e.g. a topic listed
              in `related_topics` that hasn't been authored yet) are tracked
              as warnings so the *intent* survives in the canonical file.
              `fmdb pending-refs` lists them; they auto-resolve when the
              target slug appears.

Public API:
    load_all(data_dir)              -> Loaded
    validate_loaded(loaded)         -> (errors, warnings)
    validate_all(data_dir)          -> (n_supplements, errors, warnings)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError as PydanticValidationError

from .enums import InteractionType, SourceType
from .models import Claim, CookingAdjustment, HomeRemedy, Mechanism, MindMap, Source, Supplement, Symptom, Topic


@dataclass
class Warning_:
    """An unresolved cross-reference. Recorded but non-blocking."""
    source_entity: str       # "topic" | "claim" | "supplement"
    source_slug: str
    field: str               # e.g. "related_topics", "linked_to_topics"
    target_kind: str         # "topic" | "claim" | "supplement" | "source"
    target_slug: str

    def render(self) -> str:
        if self.target_kind == "dose_unspecified":
            return (
                f"{self.source_entity} {self.source_slug}: "
                f"{self.field} {self.target_slug!r} declared but dose range not specified"
            )
        return (
            f"{self.source_entity} {self.source_slug}: "
            f"{self.field} -> unresolved {self.target_kind} {self.target_slug!r}"
        )

    @property
    def is_xref(self) -> bool:
        """True if this is an unresolved cross-reference (not e.g. a missing dose)."""
        return self.target_kind in ("topic", "claim", "supplement", "source")


@dataclass
class Loaded:
    """All entities parsed from a data directory (or composed for overlay)."""
    sources: list[Source] = field(default_factory=list)
    topics: list[Topic] = field(default_factory=list)
    claims: list[Claim] = field(default_factory=list)
    supplements: list[Supplement] = field(default_factory=list)
    mechanisms: list[Mechanism] = field(default_factory=list)
    symptoms: list[Symptom] = field(default_factory=list)
    cooking_adjustments: list[CookingAdjustment] = field(default_factory=list)
    home_remedies: list[HomeRemedy] = field(default_factory=list)
    mindmaps: list[MindMap] = field(default_factory=list)
    parse_errors: list[str] = field(default_factory=list)


def _resolve_index(items, slug_field: str = "slug") -> dict[str, str]:
    """Build {slug-or-alias → canonical-slug} for alias-aware lookups.

    Items can be Mechanism / Topic instances (which carry .aliases) or any
    object with a slug-style key field. Conflict policy: canonical slug wins
    over an alias if both refer to the same string.
    """
    index: dict[str, str] = {}
    for it in items:
        canonical = getattr(it, slug_field)
        index[canonical] = canonical
        for alias in getattr(it, "aliases", []) or []:
            # Don't let an alias shadow another entity's canonical slug
            if alias not in index or index[alias] != alias:
                index[alias] = canonical
    return index


def _load_dir(
    data_dir: Path,
    sub: str,
    model: type,
    parse_errors: list[str],
) -> list[Any]:
    out: list[Any] = []
    d = data_dir / sub
    if not d.exists():
        return out
    for path in sorted(d.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        try:
            raw = yaml.safe_load(path.read_text())
            out.append(model(**raw))
        except PydanticValidationError as e:
            parse_errors.append(f"{sub}/{path.name}: {e}")
        except Exception as e:
            parse_errors.append(f"{sub}/{path.name}: {e}")
    return out


def load_all(data_dir: Path) -> Loaded:
    parse_errors: list[str] = []
    return Loaded(
        sources=_load_dir(data_dir, "sources", Source, parse_errors),
        topics=_load_dir(data_dir, "topics", Topic, parse_errors),
        claims=_load_dir(data_dir, "claims", Claim, parse_errors),
        supplements=_load_dir(data_dir, "supplements", Supplement, parse_errors),
        mechanisms=_load_dir(data_dir, "mechanisms", Mechanism, parse_errors),
        symptoms=_load_dir(data_dir, "symptoms", Symptom, parse_errors),
        cooking_adjustments=_load_dir(data_dir, "cooking_adjustments", CookingAdjustment, parse_errors),
        home_remedies=_load_dir(data_dir, "home_remedies", HomeRemedy, parse_errors),
        mindmaps=_load_dir(data_dir, "mindmaps", MindMap, parse_errors),
        parse_errors=parse_errors,
    )


def overlay(
    loaded: Loaded,
    *,
    sources=(), topics=(), claims=(), supplements=(),
    mechanisms=(), symptoms=(), cooking_adjustments=(), home_remedies=(),
) -> Loaded:
    """Return a new Loaded where given entities replace any same-slug entries.

    Used by the approval pre-flight: simulate "canonical + about-to-promote"
    in memory, then run validation against the union before touching disk.
    """
    def _merge(existing: list, new: tuple, key: str) -> list:
        new_keys = {getattr(n, key) for n in new}
        kept = [e for e in existing if getattr(e, key) not in new_keys]
        return kept + list(new)

    return Loaded(
        sources=_merge(loaded.sources, sources, "id"),
        topics=_merge(loaded.topics, topics, "slug"),
        claims=_merge(loaded.claims, claims, "slug"),
        supplements=_merge(loaded.supplements, supplements, "slug"),
        mechanisms=_merge(loaded.mechanisms, mechanisms, "slug"),
        symptoms=_merge(loaded.symptoms, symptoms, "slug"),
        cooking_adjustments=_merge(loaded.cooking_adjustments, cooking_adjustments, "slug"),
        home_remedies=_merge(loaded.home_remedies, home_remedies, "slug"),
        parse_errors=list(loaded.parse_errors),
    )


def validate_loaded(loaded: Loaded) -> tuple[list[str], list[Warning_]]:
    errors: list[str] = list(loaded.parse_errors)
    warnings: list[Warning_] = []

    # ---- duplicate detection (ERRORS) ----
    def _check_dupes(items: list, key: str, label: str) -> None:
        seen: dict[str, int] = {}
        for it in items:
            k = getattr(it, key)
            seen[k] = seen.get(k, 0) + 1
        for k, n in seen.items():
            if n > 1:
                errors.append(f"duplicate {label} {k!r} across files ({n} entries)")

    _check_dupes(loaded.sources, "id", "source id")
    _check_dupes(loaded.topics, "slug", "topic slug")
    _check_dupes(loaded.claims, "slug", "claim slug")
    _check_dupes(loaded.supplements, "slug", "supplement slug")
    _check_dupes(loaded.mechanisms, "slug", "mechanism slug")
    _check_dupes(loaded.symptoms, "slug", "symptom slug")
    _check_dupes(loaded.cooking_adjustments, "slug", "cooking_adjustment slug")
    _check_dupes(loaded.home_remedies, "slug", "home_remedy slug")

    # ---- alias collisions (ERROR) ----
    # An alias must not collide with a different entity's canonical slug.
    for items, label in (
        (loaded.mechanisms, "mechanism"),
        (loaded.topics, "topic"),
        (loaded.symptoms, "symptom"),
        (loaded.cooking_adjustments, "cooking_adjustment"),
        (loaded.home_remedies, "home_remedy"),
    ):
        canonical = {it.slug for it in items}
        for it in items:
            for alias in getattr(it, "aliases", []) or []:
                if alias in canonical and alias != it.slug:
                    errors.append(
                        f"{label} {it.slug}: alias {alias!r} collides with another "
                        f"{label}'s canonical slug"
                    )

    # ---- per-source schema rules (ERRORS) ----
    for src in loaded.sources:
        if src.source_type == SourceType.internal_skill and not src.internal_path:
            errors.append(f"source {src.id}: internal_skill requires internal_path")
        if src.source_type in (SourceType.peer_reviewed_paper, SourceType.website) and not (src.url or src.doi):
            errors.append(f"source {src.id}: {src.source_type.value} requires url or doi")

    valid_source_ids = {s.id for s in loaded.sources}
    valid_claim_slugs = {c.slug for c in loaded.claims}
    valid_supplement_slugs = {s.slug for s in loaded.supplements}

    # Alias-aware indexes: lookup an alias and get back the canonical slug.
    # Keeps `valid_topic_slugs` etc. semantics for backward compat (use `in`).
    topic_index = _resolve_index(loaded.topics)
    mech_index = _resolve_index(loaded.mechanisms)
    sym_index = _resolve_index(loaded.symptoms)
    valid_topic_slugs = set(topic_index)        # both canonical + aliases
    valid_mechanism_slugs = set(mech_index)
    valid_symptom_slugs = set(sym_index)

    def _slugify_for_lookup(s: str) -> str:
        """Normalize a free-form symptom string into a slug-comparable form."""
        return s.strip().lower().replace(" ", "-")

    # ---- symptoms ----
    for sym in loaded.symptoms:
        for topic_slug in sym.linked_to_topics:
            if topic_slug not in valid_topic_slugs:
                warnings.append(Warning_("symptom", sym.slug, "linked_to_topics", "topic", topic_slug))
        for mech_slug in sym.linked_to_mechanisms:
            if mech_slug not in valid_mechanism_slugs:
                warnings.append(Warning_("symptom", sym.slug, "linked_to_mechanisms", "mechanism", mech_slug))
        for cite in sym.sources:
            if cite.id not in valid_source_ids:
                warnings.append(Warning_("symptom", sym.slug, "sources", "source", cite.id))

    # ---- topics ----
    for t in loaded.topics:
        if t.slug in t.related_topics:
            errors.append(f"topic {t.slug}: related_topics references self")  # ERROR (cycle)
        for rel in t.related_topics:
            if rel == t.slug:
                continue
            if rel not in valid_topic_slugs:
                warnings.append(Warning_("topic", t.slug, "related_topics", "topic", rel))
        for cite in t.sources:
            if cite.id not in valid_source_ids:
                warnings.append(Warning_("topic", t.slug, "sources", "source", cite.id))
        for mech_slug in t.key_mechanisms:
            if mech_slug not in valid_mechanism_slugs:
                warnings.append(Warning_("topic", t.slug, "key_mechanisms", "mechanism", mech_slug))
        # common_symptoms is free prose. Normalize each entry for symptom lookup;
        # unresolved entries become warnings (they may also legitimately be
        # multi-symptom prose like "constipation or loose stools" — that's a
        # data-quality gap to address by either splitting or seeding a symptom).
        for sym_str in t.common_symptoms:
            # Try both verbatim (catches aliases authored with spaces) and
            # slugified (catches prose that happens to match a hyphen-form).
            if (sym_str not in valid_symptom_slugs
                    and _slugify_for_lookup(sym_str) not in valid_symptom_slugs):
                warnings.append(Warning_(
                    "topic", t.slug, "common_symptoms", "symptom", sym_str,
                ))

    # ---- mechanisms ----
    for m in loaded.mechanisms:
        if m.slug in m.related_mechanisms:
            errors.append(f"mechanism {m.slug}: related_mechanisms references self")
        for rel in m.related_mechanisms:
            if rel == m.slug:
                continue
            if rel not in valid_mechanism_slugs:
                warnings.append(Warning_("mechanism", m.slug, "related_mechanisms", "mechanism", rel))
        for topic_slug in m.linked_to_topics:
            if topic_slug not in valid_topic_slugs:
                warnings.append(Warning_("mechanism", m.slug, "linked_to_topics", "topic", topic_slug))
        for cite in m.sources:
            if cite.id not in valid_source_ids:
                warnings.append(Warning_("mechanism", m.slug, "sources", "source", cite.id))

    # ---- claims ----
    for c in loaded.claims:
        if not c.sources:
            errors.append(f"claim {c.slug}: no sources cited")  # ERROR
        for cite in c.sources:
            if cite.id not in valid_source_ids:
                warnings.append(Warning_("claim", c.slug, "sources", "source", cite.id))
        for topic_slug in c.linked_to_topics:
            if topic_slug not in valid_topic_slugs:
                warnings.append(Warning_("claim", c.slug, "linked_to_topics", "topic", topic_slug))
        for supp_slug in c.linked_to_supplements:
            if supp_slug not in valid_supplement_slugs:
                warnings.append(Warning_("claim", c.slug, "linked_to_supplements", "supplement", supp_slug))
        for mech_slug in c.linked_to_mechanisms:
            if mech_slug not in valid_mechanism_slugs:
                warnings.append(Warning_("claim", c.slug, "linked_to_mechanisms", "mechanism", mech_slug))

    # ---- supplements ----
    for s in loaded.supplements:
        # Forms with no dose range = warning (data we know, dose TBD), not error.
        # The reverse (a dose_range entry for an undeclared form) IS an error.
        for form in s.forms_available:
            if form.value not in s.typical_dose_range:
                warnings.append(Warning_(
                    "supplement", s.slug, "forms_available",
                    "dose_unspecified", form.value,
                ))
        for form_key in s.typical_dose_range:
            if form_key not in {f.value for f in s.forms_available}:
                errors.append(
                    f"supplement {s.slug}: typical_dose_range key {form_key!r} "
                    f"is not in forms_available"
                )
        for inter in s.interactions.with_supplements:
            if inter.type == InteractionType.space_by_hours and inter.hours is None:
                errors.append(
                    f"supplement {s.slug}: interaction with {inter.slug} is space_by_hours "
                    f"but no hours specified"
                )
        for inter in s.interactions.with_foods:
            if inter.type == InteractionType.space_by_hours and inter.hours is None:
                errors.append(
                    f"supplement {s.slug}: food interaction with {inter.food_slug} is space_by_hours "
                    f"but no hours specified"
                )
        if not s.sources:
            errors.append(f"supplement {s.slug}: no sources cited")  # ERROR
        for cite in s.sources:
            if cite.id not in valid_source_ids:
                warnings.append(Warning_("supplement", s.slug, "sources", "source", cite.id))
        for topic_slug in s.linked_to_topics:
            if topic_slug not in valid_topic_slugs:
                warnings.append(Warning_("supplement", s.slug, "linked_to_topics", "topic", topic_slug))
        for claim_slug in s.linked_to_claims:
            if claim_slug not in valid_claim_slugs:
                warnings.append(Warning_("supplement", s.slug, "linked_to_claims", "claim", claim_slug))
        for mech_slug in s.linked_to_mechanisms:
            if mech_slug not in valid_mechanism_slugs:
                warnings.append(Warning_("supplement", s.slug, "linked_to_mechanisms", "mechanism", mech_slug))
        # Cross-link to other supplements via interactions.with_supplements
        for inter in s.interactions.with_supplements:
            if inter.slug not in valid_supplement_slugs:
                warnings.append(Warning_(
                    "supplement", s.slug, "interactions.with_supplements",
                    "supplement", inter.slug,
                ))

    # ---- cooking_adjustments ----
    for ca in loaded.cooking_adjustments:
        for cite in ca.sources:
            if cite.id not in valid_source_ids:
                warnings.append(Warning_("cooking_adjustment", ca.slug, "sources", "source", cite.id))
        for topic_slug in ca.linked_to_topics:
            if topic_slug not in valid_topic_slugs:
                warnings.append(Warning_("cooking_adjustment", ca.slug, "linked_to_topics", "topic", topic_slug))
        for mech_slug in ca.linked_to_mechanisms:
            if mech_slug not in valid_mechanism_slugs:
                warnings.append(Warning_("cooking_adjustment", ca.slug, "linked_to_mechanisms", "mechanism", mech_slug))

    # ---- home_remedies ----
    for hr in loaded.home_remedies:
        for cite in hr.sources:
            if cite.id not in valid_source_ids:
                warnings.append(Warning_("home_remedy", hr.slug, "sources", "source", cite.id))
        for topic_slug in hr.linked_to_topics:
            if topic_slug not in valid_topic_slugs:
                warnings.append(Warning_("home_remedy", hr.slug, "linked_to_topics", "topic", topic_slug))
        for mech_slug in hr.linked_to_mechanisms:
            if mech_slug not in valid_mechanism_slugs:
                warnings.append(Warning_("home_remedy", hr.slug, "linked_to_mechanisms", "mechanism", mech_slug))

    # ---- mindmaps ----
    valid_supplement_slugs_set = valid_supplement_slugs   # alias for inner walk
    valid_claim_slugs_set = valid_claim_slugs

    def _walk_mindmap_node(mm_slug: str, node, path: str = "tree"):
        # Validate optional linked_kind / linked_slug
        if node.linked_kind and node.linked_slug:
            kind = node.linked_kind
            slug = node.linked_slug
            valid_set = {
                "topic": valid_topic_slugs,
                "mechanism": valid_mechanism_slugs,
                "symptom": valid_symptom_slugs,
                "supplement": valid_supplement_slugs_set,
                "claim": valid_claim_slugs_set,
                "cooking_adjustment": {ca.slug for ca in loaded.cooking_adjustments},
                "home_remedy": {hr.slug for hr in loaded.home_remedies},
            }.get(kind)
            if valid_set is None:
                errors.append(
                    f"mindmap {mm_slug}: node at {path} has invalid linked_kind {kind!r}"
                )
            elif slug not in valid_set:
                warnings.append(Warning_("mindmap", mm_slug, path, kind, slug))
        for i, child in enumerate(node.children):
            _walk_mindmap_node(mm_slug, child, path=f"{path}[{i}]")

    for mm in loaded.mindmaps:
        for cite in mm.sources:
            if cite.id not in valid_source_ids:
                warnings.append(Warning_("mindmap", mm.slug, "sources", "source", cite.id))
        for topic_slug in mm.related_topics:
            if topic_slug not in valid_topic_slugs:
                warnings.append(Warning_("mindmap", mm.slug, "related_topics", "topic", topic_slug))
        for mech_slug in mm.related_mechanisms:
            if mech_slug not in valid_mechanism_slugs:
                warnings.append(Warning_("mindmap", mm.slug, "related_mechanisms", "mechanism", mech_slug))
        for i, branch in enumerate(mm.tree):
            _walk_mindmap_node(mm.slug, branch, path=f"tree[{i}]")

    return errors, warnings


def validate_all(data_dir: Path) -> tuple[int, list[str], list[Warning_]]:
    """Backwards-compatible entry: returns (n_supplements, errors, warnings)."""
    loaded = load_all(data_dir)
    errors, warnings = validate_loaded(loaded)
    return len(loaded.supplements), errors, warnings
