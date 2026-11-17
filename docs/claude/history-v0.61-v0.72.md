# Work log, v0.61 → v0.72

> Moved verbatim out of the root `CLAUDE.md` on 2026-11-17 (original lines 514–980). Index: [`/CLAUDE.md`](../../CLAUDE.md).
> Covers: Intake form v2.2 + AI insights + intake_evidence, start-date confirmation (letter buttons, webhook parser — /start route since removed), effective start dates (+3d/+7d), intake web form + weekly poll, plan-editor rethink, v1→shared refactor, catalogue cleanup sweeps, /assess upgrades, FM markers, API spend tracker, protocols/ATM/drug depletions/lab tests, lab reference ranges, broadcast + templates.
> Version notes describe the code when written; newer entries in `invariants-v0.81-v0.91.md` and git history override older ones.

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
- Insights are auto-generated ONCE, then frozen. The Python submit handler (`_apply_submit` in `scripts/intake-token-action.py`) auto-fires a single Haiku call (`generate-intake-insights.py`, ~$0.005) only on the **first** submit — gated by `should_fire_insights = is_first_submit or not data.get("intake_insights")` (the second clause is a recovery fallback if the first fire failed / insights are missing). Re-submits do NOT auto-regenerate: intakes autosave and the token stays active for re-edits (Path A), so firing on every submit would bill a Haiku call per re-edit the coach never asked for. The guard landed in `060e465b` ("auto-fire gates"). **Re**generation is MANUAL (per coach decision): coach edits a structured field → insights stay frozen until coach taps 🔄 Refresh on IntakeInsightsCard (the `generateIntakeInsights` TS server action — the only button-only path). NOTE: `_apply_submit` is shared by `action_submit` AND the cron reconcile (`_reconcile_one` → `_apply_submit`), so the same first-submit guard governs both — the cron's first reconcile of a new submission is the first-generation site on the Mac authoritative store; it never re-fires on subsequent reconciles. Cross-machine de-dup: the Fly intake deployment (`FLY_INTAKE_ONLY=1`) is gated OUT of the auto-fire (`on_fly_intake` check in `_apply_submit`) because Fly-generated insights are never displayed (coach UI is Mac-only / Fly 404s coach routes) and the Mac reconcile regenerates them anyway — so a brand-new submit fires the Haiku call exactly once, on the Mac, not once per machine.

**v0.71** — Client-side start-date confirmation (3 patterns + reminder panel):

Building on v0.70's coach-side editor. Three independent layers let the client confirm or change their actual meal-plan start date, each requiring less infra than the next. All three stack cleanly:

**Pattern A — Letter explicitly names the date + invites WhatsApp pushback** (`render-client-letter.py`):
- `_start_when_block()` rewritten with `_human()` formatter (turns YYYY-MM-DD into "Sunday 17 May 2026"). Each scope (`meal` / `supplement` / `both`) now contains a `GREETING REQUIREMENT` instruction that forces the AI to name the start date in **bold** and invite pushback ("If that day doesn't suit you, just reply to this WhatsApp with the date you'd prefer and I'll shift everything.")
- Coach-confirmed mode (when `meal_plan_started_on` is set): warmer language, no re-invitation to push back ("Now that Day 1 is locked in for Tuesday 19 May...").

**Pattern B — WhatsApp buttons in the printed letter HTML** (`brand_html.py` + `src/lib/start-date-parser.ts` + webhook):
- New `_start_date_buttons_html()` injects up to 3 `wa.me` deep-link buttons into the letter directly below the title block. Pre-composed structured messages:
  - `✅ Yes — {date} works` → `wa.me/918976563971?text=✅%20START:%20YYYY-MM-DD%20[plan:%20<slug>]`
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
- The four `wa.me` confirm/edit/supps buttons all point to the coach's number (`918976563971` — hardcoded in `brand_html.py` matching the existing footer link). If the coach number changes, update in both places.
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
