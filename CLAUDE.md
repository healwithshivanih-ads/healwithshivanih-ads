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

**v0.62 (current)** — Lab reference ranges + custom protocol templates + AiSensy broadcast + message templates + session brief quick note:

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
9. **MindMap** — hand-curated clinical mind maps (11 entries: 3 vitaone-scraped + 8 new curated; 1,612 nodes, 355 linked)

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
    app/                          # 22 routes: /, /catalogue, /catalogue/[kind]/[slug]
                                  #   (all 8 kinds), /plans, /plans/[slug] (10-tab
                                  #   editor + plan-check sidebar + lifecycle panel +
                                  #   client-facing export), /assess (Analyze + chat),
                                  #   /clients (+ detail), /resources (+ detail +
                                  #   /resources/generate), /mindmap (+ detail with
                                  #   Mermaid), /backlog (with bulk actions +
                                  #   Supplement Links tab), /sources (Add Source),
                                  #   /search, /ingest.
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
                                  #   Server Action that shells out to Python).
  scripts/                        # Python shims — all use fm-database/.venv,
                                  #   all stdin/stdout JSON.
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

## Chat-ingest vs dashboard-ingest API policy (2026-05-18)

**Hard rule:** when a document, dataset, or analysis request comes through **this chat**, Claude does the work using session context (Read tool, ToolSearch, file I/O) — **never invokes the fmdb ingest pipeline or any Anthropic API call**. The Anthropic API monthly cap is reserved for in-app workflows where the coach (or a client) triggers extraction from the dashboard UI.

**Why:** the Anthropic API has a hard monthly cap; bursting through it locks every dashboard-side feature (intake auto-insights, plan-publish letter generation, plan-chat, AI sanity check, assess synthesis, transcript extraction, render-client-letter, etc.) until reset. Chat sessions have a separate budget and shouldn't compete.

| Origin | Path | API used? |
| --- | --- | --- |
| Coach drops a PDF / image / paste into THIS chat | Read tool → structured output → write to staging → approve | **NO** |
| Coach asks "analyse client X" or "rerun the report" in chat | Use session context, write to client.yaml / sessions directly | **NO** |
| Coach asks "extract symptoms from this transcript" in chat | Read tool → write extracted-symptoms YAML directly | **NO** |
| Coach uploads via `/ingest` in fm-coach UI | `fmdb ingest` Python pipeline → `messages.stream()` | YES |
| Plan publish auto-fires letter generation | `render-client-letter.py` → API | YES |
| Zoom recording.completed webhook | `processZoomRecording` → extract-symptoms.py → API | YES |
| Intake form submit auto-fires insights | `generate-intake-insights.py` → API | YES |
| Plan-chat assistant call from plan editor | `chat.py` → API | YES |
| Assess synthesis from /assess page | `assess.py` → API | YES |
| AI sanity check on a plan | `plan-ai-check.py` → API | YES |
| PubMed evidence brief generator at /resources/generate | `generate-info-pack.py` → API | YES |

### The chat-ingest pattern (proven 2026-05-18, batch `20260518T070000-pizzorno-autoimmune-thyroid-chat`)

When the coach pastes a path to a PDF/document in chat and says "ingest this" / "extract from this" / "fill in the gap with this":

1. Read the document via the Read tool. For large PDFs, extract via pypdf to text first (`.venv/bin/python -c "from pypdf import PdfReader; ..."`); for smaller ones read directly (max 20 pages per Read call).
2. For each chunk, produce the same structured catalogue output the fmdb extractor would (topics / mechanisms / claims / symptoms / supplements, all with citations to the source, evidence_tier set, slugs canonical).
3. Write the YAML files directly into `fm-database/data/staging/<batch-id>/<entity>/<slug>.yaml`.
4. Generate `_meta.json` (tiny Python loop over the staged dirs — see batch `20260518T070000-pizzorno-autoimmune-thyroid-chat/_meta.json` for the exact shape).
5. Run the bidirectional alias-collision sweep (same Python block embedded in `scripts/run-pizzorno-queue.sh`).
6. Run `fmdb approve <batch-id> --update` — pure-Python validation + smart-merge, **no API**.
7. Commit + push as usual.

**Output rules (same as the fmdb pipeline produces):**
- Claims ≤ 2 sentences, paraphrased, cited.
- Mechanism summaries are short structured prose (~150 words max), my own technical wording.
- All entries cite the source via `sources: [{id, location, quote}]`.
- Never reproduce long verbatim passages. The extractor's job is to *transform* into a structured index.

**Pydantic + YAML gotchas surfaced across the 2026-05-18 chat-ingest sweep (7 batches):**
- `Supplement.contraindications` is a `Contraindications` model: `{conditions: [str], medications: [str], life_stages: [str]}` — **not** a flat list. A plain list of strings fails Pydantic validation on promote.
- `MedicationInteraction` requires `{medication, type, reason}` where `type` ∈ `avoid_together | space_by_hours | take_together`.
- `Supplement.timing_options` enum: use `on_waking | on_empty_stomach | morning | mid_morning | with_breakfast | with_lunch | mid_afternoon | with_dinner | evening | bedtime`. **Not** `with_meals` (use `with_breakfast/lunch/dinner` instead).
- `Supplement.forms_available` enum: `capsule | powder | tablet | liquid | gummy | lozenge | whole_food`. **Not** `tea_bag` (map herbal teas to `whole_food`).
- `Supplement.category` enum: `mineral | vitamin | herb | amino_acid | probiotic | fatty_acid | enzyme | other`. **Not** `lipid_extract` (use `other`).
- `Supplement.take_with_food` enum: `required | optional | avoid`. **Not** `with_food` (use `required`).
- **YAML scanner trap:** a bare `Dose: ` inside an unquoted scalar (e.g. inside a `quote:` field) breaks parsing with `mapping values are not allowed here`. Either single-quote the whole string, or replace the colon with an em-dash (`Dose — `) — the latter is faster than re-typing.
- **Common alias-collision pattern:** new topics often have an alias matching an existing canonical slug from another entity kind (e.g. `joint-pain` topic vs `joint-pain` symptom). The bidirectional sweep auto-strips these from the staging side; nothing further needed.
- Approving with `--update` is mandatory; smart-merge unions topic links + cite lists.

**Reusable chat-ingest scaffold** (copy this Python block to skip 50% of the per-batch boilerplate; replace `BATCH`, `SOURCE_ID`, `SOURCE_TITLE`, pages):
```python
import yaml, pathlib, re, os, json, datetime, sys
DATA = pathlib.Path("data"); STAGED = DATA / "staging" / os.environ["BATCH"]
ok = True
for f in STAGED.rglob("*.yaml"):
    try: yaml.safe_load(f.read_text())
    except Exception as e: print(f"FAIL {f.name}: {e}"); ok = False
if not ok: sys.exit(1)
entries = []
for kind in ["sources","topics","mechanisms","symptoms","claims","supplements"]:
    d = STAGED / kind
    if not d.exists(): continue
    for f in sorted(d.glob("*.yaml")):
        entries.append({"entity": kind, "slug": f.stem, "status": "new",
                        "path": f"staging/{os.environ['BATCH']}/{kind}/{f.name}"})
(STAGED / "_meta.json").write_text(json.dumps({
    "batch_id": os.environ["BATCH"], "source_id": os.environ["SOURCE_ID"],
    "source_title": os.environ["SOURCE_TITLE"], "source_type": "textbook",
    "doc_hash": "chat-ingest", "doc_chars": 0,
    "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "updated_by": "Shivani",
    "usage": {"model": "chat-ingest-no-api", "stop_reason": "manual",
              "input_tokens": 0, "output_tokens": 0,
              "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
    "entries": entries,
}, indent=2))
# Bidirectional alias-collision sweep
def slug(s): return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
for kind in ("symptoms", "topics", "mechanisms", "supplements"):
    if not (STAGED / kind).exists(): continue
    slugs, staged = set(), set()
    for p in (DATA / kind).glob("*.yaml"):
        d = yaml.safe_load(p.read_text()) or {}
        if d.get("slug"): slugs.add(d["slug"])
    for p in (STAGED / kind).glob("*.yaml"):
        d = yaml.safe_load(p.read_text()) or {}
        if d.get("slug"): slugs.add(d["slug"]); staged.add(d["slug"])
    for p in (STAGED / kind).glob("*.yaml"):
        d = yaml.safe_load(p.read_text()) or {}
        own, al = d.get("slug"), d.get("aliases") or []
        keep = [a for a in al if not (isinstance(a, str) and slug(a) != own
                                       and (slug(a) in slugs or a in slugs))]
        if len(keep) != len(al):
            d["aliases"] = keep
            p.write_text(yaml.safe_dump(d, sort_keys=False, allow_unicode=True))
    for p in (DATA / kind).glob("*.yaml"):
        d = yaml.safe_load(p.read_text()) or {}
        if d.get("slug") in staged: continue
        al = d.get("aliases") or []
        keep = [a for a in al if not (isinstance(a, str)
                                       and (slug(a) in staged or a in staged))]
        if len(keep) != len(al):
            d["aliases"] = keep
            p.write_text(yaml.safe_dump(d, sort_keys=False, allow_unicode=True))
print(f"{len(entries)} entries staged + swept")
```
Then: `.venv/bin/python -m fmdb.cli approve <batch-id> --update`. The `--update` flag is mandatory; smart-merge unions topic links and cite lists when the slug already exists canonically.

**Large-PDF read pattern:** for PDFs > ~30 pages, extract to text via pypdf first (Read tool can struggle with image-heavy or large PDFs):
```python
from pypdf import PdfReader; import pathlib
r = PdfReader('/path/to/file.pdf')
sep = "\n\n"
out = [f"--- pg {i+1} ---\n{r.pages[i].extract_text()}" for i in range(len(r.pages))]
pathlib.Path('/tmp/extracted.md').write_text(sep.join(out))
```
Then `Read /tmp/extracted.md` in chunks. **Don't trust the queue script's page comments** — the actual chapter content may be at different source pages than the comment suggests (e.g. the queued `pizzorno-mood.pdf` turned out to be the book's index, not the affective disorders chapter; the real chapter was at pages 21-40 of the source PDF, which had to be re-extracted).

**Track record:**
- 2026-05-18: 7 chapters of Pizzorno's *Textbook of Natural Medicine* ingested via chat in a single session — autoimmune-thyroid, MS, RA, women's health, oxalate stones, sleep, affective disorders. Total: 83 new catalogue entries (7 sources, 5 topics, 10 mechanisms, 10 supplements, 49 claims). Zero Anthropic API calls. Validates the chat-ingest pipeline as a production fallback path.

**Quotas in practice:** the Anthropic API monthly cap was hit 2026-05-18 by earlier Pizzorno API-driven ingests (~$0.40–0.60 per batch × 6 batches plus other in-app activity since the cycle started). Until 2026-06-01 reset, every dashboard-side feature is blocked. The `run-pizzorno-queue.sh` queue runner is now defunct — those chapters have all been ingested via chat. For any new chat-dropped documents going forward, **always use the chat-ingest path above** unless the coach explicitly says "run through the dashboard pipeline."

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
**22 routes:** `/`, `/search`, `/catalogue` (+ all 8 detail kinds), `/plans` (+ 3-tab editor: Protocol/Documents/Lifecycle + plan-check sidebar + Markdown/HTML export + 📧 Send to client), `/assess` (Analyze + chat with auto-rehydrated history), `/clients` (+ detail with `?tab=overview|sessions|plan` deep-linking + add-client form + contact widget + check-in form + 📤 SendPackageButton + preferences editor), `/resources` (+ detail + `/resources/generate` PubMed evidence brief), `/mindmap` (+ Mermaid detail), `/backlog` (with bulk reject + mark-added + Attach action + per-row 💡 suggestion chips + 🔗 Supplement Links tab), `/ingest` (📁 file upload: PDF/MD/images + 🔗 URL tab + ⚡ Approve all pending button + per-batch Review/Approve/Reject), `/sources` (Add Source — form writes directly to fm-database/data/sources/).

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
- AiSensy webhook: unmatched phones → `~/fm-plans/_aisensy_unmatched.yaml` (append-only YAML list). Always returns 200. No client auto-creation.
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
- `AISENSY_API_KEY` env var (`.env.local`) gates `BroadcastPanel` on dashboard and enables 📤 Send in `MessageTemplatesPanel`. Without it, broadcast panel is hidden and send button is disabled. (v0.62)
- `broadcastAction` normalises phone to E.164: 10-digit numbers get `91` prefix. Sends to `backend.aisensy.com/direct-apis/t1/create-message`. Campaign name must match a registered AiSensy template exactly.
- `message_templates.yaml` at `~/fm-plans/message_templates.yaml`. Written with 5 defaults on first `loadMessageTemplatesAction` call. Fields: `{id, name, category, body, variables[]}`. (v0.62)
- `custom_templates/` at `~/fm-plans/custom_templates/{slug}.yaml`. Created by `saveAsTemplateAction`. Loaded by `loadCustomTemplatesAction` in assess. Selection prefix: `custom:{slug}`. (v0.62)
- `lab_reference_ranges` stored in `client.yaml` as `{marker: {optimal_low, optimal_high, unit}}`. Saved by `saveLabReferenceRangesAction`, loaded by `loadLabReferenceRangesAction`. `rangeStatus(value, range)` in `health-trends.tsx` returns `"optimal" | "outside" | null`. (v0.62)
- `checkSupplementInteractionsAction(planSlug)` in `plans/[slug]/actions.ts`: reads plan YAML → client YAML → each supplement's `fm-database/data/supplements/{slug}.yaml`. Checks `contraindications` field (array of strings) case-insensitively against `client.medications` + `client.current_medications`. Called on mount in `plan-editor.tsx`. (v0.61)
- `SessionDriver` and `SessionSupplement` interfaces in `assess/actions.ts`. `SessionSummary` now includes `likely_drivers?` and `supplement_suggestions?` extracted from `session.ai_analysis`. Used in `session-brief-modal.tsx`. (v0.61)

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
- ✅ Path B (Next.js + shadcn) — 22 routes, full feature parity + client letter
- ✅ Assess page: hierarchical CategoryPicker, topics confidence %, session deduplication, FM ratio calculations, client quick snapshot, formatted synthesis notes
- ✅ Transcript upload in Assess: extracts symptoms + lab values + measurements + medications + conditions via Haiku
- ✅ Manual health data entry in Assess: free-text → Haiku parse, OR blank editable form. Merge from both sources.
- ✅ Health snapshots stored per appointment on Client YAML (`health_snapshots: list[dict]`)
- ✅ Health trends section on Client detail page: SVG sparklines per metric + timeline tab
- ✅ Typed inner `suggestions` payload: 11 Pydantic sub-models, TypeScript interfaces, typed `SuggestionsView`
- ✅ Improved backlog mining heuristic: 60-entry `_GUESS_RULES`, `suggestTarget` 3-tier matching, 4-level `computeSuggestion` cascade
- ✅ 11 curated mindmaps (3 VitaOne-scraped + 8 new), 1,612 nodes, 355 linked. MindMapContextPanel in Assess.
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

**Features Backlog** (organised by area — keep this updated every session)

### 🔴 Setup (one-time, coach does these)
1. **Configure email** — add `GMAIL_USER` + `GMAIL_APP_PASSWORD` to `.env.local`. Needs Google App Password: https://myaccount.google.com/apppasswords
2. **AiSensy webhook live** — add `AISENSY_WEBHOOK_SECRET=<secret>` to `.env.local`. Run `cloudflared tunnel --url http://localhost:3002`. Paste tunnel URL into AiSensy → Settings → Webhook URL. Set header `X-AiSensy-Secret`. Test: `GET /api/aisensy-webhook` shows setup status.
3. **Triage 444 open backlog items** via `/backlog` — suggestion chips make it fast. Coach work, no code.

### 🟡 Client management (next few sessions)
4. ✅ **Five Pillars capture at each session** — done in v0.57 (check-in) + v0.58 (full session). Compact 5-column widget, saved to session YAML, feeds OutcomeProgressCard.
5. ✅ **Protocol adherence trends** — done in v0.58. `protocol-adherence-chart.tsx` colour-coded grid per supplement/practice across check-in dates, shown in Sessions tab.
6. ✅ **Client photo** — done in v0.60. Upload/update profile photo in Overview. Shown as avatar in client list + header.
7. **Session notes PDF export** — generate a clean PDF of session notes to share with a referring doctor or specialist.
8. ✅ **IFM Matrix over time** — done in v0.60. Node scores tracked across full sessions with trend indicators.
9. ✅ **Inline quick notes from session brief** — done in v0.62. `QuickNoteWidget` at bottom of pre-session brief modal. Source chips + textarea + save. Auto-fades "✓ Saved". Modal stays open.

### 🟡 Communication / WhatsApp
10. ✅ **Auto-follow-up drafts** — done in v0.57. After any check-in/pre-intake/quick note, Haiku drafts a warm 3–5 sentence WhatsApp message in Shivani's voice. Coach edits and copies.
11. ✅ **AiSensy inbox badge** — done in v0.58. Green dashboard banner counts inbound WhatsApp messages (last 7 days), with client chips linking to Sessions tab.
12. ✅ **WhatsApp broadcast via AiSensy API** — done in v0.62. `BroadcastPanel` on dashboard (gated by AISENSY_API_KEY). Modes: follow-up due / recheck due / all active / custom. Needs `AISENSY_API_KEY` in `.env.local` and AiSensy campaign templates registered in dashboard.
13. ✅ **Message templates** — done in v0.62. `MessageTemplatesPanel` in client Overview. 5 default templates. {{variable}} auto-detection. 📋 Copy + 📤 Send via AiSensy direct API. Backed by `~/fm-plans/message_templates.yaml`.

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
21. **More curated mindmaps** — Cardiovascular, PCOS, Autoimmune, Sleep/Circadian, Energy/Mitochondrial, Bone Health. Use 6-branch template (Clinical Presentation / Root Mechanisms / FM Approach / Interventions / Coaching Goals / Labs to Track).
22. **Backlog triage** — 444 open items remain. `/backlog` UI with suggestion chips. Coach work.
23. **Promote freeform → catalogue entities** — Practice, TrackingHabit, Food, LabTest, Recipe, EducationalModule. Watch for duplication in real plans first.

### 🟢 Infrastructure / polish
24. **Persistent public URL** — `cloudflared tunnel --url http://localhost:3002` (needed for AiSensy) or `ngrok http 3002` / `ssh -R 80:localhost:3002 nokey@localhost.run`.
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
2. **AiSensy setup** (one-time): add `AISENSY_API_KEY` to `.env.local` for broadcast/send to work. Also `AISENSY_WEBHOOK_SECRET` + Cloudflare Tunnel for inbound webhook.
3. **Register AiSensy templates in dashboard** — 5 templates to create manually: `fm_checkin_nudge`, `fm_lab_reminder`, `fm_session_confirm`, `fm_supplement_instructions`, `fm_encouragement`. All UTILITY / English / `{{1}}` `{{2}}` params.
4. **Client letter design finalisation** — review `hariharan-plan-3-2026-05-06-cl-005.html` and decide on layout/branding changes. Server at `python3 -m http.server 9099` in `~/fm-plans/clients/cl-005/meal-plans/`.
5. **Session notes PDF export** (#7) — clean PDF of session notes for doctors/specialists.
