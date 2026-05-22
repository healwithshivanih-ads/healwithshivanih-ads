# CLAUDE.md — Project Context

This file is loaded automatically at the start of every Claude Code session.
Update it as the project evolves so future sessions resume with full context.

## Project: FM Database (Project 1)

Internal functional medicine catalogue used by coaches to author structured
client plans. A future client-facing mobile app (Project 2) will consume
published plans as JSON artifacts.

**Active branch:** `claude/setup-fm-coach-laptop-7GFhK`
**Licensing:** Proprietary (all rights reserved, internal-only)

## Status

**v0.74 (current)** — Medications as a first-class three-axis entity + drug-driven plan/letter/intake guardrails.

The `DrugDepletion` catalogue entity (which already existed but only captured nutrient depletions) is extended into a **three-axis medication entity**:

1. **`condition_implications[]`** — what diagnosis the drug implies about the client. Fields: `label`, `confidence` (`high` → near-pathognomonic, `moderate` → "Suspected: …", `low` → ignored downstream), `rationale`, optional `topic_slug`.
2. **`protocol_cautions[]`** — what the FM protocol must respect. Fields: `kind` (`avoid_food | avoid_supplement | avoid_practice | prefer_food | prefer_supplement | timing | refer | monitor`), `item` (free-text), `severity` (`critical | warning | info`), `reason`.
3. **`depletes[]`** — existing nutrient-depletion list (unchanged).

**Schema lives in:** `fmdb/enums.py` (new enums `CautionKind`, `CautionSeverity`, `ImplicationConfidence`, plus new `DrugClass` values: `mast_cell_stabiliser`, `leukotriene_receptor_antagonist`, `anti_ige_biologic`, `h1_antihistamine`, `tyrosine_kinase_inhibitor`, `glp1_agonist`, `sglt2_inhibitor`, `dpp4_inhibitor`) + `fmdb/models.py` (sub-models `ConditionImplication`, `ProtocolCaution`; `DrugDepletion.condition_implications` and `.protocol_cautions` fields, both default-empty so existing entries don't break).

**Catalogue: 19 drug entries** (13 pre-existing backfilled + 6 new for MCAS / oncology cluster). New entries: `cromolyn-sodium`, `famotidine`, `montelukast`, `ketotifen`, `omalizumab`, `tyrosine-kinase-inhibitors` (class entry with 30+ aliases). Backfilled: metformin, PPI, levothyroxine, statins, OCPs, beta-blockers, ACE/ARBs, thiazides, SSRI/SNRI, broad-spectrum antibiotics, chronic aspirin, corticosteroids, methotrexate. `metformin.yaml` now also has aliases for the DPP4/SGLT2/sitagliptin combo brands (Janumet, Galvus Met, Jentadueto, Synjardy, Xigduo, Invokamet, Januvia, Galvus, Trajenta).

**The three integrations wired this turn:**

1. **Intake handler (`scripts/intake-token-action.py`)** — `_derive_conditions_from_intake` now consults the drug catalogue via `_build_drug_index()` (alias-aware, longest-match) before falling back to the original hardcoded keyword heuristics. Each matched drug's `condition_implications` flows into `active_conditions` with confidence-gated phrasing (`high` → bare label, `moderate` → "Suspected: …", `low` → ignored).

2. **Plan-check / plan editor (`src/lib/server-actions/plans.ts` + `src/components/plan-editor/plan-editor.tsx`)** — `checkSupplementInteractionsAction` now returns a `drug_cautions: DrugCaution[]` field in addition to the existing `interactions`. Plan editor renders these as a sibling collapsible banner above the supplement-interaction banner (rose for critical, amber for warning, slate for info), grouped by severity, with drug name + matched client medication + kind chip + item + reason. Critical cautions auto-expand the banner.

3. **AI synthesis (`fmdb/assess/suggester.py`)** — new `_collect_drug_context(client_ctx)` runs alongside subgraph build. The synthesiser's user payload now includes a `drug_context` field with `matched[]` (full drug → condition_implications + protocol_cautions + depletes for each matched med) and `unmatched_meds[]`. The system prompt gains a **3b. DRUG CONTEXT** section telling the AI to (a) anchor `likely_drivers` in the implied conditions, (b) treat `protocol_cautions` as hard constraints (`critical` = must honour, `warning` = honour unless override, `info` = best-practice tip), (c) always include the depletion-replacement supplement at the documented dose unless contraindicated, (d) add monitoring labs to `lab_followups`, (e) refuse to include any `avoid_supplement` item, (f) note `unmatched_meds` in `catalogue_additions_suggested` so the coach knows the gap.

4. **Letter generator (`scripts/render-client-letter.py`)** — new `_load_drug_cautions_for_client(client)` + `_format_drug_cautions_block(cautions)` helpers. The cautions block is woven into `_top_of_mind_block()` so EVERY letter type (meal_plan / supplement_plan / lifestyle_guide / exercise_plan / recipes / consolidated / meal_plan_phase) inherits it. The block is labelled "⚠ MEDICATION-DERIVED PROTOCOL CONSTRAINTS — HARD RULES." with explicit instructions: avoid_food items dropped from meal plans literally, prefer_food items emphasised, avoid_supplement items refused in the schedule, timing rules honoured, CRITICAL items override the protocol.

5. **Ingest pipeline** — `fmdb/ingest/extractor.py` system prompt gains **15. DRUG ENTRIES (DrugDepletion)** + **16. LAB TESTS (LabTest)** sections teaching future ingest runs to extract these as first-class entities when documents describe them. `_TOOL_INPUT_SCHEMA` gets both `drug_depletions` (full nested schema for `condition_implications`, `protocol_cautions`, `depletes`) and `lab_tests` (with conventional + FM-optimal ranges captured separately). `fmdb/ingest/types.py` (`ENTITY_TYPES`) + `fmdb/ingest/staging.py` (`_MODEL_BY_ENTITY`, `_ENRICHERS`, the entity-iteration loop, the empty-payload init) all include both new entities so AI output lands on disk via the normal stage → review → approve flow. New enrichers `_enrich_drug_depletion()` + `_enrich_lab_test()` default every list field to `[]` and add the standard lifecycle fields (source citation, version, status, updated_at, updated_by).

**Pipeline now accepts 7 entity types**: `sources, topics, mechanisms, symptoms, claims, supplements, drug_depletions, lab_tests` (sources auto-registered from the IngestRequest, the other 7 from the AI extractor). Tool schema mirror: `claims, drug_depletions, lab_tests, mechanisms, supplements, symptoms, topics`.

**Authoring prompt for human-coach-with-AI extractions** lives at `fm-database/data/drug_depletions/_AUTHORING_PROMPT.md`. Coach can paste it into Claude / GPT, replace the drug list at the bottom, and get YAML back ready to drop into `fm-database/data/drug_depletions/`. Includes hard rules, full schema with all three axes, allowed enum values, 4 anchor examples to match.

**Key invariants for future sessions:**
- `DrugDepletion` is **not** just about nutrient depletions any more. Name preserved for back-compat; semantically it's "medication catalogue entry".
- Class-level entries are preferred over per-brand entries — list every brand AND every Indian brand in `drug_aliases` (Indian coach context).
- Alias-aware longest-match is the lookup pattern everywhere — see `_collect_drug_context` (Python), `matchDrug` in `plans.ts` (TS), `_match_drug` in `intake-token-action.py` (Python). Duplicating the logic across the three callers is intentional for now (engine vs Server Action vs shim) — consolidate to a shared module if a fourth caller appears.
- `condition_implications.confidence: low` is **ignored downstream** by intent — too non-specific to auto-populate `active_conditions`. Only `high` and `moderate` (the latter prefixed "Suspected: …") flow through.
- `protocol_cautions.severity: critical` is a HARD BLOCK in the meal-plan / supplement-plan letter prompts. The AI is told the critical caution wins even over the attached protocol.

**v0.73** — First production deploy: intake form on Fly.io at `intake.theochretree.com`, coach UI stays on Mac.

Architectural split: the **public-facing intake form** runs on Fly (Mumbai, single 1 GB machine, 3 GB persistent volume). The **coach UI** (`/clients-v2`, `/plans`, `/assess`, `/dashboard-v2`, `/catalogue`, etc.) stays on the Mac mini + laptop exactly as before — no auth changes, no migration. Client PHI stays in `~/fm-plans/` on the Macs; Fly has a writable replica at `/data/fm-plans/` synced bidirectionally via Mutagen.

**The deploy is a hard split, not "two halves of the same app":**
- Fly machine returns **404** on every coach-UI route (`/clients-v2`, `/plans`, etc.), regardless of auth state. The route doesn't exist as far as the public is concerned. Enforced by `FLY_INTAKE_ONLY=1` env in `fly.toml` + `middleware.ts` check.
- Coach UI on `localhost:3002` (Mac mini/laptop, PM2-managed) is unchanged — no middleware activates because the env var is unset locally.
- Public hostname `intake.theochretree.com` resolves only to the Fly machine. There is no `shivani.theochretree.com` (originally planned but dropped — coach uses localhost).

**Files added (all at repo root unless noted):**
- `Dockerfile` — 4-stage build. Stage `web-build` (Node 22 + Next.js build, `npm ci --include=dev` for Tailwind v4 postcss plugin); stage `python-build` (Python 3.12 + venv + Anthropic SDK + pyyaml + python-dotenv + html2text); stage `mutagen-agent-fetch` (downloads linux_amd64 Mutagen agent from GitHub release v0.18.1); stage `runtime` (Node + Python + venv + Next build + Mutagen agent baked at both `WORKDIR/.mutagen/agents/0.18.1/...` AND `/root/.mutagen/agents/0.18.1/...`). Final image ~388 MB.
- `.dockerignore` — excludes `.git`, all `node_modules`, `.venv`, `__pycache__`, secrets (`.env*`, `google_service_account.json`), client PHI (`fm-plans`, `fm-resources`), worktrees, screenshots.
- `fly.toml` — app `theochretree-coach`, region `bom`, mount `fmcoach_data` at `/data`, internal_port 3002, health check on `/api/health`, `auto_stop_machines = "off"` (clients submit async, no cold starts), `FLY_INTAKE_ONLY=1` in `[env]`.
- `fm-database-web/src/middleware.ts` — three operating modes: INTAKE-ONLY (return 404 for any non-public path), COACH UI WITH AUTH (HTTP Basic Auth, unused by current deploy), LOCAL DEV (no-op when neither env var set). Public path allowlist: `/intake/*`, `/start/*`, `/api/whatsapp-webhook`, `/api/whatsapp-poll-webhook`, `/api/health`, `/_next/*`, `/favicon.ico`. Uses Edge-runtime-safe `atob()` for base64 decode. Note: `/api/aisensy-webhook` was removed at v0.74 (AiSensy decommissioned).
- `fm-database-web/src/app/api/health/route.ts` — returns `{ok, service, ts}` for Fly LB.
- `DEPLOY_FLY.md` — 11-step runbook (Fly app create → volume create → secrets set → first deploy → Mutagen setup → custom domain → DNS at Wix → cert verify → smoke test → Nidhi link → cleanup). ~2-3 hr end-to-end.
- `MUTAGEN_SYNC.md` — bidirectional sync runbook + 3 empirical gotchas (iCloud-symlink path resolution, agent placement at WORKDIR not HOME, slim image missing scp/tar) + ongoing-ops section (SSH cert 72h refresh cron, LaunchAgent SSH_AUTH_SOCK survivability, MacBook bridge-vs-direct decision).

**Production reality (deployed 2026-05-14):**
- Fly app `theochretree-coach` in `bom`, machine `81107ef9461078`, IPv4 `66.241.125.67`, IPv6 `2a09:8280:1::115:bbff:0`.
- Volume `fmcoach_data` (3 GB, daily snapshots enabled).
- Custom domain `intake.theochretree.com` (CNAME at Wix DNS → `qj0gpyy.theochretree-coach.fly.dev`), Let's Encrypt cert (RSA + ECDSA), ~60 day renewal cycle.
- Secrets: ANTHROPIC_API_KEY, GMAIL_USER, GMAIL_APP_PASSWORD. COACH_AUTH_* skipped (FLY_INTAKE_ONLY makes them unused). AISENSY_API_KEY + AISENSY_WEBHOOK_SECRET removed at v0.74 (AiSensy decommissioned). WhatsApp now via self-hosted server: WHATSAPP_SERVER_URL + WHATSAPP_SERVER_API_KEY in `.env.local` (not Fly secrets — coach-side only).
- Mutagen 0.18.1 daemon on Mac mini, sync session `fm-plans` between `/Users/shivani/Library/Mobile Documents/com~apple~CloudDocs/fm-plans/` (resolved iCloud path, NOT the `~/fm-plans` symlink) and `root@theochretree-coach.internal:/data/fm-plans/` over WireGuard tunnel. Mode `two-way-safe`. Initial scan: 31 dirs / 139 files / 160 MB. Status: `Watching for changes`.
- All 6 existing clients (cl-004 through cl-008, plus nidhi-jain) visible at `/data/fm-plans/clients/` on Fly volume after Mutagen converged.

**Smoke-test results (post-deploy):**
| Surface | Expected | Got |
|---|---|---|
| `GET /api/health` | `200 {"ok":true,...}` | ✅ 200, 57ms |
| `GET /intake/<Nidhi's token>` (real) | 200 | ✅ 200, 62ms |
| `GET /clients-v2` on public host | 404 | ✅ 404 |
| `GET /plans`, `/catalogue`, `/dashboard-v2`, `/assess` | 404 each | ✅ 404 each |
| `POST /api/whatsapp-webhook` (no HMAC) | 401 | ✅ (route exists, AiSensy route removed) |
| Cert | Issued by Let's Encrypt | ✅ RSA + ECDSA |

**Workflow now operational for real clients**:
- Coach generates intake token on Mac (writes to `client.yaml#intake_token`). Mutagen propagates to Fly volume in <2s.
- Coach WhatsApps client the link `https://intake.theochretree.com/intake/<token>` (via existing one-click WA share button — updated message text: dropped "from Shivani's office", signed "Shivani").
- Client opens link on phone, fills form, autosaves every 5s. Each save writes `client.yaml#intake_form_draft` on Fly. Mutagen propagates back to Mac in ~1s — coach can watch fields populate live on localhost UI.
- Client hits Submit. ~60 structured fields land + tagged `[source: client_intake_form]` quick_note session. Token revoked.
- Coach opens `/clients-v2/<id>` on Mac (localhost) → IntakeInsightsCard offers "✨ Generate insights" → ~$0.003 Haiku call → 4 sections of patterns/red flags/hypotheses/verify-in-session populate.
- Before session with client, coach opens `/clients-v2/<id>/analyse/intake` → sticky VerifyChecklist sidebar shows AI-generated questions to ask in person.

**First real client onboarded**: Nidhi Jain (cl-id `nidhi-jain`, age 53, F, perimenopausal). Intake token `ZrRNZjBHdrICRajl7RtD1LuROFOXh1Pg` issued 2026-05-14, valid until 2026-05-28. URL `https://intake.theochretree.com/intake/ZrRNZjBHdrICRajl7RtD1LuROFOXh1Pg` confirmed HTTP 200 on Fly.

**Key invariants:**
- `FLY_INTAKE_ONLY=1` is set in `fly.toml` `[env]`, NOT a Fly secret. The middleware reads it at request time; if it ever gets unset on Fly, the coach UI becomes accessible to anyone who finds the URL — major data leak. To verify: `flyctl env list -a theochretree-coach` should show `FLY_INTAKE_ONLY = "1"`.
- Mutagen versions on Mac client + Fly agent MUST match exactly. The Dockerfile pins `MUTAGEN_VERSION=0.18.1` as an ARG. When you `brew upgrade mutagen`, bump the ARG + redeploy in the same session.
- The `--include=dev` flag on `npm ci` in Dockerfile stage `web-build` is non-negotiable — Tailwind v4's `@tailwindcss/postcss` plugin lives in `devDependencies` and is needed at build time even with `NODE_ENV=production`. Removing the flag breaks the next deploy with a Tailwind compile error.
- Fly SSH certs are 72h. Without the cert-refresh cron (see MUTAGEN_SYNC.md §1 in "Ongoing ops"), Mutagen sync silently stops after 3 days. Set this up before relying on the system unattended for more than ~48h.
- Coach data on the Mac is authoritative. Fly volume is a writable replica that surfaces public form submissions. If Mutagen ever shows `Conflicts: N`, treat the Mac's version as source of truth unless investigation proves otherwise.

**v0.72** — Structured intake form v2.2 + AI insights pipeline + recommendation traceability:

The intake form now captures ~60 structured fields and feeds an AI-summarised clinical map into every downstream call (assess / rework / letter / sanity check) plus a recommendation-level audit trail.

**Phase 1 — storage** (Pydantic + intake shim):
- `fm-database/fmdb/plan/models.py` — 5 new sub-models (`ContraceptionEntry`, `PregnancyEntry`, `MedicationCategoryEntry`, `IntakeInsightHypothesis`, `IntakeInsights`) + ~60 new `Client` fields organised by section (weight trajectory + work pattern, family chip list, COVID infection + vaccine history, 9 layered medication category buckets, postprandial pattern + cold/heat tolerance, sleep depth + energy crashes + CGM/tracker, Bristol multi-tick + bowel pattern + hair/nails/skin/pain/oral subsections, period pain severity + contraception_history + pregnancies repeaters, sun + vit D, recent labs + readiness slider). All `Optional` with empty defaults — existing client.yaml files load unchanged.
- `fm-database-web/scripts/intake-token-action.py` — extended allowlist with `_FLOAT_FIELDS` (kg measurements), `_INTAKE_LIST_FIELDS` (chip arrays, overwrite-on-submit not additive), `_INTAKE_INT_LIST_FIELDS` (Bristol 1-7 multi-tick with range validation + dedup + sort), `_INTAKE_REPEATER_FIELDS` (light-validation list-of-dicts for medication category entries, contraception, pregnancies). End-to-end smoke test on cl-004: 57 fields submit-then-Pydantic-reload clean.

**Phase 2 — AI summarisation + coach UI** (BG agent):
- New shim `fm-database-web/scripts/generate-intake-insights.py` — single Haiku tool-use call (`claude-haiku-4-5`, max_tokens=2048, `record_intake_insights` tool with strict schema). System prompt: "FM-trained clinical reasoning assistant preparing Shivani for first session." Returns `{patterns: 3-5, red_flags: ≤6, top_hypotheses: 1-3 ranked by confidence, verify_in_session: 1-5}`. ~$0.02 per intake. Dry-run mode supported.
- New server actions `src/lib/server-actions/intake-insights.ts` — `generateIntakeInsights(clientId, dryRun?)`, `loadIntakeInsights(clientId)`, `updateInsightsCoachNotes(clientId, coachNotes)`. Coach can edit `coach_notes_for_ai` without regenerating (cheap write); regeneration is the manual 🔄 Refresh button (~$0.02).
- New `src/app/(v2)/clients-v2/[id]/intake-insights-card.tsx` mounted at the TOP of the right column on v2 client overview. Three states: no-intake / submitted-but-not-generated / fully-summarised. FmPanel + FmChip styling, traffic-light tinting for red flags. Inline-editable `coach_notes_for_ai` with blur-save.
- New read-only `src/app/(v2)/clients-v2/[id]/intake-view/page.tsx` — RSC dense definition-list rendering every captured intake field grouped by section. Linked from IntakeInsightsCard header strip ("📄 View full intake").

**Phase 3 — insights flow into all 4 AI calls**:
- `ai_check.py` `_client_snapshot()` includes the full `intake_insights` block (patterns + red_flags + top_hypotheses + verify_in_session + coach_notes_for_ai) for the deterministic-checker-plus-AI plan sanity layer.
- `assess-rework.py` `_build_context()` renders a `# INTAKE INSIGHTS (AI-summarised at submit)` block in the rework prompt with patterns, red flags, ranked hypotheses with confidence %, and coach corrections.
- `render-client-letter.py` `_top_of_mind_block()` surfaces red flags + patterns + top hypotheses + coach corrections in the letter generator's bullet list so the AI references them in every tip (BANNED-GENERIC rule).
- `assess.py` `client_ctx` carries the full insights structure through to the suggester's `synthesize()` call.

All 4 paths return `null` cleanly when `intake_insights` isn't generated yet — existing clients keep working unchanged.

**Phase 3.5 — recommendation-level intake_evidence (the audit trail)**:
- New `intake_evidence: list[str]` field on `HypothesizedDriver`, `SupplementItem`, `PracticeItem`, `LabOrderItem`. Free-text coach-readable phrases citing intake observations that drove each recommendation. AI populates them during assess + rework; coach can edit / remove freely.
- `suggester.py` tool schema gains `intake_evidence` array on `likely_drivers`, `lifestyle_suggestions`, `supplement_suggestions`, `lab_followups` properties. System-prompt rule #27 (INTAKE-EVIDENCE TRACEABILITY) instructs the AI to populate using the format `"observation (source_field)"` e.g. `"PPI use 3+ years (acid_suppressants)"`, `"On Ozempic 0.5mg (glp1_medications)"`, `"Wakes at 3am (wake_time_pattern)"`. Most-decisive observation first; up to 4 items per recommendation; empty list when not intake-driven (don't fabricate).
- `assess-rework.py` tool schema gains `intake_evidence` on `suggested_changes` + system-prompt INTAKE-EVIDENCE TRACEABILITY block. Coach corrections in `coach_notes_for_ai` override raw-field AI inferences.
- `apply-rework.py` propagates `intake_evidence` from each suggested_change onto the target Plan sub-model. New `_merge_evidence()` helper unions existing + incoming citations with case-insensitive dedup, preserves order. Education modules embed evidence as parenthetical in `client_facing_summary` (EducationModule doesn't carry the structured field).
- `plan-editor.tsx` new `<IntakeEvidenceChips>` component — small indigo-tinted panel labelled "💡 From intake · N" with removable chip per citation. Mounted under SupplementItem's coach_rationale textarea + HypothesizedDriver's reasoning textarea. Hides entirely when `intake_evidence` is empty. Respects `effectiveLocked` / `locked` so published plans show citations read-only.

**Design v2.2 — intake form port** (BG agent):
- `fm-database-web/src/app/intake/_design/form.css` upgraded 822 → 1171 lines (+ `.fm-stool__icon:has(svg)` override to drop placeholder stripes when a real glyph is rendered). New `--terracotta` token. New atoms: `.fm-subcard` (Bristol gets its own card), `.fm-stool` / `.fm-stool-list` (7 interactive cards stacked vertically), `.fm-medcard` / `.fm-medstack` (layered chip→mini-card pattern for Section 7 medications), `.fm-stepper` (number input with - / + buttons), `.fm-repcard` (contraception + pregnancy repeater rows), `.fm-select`, `.fm-microcopy`, `.fm-chip--xs`, `.fm-input--small`, `.fm-fieldgrid`, `.fm-section--subcard`.
- `intake-form.tsx` rewritten in place 1516 → 1799 lines. Five new reusable components: `MedMiniCardForm`, `MedicationStack` (per bucket — chip toggles AND inserts/removes mini-cards), `BristolStoolPicker`, `Stepper`, `GradedSlider` (1–10 with caption tiers; reused for `period_pain_severity` and `readiness_confidence`), `ContraceptionRepeater`, `PregnancyRepeater`, `ChipMulti`. Pain body-map is a dashed placeholder rectangle (interactive SVG silhouette is dev backlog).
- Section count now **13 (male)** / **14 (female)**. Welcome screen "About 25 minutes" up from 20. `FormChrome` adaptive — passes `totalSections` and renders that many dots. Scroll-spy + autosave + onBlur save + submit untouched.
- 5 hard-coded option lists imported verbatim from design reference: `MED_BUCKETS` (9 categories), `BRISTOL_TYPES` (7 types), `BOWEL_PATTERN` chips, `CONTRACEPTION_TYPES`, `PREG_COMPLICATIONS`.

**Section 11e pain body map** (dev-implemented per design brief — replaces the dashed placeholder rectangle):
- New `src/app/intake/[token]/pain-body-map.tsx` (377 lines). Hand-authored stylised humanoid silhouette via SVG `<rect>` + `<ellipse>` shapes (no external assets, no npm deps). Front + back views render side-by-side with flex-wrap → stack on mobile.
- All 40 region slugs from the brief are wired as tappable elements: front 26 (head / face / jaw / neck_front / chest / shoulder_left/right / arm_left/right / elbow_left/right / hand_left/right / upper_abdomen / lower_abdomen / pelvis / hip_left/right / thigh_left/right / knee_left/right / shin_left/right / foot_left/right) + back 14 (head_back / neck_back / upper_back / mid_back / lower_back / scapula_left/right / sacrum / buttock_left/right / calf_left/right / achilles_left/right).
- Selected regions fill `rgba(43, 45, 66, 0.30)` (indigo at 30% opacity) + 1.5px indigo stroke per the brief. Hover (desktop only) at 15% opacity.
- Accessibility: each region is `role="button"` + `tabIndex={0}` + `aria-pressed` + Enter/Space toggle. SVG containers are `role="group"` with their own `aria-label`. Each region has 24×24px minimum tap target.
- Chip readback row below the silhouettes — selected regions render as removable chips (`Lower back ×`). Empty state shows "Tap any region above to mark where you have pain". Reuses existing `.fm-chip` / `.fm-chip--on` / `.fm-chip__x` classes.

**Bristol stool icons** (dev-implemented per design brief — replaces 7 placeholder squares):
- New `src/app/intake/[token]/bristol-stool-icon.tsx` (~150 lines). 7 minimal stylised SVG glyphs in `var(--terracotta)`, one per Bristol type:
  - Type 1: three separate filled circles (hard lumps)
  - Type 2: overlapping circles (lumpy sausage)
  - Type 3: rounded rect + crack hatches (sausage with cracks)
  - Type 4: smooth rounded rect (healthy)
  - Type 5: soft ellipses (blobs with clear edges)
  - Type 6: irregular path + speck circles (mushy ragged edges)
  - Type 7: wavy fluid path + ripple line (watery)
- `BristolStoolIcon` mounted inside `.fm-stool__icon` slots in the form's `BristolStoolPicker`. CSS override `.fm-stool__icon:has(svg)` drops the placeholder stripes when a real glyph is rendered.

**Phase 3.5c expansion — IntakeEvidenceChips on PracticeItem + LabOrderItem**:
- Original Phase 3.5c mounted the audit-trail chips on SupplementItem + HypothesizedDriver only. Now also rendered under `PracticeItem.details` textarea (Lifestyle section) and `LabOrderItem.reason` textarea (Lab Orders editor in `LabOrdersEditor` component). Same `<IntakeEvidenceChips>` component, same hide-when-empty behaviour, same locked-respecting. All four AI-derived recommendation types now display the `💡 From intake · N` audit chip-row inline when the suggester / rework AI cited intake observations.

**Architectural decisions locked in v0.72**:
- **Free strings throughout** for chip values (`list[str]`, not Pydantic Enums) — AI handles variant spellings, easier to add chip options without migrations.
- **Single Haiku summarisation pass** on intake submit, not on every AI call. Coach `🔄 Refresh insights` for manual regen. `coach_notes_for_ai` is the cheap-edit field that flows into downstream AI without regenerating.
- **Bristol illustrations + body map deferred to dev** (out of design pass). Bristol slug list + body region slug list documented in `docs/INTAKE_FORM_DESIGN_BRIEF.md` dev backlog.
- **Pattern B chosen for Bristol** (7 interactive cards stacked) — design's call, locked in form.css.
- **Warm terracotta `#B85C3E`** reserved as `--terracotta` token for Bristol icons.

**Key invariants**:
- The field-name dev contract in `docs/INTAKE_FORM_DESIGN_BRIEF.md` is the source of truth. Anything generated under a different name is silently dropped at submit.
- `MedicationCategoryEntry.side_effects` is a `str`, not a chip list — the design reference showed chips but the contract says string; the form went with the contract.
- Conditional rendering rules preserved: Section 12 (women's) only renders when `sex === "F"` / `"f"`. `weight_change_trigger` only renders when `weight_trend_current === "changed_sharply"`. `covid_long_symptoms` only renders when long-COVID ticked.
- Existing intakes (pre-v0.72) load cleanly — every new field defaults to empty / null / `[]`. No migration needed.
- `intake_evidence` empty list = recommendation came from symptoms/labs only with no intake contribution. AI is told NOT to fabricate citations.
- Insights regeneration is MANUAL (per coach decision). Coach edits a structured field → insights stay frozen until coach taps 🔄 Refresh on IntakeInsightsCard.

**v0.71** — Client-side start-date confirmation (3 patterns + reminder panel):

Building on v0.70's coach-side editor. Three independent layers let the client confirm or change their actual meal-plan start date, each requiring less infra than the next. All three stack cleanly:

**Pattern A — Letter explicitly names the date + invites WhatsApp pushback** (`render-client-letter.py`):
- `_start_when_block()` rewritten with `_human()` formatter (turns YYYY-MM-DD into "Sunday 17 May 2026"). Each scope (`meal` / `supplement` / `both`) now contains a `GREETING REQUIREMENT` instruction that forces the AI to name the start date in **bold** and invite pushback ("If that day doesn't suit you, just reply to this WhatsApp with the date you'd prefer and I'll shift everything.")
- Coach-confirmed mode (when `meal_plan_started_on` is set): warmer language, no re-invitation to push back ("Now that Day 1 is locked in for Tuesday 19 May...").

**Pattern B — WhatsApp buttons in the printed letter HTML** (`brand_html.py` + `src/lib/start-date-parser.ts` + webhook):
- New `_start_date_buttons_html()` injects up to 3 `wa.me` deep-link buttons into the letter directly below the title block. Pre-composed structured messages:
  - `✅ Yes — {date} works` → `wa.me/918850176753?text=✅%20START:%20YYYY-MM-DD%20[plan:%20<slug>]`
  - `📅 I'll start a different day` → soft pre-fill, coach reviews
  - `📦 My supplements have arrived` → only on `supplement_plan` + `consolidated` letter types
- Buttons styled sage-green / indigo / amber, hidden on print (`.no-print-buttons` class added to the existing print CSS rules).
- `wrap_in_brand_html()` gains 4 optional params: `meal_start_ymd`, `supplements_start_ymd`, `plan_slug`, `letter_type`. Python 3.9-safe (no `str | None` annotations — uses untyped defaults). Returns `""` when no start date available; the f-string template renders an empty slot.
- `render-client-letter.py` computes effective dates inline and passes them through. Mirrors the Python Plan helpers exactly: `meal_actual or (plan_period_start + 3d)`.
- New pure helper `src/lib/start-date-parser.ts` exports `parseInboundStartDateIntent(text)` returning `{kind: 'meal_start_date' | 'supplements_arrived', date: YYYY-MM-DD} | null`. Recognises ISO dates, Indian DD/MM/YYYY format, textual "19 May 2026" / "May 19", with a sanity check (±60 days from today) to reject typos / "I had a flare on 2026-05-19" false positives. Requires an explicit "Start" prefix or verb phrase — refuses to interpret bare dates.
- Webhook route (`api/whatsapp-webhook/route.ts`) gains a Pattern-B branch BEFORE the existing poll classifier. When `parseInboundStartDateIntent` returns a hit, finds the client's latest published plan and calls `updatePlanStartDates(slug, {meal_plan_started_on: date})` or `{supplements_started_on: today}` directly. Falls through to the existing quick_note path on any failure so messages are never lost.

**Pattern C — Tokenised `/start/[token]` landing page** (built by parallel sub-agent):
- New Pydantic fields on Plan: `start_confirmation_token`, `start_confirmation_expires_at`, `start_confirmation_used_at`. All `Optional`, default `None` — existing plans load cleanly under `extra="forbid"`.
- New shim `scripts/start-date-action.py` (~290 lines) — JSON dispatcher with `generate` / `lookup` / `confirm` / `revoke` actions. Scans all 5 plan buckets (`drafts`, `ready`, `published`, `superseded`, `revoked`) to resolve token → plan. Writes via direct `yaml.safe_dump` (avoids Pydantic v2 / Python 3.9 round-trip brittleness).
- New server actions in `lib/server-actions/plans.ts`: `generateStartConfirmToken`, `lookupStartConfirmToken`, `confirmStartDate` (chains into the existing `updatePlanStartDates` to fire the same revalidation set as the coach-side editor), `revokeStartConfirmToken`.
- New public route `/start/[token]` — server component validates token, renders friendly error cards for `invalid_or_expired` / `expired` / `already_used`, otherwise hands off to a mobile-first form. Form: big sage-green "✓ Yes, confirm {date}" primary button + secondary date-picker path + thank-you state on success. Standalone layout (no app sidebar).
- New coach-side button `start-confirm-link-button.tsx` mounted as a sibling panel after `<PlanStartDatesPanel>` on the plan-edit page (the existing coach-types-date and new client-taps-link concerns kept cleanly separated). Single button "📅 Get client confirm link" → token + 📋 Copy + 💬 WhatsApp share. Hides under "✓ Client confirmed" once `start_confirmation_used_at` is set.

**Dashboard reminder panel** (`src/components/start-date-reminder-panel.tsx`):
- Auto-loads on mount via `listUnconfirmedStartDatesAction(staleDays=5)`. Lists every published plan whose `meal_plan_started_on` is still null AND whose publish event was >5 days ago. Sorted most-stale first.
- Each row: client name (links to plan editor), days since publish, assumed Day 1 (period_start + 3d), plan slug. Per-row "📨 Send reminder" button calls `sendStartDateReminderAction(clientId)` which sends the `fm_start_date_check_v1` WhatsApp template via the self-hosted WA Cloud API server.
- Self-hides when the list is empty. Disabled state when `WHATSAPP_SERVER_URL` unset.
- Inbound replies parsed by Pattern B's parser → list clears itself once client confirms.

**Key invariants:**
- The four `wa.me` confirm/edit/supps buttons all point to the coach's number (`918850176753` — hardcoded in `brand_html.py` matching the existing footer link). If the coach number changes, update in both places.
- The `[plan: <slug>]` tag in the structured pre-composed message is forward-compatible — the webhook today resolves to "latest published plan" regardless of the tag. We could later parse it and let a client confirm against a specific plan if they have multiple.
- `parseInboundStartDateIntent` REQUIRES either an explicit "START:" prefix OR a verb phrase like "I'll start on / starting on / start". Bare dates ("had a headache 2026-05-19") are deliberately ignored to avoid false positives. If users start typing plain dates, the failure mode is "message lands in coach inbox as quick_note" — never silent data loss.
- The 60-day sanity window on the parser catches typos like 2027 instead of 2026. Adjust in `start-date-parser.ts` if a use case ever crosses it.
- `updatePlanStartDates` (v0.70) is still the ONLY write path for the two start-date fields. Both Pattern B (webhook → action) and Pattern C (`confirmStartDate` chains into it) funnel through it so revalidation paths fire consistently.
- Templates are registered via `whatsapp-server/scripts/submit-templates.js` (NOT the AiSensy dashboard — AiSensy is decommissioned). `fm_start_date_check_v1` = "Hi {{1}} 👋 Quick check-in from Shivani — have you started your plan yet? If yes, just reply with the date you began...". Inbound replies handled by `/api/whatsapp-webhook`.
- The dashboard reminder panel is in addition to, not replacing, the WeeklyPollPanel. Different concerns: WeeklyPollPanel checks adherence over time; StartDateReminderPanel checks confirmation has been captured at all.

**v0.70** — Effective start dates (meal plan +3d / supplements +7d adoption lag):

Coach feedback 2026-05-14: clients don't actually start a meal plan the day it's sent — they take ~3 days to grocery shop and prep. Supplements take ~1 week (have to be ordered + delivered). Computing recheck from `plan_period_start + plan_period_weeks × 7` shaves 3–7 days off the protocol window. Fix: introduce effective-start fields with sensible defaults, drive recheck off the meal-plan effective start, and frame the client letters relative to "your Day 1, not the date you received this letter."

**Pydantic Plan model** (`fm-database/fmdb/plan/models.py`):
- New nullable fields: `meal_plan_started_on: Optional[date]`, `supplements_started_on: Optional[date]`. Coach captures these AFTER publish when the client confirms.
- Class constants `MEAL_PLAN_DEFAULT_DELAY_DAYS = 3`, `SUPPLEMENTS_DEFAULT_DELAY_DAYS = 7`.
- Methods: `effective_meal_plan_start()`, `effective_supplements_start()`, `effective_recheck_date()`. Each returns coach-asserted value if set, else `plan_period_start + default_delay`. `effective_recheck_date = effective_meal_plan_start + plan_period_weeks × 7` — this is what every coach-facing surface should call. The stored `plan_period_recheck_date` becomes a legacy / audit field; effective recheck shifts live when the coach updates the actual start.

**Shared TS util** `src/lib/fmdb/plan-timing.ts`:
- Mirrors the Python helpers: `effectiveMealPlanStart`, `effectiveSupplementsStart`, `effectiveRecheckDate`, `isRecheckOverdue`, `hasAssertedStart`. Pure functions, no React. Imported anywhere recheck dates are displayed or compared.

**Three TS callsites updated** to use `effectiveRecheckDate`:
- `dashboard-v2/page.tsx` `computeSignal()` — recheck-overdue check now reflects effective dates; "Recheck due" badges shift 3 days later by default.
- `(v2)/calendar/page.tsx` — recheck events on the calendar grid land on the effective date.
- `(v2)/clients-v2/page.tsx` — clients list "Recheck due" column.

Each callsite still references the stored `plan_period_recheck_date` as a fallback when `effectiveRecheckDate()` returns null (no plan_period_start).

**Server action `updatePlanStartDates(slug, patch)`** in `lib/server-actions/plans.ts`:
- Dedicated endpoint that BYPASSES the draft-only gate in `updatePlan()` — coach typically learns the actual start dates after the plan is published. Touches ONLY `meal_plan_started_on` + `supplements_started_on` + `updated_at`, so it can never accidentally rewrite the rest of a published record. Revalidates `/plans/<slug>`, `/clients-v2/<id>`, `/dashboard-v2`, `/calendar`.

**Coach editor: `<PlanStartDatesPanel>`** at `src/app/(v2)/clients-v2/[id]/plan/edit/[slug]/plan-start-dates-panel.tsx`:
- Mounted between `AIReadCard` and `PlanEditor` on the v2 plan-edit view.
- Two date inputs, both optional. When unset, shows the assumed-default date in muted text ("Default assumption: 17 May 2026 — 3d after plan published").
- Coach-confirmed dates get a green ✓ chip.
- Live preview of the effective recheck date below — shifts as the coach types.
- "Clear (back to defaults)" link to revert to the +3d / +7d assumption.

**Letter framing** (`fm-database-web/scripts/render-client-letter.py`):
- New `_start_when_block(plan, scope)` helper. `scope` ∈ `{'meal', 'supplement', 'both'}`. Three modes:
  - No `plan_period_start` available → soft framing: "Day 1 is whenever the client is ready — 2–3 days for the meal plan to settle in, ~1 week for supplements."
  - `plan_period_start` set, no coach actuals → "Plan sent {date}. Meal-plan Day 1 ~{+3d}, Supplements Day 1 ~{+7d}. All week numbering RELATIVE to her Day 1."
  - Coach-asserted actuals → "Client confirmed she started on {date}. Week 1 begins that date."
- Injected into all 4 prompt builders: `_build_prompt_meal_plan` (scope=meal), `_build_prompt_supplement_plan` (scope=supplement), `_build_prompt_lifestyle_guide` (scope=both), the consolidated prompt at line ~2735 (scope=both).
- AI now generates greetings that explicitly tell the client "Day 1 is when YOU are ready, no rush." Week numbering throughout the letter is framed as relative to the client's personal Day 1.

**Key invariants:**
- The Plan model's stored `plan_period_recheck_date` is now a legacy / audit field — read-only display only. Anything that COMPARES against today (overdue checks, calendar events, dashboard signals) MUST go through `effectiveRecheckDate()` or `isRecheckOverdue()`. Don't add new comparisons against `plan_period_recheck_date` directly.
- `effectiveRecheckDate(plan)` returns `null` if either `plan_period_start` or `plan_period_weeks` is missing. Callsites should fall back to `plan.plan_period_recheck_date` for display, OR skip the recheck signal entirely.
- `updatePlanStartDates` is the ONLY way to write the two new fields. `updatePlan()` still gates on draft. Don't try to set them via the general patch path on a published plan — it'll reject.
- Existing plans without the new fields load cleanly because both fields are `Optional[date] = None`. No migration needed.
- The default delays (3 + 7) are class constants — change them in one place if FM evidence warrants different defaults later.

**v0.69** — Client intake web form + ATM/timeline into AI sanity + weekly WhatsApp poll:

Three independent builds landed on `2026-05-14`. All ship behind `npm run build` clean.

**📝 Client-facing intake form** (tokenised public link, no auth):
- New Pydantic fields on `Client`: `intake_token`, `intake_token_expires_at`, `intake_form_draft`, `intake_submitted_at` (`fm-database/fmdb/plan/models.py`).
- New shim `fm-database-web/scripts/intake-token-action.py` — dispatcher for 5 actions: `generate` (token + 14d TTL), `lookup` (token → prefill + draft), `save_draft` (autosave per-section), `submit` (merge into `client.yaml` + append `[source: client_intake_form]` quick_note + revoke token), `revoke`. Field-allowlists (`_SCALAR_FIELDS`, `_LIST_FIELDS`, `_DATE_FIELDS`, `_INT_FIELDS`) gate what the form can write; everything else is silently dropped. Five-pillars short-key remap (`stress → stress_level`, `movement_days → movement_days_per_week`) so the form payload round-trips through `FivePillarsAssessment` without `extra_forbidden`.
- New server actions `src/lib/server-actions/intake.ts`: `generateIntakeToken`, `lookupIntakeToken`, `saveIntakeDraft`, `submitIntakeForm`, `revokeIntakeToken`. All shell out via the standard `runScript` pattern.
- New public route `/intake/[token]` (NOT under `(v2)` — no app sidebar, no auth). Standalone `layout.tsx` for the brand header. Server component calls `lookupIntakeToken` and either renders the form (with prefill + draft merged) or a friendly error card (invalid / expired / already_submitted).
- New client form `src/app/intake/[token]/intake-form.tsx` (~810 lines). 11 sections single-page (mobile-first scroll): Welcome → About you → Concerns → What's going on → Timeline (repeater) → Day-to-day (5 narrative fields) → Five Pillars (rating buttons + day-chips) → Past & environment → Diet → For women (conditional on `sex==F`) → Anything else. Debounced 5s autosave + on-blur save. Sticky "Saved HH:MM:SS ✓" indicator. Submit replaces the form with a thank-you card.
- New coach-side component `src/app/(v2)/clients-v2/[id]/send-intake-form-button.tsx` — clickable panel on v2 client overview right column. "📨 Send intake form" → generates token → shows public URL + 📋 Copy + 💬 Send via WhatsApp (`wa.me/{e164}?text={prefilled-msg}`) + Revoke. Hides under "✓ Form submitted on …" if `intake_submitted_at` is set.
- Smoke-tested: generate → lookup → submit cycle on a real client backs and restored cleanly; `Client(**yaml.load(...))` round-trip after submit succeeds. Token correctly revoked. Test session cleaned up post-verification.

**🧭 IFM timeline + ATM synthesis flow into AI sanity layers**:
- `fm-database/fmdb/plan/ai_check.py` `_client_snapshot()` now includes a structured `timeline_events` array — antecedents / triggers / mediators across the client's history. AI sanity check can now flag "protocol doesn't address the 2018 mold exposure".
- `fm-database-web/scripts/assess-rework.py` `_build_context()` prompt gains two new blocks: `# IFM TIMELINE (N events)` (chronological dump of every `timeline_events` entry sorted by year/date), and `# COACH/AI ATM SYNTHESIS (from plan notes)` (extracts the `## IFM Timeline` or `## ATM` block out of `plan.notes_for_coach` if present). Rework AI now sees the upstream synthesis the assess-pipeline made, instead of just the symptom-du-jour summary.
- Tiny surgical edits, no schema changes — just better context for the AI calls already happening.

**📣 Weekly WhatsApp check-in poll** (via self-hosted WhatsApp Cloud API server):
- New pure helper `src/lib/poll-labels.ts` — `classifyPollReply(text)` matches inbound text against 13 button-label substrings (`"all good"`, `"all taken"`, `"missed 1-2"`, `"struggling"`, `"none"`, ...) → returns `{dim: 'overall'|'supplements'|'meals'|'movement', score: 'good'|'partial'|'struggling'}` or null.
- New server actions `src/lib/server-actions/weekly-poll.ts`: `sendWeeklyPollAction(clientIds?, campaignName='fm_weekly_check_in_v1')` — auto-selects clients with published plan if no IDs passed, calls `sendWhatsAppAction` per client with `[name]` as template param, writes audit row to `~/fm-plans/_weekly_poll_log.yaml`. `detectAdherenceDropsAction(windowDays=28)` — scans every client's `sessions/` dir for `[source: weekly_check_in_poll]` quick_notes, reads structured `poll_response` field, applies 3-strike rule (2+ struggling OR 3+ partial in trailing 28d).
- Webhook extended (`src/app/api/whatsapp-webhook/route.ts`): after client-phone match, runs `classifyPollReply` on the message text. If it matches a button label, routes through dedicated shim `scripts/save-poll-response.py` which writes a session with `presenting_complaints: "[source: weekly_check_in_poll]"` and a structured `poll_response: {dim, score, raw_text, received_at}` field. Generic free-form messages still go through `save-session.py` as before.
- New dashboard panel `src/components/weekly-poll-panel.tsx` — mounted in `dashboard-v2/page.tsx` right under BroadcastPanel. Two actions: "📣 Send poll to all active clients" (calls `sendWeeklyPollAction`, shows sent/skipped/failed chips + collapsible error list), "🚨 Scan for adherence drops" (calls `detectAdherenceDropsAction`, lists flagged clients with strike count + dimensions + "🔁 Run rework" button per flag that fires `assessReworkBenefitAction({clientId, triggeredBy:'quick_note', eventSummary:'...'})`).
- 4 templates registered via `whatsapp-server/scripts/submit-templates.js` (NOT AiSensy): `fm_weekly_check_in_v1`, `fm_weekly_supplement_v1`, `fm_weekly_meals_v1`, `fm_weekly_movement_v1`. Template body `"Hi {{1}} 👋 Quick weekly check-in..."` + 3 interactive reply buttons per template (labels in `weekly-poll.ts` + `poll-labels.ts`). Gated by `WHATSAPP_SERVER_URL` env var.

**Key invariants:**
- `intake_token` is single-use: cleared by the submit shim. Coach can re-issue via "Send a new intake form" — replaces the prior token; old link returns "invalid_or_expired". Submitted records live forever in the tagged quick_note session for audit.
- Public route `/intake/[token]` has NO auth and NO app shell. URL token is the only auth surface; coach should send via WhatsApp (URL-shortening optional).
- Pure helpers must NOT live in `"use server"` files. `classifyPollReply` had to be extracted from `weekly-poll.ts` into `lib/poll-labels.ts` — server-action files only allow async function exports. Same rule applies to any new helper.
- `assessReworkBenefitAction`'s `triggeredBy` enum is `"check_in" | "quick_note" | "functional_test" | "lab_snapshot" | "genetic_report"`. Weekly-poll adherence-drop triggers use `"quick_note"` (the closest match; the underlying Python is permissive). Add a dedicated enum value later if we want analytics to split it out.
- Five-pillars form keys (`stress`, `movement_days`) → Pydantic keys (`stress_level`, `movement_days_per_week`) remap lives in `intake-token-action.py` `_FP_KEY_MAP`. If anyone adds a new pillar to the form, update both `_FP_KEY_MAP` and `_FP_ALLOWED`.

**v0.68** — Plan-editor rethink + rework-AI lab-dedup + backlog Haiku classifier + full v1 structural retirement:

**Tip: 12 commits beyond v0.67 (`1c7ec4a..57ed0b7`).** PM2 still serving fm-coach on port 3002. Validator clean (0 errors). Tsc + build clean.

Plan-editor rethink (`ca3f511`, biggest UX shift this round):
- Coach asked "why is the documents tab needed? what's the value of lifecycle? just create an approve button on the left panel. add overview + what the AI knows about the client". Result: kill Documents tab, demote Lifecycle to ⚙️ Advanced (only rare actions: revoke / supersede / diff / export / save-as-template / successor draft), promote Submit/Activate to a sticky **InlineStatusBar** at the top of the editor, surface **ClientSnapshotCard** (bio + active conditions + medical history + meds + allergies + goals + diet + ALL labs on file) and **AIReadCard** (top 3 likely drivers from latest assessment + plan.ai_sanity_check concerns colour-coded by severity + active rework_suggestion) ABOVE the editor.
- Three new components in `(v2)/clients-v2/[id]/plan/edit/[slug]/`: `client-snapshot-card.tsx`, `ai-read-card.tsx`, `inline-status-bar.tsx`. Server-rendered for the snapshot/AI-read cards (they're pure context); InlineStatusBar is client-side because Submit/Activate are interactive.
- Backward-compat: `?tab=lifecycle` → advanced, `?tab=documents` → protocol. Old deep-links still resolve.
- Editor now shows: status header → client snapshot → AI's read → AI Plan Assistant → protocol sections → Advanced (collapsed). Single scrolling page; coach sees everything before deciding.

Rework AI honesty (belt-and-braces, `7db5e7d` + `086808e`):
- Coach hit Archana's rework adding `Order Baseline 25-OH Vitamin D` even though her result (24.64 ng/mL) was 5 days old on file. Plus the SAME oestrogen-metabolite order appended 6 times across repeated apply-rework clicks. Two fixes — upstream prevention + apply-time safety net.
- **Upstream** (`scripts/assess-rework.py`): now feeds `# LABS ALREADY ON FILE (N markers)` block into the Haiku prompt with every `test_name` + most-recent `value`/`unit`/`date` from `client.health_snapshots`. System-prompt rule: "ONLY propose lab_order for markers NOT already in the LABS ON FILE block. If a marker is on file, reference its value in your rationale instead — never re-order it."
- **Apply-time** (`scripts/apply-rework.py`): `_client_already_has_lab()` helper walks the same snapshots and skips proposed lab_orders that reference markers on file (or known aliases — vit D / 25-oh / HbA1c). Dedup against existing `plan.lab_orders` too, case-insensitively. Skips recorded as `(skipped — X already on file)` lines in the change log so they remain visible to the coach.
- Also fleshed out the rework's itemized change log (`9e09f1a` already shipped in v0.67) — every applied change now appears as `+ supplement n-acetyl-cysteine — Add NAC 600–1000 mg daily` in `notes_for_coach`, prevents the per-section hunt.

Backlog Haiku classifier sweep (`1e039ff` + `20a8236` + `da02b66`):
- Catalogue queue was 786 → 287 open in one Haiku pass. 246 noise rejected, 110 tagged as lab-test candidates, 247 entity candidates left for manual triage, 2 alias-suggestions.
- `scripts/haiku-classify-backlog.py`: claude-haiku-4-5 with tool-use, 16 batches × 40 items, ~$0.10. Categories: reject / entity / lab_test / attach_alias.
- `scripts/promote-lab-tests.py`: of the 110 lab-test candidates, 34 promoted to `lab_tests/` stubs with `units` + `full_name` auto-filled from a ~50-marker reference table (TSH, fT3/fT4, HOMA-IR, vit D, ferritin, B12, DUTCH, anti-TPO/Tg, lipid panel, liver enzymes, etc.). 38 already existed. 38 had unknown units (left open for hand-promotion).
- Policy-C dose-bearing aliases on 12 supplements (Asian Ginseng 200-400mg → ashwagandha alias, etc.).
- **Suggestion-chip 1-3 char alias bug fixed** (`da02b66`): "Hypnosis" and "Spiritual + Religious Practices" backlog items were being suggested as aliases of `intermittent-fasting` because the IF alias matched as a substring inside "Behavior Mod**if**ications". `suggestTarget()` now requires both sides ≥ 4 chars before containment match. Exact match still works for `IF` typed alone.

Sessions Timeline restoration (`914504b` + `1024f4b`):
- Coach hit 404 on `/clients-v2/[id]/timeline`. Two bugs masking each other: tab labelled "Timeline" but routed to `/sessions`; meanwhile `/sessions` itself was 500-ing because `pickDefaultMarkers()` was being called server-side from a `"use client"` module (forbidden in Next 16 — becomes a client-reference proxy).
- Fixes: `marker-defaults.ts` extracts pickDefaultMarkers + GOAL_RULES + helpers into a pure-TS module (no "use client"). Both server wrapper AND client component now import from there. Plus a new `(v2)/clients-v2/[id]/timeline/page.tsx` alias that redirects to `/sessions` (preserves `?sid=` and `?type=` query params).

Lab-test MMA fleshed out (`ac346dc`):
- Was a minimal stub. Now full clinical reference card: conventional <378, FM-optimal <180 nmol/L. 4-tier interpretation table in `notes_for_coach`. Renal caveat (false-positive in eGFR < 60). When-to-order indications (vegetarians, PPI/metformin, elderly with atrophic gastritis, Hashimoto's, post-bariatric, MTHFR-suspected with normal serum B12). Linked to 4 topics + 2 mechanisms. India context: ₹1500-2500 at Quest/Thyrocare/Metropolis/SRL. Evidence_tier upgraded `fm_specific_thin → strong`.

Follow-up plan maintenance intent (`7fa3277`):
- Coach asked "what's the difference between Continue Meal Plan and Generate Follow-up Plan, and how are maintenance plans created?". Result: split the Follow-up panel into two intents — **🔁 Next phase** (continue active care with adjustments) and **🌿 Maintenance** (client graduated; lighter plan with anchor habits + quarterly check-ins + yearly labs).
- Intent picker drives slug stem (`-plan-N-` vs `-maintenance-`), phase weeks default (12 vs 26), button label, AI prompt branch.
- `scripts/generate-follow-up.py`: new `SYSTEM_PROMPT_MAINTENANCE` with rules for graduation — strip symptom-targeted supplements (keep only 2-4 foundational), titrate down, add one as-needed supplement for flares, keep 3-5 internalised habits, lighter tracking (monthly journal + quarterly coach + annual deep retest), plan period 26 weeks.
- Continue Meal Plan panel subtitle clarified: "Mid-cycle inspiration: while the current 12-week protocol is still running, generate a fresh meal-plan letter ... Supplements + lifestyle stay locked — only the meals change."

v1 → shared structural refactor (`57ed0b7`, the biggest move this session):
- Coach asked "any v1 files still in use?". 26 paths were imported by v2 from misleadingly-named directories (`src/app/clients/[id]/*`, `src/app/plans/[slug]/*`, `src/app/assess/*`). Page-level routes had retired but the files lived at v1 paths because they were also imported as a shared library.
- 59 files moved + 125+ import references updated in one atomic commit. New clean structure:
  - `src/lib/server-actions/`: clients.ts, plans.ts, plan-lifecycle.ts, plan-chat.ts, assess.ts, mindmap.ts, usage.ts
  - `src/lib/fmdb/`: plan-diff.ts (pure utility)
  - `src/components/plan-editor/`: 8 components incl. plan-editor.tsx, plan-chat-panel.tsx, plan-check-panel.tsx, lifecycle-panel.tsx, delete-plan-button.tsx, send-to-client-modal.tsx, protocol-template-picker.tsx, new-plan-wizard.tsx
  - `src/components/client-widgets/`: 39 per-client widgets (every .tsx that was under `clients/[id]/` except page.tsx) + new-client-form.tsx
  - `src/components/assess/`: 2 widgets (assess-client.tsx, ifm-matrix-card.tsx)
- Kept at v1 paths (intentionally): `src/app/{clients,plans,assess,sources}/page.tsx` + `clients/[id]/page.tsx` + `plans/[slug]/page.tsx` + `plans/new/page.tsx` — all redirect-only shims that bounce legacy URLs to v2. Removing them would break old bookmarks.
- Automation: `/tmp/refactor-v1-to-shared.py` did the moves + absolute-path rewrites; `/tmp/fix-relative-imports.py` cleaned up the relative `./actions` / `../actions` imports inside moved files that the first pass missed.
- The "is this v1 code?" question now has a clean answer: only redirect shims live at v1 paths; everything else is properly under `src/lib/` or `src/components/`.

Operational state at end of session:
- Catalogue (unchanged from v0.67): 0 errors, ~1637 warnings (non-blocking).
- Backlog: 287 open / 1041 rejected / 114 added. 38 lab-test candidates have unknown units (open for manual unit-attribution).
- Plans on disk: 5 published, all 0 CRITICAL. Archana's rework draft cleaned in place (7 lab_orders → 1, the 5 duplicate oestrogen-metabolite entries + the on-file Vitamin D order all removed).
- PM2 fm-coach reloaded multiple times; all v2 routes verified 200.

**Deferred (3-6 month per coach):**
- HeyGen avatar video library (free-tier exhausted; needs Creator upgrade)
- NotebookLM batch (manual UI workflow — checklist of 12 topics ready)
- JSON export contract for Project 2 (mobile app)
- VitaOne order-through-coach (awaiting their partner support reply since 2026-05-09)

**Real pending items the coach should tackle:**
- 287 backlog items at `/backlog` with the now-clean suggestion-chip flow (~45 min)
- 38 unknown-units lab-test stubs (hand-promote each with right units)
- 34 lab-test stubs created with auto-inferred units — need conventional + FM-optimal ranges + interpretation_low/high fleshed out before clinical use
- 11 home_remedy stubs (abhyanga, bhringraj, kashayams, etc.) need indications + contraindications + preparation + typical_dose filled
- Custom WhatsApp app integration (replacing AiSensy) — see next session

**Design punchlist gaps still real:**
- #27 Inbound message thread (only outbound exists today; coach reads on phone)
- #50 Help page is a stub
- #52 Empty + error states across the app
- #10 Edit-vs-share toggle on plans (partial — letter editor covers it)

---

**v0.67** — Catalogue cleanup sweep + AI sanity check field-test + tracking UI + v1 retirement:

**Tip: 33 commits beyond v0.66 (`e072e00..e7cdf10`).** PM2 still serving fm-coach on port 3002. All validator clean (0 errors).

Catalogue cleanup — three full passes (topic / mechanism / symptom / supplement):
- **Topic pass** (`91b00f6` + `044a69d`): Analyzer surfaced 46 duplicate-topic groups; coach reviewed all 22 coach_eye groups manually. Net: 21 merges, 13 dismisses, -33 files. Big wins: `5r-gut-protocol` (auto-routed → protocol, 4-way merge), `gut-barrier-dysfunction` (auto-routed → mechanism, 4-way leaky-gut merge), `liver-detox-support` (new protocol stub from 4 liver-detox topic dupes), `hpa-axis-dysregulation`, `adrenal-fatigue`, `autoimmune-thyroiditis`, `vitamin-d3 / b12`, `magnesium-nutrition`, `zinc-nutrition`, `dyslipidemia`, `folate-nutrition`, `homocysteine-and-methylation`, `hypothyroidism`, `sibo`, `sleep`, `cortisol-elevation`, `bloating`. **Coach edits applied per-group** (e.g. hypothyroidism kept t3-conversion-disorder separate; sleep kept insomnia as symptom; vagal kept reduction separate).
- **Mechanism pass** (`0db6ce1` + `c0f800a`): Parameterised analyzer to accept `kind: mechanism|symptom|supplement` on stdin. Mechanism analyzer flagged 70 groups; 66 auto + 4 coach_eye. Applied 62 (5 absorbed-by-earlier-merge skips, all benign). **-126 mechanism files**. Top: leaky-gut (+6 incl. intestinal-permeability / impaired-gut-barrier), omega-3-omega-6-imbalance (+6), lps-endotoxemia (+5), dysbiosis-gut-microbiome-imbalance (+4), estrogen-enterohepatic-recirculation (+4), methylation-cycle-dysfunction (+4).
- **Symptom pass** (`1bf31a8` + `51f4d0f`): 97 groups flagged, 50 auto + 47 coach_eye, all 47 coach_eye reviewed manually. Net: 45 applied (incl. 6 partial with member drops), 23 dismissed. Big wins: depression-symptoms (+5), blood-sugar-dysregulation (+3), daytime-fatigue (+3), craving-salt (+2), elevated-* trio.
- **Supplement pass** (`401f3c3` + `51f4d0f`): 43 groups flagged, 13 auto + 30 coach_eye, all 30 coach_eye reviewed manually. Net: 22 applied (incl. 5 partial), 5 dismissed (betaine-tmg / folate-vs-methylfolate / ginger / phosphatidylcholine-vs-cdp-choline / turmeric-vs-curcumin all kept distinct).
- **Backlog sweep** (`8737527`): policy-B aggressive auto-triage over the regenerated mindmap-mined backlog (~1,275 candidates). 629 rejected (intervention prose 5+ words + composite-with-/&), 27 added (catalogue-already-has-it), 16 supplement-isolate aliases attached, 11 home_remedy stubs created (abhyanga, bhringraj-oil-scalp-massage, methi-coconut-hair-pack, neem-rinse, salted-lemon-water, etc.). 786 still open for /backlog UI manual triage.
- **Coach-reviewed cleanups summary**: 111 manual review decisions applied across 4 rounds (22 + 4 + 47 + 30 coach_eye groups). Roughly 200+ duplicate YAML files merged. **`scripts/classify-cleanup.py`** (`7a2ddf9`) auto-triages plan groups into auto/coach_eye/dismiss buckets via heuristics — read by `/catalogue/cleanup` UI to show triage badges.

Cleanup tooling polish:
- **`/catalogue/cleanup` auto-classify on analyze** (`2c9522e`): `analyzeCleanupAction` now invokes `classify-cleanup.py` automatically after the analyzer succeeds, so triage buckets render immediately without a shell step.
- **Apply-all-auto button + bucket badges** (`2a9ce34`): bulk-apply every auto-bucket merge in one click. Triage summary bar at top of /catalogue/cleanup.
- **Smart-merge no-downgrade** (`2e0bce9`): `_smart_merge` now preserves stronger `evidence_tier` and `Source.quality` — staged value only wins on tie/upgrade. Rank tables in `fmdb/ingest/staging.py`. `--overwrite` still wins for genuine downgrades.
- **Plan-checker alias-aware lookup** (`5ab512d`): supplement / cooking_adjustment / home_remedy slug checks now use `_resolve_index()` like topic/mech/symptom already did. `niacin-b3` (alias of `niacin`) no longer flagged as unknown. `supp_by_slug` lookup resolves canonical so downstream contraindication / interaction / form checks fire on aliased refs.
- **`monitor_symptoms` → `symptoms_to_monitor`** (`d6fd0d7`): Pydantic field name was `symptoms_to_monitor` but `protocol-template-picker.tsx` was writing `monitor_symptoms`. Read-time fallbacks dropped from `render-client-letter.py` (×2) + v2 catalogue page; the picker now writes the canonical key.

Mindmap library — 6 new curated maps (now 23 total, ~2,343 nodes, ~684 linked):
- `migraine.yaml` (`7f34cca`) — 126 nodes / 51 linked
- `ibs.yaml` (`7f58a00`) — 134 nodes / 46 linked
- `anxiety-panic.yaml` (`351770c`) — 177 nodes / 53 linked
- `acne.yaml` (`fcfdeab`) — 110 nodes / 41 linked
- `alopecia.yaml` (`17d5d96`) — 124 nodes / 61 linked
- `long-covid.yaml` (`5b085d0`) — 169 nodes / 77 linked
- All follow the 6-branch template (🔴 Clinical Presentation / ⚙️ Root Mechanisms / 🧬 FM Approach / 🛠 Interventions / 🎯 Coaching Goals / 📊 Labs to Track) and include India-context (methi/jeera/giloy/brahmi/jatamansi/abhyanga where clinically appropriate).
- **`/clients-v2/[id]/catalogue`** queries mindmaps by topic match (existing surface, no code change).

AI sanity check broadening + first hot-fire field test:
- **Two new categories** (`d1723a5`) — `sequencing` (supplement load relative to client tolerance, foundational-phase skipping, conflicting timing windows, continuous use of pulse-only items) and `regional_availability` (dietary_preference contradictions, foods_to_avoid re-appearing, India-specific scarcity → ghee/A2/sprouted-moong/methi-water/kashayams substitutions). `_client_snapshot()` now passes `dietary_preference / foods_to_avoid / non_negotiables / reported_triggers / city / country` to the model.
- **Field test on `geetika-plan-1`** ran clean: 3 critical / 7 warning / 2 info findings, all genuinely useful. Critical findings caught insulinoma+fasting+berberine safety risk (cross-section synthesis), berberine vs microbiome topic (cited catalogue claim slugs), niacin-b3 scope concern. Warnings caught omega-3 rationale claiming "supports T4→T3" (translation fidelity — not in catalogue), 8-supplement stack with no phasing (sequencing fired), duplicate lifestyle entries, ashwagandha + pending ANA caveat (read catalogue notes_for_coach). Regional-availability fired on Indian fish recommendation. **Production-ready.** First-call cost ~$0.10 with cache warmup; warm calls cheaper.
- **Two bugs surfaced + fixed during test**: (a) plan-checker supplement alias-aware bug (above), (b) cleanup-induced drift on 2 published plans (`liver-detoxification` topic deleted; `leaky-gut` topic deleted). Fixed by adding both as aliases on closest semantically-related still-existing topics (`metabolic-detoxification` and `autoimmunity-leaky-gut-triad`). All 5 published plans now 0 CRITICAL.

v2 Sessions tracking + Calendar:
- **Longitudinal tracking on Sessions tab** (`80ef27c`): new `V2TrackingCharts` wraps four v1 components in `FmPanel` chrome — `OutcomeProgressCard` (symptom burden + Five Pillars deltas), `ProtocolAdherenceChart` (supplement+practice status grid across check-ins), `IFMTrend` (7-node functional matrix across full assessments), `LabComparison` (side-by-side two health_snapshots). Each panel self-hides until its data threshold is met. Mounted via new `trackingChartsSlot` on `SessionsBrowser`. Design punchlist #16-19 closed.
- **`/calendar`** (`0bcf1a2`): month-view with 4 event types — 📋 sessions (every Discovery / Intake / Check-in / Quick note), 🔴 follow-up overdue (client.next_contact_date < today), 🟡 follow-up upcoming (≤7d), 🟣 plan recheck due (plan_period_recheck_date OR plan_period_start + plan_period_weeks×7). URL-driven via `?ym=YYYY-MM` for deep-linking. Day-cell chips deep-link to v2 sessions / overview / plan editor. Design punchlist #32 closed.

v1 retirement (almost-complete):
- **`/sources` retired** (`f4f2ccd`): page → redirect to `/ingest`; `source-client.tsx` + v1 `actions.ts` deleted (v2 ingest has its own copies).
- **`/search` ported to v2** (`2c9522e`): moved from `src/app/search/` → `src/app/(v2)/search/`. Wrapped in `FmAppShell`. Internal links updated to v2 paths.
- Already-redirected at session start: `/clients`, `/clients/[id]` (with ?tab=X mapping), `/plans` (list), `/plans/[slug]` (with slug→client_id lookup), `/plans/new`, `/assess`, `/dashboard-legacy`.
- **Only v1 surface still serving real UI: none.** All page-level routes either retired or redirect. Shared component files under `src/app/clients/[id]/*.tsx` (pre-session-brief, health-trends, lab-comparison, outcome-progress-card, lab-reference-ranges, etc.) remain as a UI library imported by v2. Moving them to `src/components/` or `src/lib/` is a mechanical refactor that doesn't change behaviour.

Other:
- **`Supplement.aliases` first-class field** (`1fd58bf` + `d9f606c`): Pydantic model added the field; validator now checks supplement alias collisions; 15 aliases promoted from `notes_for_coach` "Also known as:" stashes (amla / giloy / jatamansi / pqq / gotu-kola / curry-leaves / bhringraj) + brahmi → bacopa-monnieri, methi → fenugreek, tulsi → holy-basil. Resolution verified: methi→fenugreek, tulsi→holy-basil, brahmi→bacopa-monnieri, etc.
- **54 catalogue stubs** (`8cf6d7b`) from the mindmap-agent missing-slug shortlist: 14 symptoms (oily-skin, parosmia, derealization, etc.), 9 mechanisms (cortical-spreading-depression, mast-cell-activation, microclot-formation, viral-persistence, POTS, etc.), 12 supplements (feverfew, butterbur, nattokinase, passionflower, bhringraj-as-supplement, etc.), 19 lab_tests (mthfr-genetics, comt-genetics, hrv, active-stand-test, organic-acids, d-dimer, fibrinogen, EBV panel, etc.).
- **Plant-Derived Adaptogens coach knowledge ingest** (`937d6a9`): 12 new claims + GABAergic-modulation mechanism + ashwagandha/ginseng/reishi/gotu-kola enrichments from a Coach Knowledge `/ingest` session.
- **Settings page reads `fm-database/.env`** (`a8d37ee`): new `envVarSet()` / `envVarValue()` helpers check both `process.env` (Next's `.env.local`) AND the dotenv file at `fm-database/.env` (where Python shims read `ANTHROPIC_API_KEY` from). All 6 integration chips now reflect real end-to-end state.
- **Broadcast panel default-collapsed** (`a8d37ee`): start `open=false` — broadcast is a deliberate action, not a default surface.
- **`storage.py` WARN prints → stderr** (`e7cdf10`): `print(f"WARN: skipping {p}: {e}")` in `fmdb/plan/storage.py` (×4) + `fmdb/resources/storage.py` (×1) were writing to stdout, poisoning shim JSON output (TS shim captures stdout for `JSON.parse`). Both files now `import sys` + use `file=sys.stderr`. Surfaced because coach hit "Unexpected token 'W', \"WARN: skip\"... is not valid JSON" toast on the v2 client overview rework-suggestions panel.
- **apply-rework itemized change log** (forthcoming commit): `scripts/apply-rework.py` now records every applied change in `applied_log: list[str]` and prepends the list to `plan.notes_for_coach` alongside the rationale block. Coach sees the whole change set at the top of a reworked plan instead of hunting per-section for `[rework]` tags. Format: `  + supplement n-acetyl-cysteine — Add NAC 600–1000 mg daily` per line.

Operational state at end of session:
- Catalogue (after ALL cleanups): topics ~284 / mechanisms 299 / symptoms 278 / supplements 246 / sources 82 / claims 1494 / cooking_adjustments 3 / home_remedies 14 (was 3, +11 from backlog) / mindmaps 23 (was 17, +6) / protocols (5r-gut-protocol, liver-detox-support, etc.) / lab_tests ~50 (+19 stubs). Validator: 0 errors, ~1637 non-blocking warnings.
- Backlog: 786 open / 629 rejected / 27 added (file at `fm-database/data/_backlog.yaml` is gitignored — regenerable via `fmdb mindmap-mine --add-to-backlog`).
- Plans on disk: 5 published, all 0 CRITICAL after cleanup-drift fix. Archana's rework draft `archana-rework-2-2026-05-13-cl-007-2` has the [rework] tags per supplement; future reworks will also get the itemized notes_for_coach log.
- 4 mechanism + 47 symptom + 30 supplement coach_eye groups all manually reviewed and resolved this session.

**Deferred to 3-6 month future development** (per coach):
- **HeyGen avatar video generation** for client educational explainers (script tested on insulin-resistance, free-tier credits exhausted, needs $24/mo Creator plan upgrade to batch-produce ~12 condition videos).
- **NotebookLM batch** for longer-form audio/video deep-dives per common condition (manual UI workflow — checklist of 12 topics ready in earlier handover).
- **JSON export contract for Project 2** (client mobile app).
- **VitaOne order-through-coach** (awaiting their partner support reply since 2026-05-09).

---

**v0.66** — 15-commit coach-UX hardening pass + /assess major upgrade + form draft persistence:

Workflow & client lifecycle:
- **🤝 Engagement step** between Discovery and Intake. New `engagement_status` field on `client.yaml` (`pending | signed_up | declined`). 7-step journey strip: Discovery → **Sign-up** → Intake → Plan active → Week N → Next phase letter → Plan completion. Sign-up step shows amber "decide?" callout above FmClientHeader when discovery is done but undecided. 3-button picker (✅ Signed up / 🤔 Still deciding / 🚫 Declined). Declined flips downstream steps to N/A. Compact pill row in right column lets coach flip the decision anytime. `deriveStage` reads sessions + engagement to produce smarter banner copy ("Awaiting sign-up confirmation" / "Discovery done · schedule intake" / "Intake captured · draft a plan" / etc.) instead of generic "Run a Discovery or Full Assessment".
- **Auto-write Discovery session on new-client creation.** If the coach captures any discovery-shaped content in the new-client form (conditions, goals, dietary preference, family history, five pillars, timeline events, etc.), `createClient` now writes a real `discovery` session YAML under `clients/<id>/sessions/`. Dated to the client's `intake_date`. Closes the "I entered the discovery info but Sessions tab is empty" gap. Best-effort — never rolls back the client.
- **Session date prefilled to today, coach-editable** on all 5 session forms (discovery / intake / check-in / quick-note / full assessment). Default `new Date().toISOString().slice(0,10)`; coach can override if logging a past call. `session_date` flows through `saveSessionAction` → `save-session.py` → session YAML.
- **"Last contact" cascade fixed.** Was taking max(newest session, intake_date, created_at) which made created_at win for fresh clients. Now strict priority: newest session.date → else intake_date → else "Never". Sudarshan's call dated 5 May 2026 now reads that, not the system clock when his YAML was written.
- **Identity editor moved into FmClientHeader.quickActions** ("✏️ Edit identity" button right under the client name). Inline panel for display_name, DOB, sex, mobile, email, city/state/country. Save writes via the extended `updateClientProfile` (now accepts 8 identity fields + 5 dietary memory fields) and revalidates all v2 routes. Fixes the "Sudarshan vs Sudarshan Karnad" name typo flow.

/assess (Full Assessment) UX overhaul:
- **Auto-collapsing input steps.** New `FmCollapsibleStep` primitive wraps each input section. Once filled, the section collapses to a 1-line summary chip ("✓ 🎯 Symptoms + conditions · 4 symptoms · 3 topics picked"). Click to expand. State persists per-step per-client to localStorage. Wraps sections 1–4 (intake recap, symptoms+conditions, what's new since, prior protocol review). `rightSlot` passes through so "✏ Edit on Intake" link survives.
- **Δ Delta chip** at the top of synthesis results. Three pills: ▲ N new (red), ▼ N resolved (green), → N carrying over (neutral). Compares this session's `symptoms` state vs the most recent prior session's `selected_symptoms`. Hover for full list. Only renders when there's a prior session.
- **✨ AI's read** — one-sentence headline extracted from `synthesis_notes` first sentence, rendered in big Libre Baskerville serif at the very top so the coach sees the synthesis before drilling into details.
- **🩺 Differential view** — top-3 LikelyDriver entries sorted by rank, each as a collapsible card with coloured rank badge + humanised mechanism name + ATM-role chip + confidence bar (95/75/55% derived from rank). Click to expand reasoning + chain_evidence + supporting_evidence bullets.
- **✅ Action queue summary bar** — sticky bar at the bottom of SuggestionsView. "N of M selected · [☑ Select all] [☐ Clear all]" plus per-category chips (Drivers 3/3, Topics 4/4, Lifestyle 2/3, Supplements 5/7…) with mini ☑/☐ buttons to flip whole categories at once. Generate-draft-plan button now reads "📝 Generate draft plan from N selections" instead of generic label.
- **📁 Prior-transcript picker** on Uploads card. New `listClientFilesAction` server action lists `~/fm-plans/clients/<id>/files/`. UI is a collapsible list of files (newest first) filtered to transcript-like extensions; "Use this" attaches the file via the same `extractTranscriptAction` pipeline as a fresh upload. Saves re-uploading the same transcript across sessions.

Plan + draft surface:
- **🧠 Plan-conflict panel** on `/clients-v2/[id]/plan`. Rules-based detector (`lib/fmdb/plan-conflicts.ts`) catches 5 contradiction types: lactose-free + dairy in non-negotiables (one-click "Switch to almond milk" rewrite) / vegan + animal product in non-negotiables / Jain + roots / allergy in non-negotiables (critical) / same food in foods_to_avoid AND non-negotiables. Each conflict has optional 💡 Suggestion → ✓ Apply patches client.yaml + refreshes. Whitelist of patchable fields blocks auto-editing medications/allergies.
- **`notes_for_coach` structured markdown.** Wall-of-text → 5 H2 sections (## Why this plan · ## Key drivers identified · ## Why these supplements · ## What to monitor · ## Coach reminders) with single-level `-` bullets. Prompts updated in 3 places: `fmdb/assess/suggester.py` (synthesis_notes description in the tool schema), `scripts/generate-draft.py` (the notes_for_coach assembly step uses H2 prefixes), `scripts/plan-chat.py` (rewrite enforcement on update_plan tool). No render-side changes — existing markdown renderers handle H2 + bullets already.
- **🧠 Memory panel** on client Overview (`ClientMemoryPanel`). Five dietary/lifestyle fields the plan-chat AI appends to over time (🥗 Dietary preference / 🚫 Foods to avoid / 💖 Won't give up / ⚠️ Reported triggers / 🧬 Family history). Each card inline-editable. Header chip shows "N/5 learned". Bridges the plan-chat "👤 saved to profile" one-time chip into a permanent at-a-glance view.

Forms + data integrity:
- **`useFormDraft` reusable hook** + `FmFormDraftClear` ✕ button. Drop-in localStorage auto-save for any form: snapshots every state value on every change, hydrates on mount (with "📋 Restored your in-progress draft" toast), clears on confirmed-ok save or explicit Clear-all (two-click confirm). Applied to new-client, intake, discovery, info-pack, check-in, quick-note forms. Coach can refresh / close tab / hit 404 / lose network — form data survives.
- **Intake transcript parser → tool_use.** `extract-client-from-transcript.py` was hitting `json.JSONDecodeError` on long transcripts (Sudarshan's `.md` broke at char 7482 — malformed JSON mid-string). Switched from text-JSON parsing to Anthropic's tool-use API with full schema validation. Output is structurally guaranteed valid; max_tokens bumped 8K → 16K. Fallback path included if tool_choice is somehow ignored.
- **New-client form 404 fix.** `createClient` revalidates `/clients-v2` + `/clients-v2/<id>` + sub-routes (was only `/clients`). Plus localStorage backup so 15-min intake-form sessions never get wiped by a redirect race.

Other:
- **Client-scoped Catalogue tab** at `/clients-v2/[id]/catalogue`. Replaces the old shortcut to global `/catalogue`. Shows only the entries this client touches: Topics from `active_conditions`, Mechanisms from active plan's `likely_drivers`, Symptoms from `tracking.monitor_symptoms`, Supplements from `supplement_protocol`, Healing programs from `attached_protocols`, Mind maps that reference this client's conditions. Free-text conditions that don't resolve flagged in a "❓ Not yet in catalogue" strip. Each card → links out to global detail.
- **Catalogue cleanup plan re-run** — Haiku scan against all 318 Conditions queued 46 groups in `fm-database/data/_cleanup/latest_plan.yaml`: 34 duplicates / 4 topic→protocol / 4 topic→mechanism / 4 topic→symptom. Coach reviews + applies via `/catalogue/cleanup`. Top picks: `5r-gut-protocol` (4-way merge), `gut-barrier-dysfunction` (4-way leaky-gut consolidation), `autoimmune-thyroiditis`, `adrenal-fatigue`, several vitamin/mineral deficiency dupes.

15 commits, type-clean throughout, PM2 stable. Branch: `claude/setup-fm-coach-laptop-7GFhK` (HEAD `9a3ee94`).

**v0.65** — Doctor-view redesign + 18 new FM markers + sticky header + per-client AI spend tracker + Plan tab cleanup + a lot of robustness fixes:

- **🩺 `/assess` 2-column doctor layout** — left column: session inputs (steps 1-5 + Five Pillars + Analyze button). Right column: FM markers (top) → Prior sessions → Mind-map pathways → AI synthesis. Uploads visually pushed to the bottom of left column via CSS `order` (source order kept workflow-natural so upload-driven state populates pickers above). iPad-portrait collapses to single column.
- **📌 Sticky Analyse header** (embedded / client-page mode only): `👤 name · sex/age · BMI (Asian-Pacific thresholds) · BP last · weight · last visit ("12 days ago") · plan slug + status badge · readiness chip`. Backdrop-blurred, `position: sticky`, hidden on standalone `/assess`. Threads measurements via the existing `priorSnapshots` prop; new `activePlan` prop wired from client-tabs.
- **📊 18 new FM markers / ratios in `compute_ratios`**:
  - Metabolic & Insulin: postprandial glucose, glucose excursion (PP − fasting), 1-hour glucose (OGTT)
  - Cardiovascular & Lipids: ApoB, ApoB/ApoA1, Lp(a), AIP (atherogenic index of plasma)
  - Iron & Blood (CBC pattern): RDW, MCH, WBC, platelets, NLR (computed)
  - Kidney: UACR (microalbuminuria)
  - Nutrients: Omega-3 Index, C-peptide, Vitamin K2 (MK-7), MMA (functional B12), LH/FSH ratio
  - **Magnesium serum vs RBC discrimination** fixed: previous regex `\bmagnesium\b|serum magnesium|rbc magnesium|mg\b` collapsed both biomarkers into one row using serum-range thresholds. Now two distinct markers with their own ranges; serum pattern uses `^(?!.*rbc)(?!.*red.cell).*\bmagnesium\b` lookbehind so it can never absorb an RBC value.
- **🧮 9 CBC pattern detectors in `ifm-matrix.ts:detectLabPatterns`**: iron deficiency by MCV+RDW (catches before ferritin drops), macrocytic by MCV+Hgb (B12/folate), mixed deficiency (normal MCV + high RDW), bacterial pattern (WBC + neutrophils), viral / suppression (low WBC + low neuts or lymphs), lymphocytosis, eosinophilia, reactive thrombocytosis, full iron-studies pattern (Fe + TIBC + TSAT + ferritin).
- **🔍 Pre-flight subgraph readiness banner** above the Analyze button. New `scripts/peek-subgraph.py` shim (no API call) takes selected symptoms + conditions, builds the same subgraph the real synthesise would, returns counts per kind + verdict (`rich` / `moderate` / `thin` / `empty`) + unmatched-slug list. Debounced 350ms effect in AssessClient refreshes the banner as the coach picks symptoms / conditions.
- **🕰 Post-intake Timeline editor** on the client Overview tab. Inline row editor (year + event + category + remove) for `client.timeline_events`. Clients keep remembering events later ("glandular fever at 17") — coach adds them as they come up. 7 categories. Sorted by year ascending in display. Save button surfaces when dirty.
- **🔬 Conditions in play / Conditions rename** completed across the Analyse panel (was missed in v0.64): card titles, step 4 label, placeholder text, session row summary, validation toast, page subtitle. `prettyKindSingular()` helper maps internal singular kinds to coach labels via `kindLabel()`.
- **📐 Imperial units in measurements** form. Top-right `cm/kg ↔ in/lbs` toggle (persisted per coach in `localStorage 'fmcoach_units'`). Height / Weight / Waist / Hip rows convert on input/display only — storage stays metric (cm/kg). Bonus: live-computed BMI (Asian-Pacific thresholds: 23 overweight, 25 obese) + W:H + W:Ht ratios shown under the inputs.
- **📋 Plan tab cleanup**: external reports moved to Overview (`📁 Other reports & specialist uploads` collapsible next to per-kind upload panels). Client letters now visible for ALL plan states (draft/ready get an amber note about activation locking the version). Plan tab subtitle: "Active plan status · edit the protocol · activate when ready · generate & share client letters · review older plans".
- **🛠 `auto_fix_plan_routing(plan, catalogue)`** in `fmdb/plan/checker.py`. Mutates plan in place: any slug in `primary_topics` / `contributing_topics` that's NOT a topic but IS a mechanism gets moved to `hypothesized_drivers` with an auto-routed reasoning line. Wired into both `submit_plan` and `publish_plan` BEFORE plan-check runs; if fixes were made, `write_plan(root, plan)` persists the corrected draft. Heals legacy plans + AI mistakes ("leaky-gut" referenced as topic when only mechanism exists). No more permanent un-activatable plans.
- **🩹 `generate-draft.py` slug guard**: when copying AI's `topics_in_play` into the draft Plan, slugs are now validated against the alias-aware catalogue indices. Topic → `primary/contributing_topics`. Mechanism → `hypothesized_drivers` (with reasoning). Neither → silently dropped (catalogue-additions-suggested already captures these). Drivers de-duplicated so a slug appearing in both `likely_drivers` and `topics_in_play` isn't double-added. Same guard applied to the resolved_template path.
- **📊 Letter generation progress bar** in `SendPackageButton`. Per-type elapsed timer + phase indicator (Loading → Building prompt → Calling Sonnet → Still streaming → Taking longer than usual → Unusually slow). Progress bar capped at 95%. `render-client-letter.py` emits `[render-letter] <step>` stderr markers with `flush=True` at every phase boundary, and now iterates `stream.text_stream` so we get a per-chunk heartbeat instead of one silent 1–3 min wait. Timeout bumped from 240s → 600s (10 min). Indistinguishable-from-a-hang behaviour eliminated.
- **💰 Per-client AI API spend tracker** on the Overview tab (MIS / pricing tool). New `fmdb/usage.py` module with `PRICING_USD_PER_MTOK` table + `log_usage(client_id, script, model, usage, notes)` that appends one JSONL line to `~/fm-plans/clients/<id>/_api_usage.jsonl`. Wired into 10 scripts: assess.py, chat.py, render-client-letter.py (main + validator), refine-letter.py, extract-symptoms.py (client_id inferred from path), parse-functional-test.py, parse-genetic-report.py, parse-health-text.py, extract-client-from-transcript.py (unattributed — intake), draft-followup-message.py. `ApiUsagePanel` component reads + aggregates; shows all-time spend, this-month spend, input/output tokens, spend by feature, spend by model, recent 20 calls. `FMDB_USD_TO_INR` env var (default ₹85) controls INR conversion. Coach can now see "Hariharan: ₹147 across 12 sessions" and price the service accordingly.
- **🩺 Defensive `weight_loss` coercion** in `render-client-letter.py` main(): `weight_loss = payload.get("weight_loss") if isinstance(payload.get("weight_loss"), dict) else {}`. Plus a try/except wrapping `_build_prompt` that catches and surfaces the exact failing line in the error JSON (`Failed to build {letter_type} prompt (weight_loss=set|none): TypeError: ...\n{last 6 traceback lines}`). Sonnet model alias bumped to `claude-sonnet-4-6` across render-client-letter, refine-letter, render-topic-brief.
- **🐛 Bug fixes**:
  - `TypeError: sequence item 0: expected str instance, dict found` on `', '.join(tracking_habits)` — added `_stringify_habit()` + `_stringify_list()` helpers that handle bare strings / `{name, cadence}` / dict-of-anything; same fix applied to lifestyle_practices. Plus fixed silent latent bug: `tracking.get("monitor_symptoms")` always returned `[]` because the Pydantic field is `symptoms_to_monitor`. Now reads both for compat.
  - `synthesize() crash on empty year`: AssessSuggestions `IFMTimelineEvent.year` / `.age_at_event` rejected `""` (empty string) from the AI. Added `field_validator(mode="before")` that maps `""` → `None` for these int fields.
  - `Assess` skip lab re-extraction when file already in a prior snapshot. `attachExistingFile()` takes opt `force` flag. Files marked `✓ prior · <name>` skip the Haiku call; ♻️ button forces re-extraction.
  - Sex-aware mindmap pathways filter — Hariharan no longer sees PCOS pathways. New `SEX_SCOPED_MINDMAPS` in `loader-extras.ts`.
  - Mindmap pathway sorting improved beyond raw match count — `score = (symptom_matches × 2 + topic_matches) × (1 + 1 / log10(map_size + 10))` weights symptoms over conditions and density over raw count.
- **🚀 `bootstrap-new-mac.sh`** — one-shot setup for a fresh Mac: checks brew/git/python/node prereqs, clones repo if needed, creates Python venv + pip install, prompts for ANTHROPIC_API_KEY into `fm-database/.env`, then hands off to setup-laptop.sh for npm install + build + pm2 + .env.local prompts.

**v0.64** — Catalogue cleanup tool + coach-friendly entity labels + .md uploads on every report panel:

- **🧹 Catalogue cleanup tool** (`/catalogue/cleanup`) — Haiku scans all 318 Conditions in a single call (~$0.05, ~1–2 min) and returns a structured cleanup plan with 4 group kinds: `duplicate_topics` (same concept, different slugs), `topic_is_protocol` (5R/AIP/Whole30/elimination-diet stuck under topics), `topic_is_mechanism` (HPA-axis-style drivers), `topic_is_symptom`. Each group has a canonical slug + members + reason. Plan persisted to `fm-database/data/_cleanup/latest_plan.yaml` so it re-loads on page refresh without re-running the API call.
  - **`scripts/analyze-catalogue-duplicates.py`**: streaming Haiku call with structured tool-use. Loads all topics + protocols/mechanisms/symptoms slug+display lists as reference context (~15K input tokens). Conservative system prompt — only flags clear cases; tells the model to leave true conditions alone.
  - **`scripts/apply-cleanup.py`**: applies one group atomically.
    - Duplicate merge: unions aliases into canonical, **adds each member slug as an alias on canonical** (so existing plan/session references still resolve via the alias-aware validator), unions sources, deletes other YAMLs.
    - Cross-kind merge (`topic_is_X`): same alias-preserving merge into the target Protocol/Mechanism/Symptom.
    - **Auto-routing**: if `kind=duplicate_topics` but the canonical doesn't exist in `topics/`, checks `protocols/` / `mechanisms/` / `symptoms/`. If found, auto-promotes to `topic_is_<kind>` and drops the canonical from the members-to-remove list. (Handles the common case where Haiku picks `5r-gut-protocol` as canonical for three duplicate 5R topics.)
    - **Opt-in stub creation**: if the target Protocol/Mechanism/Symptom doesn't exist, returns `{needs_stub: true, target_kind, target_slug}`. UI prompts coach to confirm; on confirm, builds a minimal valid stub from the first member topic's `display_name` + `summary` (category=`other`, evidence_tier=`fm_specific_thin`, `notes_for_coach` reminder to flesh out fields), then proceeds with the merge.
  - **`/catalogue/cleanup` page**: groups colored by kind (amber/violet/blue/rose). Each group: italic reason, canonical slug (editable inline), kind selector (editable inline so coach can switch `duplicate_topics` ↔ `topic_is_protocol` ↔ etc. without re-running analysis), member chips linking to `/catalogue/topics/<slug>`. Apply / Dismiss buttons. Re-run analysis any time.
  - **New files**: `fm-database-web/scripts/{analyze-catalogue-duplicates,apply-cleanup}.py`, `fm-database-web/src/app/catalogue/cleanup/{page,cleanup-client,actions}.tsx`. Sidebar: 🧹 Cleanup link added under Catalogue.

- **🏷️ Coach-friendly entity labels (UI only)** — internal taxonomy stays Topic/Mechanism/Symptom/Claim/Source/etc. but the UI now reads:
  - Topics → **Conditions** 🩺 (Hashimoto's, PCOS, perimenopause)
  - Mechanisms → **Root causes** 🧬 (HPA axis dysregulation, leaky gut)
  - Symptoms → **Symptoms** 🤒 (unchanged)
  - Supplements → **Supplements** 💊 (unchanged)
  - Protocols → **Healing programs** 🏥 (5R gut, AIP, Whole30)
  - Titrations → **Dose schedules** 📈
  - Lab panels → **Lab panels** 🧪 (unchanged)
  - Lab tests → **Lab markers** 🔬 (TSH, ferritin)
  - Claims → **Evidence notes** 📚
  - Sources → **References** 📖
  - **Single source of truth**: `src/lib/fmdb/kinds.ts` with `KIND_LABELS` (plural/singular/description/emoji per kind). Helpers `kindLabel()` + `kindEmoji()`.
  - **Surfaces updated**: `/catalogue` tabs (now show emoji + plural + per-tab one-line description), `/catalogue/[kind]/[slug]` (kind singular breadcrumb above heading), `/catalogue/cleanup` KIND_META + dropdown, `/search` result section headings + chip labels.
  - **Catalogue table polish**: name-first layout (slug demoted to small mono subscript). Drops the redundant Slug column.

- **📄 .md/.txt uploads on every report panel** — coach can use any external AI to convert specialised reports (PDFs, scanned forms, screenshots) into clean markdown, then drop the .md straight into the dashboard. Bypasses lossy PDF extraction + plays nicely with reports already summarised externally.
  - Frontend: `accept` attribute extended on `lab-upload-panel`, `functional-test-panel`, `transcript-update-panel`, `genetic-report-panel`, `new-client-form` (intake transcript). Helper labels updated.
  - Backend: `parse-functional-test.py` + `parse-genetic-report.py` detect `.md`/`.txt` by suffix, read as text, and send as a single text content block instead of a base64 PDF document attachment. PDF path unchanged. `extract-symptoms.py` and `extract-client-from-transcript.py` already handled non-PDF as text.

**v0.63** — FM physician-tier upgrade: protocols, ATM triad, drug depletions, DUTCH/GI-MAP, titration schedules, lab tests/panels, inline ranges, letter QA, PM2 env fix:

Covers PRs #33–#37 (merged to main) + current branch work:

- **🏥 Protocol catalogue entity** (`fmdb/models.py`): 11 seed protocols (5r-gut, autoimmune-paleo-aip, whole30, low-fodmap, weight-loss-metabolic-reset, adrenal-recovery, liver-detox-support, cycle-sync, anti-inflammatory-reset, mitochondrial-support, blood-sugar-regulation). Fields: `phases`, `indications`, `foods_to_emphasise/remove`, `supplements_typically_used`, `prerequisites`, `recommended_followup`, `incompatible_with`, `expected_outcomes`, `cautions`. `attached_protocols: list[str]` on Plan — flows into all 5 letter generators as spine constraint.
- **🔢 11-factor weighted protocol scoring** (`fmdb/assess/results.py`): `FactorScores` Pydantic model (11 fields × weight). `compute_fit_percent()` computes Python-side weighted %. AI returns per-factor 1–5 scores; server computes `fit_percent`. UI shows top-2 protocols with color-tiered % (≥80 emerald, 65–79 amber, <65 red) + 11-factor breakdown disclosure.
- **🧠 ATM Triad cascade** (`suggester.py` + `assess-client.tsx`): drivers classified as antecedent / trigger / mediator / expression with `parents` (upstream mechanism slug refs) + `chain_evidence`. UI groups into 4 color-coded buckets (🧬 purple / ⚡ amber / 🔁 blue / 🩺 rose).
- **💊 Drug-nutrient depletion catalogue**: 13 `DrugDepletion` entities (levothyroxine, metformin, PPIs, statins, OCPs, SSRIs/SNRIs, beta-blockers, thiazides, methotrexate, corticosteroids, aspirin, ACE/ARBs, antibiotics). Fields: `drug_aliases`, `drug_class`, `depletes` (list of `NutrientDepletion` with severity + timing separations + monitoring labs), `contraindicated_supplements`. `MedicationImpactPanel` (`medication-impact-panel.tsx`) in client Overview.
- **🧪 DUTCH + GI-MAP PDF parser** (`scripts/parse-functional-test.py`): Sonnet with document attachment + structured tool-use. Test-type detection via keyword scan. `FunctionalTestPanel` (`functional-test-panel.tsx`) in client Overview — upload PDF → findings persisted to `~/fm-plans/clients/<id>/functional_tests/<type>-<date>.yaml`.
- **💊 7 titration protocols** (`TitrationProtocol` entity): ashwagandha-adrenal-slow-ramp, berberine-blood-sugar-meal-titration, magnesium-glycinate-bedtime, nac-detox-glutathione-ramp, vitamin-d-loading-then-maintenance, l-glutamine-gut-repair-ramp, betaine-hcl-challenge. Integer whole-unit steps (India = no compounding pharmacies). `available_at` field (vitaone / amazon-india / iherb).
- **🔬 LabTest entity** (25 seeded): both `conventional_low/high` + `fm_optimal_low/high` ranges, `aliases` list, interpretation, `typical_cost_inr`. **7 LabPanel** entities: fm-general-baseline, hashimoto-workup, perimenopause-workup, insulin-resistance-pcos-workup, fatigue-workup, cardiovascular-risk-workup, inflammation-workup.
- **🎯 Inline FM-vs-conventional ranges on health-trends**: `findCatalogueLabTest()` bidirectional substring matcher. 4-state dot: 🟢 FM optimal, 🟡 in conventional but outside FM optimal (the FM gap signal), 🔴 outside both, null. `rangeBlock` shows "FM: X–Y · conv: A–B". Per-client override FIRST, catalogue fallback SECOND.
- **🤰 Pregnancy/lactation safety**: `PregnancySafetyPanel` (`pregnancy-safety-panel.tsx`) loads supplements from active plans, matches `pregnancy_safety`/`lactation_safety` from catalogue. `pregnancy_status` + `pregnancy_due_date` + `lactation_started` on Client model. `SafetyStatus` + `PregnancyStatus` enums.
- **📈 IFM Matrix all-sessions sparklines** (`ifm-trend.tsx`): 2 sessions → side-by-side bars+delta; 3+ sessions → per-node SVG sparklines with first→last endpoints color-coded.
- **📝 SOAP note panel** (`soap-note-panel.tsx`): S/O/A/P format on client Overview. Collapsible + Print/Save PDF. `@media print` isolates `#soap-print-root`.
- **✅ Haiku letter QA pass** (`render-client-letter.py`): after Sonnet generation, `_validate_letter_specificity()` scores each tip 1–5 for client-specificity, rewrites any < 3. `validation_report` persisted as `{stem}.validation.json` sidecar alongside `.md`/`.html`. Surfaced in the UI via `loadMealPlan`.
- **🖨 Doctor-shareable session brief** (`session-brief-modal.tsx`): `clientConditions` + `clientMedications` shown in 2-col block; hand-off note textarea (no-print in screen view, print-only via `.brief-print-only`). Print button labelled "🖨 Print / Save as PDF".
- **🔧 PM2 env fix** (`ecosystem.config.js`): loads `.env.local` via `require("dotenv").config(...)` before exporting app config; spreads `process.env` into app env. AISENSY_API_KEY, GMAIL_USER, GMAIL_APP_PASSWORD now available to the Next.js process under PM2. `.env.local.example` documents all required vars (gitignore carve-out via `!.env.local.example`).
- **New Python models**: `Protocol`, `ProtocolPhase`, `NutrientDepletion`, `DrugDepletion`, `TitrationStep`, `TitrationProtocol`, `LabTest`, `LabPanel`. New enums: `ProtocolCategory`, `DrugClass`, `DepletionSeverity`, `LabPanelCategory`, `SafetyStatus`, `PregnancyStatus`. `attached_protocols` on Plan, `pregnancy_status/due_date/lactation_started` on Client.
- **New TS types**: `Protocol`, `ProtocolPhase`, `TitrationStep`, `TitrationProtocol`, `LabTest`, `LabPanel`, `NutrientDepletion`, `DrugDepletion`, `SafetyStatus`, `PregnancyStatus`, `FactorScores`, `FACTOR_WEIGHTS`, `FACTOR_LABELS`. `ProtocolSuggestion` now has `factor_scores + fit_percent` (not `fit_score`). `LikelyDriver` has `atm_role`, `parents`, `chain_evidence`.
- **New scripts**: `scripts/parse-functional-test.py`
- **New UI files**: `src/app/clients/[id]/soap-note-panel.tsx`, `src/app/clients/[id]/pregnancy-safety-panel.tsx`, `src/app/clients/[id]/medication-impact-panel.tsx`, `src/app/clients/[id]/functional-test-panel.tsx`
- **New actions** in `clients/actions.ts`: `checkMedicationImpactsAction`, `parseFunctionalTestAction`, `loadFunctionalTestsAction`, `checkPregnancySafetyAction`, `loadLabTestsCatalogueAction`

**v0.62** — Lab reference ranges + custom protocol templates + AiSensy broadcast + message templates + session brief quick note:

- **🔬 Lab reference ranges** (`lab-reference-ranges.tsx`): `LabReferenceRangesEditor` collapsible card in client Overview. 14 FM optimal defaults (TSH 1–2, Vit D 60–80, Ferritin 70–150, hsCRP 0–0.5, HOMA-IR 0–1.5, etc.). Table with Marker/Low/High/Unit/Remove columns. "📋 Load FM defaults" button. Saves via `saveLabReferenceRangesAction` → `client.yaml`. `health-trends.tsx` shows 🟢/🔴 dot + "optimal: X–Y unit" next to each metric using `rangeStatus()`.
- **💾 Custom protocol template saving** (`lifecycle-panel.tsx`): "💾 Save as template" section in Lifecycle tab (published plans only). Name/description/tags inputs → `saveAsTemplateAction` copies topics/symptoms/supplement_protocol/lifestyle_practices/nutrition to `~/fm-plans/custom_templates/{slug}.yaml`. `loadCustomTemplatesAction` in assess actions. Assess page shows "⭐ Your templates" section above built-in grid (purple/indigo accent, `custom:{slug}` prefix).
- **📢 AiSensy broadcast panel** (`broadcast-panel.tsx`): new "📢 Broadcast" collapsible panel on dashboard (visible when `AISENSY_API_KEY` set). Recipient modes: follow-up due / recheck due / all active / custom checkboxes. Campaign name + 3 `{{param}}` inputs. Live preview. `broadcastAction` in `api/aisensy-webhook/actions.ts` normalises phone to E.164, POSTs to AiSensy direct API (`backend.aisensy.com/direct-apis/t1/create-message`). Returns `{sent, failed, errors[]}`.
- **💬 Message templates library** (`message-templates-panel.tsx`): "💬 Send message" collapsible card in client Overview. 2-col grid by category. `{{variable}}` auto-detection. `{{name}}` auto-fills from client. 📋 Copy + 📤 Send (via AiSensy direct API) buttons. + Add template form + delete per template. Backed by `~/fm-plans/message_templates.yaml` (5 defaults written on first load: `fm_checkin_nudge`, `fm_lab_reminder`, `fm_session_confirm`, `fm_supplement_instructions`, `fm_encouragement`).
- **📝 Quick note from session brief** (`pre-session-brief.tsx`): `QuickNoteWidget` at bottom of pre-session brief modal. Source chips (Coach observation / Pre-session thought). 3-row textarea + Save. Calls `saveSessionAction` with `[source: pre_session_brief]` tag. Auto-fades "✓ Saved". Modal stays open.
- **New files**: `src/app/clients/[id]/lab-reference-ranges.tsx`, `src/app/api/aisensy-webhook/actions.ts`, `src/app/broadcast-panel.tsx`, `src/app/clients/[id]/message-templates-panel.tsx`
- **Modified**: `src/app/clients/actions.ts` (saveLabReferenceRangesAction, loadLabReferenceRangesAction, LabReferenceRange types), `src/app/clients/[id]/health-trends.tsx` (rangeStatus, refRange prop), `src/app/plans/[slug]/actions.ts` (saveAsTemplateAction), `src/app/assess/actions.ts` (loadCustomTemplatesAction, CustomTemplate interface), `src/app/assess/assess-client.tsx` (custom templates section), `src/app/plans/[slug]/lifecycle-panel.tsx` (save as template section), `src/app/clients/[id]/pre-session-brief.tsx` (QuickNoteWidget), `src/app/page.tsx` (BroadcastPanel, followUpDueIds/recheckDueIds/activeIds), `src/app/clients/[id]/client-tabs.tsx` (MessageTemplatesPanel)

**v0.61** — Supplement interaction checker + recheck reminder + protocol diff + session brief modal:

- **⚠️ Supplement interaction checker** (`plan-editor.tsx` + `actions.ts`): on mount, `checkSupplementInteractionsAction(planSlug)` loads plan + client YAML, reads each supplement's catalogue YAML, does case-insensitive substring match of medications vs contraindications. Amber warning banner with `⚠ N interactions` badge in Supplements section header. Returns `{ok, interactions: [{supplement_slug, supplement_name, contraindication_text, matched_medications[]}]}`.
- **🔔 Recheck reminder on dashboard** (`page.tsx`): `computeSignal` now derives recheck date from `plan.created_at + plan_period_weeks × 7 days` when no explicit `plan_period_recheck_date`. Surfaces in dashboard triage sections as overdue/upcoming recheck signals.
- **📋 Protocol diff view** (`lifecycle-panel.tsx`): "📋 Compare versions" `<details>` section. Two plan-slug dropdowns, colored diff (green `+`, red `-`, purple `@@`). Auto-selects `supersedes` as Plan A. "Comparing…" spinner.
- **📄 Session brief modal** (`session-brief-modal.tsx`): fixed overlay modal, max-w-2xl. Sections: header (client + date + session type), presenting complaints (tag-stripped), AI drivers (numbered, confidence %), supplements (bullets), labs ordered (chips), five pillars (colored score boxes), branded footer. `@media print` isolates `#session-brief-content`. "📄 Brief" button in expanded session cards in Sessions tab.
- **New files**: `src/app/plans/[slug]/actions.ts` (checkSupplementInteractionsAction), `src/app/clients/[id]/session-brief-modal.tsx`
- **Modified**: `src/app/plans/[slug]/plan-editor.tsx` (interaction warning banner), `src/app/page.tsx` (recheck date derivation), `src/app/plans/[slug]/lifecycle-panel.tsx` (diff viewer), `src/app/clients/[id]/client-tabs.tsx` (📄 Brief button + briefSessionId state), `src/app/assess/actions.ts` (SessionDriver, SessionSupplement interfaces, likely_drivers/supplement_suggestions in SessionSummary)

**v0.60** — Lab comparison view + IFM trends + client photo:

- **🔬 Lab comparison view**: side-by-side two health snapshots. "Before protocol" vs "3 months in" comparison cards in Sessions tab.
- **📈 IFM Matrix trends**: IFM node scores tracked across full sessions, trend indicators next to each node.
- **🖼 Client photo**: upload/update profile photo in Overview. Shown as avatar in client list + header.

**v0.59** — Discovery consultation session type + plan-period meal plan + email on dashboard + AiSensy unmatched log:

- **🔍 Discovery consultation session type** (`discovery-form.tsx`): new session type for first-contact / paid discovery appointments. Curated FM lab panel selector (9 groups: Thyroid, Blood Sugar, Inflammation, Lipids, CBC, Metabolic, Nutrients, Hormones, Gut/Routine) with toggle-per-lab and toggle-all-group. Food journal duration picker (3/5/7 days). Chief complaints textarea + coach notes. After save: shows shareable lab request text + food journal text with Copy/Print buttons. Saves as `[session_type: discovery_consultation]` tag in presenting_complaints.
- **📋 Intake session rename**: "Pre-intake" card in SessionTypePicker renamed to "Intake session" (key stays `pre_intake`). Description updated: "Client returns with labs + food journal".
- **Session type changes**: `SessionType` union in `session-utils.ts`, `actions.ts` (`SessionSummary` + `SaveSessionInput`), `session-type-picker.tsx`, `client-tabs.tsx` (SESSION_TYPE_META, import, render block, summaryLine, dotColor) all updated for `discovery_consultation`. `FollowUpDraftPanel` sessionType prop updated. Cast hack in `discovery-form.tsx` removed.
- **📅 Plan-period meal plan** (`render-client-letter.py`): all 4 prompt builders (`meal_plan`, `supplement_plan`, `lifestyle_guide`, `consolidated`) now read `plan.get("plan_period_weeks", 12)` as `plan_weeks` and use `{plan_weeks}` throughout prompt text. No more hardcoded "12 weeks" in client-facing letter prompts.
- **✉ Email from dashboard** (`page.tsx`): adds `✉ Email` mailto link to each client card in the dashboard triage sections when `client.email` is set.
- **📥 AiSensy unmatched log** (`aisensy-webhook/route.ts`): when no client is found for an incoming phone number, saves the message to `~/fm-plans/_aisensy_unmatched.yaml` (date, phone, name, text) for coach to review. Returns HTTP 200 so AiSensy doesn't retry. No client auto-creation.
- **Modified**: `src/app/clients/[id]/client-tabs.tsx`, `src/app/clients/[id]/session-type-picker.tsx`, `src/app/clients/[id]/follow-up-draft-panel.tsx`, `src/app/assess/actions.ts`, `src/lib/fmdb/session-utils.ts`, `src/app/page.tsx`, `src/app/api/aisensy-webhook/route.ts`, `scripts/render-client-letter.py`
- **New files**: `src/app/clients/[id]/discovery-form.tsx`

**v0.58** — Protocol adherence trend chart + AiSensy dashboard badge + Five Pillars in full session + Lab trends in Sessions tab:

- **💊 Protocol adherence chart** (`protocol-adherence-chart.tsx`): new component in Sessions tab. Parses `check_in` sessions tagged `[session_type: protocol_checkin]`, renders a colour-coded grid: rows = supplement/practice names, columns = session dates. Status chips: ✅ emerald (still_taking), 🔄 blue (sometimes), ⚠️ amber (side_effects), ❌ red (stopped), — gray (unknown/not recorded). Returns `null` if no protocol check-ins. `parseAdherenceText()` walks the formatted text: detects `## 💊 Supplements` / `## 🌿 Lifestyle practices` headers, matches emoji-prefixed entries.
- **💬 AiSensy inbox badge** (`page.tsx` + `loader-extras.ts`): green banner on dashboard counting `quick_note` sessions tagged `[source: aisensy_webhook]` in the last 7 days across all clients. `getRecentAisensyMessages()` in `loader-extras.ts` scans session dirs cheaply (filename date filter → only reads recent files, checks `presenting_complaints` tag). Each message shown as a chip linking to `?tab=sessions`. Banner hidden when no recent messages.
- **🌿 Five Pillars in full session** (`assess-client.tsx`): `FivePillarsCapture` widget added as Step 5 in the full-assessment form (only shown when `fixedClientId` is set, i.e. embedded in client page). State `sessionFivePillars` threaded through `runAssessAction` → `assess.py` → all 3 `Session()` constructors. `AssessInput.five_pillars?` added to `anthropic-types.ts`.
- **📈 Lab trends in Sessions tab**: `ProtocolAdherenceChart` added after `OutcomeProgressCard` in the Sessions tab. `HealthTrends` was already in the Sessions tab (from prior version).
- **Modified**: `src/app/clients/[id]/client-tabs.tsx` (import + render `ProtocolAdherenceChart`), `src/app/page.tsx` (AiSensy badge), `src/lib/fmdb/loader-extras.ts` (`getRecentAisensyMessages`), `src/app/assess/assess-client.tsx` (Five Pillars widget + state), `src/lib/fmdb/anthropic-types.ts` (`five_pillars` field), `scripts/assess.py` (five_pillars in all Session constructors)
- **New files**: `src/app/clients/[id]/protocol-adherence-chart.tsx`

**v0.57** — Five Pillars at check-in + post-session WhatsApp draft:

- **🌿 Five Pillars capture** (`five-pillars-capture.tsx`): compact 5-column widget (😴🧘🏃🥗🤝) embedded in the check-in form. Sleep quality (1–5) + hours, Stress (1–5 inverted), Movement days (0–7), Nutrition quality (1–5), Connection quality (1–5). Color-tiered chips (red/amber/emerald). Saved as `FivePillarsAssessment` in session YAML via `five_pillars` field added to both Python `Session` model (`models.py`) and TypeScript `SaveSessionInput`. `save-session.py` extracts + builds `FivePillarsAssessment` before saving. `OutcomeProgressCard` already reads this data for trend display.
- **💬 Post-session WhatsApp draft** (`follow-up-draft-panel.tsx`): after any check-in, pre-intake, or quick note is saved, a green "💬 Draft message" panel appears below the "Session saved" banner in `client-tabs.tsx`. Clicking "Draft message" calls `draftFollowUpMessageAction` → `draft-followup-message.py` (Haiku, `claude-haiku-4-5`, 300 tokens, Shivani voice, warm/personal, 3–5 sentences, no bullets/emoji). Shows editable `<textarea>` pre-filled with AI draft + "📋 Copy" button (`navigator.clipboard.writeText`) + "Regenerate" link. Footer: "Edit freely before copying — AI draft, you send it." Full-assessment sessions excluded (they have their own AI flow).
- **New files**: `scripts/draft-followup-message.py`, `src/app/clients/[id]/five-pillars-capture.tsx`, `src/app/clients/[id]/follow-up-draft-panel.tsx`
- **Modified**: `fmdb/plan/models.py` (added `five_pillars` field to `Session`), `scripts/save-session.py` (builds `FivePillarsAssessment`), `src/app/assess/actions.ts` (`FivePillarsData` interface + `SaveSessionInput` extended), `src/app/clients/[id]/check-in-form.tsx` (widget + save logic), `src/app/clients/actions.ts` (`draftFollowUpMessageAction` server action)

**v0.56** — Protocol check-in + pre-session brief + AiSensy webhook:

- **💊 Protocol check-in panel** (`protocol-checkin-panel.tsx`): collapsible button in Overview quick-capture row. Loads active plan supplements + lifestyle practices via `loadActivePlanItemsAction`. Per-supplement: Still taking / Sometimes / Side effects / Stopped chips + note field. Per-practice: Consistent / Mostly / Struggling / Not doing. Saves as `check_in` session + appends to plan `notes_for_coach`.
- **📋 Pre-session coach brief** (`pre-session-brief.tsx`): "📋 Session brief" button in Analyse tab header. Print-optimised modal: client snapshot, last session summary, active plan supplements/practices, recent quick notes, pending labs, suggested question list. 🖨 Print/Save PDF → `window.print()`.
- **🔗 AiSensy webhook** (`/api/aisensy-webhook`): POST endpoint matches `waId` (phone) → client by `mobile_number` (last-10-digit normalisation), saves as `quick_note` session tagged `[source: aisensy_webhook]`. Auth via `AISENSY_WEBHOOK_SECRET` env var + `X-AiSensy-Secret` header. GET returns setup instructions. `findClientByPhoneAction` in `clients/actions.ts`. Requires Cloudflare Tunnel for production.
- **🏗 New server actions** in `clients/actions.ts`: `loadActivePlanItemsAction` (loads `supplement_protocol` + `lifestyle_practices` from plan slug), `findClientByPhoneAction` (phone-to-client lookup).

**v0.55** — Lab report upload panel + WhatsApp/AiSensy message capture:

- **🧪 Lab upload panel** (`lab-upload-panel.tsx`): collapsible "🧪 Upload labs" button in Overview. Uploads file → `extractTranscriptAction` (empty catalogue, extracts `health_data.lab_values`) → shows extracted labs table + FM pattern banners → `applyTranscriptDataAction` saves snapshot. Uses `detectLabPatterns` + `IFM_NODES` from `ifm-matrix.ts`.
- **💬 Message capture panel** (`message-capture-panel.tsx`): collapsible "💬 Capture message" button. Paste WhatsApp/AiSensy message → Haiku parses into structured clinical sections (improving/persisting/new symptoms, adherence, questions, mood, protocol flag) → editable quick note text → saves as `quick_note` session.
- **`parse-client-message.py`**: Haiku script, `claude-haiku-4-5`, structured JSON output, dry-run mode.
- `parseClientMessageAction` in `clients/actions.ts` using `runScript`.

**v0.54** — Outcome progress dashboard + visual protocol template picker:

- **📈 Outcome progress card** (`outcome-progress-card.tsx`): symptom burden bar chart (SVG, last 10 sessions, indigo=full/green=check-in, delta arrow) + five pillars horizontal bars with delta arrows. Shows when `sessions.length >= 2`.
- **`SessionSummary.five_pillars`** field added; `loadClientSessionsAction` extracts it from raw session YAML.
- **Visual protocol template picker** in `assess-client.tsx` `PlanBriefCard`: replaced `<select>` with 2-3 col card grid (icon + name + description + chips). Toggle selection. 20 templates in `protocol-templates.ts`.

**v0.53** — IFM Matrix card + FM lab pattern recognition:

- **`src/lib/fmdb/ifm-matrix.ts`**: 7 IFM nodes (Assimilation, Defence/Repair, Energy, Biotransformation, Transport, Communication, Structural) with emoji/color/keywords. `computeIFMMatrix(drivers, topics, symptoms)` → scored nodes. `detectLabPatterns(labs, ratios)` → LabPattern[] (subclinical hypothyroid, insulin resistance, low Vit D, iron deficiency anaemia, anaemia of chronic disease, elevated hsCRP).
- **`src/app/assess/ifm-matrix-card.tsx`**: colored score bars, "Primary" badge, 🚩/⚠️/ℹ️ lab pattern banners. Injected between SuggestionsView and PlanBriefCard in assess-client.tsx.

**v0.48 (prior)** — Client page 3-tab redesign + lab extraction fix + intake form fields:

- **🗂 Client page tab redesign: Overview | 🗓 Sessions | 📋 Plan** (3 tabs, was 4)
  - Removed "Protocol" and "Send" as separate tabs. Merged into single **Plan** tab.
  - `type Tab = "overview" | "sessions" | "plan"` in `client-tabs.tsx`.
  - `page.tsx` accepts `?tab=overview|sessions|plan`. Backward compat: `timeline`→`sessions`, `protocol`→`plan`, `send`→`plan`, `documents`→`plan`.
  - Dashboard CTAs and all deep-links updated to use new tab names.

- **🗓 Sessions tab** (was "Timeline"):
  - All session recording (pre-intake / full session / check-in / quick note) + session history + health trends.
  - Pending labs banner points to "start session" not "run assessment".
  - Session history pill labels: `full_assessment` → **"Full session"** (not "Assessment").
  - AI synthesis label in expanded history: "AI synthesis" → "AI analysis".

- **📋 Plan tab** (merged Protocol + Send):
  - If no plan: CTA card → "📋 Start a session" + "＋ Create manually".
  - If draft: plan header card + Edit + **🚀 Activate** inline.
  - If published: plan card + "View plan" + "💬 Log check-in" + **📤 Client letters** section (SendPackageButton) — no separate Send tab needed.
  - Follow-up plan generator here (published only).
  - Archived plans in collapsible `<details>`.
  - **External Reports** moved here from the old Send tab (always visible at bottom).

- **🚦 Workflow stage banner language simplified** (removed "Step X of 3"):
  - `no_plan` → "No plan yet" + "📋 Start session →"
  - `draft` → "Draft plan ready — fill the protocol and activate" + "📋 Go to Plan →"
  - `active` → "Plan is active — generate and send client letters" + "📤 Generate letters →"
  - `recheck` → "Protocol complete · Time for a new session" + "📋 New session →"

- **"Assessment" word removed from UI** (was appearing 5+ times on same page):
  - `SESSION_TYPE_META.full_assessment.label`: "Assessment" → "Full session"
  - Session form section header: "🧠 Full Assessment" → "🔍 Full session — AI analysis"
  - All banner/action buttons: "🧠 Run assessment" → "📋 Start session" / "📋 New session"
  - Protocol no-plan card: "🧠 Run assessment" → "📋 Start a session"
  - Overview action bar: "🧠 Run assessment" → "📋 New session"
  - Tab bar: "🗓 Timeline" → "🗓 Sessions"
  - Uploaded files empty state: "Timeline tab" → "Sessions tab"
  - Education pack: "assessment topics" → "topics from sessions"
  - Sessions summary button: "view full timeline" → "view full history"
  - Pending labs banner: "run assessment" → "start session"

- **🔧 Lab extraction fix** (`scripts/extract-symptoms.py`):
  - `max_tokens` raised from `4096` → `8192` (Haiku's maximum).
  - Root cause: full 379-symptom catalogue (~60KB) + 78-lab PDF together exceeded 4096 output tokens, truncating the JSON mid-object → `JSONDecodeError`.
  - `extractSymptomsFromTranscript` timeout raised 60s → 120s.
  - Dedup guard added in `assess-client.tsx` `setUploads` to prevent duplicate file entries on retry.

- **📝 Intake form new fields** (`new-client-form.tsx` + `actions.ts` + Python model):
  - **Email** field added (after mobile number, type="email"). Auto-filled from transcript parsing.
  - **Family history / hereditary diseases** field added (2-col grid alongside Notes).
  - `family_history: Optional[str] = None` added to Python `Client` model in `fmdb/plan/models.py` to avoid `ValidationError` on load (model uses `extra="forbid"`).

**v0.47** — Client page single-workspace redesign + plan editor UX fixes:

- **🗂 Client page tab redesign: Overview | 📋 Protocol | 📤 Send | 🗓 Timeline**
  - Dropped "Documents" tab. New tabs: **Protocol** (plan status + activate) and **Send** (letter generation only).
  - `type Tab = "overview" | "protocol" | "send" | "timeline"` in `client-tabs.tsx`.
  - `page.tsx` accepts `?tab=overview|protocol|send|timeline`. `"documents"` silently remaps to `"send"` for backward compat with existing deep-links.

- **🚦 Workflow stage banner** (always visible, changes per stage):
  - `workflowStage: "no_plan" | "draft" | "active" | "recheck"` computed from `activePlan` at component top.
  - `no_plan` → amber banner "Step 1 of 3 · Run an assessment →" button.
  - `draft` → slate banner "Step 2 of 3 · Edit and activate" → "📋 Go to Protocol →".
  - `active` → green banner "Step 3 of 3 · Generate letters" → "📤 Go to Send →".
  - `recheck` → indigo banner "Protocol complete · Reassess →".
  - Tab badges: Protocol gets `!` chip when draft; Send gets `→` chip when active.

- **📋 Protocol tab** — replaces the old separate `/plans/[slug]` lifecycle round-trip:
  - `activePlan`, `activePlanStatus`, `recheckDue`, `workflowStage` computed once at component level (not inside IIFEs).
  - No plan → big card with "🧠 Run assessment" + "＋ Create plan manually" buttons.
  - Draft/ready plan → status card + "✏️ Edit plan" link + **🚀 Activate plan** inline button (no navigation needed).
  - Published plan → "✅ Active" + "💬 Log check-in" + "📤 Generate client letters →" buttons.
  - Archived plans in collapsible `<details>` below.
  - Follow-up plan generator (previously in Documents tab) moved here, published plans only.

- **🚀 Inline Activate button** — eliminates the /plans/[slug] → Lifecycle tab round-trip:
  - `handleActivate(planSlug)` calls `submitPlan` + `publishPlan` server actions in sequence from the client page.
  - Error from `submitPlan` → toast "Plan check failed — open the plan editor to fix errors".
  - Success → `toast.success("✅ Plan activated!")` + `router.refresh()`.
  - `isActivating` state drives spinner. `useRouter` from `next/navigation` imported.
  - `submitPlan` and `publishPlan` imported from `@/app/plans/[slug]/lifecycle-actions`.

- **📤 Send tab** — letter generation only:
  - Shows `SendPackageButton` for published plans only.
  - Draft/no plan → "No active plan" card with CTA to Protocol or Timeline.
  - External reports section retained.
  - `ClientLetterButton` import removed entirely (was already demoted to Advanced, now gone).

- **Plan editor UX fixes** (earlier in this session):
  - `effectiveLocked` bug fixed — `sed` had incorrectly replaced `locked` → `effectiveLocked` inside `PlanTimelineCard` and `LabOrdersEditor` sub-components which have their own `locked` prop. Fixed by reverting those occurrences.
  - `SupplementCombobox` — typeahead combobox replacing `<select>` for supplement slug input. Filters catalog options, allows freeform, shows "✓ catalog" / "custom" badge. Uses `onMouseDown` to avoid blur-before-click race.
  - Lifecycle panel: single **🚀 Activate plan** button (calls `submitPlan` + `publishPlan` in sequence). Archive/Revoke buried in `<details>` danger zone. Removed prominent Submit step.
  - AI Plan Assistant (`💬` details) moved to TOP of Protocol tab (was at bottom, hard to find).
  - SendPackageButton: per-type "✏️ Edit" toggle opens monospace textarea; "💾 Apply edits to download" updates the markdown blob; markdown download uses edited content.
  - "Go to Lifecycle tab" passive breadcrumb removed — replaced with context-aware next-step cards (now superseded by the workflow stage banner system).

**v0.46** — SendPackageButton, plan editor 3 tabs, vertical timeline cards, dashboard deep-links:

- **📤 `SendPackageButton`** — batch letter generator in Documents tab:
  - New `src/app/clients/[id]/send-package-button.tsx` component. "📤 Send package" collapsible trigger → package builder panel.
  - 4 letter types as checkboxes (Meal Plan ✓, Supplement Guide ✓, Lifestyle Guide ☐, Full Wellness Letter ☐). Standard delivery = first two.
  - Loads all 4 saved letters on mount in parallel via `loadMealPlan`. Shows "✓ Saved DD Mon HH:MM" badge on already-generated types.
  - Sequential generation: `for (const pkg of checkedTypes) { await generateClientLetter(planSlug, clientId, undefined, pkg.type, coachNotes) }`. Per-type status: `idle | pending | done | error`.
  - Per-type download buttons (HTML + Markdown) once done. Coach notes textarea weaved into all selected letters.
  - Documents tab restructured: Protocol row full-width → "📤 Client letters" section with `SendPackageButton` as primary + `ClientLetterButton` demoted to `<details>` "Advanced" disclosure.

- **📋 Plan editor simplified from 10 tabs → 3 tabs** (background agent):
  - `plan-editor.tsx`: 10-tab Tabs block replaced with 3 tabs: **📋 Protocol** (9 collapsible `<details>` sections + PlanChatPanel), **📄 Documents** (static link to client page), **🚀 Lifecycle** (renders `<LifecyclePanel>` inline).
  - `LifecyclePanel` moved out of `page.tsx` into the Lifecycle tab inside `PlanEditor`. `page.tsx` passes `lifecycleProps` to `<PlanEditor>` and no longer renders `<LifecyclePanel>` directly.
  - `PlanEditorProps` gains `lifecycleProps: { status, version, catalogueSnapshot, statusHistory, supersedes, allPlanSlugs }`.

- **🗓 Vertical timeline cards in Timeline tab**:
  - Replaced `<Table>` session history (~130 lines of JSX) with vertical timeline UI.
  - Connector: `absolute left-[18px] top-5 bottom-5 w-px bg-border`. Each session: colored dot + collapsible card.
  - Dot colors: full_assessment `#2B2D42`, pre_intake `#D6A2A2`, check_in `#8D99AE`, quick_note `#E8A87C`.
  - Collapsed: type badge + date + lab chip + stat chips + `summaryLine` (derived from session type).
  - Expanded: topics, symptoms, presenting complaints, AI synthesis notes, labs ordered.

- **🔗 Dashboard deep-links + `?tab=` URL param**:
  - `clients/[id]/page.tsx`: accepts `searchParams: Promise<{ tab?: string }>`. Passes `defaultTab` to `<ClientPageTabs>`. Valid values (v0.47+): `"overview" | "protocol" | "send" | "timeline"`.
  - Returning client banner link → `/clients/${id}?tab=sessions` (was `?tab=timeline`; updated v0.48).
  - Dashboard `SECTION_META` CTAs for `protocol_complete`, `labs_pending`, `returning`, `new_client` all point to `/clients/${id}?tab=sessions`.

**v0.45** — Client page tab restructure + reported_triggers + lifestyle_guide rename:

- **🗓 Client page tabs simplified** from 5 → 3: **Overview / Timeline / Documents**
  - **Overview** — bio snapshot, active plan quick-access, action buttons, profile editor, preferences, labs
  - **Timeline** — record a session (4 types: Pre-intake / Full Assessment / Check-in / Quick Note) + session history feed + health trends sparklines
  - **Documents** — plans list with protocol link + ClientLetterButton per plan + external reports
  - `SessionType` expanded: added `"quick_note"` type for between-session ad-hoc notes (the amaranth use case). `QuickNoteForm` inline component — free-text + source (client message / phone call / coach observation). Saves via `saveSessionAction`.
  - `SESSION_TYPE_META` and `SaveSessionInput.session_type` union updated to include `quick_note`.

- **🌿 Renamed `coaching_plan` letter type → `lifestyle_guide`** to eliminate naming collision:
  - `LetterType` union updated in `lifecycle-actions.ts`
  - UI label changed from "Coaching Plan" to "Lifestyle Guide" with 🌿 emoji in `client-letter-button.tsx`
  - `render-client-letter.py`: function renamed `_build_prompt_lifestyle_guide`, dispatcher updated, `type_meta` dict key updated to `"lifestyle_guide"`
  - Plan card in Documents tab: "🗂 Coaching Plan" section renamed to "🗂 Protocol"

- **⚠ `reported_triggers` field** (from v0.44 work) added to `PreferencesEditor`, `actions.ts`, `render-client-letter.py`

**v0.44** — Coach Knowledge ingest tab, catalogue check before staging, Enrich links panel, Add Source consolidated into Ingest:

- **💬 Coach Knowledge tab on `/ingest`** — zero-friction clinical observation capture:
  - New tab "💬 Coach Knowledge" in the Ingest page tab bar.
  - **Two-phase flow**: type an observation → "🔍 Check catalogue first" → AI checks for conflicts/support → then stage.
  - **Phase 1 — catalogue check** (`scripts/coach-knowledge-check.py`): keyword extraction (4+ char words, hyphenated compounds, stopword filtered) → YAML file scoring (slug match = 2× bonus) → top 15 candidates → Haiku call returns `{related: [{kind, slug, relation: "supports"|"conflicts"|"overlaps"|"referenced", relation_note}], assessment, is_new_ground}`.
  - **Assessment banner**: red if conflicts, green if new ground, blue if overlaps. Shows each related entry as a `RelatedEntryCard` with colour-coded relation badge, relation note, summary excerpt, and existing `notes_for_coach`.
  - **Stage button**: "⚠ Stage anyway" (red) if conflicts, "🧠 Stage observation" (amber) otherwise. Editing the text resets back to idle.
  - **Phase 2 — staging** (`scripts/coach-knowledge.py`): writes observation to temp `.md`, calls `fmdb ingest` with `source-id=coach-shivani` and a specialized extraction prompt that emits Claims with `notes_for_coach` = original wording + `coaching_translation` = actionable phrasing.
  - Auth fix: `load_dotenv(FMDB_ROOT / ".env", override=True)` with fallback manual parser that strips `export ` prefix — fixes Haiku "could not resolve authentication" error.

- **🔗 Enrich links before approving** — add cross-links to staged entities before `approve`:
  - `EnrichPanel` component appears inside every pending `BatchPanel` (below Approve/Reject buttons). Lazy-loads staged entities on expand via `listStagedEntitiesAction`.
  - Per-entity `EnrichEntityRow`: collapsible row showing entity kind / display_name / slug. Inputs for `linked_to_topics`, `linked_to_mechanisms`, `linked_to_supplements`, `linked_to_claims` (comma-separated slugs) + `notes_for_coach` textarea.
  - Saves via `patchStagedEntityAction` → `ingest-action.py` `patch_staged_entity` action: union-merges list fields (`dict.fromkeys` dedup), overwrites string fields, writes back with `yaml.dump(sort_keys=False)`.
  - **New ingest-action.py actions**: `list_staged_entities` (reads `_meta.json` entries, loads each staged YAML, returns `{entity, slug, status, display_name, linked_to_*, notes_for_coach}`); `patch_staged_entity` (union-merges + overwrites); `batch_status` (reads `_meta.json` status field).

- **✅ BatchPanel status check** — already-approved/rejected batches show read-only banner:
  - `getBatchStatusAction` called on mount. If `status === "approved"` or `"rejected"`, renders coloured read-only banner ("✓ Already approved — entries are in the catalogue") with only a "👁 Review YAML" button. No Approve/Reject actions shown.
  - Fixes: `vitaone-health-coaching-toolkit` batch with `status: "approved"` in `_meta.json` was always showing as pending.

- **📚 Add Source consolidated into Ingest** — no more separate sidebar page:
  - "📚 Add Source" is now the 4th tab on `/ingest` (`AddSourceTab` component). Full form: ID, title, type, quality, authors, year, publisher, URL, DOI, notes. Saves via `saveSourceAction` → `source-save.py`.
  - After save: shows success banner with link to `/catalogue/sources/{id}` + explanation to then ingest the document with the same ID.
  - `{ href: "/sources", label: "📚 Add Source" }` removed from `KB_NAV` in `sidebar-nav.tsx`. The `/sources` route still exists but is no longer linked from sidebar.

- **New actions in `src/app/ingest/actions.ts`**: `checkCoachKnowledgeAction`, `runCoachKnowledgeAction`, `getBatchStatusAction`, `listStagedEntitiesAction`, `patchStagedEntityAction`, `saveSourceAction` (consolidated from `/sources/actions.ts`).

**v0.45** — Client page tab restructure + reported_triggers + lifestyle_guide rename:

- **🗓 Client page tabs simplified** from 5 → 3: **Overview / Timeline / Documents**
  - **Overview** — bio snapshot, active plan quick-access, action buttons, profile editor, preferences, labs
  - **Timeline** — record a session (4 types: Pre-intake / Full Assessment / Check-in / Quick Note) + session history feed + health trends sparklines
  - **Documents** — plans list with protocol link + ClientLetterButton per plan + external reports
  - `SessionType` expanded: added `"quick_note"` type for between-session ad-hoc notes (the amaranth use case). `QuickNoteForm` inline component — free-text + source (client message / phone call / coach observation). Saves via `saveSessionAction`.
  - `SESSION_TYPE_META` and `SaveSessionInput.session_type` union updated to include `quick_note`.

- **🌿 Renamed `coaching_plan` letter type → `lifestyle_guide`** to eliminate naming collision:
  - `LetterType` union updated in `lifecycle-actions.ts`
  - UI label changed from "Coaching Plan" to "Lifestyle Guide" with 🌿 emoji in `client-letter-button.tsx`
  - `render-client-letter.py`: function renamed `_build_prompt_lifestyle_guide`, dispatcher updated, `type_meta` dict key updated to `"lifestyle_guide"`
  - Plan card in Documents tab: "🗂 Coaching Plan" section renamed to "🗂 Protocol"

- **⚠ `reported_triggers` field** (from v0.44 work) added to `PreferencesEditor`, `actions.ts`, `render-client-letter.py`

**v0.43** — Split document types, coach knowledge field, /sources route, shim extraction:

- **✂️ Split Generate Meal Plan into 4 document types** (`client-letter-button.tsx` + `lifecycle-actions.ts` + `render-client-letter.py`):
  - **4 letter types**: `"consolidated"` (all sections), `"meal_plan"` (nutrition/meals only), `"supplement_plan"` (short intro + Python-generated schedule), `"lifestyle_guide"` (habits/education/labs/tracking) [previously called `coaching_plan`].
  - **`LetterType`** TypeScript union type in `lifecycle-actions.ts`. `saveMealPlan` / `loadMealPlan` / `generateClientLetter` all accept `letterType` (default `"consolidated"` for backward compat).
  - **File stems**: consolidated → `{planSlug}.md/.html`, others → `{planSlug}-{type}.md/.html`.
  - **`render-client-letter.py`**: 3 new prompt builders (`_build_prompt_meal_plan`, `_build_prompt_supplement_plan`, `_build_prompt_lifestyle_guide`) + dispatcher in `_build_prompt()` routing by `letter_type`.
  - **UI (`client-letter-button.tsx`)**: 4-type selector cards in idle state (emoji + desc + "✓ saved" badge). Loads all saved types on mount in parallel. Tab bar in ready state shows each saved type. Weight loss form only shown for types that `needsWeightLoss` (consolidated + meal_plan).
  - **`type_meta` dict** maps each letter_type to its HTML title/subtitle.

- **📝 Coach knowledge / custom notes field** (`coachNotes` parameter):
  - Optional freeform textarea shown in asking state before generation: `"e.g. Soak 1 tsp methi seeds overnight and drink the water first thing in the morning…"`
  - Passed through `generateClientLetter()` → Python shim → woven naturally into each of the 4 prompt variants as a `coach_notes_block`.
  - All 4 prompt builders include the notes block if non-empty.

- **📚 /sources route** — new "Add Source" page in the Next.js UI:
  - `src/app/sources/page.tsx` + `src/app/sources/source-client.tsx`: full form (ID, title, type, quality, authors, year, publisher, URL, DOI, notes). On save: calls `saveSourceAction`, shows success badge linking to `/catalogue/sources/{id}`.
  - `src/app/sources/actions.ts`: uses `runShim` from `@/lib/fmdb/shim`. Revalidates `/catalogue` + `/sources`.
  - `scripts/source-save.py`: Python shim writing new Source entities to `fm-database/data/sources/`. Validates enums, returns `{ok, id, already_existed, error}`.
  - Sidebar: `{ href: "/sources", label: "📚 Add Source" }` added to `KB_NAV`.

- **🔧 `runShim` extracted to shared utility** (`src/lib/fmdb/shim.ts`):
  - Previously a private function inside `anthropic.ts`. Extracted to `src/lib/fmdb/shim.ts` as an exported utility.
  - `sources/actions.ts` imports from `@/lib/fmdb/shim` (not from `anthropic.ts`).
  - `PYTHON` and `SCRIPTS_DIR` constants also exported from `shim.ts`.

- **🗂 Worktree cleanup**: stale `admiring-montalcini-75c3f5` worktree (frozen at v0.34) removed entirely. All its `/sources` work ported cleanly to main.

- **📦 Catalogue counts updated (post adrenal-hormones batch approval)**:
  - 82 sources / **318** topics / **408** mechanisms / **378** symptoms / **1,492** claims / 279 supplements.

**v0.42** — Ingest all-clear + approve_all hardening:

- **✅ All 58 staging batches approved** — catalogue now fully committed. Final counts: 80 sources / 314 topics / 401 mechanisms / 366 symptoms / 1,418 claims / 279 supplements.
- **🔧 approve_all hardened** (`scripts/ingest-action.py`):
  - Was treating "staged file missing" (56 batches already approved in a prior session but `_meta.json` never marked) as failures → showed 57 failed. Now detects the phrase in stderr, marks those `_meta.json` files `status: approved`, counts as `skipped` not `failed`. Correct output: `approved=1 skipped=56 failed=0`.
  - Alias collision auto-fix pattern: when a staging batch has an alias that matches a canonical slug in the same entity kind, remove the alias from the staging file before re-running approve. The approve validator treats this as an error and aborts the whole batch. Fixed manually for the two nutrition cheatsheet batches; a Python helper script was used to find all collisions in bulk and strip them in one pass.
  - **Root cause of alias collisions**: the AI extractor generates aliases including terms that already exist as their own canonical entities (e.g. `hypothyroidism` as alias on `thyroid` topic, `anxiety` as alias on `mood-changes-and-anxiety` symptom, `neuropathy` as alias on `tingling-numbness` symptom). This is expected — just strip the colliding alias and approve.

**v0.41** — Supplement schedule, affiliate links, ingest upgrades, git commit button, 12-week client letter, per-week print buttons:

- **💊 Python-generated supplement schedule** in client letter (`scripts/render-client-letter.py`):
  - Supplement section is 100% Python-generated HTML — AI is explicitly told NOT to write supplement table. Guarantees every supplement in the plan appears even if AI is unfamiliar with it (e.g. Slippery Elm).
  - `_build_supplement_schedule_html(supplements)` → visual timeline (bubble cards per slot) + print-ready table with Supplement / Timing / Dose / Rationale / Where to buy columns.
  - 7 timing slots in chronological order: Early Morning → Breakfast → Mid-Morning → Lunch → Afternoon (With Dinner labelled "🌆") → Bedtime. `_timing_slot()` maps free-text timing strings (e.g. "dinner", "6 pm", "bedtime") to the correct slot.
  - **Print schedule button** (`🖨 Print Schedule`): JS isolates `#supplement-schedule` div, calls `window.print()`, restores. Print CSS hides "Where to buy" column (no URLs on printed output), hides all other page content. No URL footer, no client code on printout.
  - `brand_html.py` has full CSS for `#supplement-schedule`, `.timeline-slot`, `.schedule-table`, `.buy-badge-vitaone/amazon/iherb`. Print rules: `.no-print { display: none !important }`.

- **🗓 Per-week print buttons on the meal plan** (`scripts/brand_html.py`):
  - `_wrap_week_sections(html)` detects `## Week N` headings in the AI-generated markdown and wraps each in `<div id="print-week-N" class="week-section">`.
  - `_wrap_no_print_sections(html)` wraps Referral / Recipe / Appendix headings in `<div class="no-print">` so they hide on print.
  - **Per-week print bar** injected above each `week-section`: a subtle bar with a "🖨 Print Week N" button and "🍽 Meal plan · 7-day table" label. Clicking sets `body[data-print-week="N"]`, calls `window.print()`, clears the attribute. CSS uses `body[data-print-week] .content > *:not(.week-section) { display: none }` and `body[data-print-week="N"] .week-section:not(#print-week-N) { display: none }` to isolate exactly one week.
  - **✦ Recipe linking**: `✦ heading` anchors in the Recipes appendix are indexed. `✦` symbols in meal plan table cells become clickable links to their recipe anchor.
  - **Print-optimised table CSS**: meal plan 7-day tables use condensed font, word-wrap, no link underlines. Fits cleanly on A4 without truncation.
  - `_wrap_week_sections` and `_wrap_no_print_sections` called inside `wrap_in_brand_html()` before returning the final HTML.

- **💌 12-week client letter generator** on the plan page (`src/app/clients/[id]/client-letter-button.tsx`):
  - **`ClientLetterButton`** component on the client detail page (Assessments / Plans tabs) — triggers `generateClientLetter()` server action.
  - **Weight loss questionnaire** (`WeightLossForm`) shown before generation: "Is weight loss a goal?" Yes → asks goal kg, goal weeks, activity level (sedentary/light/moderate/active), pace (slow/moderate/faster), current exercise, what she's open to, days/week, physical limitations. No → skips directly to generation.
  - **`WeightLossParams`** interface in `lifecycle-actions.ts`: `enabled, goal_kg, goal_weeks, activity_level, pace, exercise_current, exercise_open_to, exercise_days_per_week, exercise_limitations`.
  - **`_calc_calorie_targets(client, wl)`** in `render-client-letter.py`: computes TDEE (Mifflin-St Jeor for the client's age/weight/height/sex + activity multiplier), calculates phase-by-phase calorie targets across 12 weeks (2-2-4-2-2 week phases scaled to goal_weeks). If goal_kg + goal_weeks given, back-calculates required daily deficit; if only pace given, uses fixed weekly loss. Returns `{phases: [{weeks, daily_kcal, phase_label}], ...}`.
  - **Prompt structure** (`_build_prompt`): 12-week healing journey letter. Weeks 1–2 only get the full 2×7-day meal plan tables; weeks 3–4 get a teaser paragraph only (full plan sent later). Remaining phases get one-paragraph roadmap blurbs. Calorie targets per meal (breakfast 25% / lunch 35% / dinner 30% / snacks 10%) are BINDING — AI must hit them. Seasonal produce (computed from month), location-aware, dietary preference-aware (Vegetarian Jain → no root veg at all, no underground veg). AI writes the letter; supplement section placeholder points to the Python-generated section injected separately.
  - **Saved meal plan** (`saveMealPlan` / `loadMealPlan`): generated letter (markdown + branded HTML) saved to `~/fm-plans/clients/<id>/meal-plan-<slug>.json`. Loaded on mount so regeneration is optional. Shows "✓ Saved · last generated DD Mon HH:MM".
  - **Refinement chat**: After generation, inline `ChatTurn[]` panel for multi-turn edits ("swap day 3 dinner", "reduce week 1 calories slightly", "make tone warmer"). Each turn calls `refineLetter()` → `refine-letter.py`. History passed back each turn. Saves refined letter to disk.
  - **Downloads**: "⬇ Download branded HTML" (Cmd+P → PDF in Chrome) + "⬇ Markdown" + "Preview" toggle.

- **🥗 Dietary preferences on client profile** (`src/app/clients/[id]/preferences-editor.tsx`):
  - `PreferencesEditor` card on the client detail page — shows dietary_preference, location (city), and any food non-negotiables. Inline editable. Saved to `client.yaml` via `updateClientPreferencesAction`.
  - Used by `render-client-letter.py` to tailor meal plan (Jain → no root veg, vegetarian/non-vegetarian recipes, regional produce, seasonal foods for that city).

- **🔗 VitaOne affiliate links** — complete 158-keyword catalog across all 4 pages of vitaone.in/shop verified and corrected:
  - Referral code: `?pr=vita13720sh` on every VitaOne URL via `_v()` helper.
  - Priority chain: custom links → VitaOne catalog → Amazon fallback → iHerb fallback → no link.
  - Fixed wrong slugs: NAC (`-17` not `-21`), MCT Oil (`3z-inby-uz48-mct-oil-8`), Betaine HCL (`-116` not `-32`).
  - Slippery elm intentionally NOT mapped to VitaOne — coach uses custom link or iHerb.

- **🔗 Supplement Links tab in `/backlog`** — CRUD UI for custom affiliate links (Amazon, iHerb, brand sites) for supplements not on VitaOne:
  - Backed by `~/fm-plans/supplement_links.yaml`.
  - New files: `src/app/backlog/supplement-links-actions.ts` (Server Actions: `loadSupplementLinks`, `upsertSupplementLink`, `deleteSupplementLink`), `src/app/backlog/supplement-links-client.tsx` (`SupplementLinksClient`, `LinkRow`, `AddLinkForm`).
  - Tab bar added to `/backlog` page — "📝 Catalogue Backlog" | "🔗 Supplement Links (N)".

- **📛 Human-readable plan names** — `scripts/generate-draft.py` now generates slugs like `shivani-plan-1-2026-05-06-cl-001` (first name + plan number + date + client code) instead of opaque UUIDs.

- **📚 Dashboard git commit button** — amber banner on dashboard counts uncommitted `fm-database/data/` files and lets coach commit in one click:
  - `src/app/catalogue-commit-action.ts` — `getCatalogueStatus()` (counts by entity type) + `commitCatalogueData(message?)` (git add + git commit with author Shivani).
  - `src/app/catalogue-commit-button.tsx` — client component, shows breakdown (N topics · N mechanisms · etc.), optional commit message input, refresh button. Auto-hides when nothing pending.
  - No global git config on this machine — author set via `GIT_AUTHOR_NAME/EMAIL` env vars in the action.

- **⬆️ Ingest UI upgrades** (`/ingest`):
  - **Images** — drop zone now accepts `.png .jpg .jpeg .webp`. Python backend already handled these as binary vision attachments; UI now exposes them. Shows image preview before submitting.
  - **URLs** — new "🔗 URL / link" tab. Paste any web URL; Python shim fetches it (`requests`), converts HTML→markdown via `html2text` (installed in venv), saves to temp file, runs through ingest pipeline. PDFs hosted online downloaded as binary. Source ID + title auto-filled from URL on blur.
  - **⚡ Approve all pending** — amber panel at bottom of `/ingest`. "Check count" shows N pending batches. "✅ Approve all N pending" runs `fmdb approve --update` on every unapproved staging batch sequentially. Shows approved/failed counts + expandable log. New server action: `approveAllPendingAction()`, `countPendingBatchesAction()`. Python handler: `approve_all` + `count_pending` actions in `ingest-action.py`.
  - **Bug fix** — `ingest-action.py` was calling `python fmdb/cli.py` (causes `ImportError: attempted relative import`). Fixed to `python -m fmdb.cli` everywhere via `run_cli()`.

- **v0.40** — Search, email, ingest UI, follow-up reminders + full clinical check-in workflow:
- **🔍 Global search (`/search`)** — full-text search across clients, plans, topics, symptoms, supplements, mechanisms. Results grouped by type with colour chips. `⌘K` shortcut from anywhere in the app opens search instantly. Search bar in sidebar with `⌘K` badge. URL param `?q=` makes searches bookmarkable. Sidebar nav updated with all 9 routes including new Search, Assess, Plans, Ingest links.
- **📧 Email client (`📧 Send to client` button on plan page)** — compose modal: editable To / Subject / Intro, then Preview (renders plan HTML via existing `plan-render.py` in an iframe), then Send. Sent via Gmail SMTP using nodemailer. Client email field on client detail page (click `+ Add email` → saves to `client.yaml`, clickable mailto link). Configured via `GMAIL_USER` + `GMAIL_APP_PASSWORD` in `.env.local`. Example file at `.env.local.example`. nodemailer@8 installed.
- **⬆️ Ingest UI (`/ingest`)** — drag-drop or click-to-browse PDF/Markdown. Source metadata form (ID, title, type, quality, extraction instructions). Runs the existing Python ingest pipeline (~1–5 min, ~$0.10–0.50/PDF). Batch panel on success with Review (YAML preview) / Approve (smart-merge toggle) / Reject. "Existing staging batches" expander loads any prior batch by ID. New shim: `scripts/ingest-action.py`.
- **📅 Follow-up reminders** — `next_contact_date` field on clients. Set/edit from the client detail contact widget (alongside email + mobile). Dashboard: overdue follow-ups as top-priority `📅 Follow-ups due` section (violet, above protocol_complete). Upcoming (next 7 days, not yet overdue) shown as a compact strip between stats bar and triage sections. Counts toward "Need attention" stat.
- **🏃 Production server (PM2)** — `npm run build` done, PM2 installed locally (`./node_modules/.bin/pm2`), `ecosystem.config.js` created. Server runs at `http://localhost:3002` in production mode. Start with: `./node_modules/.bin/pm2 start ecosystem.config.js`. Stop with: `./node_modules/.bin/pm2 stop fm-coach`. Logs at `~/.pm2/logs/`.
- **Check-in workflow complete** (from prior session): `handleSave` in `check-in-form.tsx` calls `appendCheckInToPlanAction` → appends formatted markdown block to `plan.notes_for_coach`. Protocol adherence rating (4-option grid). Lab ordering from check-in (grouped quick-add chips + custom entry). Check-in timeline in plan Notes tab (`CheckInTimeline` component parses `---\n📋 Check-in` separator).
- **Client contact widget** — shows email (clickable mailto) + mobile + next_contact_date. Inline editable, saves to `client.yaml` via `updateClientFieldsAction`. Appears under the page header on every client detail page.
- Build + type-check clean. **20 routes** generating.

**v0.39** — Mindmap cross-reference in Assess + 8 new curated mindmaps:
- **🧭 Root cause pathways panel** in Assess page. `MindMapContextPanel` component fires automatically as symptoms/topics are selected — no button needed. Calls `getMindMapPathways()` server action → `findMindMapPathways()` in `loader-extras.ts` which recursively walks all mindmap trees matching `linked_slug` against selected symptom/topic slugs. Results grouped by mindmap (most matches first), then by top-level branch within each map. Each match shows full breadcrumb path → bold node name → clickable `symptom/topic ↗` chip linking to the catalogue detail page. "ALSO IN THIS MAP" chips show unmatched branches. "View full map ↗" links to `/mindmap/<slug>`. Collapses/expands per map. Real test: bloating + fatigue + anxiety → **found in 7 mind maps** simultaneously.
- **8 new curated mindmaps** (each with 6-branch template: Clinical Presentation / Root Mechanisms / FM Approach / Interventions / Coaching Goals / Labs to Track):
  - `gut-health` — Gut Health & Microbiome (82 nodes, 37 linked)
  - `adrenal-stress` — Adrenal Dysfunction & Stress Response (81 nodes, 34 linked)
  - `sex-hormones-perimenopause` — Sex Hormones & Perimenopause (93 nodes, 35 linked)
  - `blood-sugar-insulin-resistance` — Blood Sugar Dysregulation & Insulin Resistance (85 nodes, 33 linked)
  - `chronic-inflammation` — Chronic Inflammation (80 nodes, 32 linked)
  - `liver-detoxification` — Liver Health & Detoxification (84 nodes, 25 linked)
  - `emotional-wellbeing` — Emotional Wellbeing & Mental Health (90 nodes, 39 linked)
  - `thyroid-dysfunction` — Thyroid Dysfunction/Hashimoto's (built prior session, 146 nodes, 51 linked)
  - All slugs verified against catalogue before linking. All validated with 0 errors.
- **Total mindmap library:** 11 maps (incl. 3 vitaone-scraped), 1,612 nodes, 355 linked (22%).
- **Mindmap nodes now clickable** — `mindmap-mermaid.tsx` NodeTree changed linked chips from `<span>` to `<Link>` pointing to `/catalogue/<kind>/<slug>`.
- **New files:** `src/app/assess/mindmap-actions.ts` (server action), `MindMapContextPanel` added to `assess-client.tsx`, `findMindMapPathways()` + `MindMapMatch` + `MindMapPathwayResult` added to `loader-extras.ts`.
- API usage limit hit for May (resets June 1) — mindmaps are hand-curated YAML, no API needed.
- Build + type-check clean. All 14 routes.

**v0.38** — Typed inner `suggestions` payload + improved backlog mining heuristic:
- **Item 4 — Typed `AssessSuggestions` inner payload.** `results.py` now has 11 sub-models (`ExtractedLab`, `LikelyDriver`, `TopicInPlay`, `AdditionalSymptomToScreen`, `LifestyleSuggestion`, `NutritionSuggestions`, `SupplementSuggestion`, `LabFollowup`, `ReferralTrigger`, `EducationFraming`, `CatalogueAdditionSuggested`) + `AssessSuggestions` wrapping them all. `AssessResult.suggestions` is now `AssessSuggestions` (not `dict`). All models use `ConfigDict(extra="ignore")` for forward compatibility. `synthesize()` calls `AssessSuggestions.model_validate(tool_input)` before constructing the result. All callers updated: `fmdb_ui/app.py` (attribute access throughout), `scripts/assess.py` (attribute access + `model_dump()` at JSON boundary), `anthropic-types.ts` (full TypeScript interfaces), `assess-client.tsx` (`SuggestionsView` takes typed `AssessSuggestions`). Sessions on disk remain plain `dict` — typed access when needed via `model_validate()`. Wire format unchanged — `model_dump()` at all JSON boundaries.
- **Item 5 — Improved backlog mining heuristic.** `mindmap_link.py`: `_GUESS_RULES` expanded from 13 to 60 entries (30 supplement markers — "herb ", "botanical", "vitamin", "mineral", "probiotic", "adaptogen", "ace inhibitors", "vasodilat", ...; 15 mechanism markers — "pathophysiology", "root cause", "driver", "dysfunction", "cascade", "axis", ...; 10 symptom markers; 15 topic markers). New `_guess_kind_from_label()` standalone function applies rules to a single label (not just parent chain). `_walk()` in `mine_unlinked` now falls back to `_guess_kind_from_label(node.label)` when parent chain gives `None` — reduces the 80% "default to topic" rate. `backlog-table-client.tsx`: `suggestTarget()` upgraded to 3-tier matching (exact label/slug/alias → slug substring → bidirectional partial label). `computeSuggestion()` uses 4-level cascade (parent label → item name → 4+ char words from name → `opts[0]` as last resort) — every backlog item now gets a suggestion chip regardless of name quality.
- Build + type-check clean. All 14 routes.

**v0.37** — Health data tracking: manual entry, editable form, snapshots & trends:
- **Manual health data entry panel** in Assess page (Step 2, alongside transcript upload):
  - Free-text textarea → "✨ Parse with AI" (Haiku) → populates editable form. Coach types anything: "weight 68kg, TSH 4.2 mIU/L, BP 118/76, on levothyroxine 50mcg, Hashimoto's" and it organises automatically.
  - "Open blank form" button — skips AI, opens `HealthDataEditor` directly for structured input.
- **`HealthDataEditor` React component** — fully editable before saving:
  - Lab values table (test name / value / unit rows — add/remove/edit)
  - Measurements grid (height, weight, waist, BP systolic/diastolic, HR — number inputs)
  - Medications list (add/remove/edit with doses)
  - Conditions list (add/remove/edit)
  - "💾 Save to client profile" button — deduplicates against existing profile data + appends immutable health snapshot
- **Editable form feeds from both transcript and manual entry** — `mergeHealthData()` helper deduplicates lab values (by test_name), measurements (non-null wins, b takes precedence), and string lists (case-insensitive dedup). Both entry paths write into the same `editableHealthData` state.
- **`health_snapshots: list[dict]` field** added to `Client` Pydantic model in Python. Each apply-call via `update-client-data.py` appends an immutable snapshot: `{date, source, measurements:{...}, lab_values:[...], medications:[...], conditions:[...]}`. Same-date+same-source deduplication on append.
- **Health trends section** on `/clients/[id]` page (appears automatically once snapshots exist):
  - **📈 Charts tab** — SVG sparklines (no extra dep) per metric: latest value + delta (±) vs previous + date. Covers weight, BP sys/dia, HR, waist + all verbally-reported lab values + FM computed ratios (colored cards from last assess).
  - **🗓 Timeline tab** — reverse-chronological cards per snapshot: date, source tag, all values captured that session.
- **New scripts:** `scripts/parse-health-text.py` (Haiku call on typed text → `ExtractedHealthData`), `scripts/update-client-data.py` (merge into profile + append snapshot).
- **New TypeScript:** `ExtractedLabValue`, `ExtractedMeasurements`, `ExtractedHealthData` interfaces in `anthropic.ts`; `parseHealthText()` + `ParseHealthTextResult`; `parseHealthTextAction()` + `applyTranscriptDataAction()` + `ApplyClientDataInput` Server Actions; `HealthTrends` client component in `src/app/clients/[id]/health-trends.tsx`; `health_snapshots` added to `Client` interface in `types.ts`.
- Build + type-check clean. All 14 routes.

**v0.36** — Assess UX overhaul + transcript symptom extraction:
- **Hierarchical symptom picker (`CategoryPicker`)** — two-level accordion: 8 categories (Digestive, Hormonal, Neurological, etc.) → concept clusters (e.g. "Depression / Low Mood" groups 5 variant slugs) → expandable sub-variants. Single-item clusters skip the expand button. 📞 badge on any symptom matched from transcript.
- **Formatted synthesis notes (`SynthesisNotes` component)** — splits AI output on `\n\n`, detects list items and section headers. No longer a wall of text.
- **Topics confidence %** — AI returns `confidence_pct` per topic suggestion (added to `topics_in_play` schema in `suggester.py`). Shown as a thin progress bar + percentage text below each topic chip. "💡 AI suggested" badge for topics not in the coach's original selections.
- **Session deduplication** — `assess.py` shim checks if a session for today's date already exists for the client; if so, updates in-place instead of creating a new one.
- **Lab marker ratio calculations** (`fmdb/assess/lab_ratios.py`) — `compute_ratios()` calculates HOMA-IR, TG/HDL, T3/T4, fT3/rT3, LDL/HDL, transferrin saturation, hsCRP, B12, Vitamin D from `extracted_labs`. Returned as `computed_ratios` in `AssessResult`. `ComputedRatiosCard` component shows 🟢/🟡/🔴 flagged ratios prominently on the Assess results page.
- **Client quick snapshot panel** on `/clients/[id]` page — compact card above the action bar showing: age/sex/intake + days ago, conditions as Badge chips, medications, allergies, goals, computed BMI, latest lab markers with colour dots.
- **Transcript upload** (📞 Upload consultation transcript, Step 2 of Assess):
  - `scripts/extract-symptoms.py` — Haiku call accepts `.txt`/`.pdf` transcript; extracts matched symptom slugs + supporting quotes + structured health data (lab values, measurements, medications, conditions).
  - `extractSymptomsFromTranscript()` + `extractTranscriptAction()` — saves upload to temp dir, calls shim, cleans up.
  - Found symptoms auto-merged into `selectedSymptoms`; health data flows into the editable `HealthDataEditor`.
  - Toast summarises all findings: "Extracted from transcript: 5 symptoms, 3 lab values, 1 medication, 1 condition".
- **Port note:** `fm-database-web` runs on port **3002** (port 3000 occupied by another app on this machine).
- Build + type-check clean. All 14 routes.

**v0.35** — Fix "Analyse with AI" max_tokens truncation error:
- **Root cause confirmed.** Two compounding issues caused "assess.py produced no output. stderr:":
  1. `synthesize()` in `fmdb/assess/suggester.py` used `messages.create()` (blocking/non-streaming) with `max_tokens=8192`. A real assessment call generates ~10,870 output tokens and takes **~3m24s** (measured). The old 90s `execFile` timeout in `runAssess` reliably killed the Python process mid-response, before `json.dump` ran → stdout empty → "produced no output".
  2. When `max_tokens=8192` was hit exactly (stop_reason: max_tokens), the tool-use JSON payload was truncated → unparseable.
- **Fixes applied:**
  - Switched `synthesize()` to `messages.stream()` + `get_final_message()` — same pattern as the ingest extractor. More robust for long-running connections.
  - Bumped `synthesize()` default to `max_tokens=16000` (Anthropic supports up to 16K on claude-sonnet-4-x).
  - Bumped `runAssess` timeout from 90s → 360s (6 min). At ~53 tokens/sec, a 16K-token response takes ~300s; 360s gives safe headroom.
- No wire-format changes — `AssessResult` shape is identical.

**v0.34** — Assess page UX fixes + Clients workflow:
- **Invisible symptom/topic pickers fixed.** Root cause: `MultiSelect` with `showOnEmpty` renders an `absolute`-positioned floating dropdown that was hidden behind the next Card's background. New `InlinePicker` component renders a search input + scrollable checkbox list in normal document flow (no `absolute`, no z-index). All 143 symptoms / 110 topics visible immediately; typing filters inline. Selected items shown as removable chips above the list.
- **Lab upload moved to step 3** (was step 5, unreachable once steps 2+3 appeared broken). New order: Client → Symptoms → Lab reports + food journals → Topics → Presenting complaints → Analyze. Upload inputs no longer disabled on load (client is always pre-selected).
- **Clients page blank-space fixed.** `NewClientForm` was inside a `flex justify-between` header row — when expanded, it created a tall card on the right while the left was nearly empty. Moved the form to its own full-width block below the title. Collapsed state shows a right-aligned `+ New client` button; expanded state fills full width.
- **Client detail page workflow.** New action bar at the top: "🧠 Run assessment" (→ `/assess?client=<id>`) and "+ New plan". Uploaded files card lists `clients/<id>/files/` contents. Assess page reads `?client=<id>` search param and pre-selects that client in the picker.

**v0.33** — Backlog triage UX: real-use bugs fixed + Attach feature + inline suggestion chips:
- **Mermaid syntax fixed.** Mermaid v11.14.0 rejected `[Label [type]]` nested brackets in curated mindmap nodes. Fixed in `fmdb/assess/mindmap.py`: badge format changed from `f"{label} [{badge}]"` to `f"{label} · {badge}"` (middle-dot separator is safe inside any shape).
- **Clients page overhauled.** Was fully read-only — no way to add a client, no clickable rows. Fixed:
  - New `app/clients/actions.ts` Server Action `createClient()` shells out to `fmdb client-new`.
  - New `app/clients/new-client-form.tsx` collapsible form (Client ID, display name, intake date, age band, sex, conditions, medications, allergies, goals, notes). Redirects to new client detail page on success.
  - Every cell in the clients table is now wrapped in `<Link>` so clicking any row navigates to `/clients/<id>`.
  - `client_id` column on the Plans page also linked to `/clients/<id>`.
- **Backlog Attach action.** New third action alongside Promote + Reject. Lets coach tag a backlog fragment to an existing catalogue entity instead of creating a new stub. Three modes:
  - `claim` — creates a new Claim with `statement = item.name`, citing `vitaone-mind-map-tool` as source, linked to the target entity.
  - `alias` — appends the item name to `target.aliases` (topic / mechanism / symptom only — those are the only kinds with an `aliases` field on the Pydantic model).
  - `notes` — appends to `target.notes_for_coach` (supplement only).
  - Backend: new `fmdb backlog-attach` CLI verb in `fmdb/cli.py`; `fmdb/backlog.py` gains `mark_attached()` which flips status to `"attached"` and records `attached_as` + `attached_to`. Shim `scripts/backlog-action.py` extended with `action == "attach"` branch. Server Action `attachBacklogItem(input: AttachInput)` added to `actions.ts`.
  - UI: `AttachForm` component in `backlog-table-client.tsx` — mode selector, target kind selector, search-filtered entity list (pre-filled from parent-chain heuristic). Mode-validation messages (alias → only topic/mech/symptom; notes → only supplement).
- **Inline suggestion chips.** Each open backlog row now shows a 💡 chip under the item name before the coach opens any disclosure:
  - `computeSuggestion(item, catalogue)` derives target kind from item.kind, finds target entity via `parseParentLabel(why)` + `suggestTarget()` (exact → alias → partial match), picks mode (alias when ≤ 3 words + no verb pattern + aliases-capable kind; claim otherwise).
  - Clicking the chip pre-fills and auto-opens `AttachForm` with the suggested mode/kind/slug already selected. Coach just confirms or tweaks.
  - `AttachForm` refactored to accept `initialOpen / overrideMode / overrideTargetKind / overrideTargetSlug` props; rows extracted into `BacklogRow` component (valid hook scope) which bumps a `key` on chip-click to force remount with fresh state.
  - `BacklogItem` type gains `attached_as` + `attached_to` fields; attached rows display `→ mechanism/hpa-axis-dysregulation` in the status cell.
- Type-check clean throughout.

**v0.32** — Catalogue detail pages for the remaining 6 kinds + Source listing bugfix:
- **Detail renderers landed for** Mechanism, Symptom, Claim, Source, CookingAdjustment, HomeRemedy. Joins the existing Topic + Supplement renderers — `/catalogue/[kind]/[slug]` now renders all 8 kinds with structured field views.
- **Latent Source bug fixed.** Source records on disk use `id` (not `slug`) and `quality` (not `source_quality`); the catalogue listing was producing `/catalogue/sources/undefined` links because the table normalization didn't synthesize a `slug`. Fixed in `src/app/catalogue/page.tsx` — Source rows now get `slug: s.slug ?? s.id`. Type also updated.
- **TypeScript types tightened to match Python** for the affected entities (`Mechanism`, `Symptom`, `Claim`, `Source`, `CookingAdjustment`, `HomeRemedy`): added missing fields (`sources`, `evidence_tier`, `summary`, `linked_to_mechanisms`, `linked_to_supplements`, `publisher`, `doi`, `id`, etc.). Pydantic still owns validation; types just describe what the renderer actually reads.
- **Cross-link chips.** New `LinkedChipList` helper renders catalogue references as clickable chips into other catalogue detail pages. Used for related_topics / linked_mechanisms / linked_supplements / source citations across all renderers — the catalogue is now navigable as a graph instead of a leaf-only browse.
- **Symptom severity + Source quality get colored badges.** `red_flag` symptoms get destructive-variant badges; `low`-quality sources likewise. Subtle but useful when the coach scans.
- Smoke-test: all 8 routes return 200 against real catalogue data. Type-check + build clean. MD5 of real client plan unchanged.

**v0.31** — Path B polish + engine API typed return shapes:
- **Mermaid renderer for `/mindmap/[slug]`.** New `scripts/render-mindmap.py` shim wrapping `fmdb.assess.mindmap.curated_to_mermaid`. New `mindmap-mermaid.tsx` client component dynamic-imports `mermaid` (`await import("mermaid")` inside `useEffect` — keeps the ~1MB lib off SSR). Brand-palette `themeVariables` (greens). View toggle flips between Mermaid render and the existing nested-`<ul>` outline. Falls back to outline on Mermaid render error. Hypertension stress test: 388 lines / 14.5K chars of Mermaid source returned in ~0.6s.
- **Bulk backlog actions.** New `backlog-table-client.tsx` with `useState<Set<string>>` selection, leftmost checkbox column, header "select all visible" (only `status === 'open'`), sticky toolbar with selection count + reject-reason input + Bulk Reject + Mark X as Added (status flip without stub creation — useful when coach already authored manually). Two new Server Actions loop the existing single-item shim sequentially (parallelizing N python procs would thrash the validator). New `mark_added` action in `scripts/backlog-action.py` calls `fmdb.backlog.update_status` directly to avoid inventing a CLI verb.
- **Error toasts everywhere.** `sonner` installed; `<Toaster richColors closeButton position="top-right" />` in root layout. Toast calls plumbed into every Server Action that returns `{ok: false}`: lifecycle (submitPlan / publishPlan with "Plan published v<N>" success / revokePlan / supersedePlan / diffPlans / renderPlan / createSuccessor), plan editor (updatePlan: "Plan saved" success + error), assess (runAssess / generateDraft with "Draft plan created at <slug>" success / chatAction / loadSessionChat). Inline messages preserved on the lifecycle panel (dual-channel: toast is ephemeral, inline persists).
- **Chat auto-scroll.** `scrollRef` + `isFirstScroll` flag ref + `useEffect([history.length])` — `behavior: "instant"` on rehydration, `"smooth"` on new turns. Same effect handles both paths.
- **Engine API cleanup — typed return shapes.** `fmdb.assess.suggester` was returning untyped `dict[str, Any]` and both callers (Streamlit + Next.js shim) had to know magic key names. New module `fmdb/assess/results.py` with `AssessUsage`, `AssessResult`, `ChatResult`, `ChatContext` Pydantic models. `synthesize()` and `chat()` now return typed models with full docstrings. `chat()` accepts either a `ChatContext` or a dict (auto-coerced via `model_validate` with `extra='ignore'`). Prompts / cache strategy / tool schema unchanged.
- **Both callers updated in lockstep.** `fmdb_ui/app.py` switched to attribute access (`result.suggestions`, `out.reply`, `out.usage.input_tokens`). Shims `assess.py` + `chat.py` call `.model_dump()` at the JSON boundary so the wire format is byte-identical — TypeScript types in `anthropic-types.ts` untouched.
- Build + type-check clean. **14 routes** generating. MD5 of real client plan unchanged.
- TODOs deferred: nest the inner `suggestions` payload (likely_drivers, supplement_suggestions, etc.) as Pydantic too — requires migrating `Session.ai_analysis: dict` to typed model on disk + rewriting all string-keyed reads.

**v0.30** — Path B turn 4: lifecycle in UI + cleanup hardening + 4 new pages:
- **Lifecycle transitions wired into the UI** (no more drops to CLI). New `app/plans/[slug]/lifecycle-actions.ts` Server Actions: `submitPlan`, `publishPlan`, `revokePlan`, `supersedePlan`, `diffPlans`, `renderPlan`, `createSuccessor`. New shims `scripts/plan-lifecycle.py` (dispatches by action; catches `RuntimeError`/`ValueError`/`FileNotFoundError` and emits `{ok: false, error}`) and `scripts/plan-render.py` (wraps `render_markdown` / `render_html` with attached resources).
- New `lifecycle-panel.tsx` client component renders ABOVE the editor (full width — irreversible actions are coarser-grained than per-tab edits): header strip with status badge / version / catalogue snapshot date / git SHA, reverse-chronological status_history timeline, state-aware action sections (draft → Submit; ready_to_publish → Publish with irreversible-confirm checkbox; published → Revoke (required reason + checkbox + destructive variant) AND Successor box ("Create successor draft" + "Publish + supersede"); superseded/revoked → read-only banner). Diff viewer with two slug `<Select>`s. Client-export buttons (Markdown / HTML download + Preview).
- **Cleanup hardening** (one focused turn caught a real latent bug):
  - **Patch type tightened.** Split `Plan` into strict `PlanFields` (no index signature) + permissive `Plan extends PlanFields` (kept for lifecycle-actions ad-hoc field add). New `PlanPatch = Partial<PlanFields>` strict mapped type. `{lifestyle: []}` now errors at compile. **Surfaced one latent typo:** `plan-editor.tsx:683` Lifestyle Remove called `patch("lifestyle", ...)` instead of `patch("lifestyle_practices", ...)`. Fixed.
  - **MultiSelect dedup** (~90-line inline copy in `assess-client.tsx` removed). The two APIs differed meaningfully — shared used `{value, label}` chip-style; inline used `{slug, label, aliases}` checkbox-list with alias-aware filter. Reconciled by extending the shared component (added optional `aliases`, `label`, `showOnEmpty`); kept canonical `value/label`; assess uses a tiny adapter.
  - **Chat history auto-rehydration.** New `scripts/load-session-chat.py` shim + `loadSessionChatHistory` Server Action + `useEffect` keyed on `[clientId, sessionId, dryRun]` with `current.length === 0` guard so in-flight messages aren't clobbered, and an `ignore` flag to cancel stale fetches when session changes mid-flight.
- **Four new pages** (Path B finally has feature parity with the Streamlit sidebar):
  - **`/clients`** — table with id / age_band / sex / intake / # conditions / # active plans (filtered to draft/ready/published buckets). Detail page: two-column Bio/Clinical cards (handles both `medications`/`current_medications` + `allergies`/`known_allergies` field shapes), Plans table linking to `/plans/<slug>`, Sessions table.
  - **`/resources`** — 31 VitaOne records load. Filter form (kind / audience / text search) wired via URL search params. Detail picks among URL link / file_path basename + Finder hint / inline `<pre>` text; related-* badge cards link to catalogue.
  - **`/mindmap`** — list of 3 curated MindMaps with linked-vs-unlinked node counts. Detail uses **Option B** (nested `<ul>` with left border + indentation, kind-prefixed colored chips on linked nodes) — Mermaid (Option A) deferred as yak-shave for a 4-pages turn. Renders 388-node hypertension map without trouble.
  - **`/backlog`** — default `status=open`. Status pills + kind dropdown + search. Per-row Promote (`<details>` disclosure with kind override / slug / display_name pre-filled / force checkbox) and Reject (optional note) — both shell out via new `scripts/backlog-action.py` → `fmdb backlog-promote|reject` → `revalidatePath`.
- New `lib/fmdb/loader-extras.ts` (Resource / ClientWithMeta + sessions / MindMapFull + node counter / BacklogItem loaders) — kept separate from `loader.ts` to avoid 3-way concurrent edit conflict.
- Sidebar gets 4 new entries: 👥 Clients, 🧰 Resources, 🧭 Mind Map, 📝 Backlog.
- Build + type-check clean. **14 routes** generating. MD5 of real client plan unchanged on all three tracks.

**v0.29** — Path B turn 3: Plan editor complete + plan-check sidebar + Assess chat panel:
- **Plan editor 10/10 tabs wired.** The 4 stubbed tabs from v0.28 finished: Lifestyle (`PracticeItem`), Education (`EducationModule` with kind-scoped slug picker that clears when target_kind changes; topics/mechanisms via dropdown, claim freeform pending a claim picker), Labs (`LabOrderItem`), Referrals (`ReferralItem` with native urgency dropdown using `routine|soon|urgent|emergency` from the enum). Nutrition `add[]` and `reduce[]` editors added via a new local `FreeformStringList` helper.
- **Real bug caught at runtime, not type-check:** the editor was binding Lifestyle to `plan.lifestyle` but the model field is `lifestyle_practices`. The `Patch` type isn't strict enough — it typechecked as `Plan[K]` even though `lifestyle` isn't on `Plan`. Fixed during round-trip smoke test. **TODO:** tighten the Patch type next turn.
- **Plan-check sidebar.** New `scripts/plan-check.py` JSON shim around `fmdb.plan.checker.check_plan` (mirrors the assess.py pattern). New `plan-check-panel.tsx` is a sticky right-rail panel — Run/Refresh button → 3 colored severity groups (red CRITICAL / amber WARNING / blue INFO) collapsing on click. Page laid out as `xl:grid-cols-[minmax(0,1fr)_320px]`.
- **Multi-turn chat panel on `/assess`.** New `scripts/chat.py` shim around `fmdb.assess.suggester.chat()` (note: actual function name is `chat`, not `ai_chat` as CLAUDE.md previously claimed). Loads client + session, rebuilds the same `client_ctx` + `subgraph` that the original Analyze saw, calls `chat()`, persists both turns into `session.chat_log` via `update_session`. Has `--dry-run` mode.
- New `runChat` Server Action wraps `execFile` (60s timeout). New `ChatTurn` / `ChatInput` / `ChatResult` types in `anthropic-types.ts`. New `ChatPanel` sub-component in `assess-client.tsx`: scrollable 400px message list, user/assistant bubbles, per-assistant token telemetry caption, textarea with Enter-to-send / Shift+Enter for newline, spinner while pending. Mounted only when `result.session_id` is set (i.e. after a successful Analyze).
- **Persistence path:** client `useState<ChatTurn[]>` → `chatAction` → `runChat` → `chat.py` → `update_session` → `~/fm-plans/clients/<id>/sessions/<sid>.yaml#chat_log`.
- Build + type-check both clean. 7 routes generating. Round-trip smoke tests on real client data with MD5-verified backup-restore on both tracks; final MD5 matches original.
- TODOs for next turn: tighten Patch type; auto-rehydrate chat history from session YAML on page load; auto-scroll chat to latest; Claim picker for Education tab; dedup `MultiSelect` (assess-client.tsx still has its own inline copy — `components/multi-select.tsx` has the breadcrumb).

**v0.28** — Path B turn 2: Plan editor + Assess workflow in Next.js:
- **Plan editor** (`fm-database-web/src/app/plans/[slug]/`):
  - New `lib/fmdb/writer.ts` — `writePlan()` with bucket routing (drafts/ready/published/superseded/revoked), versioned filenames where appropriate, cross-bucket cleanup so a status change doesn't leave orphans, ISO `updated_at` bump.
  - New `actions.ts` Server Action `updatePlan(slug, patch)` — re-loads canonical plan first to avoid clobbering concurrent edits, refuses non-draft writes, calls `revalidatePath('/plans')` + `revalidatePath('/plans/[slug]')`.
  - New `plan-editor.tsx` client component with all 10 tabs. Fully wired: Assessment (3 multi-selects + driver list-of-objects), Supplements (full SupplementItem editor), Tracking (habits + monitor symptoms + recheck questions), Nutrition (pattern + meal_timing + cooking + remedies), Resources (multi-select), Notes & Raw. Stubbed: Lifestyle, Education, Labs, Referrals (all list-of-Card pattern, copy from Supplements).
  - New `components/multi-select.tsx` — shared search-as-you-type picker (slug stored, label shown). Used in 7 places.
  - Editor locked when `status != 'draft'`.
  - Round-trip smoke test: edited `notes_for_coach` on a real draft, confirmed YAML write + `updated_at` bump, restored from MD5-verified backup. Final MD5 matches original.
- **Assess & Suggest workflow** (`fm-database-web/src/app/assess/`):
  - **Architectural decision: shell out to Python.** New `scripts/assess.py` and `scripts/generate-draft.py` — thin stdin/stdout JSON shims that import `fmdb.assess.suggester.synthesize` and `fmdb_ui/app.py::generate_plan_from_suggestions`. Avoids re-implementing prompt cache + tool-use in TS; keeps Python as the single source of truth for AI calls.
  - New `lib/fmdb/anthropic.ts` (Server Actions: `runAssess`, `generateDraftFromSuggestions`, `saveClientUpload`) shells out via `execFile`, 90s timeout, 32MB maxBuffer. Pure types split into `anthropic-types.ts` (Next 16 forbids non-async exports from `'use server'` files).
  - New `app/assess/page.tsx` (RSC loads symptoms + topics + clients in parallel) + `assess-client.tsx` (interactive UI with file uploaders + per-suggestion include checkboxes + draft-generation button that redirects to `/plans/<slug>`).
  - Sidebar-nav gets "🧠 Assess" link.
  - Smoke test: dry-run shim returned `ok=true`, session persisted, generate-draft produced a clean draft YAML; test artifacts removed.
- **Build + type-check both clean.** Routes: `/`, `/catalogue`, `/catalogue/[kind]/[slug]`, `/plans`, `/plans/[slug]`, `/assess` all building.
- **Known surprise:** `subgraph_size_bytes` for one symptom + one topic was ~680KB JSON — much bigger than the 35K-token CLAUDE.md estimate. Worth profiling if real-world cost feels off (the size is bytes-of-JSON, not tokens — but still worth a look).
- **TODOs for next turn:** Lifestyle/Education/Labs/Referrals tabs (same Card pattern as Supplements), nutrition `add[]`/`reduce[]` editors, multi-turn chat panel, session timeline on `/assess`, plan-check sidebar (shell out to `fmdb plan-check`), evidence-tier badges on suggestion items, catalogue-additions backlog auto-capture, refactor `MultiSelect` (Assess agent built a local copy not knowing the Plan-editor agent had built a shared one — small dedup).

**v0.27** — Backlog triage CLI (clean / show / promote / reject):
- 5 new CLI commands for working through the 612-item backlog from v0.25:
  - `fmdb backlog-list [--status open|added|rejected|all] [--kind X] [--search S] [--limit N]` — browse, sorted by `seen_count` desc.
  - `fmdb backlog-show <id>` — full YAML record (incl. `session_refs`).
  - `fmdb backlog-clean [--apply]` — heuristic auto-reject obvious prose/noise. Rules: > 5 words, contains verb-like tokens (` and `, ` is `, ` lowers `, ` triggers `, ...), ends in `?`/`.`, looks like a stat (`50% rise...`). Dry-run by default.
  - `fmdb backlog-promote <id> [--kind X] [--slug X] [--display-name X] [--force]` — promote a backlog item to a stub catalogue YAML and mark `added`. `--kind` overrides the miner's kind classification (which defaulted to `topic` for ~80% of mined items, often wrongly). Stub schema is kind-aware: `aliases` only on entities-that-have-aliases (topic/mechanism/symptom — NOT supplement); supplement stubs auto-cite `vitaone-mind-map-tool` with the mining context as `location` so the validator's "no sources cited" check passes.
  - `fmdb backlog-reject <id> [--note X]` — explicit reject.
- **First triage pass run:**
  - `backlog-clean --apply`: 167 items auto-rejected as noise (47 with > 6 words, 20 with ` to `, 20 with ` and `, etc.).
  - First test promotion: `Garlic` (mined under hypertension MindMap → "ACE Inhibitors (Foods)") promoted as supplement stub. Catalogue size: 171 → 172 supplements. 0 errors after promotion.
  - **Remaining: 444 open items** awaiting manual triage (363 topic, 48 supplement, 19 mechanism, 14 symptom).

**v0.26** — MindMap link/mine apply pass + Path B scaffold (Next.js + shadcn):
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
  fmdb_ui/
    app.py                        # Streamlit single-file UI (Path A — primary
                                  #   surface through v0.25; still maintained as
                                  #   fallback). 7 sidebar pages: Assess & Suggest,
                                  #   Plans, Clients, Mind Map, Resources Toolkit,
                                  #   Catalogue Browser, Catalogue Backlog.
                                  #   Auto-evicts stale fmdb modules from
                                  #   sys.modules on each rerun.
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
  requirements.txt                # pydantic, pyyaml, anthropic, python-dotenv, streamlit
  run-fmdb.sh                     # robust launcher — kills zombies, clears pycache,
                                  #   disables runOnSave, then starts streamlit
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
    components/                   # sidebar-nav, evidence-tier-badge,
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
                                  #     pairs with ?pr=vita13720sh referral appended
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
  src/app/catalogue-commit-button.tsx # Amber banner "📚 N uncommitted". Auto-hides.
  src/app/backlog/supplement-links-actions.ts  # CRUD for ~/fm-plans/supplement_links.yaml
  src/app/backlog/supplement-links-client.tsx  # Table + AddLinkForm for affiliate URLs
  src/app/sources/
    page.tsx                      # RSC — /sources route; renders <SourceClient />
    source-client.tsx             # "use client" — full source form (ID, title, type,
                                  #   quality, authors, year, publisher, URL, DOI,
                                  #   notes). On save: calls saveSourceAction, shows
                                  #   success badge linking to /catalogue/sources/{id}.
    actions.ts                    # saveSourceAction — uses runShim from shim.ts.
                                  #   Revalidates /catalogue + /sources.
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
    client-contact-widget.tsx     # inline-editable email + mobile + next_contact_date
    health-trends.tsx             # SVG sparklines + snapshot timeline
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
    check-in-form.tsx             # Check-in workflow (adherence rating, lab orders,
                                  #   Five Pillars capture, appends to plan.notes_for_coach)
    five-pillars-capture.tsx      # "use client" — compact 5-col widget (😴🧘🏃🥗🤝).
                                  #   RatingChips (1–5, color-tiered, invert=true for stress)
                                  #   + DayChips (0–7). FivePillarsData type exported.
                                  #   Shows info message when non-empty. Clear button.
    follow-up-draft-panel.tsx     # "use client" — post-session WhatsApp draft panel.
                                  #   States: idle→loading→done|error. idle: green banner
                                  #   + "Draft message" button. done: editable <textarea>
                                  #   pre-filled with Haiku draft + "📋 Copy" (clipboard)
                                  #   + "Regenerate" link. Shown in client-tabs.tsx below
                                  #   "Session saved" banner for non-full-assessment types.
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

### Path A — Streamlit UI (fallback, still maintained)
```bash
./run-fmdb.sh                                # opens http://localhost:8501
```
Same 7 sidebar pages — useful if Path B breaks during a turn.

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
- ✅ **🔗 VitaOne affiliate links** — 158-keyword catalog, `?pr=vita13720sh` on all URLs. Priority chain: custom → VitaOne → Amazon → iHerb → none.
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
