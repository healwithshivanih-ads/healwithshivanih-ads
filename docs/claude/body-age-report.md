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
- **Every cut-off is in `fmdb/report/cutoffs.yaml`.** No number in code. While the file says `status: provisional` the
  command builds the test profile (cl-900) only and refuses everyone else. Set `approved` only when Shivani has signed
  the table off (the design session's `result-level-cutoffs-proposal.md`), and change the one test line that pins it.
- **Levels:** A just outside or middle zone (no doctor wording) · B clearly raised ("worth mentioning at your next
  routine check-up") · C far out ("needs a doctor's attention as well") · D urgent (never printed; the command reports
  it and blocks). Calculated scores, insulin and ApoA1 stop at A; the scarring score (FIB-4) is the exception.
- **Body age is scored at the age on the sample date**, in completed years (`lab_client_context(person, today=sample_date)`).
  A record without a date of birth or sex is refused.
- **Wording is never invented at build time.** `wording.py` holds the approved sentences and DRAFT ones written for
  results the samples did not have; each draft used is listed in `drafts`, and a result with no wording at all goes to
  `missing` and stops the report. `tests/fixtures/body_age/approved_*.txt` is the approved text; the generator must
  reproduce it for the test profile apart from the listed differences (`ALLOWED` in the test).
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
  Foundation pay-link button does it) after the credit fields are written.
- Fonts (OFL) and the ring mark are in `fmdb/report/assets/` and inlined into the page, so a render needs no network.

## Not built yet

Sending the email from the app (today the command hands over the draft files); a coach screen; wording for findings the
approved samples did not have; how a buyer pays for the report and books the draw; the two-person report.
