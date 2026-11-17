# Architecture, file map and content sources

> Moved verbatim out of the root `CLAUDE.md` on 2026-11-17 (original lines 1747–2191). Index: [`/CLAUDE.md`](../../CLAUDE.md).
> Covers: Catalogue entity types, authoring model, evidence tiers, validator errors vs warnings, atomic approval, plan lifecycle, storage layout, annotated file map, content sources.
> Version notes describe the code when written; newer entries in `invariants-v0.81-v0.91.md` and git history override older ones.

## Architecture (current)

### Catalogue Entity Types — 9 built, 8 deferred

**Built (counts as of v0.43):**
1. **Source** — citation registry (**82** entries: vitaone skill, evidence tiers, practice guide, 8 Thurlow microbiome sessions, vitaone mind-map tool, supplementation dosage, all VitaOne Phase 1–5 PDFs, coconote FM lectures, Barbara O'Neill, ask-expert sessions, Instagram posts, research papers, nutrition cheatsheets, adrenal hormones batch)
2. **Topic** — clinical area (**318** entries)
3. **Mechanism** — physiology (**408** entries). Alias-aware resolution canonicalizes variant slugs.
4. **Symptom** — client-facing experiences with severity + category (**378** entries). Alias-aware lookup against `topic.common_symptoms` prose.
5. **Claim** — evidence-tiered assertion (**1,492** entries). First-class entity citing source + linked to topics/mechanisms/supplements.
6. **Supplement** — abstract compound (279 entries)
7. **CookingAdjustment** — cookware/oil/water/food-prep swaps (3 entries)
8. **HomeRemedy** — churans, infused waters, kashayams, kitchen remedies (3 entries)
9. **MindMap** — hand-curated clinical mind maps (17 entries: 3 vitaone-scraped + 14 new curated; ~5,800 nodes)

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
      transitions.py              # publish lifecycle: submit / publish / revoke /
                                  #   supersede / diff. Freezes catalogue git SHA
                                  #   on publish. Cleans stale published/ files
                                  #   on revoke + supersede so load_plan resolves
                                  #   to current state.
      ai_check.py                 # AI sanity-check layer on top of deterministic
                                  #   checker — coherence / client_fit / translation /
                                  #   completeness. Cached subgraph (~$0.02 warm).
      render.py                   # client-facing markdown + standalone HTML output
                                  #   (slugs → display names, mechanisms hidden,
                                  #   provenance stripped). Print-to-PDF via browser.
    assess/                       # Decision-support layer
      subgraph.py                 # build focused catalogue context bundle
                                  #   (~35K tokens) from selected symptoms+topics
      suggester.py                # synthesize() + chat() Anthropic calls.
                                  #   Returns typed AssessResult / ChatResult
                                  #   (Pydantic). Cached system + subgraph blocks.
      results.py                  # AssessUsage / AssessResult / ChatResult /
                                  #   ChatContext Pydantic models. Wire format
                                  #   stable for shim callers.
      mindmap.py                  # build_tree (auto from catalogue cross-refs);
                                  #   curated_to_mermaid (linked-node badges);
                                  #   to_mermaid renderer
      mindmap_link.py             # link_mindmap_nodes (alias-aware resolution
                                  #   topic→mech→symptom→supp→claim) + mine_unlinked
                                  #   (depth-2+ candidates → backlog).
    resources/                    # Resources Toolkit (separate ~/fm-resources/)
      models.py                   # Resource entity
      storage.py                  # CRUD; files referenced by absolute path
  fmdb_ui/                        # REMOVED 2026-10-23 (Streamlit "Path A" retired;
                                  #   run-fmdb.sh + the streamlit dep went with it)
  data/
    sources/                      # 82 entries (as of v0.43)
    topics/                       # 318 entries
    mechanisms/                   # 408 entries
    symptoms/                     # 378 entries
    claims/                       # 1,492 entries
    supplements/                  # 279 entries
    cooking_adjustments/          # 3 entries
    home_remedies/                # 3 entries
    mindmaps/                     # 11 entries (3 vitaone-scraped + 8 curated)
    staging/                      # gitignored — ephemeral candidate batches
                                  #   ALL batches approved as of v0.43. Zero pending.
    _audit.jsonl                  # gitignored — append-only audit log
    _backlog.yaml                 # gitignored — catalogue additions backlog
                                  #   (612 items: 167 auto-rejected, 1 promoted,
                                  #   444 open awaiting triage)
  README.md
  requirements.txt                # pydantic, pyyaml, anthropic, python-dotenv
  .env                            # gitignored — ANTHROPIC_API_KEY, FMDB_EXTRACTOR,
                                  #   FMDB_USER, FMDB_EXTRACTOR_MODEL
  .venv/                          # gitignored — local virtualenv

fm-database-web/                  # Path B — Next.js + shadcn rebuild of the coach UI
                                  #   (sibling to fm-database/, NOT inside it).
                                  #   Feature parity with Streamlit as of v0.30+.
                                  #   Stack: Next.js 16.2 (App Router, Turbopack),
                                  #   React 19, TS5 strict, Tailwind v4, shadcn
                                  #   (base-nova, neutral). Zero DB / auth / API
                                  #   mutations — server components read YAML
                                  #   directly; Server Actions write back to YAML.
  src/
    app/                          # 23 routes: /, /catalogue, /catalogue/[kind]/[slug]
                                  #   (all 8 kinds), /catalogue/cleanup (v0.64 — Haiku
                                  #   duplicate / miscategorisation finder), /plans,
                                  #   /plans/[slug] (10-tab editor + plan-check sidebar
                                  #   + lifecycle panel + client-facing export),
                                  #   /assess (Analyze + chat), /clients (+ detail),
                                  #   /resources (+ detail + /resources/generate),
                                  #   /mindmap (+ detail with Mermaid), /backlog (with
                                  #   bulk actions + Supplement Links tab), /sources
                                  #   (Add Source), /search, /ingest.
    components/                   # evidence-tier-badge,
                                  #   plan-status-badge, catalogue-table,
                                  #   multi-select (shared), + 7 shadcn ui/.
    lib/fmdb/                     # paths.ts (resolves to ../fm-database/data and
                                  #   ~/fm-plans by default; FMDB_*_DIR overrides),
                                  #   types.ts (lenient TS shapes mirroring Pydantic),
                                  #   loader.ts + loader-extras.ts + writer.ts,
                                  #   anthropic.ts + anthropic-types.ts (shell-out
                                  #   wrappers around Python suggester),
                                  #   shim.ts (runShim + PYTHON + SCRIPTS_DIR —
                                  #   extracted from anthropic.ts; used by any
                                  #   Server Action that shells out to Python),
                                  #   kinds.ts (v0.64 — KIND_LABELS + kindLabel/Emoji;
                                  #   single source of truth for coach-facing entity
                                  #   names: Conditions / Root causes / Healing programs
                                  #   / Dose schedules / Lab markers / Evidence notes /
                                  #   References. Slugs in YAML stay unchanged).
  scripts/                        # Python shims — all use fm-database/.venv,
                                  #   all stdin/stdout JSON.
    analyze-catalogue-duplicates.py  # v0.64 — Haiku scans all topics + reference
                                  #   lists of protocols/mechanisms/symptoms; structured
                                  #   tool-use returns groups: duplicate_topics,
                                  #   topic_is_protocol/mechanism/symptom. Plan persisted
                                  #   to data/_cleanup/latest_plan.yaml.
    apply-cleanup.py              # v0.64 — applies one cleanup group atomically.
                                  #   Adds member slugs as aliases on canonical so
                                  #   existing references still resolve. Auto-routes
                                  #   when canonical lives in another bucket. Opt-in
                                  #   stub creation when target Protocol/Mechanism/
                                  #   Symptom doesn't yet exist (returns
                                  #   {needs_stub: true, target_kind, target_slug};
                                  #   UI confirms then re-calls with create_stub=true).
    source-save.py                # Write new Source entity to fm-database/data/sources/.
                                  #   Validates SourceType + SourceQuality enums.
                                  #   Returns {ok, id, already_existed, error}.
    assess.py                     # Haiku/Sonnet → synthesize() → AssessResult JSON
    chat.py                       # multi-turn assess chat → ChatResult JSON
    load-session-chat.py          # load prior chat log for a session
    plan-check.py                 # deterministic plan-check → findings JSON
    plan-lifecycle.py             # submit/publish/revoke/supersede/diff actions
    plan-render.py                # markdown or HTML client-facing export
    render-mindmap.py             # curated_to_mermaid() → Mermaid source string
    backlog-action.py             # promote/reject/attach backlog items
    extract-symptoms.py           # Haiku: transcript → symptom slugs + health data
    extract-client-from-transcript.py  # Haiku: transcript → client profile fields
    parse-health-text.py          # Haiku: free-form text → ExtractedHealthData JSON
    update-client-data.py         # merge health data into client.yaml + append snapshot
    compute-ratios.py             # compute FM lab ratios (HOMA-IR, TG/HDL, etc.)
    save-session.py               # persist assess session to YAML.
                                  #   Builds FivePillarsAssessment from five_pillars payload
                                  #   and writes to session.five_pillars (added v0.57).
    draft-followup-message.py     # Haiku: draft WhatsApp follow-up after session.
                                  #   Input: {client_id, session_id, session_type, dry_run}.
                                  #   Loads client.yaml + session YAML from ~/fm-plans.
                                  #   _build_context(): name/conditions/goals + session type/
                                  #     date + presenting complaints (tags stripped) +
                                  #     five_pillars + coach notes.
                                  #   _draft_message(): claude-haiku-4-5, 300 tokens, system
                                  #     prompt = Shivani voice, warm, 3-5 sentences, no emoji.
                                  #   dry_run=True returns mock message without API call.
                                  #   Output: {ok, message, error}.
    render-topic-brief.py         # Sonnet: generate evidence brief for a topic
    generate-info-pack.py         # PubMed search + Sonnet synthesis → Resource YAML
    generate-draft.py             # generate draft plan YAML from assess suggestions.
                                  #   Slugs: <first_name>-plan-N-YYYY-MM-DD-<client_id>
    render-client-letter.py       # 12-week client letter generator (the big one):
                                  #   - VITAONE_CATALOG: 158-keyword dict → (name, url)
                                  #     pairs with ?ref=vita13720sh referral appended
                                  #   - _v(slug, name) builds VitaOne URL tuples
                                  #   - _vitaone_link() / _vitaone_url_only(): lookup
                                  #     by supplement name (lowercase, longest match)
                                  #   - _timing_slot(): maps free-text timing → one of
                                  #     7 canonical slots (Early Morning / Breakfast /
                                  #     Mid-Morning / Lunch / Afternoon / With Dinner /
                                  #     Bedtime)
                                  #   - _build_supplement_schedule_html(): builds the
                                  #     supplement section as pure Python HTML — visual
                                  #     bubble-card timeline + print-ready table.
                                  #     AI is told NOT to write this section.
                                  #     Print button isolates #supplement-schedule,
                                  #     calls window.print(), restores. No URL footer.
                                  #   - _calc_calorie_targets(client, wl): TDEE via
                                  #     Mifflin-St Jeor + activity multiplier; phases
                                  #     scaled to goal_weeks; back-calculates from
                                  #     goal_kg + goal_weeks if given.
                                  #   - _build_prompt(letter_type, coach_notes):
                                  #     Dispatcher → routes to 3 helpers:
                                  #     _build_prompt_meal_plan() — nutrition only
                                  #     _build_prompt_supplement_plan() — short intro
                                  #       + Python schedule injected, no AI supps section
                                  #     _build_prompt_lifestyle_guide() — lifestyle/
                                  #       education/labs/tracking, no meal tables
                                  #     Consolidated falls through to original logic.
                                  #     All 4 variants include coach_notes_block.
                                  #   - type_meta dict maps letter_type to HTML
                                  #     title/subtitle for branding.
                                  #   - Consolidated: 12-week healing journey letter.
                                  #     Weeks 1–2 get full 2×7-day meal plan tables
                                  #     with BINDING calorie targets. Weeks 3–4 = teaser
                                  #     only. Weeks 5–12 = roadmap blurbs. Seasonal
                                  #     produce, location-aware, Jain/veg/non-veg aware.
                                  #     Supplement section placeholder at 3c — AI skips
                                  #     it; Python injects it post-generation.
    refine-letter.py              # Multi-turn letter refinement via Sonnet.
                                  #   Accepts markdown + chat history + user message.
                                  #   Returns updated markdown + assistant reply.
    brand_html.py                 # Shared brand HTML wrapper for all letter output:
                                  #   - wrap_in_brand_html(md, title, subtitle) →
                                  #     full standalone HTML with Shivani Hari brand CSS
                                  #   - _wrap_week_sections(html): detects "## Week N"
                                  #     headings, wraps each in
                                  #     <div id="print-week-N" class="week-section">
                                  #   - _wrap_no_print_sections(html): wraps
                                  #     Referral/Appendix/Recipe headings in
                                  #     <div class="no-print">
                                  #   - Per-week print bar injected above each week:
                                  #     "🖨 Print Week N" button sets
                                  #     body[data-print-week="N"] attr, calls
                                  #     window.print(), clears. CSS hides all other
                                  #     weeks via body[data-print-week] selectors.
                                  #   - ✦ Recipe linking: ✦ headings in Recipes
                                  #     appendix indexed; ✦ in meal table cells
                                  #     become clickable anchor links.
                                  #   - Full print CSS: A4, 14mm margins, tables
                                  #     fit on page, buy links hidden on print,
                                  #     week-print-bar hidden on print.
                                  #   - CSS sections: supplement-schedule,
                                  #     timeline-slot/track, schedule-table,
                                  #     buy-badge-vitaone/amazon/iherb,
                                  #     week-section, week-print-bar, week-print-btn,
                                  #     print-page-footer, no-print, recipe links.
    ingest-action.py              # Shim: ingest | review | approve | reject |
                                  #   count_pending | approve_all actions.
                                  #   approve_all: detects "staged file missing"
                                  #   in stderr → marks _meta.json approved,
                                  #   counts as skipped not failed.
  src/app/catalogue-commit-action.ts  # getCatalogueStatus() + commitCatalogueData()
                                  #   Author: Shivani <shivanihari@gmail.com> via env vars.
  src/app/backlog/supplement-links-actions.ts  # CRUD for ~/fm-plans/supplement_links.yaml
  src/app/backlog/supplement-links-client.tsx  # Table + AddLinkForm for affiliate URLs
  src/app/sources/                # REMOVED 2026-10-23 (v1 redirect shim; Add Source
                                  #   lives on the /ingest tab)
  src/app/clients/[id]/
    send-package-button.tsx       # "use client" — SendPackageButton component:
                                  #   "📤 Send package" collapsible trigger. 4 letter
                                  #   types as checkboxes (meal_plan ✓, supplement_plan
                                  #   ✓, lifestyle_guide ☐, consolidated ☐). Loads all
                                  #   4 saved types on mount in parallel. Sequential
                                  #   generation with per-type progress tracking.
                                  #   Coach notes textarea. Per-type HTML/MD downloads.
                                  #   Per-type ✏️ Edit toggle → monospace textarea →
                                  #   "💾 Apply edits to download" updates mdBlob.
                                  #   Primary action in Send tab.
    client-letter-button.tsx      # "use client" — ClientLetterButton: advanced
                                  #   per-type flow (weight loss questionnaire,
                                  #   refinement chat). NOT imported in client-tabs.tsx
                                  #   anymore — kept for potential future use only.
    preferences-editor.tsx        # "use client" — dietary_preference + location +
                                  #   food non-negotiables. Saved to client.yaml.
                                  #   Used by render-client-letter.py for meal plan.
    client-tabs.tsx               # main client detail tabbed layout.
                                  #   Tabs: Overview | 🗓 Sessions | 📋 Plan (3 tabs)
                                  #   type Tab = "overview"|"sessions"|"plan"
                                  #   Workflow stage banner always visible at top:
                                  #     no_plan → draft → active → recheck
                                  #   activePlan / activePlanStatus / workflowStage
                                  #     computed at component top (not inside IIFEs).
                                  #   handleActivate(slug): submitPlan + publishPlan
                                  #     inline — no /plans/[slug] navigation needed.
                                  #   Sessions tab: session recording + history + trends.
                                  #   Plan tab: plan card + Activate + edit link +
                                  #     SendPackageButton (when active) + external reports.
                                  #   SESSION_TYPE_META: full_assessment label = "Full session"
                                  #   Accepts defaultTab ("overview"|"sessions"|"plan").
                                  #   Backward compat: timeline→sessions, protocol→plan,
                                  #   send→plan, documents→plan.
    five-pillars-capture.tsx      # "use client" — compact 5-col widget (😴🧘🏃🥗🤝).
                                  #   RatingChips (1–5, color-tiered, invert=true for stress)
                                  #   + DayChips (0–7). FivePillarsData type exported.
                                  #   Shows info message when non-empty. Clear button.
    session-brief-modal.tsx       # "use client" — fixed overlay modal (max-w-2xl). (v0.61)
                                  #   Sections: header, presenting complaints (tags stripped),
                                  #   AI drivers (numbered + confidence %), supplements,
                                  #   labs ordered, five pillars score boxes. @media print
                                  #   isolates #session-brief-content. 🖨 Print button.
                                  #   Opened via "📄 Brief" button in expanded session cards.
    lab-reference-ranges.tsx      # "use client" — LabReferenceRangesEditor collapsible (v0.62)
                                  #   card. 14 FM optimal defaults. Table with Marker/Low/
                                  #   High/Unit/Remove. "📋 Load FM defaults" button.
                                  #   Saves via saveLabReferenceRangesAction → client.yaml.
    message-templates-panel.tsx   # "use client" — "💬 Send message" collapsible. (v0.62)
                                  #   2-col grid by category. {{variable}} auto-detection.
                                  #   {{name}} auto-fills. 📋 Copy + 📤 Send buttons.
                                  #   Backed by ~/fm-plans/message_templates.yaml (5 defaults).
  src/app/plans/[slug]/
    lifecycle-actions.ts          # Server Actions: generateClientLetter(),
                                  #   refineLetter(), saveMealPlan(), loadMealPlan(),
                                  #   submitPlan, publishPlan, revokePlan, etc.
                                  #   WeightLossParams + LetterType interfaces here.
                                  #   LetterType = "consolidated"|"meal_plan"|
                                  #   "supplement_plan"|"lifestyle_guide".
                                  #   letterFileStem(): consolidated→planSlug,
                                  #   others→{planSlug}-{type}.
                                  #   All 3 functions accept optional letterType param
                                  #   (default "consolidated" for backward compat).
                                  #   Saves to ~/fm-plans/clients/<id>/meal-plans/.
    lifecycle-panel.tsx           # lifecycle transitions UI. Now rendered inside
                                  #   the 🚀 Lifecycle tab of PlanEditor (not
                                  #   standalone on page.tsx). v0.61: colored diff viewer
                                  #   (Plan A/B slug dropdowns, green+/red-/purple@@).
                                  #   v0.62: "💾 Save as template" section (published only).
    plan-editor.tsx               # 10-tab editor → 3 tabs: 📋 Protocol (9 collapsible
                                  #   <details> sections + PlanChatPanel), 📄 Documents
                                  #   (link to client page), 🚀 Lifecycle (LifecyclePanel).
                                  #   Accepts lifecycleProps from page.tsx.
                                  #   v0.61: supplement interaction warning banner.
    actions.ts                    # NEW v0.61: checkSupplementInteractionsAction(planSlug)
                                  #   loads plan + client YAML, reads each supplement's
                                  #   catalogue YAML, case-insensitive medication match vs
                                  #   contraindications. Returns {ok, interactions[]}.
    send-to-client-modal.tsx      # Compose → Preview → Send email flow
  src/app/search/
    page.tsx                      # RSC — full-text search across all entity types
    search-input.tsx              # debounced input + ⌘K shortcut
  src/app/ingest/
    page.tsx                      # RSC — /ingest with cost notice
    ingest-client.tsx             # drag-drop upload (PDF/MD/images) + URL tab +
                                  #   BatchPanel + ApproveAllPanel
    actions.ts                    # runIngestAction, approveAllPendingAction,
                                  #   countPendingBatchesAction, etc.
  src/app/api/aisensy-webhook/
    route.ts                      # POST webhook: waId→client→quick_note session.
                                  #   Unmatched phones → _aisensy_unmatched.yaml.
    actions.ts                    # NEW v0.62: sendWhatsAppAction (E.164 normalisation,
                                  #   AiSensy direct API POST). broadcastAction (per
                                  #   clientId list, returns {sent, failed, errors[]}).
                                  #   checkAisensyConfigAction. loadMessageTemplatesAction,
                                  #   saveMessageTemplateAction, deleteMessageTemplateAction
                                  #   (backed by ~/fm-plans/message_templates.yaml).
  src/app/broadcast-panel.tsx     # NEW v0.62: "use client". "📢 Broadcast" collapsible
                                  #   panel on dashboard (gated by aisensyApiKeySet).
                                  #   Modes: follow-up due / recheck due / all active /
                                  #   custom. Campaign name + 3 param inputs. Live preview.
  src/app/api/email/actions.ts    # renderPlanHtmlAction, sendClientEmailAction,
                                  #   updateClientFieldsAction
  src/app/resources/generate/
    page.tsx                      # /resources/generate route
    info-pack-form.tsx            # PubMed topic search form → generate-info-pack.py
    actions.ts                    # generateInfoPackAction server action
  ecosystem.config.js             # PM2: `next start --port 3002` as fm-coach daemon
  .env.local.example              # GMAIL_USER + GMAIL_APP_PASSWORD template
  package.json                    # next, react, tailwind, sonner, mermaid, js-yaml,
                                  #   @radix-ui/* (shadcn), nodemailer@8, pm2
  AGENTS.md / CLAUDE.md           # "this is NOT the Next.js you know" reminder
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
- VitaOne Education course PDFs — 31 PDFs at `~/fm-plans/Vitaone Resources from course/`. ALL ingested and approved as of v0.42 (all 58 staging batches cleared). Includes cheatsheets for all vitamins, minerals, mood, hair, joint, thyroid, nutrition deficiency, medication interactions.
- VitaOne mind-maps tool (`tools.vitaone.in/mind-maps`) — 3 hand-curated maps scraped (874 nodes total) and stored as `MindMap` entities.
- CocoNote FM lectures, Barbara O'Neill videos, ask-expert sessions, vitaone instagram posts, cold water immersion paper — all ingested and approved.

**Meal plan storage**: `~/fm-plans/clients/<id>/meal-plans/{stem}.md/.html` where stem is `{planSlug}` for consolidated or `{planSlug}-{type}` for specific types. Generated by `render-client-letter.py`, saved by `saveMealPlan(planSlug, clientId, markdown, html, letterType)` server action. Loaded on mount — all 4 types loaded in parallel by `ClientLetterButton`.
