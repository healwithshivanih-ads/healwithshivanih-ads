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

## Not built yet

Sending the email from the app (the coach card and the command both hand over draft files); Shivani's approval of the
draft wording (written, not yet approved); how a buyer pays for the report and books the draw; the two-person report.

## Coach screen (20 Nov 2026)

A "Body age report" card on a person's More tab (`clients-v2/[id]/body-age-report-card.tsx`) calls
`server-actions/body-age-report.ts::buildBodyAgeReport`, which runs the same script and adds no gate of its own
(the script refuses a real buyer before the launch). `lib/fmdb/body-age-report-view.ts` turns the script's JSON
into links; `/api/body-age-file/[id]/[report]/[name]` serves the PDF and the email preview, coach-only (not on
`PUBLIC_PATH_PREFIXES`, so 404 on Fly). Nothing sends. "Save to their record" passes `record: true`.

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
