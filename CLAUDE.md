# CLAUDE.md — Project Context

This file is loaded automatically at the start of every Claude Code session.
Update it as the project evolves so future sessions resume with full context.

## Project: FM Database (Project 1)

Internal functional medicine catalogue used by coaches to author structured
client plans. A future client-facing mobile app (Project 2) will consume
published plans as JSON artifacts.

**Active branch:** `claude/functional-medicine-database-hQxA8`
**Licensing:** Proprietary (all rights reserved, internal-only)

## Status

**v0.26 (current)** — MindMap link/mine apply pass + Path B scaffold (Next.js + shadcn):
- **Applied the MindMap linking + mining passes** from v0.25:
  - `fmdb mindmap-link --all --apply`: 60 nodes resolved (adrenal-fatigue 13, hypothyroidism 24, hypertension 23) — by kind: 26 supplement, 20 topic, 11 symptom, 3 mechanism. Mindmap YAMLs committed.
  - `fmdb mindmap-mine --add-to-backlog`: 645 unlinked depth-2+ nodes queued into `data/_backlog.yaml` (gitignored) for triage.
- **Path B scaffold** (`fm-database-web/` — sibling to `fm-database/`, NOT inside it). Read-only Next.js + shadcn rebuild of the coach UI; the Streamlit app stays alive as fallback during migration. Stack: Next.js 16.2.4 (App Router, Turbopack), React 19.2.4, TypeScript 5 strict, Tailwind v4, shadcn (base-nova preset, neutral palette). Components installed: button, card, badge, table, input, select, tabs. Used `npm` (no pnpm available locally).
- Layout: `src/app/` (App Router), `src/components/` (sidebar-nav, evidence-tier-badge, plan-status-badge, catalogue-table + 7 shadcn UI), `src/lib/fmdb/` (paths.ts, types.ts, loader.ts).
- **Routes built this turn:**
  - `/` — landing card + sidebar shell
  - `/catalogue` — tabbed table view across all 6 entity types (Topics 110, Mechanisms 116, Symptoms 143, Supplements 171, Claims 546, Sources 39 — counts read live from disk, match catalogue v0.21+ exactly)
  - `/catalogue/[kind]/[slug]` — detail (full implementation for topics + supplements; other kinds show raw slug only — TODO marker)
  - `/plans` — list view with status badge + version
  - `/plans/[slug]` — read-only detail (Topics + Symptoms structured; rest dumps raw JSON for now)
- Data path: server components read YAML directly via `js-yaml` from `fm-database/data/` (override via `FMDB_CATALOGUE_DIR`) and `~/fm-plans/` (override via `FMDB_PLANS_DIR`). No DB, no API mutations, no auth — desktop coaching tool, single user.
- Build: PASS (one non-blocking Turbopack NFT-tracing warning on dynamic-path reads in `loader.ts` — runtime fine). Smoke-tested 6 routes returning 200.
- **TODOs for next turns** (marked `// TODO(next-turn)` in code): mechanism / symptom / claim / source / mindmap / cooking / remedy detail pages, structured Plan editor, Clients page, Mind Map Mermaid renderer, Resources Toolkit, Catalogue Backlog, Assess & Suggest workflow + AI suggester wiring, plan-check sidebar, live filter/search inputs.

**v0.25** — Resources attach-to-plan + MindMap node linking & mining:
- **Resources Toolkit ↔ Plan integration.** New `Plan.attached_resources: list[str]` field (Resource slugs). Default empty so existing plans load unchanged.
- New 📎 Resources tab in the Plan editor (between Tracking and Notes & Raw): attached-list with detach buttons + filter UI (text search + kind dropdown + audience dropdown defaulting to client/both). One-click attach.
- `render_markdown` and `render_html` now accept `resources=None` and emit a `## Resources` section between Education and Supplements; coach-only resources hidden in the client-facing artifact. Per-resource: bold title + description + URL or "(See attached file: <basename>)".
- `cmd_plan_render` (CLI) and `render_client_export` (UI Lifecycle tab) both load attached Resource records and pass them to the renderer. Lifecycle export shows a "📎 N resource(s) will be included" caption above the download buttons.
- Punted: orphan-attachment warning in `plan-check` (silently skipped at render time for now).
- **MindMap node linking + mining.** New module `fmdb/assess/mindmap_link.py`:
  - `link_mindmap_nodes(mindmap, cat)` — walks the recursive tree and resolves each node label to a catalogue entity (priority order: topic → mechanism → symptom → supplement → claim) using the validator's existing alias-aware index. Sets `linked_kind` + `linked_slug` in place. First match wins; no fuzzy-matching beyond exact slug + alias + slugified-label.
  - `mine_unlinked(mindmap, cat)` — unlinked depth-2+ nodes become catalogue-addition candidates. Heuristic `guessed_kind` from parent-chain keywords (symptom / mechanism / supplement / topic).
- `curated_to_mermaid` now appends `[topic]/[mech]/[sx]/[supp]/[claim]/[cook]/[remedy]` badges to linked-node labels using the existing `_KIND_SHAPE` table. Auto-mode renderer untouched.
- New CLI: `fmdb mindmap-link [<slug>] [--all] [--apply] [--dry-run]` and `fmdb mindmap-mine [--add-to-backlog]`.
- **Dry-run results across the 3 imported MindMaps (871 nodes total):**
  - Linked: **60 nodes** (~6.9%) — supplement 26, topic 20, symptom 11, mechanism 3.
  - Mining candidates: **645 unlinked depth-2+ nodes**. Guessed-kind split: None=493, supplement=63, topic=33, mechanism=30, symptom=26.
  - Mechanisms barely linked because most canonical slugs are FM jargon (`hpa-axis-dysregulation`, `leaky-gut`) while mindmap labels are descriptive prose. The validator's alias index caught the obvious ones (`Intestinal Permeability` → `leaky-gut` via alias).

**v0.24** — AI check button in Lifecycle tab + client-facing plan render (Markdown + HTML):
- **🧠 Run AI sanity check button** added to the Lifecycle tab next to "Run plan-check" (draft state) and as a read-only inspect on published plans. Calls `ai_check_plan` with a spinner, renders concerns grouped by severity with metric cards (critical / warning / info / coherence / client-fit) + token telemetry. Draft state has a "💾 Save to plan" button to persist into `plan.ai_sanity_check`; published state is inspect-only (no overwrite of frozen records).
- **Client-facing render** (`fmdb/plan/render.py` — new module). `render_markdown(plan, client, cat)` and `render_html(plan, client, cat)` turn the structured Plan into a hand-off artifact: catalogue slugs replaced with display names, mechanisms hidden (too clinical for client), `notes_for_coach` / `status_history` / `ai_sanity_check` / `version` / git SHA all stripped. Sections rephrased into plain English ("Daily practices", "What I'd like you to learn", "What to track").
- HTML output is standalone: embeds print-friendly CSS (A4 page, brand-green palette `#14532d`, page-break-inside on tables, `@media print` rules). No external assets. Coach saves the HTML, opens in browser, hits `Cmd+P → Save as PDF` for a polished hand-off — avoids forcing weasyprint / wkhtmltopdf installs.
- Zero new dependencies. Pure-Python markdown→HTML inline converter handles **bold** / *italic* / `code` / lists / tables / horizontal rules / continuation indents on list items.
- New CLI: `fmdb plan-render <slug> [--format markdown|html] [-o FILE]`. Defaults to markdown to stdout.
- New UI section in the Lifecycle tab: 📄 Client-facing export with "Download Markdown" + "Download HTML (print-ready)" + "Preview" buttons. Filename is `<slug>-v<N>.md/.html`.
- Smoke-tested on `cl-001-2026-04-29-foundations` (renders three primary topics with first-sentence summaries) and a synthetic richer plan (supplement protocol table with two supplements, titration captured in notes block).

**v0.23** — Lifecycle wired into the UI + AI sanity check on plans:
- **Streamlit UI integration of the publish lifecycle** (`fmdb_ui/app.py`). Plan list now shows `slug · status · version` with a status filter. Plan editor heading renders a colored status badge (gray/yellow/green/orange/red). New **🚀 Lifecycle tab** on each plan with: status + version + catalogue snapshot date + git SHA, `status_history` timeline (state · by · at · reason), state-specific action buttons (draft → Run plan-check + Submit; ready → Publish with irreversible-checkbox confirm; published → Revoke with required reason + Create successor that pre-fills `supersedes`), and a diff viewer (two slug selectboxes → `st.code(diff, language="diff")`).
- Inline plan-check findings before Submit — CRITICAL count blocks the action with a clear message; WARNING + INFO display but don't block. Two-step confirm pattern via `st.session_state` for irreversible actions (no JS modals — checkbox + button is the Streamlit-native way).
- Punted: "Back to draft" from ready_to_publish (would require a new transition function and felt out of scope for v0.23).
- **AI sanity check on plans** (`fmdb/plan/ai_check.py` — new module). Layers a Claude call on top of the deterministic checker for things the checker can't catch: coherence (does the protocol address the assessment?), client fit (does the plan respect `medical_history` / `active_conditions` / `medications` / `allergies`?), translation accuracy (does each `coach_rationale` match what the catalogue says about that supplement's mechanisms?), and completeness.
- Subgraph-driven context: `_collect_plan_refs(plan)` + `_build_plan_subgraph(plan, cat)` pull only the catalogue records the plan actually references (topics, mechanisms, symptoms, supplements, claims) plus claims that cite in-scope entities. Alias-aware mechanism resolution. Plan + client snapshots strip provenance noise so the model sees substance.
- Tool-use forces structured output: `{concerns: [{severity, category, message, where, suggested_fix?}], overall_assessment, coherence_score, client_fit_score}`. System prompt explicitly forbids re-flagging anything the deterministic checker handles.
- Streaming + `cache_control: ephemeral` on the system block + catalogue subgraph block — first call ~$0.08, warm cache (within 5-min TTL) ~$0.02.
- New CLI: `fmdb plan-ai-check <slug> [--save | --no-save]` (defaults to `--save`, persists into `plan.ai_sanity_check`). Mirrors `cmd_plan_check` output format. Exits 1 on any `critical` concern.
- Smoke-tested on `cl-001-2026-04-29-foundations` (an empty draft): 3 critical + 2 warning + 2 info concerns, coherence=1/5, client_fit=2/5. Correctly identified the empty-shell issue + flagged a real client-fit concern (Hashimoto's vs future ashwagandha) + India-vegetarian nutrition note. No hallucinated slugs.

**v0.22** — Plan publish lifecycle (submit / publish / revoke / supersede / diff):
- New module `fmdb/plan/transitions.py` implements the full state machine: `draft → ready_to_publish → published → {superseded | revoked}`. Each transition appends a `StatusEvent` to `plan.status_history` with actor + reason + UTC timestamp.
- **Submit gate.** `submit_plan()` re-runs `check_plan` and refuses to advance if any finding is `CRITICAL`. Errors surface the failing findings inline so the coach knows what to fix.
- **Publish freezes the catalogue.** `publish_plan()` calls `git rev-parse --short HEAD` on the catalogue repo and pins `catalogue_snapshot.git_sha` + `snapshot_date` onto the plan before writing the versioned file. Re-runs the deterministic check first (catalogue may have drifted between submit and publish) and bumps `version` to `max(existing published versions) + 1`.
- **Revoke / supersede are clean.** Both transitions remove the now-stale `published/<slug>-vN.yaml` after writing the flipped record to `revoked/` or `superseded/`, so `load_plan` resolves to the current state instead of returning the stale published copy. Audit trail lives in `status_history` + git history.
- **Supersede sequencing.** `supersede_plan(new_slug)` requires the new plan to be `ready_to_publish` AND have `supersedes=<old_slug>` set. It publishes the new plan first, then flips the old one — so the new published version exists before the old one disappears from `published/`.
- **Diff.** `diff_plans(slug_a, slug_b)` returns a unified diff of the two plans' YAML dumps. Useful for "what changed between v1 and v2" reviews.
- **5 new CLI commands** wired in `fmdb/cli.py`: `plan-submit`, `plan-publish`, `plan-revoke` (`--reason` required), `plan-supersede`, `plan-diff`. All honour `FMDB_PLANS_DIR` + `FMDB_USER`.
- End-to-end smoke test passes: draft → add-topic → submit → publish (file lands at `published/<slug>-v1.yaml`, drafts/ + ready/ cleaned, git SHA `508c574` pinned) → revoke (clean handoff to `revoked/`, `plan-show` reflects new status) → supersede (new plan publishes, old plan flips to `superseded/`, no stale file in `published/`).

**v0.21** — VitaOne course PDFs fully ingested (Phases 1–5):
- Bulk-ingested all 22 remaining VitaOne PDFs (cheatsheets + e-books + LDN article + 11 toolkits) via `/tmp/phases-1to5-rest.sh`. Earlier rounds had landed 8 sessions of *Microbiome Mondays* + supplementation-dosage PDF + the first 4 cheatsheets.
- Wrote `/tmp/approve-all-pending.py` that approves every staged batch with `--update` smart-merge + auto-fixes alias collisions on BOTH sides (staged candidates AND existing canonical files) before retry. 19 batches landed clean in this final pass.
- **Defensive staging fix.** `fmdb/ingest/staging.py` now records-and-skips when the LLM emits a non-dict (string/null) for an entity slot, instead of crashing the whole batch with `AttributeError: 'str' object has no attribute 'get'`. Rejected entries surface in the batch manifest with `reason` + `raw_sample`.
- Cleaned up 2 orphan staging dirs (no `_meta.json` from aborted runs).
- **Catalogue size delta:**
  - Sources: 12 → **39**
  - Topics: 26 → **110**
  - Mechanisms: 10 → **116**
  - Symptoms: 10 → **143**
  - Claims: 128 → **546**
  - Supplements: 72 → **171**
  - Cooking adjustments / home remedies / mindmaps: 3 / 3 / 3 (unchanged this round)
- Validate: **0 errors, 504 warnings** (all warnings are non-blocking unresolved cross-refs — the long tail of slugs the model referenced but hasn't yet been seeded; tracked via `fmdb pending-refs`).

**v0.20** — PDF ingest + Resources Toolkit + 49 supplements added:
- **PDF ingest support.** `fmdb/ingest/loaders.py` now lists `.pdf` and image extensions in `LOADERS`, with a stub-text return; `IngestRequest` gained an `attachments: list[dict]` field for binary content blocks. `cmd_ingest` detects PDF/image and loads bytes as base64 attachment. `AnthropicExtractor.extract()` rebuilds the user content as a list, putting PDF (`{"type": "document"}`) and image (`{"type": "image"}`) content blocks first, then the text payload.
- **Streaming for large outputs.** Switched `messages.create` → `messages.stream(...)` with `get_final_message()`. Anthropic requires streaming for `max_tokens > 8192`. Default bumped to 32K.
- **First PDF ingested**: `Supplementation Dosage.pdf` (105KB) → 49 new supplements + 15 enrichments to existing ones via smart-merge. Catalogue: **23 → 72 supplements**.
- New module `fmdb/resources/`: **`Resource`** model (slug, title, kind, audience, description, content via file_path|url|text, related_topics/mechanisms/supplements, tags, shareable, license_notes, lifecycle). Stored at `~/fm-resources/` (separate from catalogue and from plans, override via `FMDB_RESOURCES_DIR`).
- New sidebar page **🧰 Resources Toolkit** — browse with kind/audience/topic filters + text search; per-resource card with download button + open-link + inline-body expander; add-form supports file path / URL / inline markdown; bridges to catalogue topics/supplements/mechanisms.
- **31 VitaOne PDFs auto-imported** as Resource records via `/tmp/import_vitaone_resources.py` — files stay in their original location at `~/fm-plans/Vitaone Resources from course/`, only metadata records are created. Heuristic kind classifier (cheatsheet / protocol / article / recipe / slide_deck / form) and topic mapping based on filename keywords.
- Resource breakdown: 13 cheatsheets, 12 protocol toolkits, 3 articles, 1 form, 1 slide deck, 1 recipe collection. All marked `shareable: false` with VitaOne licence note.

**v0.19** — `MindMap` entity + Vitaone scrape (A + C):
- New 9th catalogue entity: **`MindMap`** (slug, display_name, description, related_topics, related_mechanisms, recursive `tree: list[MindMapNode]`, sources, evidence_tier, lifecycle). `MindMapNode` is a recursive Pydantic model with `label`, `children`, optional `linked_kind`+`linked_slug` for re-centerable bridges to other catalogue entities.
- Loader/validator/CLI integration (alias-aware reuse). Validator walks the recursive tree and warns on unresolved `linked_*` references; resolves `related_topics` and source citations the same as other entities.
- New rendering: `curated_to_mermaid()` in `fmdb/assess/mindmap.py` converts a `MindMap` instance to Mermaid mindmap source. Mind Map page now has **two tabs**: 📘 Curated mind maps (lists `MindMap` entities) and 🌐 Auto from catalogue (existing).
- **Scraped 3 MindMaps from Vitaone** (`tools.vitaone.in/mind-maps`) via Chrome MCP:
  - `fm-approach-to-hypothyroidism` (199 nodes, 7 branches)
  - `adrenal-fatigue` (287 nodes, 6 branches)
  - `hypertension` (388 nodes, 13 branches)
  - 874 nodes total. Source `vitaone-mind-map-tool` registered.
  - Scraping technique: page is a Vite SPA with no runtime API. Used Chrome MCP to (1) click "Expand All" then recursively click `button[aria-label="Expand"]` until none remain, (2) walk DOM nodes with tailwind color classes to determine depth (indigo-100 → blue-50 → teal-50 → amber-50 → rose-50), (3) reconstruct parent-child via `closest depth-(d-1) node with smaller x and nearest y`, (4) JSON.stringify and trigger Blob download.
- Catalogue: 12 sources, 26 topics, 10 mechanisms, 10 symptoms, 128 claims, 23 supplements, 3 cooking adjustments, 3 home remedies, **3 mindmaps**. 0 errors, 179 warnings (unchanged).

**v0.18** — Mind Map page (auto-generated from catalogue):
- New module `fmdb/assess/mindmap.py` — `build_tree(cat, kind, slug)` walks the catalogue's cross-links rooted at any entity (topic / mechanism / symptom / supplement / claim) and returns a 2-level tree grouped by relationship type. `to_mermaid(tree)` converts to Mermaid `mindmap` syntax.
- New sidebar page **🧭 Mind Map** — pick any entity, render as horizontal collapsible tree (matches vitaone-style: root in centre, category branches like "Related topics / Key mechanisms / Common symptoms / Supplements / Cooking adjustments / Home remedies / Red flags", then atoms).
- Renderer uses Mermaid via CDN (no extra pip dep) inside `streamlit.components.v1.html`. Custom theme matches the FM tool palette.
- Side panel below the map shows the rooted entity's details (summary, evidence_tier badge, coaching/clinician scope notes); right column has clickable nav buttons to re-center on any visible child node.
- Inspired by vitaone's mind-map tool (Functional Medicine Approach to Hypothyroidism, Adrenal Fatigue, Hypertension) — same horizontal-tree pattern but auto-generated from our catalogue rather than hand-curated. Hand-curated `MindMap` entity type deferred to a later turn.

**v0.17** — coach UX polish: backlog, evidence surfacing, client edit/delete, session detail, cache fix:
- **Catalogue Backlog** (new `fmdb/backlog.py` module). When the AI's analysis includes `catalogue_additions_suggested`, items are auto-captured into `data/_backlog.yaml` (gitignored). Items dedupe by `(kind, name)` and bump `seen_count` on repeated suggestions. New sidebar page **📝 Catalogue Backlog** with tabs: Open / Added / Rejected / Add manually. Status transitions are coach-driven (mark Added when actually authored to catalogue, Reject otherwise).
- **Evidence-tier surfacing.** Every catalogue-referencing suggestion (drivers, topics, supplements) now displays a colored evidence-tier badge (🟢 strong / 🟡 plausible / 🟠 fm_specific_thin / 🔴 confirm_with_clinician). Each also has an expandable **📚 Catalogue sources** panel showing the original citations + verbatim quotes. Alias-aware lookup: if the AI uses a slug variant, the canonical entity's metadata is shown.
- **Client edit + delete** (new **✏️ Edit / Delete** tab on Clients page). Edit form pre-fills all current fields, bumps `version` on save. Delete requires typing the `client_id` to enable — and refuses if any `drafts/`, `ready/`, or `published/` plans reference this client (revoke or delete plans first).
- **Session timeline detail view.** The Assess page's prior-sessions panel is now a clickable timeline (newest first). Clicking **View** on a session opens its full record: presenting complaints, symptoms/topics selected, uploaded files, measurements snapshot, drivers identified, supplements suggested, synthesis notes, generated plan slug.
- **The "stale module cache" bug is permanently fixed.** New code at the top of `fmdb_ui/app.py` evicts every cached `fmdb.*` module on every Streamlit script rerun. Adding a class to a model file no longer requires a full streamlit restart. Cost: ~50-100ms per rerun.
- New `delete_client()` helper in `fmdb/plan/storage.py` with active-plan refusal + summary return value.
- New tool-schema field `catalogue_additions_suggested` + system-prompt rule #14 telling the AI to populate it for items it would have suggested if they existed.

**v0.16** — per-client directories + Sessions + history-aware Analyze:
- **Storage restructure (auto-migrating).** `~/fm-plans/clients/<id>.yaml` → `~/fm-plans/clients/<id>/client.yaml` with sibling `files/` (lab/food uploads, dated) and `sessions/` (per-Analyze records). `_migrate_flat_clients()` runs on app start; idempotent.
- New `Session` model — append-only record per Analyze run. Captures: selected symptoms/topics, presenting complaints, uploaded file refs, measurements snapshot, full AI output, chat log, optional `generated_plan_slug`. Stored at `clients/<id>/sessions/<id>-YYYY-MM-DD-NNN.yaml`.
- New `UploadedFileRef` and `ChatTurn` sub-models (used inside Session).
- New `Client.medical_history: list[str]` — past diagnoses + current status (e.g., "Hashimoto's diagnosed 2018, antibodies normalized 2023, on levothyroxine"). Distinct from `active_conditions`. Surfaced in client snapshot + sent to AI synthesis.
- **History-aware Analyze.** When Analyze runs, prior sessions for this client are auto-bundled (compact form: date, drivers, supplements, extracted_labs, synthesis_notes) and passed to `synthesize()` as `session_history`. New system-prompt rule #13 instructs the AI to compare timepoints, weight toward adjustments not restarts on rechecks, surface unchanged symptoms despite prior protocol, and explain departures from prior plan.
- Assess page shows a **🕰️ Prior sessions** expander listing each session's date / drivers / supplements when prior sessions exist.
- Files uploaded during Analyze are persisted to `clients/<id>/files/<YYYY-MM-DD>-<filename>` with dedup-by-suffix; `UploadedFileRef` records what kind (lab_report | food_journal) and when.
- Client form: `client_id` is now **auto-generated** (cl-001, cl-002, ...) instead of user-typed. Form has `clear_on_submit=False` so validation errors don't wipe data.

**Per Shivani's preferences this turn:**
- Single Session type (not intake/follow_up/check_in distinction).
- History-aware Analyze auto-includes ALL prior sessions (no manual "compare with session X" picker).

**v0.15** — bio + food log + follow-up chat (Assess workflow gets richer inputs and conversational refinement):
- New `Measurements` sub-model on Client: height_cm, weight_kg, waist_cm, hip_cm, resting_heart_rate, blood_pressure, measured_on, notes. Computed properties: `bmi`, `waist_hip_ratio`, `bmr_mifflin_st_jeor(age, sex)` (Mifflin-St Jeor formula).
- `Client.estimated_age()` derives age from `age_band` midpoint for BMR computation.
- New Clients form section captures bio at intake; Assess client snapshot displays computed BMI / W:H / BMR with estimated age annotation.
- Assess page adds **separate food-journal uploader** alongside lab uploader. Both pass to suggester with `kind: lab_report | food_journal` distinguisher; system prompt rule #10 instructs the model to derive nutrition patterns from food logs (not lab values), with India-specific defaults (rule #11).
- New **chat panel** after suggestions: `ai_chat()` in suggester.py keeps message history in `st.session_state`, caches client+subgraph+suggestions context across turns (~$0.05-0.10 per turn). Uses `st.chat_message` / `st.chat_input` for native chat UI.
- System prompt now uses bio: BMI > 25 + central adiposity flags visceral-adiposity / insulin-resistance pattern; BMR informs caloric advice; HR / BP flag CV risk.

**Next-turn architecture** (proposed): per-client directories (`~/fm-plans/clients/<id>/{client.yaml, photo.jpg, files/, sessions/}`), `Session` entity for follow-up tracking (date, current symptoms, current measurements, AI analysis snapshot, chat log, generated plan reference), photo upload, session timeline view, history-aware Analyze.

**v0.14** — Assess & Suggest workflow (the real product):
- Pivot from "structured form" to "decision support tool" — coach inputs symptoms + topics + lab reports → tool synthesizes possible drivers + interventions drawn from the catalogue → coach reviews, picks, generates draft plan.
- New module `fmdb/assess/`:
  - `subgraph.py` — given selected symptoms + topics, walks the catalogue graph (symptom → topic + mechanism, topic → claims + supplements + cooking + remedies, mechanism → related-mechanism) to build a focused context bundle (~35K tokens for a typical query).
  - `suggester.py` — Anthropic call with attached lab files (PDF/image as document/image content blocks), catalogue subgraph, client context. Tool-use forces structured output: ranked drivers, topics, lifestyle, nutrition (incl. cooking adjustments + home remedies), supplements, lab follow-ups, referrals, education framings. Slugs constrained to subgraph whitelist.
- New Streamlit page **🧠 Assess & Suggest** (now the default landing page):
  - Pick client → multi-select symptoms (with aliases shown) + topics + free-text → upload lab PDFs/images → click Analyze → suggestions render with checkboxes → click "Generate draft plan" → pre-filled YAML lands in `~/fm-plans/drafts/`.
  - Live cost telemetry, evidence-tier flagging, contraindication checks vs client meds.
- Empirical first call cost: ~$0.20 per analysis (35K input + 5-10K output, system prompt cached).

**v0.13** — local web UI (Streamlit) — coach-friendly front-end:
- New module `fmdb_ui/app.py` — single-file Streamlit app sitting on top of fmdb/ engine. Same models, same storage, same plan-check; only the presentation layer is new.
- Launch via `./run-fmdb.sh` from project root → opens at `http://localhost:8501`. No server, no auth, no deploy.
- 3 pages: **Plans** (the meat — picks client → tabbed editor for assessment / lifestyle / nutrition / education / supplements / labs / referrals / tracking, with live plan-check sidebar), **Clients** (list + new), **Catalogue Browser** (read-only).
- Design rules: every form input is a dropdown populated from the live catalogue (no slug typing); errors say what to do next; live plan-check turns red on CRITICAL findings.
- Future-proof: the UI is a thin layer. Native Mac wrapper (Tauri/Electron/SwiftUI) later changes only the front-end; the engine stays.

**v0.12** — `Client` + `Plan` layer + deterministic plan-check:
- New module `fmdb/plan/` separate from catalogue entities; plans live OUTSIDE this repo (PHI). Default plans root: `~/fm-plans/` (override via `FMDB_PLANS_DIR` env or `--plans-dir` flag).
- New entities: **`Client`** (id, intake_date, age_band, sex, conditions, medications, allergies, goals, notes — opaque id, age band not exact birthdate). **`Plan`** (slug, client_id, plan_period, assessment, lifestyle, nutrition, education, supplement_protocol, lab_orders, referrals, tracking, lifecycle, catalogue_snapshot).
- New enums: `PlanStatus` (draft / ready_to_publish / published / superseded / revoked), `ReferralUrgency`.
- Storage layout: `<plans_root>/clients/`, `drafts/`, `ready/`, `published/<slug>-v<n>.yaml`, `superseded/`, `revoked/`. Status determines bucket. Versioned files for non-live buckets.
- **Deterministic plan-check** (`fmdb plan-check <slug>`) — alias-aware xref of every catalogue reference (topics, mechanisms, symptoms, supplements, cooking_adjustments, home_remedies, claims) + supplement contraindication / med-interaction check against client + scope warning when supplement has `evidence_tier: confirm_with_clinician`. Severity: CRITICAL (blocks transition out of draft) | WARNING (requires ack) | INFO. Exits non-zero on CRITICAL.
- CLI surface (12 new commands):
  - `client-new`, `client-show`, `client-list`, `client-edit`
  - `plan-new`, `plan-show`, `plan-list`, `plan-edit`, `plan-check`, `plan-delete`
  - `plan-add-supplement`, `plan-add-topic`, `plan-add-symptom`
- **v1 simplifications** (per Shivani):
  - Single-author model — no clinician sign-off step. `confirm_with_clinician` evidence tier is the surface where the AI sanity check warns.
  - Practices and tracking habits are FREEFORM strings, NOT entity types (overrode design-doc default — promote to entities only if duplication observed in real plans).
  - No JSON export contract / mobile app for now — desktop-first build.
- End-to-end smoke test verified: client-new → plan-new → add-{topic,symptom,supplement} → plan-show → plan-check (clean run + bogus refs both surface correctly).
- Catalogue unchanged: 11 sources, 26 topics, 10 mechanisms, 10 symptoms, 128 claims, 23 supplements, 3 cooking_adjustments, 3 home_remedies. 0 errors, 179 warnings.

**v0.11** — `CookingAdjustment` + `HomeRemedy` entities (Plan-section dependencies):
- Both entities follow the established alias-aware pattern (full pipeline integration).
- `CookingAdjustment`: cookware/oil/water/food-prep swaps with `swap_from`, `benefits`, `how_to_use`, `cautions`. Categories: cookware | oil | water | food_prep | storage | kitchen_tool | other.
- `HomeRemedy`: Ayurvedic churans, infused waters, kashayams, kitchen remedies. Fields: `indications`, `contraindications`, `preparation`, `typical_dose`, `duration`, `timing_notes`. Categories: ayurvedic_churan | infused_water | herbal_tea | kashayam | kitchen_remedy | spice_blend | other.
- 3 seed cooking adjustments (cast-iron-cookware, swap-to-ghee-or-coconut-oil, soak-and-sprout-legumes).
- 3 seed home remedies (triphala-churan, cumin-coriander-fennel-tea, golden-milk).
- CLI: `cooking-adjustments`, `show-cooking-adjustment`, `home-remedies`, `show-home-remedy`.
- Catalogue: 11 sources, 26 topics, 10 mechanisms, 10 symptoms, 128 claims, 23 supplements, **3 cooking_adjustments**, **3 home_remedies**. 0 errors, 179 warnings (unchanged — new entities have valid xrefs).

**Plan revision (per Shivani):**
- Single-author model — coach authors all sections; no clinician sign-off step. The `evidence_tier: confirm_with_clinician` tag in catalogue entries is the surface where AI sanity-check warns against authoring without clinician input.
- Lifecycle simplified: `draft → ready_to_publish → published → superseded | revoked`.
- Mobile app deferred — desktop-first build with Markdown render for client-facing copy. No JSON export contract for now.
- Build order updated: CookingAdjustment + HomeRemedy → Plan model → Plan CLI → deterministic sanity check → lifecycle → AI sanity check → publish + diff-guard → Markdown render.

**v0.10** — `Symptom` entity + topic.common_symptoms cross-validation:
- New entity: `Symptom` (slug, display_name, aliases, category, severity, description, when_to_refer, linked_to_topics, linked_to_mechanisms, sources)
- Categories: gi | musculoskeletal | neurological | mood | sleep | skin | hormonal | metabolic | constitutional | cardiovascular | urinary | other. Severity: common | concerning | red_flag.
- **Topic.common_symptoms now cross-validated** against the symptom slug+alias index. Lookup tries both verbatim alias match (catches space-containing client phrases like `"skin issues"`) and slugified form (catches `"brain fog"` → `brain-fog`).
- 10 seed symptoms (bloating, brain-fog, fatigue, constipation, joint-pain, food-sensitivities, weight-gain, gas, loose-stools, skin-rash) with 50+ total aliases mapping client language → canonical.
- Same alias-collision check as Mechanism / Topic — symptoms can't shadow each other or other entities' canonical slugs.
- **Slug-collision policy with Topics is allowed** (e.g., `anxiety` exists as both — symptom `anxiety` is the felt experience, topic `anxiety` is the clinical area; cross-link via `symptom.linked_to_topics`).
- **Data-quality signal surfaced**: 119 of 192 historical symptom-prose entries in topics don't resolve — mostly multi-symptom prose ("constipation or loose stools"), too-general labels ("thyroid dysfunction"), or atomic symptoms not yet seeded. Previously invisible; now counted and addressable.
- Catalogue: 11 sources, 26 topics, 10 mechanisms, **10 symptoms**, 128 claims, 23 supplements. 0 errors, 179 warnings.

**v0.9** — `Mechanism` entity + alias-aware cross-reference resolution:
- New entity: `Mechanism` (slug, display_name, aliases, category, summary, upstream_drivers, downstream_effects, related_mechanisms, linked_to_topics, sources, evidence_tier). Categories: endocrine | neurological | immune | metabolic | gut | structural | signaling | other.
- **Alias-aware resolution.** Validator builds a `{slug-or-alias → canonical-slug}` index per entity-with-aliases (mechanisms + topics). When `topic.key_mechanisms` references `intestinal-permeability`, validator finds it as an alias of canonical `leaky-gut` — no warning, no edit needed. Resolved ~37 of the 79 historical mechanism slug-variants automatically just by seeding 10 mechanisms with rich aliases.
- **Alias collision detection.** New error: an alias that collides with another entity's canonical slug. Caught one real bug at first run (`gut-hormone-axis` had `estrobolome` as an alias, but `estrobolome` is its own topic).
- 10 seed mechanisms covering: hpa-axis-dysregulation, leaky-gut, insulin-resistance, estrogen-decline, scfa-production, microbial-diversity-decline, chronic-inflammation, low-progesterone, estrogen-enterohepatic-recirculation, gaba-a-receptor-modulation. Long-tail (42 mechanism slugs) tracked as pending-refs, will fill from future ingests.
- CLI: `mechanisms`, `show-mechanism <slug>`. Extractor schema + system-prompt rule #13 teach the model when to emit a Mechanism vs. fold it into a Topic.
- Catalogue: **11 sources, 26 topics, 10 mechanisms, 128 claims, 23 supplements**, 0 errors, 60 warnings.

**v0.8** — catalogue at production scale, pipeline survives real-world chaos:
- Ingested all 8 sessions of Cynthia Thurlow's *Microbiome Mondays* course (8 separate Source records, one per session)
- Catalogue: **11 sources, 26 topics, 128 claims, 23 supplements**, 0 errors, 18 warnings (4 cross-ref pending: `digestive-enzymes`, `tudca`; 14 forms-with-dose-unspecified — kept on purpose)
- **Validator philosophy correction:** `forms_available` declared without `typical_dose_range` is now a **warning, not an error**. Reverses an earlier wrong move where I cleared form info on supplements lacking dose data — the right rule is "capture what you know, surface what you don't, don't discard." Symmetric error: a `typical_dose_range` key for a form NOT in `forms_available` (real inconsistency) still blocks.
- `Warning_.is_xref` distinguishes unresolved cross-references from other gap warnings; `pending-refs` filters to xrefs only.
- New `SourceType.llm_synthesis` + extractor system-prompt rule #12 self-throttles evidence_tier when source_type ∈ {llm_synthesis, other}
- Schema additions: `SupplementForm.whole_food` (chia/flax/psyllium), `DoseUnit.tablespoons`
- Smart-merge demonstrated at scale: across 8 topic conflicts and 2 claim conflicts, no canonical data was lost. **Caveat noted:** smart-merge will downgrade scalar `evidence_tier` if the new candidate is weaker. Future improvement: special-case evidence_tier so it never downgrades unless `--overwrite`.
- Atomic approval prevented 2 broken commits (sessions 5 + 7) — pre-flight catches `forms_available` declared without dose ranges before any file moves
- Total ingestion spend across the project so far: ~$1.34
- New CLI: `fmdb pending-refs` lists every unresolved cross-reference grouped by target

**v0.7** — pipeline hardened, catalogue grew 5×:
- **Atomic approval.** `approve` pre-flights validation against a simulated post-state (current canonical + about-to-promote files merged in memory). Files only move to disk if the simulated state has zero errors. Rollback on commit failure. No more half-committed state.
- **Validator split into errors vs warnings.** Errors block (schema, dupes, internal contradictions); unresolved cross-refs become non-blocking **warnings** so forward references survive in canonical files (no data loss). `validate` exits 0 on warnings-only; `--strict` flag elevates them.
- **`pending-refs` CLI** lists every unresolved cross-ref grouped by target — answers "what stubs am I owed?" at a glance.
- **Smart-merge on `--update`.** `approve --update` now unions lists (sources, interactions, topic links, etc.), prefers non-empty new scalars, keeps canonical otherwise. Bumps version. `--overwrite` retained for the rare destructive case. Demonstrated on magnesium-glycinate: kept its 4 topic links + claim link + zinc/calcium spacing rules + contraindications, gained richer notes + a second source citation.
- **Schema additions.** `DoseUnit` gained `IU` (vitamin D, E, A) and `billion_CFU` (probiotics).
- **Catalogue grew to:** 3 sources, 7 topics (added autoimmune, inflammation as stubs), 13 claims, **17 supplements** (14 added this round from practice_guide.md ingest).
- **Pipeline runs so far:** 2 real LLM ingests (~$0.24 total), 0 partial-commits, 0 lost references.

Open follow-ups: seed `calcium` supplement (last warning); enrich `vitamin-a` and stub `vitamin-d` with clinician-reviewed dose ranges; add PDF/transcript loaders.

**v0.6** — first real LLM ingest landed:
- `evidence_tiers.md` (TOPIC 1 Thyroid) extracted via `AnthropicExtractor` (claude-sonnet-4-6) → 1 topic + 11 claims + 2 stub supplements promoted to canonical
- Catalogue now: 2 sources, 5 topics, 13 claims, 3 supplements
- `.env` auto-loaded by CLI (`python-dotenv`, override=True so .env wins over stale shell exports)
- API usage (input/output/cache tokens, stop_reason, model) logged into batch manifest + audit log
- Validator loosened: empty `forms_available` now allowed for stub supplements (cross-field check still enforces consistency when forms ARE declared)
- Known issue: approval is non-atomic — files move first, validator runs after; if validation fails canonical is left in inconsistent state. Requires manual cleanup. Fix: pre-flight validate against simulated post-state before promoting.

**v0.5** — four entities + ingestion pipeline:
- Entities: `Supplement`, `Source`, `Topic`, `Claim` (Pydantic + loader + validator + CLI)
- Read CLI: `validate`, `list`, `show <slug>`, `sources`, `show-source <id>`, `topics`, `show-topic <slug>`, `claims`, `show-claim <slug>`
- Pipeline CLI: `ingest <path>`, `review [batch]`, `approve <batch> [--only ENTITY/SLUG] [--update]`, `reject <batch> [--only ENTITY/SLUG]`, `audit -n N`
- Cross-ref validation across all four entities: supplement→source/topic/claim, topic→source/related-topic, claim→source/topic/supplement
- Pipeline architecture:
  - `fmdb/ingest/loaders.py` — file → text (md/txt working; pdf/video/html stubs)
  - `fmdb/ingest/extractor.py` — `Extractor` Protocol with `StubExtractor` and `AnthropicExtractor` (tool-use, prompt cache on system + schema)
  - `fmdb/ingest/staging.py` — enrich extractor output with lifecycle fields, validate against Pydantic, write to `data/staging/<batch_id>/<entity>/<slug>.yaml`, mark new/conflict/rejected
  - `fmdb/ingest/audit.py` — append-only JSONL at `data/_audit.jsonl`
- Pipeline guarantees: source-first (auto-registers Source candidate from CLI metadata), Pydantic-validated before staging, conflict-safe (refuses overwrite without `--update`, bumps `version` on update), post-approval re-validation
- Env: `FMDB_EXTRACTOR=stub|anthropic`, `FMDB_EXTRACTOR_MODEL`, `ANTHROPIC_API_KEY`, `FMDB_USER`
- Seed entries unchanged from v0.4
- `data/staging/` and `data/_audit.jsonl` gitignored

**Next:** Wire a real ingest run against the vitaone evidence_tiers.md to seed ~10-20 claims + supplements; then PDF + transcript loaders; then plan schema + publishing flow.

## Architecture (current)

### Catalogue Entity Types — 9 built, 8 deferred

**Built:**
1. **Source** — citation registry (12 entries: vitaone skill, evidence tiers ingest, practice guide, 8 Thurlow microbiome sessions, vitaone mind-map tool, vitaone supplementation dosage)
2. **Topic** — clinical area (~26 entries: thyroid, perimenopause, anxiety, insomnia, pcos, microbiome, dysbiosis, autoimmune, inflammation, estrobolome, gut-hormone-axis, gut-brain-axis, etc.)
3. **Mechanism** — physiology (~10 entries: hpa-axis-dysregulation, leaky-gut, insulin-resistance, estrogen-decline, scfa-production, etc.). Alias-aware resolution canonicalizes variant slugs.
4. **Symptom** — client-facing experiences with severity + category (~10 entries: bloating, brain-fog, fatigue, joint-pain, etc.). Alias-aware lookup against `topic.common_symptoms` prose.
5. **Claim** — evidence-tiered assertion (~128 entries). First-class entity citing source + linked to topics/mechanisms/supplements.
6. **Supplement** — abstract compound (~72 entries after Vitaone Supplementation Dosage ingest)
7. **CookingAdjustment** — cookware/oil/water/food-prep swaps (~3 entries)
8. **HomeRemedy** — churans, infused waters, kashayams, kitchen remedies (~3 entries)
9. **MindMap** — hand-curated clinical mind maps (~3 entries: 874 nodes scraped from vitaone for hypothyroidism, adrenal fatigue, hypertension)

**Deferred (not yet modeled):**
- Food, LabTest, LifestylePractice, DietaryPattern, Practice (currently freeform strings on Plan), Recipe, Protocol, EducationalModule, MiscIntervention. Promote to entities only after observing duplication in real plans.

### Authoring Model — Single-author (revised v0.12)

The original design called for clinician-partnered authoring with field-level signatures. **Per Shivani 2026-04-29:** single-author for v1 — coach (Shivani) authors all sections. The `evidence_tier: confirm_with_clinician` tag in catalogue entries is the surface where the AI sanity check warns against authoring without clinician input. Clinician sign-off layer can be added later without changing the data model.

### Evidence Tiers
`strong` | `plausible_emerging` | `fm_specific_thin` | `confirm_with_clinician`

Surfaced as colored badges (🟢 / 🟡 / 🟠 / 🔴) on every catalogue-referencing suggestion in the UI, with expandable source-citation panels.

### Source Quality
`high` | `moderate` | `low`. Combined with `source_type` (internal_skill | peer_reviewed_paper | textbook | clinical_guideline | expert_consensus | book | website | llm_synthesis | other) so `llm_synthesis` outputs auto-throttle to lower evidence tiers in the extractor.

### Validator: errors vs warnings
- **Errors** block: schema failures, duplicate slugs, self-references, unfilled required citations, internal cross-field violations (e.g., `typical_dose_range` keyed to a form not in `forms_available`).
- **Warnings** are non-blocking: unresolved cross-references (forward references — preserved in canonical files; resolve auto when the target is added). `forms_available` declared without `typical_dose_range` is a warning (stub supplement, dose TBD).

`fmdb.cli pending-refs` lists every unresolved cross-ref grouped by target — the "what catalogue stubs do I owe?" view.

### Atomic Approval
`fmdb.cli approve <batch>` pre-flights validation against the simulated post-state (current canonical + about-to-promote files merged in memory). Files only move to disk if zero errors. Rollback on commit failure. **No half-committed state.**

`--update` triggers smart-merge (union lists, prefer non-empty new scalars); `--overwrite` is the rare destructive case.

### Plan Lifecycle (revised v0.12, implemented v0.22)
`draft → ready_to_publish → published → superseded | revoked`

Simplified from the original 6-state design after dropping clinician sign-off. Implemented in `fmdb/plan/transitions.py`:
- `submit_plan` — gate is `check_plan` returning 0 CRITICAL findings.
- `publish_plan` — irreversible. Freezes `catalogue_snapshot.git_sha` to the catalogue repo's HEAD, bumps `version`, writes `published/<slug>-vN.yaml`, removes `ready/<slug>.yaml`. Re-runs check first.
- `revoke_plan` — published → revoked. Reason required. Removes the now-stale `published/<slug>-vN.yaml` after writing the flipped record so `load_plan` resolves to the revoked record.
- `supersede_plan` — publishes a new plan that has `supersedes=<old_slug>` set, then flips the old plan from `published` to `superseded` (with the same cleanup).
- `diff_plans` — unified diff between two plans' YAML dumps.

Each transition appends a `StatusEvent` (state + by + at + reason) to `plan.status_history`.

### Storage Layout
- **Catalogue YAML** → `fm-database/data/` (committed to repo; alphabetical entity dirs: `sources/`, `topics/`, `mechanisms/`, `symptoms/`, `claims/`, `supplements/`, `cooking_adjustments/`, `home_remedies/`, `mindmaps/`).
- **Catalogue transients** → `fm-database/data/staging/` (per-batch ingest staging) and `data/_audit.jsonl` and `data/_backlog.yaml` (gitignored).
- **Client + Plan PHI** → `~/fm-plans/` (separate from repo). Per-client dirs: `clients/<id>/{client.yaml, photo.jpg, files/, sessions/}`. Plans bucket-routed by status: `drafts/`, `ready/`, `published/<slug>-v<n>.yaml`, `superseded/`, `revoked/`. Override via `FMDB_PLANS_DIR`.
- **Resources Toolkit** (shareable artifacts) → `~/fm-resources/resources/<slug>.yaml`. Files referenced by absolute path; can live anywhere. Override via `FMDB_RESOURCES_DIR`.

## File Map

```
fm-database/
  fmdb/                           # Python package
    __init__.py
    enums.py                      # ~14 enums (DoseUnit, EvidenceTier, SourceType,
                                  #   PlanStatus, MechanismCategory, SymptomCategory, ...)
    models.py                     # Pydantic models for all 9 catalogue entities
                                  #   + sub-models (DoseRange, Interactions, etc.)
    loader.py                     # load_<entity>, load_<entities> for each type
    validator.py                  # load_all, validate_loaded, overlay,
                                  #   alias-aware resolution, error/warning split
    cli.py                        # argparse front door — read commands, ingest pipeline,
                                  #   client + plan CRUD, audit
    backlog.py                    # catalogue-additions backlog (data/_backlog.yaml)
    ingest/                       # AI ingest pipeline
      types.py                    # IngestRequest, ExtractionResult, EntityType
      loaders.py                  # file → text (md/txt/pdf/image; html stub);
                                  #   pdf/image return stub-text + raw bytes attached
                                  #   as document/image content blocks
      extractor.py                # Extractor Protocol; Stub + Anthropic impls;
                                  #   tool-use for structured output; cached system
                                  #   prompt + schema; streaming for max_tokens > 8k
      staging.py                  # enrich + Pydantic-validate + write
                                  #   data/staging/<batch>/<entity>/<slug>.yaml;
                                  #   atomic approve with simulated-post-state check
                                  #   and smart-merge on --update
      audit.py                    # JSONL audit log
    plan/                         # Client + Plan layer (PHI; storage outside repo)
      models.py                   # Client (with Measurements + medical_history),
                                  #   Plan, Session, sub-models (HypothesizedDriver,
                                  #   PracticeItem, NutritionPlan, EducationModule,
                                  #   SupplementItem, LabOrderItem, ReferralItem,
                                  #   Tracking, ChatTurn, UploadedFileRef, ...)
      storage.py                  # plans_root() resolver, per-client dirs,
                                  #   session CRUD, file storage, auto-migration
                                  #   from legacy flat clients/<id>.yaml layout
      checker.py                  # deterministic plan check: catalogue xref +
                                  #   contraindication + scope + evidence-tier
                                  #   honesty; severity CRITICAL | WARNING | INFO
    assess/                       # Decision-support layer
      subgraph.py                 # build focused catalogue context bundle
                                  #   (~35K tokens) from selected symptoms+topics
      suggester.py                # Anthropic call: structured suggestions tool-use
                                  #   + multi-turn chat with cached context;
                                  #   honors evidence_tier; food-log vs lab handling;
                                  #   India context defaults; medical_history aware
      mindmap.py                  # build_tree (auto from catalogue cross-refs);
                                  #   curated_to_mermaid (for MindMap entities);
                                  #   to_mermaid renderer
    resources/                    # Resources Toolkit (separate ~/fm-resources/)
      models.py                   # Resource entity
      storage.py                  # CRUD; files referenced by absolute path
  fmdb_ui/
    app.py                        # Streamlit single-file UI; 7 sidebar pages:
                                  #   Assess & Suggest, Plans, Clients, Mind Map,
                                  #   Resources Toolkit, Catalogue Browser,
                                  #   Catalogue Backlog. Auto-evicts stale fmdb
                                  #   modules from sys.modules on each script
                                  #   rerun (Streamlit cache-hell fix).
  data/
    sources/                      # one YAML per source (12 entries)
    topics/                       # ~26 entries
    mechanisms/                   # ~10 entries
    symptoms/                     # ~10 entries
    claims/                       # ~128 entries
    supplements/                  # ~72 entries
    cooking_adjustments/          # 3 entries
    home_remedies/                # 3 entries
    mindmaps/                     # 3 entries (vitaone scrape)
    staging/                      # gitignored — ephemeral candidate batches
    _audit.jsonl                  # gitignored — append-only audit log
    _backlog.yaml                 # gitignored — catalogue additions backlog
  README.md
  requirements.txt                # pydantic, pyyaml, anthropic, python-dotenv, streamlit
  run-fmdb.sh                     # robust launcher — kills zombies, clears pycache,
                                  #   disables runOnSave, then starts streamlit
  .env                            # gitignored — ANTHROPIC_API_KEY, FMDB_EXTRACTOR,
                                  #   FMDB_USER, FMDB_EXTRACTOR_MODEL
  .venv/                          # gitignored — local virtualenv
```

## Content Sources

**Tier 1 (own material)** at `.claude/skills/vitaone-fm-reference/`:
- `SKILL.md` — coaching scope (DO NOT use for prescriptive content rules)
- `references/topic_index.md` — symptom clusters, red flags
- `references/evidence_tiers.md` — 70+ tiered claims (model for Claim entity); fully ingested as TOPIC 1 Thyroid → 11 claims + 1 topic + 2 supplement stubs
- `references/practice_guide.md` — coaching guidance (DietaryPattern / HomeRemedy seeds); fully ingested → 13 supplements with dose info
- `references/full_kb.md` — 122 posts (not yet ingested)

**Tier 2 (licensed external)**:
- Cynthia Thurlow *Microbiome Mondays* course — 8 transcripts at `~/Documents/Codex/.../transcripts/kb/`. Sessions 1-8 fully ingested → 102 claims + 7 new topics + 5 supplements.
- VitaOne Education course PDFs — 31 PDFs at `~/fm-plans/Vitaone Resources from course/`. Supplementation Dosage fully ingested (49 new supplements + 15 enrichments). Phase 1 (10 cheatsheets) in progress at v0.20 commit. ~30 PDFs remaining.
- VitaOne mind-maps tool (`tools.vitaone.in/mind-maps`) — 3 hand-curated maps scraped (874 nodes total) and stored as `MindMap` entities.

## Run

### Setup (one time)
```bash
cd fm-database
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
# create .env with ANTHROPIC_API_KEY for ingest + assess
```

### Streamlit UI (the primary surface)
```bash
./run-fmdb.sh                                # opens http://localhost:8501
```
Sidebar pages: 🧠 Assess & Suggest (default), 📋 Plans, 👥 Clients, 🧭 Mind Map, 🧰 Resources Toolkit, 📚 Catalogue Browser, 📝 Catalogue Backlog.

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
.venv/bin/python -m fmdb.cli plan-list [--client <id>] [--status <name>]
```

## Roadmap (what's next)

**Done (v0.2 → v0.20):**
- ✅ All 9 catalogue entity types built and seeded
- ✅ AI ingestion pipeline (PDF + markdown + image attachments; streaming)
- ✅ Plan + Client layer with sessions, history-aware Analyze, deterministic check
- ✅ Streamlit UI with Assess workflow + multi-turn chat + Mind Map + Resources Toolkit
- ✅ Catalogue backlog with auto-capture
- ✅ Atomic approval, smart-merge, alias-aware resolution

**Outstanding:**
1. **Finish PDF ingest pass** — ~30 VitaOne PDFs remaining (~$15 to do all). Phase 1 (10 cheatsheets) in flight at v0.20 commit.
2. ~~Plan publish + diff-guard~~ — ✅ done in v0.22 (`plan-submit`, `plan-publish`, `plan-revoke`, `plan-supersede`, `plan-diff`).
3. ~~AI sanity check on plans~~ — ✅ done in v0.23 (`fmdb plan-ai-check <slug>`; populates `plan.ai_sanity_check`).
4. ~~Markdown / PDF render of plan~~ — ✅ done in v0.24 (`fmdb plan-render` + Lifecycle-tab download buttons; PDF via browser Print-to-PDF).
5. ~~Wire Resources into Plan editor~~ — ✅ done in v0.25 (`Plan.attached_resources` + 📎 Resources tab + render integration). Per-client folder of selected handouts deferred — coach hand-delivers files referenced by basename for now.
6. ~~Cross-link curated MindMap nodes to catalogue entities~~ — ✅ done in v0.25 (`fmdb mindmap-link`; 60 of 871 nodes resolved automatically, rest visible as mining candidates).
7. ~~Mine curated MindMap nodes → backlog suggestions~~ — ✅ done in v0.25 (`fmdb mindmap-mine`; 645 candidates surfaced with guessed kinds).
8. **Promote freeform → entities when sprawl emerges:** Practice, TrackingHabit, Food, LabTest, Recipe, Protocol, EducationalModule.
9. **Edit / Delete client UI** — built. Active-plan-blocks-delete safeguard in place.
10. **JSON export contract for Project 2 (mobile app)** — deferred indefinitely; desktop-first for now.
11. **Native Mac wrapper (Tauri / Electron / SwiftUI)** — engine is UI-agnostic; wrap when the workflow stabilises.
12. **Path B Next.js port — continue.** Scaffold landed in v0.26. Next priorities: structured Plan editor, Clients page, Resources Toolkit page, Assess & Suggest with AI suggester wiring, mechanism/symptom/claim detail pages, Mind Map Mermaid renderer.
