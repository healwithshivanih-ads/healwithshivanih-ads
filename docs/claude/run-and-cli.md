# Run, routes, CLI and UI-level key invariants

> Moved verbatim out of the root `CLAUDE.md` on 2026-11-17 (original lines 2192–2348). Index: [`/CLAUDE.md`](../../CLAUDE.md).
> Covers: Setup, Next.js dev/PM2, route list, removed routes, the long 'Key invariants' list for the coach UI (tabs, session types, letters, templates, PM2 env, protocol scoring, lab matching, cleanup tool, entity labels), CLI commands.
> Version notes describe the code when written; newer entries in `invariants-v0.81-v0.91.md` and git history override older ones.

## Run

### Setup (one time)
```bash
cd fm-database
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
# create .env with ANTHROPIC_API_KEY for ingest + assess
```

### Path B — Next.js UI (current primary surface as of v0.30+)
```bash
cd fm-database-web
npm install                                  # one time
npm run dev -- -p 3002                       # opens http://localhost:3002 (dev mode)
                                             # (port 3000 used by another app on this machine)

# Production (preferred):
npm run build                                # build once
./node_modules/.bin/pm2 start ecosystem.config.js   # start as daemon on port 3002
./node_modules/.bin/pm2 stop fm-coach               # stop
./node_modules/.bin/pm2 logs fm-coach               # view logs

npm run build && npm run type-check          # before committing

# Email sending: add GMAIL_USER + GMAIL_APP_PASSWORD to .env.local
# (see .env.local.example — needs a Google App Password, not your normal password)
```
**23 routes:** `/`, `/search`, `/catalogue` (+ all 8 detail kinds), `/catalogue/cleanup` (Haiku duplicate / miscategorisation finder — see v0.64), `/plans` (+ 3-tab editor: Protocol/Documents/Lifecycle + plan-check sidebar + Markdown/HTML export + 📧 Send to client), `/assess` (Analyze + chat with auto-rehydrated history), `/clients` (+ detail with `?tab=overview|sessions|plan` deep-linking + add-client form + contact widget + check-in form + 📤 SendPackageButton + preferences editor), `/resources` (+ detail + `/resources/generate` PubMed evidence brief), `/mindmap` (+ Mermaid detail), `/backlog` (with bulk reject + mark-added + Attach action + per-row 💡 suggestion chips + 🔗 Supplement Links tab), `/ingest` (📁 file upload: PDF/MD/images + 🔗 URL tab + ⚡ Approve all pending button + per-batch Review/Approve/Reject), `/sources` (Add Source — form writes directly to fm-database/data/sources/).

**Removed 2026-10-23 (coach app restructure, Phase 4):** the v1 redirect shims `/clients`, `/clients/[id]`, `/plans`, `/plans/new`, `/plans/[slug]`, `/assess`, `/sources`, `/dashboard-legacy` and the legacy `SidebarNav` rail; `/start/<token>` (client start-date confirmation + `start-date-action.py` + the webhook's Pattern-B branch); `/clients-v2/[id]/{soap,handoff,dirty-genes,timeline}`; `/token-admin`; `/api/zoom-webhook`; `/api/handover/test`; `/api/invoice/maintenance-{order,charge}`; the token `/recipes/[planSlug]` pack and `/guide/thyroid`; the Streamlit "Path A" UI (`fmdb_ui/`, `run-fmdb.sh`); 32 zero-importer components (`src/components/client-widgets/*`, `meal-plan-drip-panel`, `catalogue-commit-button`, …) and 20 one-off Python scripts. The v2 routes under `(v2)/` are the whole coach app now.

**Key invariants:**
- `ingest-action.py` calls `python -m fmdb.cli` (NOT `python fmdb/cli.py` — causes ImportError).
- `html2text` installed in fm-database/.venv (needed for URL ingest HTML→markdown).
- No global git config on this machine — commit author set via env vars in `catalogue-commit-action.ts`.
- Port 3002 (port 3000 used by another app). PM2 process name: `fm-coach`.
- Client page tabs: `type Tab = "overview" | "sessions" | "plan"` (3 tabs as of v0.48). Backward compat: `?tab=timeline|protocol|send|documents` all map to new names. `?tab=sessions` was "timeline". `?tab=plan` was "protocol" and "send".
- `activePlan`, `activePlanStatus`, `workflowStage` defined at component top of `ClientPageTabs` — NOT inside JSX IIFEs. `todayStr` defined immediately after measurements state.
- `handleActivate(slug)` calls `submitPlan` + `publishPlan` from `lifecycle-actions` inline. On error: toast. On success: `router.refresh()`.
- `ClientLetterButton` is no longer imported in `client-tabs.tsx`. `send-package-button.tsx` is the sole letter-generation entry point (in Plan tab, published plans only).
- `SESSION_TYPE_META.full_assessment.label` = `"Full session"` (NOT "Assessment"). Icon = `"🔬"`. Changed in v0.48. `discovery_consultation` icon = `"🔍"`, label = "Discovery". `pre_intake` label = "Intake session" (v0.59).
- `SessionType` union (v0.59): `"discovery_consultation" | "pre_intake" | "full_assessment" | "check_in" | "quick_note"`. Same union in `session-utils.ts`, `actions.ts` (SessionSummary + SaveSessionInput), `session-type-picker.tsx`. `parseSessionType()` returns all 5 values; unknown tags default to `"full_assessment"`.
- `discovery-form.tsx` saves `[session_type: discovery_consultation]` prefix in presenting_complaints (not a Python model field — stored as tag). Lab panel selection and food journal request shown as shareable text after save.
- `render-client-letter.py` all 4 prompt builders extract `plan_weeks = int(plan.get("plan_period_weeks") or 12)` and use `{plan_weeks}` throughout. No hardcoded "12 weeks" in prompt text.
- Inbound WhatsApp webhook (`/api/whatsapp-webhook`): unmatched phones logged to `~/fm-plans/_whatsapp_unmatched.yaml`. Always returns 200. No client auto-creation. AiSensy webhook route removed at v0.74.
- Dashboard CTAs and `client/[id]/page.tsx` returning-client link all use `?tab=sessions` (was `?tab=timeline`).
- `plan-editor.tsx` Documents tab links use `?tab=plan` (was `?tab=documents`).
- `extract-symptoms.py` uses `max_tokens=8192` (Haiku's max). DO NOT lower this — full symptom catalogue + large lab PDFs need the full limit or JSON is truncated.
- `extractSymptomsFromTranscript` timeout: 120,000ms (2 min). Large lab panels need this headroom.
- `family_history: Optional[str] = None` in Python `Client` model (`fmdb/plan/models.py`). Required because model uses `extra="forbid"` — adding YAML fields without updating Python causes ValidationError.
- Meal plan letter takes 2–3 min to generate (Sonnet, long output). Saves to `~/fm-plans/clients/<id>/meal-plans/{stem}.md/.html`. Loads on page mount — no need to regenerate. All 4 letter types are independent files.
- Coach notes (`coachNotes` param) are passed to all 4 prompt variants — weave in custom tips like "Soak methi seeds overnight, drink water first thing". Shown as textarea in the asking state before generation.
- `generateClientLetter(planSlug, clientId, weightLoss?, letterType?, coachNotes?)` — weightLoss is 3rd, letterType is 4th. When generating without weight loss params, pass `undefined` explicitly: `generateClientLetter(planSlug, clientId, undefined, pkg.type, coachNotes)`. Mixing up arg order causes TS2345.
- `brand_html.py` is the shared brand wrapper for ALL letter/plan HTML output. Edit CSS there, not inline.
- Per-week print: `body[data-print-week="N"]` attr set by JS → CSS shows only that week-section. Works without any server round-trip.
- Supplement print: `#supplement-schedule` isolated by JS before `window.print()`. Buy links hidden via `.no-print` CSS class on print.
- `five_pillars: Optional[FivePillarsAssessment] = None` on Python `Session` model (`fmdb/plan/models.py`). Required — model uses `extra="forbid"`. Added v0.57.
- `save-session.py` now extracts `five_pillars` from payload and builds `FivePillarsAssessment` before calling `Session(...)`. Guards: only build if any value is non-None; silently ignores exceptions (session still saves without five_pillars if malformed).
- `FollowUpDraftPanel` only shown for `sessionType !== "full_assessment"` (full assessments have their own AI flow). Triggered by `savedSessionId` state in `client-tabs.tsx`.
- `draftFollowUpMessageAction` in `clients/actions.ts`: 30s timeout, 1MB buffer. `draft-followup-message.py` reads `.env` from `FMDB_ROOT` for `ANTHROPIC_API_KEY` via `_load_env()`.
- `WHATSAPP_SERVER_URL` env var (`.env.local`) gates `BroadcastPanel` on dashboard and enables 📤 Send in `MessageTemplatesPanel`. Without it, broadcast panel is hidden and send button is disabled. AiSensy is decommissioned — all outbound WA routes through `sendWhatsAppAction` → self-hosted WA Cloud API server.
- `broadcastAction` normalises phone to E.164: 10-digit numbers get `91` prefix. Sends via `sendWhatsAppAction` to `WHATSAPP_SERVER_URL`. Campaign name must match a registered Meta template (submitted via `whatsapp-server/scripts/submit-templates.js`).
- `message_templates.yaml` at `~/fm-plans/message_templates.yaml`. Written with 5 defaults on first `loadMessageTemplatesAction` call. Fields: `{id, name, category, body, variables[]}`. (v0.62)
- `custom_templates/` at `~/fm-plans/custom_templates/{slug}.yaml`. Created by `saveAsTemplateAction`. Loaded by `loadCustomTemplatesAction` in assess. Selection prefix: `custom:{slug}`. (v0.62)
- `lab_reference_ranges` stored in `client.yaml` as `{marker: {optimal_low, optimal_high, unit}}`. Saved by `saveLabReferenceRangesAction`, loaded by `loadLabReferenceRangesAction`. `rangeStatus(value, range)` in `health-trends.tsx` returns `"optimal" | "outside" | null`. (v0.62)
- `checkSupplementInteractionsAction(planSlug)` in `plans/[slug]/actions.ts`: reads plan YAML → client YAML → each supplement's `fm-database/data/supplements/{slug}.yaml`. Checks `contraindications` field (array of strings) case-insensitively against `client.medications` + `client.current_medications`. Called on mount in `plan-editor.tsx`. (v0.61)
- `SessionDriver` and `SessionSupplement` interfaces in `assess/actions.ts`. `SessionSummary` now includes `likely_drivers?` and `supplement_suggestions?` extracted from `session.ai_analysis`. Used in `session-brief-modal.tsx`. (v0.61)
- **PM2 env loading** (v0.63): `ecosystem.config.js` calls `require("dotenv").config({ path: ".env.local" })` before exporting. Spreads `process.env` into app `env` block. After editing `.env.local`, do `pm2 delete fm-coach && pm2 start ecosystem.config.js` (NOT `pm2 restart` — restart doesn't re-read config file).
- **Protocol scoring** (v0.63): `ProtocolSuggestion.fit_score` is gone — replaced by `factor_scores: FactorScores` + `fit_percent: float`. `FACTOR_WEIGHTS` in `anthropic-types.ts` is the source of truth for weights. Python `compute_fit_percent()` in `results.py` computes the weighted %. AI only outputs per-factor 1–5 scores.
- **ATM Triad** (v0.63): `LikelyDriver.atm_role` is `"antecedent" | "trigger" | "mediator" | "expression" | null`. `parents` is a list of mechanism slugs that are upstream in the causal chain. `chain_evidence` is a one-sentence explanation.
- **Drug depletions matching** (v0.63): `checkMedicationImpactsAction` does bidirectional substring matching — medication name is checked against `drug_name` AND each `drug_aliases` entry (both directions). Returns list of `{drug_slug, drug_name, depletes[], timing_separations, contraindicated_supplements, monitoring_labs, coach_notes}`.
- **Lab test matching** (v0.63): `findCatalogueLabTest(testName, catalogue)` in `health-trends.tsx` — exact match first, then bidirectional substring against `match_keys[]` (slug + display_name + aliases). Returns `CatalogueLabRange | null`. Per-client `lab_reference_ranges` override takes precedence; catalogue is fallback.
- **Titration protocol data** (v0.63): `TitrationStep` uses integer counts (morning/midday/evening/bedtime as number). No fractional doses — India has no compounding pharmacies. Steps reference product names in `notes` field for the coach.
- **DUTCH/GI-MAP storage** (v0.63): `~/fm-plans/clients/<id>/functional_tests/<type>-<date>.yaml`. Loaded by `loadFunctionalTestsAction`. `parseFunctionalTestAction` timeout is 5 min (Sonnet with large PDF).
- **Validation report** (v0.63): `{stem}.validation.json` sidecar written alongside `{stem}.md` and `{stem}.html` by `saveMealPlan`. Read by `loadMealPlan` and returned as `result.validationReport`. `LetterValidationChange` interface in `lifecycle-actions.ts`.
- **Letter types** (v0.63): `LetterType` = `"consolidated" | "meal_plan" | "supplement_plan" | "lifestyle_guide" | "exercise_plan"`. 5th type `exercise_plan` added. `has_exercise_plan` signal in lifecycle-actions checks for `{planSlug}-exercise_plan.md` to cross-reference in other letter types.
- **`protocol_category` field** on Protocol YAML. `ProtocolCategory` enum: gut_healing, elimination_diet, hormone_balance, metabolic_reset, adrenal_recovery, detox_liver_support, anti_inflammatory, mitochondrial_support, thyroid_optimization, blood_sugar_regulation.
- **Catalogue cleanup** (v0.64): plan persisted at `fm-database/data/_cleanup/latest_plan.yaml`. `loadCleanupPlanAction` reads from disk on page load (no API call); `analyzeCleanupAction` runs Haiku and overwrites. `applyCleanupGroupAction(group, dryRun, createStub)` — `createStub: true` is the second-call retry path after the first call returns `{needs_stub: true, target_kind, target_slug}`. Successful apply removes the group from the plan and revalidates `/catalogue` + `/catalogue/cleanup`. Cleanup never deletes a slug without first adding it as an alias on the canonical — old plan/session refs always stay resolvable via the alias-aware validator.
- **Coach-friendly entity labels** (v0.64): UI labels live in `src/lib/fmdb/kinds.ts` (`KIND_LABELS`, `kindLabel`, `kindEmoji`). YAML field names + Pydantic models + Python CLI commands + the URL path segment (`/catalogue/topics/...`) all keep the original taxonomy. Internal slug → display mapping: topics=Conditions, mechanisms=Root causes, protocols=Healing programs, titration_protocols=Dose schedules, lab_tests=Lab markers, claims=Evidence notes, sources=References. Symptoms / supplements / lab_panels unchanged.
- **`.md`/`.txt` uploads** (v0.64): five frontend `accept` attrs include `.md,.txt,text/markdown,text/plain` alongside PDF. `parse-functional-test.py` and `parse-genetic-report.py` detect `.md/.txt/.markdown` by `path.suffix.lower()` and skip the PDF document attachment — sending a single text content block instead. PDF path unchanged. Test-type detection in functional-test still runs against the text content.

### Path A — Streamlit UI
Removed 2026-10-23 (`fmdb_ui/` + `run-fmdb.sh` deleted; `streamlit` dropped from requirements). The Next.js app is the only coach UI.

### CLI — read commands
```bash
.venv/bin/python -m fmdb.cli validate         # full catalogue check
.venv/bin/python -m fmdb.cli pending-refs     # unresolved cross-refs grouped by target
.venv/bin/python -m fmdb.cli {sources,topics,mechanisms,symptoms,claims,supplements,
                              cooking-adjustments,home-remedies,mindmaps}
.venv/bin/python -m fmdb.cli show-{source,topic,mechanism,symptom,claim,
                                   supplement,cooking-adjustment,home-remedy,mindmap} <slug>
```

### CLI — ingest pipeline
```bash
# Stub backend (no API key required — exercises plumbing)
.venv/bin/python -m fmdb.cli ingest path/to/doc.md \
    --source-id my-doc --source-type book --source-quality moderate \
    --extractor stub

# Anthropic backend (set ANTHROPIC_API_KEY first)
.venv/bin/python -m fmdb.cli ingest path/to/doc.md \
    --source-id ev-tiers-thyroid \
    --source-title "Vitaone Evidence Tiers — Thyroid" \
    --source-type internal_skill \
    --internal-path .claude/skills/.../evidence_tiers.md \
    --instructions "Extract Topic 1 Thyroid only..."

.venv/bin/python -m fmdb.cli review                       # list batches
.venv/bin/python -m fmdb.cli review <batch-id>            # show one
.venv/bin/python -m fmdb.cli approve <batch-id> --update  # smart-merge
.venv/bin/python -m fmdb.cli approve <batch-id> --only topics/insomnia
.venv/bin/python -m fmdb.cli reject  <batch-id>
.venv/bin/python -m fmdb.cli audit -n 50
```

### CLI — client + plan
```bash
.venv/bin/python -m fmdb.cli client-new <id> --intake-date YYYY-MM-DD --age-band 45-50 --sex F
.venv/bin/python -m fmdb.cli client-show <id>
.venv/bin/python -m fmdb.cli client-list
.venv/bin/python -m fmdb.cli client-edit <id>             # opens $EDITOR

.venv/bin/python -m fmdb.cli plan-new <client-id> <plan-slug>
.venv/bin/python -m fmdb.cli plan-add-{topic,symptom,supplement} <plan-slug> ...
.venv/bin/python -m fmdb.cli plan-show <plan-slug>
.venv/bin/python -m fmdb.cli plan-edit <plan-slug>        # opens $EDITOR
.venv/bin/python -m fmdb.cli plan-check <plan-slug>       # deterministic check
.venv/bin/python -m fmdb.cli plan-ai-check <plan-slug>    # AI sanity check (~$0.02–$0.08)
.venv/bin/python -m fmdb.cli plan-list [--client <id>] [--status <name>]

# publish lifecycle
.venv/bin/python -m fmdb.cli plan-submit <slug>           # draft → ready_to_publish
.venv/bin/python -m fmdb.cli plan-publish <slug>          # → published; freezes git SHA
.venv/bin/python -m fmdb.cli plan-revoke <slug> --reason "..."
.venv/bin/python -m fmdb.cli plan-supersede <new-slug>    # new must have supersedes set
.venv/bin/python -m fmdb.cli plan-diff <slug-a> <slug-b>
.venv/bin/python -m fmdb.cli plan-render <slug> [--format markdown|html] [-o FILE]
```

### CLI — backlog triage + mindmap link/mine
```bash
.venv/bin/python -m fmdb.cli backlog-list [--status open|added|rejected|attached|all] [--kind X] [--search S]
.venv/bin/python -m fmdb.cli backlog-show <id>
.venv/bin/python -m fmdb.cli backlog-clean [--apply]      # heuristic auto-reject prose/noise
.venv/bin/python -m fmdb.cli backlog-promote <id> [--kind X] [--slug X] [--display-name X]
.venv/bin/python -m fmdb.cli backlog-reject <id> [--note X]
.venv/bin/python -m fmdb.cli backlog-attach <id> --mode claim|alias|notes \
    --target-kind topic|mechanism|symptom|supplement \
    --target-slug <slug> [--evidence-tier X] [--force] [--note X]

.venv/bin/python -m fmdb.cli mindmap-link [<slug>] [--all] [--apply] [--dry-run]
.venv/bin/python -m fmdb.cli mindmap-mine [--add-to-backlog]
```
