# Exercise catalogue — reserved source IDs

**Read this before ingesting any movement/exercise book.** The exercise catalogue is
being built in one session and the books are being ingested in another. Both write
`SourceCitation` entries that must point at the *same* `Source` records, or the
catalogue ends up with `sims-next-level` and `next-level-sims` describing one book.

## Already on disk — do NOT re-create

These five are written, verified against the actual documents, and cited by exercise
entries. If a book repeats one of these findings, cite the existing ID; don't mint a
parallel record.

| Source ID | What it is | Verified against |
|---|---|---|
| `otago-exercise-programme-2003` | Campbell & Robertson, Otago Medical School / ACC NZ. The 17-exercise falls-prevention programme + walking plan, with A–D progression levels. | Manual read directly (pp 13–19 + Appendix 3) |
| `liftmor-watson-2018` | LIFTMOR RCT — HiRIT for postmenopausal women with low bone mass. | Abstract + publisher citation record |
| `liftmor-m-harding-2020` | LIFTMOR-M — the men's trial. | Publisher page (title, authors, vol/issue/pages) |
| `nice-ng206-me-cfs-2021` | NICE ME/CFS guideline. Withdrew graded exercise therapy; PEM as cardinal symptom. | NICE overview + recommendations pages |
| `cdc-steadi-falls-assessment` | CDC STEADI — 30-second chair stand, 4-stage balance test. | STEADI clinical-resources pages |
| `martinoli-5-minute-fitness-2011` | Zen Martinoli, *5 Minute Fitness* (Metro/John Blake, 2011). Equipment-free bodyweight progressions — the rungs ABOVE Otago. | Chapters 1-3 in full + most of the Ch 4 exercise index, from the PDF |

Each record's `notes` field states exactly how much was read. If the book chat reads
a primary document more thoroughly, **update the existing record's notes and
`evidence_tier` upward** rather than adding a new one.

## Reserved for the book chat — use these exact IDs

Fill the bibliographic fields from the physical copy. Do not guess edition, year or
publisher; leave a field null and say so in `notes` rather than assert it.

| Reserved ID | Book | Why it's wanted |
|---|---|---|
| `sims-next-level-2022` | Stacy Sims — *Next Level* | Perimenopause/menopause-specific training. Closest fit to a roster that is mostly women 40–55. |
| `nelson-strong-women-strong-bones` | Miriam Nelson — *Strong Women, Strong Bones* | The accessible companion to the LIFTMOR loading evidence. |
| `lehman-recovery-strategies` | Greg Lehman — *Recovery Strategies* (free PDF) | Pain-informed movement, for the 10 of 16 clients with tagged body pain. |

If a different book gets ingested instead, pick an ID in the same shape
(`<author-surname>-<short-title>[-<year>]`, lowercase, hyphens only — the `Source.id`
validator rejects anything else) and add a row here.

**Already done once:** `martinoli-5-minute-fitness-2011` was ingested this way and is
now in the "do NOT re-create" table above. It is not a substitute for any of the three
reserved books — it closes neither of the two gaps below. What it did close is the
*progression* gap: every strength, balance and cardiovascular chain inherited from Otago
dead-ended at beginner, and a client who outgrew chair sit-to-stand or a steady walk had
nowhere to go. Twelve entries were added, wiring `chair-sit-to-stand → bodyweight-squat`
and `walking-plan → walking-intervals`, plus the first upper-body work in the catalogue
(there was none at all). Read that source record's `notes` before adding to it — it lists
what was deliberately left out and which of the book's claims were rejected as uncited.

## What the exercise entries need from the book ingest

Exercise entries cite sources in `sources: [{id, location}]`. Once a book Source
exists, entries can be updated to cite it — an unresolved citation is a **warning**,
not an error, so nothing breaks if the ordering slips. Two specific gaps the books
are expected to close:

1. **Cycle-aware and menopause-stage load guidance.** Nothing currently on disk speaks
   to it; the exercise entries are stage-agnostic until Sims lands.
2. **Pain-contingent progression.** The Otago manual says only "work in a pain-free
   range". Lehman is expected to give the catalogue a defensible rule for progressing
   someone who has pain most days — which is 10 of 16 clients.

## Standing rules that apply to both sessions

- **Author in chat at $0.** Do not run `fmdb ingest` against the API for these.
- **Primary sources only** — no AI-generated book summaries.
- **Rewrite all cues.** The Otago participant booklet text is copyrighted; catalogue
  entries paraphrase and cite. Same applies to every book.
- **`exercises` is deliberately NOT wired into the ingest pipeline** (`ENTITY_TYPES`,
  `_MODEL_BY_ENTITY`, `_ENRICHERS`, the extractor tool schema). `test_ingest_entity_wiring.py`
  enforces those five structures agreeing, so adding exercises to one means adding it
  to all five. Since both sessions hand-author, that path is unused. Wire it only if
  API ingest of exercises is ever actually wanted.
