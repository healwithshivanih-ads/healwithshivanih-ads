# FM Database

Internal functional medicine catalogue. Used to author client plans
that feed the client-facing app (separate project).

Status: v0.5 — entities `Supplement`, `Source`, `Topic`, `Claim` plus
an ingestion pipeline (extract → stage → review → approve).

## Setup

    cd fm-database
    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt

## Read commands

    .venv/bin/python -m fmdb.cli validate
    .venv/bin/python -m fmdb.cli list
    .venv/bin/python -m fmdb.cli sources
    .venv/bin/python -m fmdb.cli topics
    .venv/bin/python -m fmdb.cli claims
    .venv/bin/python -m fmdb.cli show magnesium-glycinate
    .venv/bin/python -m fmdb.cli show-source vitaone-skill-practice-guide
    .venv/bin/python -m fmdb.cli show-topic insomnia
    .venv/bin/python -m fmdb.cli show-claim magnesium-glycinate-improves-sleep-quality

## Ingestion pipeline

The pipeline accepts any document Shivani inputs (markdown, plain text;
PDF / video transcript loaders are stubs to be filled in), extracts
candidate Topics, Claims, and Supplements with an LLM, and stages them
under `data/staging/<batch_id>/` for review before they become canonical.

### One-shot example (no API key — exercises plumbing)

    .venv/bin/python -m fmdb.cli ingest path/to/doc.md \
        --source-id my-doc-slug \
        --source-title "My Doc" \
        --source-type book \
        --source-quality moderate \
        --updated-by shivani \
        --extractor stub

### With Claude (real extraction)

    export ANTHROPIC_API_KEY=sk-ant-...
    export FMDB_EXTRACTOR=anthropic
    # Optional: override model
    # export FMDB_EXTRACTOR_MODEL=claude-sonnet-4-5

    .venv/bin/python -m fmdb.cli ingest path/to/doc.md \
        --source-id my-doc-slug \
        --source-title "My Doc" \
        --source-type peer_reviewed_paper \
        --source-quality high \
        --doi 10.xxxx/yyyy \
        --author "Smith J" --author "Jones A" \
        --year 2024 \
        --instructions "Focus on thyroid claims; ignore unrelated dietary content." \
        --updated-by shivani

### Review and approve

    .venv/bin/python -m fmdb.cli review                       # list batches
    .venv/bin/python -m fmdb.cli review <batch_id>            # show one batch
    .venv/bin/python -m fmdb.cli approve <batch_id>           # promote all non-conflicting entries
    .venv/bin/python -m fmdb.cli approve <batch_id> --only topics/insomnia
    .venv/bin/python -m fmdb.cli approve <batch_id> --only topics/pcos --update   # overwrite + bump version
    .venv/bin/python -m fmdb.cli reject  <batch_id>           # discard the batch
    .venv/bin/python -m fmdb.cli reject  <batch_id> --only claims/foo
    .venv/bin/python -m fmdb.cli audit -n 50                  # view audit log

Approval re-runs the validator over the full canonical set; if cross-references
break, approval exits non-zero.

### Pipeline guarantees

- **Source-first.** Every ingest auto-registers a `Source` candidate from CLI
  metadata. All extracted entities cite it.
- **Real validation.** Staged YAMLs are run through Pydantic before being
  written. LLM output that doesn't fit the schema lands as `rejected` in
  the batch manifest, never as a half-baked file.
- **Conflict-safe.** If a candidate slug already exists in canonical, it
  is marked `conflict` and approval refuses to overwrite without `--update`.
- **Audit log.** Every ingest / approve / reject appends a JSONL record
  to `data/_audit.jsonl` (gitignored).
- **Pluggable extractors.** `Extractor` is a Protocol; swap `StubExtractor`
  for your own backend (local LLM, fine-tune, etc.) without touching the
  rest of the pipeline.

## Layout

    fm-database/
      fmdb/
        models.py            Pydantic schemas for the four entities
        enums.py             closed vocabularies
        loader.py            yaml → Pydantic
        validator.py         schema + cross-reference checks
        cli.py               argparse front door
        ingest/
          types.py           IngestRequest, ExtractionResult
          loaders.py         file → text (md/txt; pdf/video stubs)
          extractor.py       Extractor Protocol; Stub + Anthropic impls
          staging.py         enrich → validate → write data/staging/<batch>/
          audit.py           JSONL audit log
      data/
        supplements/         one YAML per entity
        sources/
        topics/
        claims/
        staging/             gitignored — ephemeral candidate batches
        _audit.jsonl         gitignored — append-only audit log
