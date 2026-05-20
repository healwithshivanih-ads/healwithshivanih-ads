# fm-database-web — audit findings 2026-05-19

Code-only walk-through. No data touched. All file paths absolute under `/Users/shivani/code/healwithshivanih-ads/fm-database-web/`.

---

## 1. BROKEN / WRONG LINKS

| # | File:line | Issue | Should be | Severity |
|---|---|---|---|---|
| 1.1 | `src/app/(v2)/dashboard-v2/triage-sections.tsx:66,75,84,93` | `protocol_complete`, `labs_pending`, `returning`, `new_client` triage-card CTAs (labelled "🧠 Record session" / "🗓 Record session" / "🧪 Record results") all point to `/clients-v2/[id]/sessions`. That route is the **read-only Timeline browser** (see `src/app/(v2)/clients-v2/[id]/sessions/page.tsx:1`). The recorder lives at `/analyse`. Coach clicks "Record" → lands on inspector. | `/clients-v2/${r.client_id}/analyse` | **P0** — every "needs attention" client lands on the wrong page |
| 1.2 | `src/app/(v2)/clients-v2/[id]/page.tsx:698`, `plan/plan-page-shell.tsx:36`, `communicate/communicate-page-shell.tsx:35`, `soap/page.tsx:141,307`, `analyse/analyse-page-shell.tsx:43`, `analyse/page.tsx:281`, `reference/page.tsx:167` | Breadcrumb on EVERY v2 client surface uses `{ label: "Clients", href: "/clients" }`. Legacy `/clients` exists only as a redirect stub → `/clients-v2`. Adds an unnecessary 302 hop on every breadcrumb click. | `href: "/clients-v2"` | P2 polish |
| 1.3 | `src/components/client-widgets/client-tabs.tsx:708,1444` | `<Link href={`/plans/new?client=${clientId}`}>` — `/plans/new` is a deprecated redirect stub. Dead link in dead code (file is unused, see §8.1) but still ships in bundle. | n/a (delete file) | P2 |
| 1.4 | `src/components/client-widgets/client-tabs.tsx:652,660,1320,1487,1630`, `pregnancy-safety-panel.tsx:173` | `<Link href={`/plans/${slug}`}>` — legacy `/plans/[slug]` is a redirect stub. Hops via redirect on every click. (client-tabs is dead code; pregnancy-safety-panel is live.) | `/clients-v2/${cid}/plan/edit/${slug}` | P2 |
| 1.5 | `src/components/plan-editor/new-plan-wizard.tsx:354` | `<Link href={`/clients/${preselectedClientId}`}>` — legacy `/clients/[id]` is a redirect stub. | `/clients-v2/${cid}` | P2 |
| 1.6 | `src/app/(v2)/help/page.tsx` workflow steps (lines 17-42) | Step 5 says "Plan tab → Send package". That UI was moved to **Communicate** tab in v0.62+. Help content is stale. | Step 5 → "Communicate → Send package" | P2 |
| 1.7 | `src/app/(v2)/help/page.tsx:10-15` | Shortcut hints `⌘⇧R` / `⌘⇧M` / `⌘⇧P` all labelled "Phase 4". `Phase 4` already shipped — these were never wired (no `keydown` handler matches). | wire OR remove | P2 |

---

## 2. DEAD BUTTONS / DEAD CTAs

| # | File:line | Issue | Severity |
|---|---|---|---|
| 2.1 | `src/components/client-widgets/pre-session-brief.tsx:234-296` | `QuickNoteWidget` has a 2-radio "source" selector (`coach_observation` / `pre_session_thought`). State is set but the save call (line 258) hardcodes `[source: pre_session_brief]` and never reads the `source` state. Coach clicks but it does nothing. | P1 |
| 2.2 | `src/app/(v2)/messages/page.tsx` | Sidebar nav item "💬 Messages" → page is a Phase-5 stub with no functionality. Coach clicks expecting WhatsApp inbox; gets a placeholder + back link. Sidebar gives no hint. | P1 |
| 2.3 | `src/app/(v2)/clients-v2/[id]/handoff/page.tsx` | Full handoff packet page exists (~520 lines) but **nothing in the v2 UI links to it**. Not in client subnav, not in FAB (`client-quick-actions.ts:1-69` doesn't include it despite the doc comment claiming "page header overflow"). Coach has to type the URL manually. | P1 — entire feature unreachable |
| 2.4 | `src/app/(v2)/dashboard-v2/page.tsx:158-163` | `apiMtd` is loaded in the parallel batch (line 161 — `loadApiUsageMtdAllClients()` — a non-trivial fs walk per client + JSONL parsing) but never rendered (comment at 153-157 says "removed from dashboard 2026-05-19 but kept in batch"). `/settings/page.tsx:138-141` runs the SAME loader independently. Pure wasted IO on every dashboard render. | P1 |
| 2.5 | `src/components/client-widgets/new-client-form.tsx:418` | Collapsed-state button "+ New client" — never reached because `/clients-v2/new/page.tsx:49` always passes `initialOpen`. Dead branch ~5 lines. | P2 |

---

## 3. NAVIGATION DEAD-ENDS

| # | Surface | Dead-end | Suggested fix |
|---|---|---|---|
| 3.1 | `/clients-v2/[id]/handoff` | No "back" affordance besides browser history. Page is print-styled (`@media print` hides chrome). Coach loses context if they navigated directly. | Add `← back to overview` link |
| 3.2 | `/clients-v2/[id]/letter-editor?plan=...` (`letter-editor/page.tsx`) | If `plan` query is missing OR letter not yet generated, falls back to a fixed full-screen overlay (`NoPlanFallback` line 147) with only an underlined link back. Looks broken. | Use the standard FmAppShell with empty state instead of a black overlay modal |
| 3.3 | `/clients-v2/[id]/intake-view` | If intake not submitted, page renders an empty state but doesn't link to the intake form to send. Coach has to navigate back manually. | Add "📨 Send intake form" CTA |
| 3.4 | `/messages` stub | Only "← Back to Dashboard" button; doesn't surface the existing WhatsApp inbound info that IS available via `getRecentInboundMessages` (used by `FmInboundMessagesBanner` on dashboard). | Either remove from sidebar or inline the dashboard's inbound banner here |
| 3.5 | `/clients-v2/[id]/catalogue` | Subnav tab links exist but page itself just rehosts catalogue chips. Coach who clicks "Catalogue" tab inside a client expects client-specific content; gets a generic browser scoped to client tags. Confusing label. | Rename tab to "Client tags" or remove |

---

## 4. JOURNEY A — 58yo Hashimoto's / IR / perimenopausal / post-COVID / osteopenia

| # | Step | What works | Friction | Time est |
|---|---|---|---|---|
| 4.1 | `/clients-v2/new` create | Transcript pre-fill is rich. Fields cover Hashimoto's (`medical_history`), levothyroxine (`current_medications`), perimenopause (cycle_status + LMP). 7 collapsible sections. localStorage draft survives crashes. | (a) No field for **osteopenia/DXA bone density** — coach has to dump it in `conditions` or `notes`. (b) No field for **post-COVID symptoms / Long COVID date of infection** — useful for protocol selection (Long COVID is a protocol template). (c) Sleep / nutrition pillars are 1–5 — fine, but coach has no place to capture **hot flushes severity / frequency**. (d) Required `mobile_number` (line 327) — fine, but `dateOfBirth` required (line 328) is good. (e) `dietary_preference` dropdown lacks "low-FODMAP" or "AIP" — common FM clients. (f) **No genome upload affordance** — MTHFR/APOE/COMT chips appear on `/clients-v2/[id]` overview only AFTER a separate parse-genetic-report.py run; no surface to upload one at intake. | 15-20 min |
| 4.2 | Post-save | Router pushes to `/clients-v2/[id]` and `clearDraft()` fires. Identity editor floats at top of header. Workflow banner shows "No plan yet · Run a Discovery or Full Assessment". | Banner CTA goes to `/analyse` (good). But the "📋 Start session" wording is vague — coach has to read further to know what's expected. | — |
| 4.3 | `/clients-v2/[id]` overview | Right column ABOVE the fold: IntakeProgressCard + IntakeInsightsCard + FmContactPanel + SendIntakeFormButton + UnlockFullIntakeButton + NasaLeanTestPanel + BeightonVerifyPanel + TierOneSuspicionsPanel + (Engagement pill if discovery done) + ClientMemoryPanel + WeightLossCard + Active medications + Allergies & flags + FmFivePillarsWithSendCheckIn. **13 panels in one column**. Most are correctly conditional but they all render together for a new client mid-intake. | Visual overload for a first-time client view. Top-of-fold density is too high — NASA lean / Beighton panels are zero-context for someone who hasn't done the tier-1 yet. Should default-collapse with caption "▾ Coach physical exam panels (advanced)". | — |
| 4.4 | `/clients-v2/[id]/analyse/discovery` | Pre-fills `chiefConcern` from `active_conditions` + notes. Lab panel selection auto-suggests panels based on conditions. Save → success → 📧 + 💬 (SendDiscoveryLabsButton works). Lab brand names already stripped per session fix. | (a) AI-pre-fill for `chiefConcern` runs Haiku? No — deterministic concat. ✓. (b) For the complex Hashimoto's case, the suggested labs may miss DUTCH / fasting insulin / IR-specific markers unless coach manually adds. Worth adding "auto-suggest from active_conditions" heuristic. (c) After save the success screen shows the requisition text — but the **lab list** doesn't include menopausal-relevant markers like FSH, AMH, oestradiol unless coach toggles them. | 8-10 min |
| 4.5 | Discovery → Intake handoff | SendIntakeFormButton on overview generates token, drops "WhatsApp via fm_intake_invite" template. IntakeProgressCard shows lifecycle: link generated → first opened → draft saved → submitted. | After submit, coach has to manually click "✨ Generate insights" on IntakeInsightsCard. This is correct gating (Haiku cost) but the button placement is buried in the right column — coach asked to see "what's new" front-and-centre. | — |
| 4.6 | `/clients-v2/[id]/analyse/intake` | 2,600 lines of form. Verify-checklist sidebar reads `intake_insights.verify_in_session` (if generated) — pinned Q&A. Save appends Q&A to coach_notes. | Form is intimidating — coach should know which sections are pre-filled from the client-submitted intake form. No "imported from client intake" badges. | 30-45 min |
| 4.7 | `/clients-v2/[id]/analyse/full` (Sonnet AI assess) | `runAssessAction` called only on `onClick` (line 1254). 360s timeout. Streaming via `messages.stream()`. Cost: ~10K tokens out × Sonnet rate ≈ $0.20+. | (a) **No "use cached subgraph" affordance on re-runs.** If coach edits one symptom and re-runs the assess, the full subgraph rebuild happens again. Could be Haiku-classified first → "did anything change > X? if not, return cached." (b) AI assess uses Sonnet (`fm-database/fmdb/assess/suggester.py:1230`). Cheaper Haiku could handle the "structured tool-call extraction" portion for simpler clients (no labs, single condition); fall back to Sonnet only on complex cases. (c) No visible cost estimate before clicking "Analyze". Coach has no way to know "this run is expensive" vs "cheap". | 3-5 min |
| 4.8 | `onGenerateDraft` → `/plan/edit/[slug]` | Router redirects after Python plan-generation. Plan editor wraps v1 PlanEditor (2,200 lines) in v2 shell. SendDiscoveryLabsButton + AttachedProtocolsPanel both render correctly per recent fixes. | First-time coach faces a 10-section collapsible mega-form. No "AI suggested defaults" toggle visible — coach has to discover the AIReadCard at top. | — |
| 4.9 | Plan publish → letter generation | `SendToClientButton` in plan-edit header. Communicate tab has full letter management. 4 letter types. Vacation override + travel windows wired. | Letter generation is Sonnet (`render-client-letter.py:5072`). Slow (2-3 min). For complex protocols this is fine — but coach has no preview of cost. | 3-5 min |
| 4.10 | Multi-week check-ins | `/analyse/checkin` form. ProtocolAdherenceChart on Sessions tab. Five pillars in widget. | OK. | 5 min/wk |
| 4.11 | Plan recheck → next phase | `FollowUpPanel` on `/plan` page (when recheck due). Generates phase-2 successor via `generateFollowUpPlan`. Two intents: `next_phase` / `maintenance`. | Both intents trigger Haiku follow-up. **Maintenance protocol template** exists in catalogue (mentioned in v0.75 protocol expansion) — `FollowUpPanel` correctly picks 26-week default for maintenance. ✓ | — |
| 4.12 | → Maintenance | `intent === "maintenance"` generates lighter plan. | No visible "graduate client" or "archive program" terminal state. Client stays in dashboard cards as "active" forever. | — |

---

## 5. JOURNEY B — 5R Gut wk 8, recheck → maintenance

| # | Step | What works | Friction |
|---|---|---|---|
| 5.1 | Coach lands on dashboard | `protocol_complete` bucket surfaces with green badge + "🧠 Record session" CTA. | CTA href is **wrong** (see §1.1) — goes to Timeline. Coach has to click Plan tab themselves. |
| 5.2 | Open client → check-in | `/analyse/checkin` 649-line form. Protocol adherence rating, five pillars, lab orders inline. Saves correctly. | After save → bounce back to `/analyse`. No prompt to "generate follow-up draft now?" — coach has to manually go to `/plan` and find FollowUpPanel. |
| 5.3 | Plan recheck successor | `FollowUpPanel` works. Slug pre-fills with sensible default. `intent="next_phase"` runs Haiku follow-up gen. | Generated draft lands at `/plan/edit/[new-slug]` — but the **AttachedProtocolsPanel** doesn't carry over the previous plan's attached protocols (e.g. 5R Gut should stay attached or rotate to phase-2 anti-inflammatory). Coach has to re-attach manually. |
| 5.4 | Letter regen | Communicate tab → letter-generate-modal. Phase-aware (meal_plan_phase letter type for fortnight). | Stale-letters banner on Communicate (line 276) catches plan edits → letter divergence. ✓ |
| 5.5 | Maintenance | `intent="maintenance"` → lighter plan + 26-week period. | No graduation state. No "alumni" / "maintenance" filter on `/clients-v2`. They keep showing up in `active` bucket forever, polluting protocol counts. |

---

## 6. DASHBOARD CLUTTER (`/dashboard-v2/page.tsx`)

Counted 14+ widget surfaces stacked vertically:

1. `<FmPageHeader>` with 2 stat tiles (good — Clients + Needs attention)
2. "📅 Schedule a session" strip (orange, lines 427-468) — full-width, 16px tall
3. `<BroadcastPanel>` (when WHATSAPP_SERVER_URL — likely always on)
4. `<WeeklyPollPanel>` (always rendered; setup hint when not configured)
5. `<StartDateReminderPanel>` (self-hides when empty — but still mounts + fetches)
6. `<FmCatalogueCommitBanner>` (self-hides when 0 uncommitted)
7. `<FmCancellationAlertBanner>` (self-hides when empty)
8. `<FmUpcomingBookingsPanel>`
9. `<FmScheduleDuePanel>`
10. `<FmInboundMessagesBanner>` (windowDays=7)
11. **🔔 "Needs your eyes" red panel** (dormant + plateaued + regressed) — 3 sub-strips
12. **📅 Upcoming follow-ups (next 7 days)** — purple panel
13. `<TriageSections>` — 6 buckets, each collapsible
14. (Phase 5 removed `BroadcastPanel` from bottom — now at top)

### Specific findings:

| # | Line range | Issue |
|---|---|---|
| 6.1 | 158-163 | `apiMtd` fetched but never rendered. Comment says "kept in batch — small + cached" but the `/settings` page re-fetches independently (line 138-141). **Remove from dashboard fetch.** |
| 6.2 | 427-468 | "📅 Schedule a session" strip — coach has the same `BookSessionButton` in the page header `rightSlot` via stat tiles AND in the 2-up FmStatGrid. The strip is a 3rd redundant entry point for the same modal. |
| 6.3 | 471-501 | Three WhatsApp-related panels stacked: BroadcastPanel + WeeklyPollPanel + StartDateReminderPanel. Each has its own header strip + collapsed-button + setup-hint variant. They could share a "WhatsApp outbound" group panel. |
| 6.4 | 489-501 (WeeklyPollPanel) | **Always renders** even when `WHATSAPP_SERVER_URL` is unset — just shows setup hint. Permanent dashboard noise for any environment without WhatsApp. Should mount only when configured (like BroadcastPanel does at 475). |
| 6.5 | 527-648 | "🔔 Needs your eyes" red panel runs **3 separate dormant/plateau/regressed scans** (lines 215-219). Each does an fs walk per client. Cheap individually, but they all run on every dashboard render even if zero matches. Could be a single combined scan returning `{dormant, plateau, regressed}` per client. |
| 6.6 | 226-231 | `getSchedulingDueRows` runs but `dashboard-v2` already has `grouped.follow_up_due` and `grouped.protocol_complete` from triage signal computation. The "due" rows overlap heavily — duplicate logic that could merge. |
| 6.7 | 271-286 | `loadUpcomingBookings` + `loadRecentCancellations` + a third `fs.access` to detect "webhook configured". The fs.access could be hoisted into `loadUpcomingBookings` so we don't do an extra stat. |
| 6.8 | 270-296 (`computeSignal`) | For every client, this calls `loadClientSessions(c.client_id)` (filesystem walk). With 50+ clients this is 50 sequential YAML reads per dashboard load. Already done in parallel via `Promise.all`, but each session-walk is per-client. Could batch-load all sessions once. |

---

## 7. API CREDIT BURN AUDIT

| # | Site | Triggered by | Model | Cost order | Verdict |
|---|---|---|---|---|---|
| 7.1 | `/analyse/full` `onAnalyze` | explicit click | Sonnet `claude-sonnet-4-6` (suggester.py:1230) | $0.20+ per run, 10K+ output tokens | Gated. ✓ Could be Haiku for re-runs / simple cases. |
| 7.2 | `/plan/edit` plan AI sanity check | explicit click via AIReadCard | Haiku→Sonnet (`fm-database/fmdb/plan/ai_check.py` not inspected; likely Sonnet) | ~$0.02 warm cache | Gated. ✓ |
| 7.3 | IntakeInsightsCard generate | explicit "✨ Generate insights" click | Haiku (`generate-intake-insights.py:722`) | ~$0.01-0.04 | Gated. ✓ |
| 7.4 | `parseTranscriptForClient` (new-client form) | explicit "Parse transcript" click | Haiku (`extract-client-from-transcript.py:554`) | ~$0.01 | Gated. ✓ |
| 7.5 | `extractTranscriptAction` (LabUploadPanel + IntakeForm + FullForm) | explicit upload + parse | Haiku (`extract-symptoms.py:279`) | ~$0.02-0.05 (multi-page lab PDF) | Gated. ✓ — but `lab-upload-panel.tsx:312` says "Auto-fire extraction on pick" → so as soon as the coach picks a file, extraction starts. Acceptable; one-shot per upload. |
| 7.6 | Letter generation (Communicate) | explicit click | Sonnet (`render-client-letter.py:5072,5143`) | $0.05-0.20 per letter type | Gated. ✓ |
| 7.7 | Refine letter | explicit chat | Sonnet (`refine-letter.py:220`) | ~$0.02 per turn | Gated. ✓ |
| 7.8 | Plan chat | explicit chat | Haiku (`plan-chat.py:385`) | ~$0.01 per turn | Gated. ✓ |
| 7.9 | Catalogue chat | explicit chat | Haiku | ~$0.01 per turn | Gated. ✓ |
| 7.10 | Plan-notes semantic diff | run via plan-publish? Need to verify | Haiku (`plan-notes-semantic-diff.py:202`) | ~$0.005 | Need to check trigger — looks like it might fire automatically on plan-publish |
| 7.11 | Generate-follow-up | explicit click on FollowUpPanel | Haiku (`generate-follow-up.py:321`) | ~$0.01 | Gated. ✓ |
| 7.12 | Draft-followup-message | explicit click | Haiku (`draft-followup-message.py:166`) | ~$0.005 | Gated. ✓ |
| 7.13 | Coach-knowledge-check (ingest) | explicit click on /ingest | Haiku (`coach-knowledge-check.py:222`) | ~$0.005 | Gated. ✓ |
| 7.14 | Parse-genetic-report | explicit upload | Sonnet (`parse-genetic-report.py:246`) | ~$0.05 | Gated. ✓ |
| 7.15 | Assess-rework | unclear trigger | Haiku (`assess-rework.py:507`) | ~$0.01 | Need to verify — may fire on certain check-in saves? |
| 7.16 | Validator-model in render-client-letter | always runs as part of letter gen | Haiku (`render-client-letter.py:4720`) | ~$0.005 | Bundled into letter gen. ✓ |

### Potential cost savings:

1. **Run a cheap Haiku "did anything materially change?" gate** before re-running the full Sonnet assess. If symptoms / topics / labs all unchanged, return cached result.
2. **Cache assess subgraph by (symptoms,topics) hash** in `~/.fm-cache` — re-runs hit disk instead of re-walking catalogue.
3. **Letter regeneration on stale-banner**: currently regenerates from scratch. Could diff plan and only regenerate sections that changed (saves Sonnet output tokens).
4. **Plan AI sanity check** — runs Sonnet. For drafts with minor edits, Haiku could pre-filter "does this need a full sanity check?" first.

### Things WITHOUT a clear API-burn finding:

- No auto-on-mount AI calls found. ✓
- All Haiku/Sonnet calls require explicit coach button click.
- `loadIntakeInsights` is read-only YAML; never invokes API.

---

## 8. UNUSED / ORPHAN CODE

| # | File | Status |
|---|---|---|
| 8.1 | `src/components/client-widgets/client-tabs.tsx` (3,000+ lines per code comment) | Imported only by `src/app/clients/[id]/page.tsx` which is now a redirect stub. Pure dead code shipping in bundle. |
| 8.2 | `src/app/(v2)/clients-v2/[id]/memory-panel.tsx` | Comment at `page.tsx:68-71` says "MemoryPanel import removed 2026-05-19 — duplicate of ClientMemoryPanel. File left on disk in case we want to revive a read-only twin later". Delete it. |
| 8.3 | `src/app/clients/[id]/page.tsx` | Legacy redirect stub. Once breadcrumbs (§1.2) point to `/clients-v2`, this can be deleted. |
| 8.4 | `src/app/plans/page.tsx`, `src/app/plans/[slug]/page.tsx`, `src/app/plans/new/page.tsx` | All redirect stubs. Same disposition as 8.3 once `client-tabs.tsx` is deleted. |
| 8.5 | `src/app/(v2)/clients-v2/[id]/handoff/*` | Live code, but unreachable from UI (see §2.3). |
| 8.6 | `src/components/client-widgets/new-client-form.tsx:415-421` | "if (!open) return collapsed button" branch — never hit because page passes `initialOpen`. |
| 8.7 | `src/components/assess/assess-client.tsx` | Imported by legacy `/assess/page.tsx` (redirect stub) and `(v2)/clients-v2/[id]/analyse/full/full-form.tsx`. Still live in the v2 full-form path. ✓ keep. |
| 8.8 | `apiMtd` orphan fetch on dashboard (`dashboard-v2/page.tsx:161`) | Loaded but never rendered. See §2.4. |

---

## 9. INCONSISTENCY

| # | Concept | Surfaces use | Should normalize on |
|---|---|---|---|
| 9.1 | Session types | YAML stores `discovery_consultation` / `full_assessment` / `pre_intake` / `check_in` / `quick_note`. `session-utils.parseSessionType()` returns `discovery / intake / full / check_in / quick_note`. **`/calendar/page.tsx:36-50` has its own parseSessionType that maps `full_assessment → intake` and `pre_intake → intake` (different from session-utils)**. 3 different normalisations. | Single `parseSessionType` source of truth |
| 9.2 | "Sessions" vs "Timeline" subnav | `clientSubnavTabs()` at `client-subnav.ts:28` calls route `/analyse` → label "Sessions", route `/sessions` → label "Timeline". Highly confusing — "Record session" goes to "Sessions" tab, while "Sessions" history goes to "Timeline" tab. | Rename to "Record" and "History" |
| 9.3 | "Intake" overloading | `intake` is both a programme-stage tab AND a session-type. `pre_intake` was renamed to `intake` in form copy (v0.59) but YAML still uses both. `session-type-picker` says "Intake session". `journey.nextStep` returns href that could point to `/analyse/intake` or `/intake-view`. | Pick one term per concept |
| 9.4 | Plan stage colors | `FmWorkflowBanner` has 4 stages: `no_plan` / `draft` / `active` / `recheck`. ClientCard on `/clients-v2` has same 4. Triage on dashboard has 6 buckets that map differently (`follow_up_due / protocol_complete / labs_pending / returning / new_client / active`). Mismatched mental models. | Pick one bucket taxonomy |
| 9.5 | "Plan tab" vs "Plan dashboard view" | `/clients-v2/[id]/plan` is the read-only digest. `/clients-v2/[id]/plan/edit/[slug]` is the editor. Some buttons say "Edit plan", some "Plan tab", some "View plan". | Unified labels |
| 9.6 | Breadcrumb base | Mix of `/clients` (redirect) and `/clients-v2` (real). Pick one. |

---

## 10. CHEAPER / FASTER OPPORTUNITIES

### Coach time savings:
1. **Pre-fill chief concern for intake** from `client.active_conditions` + `client.goals` (currently only discovery does this).
2. **Auto-attach detected protocol templates** to draft plan based on assess output (Hashimoto → 5R Gut + Anti-Inflammatory; PCOS → Insulin Resistance; etc.). Coach unchecks if wrong. Currently coach has to manually pick from `AttachedProtocolsPanel`.
3. **One-click "promote draft → published"** on the plan dashboard view (`/clients-v2/[id]/plan`) — currently coach goes to `/plan/edit/[slug]` → scrolls to lifecycle → clicks Activate.
4. **Carry attached protocols on supersede** (§5.3) — auto-inherit, coach can rotate.
5. **Maintenance graduation** (§4.12 / §5.5) — add a "graduated" lifecycle state distinct from `superseded` so dashboard counts stay clean.
6. **Discovery + Intake form merge** for clients who already have transcript pre-fill — the 2,600-line intake form duplicates much of what discovery captures.
7. **Default-collapse the Coach-physical-exam panels** (NASA lean, Beighton, Tier 1) on Overview unless coach explicitly enables — reduces scroll height by ~600px for typical client.

### API cost savings:
1. **Haiku-first triage for re-run assess** — if symptoms + topics + lab values unchanged, return cached AssessResult.
2. **Subgraph cache** keyed by `(symptoms, topics)` hash; saves ~35K input tokens per run.
3. **Letter section caching** — when coach regenerates after editing 1 section of the plan, only that section's output needs to be re-streamed.
4. **Sonnet → Haiku for plan-AI-sanity-check on minor edits** — if the diff is <20 lines or only `notes_for_coach` changed, Haiku is sufficient.
5. **Skip Haiku validator pass** (`render-client-letter.py:4720`) for revision letters when validator just passed on the same content.

### Form pre-fill / DX:
1. Intake form should show "✨ X fields filled from client intake" banners next to each pre-filled section.
2. Pre-fill discovery's `chiefConcern` from past discovery if rerun.

---

## 11. PRIORITISED PUNCH LIST

Ordered by `(coach-pain × frequency) / dev-effort`. Top of list = ship today.

| # | Fix | Closes | Effort |
|---|---|---|---|
| 1 | Triage CTAs route to `/analyse` not `/sessions`. Find/replace `ctaHref: (r) => /clients-v2/${r.client_id}/sessions` in `dashboard-v2/triage-sections.tsx:66,75,84,93`. | §1.1 | 5 min |
| 2 | Drop `apiMtd` from dashboard-v2 `Promise.all` (just delete line 161). | §2.4, §6.1 | 2 min |
| 3 | Delete `client-tabs.tsx`, `memory-panel.tsx`, legacy `/clients/[id]`, `/plans/page.tsx`, `/plans/[slug]/page.tsx`, `/plans/new/page.tsx`, `/assess/page.tsx`. Update breadcrumbs (§1.2) to `/clients-v2`. | §1.2, §1.3, §1.4, §1.5, §8.1, §8.2, §8.3, §8.4 | 20 min |
| 4 | Add `clientId` cross-check on `letter-editor`, `handoff`, `soap`, `reference` — `if (plan?.client_id !== id) notFound()`. | (latent privacy bug) | 10 min |
| 5 | Add handoff link to FAB in `client-quick-actions.ts` (or as a button on Overview). | §2.3 | 5 min |
| 6 | Fix QuickNoteWidget — write `source` state into `presenting_complaints` tag. `pre-session-brief.tsx:258`. | §2.1 | 5 min |
| 7 | Default-collapse NASA / Beighton / Tier 1 panels on Overview right column. Move them behind "▾ Coach physical-exam (advanced)" disclosure. | §4.3, §10 | 15 min |
| 8 | Gate `WeeklyPollPanel` on `whatsappConfigured` like `BroadcastPanel` is. Don't render setup-hint variant permanently. | §6.4 | 5 min |
| 9 | Merge the 3 dormant/plateau/regressed scans into a single batched walk. | §6.5 | 30 min |
| 10 | Subnav rename: "Sessions" tab (record forms) → "Record", "Timeline" tab (history browser) → "History". | §9.2 | 5 min |
| 11 | "Schedule a session" amber strip — drop it. Coach already has the button in stat tiles header. | §6.2 | 5 min |
| 12 | Form: add osteopenia / DXA fields, "Long COVID date", AIP / low-FODMAP in dietary prefs. | §4.1 | 20 min |
| 13 | Wire `/messages` to actually show the inbound queue (reuse `getRecentInboundMessages` + display per-message thread). Or remove from sidebar. | §2.2, §3.4 | 1-2 hr |
| 14 | "Generate follow-up?" toast after check-in save when recheck within 1 week. | §5.2 | 15 min |
| 15 | Carry `attached_protocols` array from current plan to successor draft in `generateFollowUpPlan`. | §5.3 | 10 min |

---

## Top-5 summary (200 words for coach)

**1. Triage CTAs are broken.** Every "🧠 Record session" / "🗓 Record session" / "🧪 Record results" button on the dashboard's needs-attention buckets points to the read-only Timeline browser, not the recorder. Every "I need to act on this client" click lands you on the wrong screen. 5-minute fix in `triage-sections.tsx`.

**2. Dead fetches and dead code.** Dashboard loads API spend on every render but never displays it. The 3,000-line `client-tabs.tsx` ships in the bundle but is only imported by a redirect stub. Same for legacy `/clients/[id]` and `/plans/*`. ~22 minutes of cleanup, smaller bundle, faster dashboard.

**3. Handoff packet is unreachable.** Full doctor-handoff PDF page exists but no link goes there — coach has to type the URL. Add it to the FAB or Overview quick actions.

**4. Sessions / Timeline labelling is inverted.** Subnav "Sessions" = recording forms, "Timeline" = history. Coach naming follows the opposite intuition. Rename to "Record" and "History".

**5. Privacy guard gap.** Letter-editor, handoff, SOAP, reference pages don't verify `plan.client_id === url.id`. URL manipulation can show another client's plan/letter. 10-minute fix — same `notFound()` pattern that `/plan/edit/[slug]` already uses.

Also worth knowing: there are 14+ banner panels stacked on the dashboard; "Needs your eyes" panel runs 3 separate scans; weekly-poll panel renders setup hint permanently when WhatsApp not configured; pre-session-brief QuickNoteWidget has a "source" radio that does nothing.
