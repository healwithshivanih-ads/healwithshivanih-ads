# Body age report generator (v0.92, 19 Nov 2026)

A blood test plus a written report, sold on its own (standard and deeper). Everything a buyer sees calls it the
"body age report". The internal product name is embargoed until 2 Jan 2027 and must never appear in the PDF, the
email, a file name or PDF metadata (a test pins this). The design (two PDFs and the email) was approved by Shivani on
19 Nov 2026; this is the generator that reproduces it from a person's lab results. $0 per report: no API call anywhere.

## Run it

```bash
echo '{"client_id":"cl-900","kind":"deeper","name":"R."}' | python fm-database-web/scripts/body-age-report.py
```

Writes `<person>/files/body-age/<report no>/`: the PDF, `email.html` (images as `cid:ring` / `cid:mark`), `ring.png`,
`mark.png`, `email-preview.html` (open this to read the email) and `report.json`. Prints JSON: `ready`, `blockers`,
`drafts`, `urgent`, the outcome and tags. `"record": true` also writes the result to client.yaml. Needs Chrome on the
machine (the Mac that runs the coach app); `FMDB_CHROME` overrides the path. Nothing is ever sent.

`ready: false` means do not send. Blockers: a result with no wording, an urgent value, draft sentences Shivani has not
approved, no personal Foundation link, a broken link in the PDF.

## Invariants

- **A buyer is not a client in care.** Stored like a prospect (no sign-up, no plan): `resolve_lifecycle` returns
  `prospect`. Fields on client.yaml: `body_age_reports` (one entry per report), `body_age_report_kind` +
  `body_age_report_date` (the Foundation credit), `segment` (`longevity_customer` when the report offered no session).
  Only the two credit fields are in `_APP_CLIENT_KEYS`; findings and tags never go to Fly.
- **Every cut-off is in `fmdb/report/cutoffs.yaml`.** No number in code. Shivani approved the table on 19 Nov 2026
  (`status: approved`). The numbers are guideline lines written from memory and a doctor's read was recommended but is
  not recorded as done, so a correction is an edit to that file only. Set `status: provisional` while a change waits
  for her yes: the command then builds the test profile (cl-900) only and refuses everyone else.
- **Levels:** A just outside or middle zone (no doctor wording) · B clearly raised ("worth mentioning at your next
  routine check-up") · C far out ("needs a doctor's attention as well") · D urgent (never printed; the command reports
  it and blocks). Calculated scores, insulin and ApoA1 stop at A; the scarring score (FIB-4) is the exception.
- **Body age is scored at the age on the sample date**, in completed years (`lab_client_context(person, today=sample_date)`).
  A record without a date of birth or sex is refused.
- **Wording is never invented at build time.** Three kinds (`wording.py` header): APPROVED sentences from the two
  PDFs; DRAFTS (the finding blocks in `findings.py` not marked approved, and the phrases in `wording.DRAFT`); and
  MISSING (a far-out result with no block), which stops the report. Each draft a report uses is listed in `drafts`
  and keeps it `ready: false`. When Shivani approves one, add its key to `wording.APPROVED_DRAFTS`.
  `python -m fmdb.report.library_doc` prints every draft as one document for her; it reads the library itself, so
  the document is exactly what a report would print. `tests/fixtures/body_age/approved_*.txt` is the approved text;
  the generator must reproduce it for the test profile apart from the listed differences (`ALLOWED` in the test).
- **One block per finding** (`findings.py`): a finding claims the results that mean one thing to a reader (the
  cholesterol family, both liver enzymes) and carries headline / today / why / what to do by level. A section's text
  is its main finding's block; another finding in the section gets a paragraph when it is clearly off. No block
  gives supplement or medicine advice, and the doctor and check-up sentences appear only at their levels (a test
  sweeps about 60 result combinations for both).
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

Sending the email from the app (today the command hands over the draft files); a coach screen; Shivani's approval of the
draft wording (written, not yet approved); how a buyer pays for the report and books the draw; the two-person report.
