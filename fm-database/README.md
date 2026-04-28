# FM Database

Internal functional medicine catalogue. Used to author client plans
that feed the client-facing app (separate project).

Status: v0.1 — `Supplement` entity only. Schema, validator, and CLI
working end-to-end. More entity types added incrementally.

## Run

    cd fm-database
    pip install -r requirements.txt

    python -m fmdb.cli validate
    python -m fmdb.cli list
    python -m fmdb.cli show magnesium-glycinate

## Layout

    fm-database/
      fmdb/                 Python package (models, loader, validator, CLI)
      data/
        supplements/        one YAML per supplement
      docs/                 schema docs (added as schemas stabilise)
