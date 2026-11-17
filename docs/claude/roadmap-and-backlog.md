# Roadmap, done list, features backlog, outstanding

> Moved verbatim out of the root `CLAUDE.md` on 2026-11-17 (original lines 2349–2466). Index: [`/CLAUDE.md`](../../CLAUDE.md).
> Covers: Historical roadmap as of v0.74–v0.76; check git log before trusting any 'pending' item.
> Version notes describe the code when written; newer entries in `invariants-v0.81-v0.91.md` and git history override older ones.

## Roadmap (what's next)

**Done (v0.2 → v0.46):**
- ✅ **🗂 Client page single-workspace redesign (v0.47)** — tabs: Overview | 📋 Protocol | 📤 Send | 🗓 Timeline. Workflow stage banner. Inline Activate button. No more back-and-forth to /plans/[slug] just to activate. Send tab = letter generation only (published plans).
- ✅ **Plan editor UX fixes (v0.47)** — `effectiveLocked` sub-component bug fixed. `SupplementCombobox` typeahead. Lifecycle single Activate button. AI chat at top of Protocol tab. Edit-before-send textarea in SendPackageButton.
- ✅ **📤 SendPackageButton** — batch letter generator. 4 types, sequential generation, coach notes, per-type HTML/MD downloads, ✏️ Edit before download.
- ✅ **📋 Plan editor 3 tabs** — Protocol (9 collapsible sections) / Documents / Lifecycle. LifecyclePanel moved into Lifecycle tab inside PlanEditor.
- ✅ **🗓 Vertical timeline cards in Timeline tab** — colored dot + card UI. Expandable detail.
- ✅ **🔗 Dashboard deep-links + `?tab=` support** — client detail page reads `?tab=overview|sessions|plan`. Full backward compat: old names (`timeline`→`sessions`, `protocol`/`send`/`documents`→`plan`). Dashboard CTAs use `?tab=sessions`.
- ✅ All 9 catalogue entity types built and seeded (82 sources, 318 topics, 408 mechanisms, 378 symptoms, 1,492 claims, 279 supplements, 3+3+11 ca/hr/mindmaps)
- ✅ AI ingestion pipeline (PDF + markdown + image attachments; streaming) — all VitaOne PDFs + coconote + Barbara O'Neill + ask-expert + instagram posts ingested
- ✅ All 58 staging batches approved (v0.42). Catalogue: 0 errors, ~1,272 non-blocking warnings.
- ✅ Plan + Client layer with sessions, history-aware Analyze, deterministic check, AI sanity check, publish lifecycle, markdown+HTML render
- ✅ Atomic approval, smart-merge, alias-aware resolution, error/warning split. approve_all now detects "staged file missing" and marks as skipped.
- ✅ Backlog triage CLI (clean/show/promote/reject/attach) — 167 noise auto-rejected
- ✅ Curated MindMap node linking + mining (60 nodes linked, 645 candidates queued)
- ✅ Streamlit UI (Path A) with all 7 sidebar pages — fallback
- ✅ Path B (Next.js + shadcn) — 23 routes, full feature parity + client letter + catalogue cleanup tool
- ✅ Assess page: hierarchical CategoryPicker, topics confidence %, session deduplication, FM ratio calculations, client quick snapshot, formatted synthesis notes
- ✅ Transcript upload in Assess: extracts symptoms + lab values + measurements + medications + conditions via Haiku
- ✅ Manual health data entry in Assess: free-text → Haiku parse, OR blank editable form. Merge from both sources.
- ✅ Health snapshots stored per appointment on Client YAML (`health_snapshots: list[dict]`)
- ✅ Health trends section on Client detail page: SVG sparklines per metric + timeline tab
- ✅ Typed inner `suggestions` payload: 11 Pydantic sub-models, TypeScript interfaces, typed `SuggestionsView`
- ✅ Improved backlog mining heuristic: 60-entry `_GUESS_RULES`, `suggestTarget` 3-tier matching, 4-level `computeSuggestion` cascade
- ✅ 17 curated mindmaps (3 VitaOne-scraped + 14 new): adrenal-stress, autoimmune, blood-sugar-insulin-resistance, bone-health, cardiovascular-lipid, chronic-inflammation, emotional-wellbeing, gut-health, liver-detoxification, mitochondrial-energy, pcos, sex-hormones-perimenopause, sleep-circadian, thyroid-dysfunction. MindMapContextPanel in Assess. Validator + model now allow `lab_test` and `lab_panel` as `linked_kind` (v0.63+).
- ✅ **💌 12-week client letter generator** — `ClientLetterButton` on client detail page. Weight loss questionnaire (goal kg/weeks, activity, pace, exercise detail). `_calc_calorie_targets()` computes TDEE + phase targets. `render-client-letter.py` generates warm 12-week healing journey letter with two 7-day meal plan tables for weeks 1-2. Supplement section injected by Python post-generation. Saves to disk. Refinement chat (multi-turn). Download branded HTML / Markdown.
- ✅ **🗓 Per-week print buttons** — `brand_html.py` wraps AI-generated markdown in `<div id="print-week-N" class="week-section">` divs. Per-week print bar shows "🖨 Print Week N". JS sets `body[data-print-week="N"]`, CSS isolates that week, `window.print()`. No server round-trip. Works in browser.
- ✅ **💊 Python-generated supplement schedule** — visual bubble timeline + table. 7 timing slots. `_build_supplement_schedule_html()`. "🖨 Print Schedule" button isolates `#supplement-schedule`. Buy links hidden on print.
- ✅ **🔗 VitaOne affiliate links** — 158-keyword catalog, `?ref=vita13720sh` on all URLs. Priority chain: custom → VitaOne → Amazon → iHerb → none.
- ✅ **🥗 Client dietary preferences** — `PreferencesEditor` card (dietary_preference, location, non-negotiables). Used by meal plan generator.
- ✅ **🔗 Supplement Links tab** in `/backlog` — CRUD for `~/fm-plans/supplement_links.yaml`
- ✅ **📚 Dashboard git commit button** — amber banner, counts by entity type, optional commit message
- ✅ **⚡ Approve all pending** on /ingest — now correctly skips already-approved batches, marks `_meta.json` status
- ✅ Ingest: images + URL tab + HTML→markdown via html2text
- ✅ 📧 Email: Send to client, Gmail SMTP, nodemailer
- ✅ 🔍 Global search (⌘K), follow-up reminders, check-in workflow, client contact widget
- ✅ PubMed evidence brief generator (`/resources/generate`)
- ✅ **✂️ Split document types** — 4 separate letter types (consolidated/meal_plan/supplement_plan/lifestyle_guide). Each saves independently. UI shows 4 selector cards + tab bar per saved type.
- ✅ **📝 Coach knowledge field** — `coachNotes` textarea weaves custom tips into all 4 document types.
- ✅ **🔧 shim.ts** — `runShim` extracted from `anthropic.ts` to shared `src/lib/fmdb/shim.ts`.
- ✅ **💬 Coach Knowledge ingest tab** — type a clinical observation, AI checks catalogue (keyword search + Haiku), then stages via normal fmdb ingest pipeline. `coach-knowledge-check.py` + `coach-knowledge.py`.
- ✅ **🔗 Enrich links before approving** — `EnrichPanel` in BatchPanel, per-entity `EnrichEntityRow` adds `linked_to_*` cross-links and `notes_for_coach` to staged YAMLs before approve.
- ✅ **✅ BatchPanel status check** — already-approved/rejected batches show read-only banner; no more phantom "approve" buttons on completed batches.
- ✅ **📚 Add Source tab on /ingest** — consolidated from separate `/sources` sidebar page. 4th tab in Ingest. Sidebar "📚 Add Source" link removed.

- ✅ **v0.53–v0.56** — IFM Matrix card + FM lab patterns, outcome progress dashboard, visual template picker, lab upload panel, message capture panel, protocol check-in, pre-session brief, AiSensy webhook
- ✅ **v0.57** — Five Pillars capture at check-in (`five-pillars-capture.tsx`, `FivePillarsAssessment` written to session YAML, feeds `OutcomeProgressCard`) + post-session WhatsApp draft (`follow-up-draft-panel.tsx`, Haiku, Shivani voice, editable textarea + 📋 Copy button, shown after any non-full-assessment session save)
- ✅ **v0.58** — Protocol adherence trend chart (`protocol-adherence-chart.tsx`, colour-coded grid per check-in date) + AiSensy dashboard inbox badge (green banner, `getRecentAisensyMessages`, 7-day window) + Five Pillars in full-session form (embedded AssessClient) + Lab trends accessible from Sessions tab
- ✅ **v0.59** — Discovery consultation session type (`discovery-form.tsx`, curated FM lab panels, food journal request, shareable output) + Intake session rename + plan-period meal plan (render-client-letter.py reads `plan_period_weeks`) + ✉ Email link on dashboard client cards + AiSensy unmatched message log (`_aisensy_unmatched.yaml`)
- ✅ **v0.60** — Lab comparison view (side-by-side health snapshots) + IFM Matrix trends over time + client photo upload in Overview
- ✅ **v0.61** — Supplement interaction checker (plan editor amber banner vs client meds) + recheck reminder derivation from plan_period_weeks + protocol diff viewer (colored +/-/@@ in Lifecycle tab) + session brief modal (📄 Brief button in Sessions tab, print-ready)
- ✅ **v0.62** — Lab reference ranges (14 FM optimal defaults, 🟢/🔴 in health trends) + custom protocol template saving (lifecycle panel → ~/fm-plans/custom_templates/) + AiSensy broadcast panel (dashboard, direct API) + message templates library (client Overview, ~/fm-plans/message_templates.yaml) + quick note from pre-session brief modal
- ✅ **v0.63** — FM physician-tier upgrade: 11 Protocol entities (5R gut/AIP/Whole30/low-FODMAP/weight-loss/adrenal/liver/cycle-sync/anti-inflammatory/mitochondrial/blood-sugar) + 11-factor weighted protocol scoring + ATM Triad driver cascade + 13 drug-nutrient depletion entities + DUTCH/GI-MAP PDF parser + 7 India-aware titration protocols (integer whole-unit steps) + 25 LabTest entities with FM+conventional ranges + 7 LabPanel bundles + pregnancy/lactation safety overlay + inline FM-vs-conventional range dots on every lab value in health-trends + Haiku letter QA pass (validation_report sidecar) + doctor-shareable session brief (conditions + meds + hand-off note) + PM2 env fix (ecosystem.config.js loads .env.local) + .env.local.example
- ✅ **v0.64** — Catalogue cleanup tool (`/catalogue/cleanup`): Haiku scans all 318 Conditions in one call, returns groups (duplicates, miscategorisations); merge into canonical with deleted slugs preserved as aliases; opt-in stub creation when target Healing program / Root cause / Symptom doesn't yet exist; in-UI kind switcher. Coach-friendly entity labels (UI-only): Topics → Conditions, Mechanisms → Root causes, Protocols → Healing programs, Titrations → Dose schedules, Lab tests → Lab markers, Claims → Evidence notes, Sources → References — all routed through `src/lib/fmdb/kinds.ts`. Catalogue table: name-first layout. `.md`/`.txt` accepted on all five report-upload panels (lab, functional test, genetic, transcript update, intake) — `parse-functional-test.py` + `parse-genetic-report.py` patched to send text content blocks instead of PDF attachments when given markdown.

**Features Backlog** (organised by area — keep this updated every session)

### 🔴 Setup (one-time, coach does these)
1. ✅ **Email configured** (2026-05-10) — `GMAIL_USER` + `GMAIL_APP_PASSWORD` in `.env.local`. App Password from https://myaccount.google.com/apppasswords.
2. ✅ **WhatsApp self-hosted server** (deployed v0.74, 2026-05-15) — AiSensy fully decommissioned. All outbound WA via `WHATSAPP_SERVER_URL` + `WHATSAPP_SERVER_API_KEY` in `.env.local`. Inbound via `/api/whatsapp-webhook` (HMAC-verified). 21+ templates APPROVED on Meta. Template registration via `whatsapp-server/scripts/submit-templates.js`.
3. ✅ **Backlog cleared** (2026-05-10) — `data/_backlog.yaml` is empty/missing on the laptop; nothing left to triage. New items will accumulate as the AI mines new sessions / mindmaps.

### 🟡 Client management (next few sessions)
4. ✅ **Five Pillars capture at each session** — done in v0.57 (check-in) + v0.58 (full session). Compact 5-column widget, saved to session YAML, feeds OutcomeProgressCard.
5. ✅ **Protocol adherence trends** — done in v0.58. `protocol-adherence-chart.tsx` colour-coded grid per supplement/practice across check-in dates, shown in Sessions tab.
6. ✅ **Client photo** — done in v0.60. Upload/update profile photo in Overview. Shown as avatar in client list + header.
7. ~~Session notes PDF export~~ — **not building this.**
8. ✅ **IFM Matrix over time** — done in v0.60. Node scores tracked across full sessions with trend indicators.
9. ✅ **Inline quick notes from session brief** — done in v0.62. `QuickNoteWidget` at bottom of pre-session brief modal. Source chips + textarea + save. Auto-fades "✓ Saved". Modal stays open.

### 🟡 Communication / WhatsApp
10. ✅ **Auto-follow-up drafts** — done in v0.57. After any check-in/pre-intake/quick note, Haiku drafts a warm 3–5 sentence WhatsApp message in Shivani's voice. Coach edits and copies.
11. ✅ **AiSensy inbox badge** — done in v0.58. Green dashboard banner counts inbound WhatsApp messages (last 7 days), with client chips linking to Sessions tab.
12. ✅ **WhatsApp broadcast** — done in v0.62, updated v0.74. `BroadcastPanel` on dashboard (gated by `WHATSAPP_SERVER_URL`). Modes: follow-up due / recheck due / all active / custom. Uses self-hosted WA Cloud API server; AiSensy fully decommissioned.
13. ✅ **Message templates** — done in v0.62. `MessageTemplatesPanel` in client Overview. 5 default templates. {{variable}} auto-detection. 📋 Copy + 📤 Send via self-hosted WA server. Backed by `~/fm-plans/message_templates.yaml`.

### 🟡 Lab & health data
14. ✅ **Lab reference ranges** — done in v0.62. `LabReferenceRangesEditor` in client Overview. 14 FM optimal defaults. 🟢/🔴 dot in health trends next to each metric.
15. ✅ **Lab trend chart** — done in v0.58 (HealthTrends in Sessions tab alongside protocol adherence).
16. ✅ **Lab comparison view** — done in v0.60. Side-by-side two health snapshots in Sessions tab.

### 🟢 Plan & protocol
17. ✅ **Custom protocol template saving** — done in v0.62. "💾 Save as template" in Lifecycle tab (published plans). Saves to `~/fm-plans/custom_templates/`. Assess page shows "⭐ Your templates" above built-in grid.
18. ✅ **Supplement interaction checker** — done in v0.61. `checkSupplementInteractionsAction` on plan editor mount. Amber banner with `⚠ N interactions` in Supplements section.
19. ✅ **Recheck reminder** — done in v0.61. Dashboard derives recheck date from `created_at + plan_period_weeks × 7` when no explicit recheck date set.
20. ✅ **Protocol diff view** — done in v0.61. Colored diff (green +, red -, purple @@) in Lifecycle tab. Auto-selects `supersedes` as Plan A.

### 🟢 Content & catalogue
21. ✅ **More curated mindmaps** — done 2026-05-10. PCOS, Sleep/Circadian, Cardiovascular-Lipid, Autoimmune, Bone Health, Mitochondrial-Energy added.
21a. ✅ **Expand lab_tests catalogue** — done. **152 entries** as of 2026-05-22. All listed labs are present (ApoB, Lp(a), DUTCH metabolites, salivary cortisol curve, OAT markers, AMH, SHBG, food sensitivity IgG, GI-MAP, fibrinogen, Lp-PLA2, heavy metals, mycotoxin, EBV panel, CoQ10, carnitine, etc.). Each has `conventional_low/high` + `fm_optimal_low/high` + India `typical_cost_inr`. Ingest pipeline now extracts LabTest entities from documents automatically (v0.74 schema upgrade).
21b. ✅ **Add missing FM mechanisms** — done (2026-05-22 verified). All 7 requested slugs exist: `hla-genetics-immune-tolerance`, `ebv-reactivation`, `late-light-melatonin-suppression`, `cortisol-awakening-response`, `post-viral-fatigue`, `pacing-energy-envelope`. `sympathetic-overdrive` canonicalised as `sympathetic-dominance` + `sympathetic-overactivity` (two separate entries covering the same concept).
22. ✅ **Backlog triage** — fully clear as of 2026-05-22. 1,442 items: 142 added, 1,300 rejected, 0 open. New items accumulate from ingest runs — check `/backlog` periodically.
23. **Promote freeform → catalogue entities** — Practice, TrackingHabit, Food, LabTest, Recipe, EducationalModule. Watch for duplication in real plans first.

### 🟢 Infrastructure / polish
24. ✅ **Persistent public URL** — not needed for WhatsApp (inbound webhook is on the Fly app, not the Mac). Fly app receives inbound WA messages → Mutagen syncs data to Mac. Cloudflared/ngrok only needed if running the Next.js server publicly (not required for current setup).
25. **Path B UI polish (deferred):** click-to-recenter on linked MindMap nodes; colored split-diff for plan diff; backlog pagination; health trends chart axis labels.
26. **JSON export contract for Project 2 (mobile app)** — deferred indefinitely; desktop-first build.
27. **Commit pending catalogue changes** — `git add data/ && git commit` from `fm-database/` if YAML edits made without committing.

### 🔵 Planned later (not relevant now)
- **Supplement refill reminder** — not relevant currently (clients source supplements independently). Estimate run-out date from dose × quantity purchased × start date. Revisit if coach manages supplement purchases directly.
- **Order-through-coach for VitaOne supplements** — *awaiting reply from VitaOne partner support (email sent 2026-05-09)*. Goal: client requests an order via the coach's app → coach places the order on vitaone using affiliate code vita13720sh → vitaone ships direct to client. Eliminates affiliate-link drop-off and keeps the brand consistent. Phased plan:
  - **Phase 1 (lightest, ~0.5 day)**: WhatsApp handoff button on the client letter — pre-fills a message to coach with the protocol + client address.
  - **Phase 2 (~2-3 days)**: in-app order form + coach dashboard tab + per-client `~/fm-plans/clients/<id>/orders/<order-id>.yaml` records with status (pending → placed → shipped → delivered).
  - **Phase 3 (~1-2 weeks)**: Razorpay/Stripe payment integration, GST invoicing.
  - **Phase 4 (much later, requires partnership)**: vitaone XML-RPC / GraphQL automation to place orders directly from the coach dashboard.
  - **Decisions still to make** (waiting on VitaOne reply): does VitaOne offer a practitioner dispensary à la Fullscript / Wellevate? Can affiliates place orders with client shipping addresses and still get attributed? Are there affiliate-only products vs the public catalogue? Do they expose any partner API? Any volume/loyalty programmes?
  - **Risk/compliance**: liability for prescription-style dispensing in Indian states, stock-outs, refunds, data-minimisation for client home addresses.

**Outstanding (in rough priority order):**
1. **Coach uses it daily.** Real bugs from real use are more valuable than speculative code.
2. ✅ **v0.74 deployed to laptop** (2026-05-15). PM2 running. `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `WHATSAPP_SERVER_URL`, `WHATSAPP_SERVER_API_KEY` all set in `.env.local`. Re-run via `bash fm-database-web/scripts/setup-laptop.sh` (idempotent). AiSensy fully decommissioned — all WA via self-hosted Cloud API server.
3. ✅ **WhatsApp live** — 21+ Meta-approved templates. All outbound via `WHATSAPP_SERVER_URL`. Inbound via `/api/whatsapp-webhook` (HMAC-verified) on Fly app. Template registration via `whatsapp-server/scripts/submit-templates.js` — never the Meta dashboard directly.
4. ✅ **Sudarshan (cl-008) and Hariharan (cl-005) plans active** — both plans published and running.
5. **API cap returns 2026-06-01** — letters/assess/Zoom transcript extraction blocked until then. Use in-chat letter editing as fallback.
