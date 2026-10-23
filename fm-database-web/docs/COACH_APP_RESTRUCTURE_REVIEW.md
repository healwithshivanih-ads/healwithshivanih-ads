# Coach app restructure review — 2026-10-23

> **Status (same day):** approved in full by the coach; phases 0–6 implemented on
> branch `claude/coach-dashboard-restructure-90ee02` (commits `f1c4da45`,
> `b8af02da` and the client-page landing change). Decisions taken: no automated
> chasing of clients at all; the mobile coach app stays for a later redesign.
> What remains open is listed in CLAUDE.md under v0.87 "Not done".

Read-only audit of `fm-database-web` (the coach UI on localhost:3002) plus the
crons and the data under `~/fm-plans`. Four agents traced the dashboard logic,
the automations, actual usage over six months, and dead code. Nothing was
changed. This document is the verdict and the proposal; file:line references
are kept so a future session can implement without re-deriving.

---

## 1. The verdict in one paragraph

Every symptom you named is the same defect. The app has **no single answer to
"where is this person in their journey"**. That fact is spread across thirteen
stores (`engagement_status`, `lapsed_on`, `lifecycle_state`,
`maintenance_paid_through`, `plan.is_maintenance`, the `published/` folder,
`_renewal_decisions.yaml`, `next_contact_date`, the `prospects/` folder,
`archived`, `marketing_opt_out`, `intake_finalised_at`, per-flow state files)
with four different definitions of "ended" and three of "prospect". Sixteen
independent "due" clocks run on the dashboard, each reading two or three of
those stores and none reading the others. So a client who has clearly left
(lapsed, "not renewing" on file, archive candidate) is still "recheck due",
still pre-ticked for the weekly poll, still a "library-active renewal signal",
still listed in nine panels at once. Meanwhile the evidence says the coach UI
is not where your work happens any more: your own UI-driven activity fell from
47 sessions in May to 1 in October, while 17 of 21 clients opened the client
app in the last two weeks. The product that delivers value is the **client app
and the automations behind it**. The coach UI's job should shrink to two
things: a short list of decisions only you can make, and a brief that chat can
read so you stop repeating yourself.

---

## 2. What the evidence says

### Usage (six months, from session files, API logs, git)

| Signal | May | Jun | Jul | Aug | Sep | Oct |
|---|---|---|---|---|---|---|
| Sessions written through the coach UI | 47 | 14 | 21 | 3 | 2 | 1 |
| Sessions written through chat | 9 | 7 | 3 | 3 | 1 | 2 |
| Sessions from clients (intake form, app, WhatsApp) | 23 | 34 | 23 | 16 | 9 | 3 |
| UI-triggered AI calls (assess, letters, chat panel) | 55 | 23 | 11 | 1 | 0 | 0 |
| Cron AI calls (menus, grocery, recipes) | 0 | 35 | 546 | 233 | 114 | 119 |

- Coach-UI AI features are at zero since August. The crons that feed the client app are 90% of all API calls.
- The mobile coach app (`/m`) has not written a file since 2 August.
- 17 of 21 clients with an app token opened it in the last 14 days. Three clients have opened it on 70+ distinct days.
- Of the 9 plans created August to October, none came through the Analyse → draft UI path.
- There are no HTTP access logs, so page views cannot be measured; the file-write evidence above is the best proxy.

### Size

| Area | Lines |
|---|---|
| All TS/TSX under `src/` | 257,191 |
| Per-client page tree (`clients-v2/[id]/`, 115 files) | 42,362 |
| The client overview page alone (`[id]/page.tsx`) | 2,499 lines, **56 distinct components** |
| Client widgets (`components/client-widgets/`, 55 files) | 19,444, of which 17 files / 5,016 lines have **no importer** |
| Dashboard (`dashboard-v2/`) | 3,000 lines, 25 panels + 13 triage buckets |
| Python shims (`scripts/`) | 48,596, of which 18 one-off scripts / 3,090 lines are unreferenced |
| Retired letter renderer still on disk | 8,595 (`render-client-letter.py`) + 1,682 (`brand_html.py`) |
| Streamlit UI (fm-database/fmdb_ui) | 3,377, untouched since June |

Churn since July: 863 commits, 20% with "fix" in the subject.

---

## 3. Why the three bugs happen

### (a) Retired clients still "due"

`computeSignal` in `dashboard-v2/page.tsx:156-500` was written before `lapsed`,
`is_maintenance` and renewal decisions existed and was never updated:

- It collapses `engagement_status` to `signed_up` / `declined` / everything-else-is-pending (`page.tsx:311-316`). **It never reads `lapsed`.** It never reads `is_maintenance` or `_renewal_decisions.yaml`.
- "Has a published plan" is still its test for "in active care" (`page.tsx:176-186`). The renewal sweep deliberately leaves an ended plan in `published/` (see CLAUDE.md v0.84), so every lapsed client is `protocol_complete` in the red "Needs action" tier forever. Today 10 of the 11 "Rechecks due" are lapsed clients, and Hariharan sits there despite a `renewed` decision and a draft successor.
- It picks the **first** published file in directory order, not the newest (`page.tsx:189-191`). Two superseded plans physically remain in `published/` (`niti-plan-1`, `ochre-plan-2`), so Niti and the test client are classified on dead plans.
- Those buckets feed the stat tiles, the broadcast and weekly-poll recipient lists, and the practice overview, so one stale classifier contaminates six surfaces. The weekly poll pre-ticks all 10 lapsed clients.
- Other readers with the same gap: `review-nudges.ts` (10 lapsed clients flagged `library_active` because the feedback-ask step on 20 Oct wrote an app-open for each of them at 05:25Z, one minute before the asks were logged), `start-date-reminders.ts`, `recipes.ts` pause roster, the app-links panel, the "silent 14d+" strip (26 of 29 clients).
- `next_contact_date` is written only by one widget and cleared by nothing (`api/email/actions.ts:413-430`). It is checked **first**, before any engagement logic (`page.tsx:160`). Niti (maintenance) has been "Follow-up overdue" for 77 days.

Concrete: cl-004 Dhanishta, lapsed 18 Aug, appears today in **nine** places: protocol complete, rechecks tile, needs-attention count, silent strip, review nudge, feedback ask, app-links row, pause roster, poll pre-tick. And in the archive-candidates panel on the same page.

### (b) Booking links for maintenance clients

`getSchedulingDueRows` in `src/lib/fmdb/scheduling-due.ts:234-420` has no
notion of maintenance:

- Its `PlanLite` type (`:106-117`) does not carry `is_maintenance`. A 26-week maintenance plan is indistinguishable from a 12-week programme still running.
- An in-flight plan turns on the **12-day session-gap clock** (`:308-311`, `:369`). Maintenance clients have no sessions by design, so they are "due" permanently.
- "Last session" is the largest date in **any filename** under `sessions/` (`:137-153`), including `.bak` files, app check-ins and WhatsApp thread files, none of which are coaching sessions.
- `FmScheduleDuePanel` rows start **pre-checked** (`FmScheduleDuePanel.tsx:62`), the per-row button sends with no confirmation (`:93-111`), and the send is a direct Meta utility template (`calcom-actions.ts:182-255`). There is no draft or approval step.
- Today: **Niti (cl-014) is listed, "Active programme · 46d since last session", coaching link pre-ticked.** Krittika and Nazneen are absent only because their intake was auto-finalised on 21 Oct and an unrelated 7-day "just onboarded" skip (`:268-273`) masks them. **From 28 October all three maintenance clients will be listed.**
- The intent exists elsewhere: `review-nudges.ts:117` does `if (onMaintenance) continue;` and the spec calls maintenance "the hands-free paid tier" (`docs/PLAN_END_GAME_SPEC.md:25`). The booking code simply never got the rule.
- A third chaser: `plan_review_due` (21-day review cadence, `page.tsx:254-277`) has no maintenance check either and will flag Krittika and Nazneen from 10 November.

### (c) Never-signed-up people as follow-ups forever

- **The 15-day prospect parking sweep is never scheduled.** `fmdb prospects-sweep` is a dry run unless `--apply` is passed and appears in no cron, LaunchAgent or PM2 config. Only 5 people have ever been parked. Cold leads stay in `clients/` indefinitely.
- Parking would not help anyway: the discovery follow-up and interested-people panels deliberately read `prospects/` too (`discovery-followup.ts:324-334`).
- The follow-up drip stops **drafting** at about day 30 but never stops **listing**: the "In follow-up" list pushes every candidate with no age cutoff (`:642-661`), the "no call on record" list likewise (`:419-432`), and a `pending` draft is never expired when a later touch is drafted (`:570-580`). Four prospects have drafts 19 to 32 days stale.
- `plan_to_build` ("Signed up — programme owed") is reachable without a signup (`page.tsx:362-409`): Akila (pending, Foundation call) is shown as owed a programme.
- `returning` reads `sessions[sessions.length-1]`, which is the **oldest** session because the loader sorts newest-first (`loader-extras.ts:1195-1213`). Four pending prospects render under "Past clients".
- `booking_link_pending` has no upper bound and no engagement gate (`page.tsx:795-831`): rows today at 142 and 90 days.

---

## 4. What the app should become

### Principle

The client app and the automations are the product. Coach time should go only
to decisions a human must make. So the coach UI becomes:

1. **One lifecycle state per person**, computed by one function, consulted by everything.
2. **A decisions inbox** instead of a dashboard: every item names a person, a reason, one action, and the rule that makes it disappear.
3. **One gate at the send door**: every outbound message passes a single "may I contact this person for this purpose" check.
4. **A client brief that chat can read**, so you stop re-explaining who someone is and what was last sent.
5. **A client page with three views** (Brief, Record, Plan) instead of 56 components on one screen.

### A. One lifecycle state

Add `src/lib/fmdb/lifecycle.ts` with a Python mirror in `fmdb/plan/lifecycle.py`
(same pattern as `isLapsed` / `drug_match`). One function:

```
resolveLifecycle(client, plans, renewalDecisions, today) →
  { state, since, reason }
```

States, in order of precedence:

| State | Meaning | Derived from |
|---|---|---|
| `archived` | out of every list | `client.archived` |
| `maintenance` | hands-free paid tier | `maintenance_paid_through ≥ today` or a live `is_maintenance` plan |
| `active` | a programme plan in flight | newest non-maintenance published plan, started, before effective end + 14d |
| `ending` | active and inside the renewal window with no decision | effective end −14d .. +15d and no `_renewal_decisions` entry |
| `onboarding` | paid, no plan started yet | `engagement_status: signed_up` and no started plan |
| `lapsed` | programme ended, no successor, no maintenance | `engagement_status: lapsed` or ended + grace passed |
| `prospect` | never paid for a programme | `engagement_status` pending / blank; sub-flag `followup_day` (days since call) and `declined` |

Rules that come with it:

- **Nothing reads `engagement_status`, `lifecycle_state`, `lapsed_on`, `is_maintenance` or `published/` directly for a "who is in care" decision any more.** Those stay as inputs. `lifecycle_state` (`models.py:997`, default `programme_active`, wrong for 9 of 29 records today) is retired.
- The nightly `renewal-sweep` (already the only cron that writes `client.yaml`) stamps `lifecycle` + `lifecycle_since` on every record so Python, chat and the dashboard all see the same word.
- **Transitions clean up.** Entering `lapsed`, `maintenance` or `archived` clears `next_contact_date`, expires pending follow-up and win-back drafts, and removes the person from `_calcom_send_log` consideration. Entering `maintenance` or `lapsed` moves superseded plans out of `published/`.
- Prospect parking (`prospects-sweep --apply`) is scheduled at 06:35, and it parks **prospects only**, not lapsed clients (`prospects.py:217,239` currently parks anyone not signed up).
- Tests pin the real roster shapes: Niti (maintenance with a stale plan-1 still published), Hariharan (renewed, draft successor), Akila (pending with an assessed session), cl-004 (lapsed, not_renewing).

### B. Decisions inbox replaces the dashboard

Delete the 13 triage buckets, the 4 tiers, the stat tiles and 15 of the 18
panels. Replace with one list produced by one `collectDecisions()` that runs a
fixed set of rules against the lifecycle state. Each rule declares **who it
applies to, what the action is, and when the item expires**. No rule may emit
an item without an exit condition.

| Item | Applies to | Action | Exits when |
|---|---|---|---|
| Client wrote and nobody replied | active, ending, maintenance, onboarding | reply (opens thread) | reply sent or 7 days |
| Menu / monthly card / plan draft waiting approval | active, maintenance | approve or edit | approved, skipped, or auto-approve fires |
| Renewal decision due | ending only | choose continue / maintenance / letter-only / not renewing | decision recorded |
| Session to book | active only, by real coaching-session gap or recheck date | send booking link (one click, not pre-ticked) | booking received, or lifecycle leaves active |
| Intake missing / plan to build | onboarding only | record intake, author plan | plan published |
| Follow-up draft to approve | prospect, day ≤ 30 | approve, edit, stop | approved, stopped, or day 35 |
| Win-back draft to approve | lapsed, day ≤ 56 | approve or skip | approved, skipped, or day 70 |
| Flagged in the app (plateau, regression, feedback received) | active, maintenance | look | acknowledged or 14 days |
| Archive suggestion | prospect quiet > 45d, lapsed quiet > 70d | archive | archived |

Everything else that is on the dashboard today either moves to a separate
**Roster** page (practice overview, MSQ cohort, app links, pause roster,
upcoming bookings) or goes away (the dormant strip, start-date reminders, the
booking-link-pending overlay, broadcast, weekly poll, cycle-date reminders,
deferred items, feedback asks as a panel).

The 07:30 digest email lists the same items from the same function, so the
inbox and the email can never disagree.

### C. One gate at the send door

Today there are **nine separate pieces of code that do the network send** (3
WhatsApp POSTs, 7 nodemailer transporters, 2 web-push senders) and none of the
core senders checks opt-out, lapsed, maintenance or declined at send time. The
gates that exist live in some callers only. Collapse to one `sendWhatsApp`, one
`sendEmail`, one `sendPush`, each calling:

```
mayContact(person, purpose) → { ok, reason }
```

| Purpose | prospect | onboarding | active | ending | maintenance | lapsed |
|---|---|---|---|---|---|---|
| session booking | no | intake only | yes | yes | only the paid quarterly recheck | no |
| plan / menu / card / push | no | yes | yes | yes | lighter set | no |
| follow-up drip | ≤ day 30 | no | no | no | no | no |
| renewal letter | no | no | no | yes | no | no |
| win-back | no | no | no | no | no | ≤ day 56 |
| content note ("thought of you") | ≤ 1 per 30d, ≤ 365d | no | no | no | no | no |
| reply to their message | always | always | always | always | always | always |

`marketing_opt_out` blocks every marketing purpose everywhere, not just the
interest notes. Every send records to the thread through one path
(`sendAndRecordOutboundAction` already exists; about 10 callers bypass it and
five record nothing at all, including the mobile `/api/m/wa` route).

### D. A client brief for chat

This is the highest-value piece for you personally. Three chat skills each
rebuild client context a different way (`assess.py --author_context`,
`renewal-brief.py`, and `author-plan` reading files by hand), and **none of them
renders lifecycle state, what was last sent, or whether the client is using the
app**. Those are exactly the three things you re-explain.

Build `scripts/client-brief.py <id|name>` that emits one block:

- who: name, age, conditions, meds, diet rules, allergies
- lifecycle: state, since, tier paid, `maintenance_paid_through`, renewal decision
- plan: live plan, phase and week, effective end, supplements and practices in force, deferred items
- recent: last 5 thread messages in and out with dates and templates, last check-in, last labs, open decisions from the inbox
- app: last open, ticks this week, practice log, feedback answers
- what not to do: opt-out, foods to avoid, triggers, anxious-client flags

Then a `/client <name>` skill that runs it, and make the three author-* skills
call it instead of their own briefings. The same function feeds the Brief view
on the client page, so the page and the chat show the same thing.

### E. Client page: three views

Replace the overview with 56 components by:

- **Brief** (read-only, the same block as D, rendered)
- **Record** (write: session, labs, note, measurement; the five analyse forms collapse into one form with a type selector)
- **Plan** (the existing plan page, trimmed)

Everything else on the client page today is either a second UI over something
you do in chat (SOAP, handoff, dirty-genes, pregnancy, medication impact, IFM
trend, protocol adherence, session brief modal) or a widget with no importer.

---

## 5. What to delete or retire

### Delete now (about 15,600 lines, no live importer, high confidence)

| What | Lines | Note |
|---|---|---|
| Streamlit UI `fm-database/fmdb_ui/app.py` + `run-fmdb.sh` + `streamlit` in requirements | 3,377 | last touched June |
| 18 one-off Python scripts in `scripts/` (backfills, audits, migrations already run) | 3,090 | list in the dead-code appendix |
| 17 client widgets with zero importers (`reports-tab`, old `check-in-form`, `special-requests-panel`, `health-trends`, `protocol-checkin-panel`, `ifm-timeline-card`, `lab-panels`, `transcript-update-panel`, `message-capture-panel`, `timeline-editor`, `client-profile-editor`, `api-usage-panel`, `client-avatar`, `session-type-picker`, `client-contact-widget`, `follow-up-draft-panel`, `delete-client-button`) | 5,016 | |
| 12 other zero-importer components (`new-plan-wizard`, `protocol-template-picker`, `FmAnalysisProgress`, `FmWhatsAppDraftPanel`, `plan-chat-and-preview`, `plan-outcomes-panel`, `meal-plan-drip-panel` + its action file, `coach-notes-editor`, old `catalogue-commit-button`, `grocery-panel`, `auto-sized-letter-iframe`, `overview-send-labs-card`) | 2,900 | |
| 23 server actions with zero call sites | ~700 | list in appendix |
| 10 redirect shims (`/dashboard-legacy`, `/clients*`, `/plans*`, `/assess`, `/sources`, `/timeline`) + legacy `sidebar-nav.tsx` | 334 | old bookmarks; six months is long enough |
| `interests-backfill.ts`, `renewal-decision.mjs`, dead allowlist entry `/api/whatsapp-poll-webhook` | ~150 | |

### Retire after a decision from you (about 9,600 lines, mounted but unused or superseded)

| Feature | Lines | Evidence | My recommendation |
|---|---|---|---|
| Start-date confirmation (tokens, `/start/[token]`, reminder panel, parser) | 1,933 | retired per brief; still mounted | delete; the webhook parser branch goes with it (`start-date-parser.ts` is also used by cycle-date-collector, split first) |
| Dirty genes page + card + libs | 1,728 | FAB + overview card | keep the data, drop the page; chat does this |
| Weekly poll panel + send path | ~900 | zero sends in log since May | delete the panel; keep the shared pillar helpers |
| SOAP note page + panel | 1,133 | FAB only | delete; `renewal-brief` and the new client brief cover it |
| Handoff page | 793 | FAB only | delete |
| Token admin | 659 | nav only | fold the revoke action into Settings, delete the page |
| Broadcast panel | ~530 | gated, no evidence of use | delete |
| Mobile coach app `/m` + `/api/m/*` + `/api/m-bridge/*` | 2,140 + 830 | no file written since 2 Aug | delete unless you want it; the inbox should be phone-usable anyway |
| `/recipes/[planSlug]` | 298 | only linked from the retired letter renderer | delete |
| `/guide/thyroid` | 250 | no in-repo link | keep only if it is linked from Instagram or the funnel |
| Zoom webhook | 227 | no env in example, untouched since June | delete if the Zoom app is no longer configured |
| `/api/handover/test`, the two maintenance invoice routes + actions | ~170 | no callers | delete |

### Extract, then delete

- `scripts/render-client-letter.py` (8,595 lines) is still imported as a module by the live weekly-menu drafter for four helpers (`generate-app-menu.py:63-69`). Move `_build_prompt_meal_plan`, `_load_client`, `_load_plan`, `_load_dotenv` into a small module, then delete the file.
- `scripts/brand_html.py` (1,682) still serves the lab requisition and topic brief renderers. Trim to the CSS those two need.

### Keep as they are

The client app (`src/app/app`, 19,916 lines, in daily use), the crons that feed
it (menus, grocery, recipes, monthly cards, reminders, push), the intake form,
the lab-order and maintenance payment flows, the catalogue, the ingest page,
the WhatsApp and cal.com webhooks, the thread panel and message templates
panel (in active use via the FAB).

---

## 6. Sequencing

**Phase 0 — stop the bleeding (one session, no redesign).** Do these before anything else because they are live now and one of them fires on 28 October.

1. `scheduling-due.ts`: add `is_maintenance` to `PlanLite`, skip maintenance clients, count only real coaching-session files (`.yaml`, not `.bak`, not `-app-*`), un-pre-tick the rows.
2. `computeSignal`: lapsed goes to its own quiet bucket, read `_renewal_decisions.yaml`, pick the newest published plan, fix `returning` to read `sessions[0]`, gate `plan_to_build` on signup, cap `booking_link_pending` at 30 days and gate on lifecycle.
3. `renewal-sweep`: clear `next_contact_date` when flipping to lapsed; move superseded plans out of `published/` (`niti-plan-1`, `ochre-plan-2` today).
4. Schedule `prospects-sweep --apply` at 06:35 and stop it parking lapsed clients.
5. Discovery follow-up: expire `pending` drafts older than 14 days; cap "In follow-up" and "no call on record" at 45 days.
6. Review nudges, start-date reminders, pause roster, app-links, weekly poll: add the `isLapsed` guard that v0.84 added to the spend paths.
7. Fix the feedback-ask step so it does not write an app-open for every finished client.

**Phase 1 — lifecycle resolver (two to three sessions).** Build `lifecycle.ts` + Python mirror + tests against the real roster, stamp it nightly, migrate every reader listed in section 3 to it, retire `lifecycle_state`.

**Phase 2 — send gate (one to two sessions).** One send function per channel, `mayContact`, every caller records to the thread.

**Phase 3 — client brief + `/client` skill (one to two sessions).** Highest value to you. Can start in parallel with Phase 1 since it only reads.

**Phase 4 — deletions (one to two sessions).** Section 5, in order of confidence. Run the full suite and the build after each batch; the pre-push hook already gates lint and type-check.

**Phase 5 — decisions inbox (three to four sessions).** Replaces `dashboard-v2`. The Roster page absorbs the panels worth keeping.

**Phase 6 — client page three views (three to four sessions).** Last, because once the inbox and the brief exist, most of the client page is no longer where you go.

---

## 7. Decisions I need from you

1. Keep the mobile coach app (`/m`)? It has been dormant since 2 August. My recommendation is to delete it and make the inbox phone-friendly instead.
2. Of SOAP, handoff, dirty-genes page, token-admin, broadcast, weekly poll: anything you actually open? My recommendation is to delete all six.
3. Is `/guide/thyroid` linked from Instagram or the funnel? If not it goes.
4. Is the Zoom app still configured? If not the webhook goes.
5. Should "Session to book" exist at all for active clients, or do you prefer to book sessions yourself from the brief? If the latter, the whole scheduling-due scanner goes.

---

## Appendix — where the detail lives

The four agent reports (dashboard logic with a live reproduction table, crons
and send paths, usage counts, dead-code inventory with per-file confidence)
are summarised above. Specific file lists for the deletions:

**Unreferenced Python one-offs:** `generate-archetype-recipes.py`,
`generate-thyroid-root-cause-guide.py`, `audit-allergy-capture.py`,
`build-dish-list.py`, `backfill-menu-portions.py` + `fill-menu-portions.py`,
`build-grocery-from-menu.py`, `compute-recipe-calories.py`,
`migrate-app-menu.py`, `audit-vitaone-covers.py`, `update-intake-insights.py`,
`consolidate-whatsapp-threads.py` + `merge-whatsapp-thread.py`,
`audit-dish-titles.py`, `write-exercise-progression.py`, `backfill-good-for.py`,
`build-handouts.py` + `handout_brand.py`, `export-recipes-json.py`.

**Server actions with zero call sites:** `plan-lifecycle.ts`
(`removeSupplementFromActivePlan`, `supersedePlan`, `diffPlans`),
`plan-change-notify.ts` (approve / dismiss / preview draft),
`winback-drip.ts` (`previewWinbackDraftAction`, `resumeWinbackDripAction`),
`clients.ts` (`generateTopicBrief`, `setMaintenanceStatus`), `intake.ts`
(`markDiscoverySessionComplete`, `markDiscoveryLabPackSent`),
`lab-requisition.ts` (two WA-link getters), `invoices.ts` (two maintenance
invoice getters), `client-chat.ts` (`recordClientMessageAction`,
`chatUnreadAction`), `app-preview.ts` (`generateAppMenuAction`),
`meal-review.ts` (`loadMealQueueAction`), `plans.ts` (`exportRecipesAction`),
`weekly-poll.ts` (`previewPillarRotationAction`),
`plan-conflict-actions.ts` (`runConflictCheckAction`).

**Duplication to collapse while there:** 6 phone normalisers plus 18 inline
strips; 38 local date formatters while `format-date.ts` has 3 unused exports;
9 inline re-parses of the `[session_type:` tag beside `parseSessionType`;
4 direct `WHATSAPP_SERVER_URL` fetches beside `sendWhatsAppAction`; two
sidebars; copied `publicOrigin` / `firstName` helpers.
