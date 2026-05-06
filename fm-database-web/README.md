# fm-database-web (Path B)

Next.js 16 + Tailwind v4 + shadcn/ui rebuild of the coach-facing UI for the FM
Database project. Sibling to `../fm-database/` (the Python engine + Streamlit
fallback at `fm-database/fmdb_ui/app.py`).

## What this is

A read-only browser (for now) over the same YAML data the Streamlit app uses:

- **Catalogue** at `../fm-database/data/` (topics, mechanisms, symptoms,
  supplements, claims, sources, mindmaps, cooking adjustments, home remedies).
- **Plans + clients (PHI)** at `~/fm-plans/` (drafts/, ready/, published/,
  superseded/, revoked/, clients/`<id>`/client.yaml).
- **Resources** at `~/fm-resources/` (not yet rendered).

The Python engine (`../fm-database/fmdb/`) still owns validation, ingest,
plan-check, and the AI suggester. This UI is a presentation layer only.

## Run

```bash
npm install
npm run dev   # http://localhost:3000
```

## Env overrides

- `FMDB_CATALOGUE_DIR` — absolute path to the catalogue (default:
  `../fm-database/data`).
- `FMDB_PLANS_DIR` — absolute path to plans + clients (default: `~/fm-plans`).
- `FMDB_RESOURCES_DIR` — absolute path to resources (default: `~/fm-resources`).

## Scripts

- `npm run dev` — local dev server
- `npm run build` — production build
- `npm run lint` — Next lint (no config installed yet)
- `npm run type-check` — `tsc --noEmit`

## Routes built so far

- `/` — landing card + nav.
- `/catalogue` — tabbed table view (Topics / Mechanisms / Symptoms /
  Supplements / Claims / Sources).
- `/catalogue/topics/[slug]` — topic detail.
- `/catalogue/supplements/[slug]` — supplement detail.
- `/plans` — plans list with status filter.
- `/plans/[slug]` — plan detail (raw view; structured editor is TODO).

See `// TODO(next-turn)` markers in the code for the planned next slice.
