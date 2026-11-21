# Coach app rebuild: build plan

Written 21 November 2026. The design is the mock-up at https://claude.ai/artifact/UycgFH5u1UPtZoqEh3tTCT (version 12, 12 boards). The reasons behind it are in `FEATURE-STUDY.md` in this folder, including your 8 decisions of 21 November.

## The approach in one paragraph

Keep the engine, replace the screens, the same way the client app was done. Almost everything the mock-up shows already exists in some panel: the safety detectors, the lab read, quick edits, menus, the WhatsApp thread, payments. It is spread over about 56 widgets and 15 pages. So the build is a new front with four parts: Today, Clients (each client has Brief, Plan, Labs, History, Thread and Setup), Money and Reference. It sits on top of the code that exists, then about 70 features the study cut are removed. Writing stays in chat at $0: assessments, plans, renewals, the catalogue and session notes.

## How it reaches you safely

- **Side by side.** The new screens live at new addresses next to the old ones. The old dashboard keeps working, untouched, until you say it can go.
- **Nothing new sends.** Every new screen only reads, approves, makes a logged quick edit, or sends the one thing you pressed. The contact gate and the lapsed-client guard stay in front of every send.
- **Test client first.** Each step is tried on the test client (cl-900) before you use it on a real client.
- **Your Mac stays the source of truth.** Everything you change still writes the same client files, so the old and new screens always agree.

## The steps, in order

Each step ends with something you can open at `localhost:3002` (and at `fmcoach.shivanihari.com` on the tunnel). Each is one or two working sessions.

| # | Step | What you can try when it is done |
|---|---|---|
| 0 | The new shell | Side menu with Today, Clients, Money and Reference; the client screen with its six tabs, empty; the old screens one click away |
| 1 | Clients, switching and adding | The list with search and the In care / Starting / Maintenance / Prospects / Ended filters; "/" to jump to anyone by name; **Add a client** with the intake link sent at once and one gentle reminder after 3 days, then nothing |
| 2 | Today | One list of what needs you (messages, safety, menus, renewals, reviews due, prospect drafts, stuck onboarding, held monthly cards); This week; Running by itself; AI spend against a monthly cap that stops the crons; **a reply clock** on every waiting message |
| 3 | Brief | Since you last looked; one Safety block that re-runs whenever her record changes (new medicine, condition, lab, pregnancy); Labs summary; Next; **You said you would** (your own promises from calls); 7 days in the app; her setup; **the before-and-after view** |
| 4 | Plan, including the diet protocol | Gate results; the 12 weeks with the legend; supplement and practice quick edits; check a supplement for her; your recommendations; "runs out before week 12"; the menu with approve, swap and grocery list; **the diet protocol picker, wired through to the weekly menu** |
| 5 | Labs | Every marker with its range and trend; the holistic read with system cards, ratios and patterns; the pre-test checklist; lab orders and pay links (Thyrocare first); the body age report; the week-12 retest put on Today when it is due |
| 6 | History, including one weight log | Sessions and their notes; private notes; conditions you can resolve or bring back; what she has told us; cycle; **weight with one log that the client app and you both write to**; **"what we agreed" notes** after each call |
| 7 | Thread and Setup | WhatsApp and email in one thread, templates, direct booking and send-a-booking-link; Setup with meal plan style, the app switches (lab results on by default), diet, dairy, allergies, who cooks, links and forms; **the cook's language and family versions**; **the fasts she keeps** |
| 8 | Money and Reference | Every payment in one place, including the ₹85,000 programme instalments; the read-only catalogue search and the product links table |
| 9 | The phone coach app (`/m`), rebuilt | Today, Clients and replying on WhatsApp from the phone; a phone push when a client message arrives; the daily digest email stays |
| 10 | Clear out | The cut features removed (win-back, interested-people notes, feedback asks, handout drip, journey strip, the coach-UI AI helpers, ingest/staging/cleanup screens, dead code); crons from 23 to about 15; the old addresses redirect to the new ones |

Rough calendar: the client app's switch-over on 2 January comes first. Steps 0 to 3 fit around it in December; steps 4 to 10 in January. Steps 4 and 6 hold the two pieces of real new engine work (below), so they are the ones not to rush.

## The two things the mock-up promises that need new engine work

**1. The diet protocol reaches the menu (step 4).** Today a protocol is attached to a plan in chat, but the weekly menu drafter never reads it. It reads only the plan's own food section: pattern, eat freely, leave out. The build:

- The picker saves the protocol on the plan, and copies the protocol's eat-more and leave-out lists into the plan's food section, with your own additions marked as yours.
- The weekly menu drafter keeps reading that food section, so whatever you pick reaches the next draft.
- On a published plan this is a logged quick edit like a supplement change: she sees "your plan was updated", and earlier approved weeks never change.
- Her diet always wins. A protocol written for meat-eaters (AIP, for instance) has its meat, fish, egg and broth items dropped for a vegetarian, eggetarian, Jain or vegan client, before anything reaches her menu. This is the same safety rule as the veg templates, and it gets its own tests.
- Plan-check re-runs on save, and food cautions still push a dish down rather than hide it.

**2. One weight log (step 6).** Weight lives in three places today: what the client logs in her app, what you log, and what came from the intake form. The screens already read all three together through one reader (`collectWeightSeries`), so nothing is lost on screen. What is missing is one place to write and one way to correct or delete a wrong entry. The build:

- Every new weight, from her or from you, goes to the same log.
- The two older stores are copied into it once, with a backup first.
- The combined reader stays for one release as a safety net.
- Correcting a wrong entry is done in one place and shows everywhere.

## Added from the outside research (your yes, 21 November)

The research (`CLIENT-VALUE-RESEARCH.md`, on branch `claude/client-value-research-5aa4f5`) found that clients value: a plan built for them, the same coach, a real person who replies, being listened to with clear explanations, and seeing their own progress. Five features go into this build:

| Feature | Step | What it is | Client-app side |
|---|---|---|---|
| **Reply clock** | 2 (Today) | Each unanswered client message shows how long it has waited, oldest first, turning amber near the 24-hour reply promise the client app already makes. Nothing is sent. | None |
| **Before-and-after view** | 3 (Brief) | Week 1 against now from her own dated records (symptom scores, weight, blood pressure, released labs), improvements first, plain numbers. You see it before a review; she sees it once you release it, like lab results. Covers the study's "outcomes" gap. | Fills the "Your progress" sheet, which today shows "soon" |
| **"What we agreed" note** | 6 (History) | After each call, three or four lines: what was decided, what changed, what you promised. Written in chat or on the History tab, never automatic. Your promises land on "You said you would". | A dated card in her Coach tab |
| **Cook's sheet for the household** | 7 (Setup) | The cook's language per client (Hindi now, more languages written in chat at $0), and an optional "family version" line per dish so one meal is cooked for everyone. | Link the existing bilingual cook's sheet from the new menu and grocery screens |
| **Fasting and festival days** | 7 (Setup) | Which fasts she keeps (Navratri, Ekadashi, Karva Chauth, Ramadan, Paryushan, a weekly vrat). The menu draft plans fast-safe meals for those dates, supplement timing is checked for fasting days, and "fast coming up" shows on her Brief. | Shows in her own menu, not as a message |

The client-app parts are built in the client app's own steps after 2 January, so the two builds don't collide.

**Also decided:**
- Supplement commission is not stated to clients (your call, 21 November).
- **WhatsApp consent is now in the intake form itself.** Both the full intake form and the short pre-call form name sending the plan, reports and lab results on WhatsApp and by email (India's data protection law, the DPDP Act). Done 21 November, outside these steps.

## What I need from you

| What | Needed by | If it does not arrive |
|---|---|---|
| The wording of the one gentle intake reminder | Step 1 | My draft: "Your intake form is waiting whenever you have 20 minutes. It's what your plan is built from." |
| The monthly AI spend cap | Step 2 | $15 a month, as in the mock-up |
| Whether lab results switch on for clients already in care, and anyone to keep off (for example anxious clients) | Step 7 | On for new clients only; existing clients keep their current setting until you change it |
| When the old screens can go | Step 10 | They stay, reachable from a link, until you say |
| Which fasts the intake form asks about, beyond the six listed | Step 7 | Those six, plus "other" with a text box |

## Gaps from the study, and where they landed

| Gap | In this build? |
|---|---|
| Review prompts (week 4, 8, 12, recheck) | Yes, on Today (step 2) |
| Re-checking live plans when her record changes | Yes, in Safety (step 3) |
| Your own to-dos from calls | Yes, "You said you would" (step 3) |
| Supplements running out before week 12 | Yes, on Plan (step 4) |
| Lab retest loop | Yes, the retest comes onto Today when due (step 5) |
| Programme payments and instalments | Yes, on Money (step 8) |
| A client's reaction or flare, with "stop this, here's why" | Not yet: needs your view of what to record |
| Before-and-after view of the 12 weeks | Yes, from the research (step 3) |
| Pausing the programme for illness or travel | Not yet: it touches the fixed 12-week clock rule, so it is yours to decide |
| Backups and a restore drill | Not in this build; a separate piece of work |

## What stays out of this build

Writing in the app (it stays in chat). The food diary (hidden until a client asks; the code stays dormant). Any automatic nudge, drip, poll or broadcast. Hindi screens.

## Running cost

No new paid AI. The new screens read files; the menu drafts, renewals and intake insights cost what they cost today, inside the new monthly cap. Writing stays in chat at $0. Nothing is spent on a lapsed client: the existing guard still refuses.

## Risks

- **The public tunnel.** `fmcoach.shivanihari.com` serves the whole coach UI. Every new address must sit behind the same coach password as the old ones, and step 0 is not done until that is checked from outside the Mac.
- **Lab results by default.** This reverses the client app's 18 November rule. The client app's step 5 is built to "released per client", so the two builds must agree before either ships. Lab wording to clients follows the existing rules: good news first, and never "urgent".
- **A protocol that does not fit her diet.** Covered by the diet-first filter and its tests (above).
- **Moving the weight entries.** It is done once with a backup, and checked against the combined reader before the old stores stop being written.
- **Two screens on the same files.** While old and new run side by side, both can edit the same plan. Quick edits go through the same server actions in both, so the file never holds two versions.

---

## Builder notes

For whoever builds this (the assistant, in later sessions). The coach does not need this part.

### Decisions already made (21 Nov 2026)

1. Intake: link on payment plus one gentle reminder, then nothing. Change the existing reminder path to send once, not repeatedly.
2. Booking: keep both direct booking and send-a-booking-link (coach-pressed, transactional through the contact gate).
3. Food diary: hidden, code dormant.
4. `/m` rebuilt as its own phone app (step 9).
5. Lab results to clients on by default, per-client off switch.
6. Sunday recipe-photo job stays automatic.
7. Prospect follow-ups stay drafts.
8. Alerts: daily digest email, plus a push for new client messages.

### Where things are (reuse, don't rewrite)

| Tab | Existing pieces |
|---|---|
| Today | `src/lib/fmdb/decisions.ts` (12 kinds), `components/weekly-menu-queue-panel.tsx`, `components/renewal-queue-panel.tsx`, `MonthlyCardReviewPanel`, `FmUpcomingBookingsPanel`, the cron heartbeat in `scripts/cron-runner.js`, `_api_usage.jsonl` spend logs |
| Clients | `/clients-v2` list, `lifecycle.ts::resolveLifecycle` for the filters, `send-intake-form-button.tsx`, `intake-progress-card.tsx` |
| Brief | `scripts/client-brief.py`, `clients-v2/[id]/brief`, the safety cards (`tier1-advisory-card`, `unsupervised-medication-card`, pregnancy panel, dairy panel, `supplement_clash.py`, `drug_match.py`) |
| Plan | `plan/quick-edit-supplements-panel.tsx`, `plan/quick-edit-practices-panel.tsx`, `plan/coach-recommendations-panel.tsx`, `plan/attached-protocols-panel.tsx`, `plan/client-fit-panel.tsx`, `supplement-check-widget.tsx`, `app-preview-panel.tsx` (menu studio), `scripts/generate-week-menu.py`, `scripts/generate-grocery-list.py` |
| Labs | `FmMarkerPanel.tsx`, `lab-synthesis-panel.tsx` + `fmdb/assess/lab_synthesis`, `lab-pretest-form.tsx`, `lab-recommend-card.tsx`, `lab-orders.ts`, `body-age-report-card.tsx` |
| History | `clients-v2/[id]/sessions`, `client-memory-panel.tsx`, `condition-status-chips.tsx`, `cycle-tracking-panel.tsx`, `weight-quick-log.tsx`, `weight-progress.ts::collectWeightSeries`, `measurements.ts::collectMeasurementSnapshots` |
| Thread | `whatsapp-thread-panel.tsx`, `email-compose-panel.tsx`, `message-templates-panel.tsx`, `book-session-modal.tsx`, `contact-gate.ts` |
| Setup | `plan-modules.ts` (`meal_plan_style`), `results-shared-toggle.tsx`, `app-nutrients-toggle.tsx`, `weekly-generation-toggle.tsx`, `dairy-reaction.ts`, `send-app-link-button.tsx` |
| Money | the Razorpay webhooks, `lib/fmdb/invoices.ts`, maintenance pay routes, `foundation-session-card.tsx`, body age orders |
| Reference | `/catalogue`, `/backlog?tab=links` (product links), `/search` |
| Phone | `src/app/m`, `scripts/coach-staging-action.py` (the projection on Fly), `api/m/wa`, `api/m-bridge/intake-link`, `api/m/push` |

### Invariants every step must keep

- Who is in care comes only from `resolveLifecycle` / `resolve_lifecycle`.
- Every send goes through `mayContact`; `session_booking` stays refused for automation.
- Every paid script calls `refuse_if_expired`.
- Published plans are frozen: quick edits use the existing quick-edit actions, and dates go through `updatePlanStartDates`.
- Every `status_history` reason is client-facing: the quick-edit reason box is labelled so.
- `client_fit` is never saved from the plan screen. A new supplement needs its row from chat or the existing gate.
- Lab writers go through `merge_markers`.
- YAML from TypeScript uses `dumpYaml`. A new client field needs its Pydantic field (`extra="forbid"`), plus `_APP_CLIENT_KEYS` if the Fly app reads it (the new lab-results default does).
- Menu approval appends, never trims.
- Food cautions down-rank, never hard-filter. **The new diet-first filter on protocols is a hard filter on purpose: it is a diet rule, not a caution.**

### Step detail worth knowing now

- **Step 0:** a new route group, for example `src/app/(v3)/`, with its own shell. Check `src/proxy.ts` mode for the tunnel before calling it done.
- **Step 2, spend cap:** there is no monthly cap today (study 6.2). Add one guard read by every paid script and cron, next to `refuse_if_expired`, with a test like `test_expired_spend_guard.py`.
- **Step 3, live re-check:** run the same detectors the Safety block shows whenever `client.yaml` medications, conditions, pregnancy or labs change, and put any new firm or soft finding on Today.
- **Step 4, protocol into menu:** write into `plan.nutrition.add` / `reduce` and `attached_protocols`; mark coach additions so "Reset to the protocol" can tell them apart. The diet-first filter reads `dietary_preference` and drops animal items for vegetarian, eggetarian (not eggs), Jain and vegan. Jain also drops onion, garlic and root vegetables. Tests: one per diet against AIP and Whole30.
- **Step 6, weight:** choose one store to write to, migrate the other two with a backup, and keep `collectWeightSeries` reading all three for one release. The client app's weight write (`save-app-body`, on Fly) must move to that same store, so this step needs a Fly deploy.
- **Step 7, lab results default:** a new default on the client record, synced to Fly. Agree it with the client app's step 5 first.
- **Step 9, phone:** `/m` reads a projection on Fly. Writes that need the Mac (intake link, plan edits) go through the bridge or wait for the Mac; say so on screen rather than failing silently.

### Gates before every push

```bash
cd fm-database-web && npm run lint -- --max-warnings 0 && npm run type-check
```

Tests from a worktree need `FMDB_PYTHON` pointed at the main checkout's venv. The coach UI is the pm2 `fm-coach` process built from the main checkout, so each step needs merge, rebuild and a check at `localhost:3002`. Steps 6, 7 and 9 also touch Fly and need a deploy.
