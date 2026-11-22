# Body age report generator (v0.92, 19 Nov 2026)

A blood test plus a written report, sold on its own (standard and deeper). Everything a buyer sees calls it the
"body age report", never by the product's internal name. The BRAND name is printed in the PDF in three fixed places
only (the top line "A wellness report from Sequoya by Shivani Hari.", "Prepared by" in the details box, and the running
header): her wording of 19 Nov 2026, which also removed every "read by" / "reviewed by". That name is embargoed until
Sat 2 Jan 2027, 20:00 IST, so the command refuses to make any report except the test profile's before then. The
email, the file name and the PDF metadata carry no brand name (a test pins all of this). The design (two PDFs and the email) was approved by Shivani on
19 Nov 2026; this is the generator that reproduces it from a person's lab results. $0 per report: no API call anywhere.

## Run it

```bash
echo '{"client_id":"cl-900","kind":"deeper","name":"R."}' | python fm-database-web/scripts/body-age-report.py
```

Writes `<person>/files/body-age/<report no>/`: the PDF, `email.html` (images as `cid:ring` / `cid:mark`), `ring.png`,
`mark.png`, `email-preview.html` (open this to read the email) and `report.json`. Prints JSON: `ready`, `blockers`,
`drafts`, `soon`, the outcome and tags. `"record": true` also writes the result to client.yaml. Needs Chrome on the
machine (the Mac that runs the coach app); `FMDB_CHROME` overrides the path. Nothing is ever sent.

`ready: false` means do not send. Blockers: a result with no wording, draft sentences Shivani has not
approved, no personal Foundation link, a broken link in the PDF.

## Invariants

- **A buyer is not a client in care.** Stored like a prospect (no sign-up, no plan): `resolve_lifecycle` returns
  `prospect`. Fields on client.yaml: `body_age_reports` (one entry per report), `body_age_report_kind` +
  `body_age_report_date` (the Foundation credit), `segment` (`longevity_customer` when the report offered no session).
  Only the two credit fields are in `_APP_CLIENT_KEYS`; findings and tags never go to Fly.
- **Every cut-off is in `fmdb/report/cutoffs.yaml`.** No number in code. Shivani approved the first table on
  19 Nov 2026. The numbers are guideline lines written from memory and a doctor's read was recommended but is not
  recorded as done, so a correction is an edit to that file only. Set `status: provisional` while a change waits for
  her yes: the command then builds the test profile (cl-900) only and refuses everyone else. Eight lines were corrected after
  the five-reviewer check and approved by her the same day (listed at the top of the file, each marked "corrected").
  `inside_range_max_A` (potassium) stops a result inside the laboratory's printed range at A; Lp(a) is read on the
  `lpa` (mg/dL) or `lpa_nmol` row by the unit the laboratory used.
  Lead is read on `lead` (µg/dL) or `lead_ug_l` (µg/L, the same lines ×10) by the laboratory's unit; any other unit
  warns the coach (fixed 20 Nov after a real panel printed µg/L and got a false doctor sentence).
  `inside_range_none` (hdl): inside the laboratory's printed range is not flagged at all. `panel.unlisted_out_of_range`
  warns the coach about a measured result outside range that has no row. Two blocks are chosen by rule in `hits_in`, not by row:
  `ldl_only` (lipids at A with ApoB in range) and `iron_low_stores` (iron_low when ferritin is on the panel).
  Added and approved 20 Nov 2026 ("Yes, add all three"): `fallback_plus` (markers on the per-cent rule that also have
  listed lines, the worse of the two counts; a line with a `unit` applies only when the laboratory used that unit, else
  the coach gets a warning): PCV `hct`, `phosphorus`, `urea`, `bun`; `platelets` high D; and an `egfr` row from the
  laboratory's own figure, drawn against a fixed "60 or over" (`Spec.kind="min"`), doctor sentence below 60, nothing above.
- **Levels:** A just outside or middle zone (no doctor wording) · B clearly raised ("worth mentioning at your next
  routine check-up") · C far out ("needs a doctor's attention. Please speak to your doctor.", her wording of 19 Nov 2026,
  no "as well") · D strongest ("needs a doctor's attention soon. Please see your doctor in the next day or two.", approved 20 Nov 2026 with its page-1 step and next-step lines).
  **Nothing is called urgent and nothing is held back** (her rule, 19 Nov 2026: a buyer may panic): a D result prints
  like any other, the doctor is step 1 on page 1, no session is offered (`outcome: doctor_soon`), and the command's
  `soon` list and a warning tell the coach to send it today. Calculated scores, insulin and ApoA1 stop at A; the scarring score (FIB-4) is the exception.
- **Body age is scored at the age on the sample date**, in completed years (`lab_client_context(person, today=sample_date)`).
  A record without a date of birth or sex is refused.
- **The approved text is pinned word for word.** `tests/fixtures/body_age/approved_*.txt` is the standard and deeper
  report for the test profile as Shivani approved them, including her eleven changes after the five-reviewer check
  (19 Nov 2026: body age as a whole number, the opening line, the plain 14-day offer, "it may also take a few further
  tests", the client stories ending "One person's result. Results vary.", two safety lines). Any change to that text
  needs her yes and a new reference. What the reviewers flagged and what is still open (cut-offs, the urgent-call
  plan, legal items) is in the shared notes file `body-age-review-findings.md`.
- **Wording is never invented at build time.** Three kinds (`wording.py` header): APPROVED sentences from the two
  PDFs; DRAFTS (the finding blocks in `findings.py` not marked approved, and the phrases in `wording.DRAFT`); and
  MISSING (a far-out result with no block), which stops the report. Each draft a report uses is listed in `drafts`
  and keeps it `ready: false`. When Shivani approves one, add its key to `wording.APPROVED_DRAFTS`.
  Approved through `APPROVED_DRAFTS` and pinned word for word in `tests/fixtures/body_age/approved_findings.txt`
  (20 Nov 2026): every single phrase and every finding level. Nothing is left as a draft. To record a new approval add the key and run the
  test once with `FMDB_WRITE_APPROVED=1`.
  `python -m fmdb.report.library_doc` prints every draft as one document for her; it reads the library itself, so
  the document is exactly what a report would print. `tests/fixtures/body_age/approved_*.txt` is the approved text;
  the generator must reproduce it for the test profile apart from the listed differences (`ALLOWED` in the test).
- **One block per finding** (`findings.py`): a finding claims the results that mean one thing to a reader (the
  cholesterol family, both liver enzymes) and carries headline / today / why / what to do by level. A section's text
  is its main finding's block; another finding in the section gets a paragraph when it is clearly off. No block
  gives supplement or medicine advice, and the doctor and check-up sentences appear only at their levels (a test
  sweeps about 60 result combinations for both).
- **Every session is online** (her rule, 19 Nov 2026). Nothing a buyer reads may say "we meet", "see you", "in person",
  "in the room" or "sit down together"; the Foundation step reads "A Foundation session, online" and "In your session.
  It is online, by video call, wherever you are." A test fails on any of those phrases.
- **Next step** (`decide.py`): Foundation for any clearly raised or far-out result that is not inherited, three or more
  just-outside results, or body age more than 3 years older · work on it yourself for one or two just-outside results ·
  nothing for a steady report · an inherited doctor-only result alone (high Lp(a)) gets the doctor line and no offer.
  A page that offers no session quotes no price. No programme, plan length or programme price anywhere.
- **Drawings follow the data** (`viz.py`, deeper report only): organ tints from section status, jar levels from value
  and range, map nodes and links from the same connection rules that write "Reading it as one body". Each map node has a
  fixed place; an overlap fails the build.
- **Foundation credit** (`foundation-orders.ts::foundationPriceFor`): ₹7,000 after the standard report, ₹2,000 after the
  deeper one, up to and including day 14 after the report date (India time), then the full price. It does not add to the
  ₹999 short-call credit: the larger applies. `creditKind` tells each surface how to word it. The pay page is served
  from Fly, so the rule takes effect there only after a Fly deploy, and a buyer's record must be staged (the existing
  Foundation pay-link button does it) after the credit fields are written. The credit is per PERSON (her rule for
  couples, 19 Nov 2026: "Yes, flat 7,000"): it sits on each buyer's own record and never passes to a partner.
- Fonts (OFL) and the ring mark are in `fmdb/report/assets/` and inlined into the page, so a render needs no network.

## The page for two (21 Nov 2026) — built, not wired to the coach app

Her choice for two-person orders ("Joint report first"): the approved four-page "page for two" goes WITH each
person's own full report, all on one email. `fmdb/report/two.py::make_two(report_a, report_b)` takes two finished
single reports (same kind, same morning, same report date, different names) and makes the page;
`pdf.build_two_pdf` prints it with the single report's page furniture; `mail.two_email_html` is the one email draft.

```bash
echo '{"client_ids":["cl-900","cl-900"],"kind":"standard","names":["R.","M."],
       "invented":[null,{"values":{"HbA1c":5.8},"sex":"F","date_of_birth":"1976-03-02"}]}' | python fm-database-web/scripts/body-age-report.py
```

One folder (`<first person>/files/body-age/<report no>/`): both people's PDFs, the page for two, `email.html`,
`email-preview.html`, `ring-1.png` / `ring-2.png` / `mark.png`, `sources.txt` (where each sentence came from) and
`report.json` (`two: true`, `client_ids`, `attachments`, `ready`). Same JSON shape as one person, plus `reports`.

- **Three sources, and the code says which** (`two.Said`, `Two.sources`): `sample` = the approved sample's own words
  (`two.SAMPLE`; `tests/fixtures/body_age/approved_two_sample.txt` is the sample PDF as text and a test fails if a
  `SAMPLE` entry is not in it) · `own` = a sentence already approved in that person's own report, printed after
  their name in bold · `draft` = one of the four `two.*` keys in `wording.DRAFT`, which keep `ready` false until
  her own yes puts the key in `APPROVED_DRAFTS`.
- **The next step is each person's own `decide.py` outcome.** A session is offered by name ("A Foundation session
  for R., online"), at that person's own price and date, with that person's own pay link; the partner is only "welcome
  to join". A pair with no offer prints no price. Doctor wording is always the person's own approved sentence.
- **Three places the generator does NOT follow the sample, each because a later rule of hers overrides it:** body
  age is a whole number ("about 42", not "42.8"); the far-out line has no "as well" and no "See yours."; "Where you
  differ" is each person's own section headlines, because the sample's two paragraphs were written by hand.
- **The sample's second person cannot happen under the report's own rules**: anyone with a section on watch is
  retested at four months and gets "the steps are yours" or a session, so "yours could wait a year" never meets
  "the sugar pattern you share". The letter and the sugar paragraph print only for the sample's pattern (both
  younger, sugar the one section on watch for both, one person with a section needing attention); otherwise the
  letter is each person's own.
- **An order for two is one household** (her rule, 21 Nov 2026: "the 2 people have to be in the same household").
  One home visit, one address, one morning. So the sample's "You share a kitchen" and "in a kitchen you share" are
  true for every pair and stay as approved. The order page's wording should say so (`order-copy.ts`, still a draft).
- **Launch lock**: both ids go through the same lock as one (`locked()`), before anything is read or written.
  `invented` (made-up results so one test record can be two people) is for `cl-900` only and is never recorded.
- **Not done**: the coach app does not call it. The order list needs a "build for two" action that passes the
  order's two `client_ids`, the report card needs to show three PDFs, and `sendBodyAgeReport` needs to attach all
  three and send one email (to the buyer's address on the order; `decideSend` rules unchanged).

## Not built yet

The WhatsApp answers; the revenue
export for a report order; a refund step; an order whose buyer goes quiet for 15 days before the report exists is
not yet protected from parking (the guard starts at the report).

## Ordering and paying (21 Nov 2026) — built, OFF

Her decision (21 Nov 2026): a public order page anyone can open. `/order/body-age` on the public server.

- **Off by default.** `BODY_AGE_ORDER_PAGE` = `off` (default, everything 404s) · `test` (Razorpay TEST keys only,
  a live key is refused, orders marked `test: true`) · `live` (real orders; reads as `off` before Sat 2 Jan 2027,
  20:00 IST whatever the setting). `body-age-orders.ts::orderPageMode` / `orderRazorpayKeys`, pinned by tests.
- **Prices** are in `BODY_AGE_PRICE_INR` (4,999 / 9,999; for two 8,999 / 17,999) and are worked out on the server
  from the report and the number of people, never read from the form.
- **Order record**: `<plans root>/body-age-orders/<ba-YYYYMMDD-xxxxxxxx>.yaml` (people, home-visit address and
  preferred morning, amount, status, consent time and wording version). Status: pending → paid → booked →
  collected → results_in → report_sent (+ cancelled).
- **Paid** is set by `body-age-payment.ts::settleBodyAgePayment` through two verified doors, both safe to arrive
  twice: the signed Checkout receipt (`/api/body-age/order/<id>/confirm`, HMAC with the key secret) and the
  webhook (`/api/body-age/webhook`, acts only on `notes.kind = body_age_report`). The browser's word alone never
  marks anything paid.
- **Nothing is sent to the buyer.** A paid order emails the coach only (ops mailbox to `COACH_DIGEST_EMAIL`).
- **Every word a buyer reads** is in `app/order/body-age/order-copy.ts`: APPROVED by Shivani on 21 Nov 2026,
  word for word, with the consent line (`CONSENT_VERSION = approved-2026-11-21`); a changed sentence needs her yes again. A
  test fails on the brand name, the laboratory's name, "urgent", "free", the programme or its price.
- Public paths added: `/order/` and `/api/body-age/` (trailing slash on purpose: `/api/body-age-file/` stays
  coach-only; a test pins it).
- Buyers must be 18 or over (`MIN_AGE_YEARS`), from the legal review's list; hers to change.

## From a paid order to the report (21 Nov 2026)

- **Orders reach the Mac** through `app-staging-action.py::_mirror_body_age_orders` (in `_refresh`): a file is
  copied when the Mac lacks it, or when the Mac's copy is still `pending` and Fly's is settled. Once the Mac's copy
  is paid or further on it is never overwritten. Coach-side changes are not sent back to Fly (nothing there reads
  them yet; the WhatsApp answers will need that).
- **Records**: `body-age-order-intake.ts::placeBodyAgeOrder`, run when the coach opens the list. Each person is
  found by email or phone in clients/ and prospects/ (a parked person is moved back) or created as a prospect
  (`lead_source: body_age_report`), then given date of birth, sex, email, phone and the home-visit address without
  overwriting what was there. An unclear match (email and phone point at different records) creates NOTHING and
  shows the coach why; two people sharing contact details get a record each. `client_ids` on the order holds the
  result, one per person.
- **A TEST order never creates a record.** The coach attaches it to the test profile from the list.
- **Coach list**: `/report-orders` (menu: Report orders). Steps by hand: booked (date) → sample collected (date) →
  results on their record → report sent; cancel does not refund. The coach can never mark an order paid.
- **What to book** comes from `thyrocare.yaml#longevity_panels`: `body-age` (standard, cost 2,049) and
  `body-age-deeper` (profile 1 + urine routine, cost 5,094; her yes of 21 Nov 2026). Coach screen only.

## Coach screen (20 Nov 2026)

A "Body age report" card on a person's More tab (`clients-v2/[id]/body-age-report-card.tsx`) calls
`server-actions/body-age-report.ts::buildBodyAgeReport`, which runs the same script and adds no gate of its own
(the script refuses a real buyer before the launch). `lib/fmdb/body-age-report-view.ts` turns the script's JSON
into links; `/api/body-age-file/[id]/[report]/[name]` serves the PDF and the email preview, coach-only (not on
`PUBLIC_PATH_PREFIXES`, so 404 on Fly). "Save to their record" passes `record: true`.

## Sending (21 Nov 2026)

- **One door, the coach's click.** `server-actions/body-age-report.ts::sendBodyAgeReport` is the only code that emails
  a report, and only the card's "Send by email" button (with a confirm) calls it. No cron, webhook or build step does.
- **Who it may go to** is `lib/fmdb/body-age-send.ts::decideSend` (pure, pinned by tests): the test profile's report
  ALWAYS goes to the coach's own mailbox, never the address on the record; before the launch moment everyone else is
  refused; after it a buyer's report goes to the email on their record, and only once the report is saved there
  (`record: true`, which starts the 14-day price the report quotes). A report whose `report.json` does not say
  `ready: true` is never sent, so a report built before 21 Nov 2026 must be built again first.
- The email is `email.html` as built, `ring.png` / `mark.png` inline (`cid:ring`, `cid:mark`), the PDF attached,
  purpose `transactional` through the contact gate.
- **Sent state** is `<report folder>/sent.json` (a list: `sent_at`, `to`, `test`). The card reads it back
  (`latestBodyAgeReport`, passed from the page as `initial`) and shows "✓ Sent … · Send again". A rebuild keeps the
  report number, so the mark survives it.

## Extra results and the Urine section (20 Nov 2026)
Her rule: "we are asking them to do these tests so we should explain the report to them." Every result the two
packages print now has a row. Source of every word: `extra-results-wording-draft.md` (design session's notes, her
"All approved": D1 to D8, C1 to C41, F1 to F19). None of it enters the body age score or the drawings (D1).

- **Rows** (`panel.py`): `Spec.extra` marks them. Three kinds that are not ordinary rows:
  `noflag` = the laboratory's own ratios and indices, shown, never a level (D2); `note` = one white cell type or a
  finer red cell / platelet measure, never a level, one fixed paragraph and the section's status does not move
  (F9, F10; the coach is warned when one is far out); `quiet` = total IgE and every urine result, a level and a
  paragraph, the section goes to "watch" at most and never brings the session offer (D4, D6).
  `Spec.worked` rows read the laboratory's ratio lines, which every other row skips (`_WORKED_OUT`).
- **Compact tables** (`Spec.table`, `panel.TABLES`, `page.compact_tables`): long lists print as one table per
  heading, not a bar each (D8). A section with more than 12 results is allowed to run across pages.
- **New sections**: "Allergy and autoimmune markers" and "Pancreas" (deeper), "Urine" (both, last). "Metals" is
  now "Metals and trace elements". An older draw without those results simply has no such section, no warning.
- **Urine** (`panel.urine_section`): results are words. "Trace" = level A, "present" = level B, never further.
  A cell count is read against the laboratory's range on the per-cent rule, capped at B. Names that also exist in
  blood (protein, glucose, bilirubin, blood, red cells, pH, volume) are read only when the test name (or a
  `specimen` / `panel` field) says urine. NOT YET CHECKED against a real urine printout: the first order must be.
- **Levels**: the per-cent rule, plus `cap_at_B: [ige]` and the `rf` / `anti_ccp` / `ana` lines in `cutoffs.yaml`.
- **Session offer**: an extra just outside its range does not count towards "three small things" (`Group.extra`).
  Clearly off or far out, an extra counts like any other result, except the quiet ones.
- **Page 1** lists an extra only when clearly off or far out (D7): `wording.small_extras_only`.
- **Ferritin** keeps the three-level blocks approved earlier the same day; the design file's F1/F2 are one-level.
  Her pick between the two is open.
- The two approved samples changed by rows only (VLDL, total protein, globulin, neutrophils, eosinophils, UIBC)
  and are now 18 and 20 pages (were 16 and 19).

## Source check in place of a doctor's read (21 Nov 2026)
No doctor will put a name to the cut-offs, so every line in `cutoffs.yaml` was looked up in a published guideline and
marked beside the line: CONFIRMED, CAUTIOUS, STEP (between two guideline lines) or NOT FOUND (still from memory).
Four changes followed, at her word: low fasting glucose reaches the strongest level below 54 (was 50); the scarring
score's lower line is 2.0 from age 65 (`fib4_65`, `build_sections(age=)`); a high transferrin saturation is read
above 45 for women and above 50 for men; a low positive ANA is quiet like total IgE (`quiet_at_B`).

## What the coach-app rebuild must carry over (21 Nov 2026)

The coach app is being rebuilt (study: `docs/coach-app-rebuild/FEATURE-STUDY.md`, rows A6 and C45). These body age
surfaces were built the same week and must survive it. Where they sit may change only on the coach's say-so; what
they do, and the guards behind them, may not.

| Surface | Where today | Behind it |
|---|---|---|
| Body age report card: build, preview, **Send by email** | client Overview → "Contact & engagement" panel. `(v2)/clients-v2/[id]/body-age-report-card.tsx`, fed by `overview/page.tsx` | `server-actions/body-age-report.ts` (`buildBodyAgeReport`, `latestBodyAgeReport`, `sendBodyAgeReport`) → `scripts/body-age-report.py`; send rules in `lib/fmdb/body-age-send.ts::decideSend`; files served by `/api/body-age-file/[id]` (coach-only, NOT public) |
| Report orders list | left menu "Report orders" → `/report-orders` (`(v2)/report-orders/`, nav item in `components/fm/FmAppShell.tsx`) | `server-actions/body-age-orders.ts` (`loadBodyAgeOrderList`, `moveBodyAgeOrder`, `attachTestOrder`, `createRecordsForOrder`); `lib/fmdb/body-age-order-intake.ts`, `body-age-lab-items.ts`; orders arrive from Fly via `app-staging-action.py::_mirror_body_age_orders` |
| Public order page (buyer-facing, served from Fly, not a coach screen) | `/order/body-age` (`app/order/body-age/`, wording in `order-copy.ts`) | `/api/body-age/order`, `order/[id]`, `order/[id]/confirm`, `webhook`; `lib/fmdb/body-age-orders.ts`, `body-age-payment.ts`; public prefixes `/order/` and `/api/body-age/` in `middleware-policy.ts` |

Guards that must come across unchanged:
- **Embargo and test profile:** `decideSend` and `body-age-report.py` refuse everyone but `cl-900` until 2 Jan 2027 20:00 IST; `cl-900` only ever mails the coach.
- **Nothing sends by itself:** the report goes out on a confirmed click; a paid order emails the coach only.
- **Order page switch** `BODY_AGE_ORDER_PAGE` (off / test / live); `live` is still off before the embargo; test mode takes Razorpay test keys only.
- **A send needs** `ready: true`, the report saved on the record, and a valid record email; the send is logged in the report folder's `sent.json` and read back as "✓ Sent".
- **Prospects sweep** keeps a report buyer until `credit_until` (`fmdb/plan/prospects.py`).
- Tests that pin all this: `__tests__/body-age-send.test.ts`, `body-age-orders.test.ts`, `body-age-order-intake.test.ts`, `server-actions/body-age-report.test.ts`, `fm-database/tests/test_body_age_order_mirror.py`, `test_prospects_body_age_report.py`.

## The Rs 500 voucher from the body age check (21 Nov 2026) — built on the order side, OFF until the secret is set

Her rules: Rs 500 off either report for ONE person (not on the price for two), one per person, tied to the
email they signed up with, 14 days, never extended, no timers and no reminders.

- `lib/fmdb/body-age-voucher.ts`: `issueVoucher(email, todayYmd, secret)` → `BA-<last day YYMMDD>-<6 letters>`
  (HMAC of email + day); `checkVoucher` refuses a wrong email, two people, a past day, an edited date, or no secret.
  The check page lives on the marketing site, which shares no database with this app, so the code proves itself.
  **The marketing site must issue codes with exactly this function and the same `BODY_AGE_VOUCHER_SECRET`.**
- `api/body-age/order/route.ts` checks the code, refuses one a paid order already used, and charges the reduced
  amount; the order keeps `voucher_code` and `discount_inr` (`amount_inr` is what was charged).
- With no `BODY_AGE_VOUCHER_SECRET` every code is refused, so the voucher is off by default.
- The form shows the code box for one person only. Its two lines (`fields.voucher`, `voucherNote`) were approved
  by Shivani on 21 Nov 2026 ("yes approved") and are in the wording fingerprint.
- Not built: the check page on the marketing site (sign-up saved + code issued there).

## PIN code check before payment (22 Nov 2026) — built, waits for the list

Her rule (21 Nov 2026): the PIN code is checked at the time of booking, before payment.

- The laboratory's partner site publishes its list of serviceable PIN codes ("Pincode Serviceability → Download
  List", refreshed weekly). The app has no live link to the laboratory, so a COPY of that list lives at
  `fm-database/data/lab_providers/thyrocare_pincodes.txt` (one six-digit code per line, `#` notes; first line = the
  date it was read). **The file is not in the repo yet**: downloading it needs Shivani's yes.
- `lib/fmdb/body-age-pincode.ts`: `pincodeAnswer` → `yes` / `no` / `unknown`. No file or an empty file is `unknown`
  and the order goes ahead as before (visit confirmed by hand, full refund if the laboratory cannot come). An empty
  list never refuses everyone.
- The form asks `POST /api/body-age/pincode` as soon as six digits are typed, shows `COPY.pin.yes` / `COPY.pin.no`,
  and disables Pay on `no`. The order route asks again on the server and refuses a `no` before any order or payment
  is created.
- `COPY.pin.yes` / `COPY.pin.no` are NOT yet approved by Shivani (the wording fingerprint includes them).
- The list goes stale: re-read it from the partner site about once a month and before launch. A stale list can be
  wrong both ways, which is why `pin.no` sends the buyer to WhatsApp. After a deploy, check on Fly that the file is
  shipped (ask the pincode route for a code that is in the list; it must not answer `unknown`).
