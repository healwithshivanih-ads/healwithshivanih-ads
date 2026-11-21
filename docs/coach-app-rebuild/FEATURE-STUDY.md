# Coach app rebuild: feature study (21 November 2026)

Step one of the coach app rebuild, done the same way as the client app: agents study the
app first and nothing is built yet.

**Who did it.** Five coach agents each took one part of the app and listed every page,
panel, button, queue and automatic job in it. For each they gave usage evidence and a
verdict:

| Coach agent | Area | Focus |
|---|---|---|
| A | Client record and assessment | Safety first |
| B | Plans, supplements and meals | The plan writer |
| C | Messages, renewals, labs and payments | The business side |
| D | Catalogue and knowledge | |
| E | Dashboard, phone app, settings and every cron job | The busy coach on her phone |

Then seven client testers from the client-app rebuild rated every feature that reaches a
client: Nandini the tracker, Rhea the anxious client, Sunita (Hinglish, not comfortable
with phones), Priya who travels, Kavita who values the mind-body practices, Rajesh the
sceptic, and Deepa on her first day. The QA checker became an operations checker: it looked
for overlaps, broken rules, verdicts that contradict their own evidence, and gaps.

**Limits.** There are no page-view logs, so "used" means files written, `sent_at` dates,
cron logs, git dates and whether anything still calls the code. The client testers judged
written descriptions, not the real thing. Every checker claim used below was checked
against the code; two were wrong and are marked.

Full data: `feature-inventory.json` next to this file (294 entries, with every agent's text
and every client rating). The table at the end lists all of them.

---

## 1. The finding in one paragraph

The coach app is now mostly something you read, and you author in chat. Since 1 August:

- 3 sessions were written through the coach UI, none since August.
- Coach-UI AI buttons have made zero API calls.
- 8 plans were created (6 in August, 2 in October), all in chat.
- Nothing has been ingested since 27 July, and the phone coach app (`/m`) has not written a
  file since 2 August.

What is really used is small:

- weekly menu approval (about 120 approvals since July, 8 in November)
- small supplement and practice edits on live plans (7 in November)
- the WhatsApp thread
- the renewal queue (17 decisions, 3 emails sent)
- payments (12 lab orders in September and October, 5 maintenance payments)
- the intake form (10 of 12 in-care clients submitted)
- the crons that feed the client app (menus, grocery lists and recipes: $8.90 of AI since
  August, all automatic)

The agents list 294 entries. The checker found 58 groups where the same thing is listed
more than once, so the real number of distinct features is nearer 200.

| Coach verdict | Entries |
|---|---|
| Keep | 85 |
| Simplify | 54 |
| Merge | 38 |
| Automate | 22 |
| Move to chat | 21 |
| Cut | 74 |

The cut and move-to-chat entries come to about 73,000 lines.

**The clients agreed with the coaches almost everywhere.** Not one feature that the
coaches would cut was rated worth it by most clients. Every feature that most clients
called harmful is a nudge, drip, ask or sales note. That is your no-chasing rule, arrived
at independently by seven different clients.

## 2. What the rebuilt coach app looks like (the agents' combined proposal)

1. **Today**, usable on the phone. One list of what needs you: new messages, menus to
   approve, renewals, prospect follow-up drafts, stuck onboarding, held monthly cards. The
   daily digest email stays as the second way in. This replaces the dashboard panels and
   the separate `/m` app.
2. **One client screen in three parts.**
   - **Brief:** what changed since last time; one Safety block that runs every detector at
     once (red flags, drug and supplement clashes, pregnancy, unsupervised psychoactives,
     depletions, dairy, exercise blocks, labs); one Labs block; the client-app switches as
     one row.
   - **Plan:** reads the plan chat wrote, shows the gate result (plan-check, `client_fit`,
     clashes), publish or revoke, one quick-edit sheet for supplements and practices, and
     the menu studio.
   - **Thread:** WhatsApp and email in one place.
3. **Reference.** A read-only catalogue you search, plus the product-links table (it holds
   commission money).
4. **Money.** One view of who has paid what: Foundation, labs, maintenance, programme.
5. **Behind the scenes.** About 10 to 15 crons, down from 23 (menus, grocery, recipes,
   reminders, renewals, prospects sweep, integrity check, payments, staging sync).

Writing (assessments, plans, renewals, catalogue) stays in chat at $0, through the
author-* skills.

## 3. Kept by coaches and clients alike (worth it to all seven clients)

- **Menus:** the weekly menu draft, approval queue, auto-approve safety net, menu studio,
  grocery list, and food cautions on the menu.
- **Plans:** plan lifecycle and dates (Day 1, recheck, the fixed 12-week clock),
  supplement quick-edit, and the buy-link manager.
- **Messages:** the WhatsApp thread and inbound webhook, the app invite, appointment
  reminders, the email-reply reader, and plan-update drafts to the client.
- **Sessions and sync:** the Foundation session cards and the Fly staging sync.

Also kept on safety or money grounds, though clients never see them directly:

- plan-check
- the `client_fit` gate
- the contraindication matcher, pregnancy check, dairy panel and psychoactive card
- the lifecycle resolver and contact gate
- the payment webhooks
- the validator and CI gate

## 4. Cut by coaches and clients alike

These are the features most clients called harmful or not worth it, and the coaches also
cut:

- win-back drip (card, panel and cron)
- "thought of you" / interested-people notes
- programme feedback asks and the "Ask on WhatsApp" button
- handout drip and the education-pack email
- the journey strip, stage gate and five-pillars bridge
- the plan-publish follow-up sends (see 6.1)

Also cut, unused since summer:

- every coach-UI AI helper: plan chat, client quick chat, the catalogue chat box, the
  follow-up plan generator, the resource generator, the full-assessment page
- the plan editor as a writing tool
- the ingest, staging, cleanup and backlog screens
- the `/practice` and MSQ outcome pages
- the calendar and help pages
- about 15 pieces of dead code (no importer)

## 5. Where you need to decide (the agents disagree, or a rule is involved)

1. **Intake reminders.** The cron emails someone who paid but has not finished the intake.
   Five of seven clients called it harmful, and all three agents that listed it say cut.
   Your rule allows coach-initiated contact only, and this one is automatic.
   *Recommendation: cut it, and let the intake link go out once on payment.*
2. **Booking links you send by hand** (the Cal.com picker, the header button and the
   floating-button shortcut). The code counts these as "transactional" because you press
   them, so the contact gate allows them. The checker called this a gate bypass; that is
   wrong, it is deliberate. Six of seven clients still called it harmful.
   *Recommendation: keep direct booking (you pick the slot for them), cut send-a-link.*
3. **The food diary** appears in seven places with three different verdicts. No client has
   used it.
   *Recommendation: hide it, and bring it back only if Sequoya clients ask.*
4. **The phone coach app (`/m`)** has had no use since 2 August.
   *Recommendation: cut it and make Today work on the phone.*
5. **Lab results on the client app.** The plan agent proposed showing results to everyone
   by default. That contradicts the results-shared switch, which you release per client
   (your 18 November decision).
   *Recommendation: keep it off until you release it.*
6. **The weekly recipe-photo job** (`recipe-image-qc.py`, Sundays 05:30) commits to git
   and deploys to Fly with nobody watching. The code confirms it.
   *Recommendation: let it prepare the change, and deploy only on your OK.*
7. **Prospect call follow-up drafts.** They are drafts only and nothing sends without your
   click, which your existing rule allows. Clients were split.
   *Recommendation: keep them as drafts.*
8. **Digest email or push.** The agents disagree.
   *Recommendation: keep the email and add a push only for new messages.*

### Her decisions (21 November 2026)

| # | Decision |
|---|---|
| 1 | Intake: link on payment plus **one gentle reminder** a few days later, then nothing. |
| 2 | Booking: **keep both**, direct booking and a send-a-booking-link button she presses herself. |
| 3 | Food diary: **hidden until a client asks**; the code stays dormant. |
| 4 | Phone: **rebuild `/m` as its own phone coach app**, alongside the desktop app. |
| 5 | Lab results: **shown to clients by default**, with a per-client off switch. This reverses the 18 Nov rule in the client-app build plan (results released per client). |
| 6 | Sunday recipe-photo job: **stays automatic** (commit and Fly deploy). |
| 7 | Prospect follow-ups: **kept as drafts**; nothing sends without her click. |
| 8 | Alerts: **daily digest email, plus a phone push when a client message arrives**. |

## 6. Things found in the live app today (not the rebuild)

1. **Every plan publish still sends two WhatsApps.** `FM_AUTO_PUBLISH_FOLLOWUPS=1` is set
   in the live `.env.local`, so `publishPlan` (`plan-lifecycle.ts`) does two things:
   - sends `fm_plan_letter_link_v1`, a link to the retired letter page;
   - queues `fm_supplement_order_v1` for 6 hours later (`plan-publish-followups.ts`,
     drained by the pending-sends cron).

   Letters were retired in July. *This is a one-line switch-off if you want it now.*
2. **There is no monthly cap on AI spend.** There is an authorisation flag and a per-client
   expiry guard, but nothing stops the crons at a monthly limit.
3. **Checked and fine:**
   - The weekly menu drafter does refuse lapsed clients. `generate-app-menu.py` calls
     `refuse_if_expired`, and the route skips dormant rows. The checker's worry was wrong.
   - The booking-link sends are allowed by design (see 5.2).

## 7. Gaps: what nobody's feature covers

Raised by the agents and the checker. Each needs your view before it goes in the build:

- **Review prompts:** nothing says a week 4, 8 or 12 review or a recheck is due.
- **Re-checking live plans:** a new medication, pregnancy, condition or lab result does not
  re-run the safety checks on a plan that is already live.
- **Reactions:** there is no record of a client's reaction or flare, and no "stop this
  supplement, here's why" step.
- **Outcomes:** there is no before-and-after view for the 12 weeks (MSQ, weight, labs,
  symptoms).
- **Lab retest loop:** recommending and paying exist, but nothing schedules the week-12
  retest or follows the results in.
- **Pausing the programme:** there is no pause or extension for illness or travel; the
  12-week clock cannot freeze.
- **Programme payments:** there is no status for the ₹85,000 programme (instalments,
  refunds, failed payments).
- **Supplement refills:** nothing tracks a bottle running out before week 12.
- **Your own to-dos:** things you promised on a call have nowhere to live in the app.
- **Backups:** there is no backup or restore drill for `client.yaml`, plans and sessions.
  The Mac is the only authoritative copy.

## 8. What the clients said, one line each

| Client | What they said |
|---|---|
| Nandini, tracker | Keep what produces dated records, exact amounts and a reliable week; cut every nudge, drip and quiet hiding of my own numbers. |
| Rhea, anxious | Keep what makes me feel safe and looked after; cut every nudge, score and countdown. |
| Sunita, Hinglish | Keep what reaches my kitchen and my WhatsApp; stop everything that chases, nudges or sells to me. |
| Priya, traveller | Keep what lets a real person answer me fast, keeps my day and menu current and takes my money cleanly; kill every automated nudge. |
| Kavita, mind-body | Keep the quiet machinery: safe menus, my practices, her real replies, the safety gates. Cut everything that pokes me. |
| Rajesh, sceptic | Put your effort into menus, labs, numbers and fast replies; stop sending me nudges, booking links and wellness toys. |
| Deepa, first day | Keep what makes my plan safe, correct and delivered; cut every automated nudge, drip and marketing note. I came for a coach, not a sales funnel. |

---

## Appendix: every feature

The client column counts the seven clients' ratings as worth it / don't notice / not worth
it / harmful. A dash means no client sees the feature. Evidence is shortened; the full text
is in `feature-inventory.json`.


### A. Client record and assessment

| Id | Feature | Status | Evidence | Coach | Clients W/N/X/H |
|---|---|---|---|---|---|
| A1 | Clients list | live used | Entry to every client page; 12 in care of 21 client folders plus 14 prospects; last edited 23 Oct 2026.… | simplify | – |
| A2 | New client form (with AI transcript import) | live unknown | No file-write proxy for creation; no extract-client call in the API log since Aug; form untouched since 13… | automate | – |
| A3 | Client landing redirect and sub-navigation | automatic | Every client visit goes through it; edited 23 Oct 2026. | simplify | – |
| A4 | Floating quick-action button on client pages | live unknown | No access log. Booking-link send is refused for every lifecycle state by the contact gate (restructure… | simplify | 0/0/4/3 |
| A5 | Client Brief page | live unknown | Built 23 Oct, 3 commits since; every client link lands here; chat skill runs the same script. No view log. | keep | – |
| A6 | Overview 'More' page (the 56-widget screen) | live used | 9 commits since 1 Aug, latest 21 Nov 2026 (body-age card, nutrients and results toggles added here). Source:… | merge → Brief (safety, labs, preferences) and… | 1/5/0/0 |
| A7 | Client identity header and editor | live unknown | Header is on every client page; editor last edited 12 Jul; no write log. | simplify | – |
| A8 | Archive and unarchive control | live unknown | Last edited 29 Jul 2026. The lifecycle resolver and the 15-day prospects sweep now decide who is parked. | automate | – |
| A9 | Engagement picker (signed up, pending, declined) | live unknown | Last edited 20 May 2026; engagement_status is set on all 12 in-care records but project rule says never to… | cut | – |
| A10 | Coach notes button and panel | live unknown | Launcher edited 13 Jul 2026; notes are written in chat. | merge → Brief (plan block) | – |
| A11 | Preferences and triggers memory panel | live used | non_negotiables set on 8 of 12 in-care clients, reported_triggers on 6. Source: client.yaml field counts. | keep | 6/0/0/0 |
| A12 | Condition status chips (retire or revive a condition) | live unknown | Edited 30 Jul 2026; no write proxy. | keep | – |
| A13 | Dairy reaction panel (milk-protein allergy vs lactose) | live unknown | Edited 23 Oct 2026; an unclassified dairy word reads as excluded by design. | keep | 6/0/0/0 |
| A14 | Intake review page | live unknown | Edited 23 Oct; 10 of 12 in-care clients have a submitted intake. | merge → Brief (an 'Intake' section) | – |
| A15 | Client-facing intake form and submit path | live used | 10 of 12 in-care clients have submitted; 9 finalised; 9 intake-form sessions written Jul to Oct (3,3,2,1 by… | keep | 6/0/1/0 |
| A16 | Intake staging reconcile cron | automatic | Runs 1,440 times a day; hourly heartbeat in ~/.pm2/logs/fm-coach-cron-out.log shows active runs today (19… | keep | 4/3/0/0 |
| A17 | Intake progress card and stranded-draft rescue | live unknown | Card edited 4 Nov 2026; promote button last 22 May; 12 of 12 intake states derivable from fields. | simplify | – |
| A18 | Send intake form button | live unknown | Edited 2 Aug 2026; 4 in-care clients have an issued token, 2 currently open. No send log counted. | automate | 6/1/0/0 |
| A19 | Unlock full intake button | live unknown | Last edited 24 May 2026; only caller is this button. | automate | 1/6/0/0 |
| A20 | Automatic intake reminders | live unused | Toggle set on 10 of 12 in-care records, yet the last run (20 Nov) scanned 20, candidates 0, sent 0. Source:… | cut | 0/1/1/5 |
| A21 | Intake AI insights (Haiku) and card | automatic | Insights stored on 7 of 12 in-care clients; 1 call logged since Aug (cost about $0.01). Source: client.yaml,… | simplify | – |
| A22 | Verify-in-session checklist | live unused | Untouched since 20 May 2026; lives only inside the coach intake form, which has no recent writes. | cut | – |
| A23 | Coach-typed intake form (analyse/intake) | live unused | Last edited 2 Aug 2026. No session written by 'Shivani' since Aug; 0 intake-typed sessions from the coach UI… | cut | – |
| A24 | Tier 1 advisory card (Beighton, lean, PEM, mould re-screen) | live unknown | Edited 30 May 2026; no send log. | merge → Brief Safety block | 0/3/3/1 |
| A25 | Retrospective Tier 1 suspicions panel | live unused | Shows only for intakes older than the May 2026 form change; last edited 20 May 2026. | cut | – |
| A26 | Liver detox advisory card | live unknown | Edited 22 Jun 2026; $0. | merge → Brief Safety block | – |
| A27 | Unsupervised psychoactive medication card | live unknown | Built 21 Sep 2026 after a real case where both facts sat in intake and nothing joined them; has unit tests. | keep | – |
| A28 | Medication-depletion panel and banner | live unknown | Edited 14 May / 20 May 2026; current_medications present on 9 of 12 in-care clients. | merge → Brief Safety block (one line per drug) | – |
| A29 | Pregnancy and lactation supplement check | live unknown | Edited 14 May 2026; pregnancy_status set on 4 of 12 in-care clients. | keep | – |
| A30 | Check a supplement for this client | live unknown | Edited 10 Jun 2026; $0, no AI. Uses the single contraindication matcher. | keep | – |
| A31 | Exercise suitability panel | live unknown | Edited 5 Aug 2026; coach-side only. | merge → Brief Safety block (blocked movements… | 6/1/0/0 |
| A32 | Beighton verify and NASA lean test panels | live unused | physical_exam_findings is empty on all 12 in-care clients; last edited 20 May 2026. | cut | – |
| A33 | Somatic read panel | live unknown | Edited 23 Aug 2026; coach-side only. | move to chat | – |
| A34 | IFM baseline card, IFM matrix and IFM trend | live unused | ifm_baseline set on 4 of 12 in-care clients; matrix card only used in the dead AssessClient body; trend needs… | cut | – |
| A35 | Cycle tracking panel | live unknown | Edited 9 Aug 2026; last_menstrual_period present on 6 of 12 in-care clients. | simplify | 0/7/0/0 |
| A36 | Lab markers panel and re-run | live used | lab_markers populated on 11 of 12 in-care clients; written in chat via merge_markers. Panel edited 20 May. | keep | – |
| A37 | Holistic lab read (system scores, patterns, ratios) | live unknown | Edited 17 Nov 2026 (active work); $0. Mounted on More and inside the Full Assessment results. | keep | – |
| A38 | Pre-test confounder form | live unknown | Edited 17 Nov 2026; mounted only inside the lab upload panel. | keep | – |
| A39 | Lab upload and extraction panel; pending extractions banner | live unused | 0 extraction sidecar files exist for in-care clients; 5 PDFs added to client files since 1 Aug but no… | move to chat | – |
| A40 | DUTCH, GI-MAP and genetic report parsers | live unused | No functional_tests or genetics data on any in-care client record; last edited 6 Jun 2026; mounted only… | move to chat | – |
| A41 | AI plan-rework suggestion banner | live unused | No rework_suggestion stored on any in-care client; no call logged since Aug. Fires only after uploads or… | cut | – |
| A42 | Lab reference ranges editor | dead | The component itself has no importer; only a constant and a type are used. Last edited 14 May 2026. | cut | – |
| A43 | Recommend labs to client (Thyrocare primary, Acumen backup) | live used | 10 order files across 4 in-care clients; card and payment routes edited 17 Nov 2026; lab payments are live… | keep | 6/1/0/0 |
| A44 | Discovery workspace, form and booking email | live unknown | Workspace edited 25 Sep, form 2 Aug 2026; no discovery-typed session written through the UI since Jul;… | simplify | 3/4/0/0 |
| A45 | Old discovery form widget and expected-reports checkboxes | dead | Not imported anywhere except by each other (the live page uses its own local discovery-form); last edited 14… | cut | – |
| A46 | Send discovery labs button (preview, email, WhatsApp) | dead | No importer outside the file itself; the in-app lab recommend flow replaced it. | cut | 0/5/2/0 |
| A47 | Foundation session, discovery app and founding member cards | live used | All edited 7 to 27 Sep 2026; Sequoya launches 2 Jan 2027 and Founding 20 is the launch offer. | merge → One 'Offers and payment links' panel on… | 7/0/0/0 |
| A48 | Body age report card | live unused | 1 report built (a test profile), 0 sent, across all people; card edited 21 Nov 2026; launch is 2 Jan 2027. | keep | 1/6/0/0 |
| A49 | Client-app switches (results shared, nutrients, weekly menus, Ayurveda, mind-body pace, EFT themes) | live used | weekly_generation_paused on 2 clients, ayurveda_enabled on 6, mindbody_eft on 4, mindbody_sleep on 2; results… | merge → One 'App settings' list | 6/0/1/0 |
| A50 | Daily log panel (what the client ticked) | live unknown | Built 18 Nov 2026; reads _daily_ticks.jsonl present on in-care clients. | merge → Brief (app usage block) | – |
| A51 | Weight tools (quick log, goal card, progress verdict, readiness gate) | live unknown | A weight_loss goal exists on 3 of 12 in-care clients; goal card last edited 2 Aug; progress panel has an AI… | simplify | 0/4/2/1 |
| A52 | Plan modules checklist | live unknown | Edited 13 Jul 2026; plans are authored in chat with the same registry. | move to chat | – |
| A53 | Pre-session brief and session brief print modal | live unused | Pre-session brief last edited 3 Aug; modal 20 May; the Brief page replaced both. | cut | – |
| A54 | Client quick chat panel (AI Q&A) | live unused | Zero UI-triggered AI calls since Aug (API log); last edited 2 Jun 2026. | cut | – |
| A55 | Handout drip panel | live unused | 3 in-care clients have a schedule file, newest written 30 Jun 2026; none since. | cut | 0/0/5/2 |
| A56 | Back-on-track and monthly cards (deterministic generators) | automatic | Monthly cards cron exists; buttons last edited 28 Jun and 21 Oct; no coach-click proxy. | automate | 5/2/0/0 |
| A57 | Booking panel per client | live unknown | Edited 2 Aug 2026; cal.com webhook feeds it. | merge → Brief (next call line) | – |
| A58 | Journey chrome: stage gate, journey strip, workflow banner, five pillars bridge | live unknown | Last edited 20 May to 14 Jun 2026; check-in send conflicts with the no-chasing rule. | cut | 0/0/3/3 |
| A59 | Record hub (session type picker, timeline, book session, food diary) | live unused | Only 3 coach-UI sessions since 1 Aug (all Aug); edited 23 Oct. | simplify | 0/3/3/1 |
| A60 | Full assessment page (AI synthesis and plan draft) | live unused | No assess or draft calls in the API log since Aug; of 9 plans created Aug to Oct none came through this path;… | move to chat | – |
| A61 | Dead body of AssessClient | dead | AssessClient has no importer (only the file itself); helpers mount only inside it; FivePillarsCapture used… | cut | – |
| A62 | Check-in session form | live unused | Client app writes its own check-ins (4 app-checkin and 5 app-msq sessions Jul to Oct among in-care);… | cut | – |
| A63 | Quick note form | live unused | Last edited 20 May 2026; session notes now written in chat (legacy-name sessions 4 to 8 a month). | move to chat | – |
| A64 | Food diary (coach side) and cron | live used | 2 of 12 in-care clients have a food_diary record; cron runs every 5 minutes; 1 photo-read call logged in Oct.… | simplify | 0/4/2/1 |
| A65 | History tab (session browser, edit panel, tracking charts) | live unknown | Browser edited 22 Aug; edit panel 5 Jun; sessions arrive mostly from the client app, so the list is live data. | simplify | – |
| A66 | Lab marker trend tiles | live unknown | Edited 2 Aug 2026; needs 2+ lab sets; lab_markers on 11 of 12. | merge → Brief Labs block | – |
| A67 | Active plan reference page | live unknown | Edited 23 Oct 2026 (3 commits); reachable from the FAB. | merge → Brief (plan block) | – |
| A68 | Client-scoped catalogue page | live unused | Untouched since 20 May 2026; no link from the Brief. | cut | – |
| A69 | Overview plan labs card | live unknown | Edited 24 May 2026. | merge → Brief (plan block, 'next retest') | – |
| A70 | Client YAML integrity check | automatic | Listed in the cron schedule on 21 Nov; emails only on failure so silence is normal. | keep | – |
| A71 | Assessment authoring gate and context engines | automatic | Used by the author-assessment and author-plan chat skills that now produce nearly all assessments; no UI… | keep | – |
| A72 | Dead server actions in client and intake actions | dead | Zero importers found across src and scripts. | cut | – |
| A73 | FmIntakeActivityBanner | dead | No importer outside the barrel; last edited 20 May 2026. | cut | – |

### B. Plans, supplements and meals

| Id | Feature | Status | Evidence | Coach | Clients W/N/X/H |
|---|---|---|---|---|---|
| B1 | Client Plan page (two layouts) | live used | Published plan files modified 5 times in Nov, 7 non-menu amendments in Nov (supplement_protocol 4, lifestyle… | simplify | 0/1/0/0 |
| B2 | Plan studio shell and live phone preview | live unknown | No usage proxy exists for a preview iframe. Last git touch 2026-06-16. | simplify | – |
| B3 | Plan status strip, workflow banner and recheck panel | live unknown | Derived display with no write trail. Plan page last touched 2026-10-23. | merge → B1 | 0/1/0/0 |
| B4 | Plan editor (full 10-section editor) | live unused | 6 plans created in Aug, 0 in Sep, 2 in Oct, 0 in Nov, and the Oct restructure review found none of the… | move to chat | 1/1/0/0 |
| B5 | Plan AI assistant, AI read card and floating chat bubble | live unused | Zero API-spend log lines for plan-chat.py since logging began; the only chat-type script lines are 5… | cut | – |
| B6 | Plan lifecycle (draft, ready, published) and status history | live used | 20 published plans, every one carries status_history; 12 published and 17 ready_to_publish transitions… | keep | 7/0/0/0 |
| B7 | One-click Activate draft button | live unknown | Publishing via chat scripts leaves the same status_history trail, so the UI path cannot be told apart. | merge → B6 | 0/7/0/0 |
| B8 | Lifecycle panel extras: successor, template, version diff, render | live unused | No custom_templates folder exists in ~/fm-plans, so zero templates were ever saved. Letters are retired. Last… | cut | – |
| B9 | Follow-up plan generator (phase 2 draft) | live unused | Zero API log lines for generate-follow-up.py or generate-draft.py since logging began. Panel last touched… | move to chat | 0/1/0/0 |
| B10 | Plan check gate (catalogue, safety, dosing, clashes) | automatic | Called by publish and by the author-plan skill on every plan; checker.py is 1,300+ lines and pinned by tests. | keep | 1/0/0/0 |
| B11 | Client-fit gate (protocol tested against this client) | automatic | Shipped 2 Nov: only 1 of 20 published plans and 1 of 3 drafts carry rows yet. Gate is new, so low count is… | keep | 1/0/0/0 |
| B12 | Plan conflict panel (diet vs non-negotiables vs allergies) | live unknown | Server-rendered from loaded data, no write trail of its own. Last git touch 2026-07-13. | merge → B10 | – |
| B13 | Plan diff alert (draft vs published, plus Haiku semantic compare) | live unused | No API log lines for the semantic diff. Only 3 drafts exist. | cut | – |
| B14 | Plan dates: start dates, recheck date, 12-week clock | live used | All 20 published plans carry meal_plan_started_on and plan_period_recheck_date; 17 carry… | keep | 7/0/0/0 |
| B15 | Quick-edit supplements (published plan) | live used | 8 supplement_protocol amendments on record, 4 of them in Nov. Source: published plan amendments. | keep | 7/0/0/0 |
| B16 | Quick-edit practices, exercise sessions and practice addresses | live used | 135 practice rows across 20 plans, 7 carry exercise sessions, 1 a somatic practice; 5 lifestyle amendments… | simplify | 6/1/0/0 |
| B17 | Coach recommendations (off-catalogue tips with buy link) | live unused | coach_recommendations present on 1 of 20 published plans. Last git touch 2026-06-19. | merge → B15 | 0/6/1/0 |
| B18 | Attached protocols panel | live used | attached_protocols on 6 of 20 published plans; 18 protocol entries in the catalogue. Panel last touched… | simplify | 3/4/0/0 |
| B19 | Supplement order page /supplements/[token] | live used | letter tokens created: 3 in May, 5 Jun, 2 Jul, 2 Aug, 2 Oct (14 of 20 plans); page last touched 2026-11-02. | merge → client app supplements tab | 4/2/1/0 |
| B20 | Supplement buy-link manager and product resolver | live used | supplement_links.yaml modified 2026-11-21; 8 dated backups since July. | keep | 7/0/0/0 |
| B21 | Notify client of supplement change (banner plus WhatsApp) | live unknown | No sent-log reader available; pending-sends queue is empty today. Last git touch 2026-08-09. | automate | 5/0/2/0 |
| B22 | Plan-update email drafts queue | live unused | 11 drafts on file: 10 pending (oldest from Aug), 1 dismissed, none approved, _plan_change_emails folder is… | cut | 0/5/2/0 |
| B23 | Plan-publish follow-up sends (letter link, +6h supplement link, welcome email) | live unknown | Gated by an env flag; _pending_sends.yaml is empty; pending-sends cron runs every minute. Letters are retired. | cut | 0/0/3/4 |
| B24 | Drug and supplement interaction checks in the editor | live used | Safety engine is shared with B10 via supplement_clash.py and drug_match.py. Widgets have importers (overview… | merge → B10 | – |
| B25 | Menu studio: weekly menu editor with dish picker and swaps | live used | App_menu amendments by her: 6 Jun, 38 Jul, 29 Aug, 21 Sep, 18 Oct, 8 Nov (about 120 total). Panel last… | simplify | 7/0/0/0 |
| B26 | Weekly menus due queue (dashboard and mobile Meals tab) | live used | In the last 15 days the 07:00 drafter produced 5 drafts on 4 days; the approval digest reported 1 queued on… | keep | 7/0/0/0 |
| B27 | Weekly menu auto-draft (cron plus generator) | automatic | 111 generate-week-menu calls since Aug costing $2.84 (about $0.03 each), last 2026-11-20; cron ok 15 of 15… | keep | 7/0/0/0 |
| B28 | Menu auto-approve safety net | automatic | Fired 4 times (autoApproved 1) in 15 days of logs. | keep | 7/0/0/0 |
| B29 | Daily menu approval digest email | automatic | Sent on every logged day, queued 1 each of the last 3 days. | merge → B26 | – |
| B30 | Grocery list generation and grocery-backfill guard | automatic | 169 calls since Aug costing $4.94 (the largest line in this area), last 2026-11-21; backfill ran 15 of 15… | simplify | 7/0/0/0 |
| B31 | Recipe pack generation and AI-recipe flags | automatic | 347 calls since Aug costing $1.13, last 2026-11-21. Flags panel last touched Jun-Aug; promotions otherwise… | automate | 6/1/0/0 |
| B32 | Recipes page: image gap list | live unknown | 525 recipe entries; 24 recipe-catalogue commits since Aug. Photos are produced in chat via ChatGPT in Chrome,… | move to chat | 0/7/0/0 |
| B33 | Recipe inbox (forwarded recipe candidates) | live unused | 64 candidates: 60 modified in July, 1 in Aug, 2 Sep, 1 Oct; status 56 approved, 3 rejected, 5 new and… | move to chat | 0/3/0/0 |
| B34 | Pause weekly generation (roster panel and per-client toggle) | live used | 3 of 21 clients have the pause flag set. Last git touch 2026-10-23. | automate | 2/4/0/1 |
| B35 | Maintenance seasonal menu refresh | automatic | 15 of 15 days ok; scanned 0 and refreshed 0 every day (season: autumn). 3 maintenance plans on file. | keep | 0/7/0/0 |
| B36 | Monthly do's and don'ts card (cron, review panel, button) | automatic | Cron ok 15 of 15 days: scanned 4, live 0, held 0 each day. monthly_cards on 4 of 20 plans. Panel last touched… | automate | 4/3/0/0 |
| B37 | Deferred plan items (revisit-later gates) | live unused | 2 plans with 5 deferred items each (one client's successive plans); file last modified 2026-10-23; panel last… | move to chat | – |
| B38 | Manage remedies panel | live unused | app-overrides.yaml exists for 5 clients, none modified since 2026-07-05; 4 with hidden_remedies. Home… | merge → B15 | 0/6/1/0 |
| B39 | Food cautions and condition screening on the menu | automatic | Runs inside every menu draft (111 drafts since Aug) and the plan page load. | keep | 7/0/0/0 |
| B40 | Nutrient targets, macros and app-nutrients toggles | automatic | Engine runs inside menu generation. Toggles: app_nutrients set on 1 client, results_shared on 1 client. | automate | 3/1/1/2 |
| B41 | Food diary (coach side) | live unused | Only the test client ever produced diary files (now retired); 1 of 21 clients has a diary object with 0… | cut | 0/1/4/1 |
| B42 | Exercise suitability panel and exercise screening | live used | 7 exercise sessions across 20 plans; panel last touched 2026-08-05; gate_prescription is part of plan-check. | merge → B10 | 6/1/0/0 |
| B43 | Mind-body pacing control (breathing, EFT, wind-down) | live used | mind-body fields present on 10 of 21 client files; practice_log files exist for 12 clients but only 1 was… | simplify | 3/2/2/0 |
| B44 | Somatic read panel and mind maps | live unknown | No write trail. Mind map page last touched 2026-05-13, somatic panel 2026-08-23. Sidebar link Mind maps… | move to chat | – |
| B45 | EFT themes panel | live unknown | Last git touch 2026-06-18; no write trail found. | cut | – |
| B46 | Handout drip (scheduled education handouts) | live unused | 4 schedules on file, last written 2026-06-30, none since; no cron fires it in the runner list. | cut | 0/0/3/4 |
| B47 | Daily log panel (what the client ticked) | live used | 14 clients have a ticks file; 2 modified since 1 Nov. | merge → B1 | – |
| B48 | Plan layers checklist (Ayurveda, meal style, plan modules) | live used | ayurveda_enabled on 10 of 21 clients; Ayurveda section in 4 of 20 published plans, tissue salts in 4 of 20;… | simplify | 0/6/1/0 |
| B49 | Send education pack (email) | live unknown | No send log read. Mounted on the Plan page header; she does not chase and letters are retired. | cut | 0/0/7/0 |
| B50 | Recipe suggestions card in the editor | live unknown | Mounted only inside the plan editor (B4); last touched 2026-07-13. | cut | – |
| B51 | Dead plan-side server code | dead | Import scan across src: zero call sites for each (6 exported functions; plan-outcomes.ts has no importer at… | cut | – |
| B52 | Old letter and meal-plan renderer still wired in | live unknown | 8 meal-plan markdown files written since 15 Oct; 16 since 1 Aug across 20 client folders. | cut | 0/1/0/0 |

### C. Messages, lifecycle and money

| Id | Feature | Status | Evidence | Coach | Clients W/N/X/H |
|---|---|---|---|---|---|
| C1 | Client Communicate tab | live unknown | coach_inbox_state.yaml was written 20 Nov so client pages are opened; no per-tab signal exists. Page last… | simplify | 0/7/0/0 |
| C2 | WhatsApp conversation thread | live used | Changed 23 Oct. Inbound webhook active; WhatsApp inbox state written 4 Nov; the Oct-Nov decisions inbox still… | keep | 7/0/0/0 |
| C3 | WhatsApp message templates | live unknown | No per-send log for coach-picked templates; panel last changed 23 Oct. Appointment reminders and graduation… | simplify | 0/7/0/0 |
| C4 | Send booking link (Cal.com picker) | live unused | _calcom_send_log.yaml has 25 sends in total: 8 in May, 11 in Jun, 5 in Jul, 1 in Aug (4 Aug), none since.… | cut | 0/0/1/6 |
| C5 | Email compose panel | live unknown | No send log outside letters; the email send path is shared with renewal-send and the welcome email, both… | merge → C2 | 3/4/0/0 |
| C6 | Voice note sender | live unknown | No outbound audio log; the file was last changed before the Oct restructure. No session or file evidence of… | cut | 2/3/2/0 |
| C7 | Send app link / invite | live used | 21 of 21 client records carry an app_token; 17 of 21 opened the app in the last 14 days (Oct review). | automate | 7/0/0/0 |
| C8 | Welcome email (auto-send plus backfill card) | live used | Fires on every first publish; the send log persists welcome sent state. Backfill card no longer needed for… | automate | 3/4/0/0 |
| C9 | Plan start date banner (Day 1) | live used | Set per plan; the 12-week clock is fixed once set; dates read by every cron that drafts menus. No usage… | simplify | 7/0/0/0 |
| C10 | Discovery app card and call-kind recorder | live unknown | discovery_call_date is on 18 person records; no record carries a call-kind field name I could find, so the… | simplify | 2/3/0/2 |
| C11 | WhatsApp inbox /messages | live used | Page changed 18 Nov; the same messages are also a decision kind on the dashboard ('Messages waiting'). | merge → C19 | – |
| C12 | Unmatched WhatsApp numbers | live used | _whatsapp_unmatched.yaml written 19 Nov, about 34 entries since it began; strangers are writing to the brand… | merge → C19 | – |
| C13 | WhatsApp inbound webhook | automatic | Last changed 23 Oct. Cron log and unmatched file show it live on 19 Nov. Skips images, audio and documents… | simplify | 7/0/0/0 |
| C14 | Contact gate (who may be contacted, for what) | automatic | Wired into 8 send paths; unit tested; part of the Oct 2026 restructure. | keep | 6/1/0/0 |
| C15 | Lifecycle resolver (TypeScript plus Python mirror) | automatic | Stamped on client.yaml: about 4 active, 3 ending, 4 maintenance, 9 lapsed and about 9 prospect across both… | keep | 3/4/0/0 |
| C16 | Decisions inbox (dashboard) | live used | Rebuilt 23 Oct and edited 18 Nov; panels beneath it still receive writes (renewal decisions 15 Nov,… | simplify | 0/1/0/0 |
| C17 | Renewal queue panel and decisions | live used | 17 decisions recorded (9 not_renewing, 4 offer_sent, 4 renewed); file written 15 Nov; panel changed 23 Oct. | keep | 4/3/0/0 |
| C18 | Renewal letter pipeline (stage, approve, send) | live used | 3 letters on disk, all approved and sent; plus matching staged yaml files from 14 and 15 Nov. Cron scheduled… | keep | 6/1/0/0 |
| C19 | Renewal sweep (auto-lapse) | automatic | Scheduled daily; the pm2 cron log logs only on activity. 9 lapsed stamps present. | keep | 2/5/0/0 |
| C20 | Win-back drip | live unused | Only 1 client has a drip file (status pending). Cron scanned 13 and drafted 0 on 20 and 21 Nov because every… | cut | 0/1/0/6 |
| C21 | Call follow-ups for prospects | live used | 6 prospect follow-up files; 17 touches pending, 5 sent (all Oct 2026), 2 expired. Cron scanned 7 and drafted… | simplify | 2/3/2/0 |
| C22 | Interested people and 'thought of you' notes | live unknown | Interests recorded on 12 prospect records; I found no field showing a note sent. Panel changed 21 Oct;… | cut | 0/0/3/4 |
| C23 | Monthly cards review plus cron | automatic | Cron scheduled daily; 4 to 10 clients on maintenance; 1 maintenance order in Nov. Panel self-hides when… | automate | 4/3/0/0 |
| C24 | Programme feedback panel and ask button | live unused | _feedback_asks.yaml has 0 recorded asks (last written 20 Oct); 1 app-feedback session in Oct. Panel changed… | cut | 0/0/3/4 |
| C25 | Archive candidates panel | live unused | Last code change 21 Aug. 4 archived clients on disk. The prospects sweep now does the parking automatically. | automate | – |
| C26 | Prospects sweep (park never-signed-up people) | automatic | Ran 20 Nov 06:35 with applied true; 14 people parked in prospects/. | keep | – |
| C27 | Engagement picker, archive control and back-on-track (More page) | live unknown | engagement_status: signed_up on 12 clients; the Oct review found the resolver should be the only reader,… | simplify | 0/4/1/0 |
| C28 | Calendar month view | live unknown | Last changed 23 Aug. Only 5 bookings in the last 3 months (2 Sep, 2 Oct, 1 Aug); she has her own Google… | cut | – |
| C29 | Upcoming bookings panel | live used | Fed by _calcom_bookings.yaml, 14 rows May to Oct (2 in Oct). | keep | – |
| C30 | Cal.com webhook and booking-to-record intake | automatic | _calcom_unmatched.yaml last written 17 Nov, 10 entries dated Nov; _calcom_bookings.yaml last written 15 Oct.… | keep | 4/3/0/0 |
| C31 | Coach-side Cal.com booking modal | live unknown | No per-origin signal; the booking log shows 2 to 5 bookings a month in total. Dashboard comment still names… | cut | 0/7/0/0 |
| C32 | Appointment reminder cron | automatic | Scheduled daily; bookings fell to 2 in Oct. | keep | 7/0/0/0 |
| C33 | Graduation notice cron | automatic | Scanned 20 on 20 and 21 Nov, 0 due; earlier graduations (Aug) fell outside the 30-day backfill window. First… | keep | 5/2/0/0 |
| C34 | Intake reminders cron (auto-nudge) | live unknown | Scheduled daily; the toggle starts off for a new link; no send evidence in the 2-day cron log. | cut | 0/1/1/5 |
| C35 | Pending sends queue cron | automatic | Runs 60 times an hour with 0 active; queue is empty, last written 27 Oct; two .broken backups in the folder. | keep | 0/5/2/0 |
| C36 | Email replies reader | automatic | Ran 20 Nov 20:05 and 21 Nov 14:05, recorded 0; file touched 21 Nov. | keep | 7/0/0/0 |
| C37 | Plan-update drafts to send | live used | 11 drafts in the file, last written 21 Nov. | keep | 7/0/0/0 |
| C38 | Foundation 12k session (card, pay page, webhook) | live used | foundation_session found on 1 client and 3 prospect records. Card last changed 27 Sep. | keep | 6/1/0/0 |
| C39 | Founding-member gift card | live unknown | gift fields on 1 client and 3 prospects; card last changed 27 Sep; programme name is embargoed until 2 Jan… | keep | 0/7/0/0 |
| C40 | Lab order builder (recommend, advance, cancel) | live used | 12 orders created, Sep 5 and Oct 7 (file dates): 3 recommended, 6 cancelled, 2 paid, 1 booked; all 12 carry… | simplify | 6/1/0/0 |
| C41 | Lab payment (Razorpay): pay, rebook, webhook | live used | 2 orders have a razorpay_order_id; 3 are paid (2 through Razorpay, 1 recorded as manual); webhook changed 17… | keep | 6/1/0/0 |
| C42 | Lab requisition and booking sends | live unknown | No send log. Four distinct send actions across three screens. | merge → C40 | 6/1/0/0 |
| C43 | Receipts and invoices | live used | Counter is at 1; last written 5 Jul. Only 1 receipt has ever been issued although 3 lab orders were later… | simplify | 6/1/0/0 |
| C44 | Maintenance subscription (links, subscribe, pay) | live used | 7 payment records: 2 paid, 4 pending, 1 cancelled (Sep to Nov). maintenance_paid_through appears on 10 client… | keep | 4/3/0/0 |
| C45 | Body age report orders | live unknown | The order page returns 404 unless BODY_AGE_ORDER_PAGE is set to test or live; the body-age-orders folder has… | keep | 1/6/0/0 |
| C46 | Funnel handover and guided-enroll endpoints | automatic | triage-paid has a test; app tokens exist on 12 prospect records; programme-signup handover env was recorded… | keep | 5/1/0/0 |
| C47 | Revenue export to the funnel | automatic | Outbox holds 182 events (140 active_client_count, 42 client_sync); last written 19 Nov. | keep | 0/2/0/0 |
| C48 | Retired letter link redirect | automatic | Letters were retired 4 Jul; links already sent to clients may still be opened. | keep | 5/2/0/0 |
| C49 | Dead: WhatsApp requisition link actions | dead | Zero call sites in src/ outside their own file. | cut | – |
| C50 | Dead: Zoom recording module | dead | No importers; _zoom_events.yaml last written 2 Jun (74 KB). | cut | – |
| C51 | Dead: paid message parsers | dead | No callers anywhere in src/. The follow-up script is a paid Haiku path. | cut | – |
| C52 | Client page More-tab: contact and leftover widgets | live unknown | Parked in Oct as a removal candidate; the client-page subnav says the coach decides which widgets survive. | cut | 0/2/5/0 |

### D. Catalogue and knowledge

| Id | Feature | Status | Evidence | Coach | Clients W/N/X/H |
|---|---|---|---|---|---|
| D1 | Catalogue browser (tabs per kind) | live unknown | No HTTP logs. Page last changed 2026-10-23. Catalogue data is committed through chat about 8 times a month,… | simplify | – |
| D2 | Catalogue entry page (16 kind-specific layouts) | live unknown | Linked from the per-client catalogue page, resources, mind-map nodes and the client page (exercise… | simplify | – |
| D3 | Move / merge / delete entry panel (Reclassify) | live unused | Catalogue consolidation commits since September (grape seed 3 entries to 1, supplement audit, remedy fixes)… | move to chat | – |
| D4 | Catalogue chat box (natural-language reclassify) | live unused | Script last changed 2026-06-22. It does not appear in the API spend logs (the script never writes a spend… | cut | – |
| D5 | Coach notes on a catalogue entry | live unknown | 24 catalogue files carry a coach_notes field, so it has been used at some point. The write script was last… | move to chat | – |
| D6 | Catalogue cleanup (AI duplicate and misfile triage) | live unused | No link to the page anywhere in the UI (reachable by typed URL only). The plans in data/_cleanup are dated… | cut | – |
| D7 | Ingest: upload a PDF, Markdown file or URL | live unused | _audit.jsonl has 462 events: 11 ingest in May, 2 in June, 5 in July, none from 28 Jul. Zero ingest events in… | cut | – |
| D8 | Staging review: approve, reject, enrich, 'existing batches', approve-all | live unused | Last approve event 2026-07-27; the 'approve' totals were 258 in May, 158 in June, 27 in July, 0 since. Last… | cut | – |
| D9 | Coach Knowledge tab (stage a clinical observation) | live unused | Scripts last changed 2026-06-22 and 2026-08-22. No ingest events after July. No spend rows. | move to chat | – |
| D10 | Add Source form | live unused | source-save.py last changed 2026-05-08. Sources are still being added (593 files; Nov commits add sources)… | move to chat | – |
| D11 | Paste-ingest panel (paste Claude chat YAML) | live unused | Built in May for the Claude.ai-chat flow. Since then Claude Code writes files directly (Nov: IFM mast-cell,… | cut | – |
| D12 | Copy authoring prompt panel | live unused | Embedded schema prompt says v0.74; the catalogue is now at v0.91 and has more kinds. Last change before Sept. | cut | – |
| D13 | Mind-map list and radial viewer | live unknown | Map data last committed in Aug (3 commits); 12 in May. Linked from the liver-detox advisory card and the… | simplify | – |
| D14 | Mermaid mind-map renderer | live unused | render-mindmap.py last changed 2026-05-08. Duplicate of the radial view. | cut | – |
| D15 | Mind-map linking and mining tools (CLI) | live unused | Mine items live in the backlog only from May (all 1,442 items created in May, none open). The CLI code was… | cut | – |
| D16 | Catalogue queue (backlog) tab | live unused | _backlog.yaml has 1,442 items: 1,300 rejected, 142 added, 0 pending. Every item created in May 2026. File… | cut | – |
| D17 | Product links table (affiliate buy-links) | live used | supplement_links.yaml was written on 2026-11-21 (today); older snapshots on 5 Jul and 12 Jun show repeated… | keep | 6/1/0/0 |
| D18 | Resources library and detail | live used | 21 of the current plan files carry attached_resources. ~/fm-resources has 10 files, newest 26 Sep… | simplify | 4/3/0/0 |
| D19 | Resource generator (AI info pack) | live unused | Script last changed 2026-08-22. Nine of the ten resource files date from 10 Jun and nothing newer than 26… | move to chat | 0/5/0/0 |
| D20 | Search page and ⌘K | live unknown | No views logged. Page last changed 2026-07-13. It loads all clients including lapsed and archived ones. | simplify | – |
| D21 | Practice page: stat tiles and practice overview | live unknown | Last changed 2026-10-23. Linked from the dashboard and the sidebar. No views measurable. With about 10… | cut | – |
| D22 | MSQ cohort outcomes panel | live unknown | Only mounted on the Practice page, last changed 2026-10-23. No views logged. | simplify | 0/6/0/0 |
| D23 | Catalogue commit banner (commit data to git) | live unused | Action file last changed 2026-05-16. Every catalogue commit since then is made by Claude (about 25 in Sep to… | automate | – |
| D24 | Orphan chip (unreachable entries) | live unknown | Collapsed by default on Practice, action last changed 2026-08-23. Also reused by the ingest actions. | automate | – |
| D25 | Duplicate chip | automatic | The same check runs as `fmdb duplicates --check-new` in the pre-push hook and catalogue-ci.yml. Last changed… | automate | – |
| D26 | VitaOne coverage chip (commission leak check) | live unknown | Last changed 2026-07-07. Reads supplement_links.yaml (touched today). | automate | 1/6/0/0 |
| D27 | Help page | live unused | Last changed 2026-07-13. The steps describe the old path (Analyse, Discovery, Full assessment, welcome email,… | cut | – |
| D28 | Per-client catalogue page | live unknown | Linked only from the client brief page. Last changed 2026-10-23. Not measurable. | merge → client brief | – |
| D29 | Evidence tiers (strong, plausible, fm-thin, confirm-with-clinician) | automatic | Field is present on about 5,500 entries and read by every plan gate. Badge component is 25 lines. | keep | 1/0/0/0 |
| D30 | Validator, pending-refs and CI gate | automatic | Runs on every catalogue push through pre-push and catalogue-ci. It was used for every Sep to Nov chat commit. | keep | 1/0/0/0 |
| D31 | fmdb CLI: read-only list and show commands | live unused | cli.py is 2,982 lines. She does not use a terminal; chat reads YAML directly. | cut | – |
| D32 | fmdb CLI: ingest, review, approve, reject, audit | live unused | No audit-log events after 2026-07-27. Tests for entity wiring still pass. | cut | – |
| D33 | Streamlit UI (fmdb_ui) | dead | The folder is already gone from the main checkout. The review of Oct 2026 listed it for deletion and it was… | cut | – |
| D34 | One-off scripts in fm-database/scripts and the vitaone scraper | dead | Last commits: spring cleanups on 16-18 May; backfill 10 Jun; the tracers 4-7 Aug. Nothing since. The Oct… | cut | 0/7/0/0 |
| D35 | Staging folder and audit log data | dead | Newest staging batch 27 Jul; _audit.jsonl last written 27 Jul; _cleanup 13-14 May; _backlog.yaml 18 May. I… | cut | – |
| D36 | Catalogue AI spend not logged | live unused | Per-client and unattributed usage logs list 15 script names; none is a catalogue script. No log_api or usage… | cut | – |

### E. Dashboard, phone, settings and crons

| Id | Feature | Status | Evidence | Coach | Clients W/N/X/H |
|---|---|---|---|---|---|
| E1 | Dashboard home (decisions inbox) | live used | Rebuilt 23 Oct 2026; the menu digest email shows queued=1 ready=1 on 20 Nov, so the queue is being fed daily.… | simplify | 1/0/0/0 |
| E2 | Decision rules engine (12 kinds, age caps) | automatic | Called by dashboard and the 07:30 digest cron (every run). Parity-pinned with the Python lifecycle resolver. | keep | 1/0/0/0 |
| E3 | Book session button (header) | live unknown | _calcom_send_log.yaml last written 4 Aug 2026; _calcom_bookings.yaml last written 15 Oct 2026. Link-sending… | simplify | 1/0/4/2 |
| E4 | Roster line (lifecycle counts) | live unknown | Derived counts only; no write trail. | merge → E1 | – |
| E5 | Cancellation alert banner | live unknown | Fed by cal-com-webhook into _calcom_bookings.yaml (last write 15 Oct 2026). | merge → E6 | – |
| E6 | Upcoming bookings panel | live used | _calcom_bookings.yaml 12 KB, last write 15 Oct 2026. | keep | 0/1/0/0 |
| E7 | Inbound WhatsApp messages banner | live used | _whatsapp_inbox_state.yaml last write 4 Nov 2026; webhook writes sessions tagged whatsapp_webhook. | keep | – |
| E8 | Unmatched WhatsApp senders (banner + page) | live used | _whatsapp_unmatched.yaml last write 19 Nov 2026, 437 lines. | merge → E7 | – |
| E9 | Weekly menu approval queue | live used | Cron drafted 1 menu on 20 Nov; digest email reported 1 queued / 1 ready; generate-week-menu logged 18 calls… | keep | 7/0/0/0 |
| E10 | Monthly card review (held cards) | live unknown | 20 Nov cron: scanned 4, live [], held []. Nothing held recently. | keep | 2/4/0/0 |
| E11 | Deferred plan items ('Revisit later') | live unused | _deferred_items.yaml is 2 entries, last write 23 Oct 2026. | move to chat | – |
| E12 | Renewal queue + renewal letter send | live used | _renewal_decisions.yaml updated 15 Nov 2026, 17 decisions (9 not_renewing, 4 renewed, 4 offer_sent); 6… | keep | 6/1/0/0 |
| E13 | Plan-update email drafts panel | live unused | _plan_change_drafts.yaml: 11 drafts, 10 still pending (oldest 5 Aug 2026), 1 dismissed, none recorded sent.… | automate | 0/4/3/0 |
| E14 | Onboarding items list | live unknown | Computed on read; no write trail. | keep | – |
| E15 | Discovery / Foundation follow-up drafts (panel + cron) | live used | 6 people with state files: 5 touches sent, 17 pending, 2 expired. Cron ran 20 and 21 Nov (scanned 7, drafted… | merge → E16, E17 | 2/3/2/0 |
| E16 | Win-back drip (panel + cron) | live unused | 1 winback state file on disk; one touch ever, still pending. 20 and 21 Nov cron: scanned 13, drafted 0; notes… | cut | 0/2/0/5 |
| E17 | Interested people (interest notes + content library link) | live unknown | No interests file found on disk by name. Fed by cron content-status (ran 20 and 21 Nov); Dashboard and… | merge → E15 | 0/0/4/3 |
| E18 | Weight plateau / regression flags | live unknown | Computed from check-in data; no write trail. | simplify | – |
| E19 | Programme feedback panel ('How are we doing') | live used | 1 app-feedback session on disk (Oct 2026); notification wired 20 Oct 2026; _feedback_asks.yaml 12 asks last… | simplify | 2/5/0/0 |
| E20 | Feedback 'Ask on WhatsApp' button | dead | Dashboard passes asks: [] to the panel, so the button can never render. _feedback_asks.yaml untouched since… | cut | 0/0/2/5 |
| E21 | Stranded intake banner | live unknown | No write trail. Intake auto-finalise exists (intake_autofinalise.py) and intake-reconcile runs every minute. | automate | – |
| E22 | Food diary items (summary + photos to name) | live unused | No diary config or diary data found on disk (0 diaries). Spend log shows 1 read-diary-photos call ($0.004),… | simplify | 0/3/3/1 |
| E23 | Archive candidates panel | live unknown | prospects-sweep cron already parks such people automatically (ran 20 Nov, moved 0). | automate | – |
| E24 | Roster review + maintenance-blur chips | live unknown | Collapsed group; render nothing when clean. No write trail. | automate | – |
| E25 | /dashboard-v2/outcomes/[system] (MSQ drill-down) | live unused | Only linked from the /practice MSQ cohort panel. Last touched Jun 2026. | cut | – |
| E26 | Practice overview + MSQ cohort panels | live unused | Last touched 25 Jun and 2 Aug 2026; nothing writes from them. | cut | – |
| E27 | /practice page shell + stat tiles | live unknown | No write trail. Duplicates the dashboard roster line. | cut | – |
| E28 | Client app links panel (copy, WhatsApp, Send invite) | live used | Last touched 13 Jul 2026. 19 clients have an _app_opens.yaml; 5 have a push subscription. | simplify | 3/4/0/0 |
| E29 | Weekly recipe-pack pause roster | live unknown | Last touched 4 Aug 2026. Recipe spend in Nov: 84 calls, $0.145. | merge → client page settings | 0/5/0/1 |
| E30 | Catalogue guardrail chips + commit banner (admin group) | live unknown | Self-loading, silent when clean. Belongs to the catalogue area. | move to chat | – |
| E31 | Global floating action button (default 3) | live unknown | Review said the FAB's SOAP, handoff and genes items were removed; 3 left. | simplify | – |
| E32 | Per-client FAB (clientQuickActions) | live unknown | UI-written sessions fell to 1 in Oct 2026 (review); none of these have a recent write trail. | simplify | 0/0/4/2 |
| E33 | Sidebar nav + top bar + page shell | live used | Wraps every page. Nav includes Calendar, Mind maps, Catalogue queue, Ingest, Recipes, Resources, Help, Report… | simplify | – |
| E34 | /search (clients + catalogue) | live unknown | FAB and top bar target; no write trail. | keep | 0/1/0/0 |
| E35 | /messages inbox (WhatsApp, last 30 days) | live used | Updated 21 Nov 2026; fed by whatsapp-webhook (1,126 lines). | merge → E7 | – |
| E36 | /calendar and /help | live unused | Help is a Phase 1 stub. Calendar duplicates cal.com / Google Calendar. | cut | – |
| E37 | Dead banner: FmIntakeActivityBanner | dead | 0 importers. | cut | – |
| E38 | Settings page | live unknown | Read-only; edits happen in .env.local. Contains no token admin and no app-links panel any more. | simplify | – |
| E39 | API spend tracker + budget guard | automatic | Month-to-date: Nov about $0.92, Oct about $2.17 (grocery, week menu, recipes). Lifetime top: assess $19.22… | simplify | – |
| E40 | /m phone coach app shell, login, password | live unknown | _coach_mobile_auth.json written 2 Aug 2026 and never changed; 1 push device registered 3 Aug. Last code… | keep | – |
| E41 | /m Today screen | live unknown | Reads the projection (refreshed 21 Nov). Its lists are old-model signals (next_contact_date, gone quiet). | merge → E1 | – |
| E42 | /m Clients list + client card | live unknown | Reads coach-mobile projection (37 files, last refreshed 21 Nov). | keep | – |
| E43 | /m in-app chat with a client | live unused | Thread files: Aug 48 messages (24 each way), Sep 12 (6 each way), none after 17 Sep 2026. | simplify | 3/4/0/0 |
| E44 | /m Meals (meal-photo check queue) | live unused | 0 meal_outcome entries across all thread files. | cut | 0/2/3/1 |
| E45 | /m client app frame and diary view | live unused | No diary data on disk; no write trail for the frame. | cut | – |
| E46 | /m 'Ask about this client' AI chat (+ bridge) | live unused | No logged spend by client-quick-chat or chat.py since 2 Jun 2026. | move to chat | – |
| E47 | /m quick note | live unused | _outbox directory empty; last touched 2 Aug 2026. | move to chat | – |
| E48 | /m WhatsApp reply from business number | live unknown | No write trail attributable to /m. | keep | 7/0/0/0 |
| E49 | /m issue and send intake link | live unknown | No write trail. | simplify | 6/1/0/0 |
| E50 | Coach web push notifications | live used | 1 device registered (_coach_push.fly.json, 3 Aug 2026). Wired in chat-notify.ts, feedback-notify.ts,… | keep | – |
| E51 | Coach phone projection (read model) | automatic | 37 files in _coach-mobile; refreshed 21 Nov 2026 (write-if-changed). | keep | – |
| E52 | Cron runner (pm2 fm-coach-cron) | automatic | Running since 21 Nov 09:54; heartbeat shows pending-sends 60 runs/0 active, app-reminders 60/0,… | simplify | 0/5/0/0 |
| E53 | Cron renewal-sweep 06:30 daily | automatic | Daily; one of the 20 Nov runs logged. | keep | – |
| E54 | Cron prospects-sweep 06:35 daily | automatic | 20 Nov: applied, moved 0, restored 0, errors 0. | keep | – |
| E55 | Cron client-yaml-integrity 06:45 daily | automatic | Daily; quiet on clean days; last code change 7 Jul 2026. | keep | – |
| E56 | Cron maintenance-menu-seasonal 06:15 daily | automatic | Ran 20 Nov. AI: Claude Haiku 4.5 (Sonnet 4.6 fallback), counted within menu spend. | keep | 0/6/0/0 |
| E57 | Cron monthly-cards 06:20 daily | automatic | 20 Nov: scanned 4, live [], held []. Deterministic, no AI. | keep | 3/3/0/0 |
| E58 | Cron weekly-menu-drafts 07:00 daily | automatic | 20 Nov: drafted 1, scanned 1. Spend: generate-week-menu 18 calls $0.50 in Nov, 25 calls $0.61 in Oct. | keep | – |
| E59 | Cron menu-approval-digest 07:30 daily | automatic | 20 Nov: sent 1 to the coach, queued 1, ready 1, attention 0. | keep | – |
| E60 | Cron grocery-backfill 07:45 daily | automatic | 20 Nov: scanned 11, skipped 9 lapsed. Spend: Nov grocery 9 calls $0.28, recipes 84 calls $0.15; Oct grocery… | keep | 6/0/0/0 |
| E61 | Cron menu-auto-approve 08:00 daily | automatic | 20 Nov: scanned 0, autoApproved 0. | keep | 6/0/0/0 |
| E62 | Cron intake-reminders 08:30 daily | automatic | 20 Nov: scanned 20, 0 candidates, 0 sent. | cut | 0/1/1/5 |
| E63 | Cron appointment-reminders 09:00 daily | automatic | 20 Nov: 0 sent, 0 skipped. cal.com sends its own reminder emails. | keep | 7/0/0/0 |
| E64 | Cron renewal-send 09:30 daily | automatic | 20 Nov: due 0, sent 0. Idempotent; a failed send stays approved. | keep | 4/3/0/0 |
| E65 | Cron pending-sends every minute | automatic | _pending_sends.yaml is empty (3 bytes), last write 27 Oct 2026; hourly log shows 60 runs, 0 active. | simplify | 0/0/4/3 |
| E66 | Cron intake-reconcile every minute (Fly staging sync) | automatic | 62 successful runs logged in 8 days. 9 failures since 14 Nov (500 'intake-token-action produced no output' or… | keep | 7/0/0/0 |
| E67 | Cron graduation-notice 10:00 daily | automatic | 20 and 21 Nov: scanned 20, due 0, sent none (backfill window 30 days). | keep | 5/2/0/0 |
| E68 | Cron winback-drip 10:30 daily | automatic | 20 and 21 Nov: scanned 13, drafted 0. | cut | 0/3/0/3 |
| E69 | Cron content-status 10:35 daily | automatic | Ran 20 and 21 Nov (checked 12 then 13 items, 6 to 8 public videos); _content_status.yaml 10 KB. | cut | – |
| E70 | Cron discovery-followup 10:45 daily | automatic | 21 Nov: scanned 7, drafted 1. | keep | 0/3/2/0 |
| E71 | Cron email-replies hourly (:05) | automatic | 26 runs logged in the last week; recorded 0 in the runs sampled. | simplify | 2/0/0/0 |
| E72 | Cron app-reminders every minute | automatic | 8 pushes logged; 6 clients have a _reminders_fired file; 5 of 21 clients have a push subscription; 1 'fetch… | keep | 7/0/0/0 |
| E73 | Cron food-diary every 5 minutes | automatic | 12 runs/0 active per hour; 1 AI call in all of Oct to Nov ($0.004). | simplify | 0/1/1/1 |
| E74 | Cron infra-health every 5 minutes | automatic | _infra_health.json: alerts 16 Oct (Fly down) and 30 Oct (tunnel down); 0 consecutive failures now. | keep | – |
| E75 | Cron revenue-export 21:00 daily | automatic | _revenue_export_outbox.yaml 96 KB, last write 19 Nov 2026. | keep | 0/1/0/0 |
| E76 | Cron recipe-image-qc Sunday 05:30 | automatic | No Sunday result found in the log window sampled; the log only shows the runs since 21 Nov. | cut | 0/7/0/0 |
| E77 | Hourly heartbeat log | automatic | Hourly lines through 21 Nov. | keep | – |
| E78 | Emails and pushes that reach the coach | automatic | Digest sent 20 Nov; alerts 16 and 30 Oct; feedback wired 20 Oct. | merge → E59 | – |
| E79 | Client-facing push notifications | live used | 5 of 21 clients have a subscription. Every send goes through the contact gate. | keep | 6/1/0/0 |
| E80 | Inbound webhooks: WhatsApp, cal.com, funnel handover | live used | WhatsApp unmatched file 19 Nov; bookings 15 Oct; _calcom_unmatched.yaml present. | keep | 7/0/0/0 |
| E81 | Fly staging sync as the coach experiences it | automatic | 9 intake-reconcile failures in 8 days; no screen shows sync health. | simplify | 7/0/0/0 |
