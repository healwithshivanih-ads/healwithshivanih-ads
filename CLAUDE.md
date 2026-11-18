# CLAUDE.md — Project Context

This file is loaded automatically at the start of every Claude Code session, so it is kept SHORT:
the rules that bite every session plus an index. The full history and every per-version invariant live in `docs/claude/` (see the index at the bottom). Add new version notes there, not here; add a one-line pointer here only if it changes how every session must work.

## Project: FM Database (Project 1)

Internal functional medicine catalogue used by coaches to author structured
client plans. A future client-facing mobile app (Project 2) will consume
published plans as JSON artifacts.

**Base branch:** `main` (the v0.87 restructure branch `claude/coach-dashboard-restructure-90ee02` merged in PR #161)
**Licensing:** Proprietary (all rights reserved, internal-only)

## Expired plans cost nothing — READ THIS FIRST

Not one credit on a lapsed or archived client, in the app or in chat.

- **In chat:** never brief, review, survey, flag or mention lapsed clients unless the coach names them. Having a file in `published/` does NOT mean a client is in care; a lapsed client's plan stays there forever. Start every roster sweep from `fm-database-web/scripts/in-care.py`, and do not run a sweep she did not ask for. `client-brief.py` prints three lines for an expired client; `--full` only when she asks about that person.
- **In the app:** every paid script calls `refuse_if_expired(client_id, script)` from `scripts/_api_guard.py` right after reading its client, so spend stops even if a button or cron misses it. `fm-database/tests/test_expired_spend_guard.py` fails if a paid script skips the call. A script that is not about one client goes in that test's list with a reason.
- **The way back** is the lifecycle's own: a new plan in draft or a `renewed` decision takes the client out of `lapsed`, and the guard stops refusing. Measured 2 Nov 2026: $0.055 logged against lapsed clients since they lapsed, so the app was barely leaking; the waste was chat sweeps.

## Web CI — READ BEFORE pushing `fm-database-web`

`.github/workflows/ci.yml` (`web-ci`) runs on any push touching `fm-database-web/**`
and gates **all four** steps as BLOCKING: type-check, tests, build, and **lint
(`eslint . --max-warnings 0`)**. The lint backlog was burned to zero (2026-08-02),
so **any new ESLint warning fails CI** — treat warnings like errors.

**Before pushing web changes, run the fast gate** (seconds; catches most CI failures):
```bash
cd fm-database-web && npm run lint -- --max-warnings 0 && npm run type-check
```
Auto-fix the mechanical ones with `npm run lint -- --fix`. For a **genuine** false
positive, silence that one line — never relax the gate — with:
`// eslint-disable-next-line <rule> -- reason`.

**This is enforced automatically** by `.githooks/pre-push` (runs lint + type-check
when a push touches `fm-database-web`; `git push --no-verify` bypasses once). A new
clone must enable the shared hooks path once: `git config core.hooksPath .githooks`
(also arms the existing `pre-commit` recipe validator). The full test+build gate
stays in CI as the backstop.

**Assistant-owned — the coach does NOT hand-edit code.** So YOU (the assistant)
own the green push end-to-end. After any `fm-database-web` change: run
`lint --max-warnings 0` + `type-check` (and the relevant tests) yourself, fix
anything you introduced, and push only once clean. If the pre-push hook OR
`web-ci` blocks/reddens, that failure is YOURS to read, fix, and re-push to green
— never leave `main` red and never hand a blocked push back to the coach.
`git push --no-verify` is **not** an escape hatch here: fix the failure instead.
Reach for `// eslint-disable-next-line <rule> -- reason` only for a verified false
positive, never to dodge a real one. If the coach says "the push is blocked" or
"CI is red," read the hook/CI output, fix it, and confirm green — no manual step
is expected from them.

**Running the tests from a git WORKTREE — set `FMDB_PYTHON`.** Several suites
(`menu-hygiene`, `recipe-generation-skip`, `prospects-sweep`,
`model-output-tolerance`) drive the real Python. They resolve `fm-database/.venv`,
which is untracked and therefore ABSENT in a worktree, and fall back to `python3`
on PATH — which on this Mac has no pyyaml. CI provides those deps on PATH so it
passes, and locally the suites fail; worse, some fail as wrong-answer
`AssertionError`s rather than import errors, so it reads like a code regression
and costs a debugging session. Point them at the real interpreter instead:
```bash
FMDB_PYTHON=/Users/shivani/code/healwithshivanih-ads/fm-database/.venv/bin/python npm test
```
`FMDB_PYTHON` is honoured by both `src/lib/fmdb/test-python.ts` (tests) and
`src/lib/fmdb/shim.ts` (every shim the app spawns). Don't symlink the venv into
the worktree instead: `.gitignore`'s `.venv/` is directory-only, so the symlink
shows up as untracked and gets committed by accident.


## Rules that bite every session

Each line is a pointer, not the full rule: open the linked file before changing that area.

**Clients and contact**
- **One lifecycle resolver** decides who is in care: `lifecycle.ts::resolveLifecycle` ↔ `fmdb/plan/lifecycle.py::resolve_lifecycle` (parity-pinned). Never read `engagement_status`, `lifecycle_state` or "has a published plan" for that. → [v0.87](docs/claude/invariants-v0.81-v0.91.md)
- **A lapsed client keeps a published plan forever.** Every cron / generator that drafts or nudges off a published plan must also check lapsed; `force` never overrides it. → [v0.84](docs/claude/invariants-v0.81-v0.91.md)
- **The coach does not chase clients.** No booking links, nudges, polls or broadcasts; `contact-gate.ts::mayContact(lifecycle, purpose)` guards every send, `session_booking` is refused for every state. → [v0.87](docs/claude/invariants-v0.81-v0.91.md)
- `scripts/client-brief.py <id|name>` is the one briefing; the `/client` skill and the author-* skills start with it. → [v0.87](docs/claude/invariants-v0.81-v0.91.md)

**Plans and safety**
- **A protocol is a template.** Every plan with a protocol needs a `client_fit` row per supplement (CRITICAL in draft/ready); `_client_screens.yaml` reads the REAL product's ingredients; rows never carry to a successor; the plan editor must not save `client_fit`. → [v0.86](docs/claude/invariants-v0.81-v0.91.md)
- **Contraindications join on a concept, never on strings:** `_condition_terms.yaml` + `fmdb/plan/supplement_clash.py`; medications through `drug_match.py` (`match_drugs`, not `match_drug`); only the LABEL before " — " counts; firm vs soft vs unnamed; every surface reads `supplement_clash.py`. → [v0.91](docs/claude/invariants-v0.81-v0.91.md)
- **Dairy goes through `plan/dairy.py` / `dairy-reaction.ts`** (`resolve_dairy`): lactose intolerance ≠ milk-protein allergy; an un-typed dairy word reads as `unsure` = excluded. → [v0.88](docs/claude/invariants-v0.81-v0.91.md)
- **Drug matching is consolidated** in `fmdb/drug_match.py` + `drug-match.ts`; aliases under 5 chars need a LETTER boundary. Never hand-roll another matcher. → [v0.74](docs/claude/invariants-v0.73-v0.80.md)
- **Food cautions down-rank and surface, never hard-filter**; foods keyed by `_ingredient_nutrients.yaml`; `match` (one food) vs `match_all` (every mention); bajra ≠ ragi ≠ foxtail — don't re-merge the millet cautions. → [v0.79](docs/claude/invariants-v0.73-v0.80.md), [v0.83](docs/claude/invariants-v0.81-v0.91.md)
- **Published plans are frozen**; `updatePlan` refuses them. Start dates go only through `updatePlanStartDates`; compare dates through `effectiveRecheckDate()` (+3d meals / +7d supplements). → [v0.70](docs/claude/history-v0.61-v0.72.md), [v0.77](docs/claude/invariants-v0.73-v0.80.md)
- **Weekly menu approval APPENDS, never trims** (`weeksAfterApproval`); grocery lists are incremental per week. → [v0.80](docs/claude/invariants-v0.73-v0.80.md)
- **Mind-body reads are gated three ways** (client depth, map sensitivity, non-empty reframe); `coach_only` maps open one at a time per client; an association must never read as a cause. → [v0.77–v0.78](docs/claude/invariants-v0.73-v0.80.md)

**Data plumbing**
- **New client.yaml field the Fly app reads → add it to `_APP_CLIENT_KEYS`** in `app-staging-action.py`, or it is invisible on Fly. → [v0.78](docs/claude/invariants-v0.73-v0.80.md)
- **Pydantic models use `extra="forbid"`**: a new YAML field without a model field crashes loads. Intake fields need the submit allowlist in `intake-token-action.py` too (a test pins it). → [v0.72](docs/claude/history-v0.61-v0.72.md), [v0.82](docs/claude/invariants-v0.81-v0.91.md)
- **Every Python shim prints JSON on stdout**; warnings go to stderr or the TS side fails to parse. YAML written from TS uses `dumpYaml`, never raw js-yaml. → [v0.67](docs/claude/history-v0.61-v0.72.md)
- **`FLY_INTAKE_ONLY=1` must stay in `fly.toml [env]`**: without it the coach UI is public. Mutagen versions on Mac and Fly must match; Mac data is authoritative. → [v0.73](docs/claude/invariants-v0.73-v0.80.md)
- **Labs: Thyrocare is primary, Acumen the backup.** Any code touching a stored lab order loads ITS provider (`orderProviderSlug`), never the default; a Thyrocare order never alerts Acumen. → [booking spec](fm-database-web/docs/LAB_BOOKING_SPEC.md)
- **The client app (`/app/<token>`) is served from Fly**: client-side changes need a Fly deploy; coach UI is localhost pm2 `fm-coach` on port 3002. → [v0.76](docs/claude/invariants-v0.73-v0.80.md), [run](docs/claude/run-and-cli.md)
- **Catalogue edits:** new spellings are aliases on the entity that owns them; merges keep old slugs as aliases; ingest is authored in chat at $0, not via the API. → [v0.64, v0.67](docs/claude/history-v0.61-v0.72.md), [architecture](docs/claude/architecture-and-file-map.md)
- **AI cost:** intake insights fire once on first submit only; every paid script calls `refuse_if_expired`; prefer Haiku where it fits. → [v0.72](docs/claude/history-v0.61-v0.72.md)

## Where the detail lives

| File | What is in it | Look here for |
|---|---|---|
| [docs/claude/invariants-v0.81-v0.91.md](docs/claude/invariants-v0.81-v0.91.md) | v0.81 → v0.91 work log and key invariants (newest) | contraindication matcher, `client_fit`, food diary (v0.89–v0.90), dairy, lifecycle / decisions inbox / contact gate, interests + content library, programme feedback, renewal letters (send 2 days before end, `offer_kind`), monthly cards, intake auto-lock, lapsed guards, wheat flour + caution matching, MRS (intake + check-in), IFM mast-cell ingest, lab indices + holistic lab read + pre-test confounders |
| [docs/claude/invariants-v0.73-v0.80.md](docs/claude/invariants-v0.73-v0.80.md) | v0.73 → v0.80 | menu append-only, food cautions, mind-body module + practice log, nutrient engine, lab nutrient priorities, recipe inbox, medications entity, Fly deploy + Mutagen |
| [docs/claude/history-v0.61-v0.72.md](docs/claude/history-v0.61-v0.72.md) | v0.61 → v0.72 | intake form v2.2, intake insights, `intake_evidence`, start dates, weekly poll, plan editor, v1 refactor, catalogue cleanup sweeps, FM markers, API spend tracker, protocols / ATM triad / drug depletions / lab tests |
| [docs/claude/history-v0.5-v0.60.md](docs/claude/history-v0.5-v0.60.md) | v0.5 → v0.60 | the original build: entities, ingest pipeline, atomic approval, plan lifecycle, AI sanity check, render, letters, sessions |
| [docs/claude/architecture-and-file-map.md](docs/claude/architecture-and-file-map.md) | architecture, annotated file map, content sources | entity types, evidence tiers, validator rules, storage layout, what each script does |
| [docs/claude/run-and-cli.md](docs/claude/run-and-cli.md) | setup, dev server, PM2, routes, CLI, UI-level invariants | tab names, session types, letter types, templates, PM2 env reload, removed routes |
| [docs/claude/roadmap-and-backlog.md](docs/claude/roadmap-and-backlog.md) | historical roadmap and backlog | what was planned; check git log before trusting "pending" |

Other docs: `docs/FOOD_DIARY_PLAN.md`, `docs/INTEREST_TRACKING_PLAN.md`, `docs/SESSION_CONNECTOR_PLAN.md`, `fm-database-web/docs/COACH_APP_RESTRUCTURE_REVIEW.md`, `DEPLOY_FLY.md`, `MUTAGEN_SYNC.md`.

Searching: `grep -rn "<term>" CLAUDE.md docs/claude/` finds any rule that used to live in this file.
