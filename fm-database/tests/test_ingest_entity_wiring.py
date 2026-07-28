"""Guards against the silent-drop bug class in the ingest pipeline.

An entity type can be declared in ENTITY_TYPES and requested in the extractor's
tool schema, yet never reach disk, if any one of four parallel structures is
missed: ExtractionResult's fields, by_type(), _MODEL_BY_ENTITY, or _ENRICHERS.
That is precisely what happened to drug_depletions and lab_tests — the model
produced them, they were billed for, and staging discarded every one.

These tests assert the structures agree, so the next entity type can't repeat it.
"""

import json

from fmdb.ingest.extractor import _TOOL_INPUT_SCHEMA
from fmdb.ingest.staging import _ENRICHERS, _MODEL_BY_ENTITY
from fmdb.ingest.types import ENTITY_TYPES, EXTRACTED_TYPES, ExtractionResult


def test_extracted_types_excludes_only_sources():
    assert set(ENTITY_TYPES) - set(EXTRACTED_TYPES) == {"sources"}


def test_every_entity_type_has_a_result_field():
    r = ExtractionResult()
    for entity in ENTITY_TYPES:
        assert hasattr(r, entity), f"ExtractionResult is missing a field for {entity!r}"


def test_by_type_exposes_every_entity_type():
    keys = set(ExtractionResult().by_type())
    assert keys == set(ENTITY_TYPES), f"by_type() drifted from ENTITY_TYPES: {keys ^ set(ENTITY_TYPES)}"


def test_every_extracted_type_has_a_model_and_enricher():
    for entity in EXTRACTED_TYPES:
        assert entity in _MODEL_BY_ENTITY, f"{entity} has no Pydantic model mapping"
        assert entity in _ENRICHERS, f"{entity} has no enricher"


def test_every_extracted_type_is_requested_in_the_tool_schema():
    props = set(_TOOL_INPUT_SCHEMA["properties"])
    missing = set(EXTRACTED_TYPES) - props
    assert not missing, f"declared but never requested from the model: {sorted(missing)}"


def test_nothing_is_requested_that_cannot_be_staged():
    """The inverse: paying for output the pipeline would throw away."""
    props = set(_TOOL_INPUT_SCHEMA["properties"])
    orphans = props - set(EXTRACTED_TYPES)
    assert not orphans, f"requested from the model but unstageable: {sorted(orphans)}"


def test_tool_schema_serialises():
    json.dumps(_TOOL_INPUT_SCHEMA)


def test_payload_round_trip_keeps_every_bucket():
    """The regression proper: a payload with one item per bucket must survive."""
    payload = {e: [{"slug": f"x-{e}"}] for e in EXTRACTED_TYPES}
    buckets = {e: list(payload.get(e, []) or []) for e in EXTRACTED_TYPES}
    result = ExtractionResult(sources=[], usage={}, **buckets)
    by_type = result.by_type()
    for entity in EXTRACTED_TYPES:
        assert by_type[entity] == [{"slug": f"x-{entity}"}], f"{entity} was dropped in transit"
    assert not result.is_empty()


def test_is_empty_is_true_for_a_blank_result():
    assert ExtractionResult().is_empty()


# fm-database has no pytest dependency, so this file is also a plain script:
#   python -m tests.test_ingest_entity_wiring
# Exits non-zero on the first failure so CI can gate on it either way.
if __name__ == "__main__":
    import sys
    import traceback

    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            print(f"  PASS  {name}")
        except Exception:
            failures += 1
            print(f"  FAIL  {name}")
            traceback.print_exc()
    print(f"\n{failures} failure(s)")
    sys.exit(1 if failures else 0)
