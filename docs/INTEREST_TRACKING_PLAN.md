# Interest tracking + personalised follow-up: plan and work log

Agreed with the coach on 2026-10-21. Builds on the discovery follow-up drip
(`lib/fmdb/discovery-followup.ts`); it does not replace it.

## What we found before planning (verified against real data on 2026-10-21)

- **Live bug: the concern quoted in follow-up emails is sometimes not a
  concern.** The booking intake saves the *first* booking-form answer as the
  concern. On the cal.com form the first question is "How long has this been
  going on?", so three pending drafts read "what you shared about 1 to 3
  years" (cl-907 touch 2) and "what you shared about less than 6 months"
  (cl-909 touches 1 and 2). None of them has been sent.
- **Correction to the first discussion:** cal.com bookings DO carry their form
  answers. They come through the WhatsApp server forwarder
  (`cal-com-forwarder.js`, `extractCalcomFormFields`). Only the rarely used
  direct cal.com path drops them, and that path does not create prospects at
  all. Low priority.
- **The drip only scans `clients/`.** Parked prospects (`prospects/`) get no
  touches. The sweep is run by hand today, so this bites only after a sweep,
  but it does bite: a person parked at day 15 never gets the day-22/25 touch.
- **The approval queue is behind.** Several drafts have been pending for 1-3
  weeks (cl-904 has four, including "credit expires in 3 days"). More drafts
  will not help unless the queue is easy to clear. The design keeps new drafts
  rare and puts them in the panel she already uses.
- Messages to the coach number from unknown phones are mostly workshop
  logistics ("couldn't join", "thanks"), not health concerns. Sorting them
  automatically is worth little today, so it is not in this plan.
- Content: 12+ long videos have YouTube links, most are scheduled for future
  dates (they are NOT public yet). 9 guide pages are live on
  grow.theochretree.com.

## Rules that apply to everything below

- Drafts only. Nothing is sent without her approval (same as the drip).
- Email only (her call, 2026-09-25).
- A link can only come from the content library, and only once the item's
  `live_from` date has passed. The AI never invents a URL.
- Never "free call" in client copy; brand voice; no evidence-hedging.
- A person who declined, signed up, stopped, or asked not to be contacted
  gets nothing.

## Stages

| # | Stage | Output | Failable check |
|---|---|---|---|
| 1 | Fix the concern bug | `bookingConcern()` picks the "main concern" answer (then additional notes), never duration or yes/no answers. Used by booking intake AND the drip (which re-reads the booking note, so old records heal). The 3 bad pending drafts are re-rendered. | Unit tests on the real form shapes; dry-run over every real booking note shows no duration/yes-no concerns; grep of state files finds no "shared about 1 to 3 years". |
| 2 | Concern vocabulary | `lib/fmdb/concerns.ts`: 14 concern tags with client-facing labels and keyword rules; `classifyConcerns(text)`. | Tests, including every real booking concern on file. |
| 3 | Interests on the record | `client.yaml#interests`: list of `{concern, source, at, detail}`, append-only, deduped. Declared on the Python `Client`. Written by booking intake; backfilled for existing prospects from booking notes + discovery sessions; editable by the coach. | Python model test loads a record with interests; backfill dry-run printed and checked before `--apply`. |
| 4 | Content library | `fm-database/data/_content_library.yaml` (videos + guides, concern tags, `live_from`, one client-facing line each) + `lib/fmdb/content-library.ts` with `pickContent()`. | Tests: unreleased items never picked; already-sent items never repeated; every item has a URL and at least one known concern. |
| 5 | Drip sends something useful | Day-1 thank-you and day-12 check-in carry one matched item ("this might help"). Library items sent are recorded in the state file. The drip scans parked prospects too. | Tests on the rendered emails; the send gate refuses any URL not in the library; scan test over a parked prospect. |
| 6 | "Interested people" panel | Dashboard panel: everyone pending in the last 60 days (both buckets) with concern chips, source, last contact, drip status, the item that would go next; add/remove a concern. | Type-check + render against real data in the browser. |
| 7 | "Thought of you" track for cold prospects | When a new library item goes live that matches a quiet prospect's concern, draft one short note. At most one per 30 days per person; only after the call drip has finished; never to stopped/declined/opted-out people. Opt-out line in every such email + "Stop emails" button setting `marketing_opt_out`. Runs in the existing 10:45 follow-up cron. | Pure decision tests (cadence, opt-out, already-sent, not-yet-live). |
| 8 | Ship | lint 0 warnings, type-check, full tests (with FMDB_PYTHON), Python tests, build, merge to main, push, rebuild coach UI. | All gates green; panel visible on localhost:3002. |
| 9 | Later, separate session | ochre-funnel: branch its evergreen nurture by which guide/keyword brought the lead in, and carry the concern across at handover. | (planned, not built here) |

## Work log

- 2026-10-21: research + plan. Stage 1 starts.
- Stage 1 done: bookingConcern; 7/7 real booking notes now give the right
  concern; 3 bad pending drafts corrected (backups `.bak-concern-20261021`).
- Stages 2-3 done: 15 concerns; backfill tagged 11 prospects / 35 signals
  (backups `client.yaml.bak-interests-20261021`); only `interests` changed,
  all records still load in Python, re-run is a no-op.
- Stage 4 done: 21 library items (12 videos, 9 guides). Checked live: guides
  all 200; of the videos only protein (4 Oct) and belly (18 Oct) are public.
  oEmbed returns 200 for the HRT video too (unlisted) — `live_from` is the
  real gate, oEmbed only the backstop.
- Stage 5 done: content in day-1/day-12 touches; scan covers prospects/;
  mutation-checked (old scan fails the parked test). 3 waiting drafts got
  their matched item (backups `.bak-content-20261021`).
- Stage 7 done: notes + opt-out. save-session.py + thread readers resolve
  prospects/.
- Stage 6 done: panel verified in the browser on real data; add/remove chip
  verified writing to disk (cl-901 restored after).
- Real-data dry run of both scans (copy of fm-plans): 0 new drafts today —
  everyone still has a follow-up draft waiting. Many drafts have waited 1-3
  weeks; notes stay blocked until those are sent or skipped.
- Gate: lint 0, type-check, 2329 web tests, 167 Python tests.
