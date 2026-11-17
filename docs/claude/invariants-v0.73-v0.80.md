# Work log + key invariants, v0.73 → v0.80 (May–Aug 2026)

> Moved verbatim out of the root `CLAUDE.md` on 2026-11-17 (original lines 251–513). Index: [`/CLAUDE.md`](../../CLAUDE.md).
> Covers: Weekly menu append-only, condition ↔ food cautions (millet species split), mind-body module (somatic maps/practices, depth gates, practice log), nutrient engine + lab priorities, recipe inbox, medications as a three-axis entity + shared drug matcher, Fly.io intake deploy + Mutagen.
> Version notes describe the code when written; newer entries in `invariants-v0.81-v0.91.md` and git history override older ones.

**v0.80 (2026-08-22) — Weekly menu approval APPENDS; it never trims.** Nazneen
(cl-022) reported twice that "the other food options/recipes have dropped off"
after an approval. `approveWeekMenuAction` was deliberately keeping only two
weeks live (`slice(-2)`, later "approved + the one before") on the belief that
the app shows only two — but the app has a week picker, and the earlier weeks
ARE the client's food options and the source of her recipes. Every client on
the cadence was on the same two-week window. **Invariants now:**
- `weeksAfterApproval` (`src/lib/fmdb/menu-weeks.ts`) keeps every live week,
  replaces a same-numbered re-approval, and drops ONLY weeks carried from a
  predecessor plan — by the `source_plan` stamp approval now writes on each
  week, or (legacy, unstamped) by being numbered > approved+1, beyond what
  drafting can reach. **Do not reintroduce a cap.** `menu-weeks.test.ts` pins
  both the Nazneen case and the 2026-08-02 Nidhi carried-weeks case.
- With every week live, `client-app.ts` no longer rotates when the current
  week has no menu: `fallbackWeekFor` → latest loaded week ≤ current.
- Grocery is incremental (`grocery-weeks.ts`): lists are owed for the current
  week + live weeks ahead, keyed per week by `menu_key` (dish fingerprint,
  computed from RAW `app_menu.weeks` in both the action and the backfill
  cron); older weeks' lists are carried forward. A normal approval = ONE Haiku
  call. Coach 🛒 button passes `force`. `generate-grocery-list.py` accepts
  `keep_weeks` and merges. "Grocery weeks ≠ menu weeks" is normal now — the
  cron asks `groceryRefreshNeededAction` instead.
- Evicted weeks were restored from `.bak-*` copies for 7 clients
  (`.bak-restore-weeks-20260822` alongside each published plan).

---

**v0.79 (in flight, branch `claude/millet-health-warnings-b3ex7c`)** — Condition ↔ food cautions: the negative half of `good_for`.

**The gap:** every food surface in the catalogue was positive-only or coach-typed. `_recipes` carried `good_for` / `contains_allergens` / `aggravates_dosha`; `_ingredient_nutrients.yaml` carried nutrition with no safety axis; `client.foods_to_avoid` was hard-enforced but nothing told the coach what to type. `meal_foods.py::relevant_meal_foods()` could find foods that HELP a condition and **nothing could find foods that HARM one**. So ragi reached a hypothyroid client's weekly menu: week-drafter rule 11 actively rotates millets, `ragi-roti` is `good_for: [blood-sugar-regulation]` so it ranked well, and the three hard filters had no reason to stop it — while `claims/murray-goitrogens-cooked-vs-raw.yaml` (which names millet explicitly) sat there as prose that gated nothing.

**New reference asset `fm-database/data/_food_cautions.yaml`** — underscore-prefixed, so `fmdb validate` skips it; same footing as `_ingredient_nutrients.yaml` / `_food_guidelines/` / `swap_groups.yaml`. No Pydantic model, no loader change. 7 seed cautions (goitrogen-brassica-thyroid, goitrogen-pearl-millet-thyroid, goitrogen-millet-other-thyroid, soy-thyroid, phytate-iron-zinc, oxalate-calcium-stones, purine-uric-acid). Its header carries the design rules — read it before adding one.

**`severity` is NOT "how bad is this food" — `phytate-iron-zinc` is the entry that proves it.** Millets are themselves iron-rich (`ragi-roti` carries 4.1 mg/serving, tagged `rich_in: iron`), so down-ranking them for an iron-deficient client would push away part of the answer. It sits at `monitor` (−0.5, a nudge) and the whole intervention lives in `preparation_note`: overnight soak with the water discarded, fermented batters (idli/dosa/paddu/adai), vitamin C in the meal, iron/zinc supplements a couple of hours clear. Unlike the goitrogen entries this one covers **all** millets including foxtail — phytate is a family-wide property, goitrogen content is per-species.

**⚠ "MILLET IS GOITROGENIC" IS TOO COARSE — AND THE COMMON SHORTHAND HAS IT BACKWARDS.** The coach's presenting concern was ragi. The primary literature says ragi is the *mildest* of them and **bajra is the one that matters**, on two axes, so the original single millet caution was split three ways (2026-08-03):
- **Content varies ~10× by species.** Finger millet (ragi) 31–43 mg/kg combined thiocyanate + C-glycosyl flavones; pearl millet (bajra) **15–541 mg/kg**, hugely cultivar-dependent; foxtail and little millet negligible; sorghum (jowar) a different compound class (tannins/polyphenols). `millet-foxtail` is deliberately UNCAUTIONED — it is the easiest millet to rotate in, and flagging it would cost the client the substitute that solves the problem.
- **Bajra's mechanism is TPO inhibition, not thiocyanate.** Gaitan et al. (JCEM 1989) identified C-glycosylflavones (vitexin, glycosylvitexin, glycosylorientin) inhibiting thyroid peroxidase up to 85%; the thiocyanate hypothesis was tested and discarded as insufficient. That is **soy's** mechanism, not cabbage's — so cooking does NOT clear it, and bajra must never share the brassicas' `preparation_clears: cooked` bucket. Roasting degrades it more than a brief boil (`preparation_note`), but nothing inactivates it; frequency is the lever.
- **The human signal is staple-level intake, modified by iodine status.** Endemic goitre in western Sudan *despite* iodine sufficiency, pearl millet implicated as a staple. Deliberately NOT gated on iodine status in code — we don't capture iodised-salt use or urinary iodine at intake, so a gate would read an empty field. It's stated in `coach_note` instead.
- Measured after the split: `bajra-roti` −3.0 `moderate`, `ragi-roti` −0.5 `monitor`, `foxtail-millet-roti` clear. **Do not re-merge these** — the merged version warned hardest about the mildest millet.
- 3 new claims + 3 new sources back it (`pearl-millet-c-glycosylflavones-inhibit-tpo`, `millet-goitrogen-content-varies-by-species`, `pearl-millet-staple-intake-endemic-goitre`). All were captured from **abstracts and a 2026 review — full text was 403 through the container proxy**, which is recorded in each source's `notes` and each claim's `caveats`. Re-tier them if anyone reads the primary methods.
- **Independently corroborated.** The UAS Bengaluru millet-book ingest (PR #82) merged minutes before this one and landed `pearl-millet-goitrogens-heat-stable-unlike-brassica` — same mechanism (C-glycosylflavones, vitexin), same heat-stability conclusion, same frequency-not-ban framing, reached from a book rather than the primary literature. The bajra caution cites it, and `food-cautions.test.ts` fails if it disappears. Two independent routes agreeing is why that entry is not hedged further.
- **Still open from that ingest:** `kodo-millet-mycotoxin-contamination-risk` (kodua poisoning from damp-stored grain) is a real millet caution but on a **sourcing/storage** axis, not condition↔food — it does not fit this schema and needs a different home.

**Key invariants (v0.79):**
- **Foods are keyed by `_ingredient_nutrients.yaml` key.** That table's alias index resolves all ~729 ingredient spellings. A new spelling goes in as an alias THERE, never as a second matching surface here. Both engines go through it.
- **It DOWN-RANKS and SURFACES. It never hard-filters.** `recipe_select.py`'s contract is "HARD filters are SAFETY only: dietary preference, allergens, foods-to-avoid" and a goitrogen is not an allergen — ragi is genuinely good for the same client's blood sugar and calcium. Penalties (`avoid` −6.0 / `moderate` −3.0 / `monitor` −0.5) are calibrated against that file's own scale (dosha match +3.0, `good_for` ceiling +4.0). Only the coach writes `foods_to_avoid`; the one-way door stays hers.
- **`preparation_clears` means INACTIVATES, and is `cooked` or null — never a "helps a bit" value.** The distinction is the sources' own: Murray says cooking *inactivates* goitrogens but soaking only *decreases* oxalate. Only the first earns a demotion to `monitor`. An earlier draft merged them and a word-scan for "soak" hit the **paneer** soaking in `palak-paneer`, quietly downgrading a real spinach caution. Softer guidance goes in `preparation_note`, which changes no severity. Do not re-merge these.
- **A caution with no claim is an opinion.** Every active entry cites ≥1 claim slug that exists; `food-cautions.test.ts` fails otherwise. Real-but-unsourced knowledge gets `status: needs_review` — loads for the coach's queue, ignored by every gate.
- **Two stone types, two entries, on purpose.** `murray-stone-type-dictates-therapy`: oxalate stones want oxalate down, uric-acid stones want purines down and urine alkalinised. A single "kidney stones" caution would give half of stone formers the wrong advice.
- **Display names come from the KEY, not the shortest alias.** Aliases are matching fodder — the shortest alias for `chicken` is "leg", which rendered the purine caution as "lamb, fish, prawns, leg". `_KEY_QUALIFIERS` strips the table's bookkeeping suffixes (`millet-generic` → "millet").
- **Frequency is a week-level property.** A cooked ragi roti is fine; ragi as THE flour seven days a week is what the coach flagged, and every individual dish in that week looks innocent. `screen_menu()` counts across dish strings (`STAPLE_THRESHOLD = 5`); nothing per-dish can see it.
- **Drug-food timing is NOT duplicated here.** levothyroxine's "separate from calcium, soy and high-fibre meals by 4h" already lives in `drug_depletions/levothyroxine.yaml` and already reaches the coach via plan-check `drug_cautions`. `drugs:` cross-references it; the authoritative rule stays in the drug entry.

**Wired into four surfaces:** `scripts/food_cautions.py` (engine) → week + app menu drafters (new **rule 15**, phrased as preparation + frequency levers so it composes with rule 11's millet rotation instead of contradicting it) → `recipe_select.py` `score_recipe` down-rank + `pinned_safety_warnings` → `plan-conflicts.ts` **rule 6** (coach UI; suggests `append_client_note`, never a food removal, and drops to `info` once she has recorded it so it stops nagging). TS mirror `src/lib/fmdb/food-cautions.ts`; `food-cautions.test.ts` (24 tests) pins data integrity, the pure rules, and asserts the two engines agree on the same fixtures.

**Pre-existing bug fixed while here:** all 224 `home_remedies` carry a `contraindications` list and `meal_foods.py` read none of them — `golden-milk` lists "active gallbladder disease" and "oxalate-restricted diets" and was woven into menus regardless. Now gated via `remedy_contraindication_hits()`; measured, it drops golden-milk for a gallbladder client and only for them.

**Note on running the suite here:** `prospects-sweep` and `model-output-tolerance` (13 tests) fail in any environment without `pydantic` on the interpreter `FMDB_PYTHON` points at. Confirmed by installing it: all 79 files / 1176 tests then pass. Not a code problem — see the `FMDB_PYTHON` note above.

---

**v0.77–v0.78 (MERGED + DEPLOYED)** — Mind-body module: a somatic/emotional layer over the catalogue, ingested from T. Klein's *Your Body Remembers What You're Trying to Forget* (123 entries, 11 body systems).

✅ **MERGED AND LIVE (2026-07-29).** Merged to main at `562be5f4`; coach UI rebuilt on localhost pm2, client app deployed to Fly (`theochretree-coach`, machine `81107ef9461078`). Verified in production: the Today entry card and all six feeling chips render at `intake.theochretree.com/app/<token>`, and the mind-body reads are correctly ABSENT because `mind_body_depth` is unset for every client. Two conflicts were resolved by unioning alias lists — see the merge commit; `sleeplessness` on `insomnia` is load-bearing for a real client's read.

**Two new catalogue entities** (`fmdb/models.py`, wired through loader / validator / overlay / CLI / ingest pipeline):
- **`SomaticPractice`** — a reusable somatic reset with timed steps. One practice serves many symptoms, so it is its own entity. Stored `data/somatic_practices/<slug>.yaml`. **114 records.**
- **`SomaticMap`** — the emotional reading for ONE symptom **or** topic (the book's entries land across both, so it points via `target_kind` + `target_slug`, the same pattern `EducationModule` uses). Carries emotional roots, a client-facing reframe, one inquiry question, and a pointer to its practice. Stored `data/somatic_maps/<slug>.yaml`. **123 records — the whole book.**

**Safety model — the single failure mode is an ASSOCIATION being read as a CAUSE** ("my grief gave me fibroids"). Three validator rules guard it, each with a failing-if-broken test in `tests/test_somatic_safety.py`:
- `differential_note` is REQUIRED on every map (what a clinician must exclude first)
- a `timed` practice must have steps, else it cannot be rendered
- `coach_only_note` alongside `sensitivity: general` is a contradiction and **errors**

The staging enricher **fails closed**: an unclassified map defaults to `sensitive`, never `general`. Final spread across 123: **64 general / 47 sensitive / 12 coach-only, 34 hard-gated.** Recurrent miscarriage, infertility, hyperemesis, breech, endometriosis, fibroids and pelvic-floor dysfunction are all coach-only — the extractor gated every entry flagged as dangerous, unprompted.

**Two gating axes, both must permit:** the entry's `sensitivity` AND the client's own depth (`full` / `resets_only` / `coach_only`, suggested from health-anxiety and benzo/SSRI signals, coach-overridable). `coach_only_note` is an absolute bar regardless of either.

**`motion_shape`** — a typed enum (`fmdb/enums.py`) with **7 values**, DERIVED by clustering the whole corpus (`fmdb/assess/motion_shape.py`), never guessed per-entry. A four-shape guess from 13 entries was wrong at 87 and wrong again at 123. Distribution: breath_excursion 28 (the existing `BreathOverlay` already handles it), continuous_travel 23, sustained_pressure 20, release 18, still 11, load_release 10, checklist 4. `bilateral` and `reps` are MODIFIERS, not shapes.

**The app resolves practices BY SLUG, not by name.** `PracticeItem.somatic_practice` → `lib/fmdb/somatic.ts` `deriveSomatic` → `ochre-somatic.tsx`. The older derivations (`deriveEft`, `deriveBreathwork`, `deriveSleep`) pattern-match the practice NAME, which breaks at 114: gastrocolic-rhythm contains "breathing", so deriveBreathwork would catch it and render a generic 4-in/6-out session, dropping the hand pressure that IS the practice. `excludeSomaticLinked()` withholds slug-linked practices from the name-matchers — by each practice's carried `sourceIndex`, NOT by a slug lookup, because two practices may share a slug (constructive-rest morning and night) and a lookup returns the first one twice. `deriveSomatic` returns a LIST; it used to return one, which made a second linked practice prescribed, listed in the checklist, and unopenable.

**THE DIAGNOSTIC — read this before building on it.** Two routes, very different yields:
- **Chief-complaint read** (`fmdb/assess/somatic_read.py`) — what the book says about the conditions the client actually came in for. One map, no statistics. **11 of 14 signed-up clients get a read; 20 reads, 11 client-safe.** This is the one that works. Surfaced coach-side via `scripts/somatic-read.py` → `SomaticReadPanel` on the client overview.
- **Convergence** (`fmdb/assess/somatic_themes.py`) — "what do these symptoms share?", over 14 themes tagging 350/353 roots. **Fires for about 1 client in 3.** Verified against a null model: fear appears in 58% of all maps, anger 54%, holding-on 49%, so those can never show lift — 200 random 8-map draws put fear top 41% of the time. Scored as lift vs corpus baseline with `MIN_LIFT = 2.9` (the p95 of 400 random draws; 6% false positives). Of 3 real clients only Nazneen cleared it. **The most clinically obvious patterns are the ones this test is blindest to.**

**Coverage limit, by design:** the book maps symptoms and syndromes, NOT lab abnormalities. Geetika's 12 conditions (lipids, homocysteine, Lp(a)) yield zero reads and always will. The empty state says so rather than reading as a gap.

**Contraindication screening** (`fmdb/plan/contra_screen.py`) sorts a practice's cautions three ways against the client record: `live` (record positively shows it), `cleared` (field was ASKED and came back negative), `unknown` (no field would carry it). **`cleared` vs `unknown` is the whole point** — collapsing them once turned a standing glaucoma screen into a doubt about a client whose intake had already answered `eye_signs: []`.

**Fixed a pre-existing pipeline bug while here:** `drug_depletions` and `lab_tests` were declared in `ENTITY_TYPES` and requested in the extractor's tool schema, but absent from `ExtractionResult.by_type()` — so since v0.74 the model produced them, they were billed for, and staging discarded every one. `by_type()`/`is_empty()` now derive from `ENTITY_TYPES`; 9 tests in `tests/test_ingest_entity_wiring.py` fail if the structures drift again. Same class of bug fixed in `validator.overlay()`, which silently dropped `mindmaps` from approve pre-flight.

**Catalogue additions:** 31 new symptoms (the catalogue had **no musculoskeletal-region entries at all** — no back, shoulder, hip, sciatica, rib, cough — which was collapsing 17 entries onto 6 generic proxies). Also `lutein`, and `chaste-tree-berry` merged into `chasteberry` with `vitex` as an alias. Collisions now 0.

**Ingest was chat-authored, not API.** The first 87 entries went through `fmdb ingest` until the API hit its usage cap; the remaining 36 were authored directly in chat at $0 and scored BETTER (0 words of verbatim overlap vs up to 11, and it could reuse 5 existing practices the blind API batches duplicated). This is now a standing rule — see the memory note.

**Key invariants (v0.77):**
- `motion_shape` is assigned by the clustering pass over the whole corpus. The ingest enricher forces it to `None`; the extractor must never set it, and a test asserts that.
- `deriveSomatic` fails CLOSED — unresolvable slug, unassigned shape, or a timed practice with no steps all yield `null` rather than a degraded card. The slug reaches a filesystem path and is regex-guarded against traversal.
- Published plans are frozen. The everyday path for adding a practice is **Client → Plan tab → Quick edit practices**, which mutates the published YAML in place and appends a `status_history` line. `updatePlan` and `updatePlanForChat` both refuse published plans.
- `why_it_works` is COACH-facing ("transient lower esophageal sphincter relaxations"); the client card shows the plainer `summary`.
- The 32 inquiry questions that ran closest to the source were reworded — source overlap went from 32 questions at ≥8 verbatim words to **0**.

**v0.78 — the client-facing read + the Today collapse.** The book's reading now reaches the CLIENT, not just the coach.

- **Plan tab → "Understanding your body".** Per condition: the map's `reframe`, its `inquiry_question`, and the practice for that same condition with a Start button. The framing line ("invitations to notice — never an explanation for why something happened") is load-bearing, not decoration: the single failure mode of this whole layer is an association being read as a cause. Do not soften it into a claim.
- **Matched by CONDITION, never by practice.** `src/lib/fmdb/somatic-read.ts` mirrors `fmdb/assess/somatic_read.py` (the client app cannot shell out — `client-app.ts` reads the catalogue off disk). Pinned by `somatic-read.test.ts` against `__fixtures__/somatic-read-python.json`, captured from the real Python over the real catalogue; **regenerate that fixture by hand whenever the matcher legitimately changes.** The earlier by-practice lookup put "ROSACEA — WHAT YOU CANNOT HIDE" in front of a constipation client and has been deleted.
- **Do NOT "optimise" the index to only the slugs maps target.** Eleven targets (`hypertension`, `migraine`, `asthma`, `palpitations`, …) are ALSO aliases of another entity, so a reduced index resolves them to the wrong map. Full index = 42ms/process, memoised.
- **Three gates, all fail closed:** `Client.mind_body_depth` (`None`/off → nothing; `resets_only` → practices but no reading; `full` → both) AND the map being `general` + ungated AND a non-empty reframe. Coach sets depth from the Mind-body read panel (`setMindBodyDepth`, the only writer).
- **Today is one card, not four.** `MindBodyEntryCard` asks "How are you feeling right now?" and routes six first-person chips (two positive) to breathing / sleep / somatic / EFT. Routing is pure and tested in `mind-body-routing.ts`; every chip falls back rather than dead-ending, which is why the reply copy never names a technique.
- **The seven players are drawn additively** (`somatic-shapes.ts`, split out of `ochre-somatic.tsx`). Source-over turned warm translucent light into mud. Fixed while there: the overlay close button was an empty SVG (`x` was missing from the icon registry), the ground was near-black rather than ochre, the canvas ground wash left a visible square seam, and load_release's ripples flew off-canvas within a second of the snap that IS the practice.

- **Task steps vs rhythm steps.** `rest` steps (128 across the library — "drink warm water", "lie down") are self-paced: instruction + Done button, duration kept only as a silent auto-advance. The animation runs only where the client follows the screen. Long paced steps display m:ss.
- **The read is the full arc, as a reveal:** condition title → emotional roots ("what your body may be saying") → reframe → question → practice ("a doable way through"). Unprescribed practice → "ask Shivani" line. Section = "The mind-body connection" on the Plan tab.
- **⚠ THE STAGING ALLOWLIST TRAP.** The Fly client app reads `/data/fm-plans-staging`, populated by `scripts/app-staging-action.py` from an explicit `_APP_CLIENT_KEYS` allowlist — a new client.yaml field is INVISIBLE on Fly until added there. `mind_body_depth` hit this: the coach opened a client on the Mac and the live app silently stayed off. Any future client-app-read field must be allowlisted + `{"action":"refresh"}` run (needs `FMDB_STAGING_DIR`).
- Hariharan (cl-005) is opened at `mind_body_depth: full`; all other clients remain off.
- **Benched (coach decision):** connector recommending sessions (hypnotherapy, massage) from the reads — next stage, do not build yet. **Plan written: `docs/SESSION_CONNECTOR_PLAN.md`.** Key decision recorded there: join on THEME (14 fixed rows, `somatic_themes.py`) not condition (123 and growing), and keep the offer OUT of the read card — Shivani is the hypnotherapist, so reading→sale in one card is the exact shape this app avoids. The book is the first knowledgebase; more sources will deepen it.

- **Retiring a condition — `resolveCondition` / `reactivateCondition`** (`lib/server-actions/condition-status.ts`, chips on the client overview beside the mind-body panel). `active_conditions` had no notion of resolved/temporary, so a cleared fortnight of constipation outlived itself on a client's app while his BP went unmentioned. **No new field:** `medical_history` already means "past dx, in-remission, prior dx with current status", already feeds lab-vault relevance, and never renders as current or drives the read — so resolving is a MOVE between two existing lists and all 71 files that read `active_conditions` do the right thing unchanged. The stamp (`— resolved Jul 2026`) is generated, and `stripResolvedStamp` restores the coach's exact wording on reactivate; pure helpers live in `lib/fmdb/condition-status.ts` because `"use server"` files may only export async.
- **THE GATE IS THE COACH'S, NOT THE BOOK'S.** Read literally, the source withheld 55% of matched reads and every one was a named DIAGNOSIS (BP, thyroid, T2D, PCOS, autoimmune) — leaving clients only sleep/knees/digestion. That is the book being careful about being read as a diagnosis; this app says outright that it is **food for thought, not a diagnosis**. So `mind_body_depth` now has four levels: `off` · `resets_only` · `full` (general only, cautious) · **`deep` (general + sensitive — the chronic diagnoses)**. Do not re-narrow this to the book's own sensitivity flags.
- **`coach_only` never opens by depth, at any level — and that is not timidity.** Those twelve are a different kind of caution: alongside "don't imply they caused their thyroid disease" sit recurrent pregnancy loss, infertility, birth trauma, bereavement and pelvic-floor dysfunction (which "directly addresses sexual trauma"). They open ONE at a time, for ONE client, by map slug, via `Client.mind_body_shared` + the per-read **share anyway** toggle on `SomaticReadPanel`. Per-client so a decision for one person cannot leak to another; `mind_body_shared` is allowlisted in `app-staging-action.py`.
- **Alias matching takes BOTH joins.** `_phrases` emitted only slug-form (`underactive-thyroid`) while catalogue aliases are spaced (`underactive thyroid`), leaving **3,130 multi-word aliases unreachable** — a client's thyroid never matched a map that already carried his exact alias. Python + TS mirror both emit both; the fixture pin catches drift.
- Any client-safe read can START its practice, prescribed or not (`prescribed` drives the label, not access). Read-only runs get a `read-` prefixed practiceId so compliance records stay distinguishable.

- **Practice-load check** (`lib/fmdb/practice-load.ts`, `PracticeLoadNote` in the plan editor's Lifestyle section). Counting practices missed a 14-practice plan because every row looks the same size — "hibiscus tea" and "abhyanga, 20 min of self-massage" are one item each. It counts **dedicated stopped moments** instead: things needing a slot carved out of the day, versus things riding a meal / a cup of tea / getting into bed. ATTACHED is matched FIRST, so "10-minute walk after every meal" is cheap (the meal is what makes it so). Unmatched text defaults to attached — a warning that cries wolf gets ignored. Thresholds are **measured, not invented**: roster median is 7 practices / 2 dedicated, so at 9-10-11 totals the survey reads 13 comfortable, 1 full, 1 heavy (Hariharan, 14/7). Never blocks publishing, and always names the practices it counted so the coach can disagree at a glance.
- **Coach guidance on load:** ≤7 practices, ≤2-3 needing their own moment. The mind-body drip already encodes "one new thing at a time" but only governs EFT/sleep — extending unlock-over-time to the whole practice list is the unbuilt half.

- **⚠ THE DRIP WAS GATING ON AN EMPTY SENSOR — fixed, and this is the foundation for phasing.** `_practice_log.jsonl` is what the mind-body drip unlocks from, and it was structurally near-empty: the API **rejected `kind: "somatic"`** (the player POSTed it, got a 400, `.catch(() => {})` swallowed it — so every somatic session ever finished was dropped), and every player logged **only on full completion**, so a client who breathed for two minutes and closed the app recorded nothing. Result: 2 log files across the whole roster with 1 entry each, the auto-gate never fired for anyone, and Hariharan's EFT was visible only via a manual `mindbody_eft: unlocked`. Breath also reported its *planned* duration (`rounds × phase length`) rather than measured seconds — an adherence dataset that rounds everything up. All four players now log finished AND part-way sessions with MEASURED seconds and a `completed` flag, via `app/[token]/practice-log.ts`. `MIN_MEANINGFUL_SECONDS = 20` stops an instant open-and-close inflating adherence. **Do not build phasing/unlock logic until this log has real data in it** — thresholds picked before then are guesses.

**Pending (v0.78):** trigger-vs-symptom logging (the only route that helps the metabolic cohort, and what makes any read testable rather than asserted) · question drip · thread constellation on Progress · graduation keepsake · prospects-vs-clients separation (in flight) · the practice button still shows the catalogue's clinical `display_name` ("Gastrocolic Rhythm") to the client.

---

**v0.76** — Nutrient system deepened: table hardened, drafter balances, coverage mapped, client sees warm nourishment notes.

Four follow-ons to v0.75's nutrient engine, all shipped (main + pm2 + Fly):
- **Phase A — hardened the ingredient table.** A 25-agent skeptical workflow cross-checked all 200 ingredients in `_ingredient_nutrients.yaml` vs IFCT 2017 / USDA FDC. 6 corrections applied (ajwain fat/fibre, tendli potassium, methi iron, vanilla + cacao kcal); rest confirmed in tolerance. `_meta.verified` stamped; all 316 recipes recomputed.
- **Phase B — protein/fibre + lab-aware weekly drafting** (`scripts/generate-week-menu.py`). The drafter now receives the client's protein floor (weight×1.2 g/kg, **suppressed to ×0.8 + "keep moderate" when a uric-acid/kidney marker is flagged high** — project protein rule), a 25 g fibre floor, and their lab-flagged low nutrients (via `lab_nutrient_priorities.py`) with Indian-food hints. SYSTEM rule 10 balances the week without overriding framework / no-porridge / diet rules; the change_note stays warm and never names grams/nutrients/labs to the client.
- **Phase C — coverage gap analysis.** Cross-referenced the 323-recipe library's `rich_in` supply against client lab need. Key finding: the library is thinnest on exactly what clients most need — **vitamin-D (9 low / 10 veg dishes) and B12 (8 low / 16 veg dishes) are scarce**, monsoon has 4 recipes, 49 recipes untagged for season. Deliverable is a browsable coverage-report Artifact with a priority-ranked fill-list (no auto-generation — the coach sources via the inbox).
- **Phase D — client-facing nourishment note** (`src/lib/fmdb/nourishment.ts` + client-app.ts + `ochre-week-menu.tsx`). The Ochre Tree app shows ONE warm per-week line ("🌿 Lots of whole grains and vegetables this week — fibre for easy digestion, iron for steady energy…") derived from the week's dishes' `rich_in` tags. **Deliberately NOT a grams dashboard** — brand voice is warm/food-first and nutrient numbers invite the calorie anxiety FM coaching avoids; no grams, no floors, no lab data (labs stay coach-mediated).

**Key invariants (v0.76):**
- Lab-priority logic is triplicated on purpose — `lab_nutrient_priorities.py` (recipe_select shortlist + week drafter), `lab-nutrient-priorities.ts` (dish picker). Keep in lockstep.
- The client app (`/app/<token>`) serves from **Fly** (in the middleware-policy public allowlist) — Phase D + recipe-data changes need a Fly redeploy, not just pm2. Phase B (drafter) is Mac-cron only.
- Protein floor is SUPPRESSED for renal/urate-flagged clients — never push protein on them. `_protein_suppressed()` checks lab_markers for high uric-acid/creatinine/eGFR/BUN.
- Menu-balance protein/fibre are ESTIMATES (~55% dish coverage); the coach strip shows coverage %, the client note shows nothing numeric.

**v0.75** — Recipe inbox (WhatsApp/manual → review → library) + deterministic macro/micro nutrient engine.

**Phase 2 — nutrient engine:**
- New `fm-database/data/_ingredient_nutrients.yaml` — 202 canonical ingredients, per-100g kcal/protein/carbs/fat/fibre + 10 micros (iron, calcium, magnesium, zinc, potassium, folate, B12, vit D, vit C, omega-3), alias lists covering all 729 ingredient spellings in the recipe library, cup/piece/leaf densities. IFCT 2017 / USDA reference values (AI-assisted authoring — spot-check for clinical claims).
- New `fm-database-web/scripts/nutrients_lib.py` — deterministic engine ($0, no AI): normalises ingredient lines, parses qty/unit → grams (fractions, ranges, embedded amounts like "3 eggs", cooked-volume reinterpretation when a recipe measures >100g dry legume per serving, 20% factor for steeped-and-strained drink spices), writes `nutrients_per_serving` + `nutrient_coverage_pct` + `rich_in` badges (thresholds ≈15-20% daily need per serving; withheld under 70% coverage).
- `compute-recipe-nutrients.py` backfilled all 316 recipes with ingredients (100% ingredient-mass coverage, validator clean). 212 recipes carry ≥1 `rich_in` badge (fibre 94, magnesium 79, iron 70, vitamin-c 70, potassium 67, protein 66, folate 65, zinc 57, calcium 45, b12 28, vitamin-d 12, omega-3 6). **`kcal_per_serving` (basis ai_haiku) is NOT touched** — app weight-tracking keeps reading it; the table figure lives in `nutrients_per_serving.kcal` alongside.

**Phase 1 — recipe inbox:**
- Coach forwards reels/cookbook photos/recipe PDFs from her personal WhatsApp to the coach number → staged as candidates in `~/fm-plans/_recipe_inbox/` (Mutagen-synced, same mechanism as `_whatsapp_unmatched.yaml`). Trigger: sender in **`RECIPE_INBOX_NUMBERS`** (comma-separated, last-10-digit match — set as env on the Fly app where the webhook runs; documented in `.env.local.example`), OR an Instagram link from a non-client number. No AI call in the webhook.
- `/recipes` page (nav renamed "Recipe images" → "Recipes"): inbox review UI (✨ Parse → editable draft → ✅ Add to library / Reject) + "Add manually" card (paste caption / link / upload photo or PDF — auto-parses on save). Existing image workflow unchanged below it.
- `parse-recipe-candidate.py`: Haiku for text/images, Sonnet for PDFs; forced tool-use → library-schema draft; steps rewritten in own words (copyright); og:description fetch salvages captions from bare public IG links; friendly "paste the caption" error when nothing is parseable. Uses shared `build_client()` (FM_API_OK cost gate).
- `approve-recipe-candidate.py` gates before writing `fm-database/data/_recipes/<slug>.yaml`: duplicate name-token check (≥75% overlap → needs force), no-porridge rule (needs force), diet-consistency fixes (meat strips veg/vegan/jain claims, dairy strips vegan, roots strip jain), allergen derivation from ingredients (ghee ≠ dairy per library convention), enum validation, deterministic nutrients with `kcal_basis: ingredient_table_v1`. Server actions in `src/lib/server-actions/recipe-inbox.ts`.

**Phase 3 — the two nutrient-driven surfaces (built on the Phase 2 data):**
- **Menu-level balancing**: `src/lib/fmdb/menu-nutrients.ts` name-matches each pending weekly-menu dish to a library recipe's `nutrients_per_serving` (recipe wins; else a ~75-key Indian home-food fallback macro table with count/size multipliers). `weeklyMenuStatusAction` returns `pendingNutrition` (per-day protein/fibre/kcal + coverage). The app-preview review panel (`app-preview-panel.tsx` `MenuNutrientStrip`) shows weekly-average protein/fibre vs the client's **protein floor (weight × 1.2 g/kg)** + 25 g fibre floor, and flags days under the floor — coach fixes before approving, no auto-swaps.
- **Lab-aware ranking**: `scripts/lab_nutrient_priorities.py` maps off-range `client.lab_markers` (flag `low`/`suboptimal` → the nutrient; homocysteine-high → folate+B12; CRP/ESR-high → omega-3) to `rich_in` tags. Threaded into `recipe_select.py` `score_recipe` (letter/menu shortlist) AND mirrored in `lab-nutrient-priorities.ts` for `recipe-picker.ts` (dish picker up-ranks matching dishes + shows a `🩸 rich in …` badge). Nudge, never filter.

**Key invariants (v0.75):**
- `RECIPE_INBOX_NUMBERS` must be set on Fly (`flyctl secrets set ... -a theochretree-coach`) for the forwarding path; the manual add card works without it.
- Candidate ids match `^rc-[a-z0-9-]+$` and are path-validated in both TS and Python.
- Recipe-candidate YAML writes from TS use `dumpYaml` (PyYAML underscore-int guard); candidate media lives under `_recipe_inbox/media/`.
- The nutrient table's alias index is the single matching surface — when adding an ingredient spelling, add it as an alias in `_ingredient_nutrients.yaml`, don't fork matching logic.
- Lab-priority logic is duplicated on purpose (Python `lab_nutrient_priorities.py` for the engine + TS `lab-nutrient-priorities.ts` for the picker) — keep them in lockstep. Menu-balance protein/fibre are ESTIMATES (recipe-name match + fallback table, ~55% dish coverage); the strip shows the coverage % and never blocks approval.
- Phase 3 surfaces are coach-side only (localhost pm2) — no Fly redeploy needed; the Fly app never imports `menu-nutrients.ts` / `recipe_select.py`.

**v0.74** — Medications as a first-class three-axis entity + drug-driven plan/letter/intake guardrails.

The `DrugDepletion` catalogue entity (which already existed but only captured nutrient depletions) is extended into a **three-axis medication entity**:

1. **`condition_implications[]`** — what diagnosis the drug implies about the client. Fields: `label`, `confidence` (`high` → near-pathognomonic, `moderate` → "Suspected: …", `low` → ignored downstream), `rationale`, optional `topic_slug`.
2. **`protocol_cautions[]`** — what the FM protocol must respect. Fields: `kind` (`avoid_food | avoid_supplement | avoid_practice | prefer_food | prefer_supplement | timing | refer | monitor`), `item` (free-text), `severity` (`critical | warning | info`), `reason`.
3. **`depletes[]`** — existing nutrient-depletion list (unchanged).

**Schema lives in:** `fmdb/enums.py` (new enums `CautionKind`, `CautionSeverity`, `ImplicationConfidence`, plus new `DrugClass` values: `mast_cell_stabiliser`, `leukotriene_receptor_antagonist`, `anti_ige_biologic`, `h1_antihistamine`, `tyrosine_kinase_inhibitor`, `glp1_agonist`, `sglt2_inhibitor`, `dpp4_inhibitor`) + `fmdb/models.py` (sub-models `ConditionImplication`, `ProtocolCaution`; `DrugDepletion.condition_implications` and `.protocol_cautions` fields, both default-empty so existing entries don't break).

**Catalogue: 19 drug entries** (13 pre-existing backfilled + 6 new for MCAS / oncology cluster). New entries: `cromolyn-sodium`, `famotidine`, `montelukast`, `ketotifen`, `omalizumab`, `tyrosine-kinase-inhibitors` (class entry with 30+ aliases). Backfilled: metformin, PPI, levothyroxine, statins, OCPs, beta-blockers, ACE/ARBs, thiazides, SSRI/SNRI, broad-spectrum antibiotics, chronic aspirin, corticosteroids, methotrexate. `metformin.yaml` now also has aliases for the DPP4/SGLT2/sitagliptin combo brands (Janumet, Galvus Met, Jentadueto, Synjardy, Xigduo, Invokamet, Januvia, Galvus, Trajenta).

**The three integrations wired this turn:**

1. **Intake handler (`scripts/intake-token-action.py`)** — `_derive_conditions_from_intake` now consults the drug catalogue via `_build_drug_index()` (alias-aware, longest-match) before falling back to the original hardcoded keyword heuristics. Each matched drug's `condition_implications` flows into `active_conditions` with confidence-gated phrasing (`high` → bare label, `moderate` → "Suspected: …", `low` → ignored).

2. **Plan-check / plan editor (`src/lib/server-actions/plans.ts` + `src/components/plan-editor/plan-editor.tsx`)** — `checkSupplementInteractionsAction` now returns a `drug_cautions: DrugCaution[]` field in addition to the existing `interactions`. Plan editor renders these as a sibling collapsible banner above the supplement-interaction banner (rose for critical, amber for warning, slate for info), grouped by severity, with drug name + matched client medication + kind chip + item + reason. Critical cautions auto-expand the banner.

3. **AI synthesis (`fmdb/assess/suggester.py`)** — new `_collect_drug_context(client_ctx)` runs alongside subgraph build. The synthesiser's user payload now includes a `drug_context` field with `matched[]` (full drug → condition_implications + protocol_cautions + depletes for each matched med) and `unmatched_meds[]`. The system prompt gains a **3b. DRUG CONTEXT** section telling the AI to (a) anchor `likely_drivers` in the implied conditions, (b) treat `protocol_cautions` as hard constraints (`critical` = must honour, `warning` = honour unless override, `info` = best-practice tip), (c) always include the depletion-replacement supplement at the documented dose unless contraindicated, (d) add monitoring labs to `lab_followups`, (e) refuse to include any `avoid_supplement` item, (f) note `unmatched_meds` in `catalogue_additions_suggested` so the coach knows the gap.

4. **Letter generator (`scripts/render-client-letter.py`)** — new `_load_drug_cautions_for_client(client)` + `_format_drug_cautions_block(cautions)` helpers. The cautions block is woven into `_top_of_mind_block()` so EVERY letter type (meal_plan / supplement_plan / lifestyle_guide / exercise_plan / recipes / consolidated / meal_plan_phase) inherits it. The block is labelled "⚠ MEDICATION-DERIVED PROTOCOL CONSTRAINTS — HARD RULES." with explicit instructions: avoid_food items dropped from meal plans literally, prefer_food items emphasised, avoid_supplement items refused in the schedule, timing rules honoured, CRITICAL items override the protocol.

5. **Ingest pipeline** — `fmdb/ingest/extractor.py` system prompt gains **15. DRUG ENTRIES (DrugDepletion)** + **16. LAB TESTS (LabTest)** sections teaching future ingest runs to extract these as first-class entities when documents describe them. `_TOOL_INPUT_SCHEMA` gets both `drug_depletions` (full nested schema for `condition_implications`, `protocol_cautions`, `depletes`) and `lab_tests` (with conventional + FM-optimal ranges captured separately). `fmdb/ingest/types.py` (`ENTITY_TYPES`) + `fmdb/ingest/staging.py` (`_MODEL_BY_ENTITY`, `_ENRICHERS`, the entity-iteration loop, the empty-payload init) all include both new entities so AI output lands on disk via the normal stage → review → approve flow. New enrichers `_enrich_drug_depletion()` + `_enrich_lab_test()` default every list field to `[]` and add the standard lifecycle fields (source citation, version, status, updated_at, updated_by).

**Pipeline now accepts 7 entity types**: `sources, topics, mechanisms, symptoms, claims, supplements, drug_depletions, lab_tests` (sources auto-registered from the IngestRequest, the other 7 from the AI extractor). Tool schema mirror: `claims, drug_depletions, lab_tests, mechanisms, supplements, symptoms, topics`.

**Authoring prompt for human-coach-with-AI extractions** lives at `fm-database/data/drug_depletions/_AUTHORING_PROMPT.md`. Coach can paste it into Claude / GPT, replace the drug list at the bottom, and get YAML back ready to drop into `fm-database/data/drug_depletions/`. Includes hard rules, full schema with all three axes, allowed enum values, 4 anchor examples to match.

**Key invariants for future sessions:**
- `DrugDepletion` is **not** just about nutrient depletions any more. Name preserved for back-compat; semantically it's "medication catalogue entry".
- Class-level entries are preferred over per-brand entries — list every brand AND every Indian brand in `drug_aliases` (Indian coach context).
- **Alias-aware longest-match is CONSOLIDATED (2026-08-04).** It lives in `fm-database/fmdb/drug_match.py` and its TS mirror `fm-database-web/src/lib/fmdb/drug-match.ts`. Six callers go through it: `_collect_drug_context` (suggester), `_match_drug` (`intake-token-action.py`), `_load_drug_cautions_for_client` (`render-client-letter.py`), `matchDrug` in `plans.ts`, and both medication-impact panels in `clients.ts`. Do NOT hand-roll a seventh copy — the duplicated versions had already drifted (the letter renderer had a boundary guard nobody else did, and its boundary treated `-` as a word char so `Pan-40` silently stopped resolving).
  - **Aliases below 5 chars require a LETTER boundary; 5+ stay plain substring.** A bare `alias in text` let `pan` (Pan-40) match "recheck thyroid panel" / "Panadol", `arb` match "carbamazepine", `razo` match "alp**razo**lam", `asa` match "nasal spray". A false PPI match implies GERD, pulls in B12/magnesium depletion advice, and rewrites protocol cautions — which the letter renderer binds as HARD RULES. Longest-alias-wins masked it whenever a real drug name also matched, so it only bit on short or free-text entries; the two `clients.ts` panels take the FIRST match and had no masking at all. Measured on the live roster: 2 of 39 medication strings were wrongly flagged PPI, 0 true matches lost.
  - The boundary is letters, **not `\b`** — digits and punctuation must be allowed to terminate an alias or `Pan-40` / `Pan40` stop matching the entry they name. `drug-match.test.ts` pins both halves (false positives dead, true positives alive) and asserts the TS and Python matchers agree on the same fixtures.
- `condition_implications.confidence: low` is **ignored downstream** by intent — too non-specific to auto-populate `active_conditions`. Only `high` and `moderate` (the latter prefixed "Suspected: …") flow through.
- `protocol_cautions.severity: critical` is a HARD BLOCK in the meal-plan / supplement-plan letter prompts. The AI is told the critical caution wins even over the attached protocol.

**v0.73** — First production deploy: intake form on Fly.io at `intake.theochretree.com`, coach UI stays on Mac.

Architectural split: the **public-facing intake form** runs on Fly (Mumbai, single 1 GB machine, 3 GB persistent volume). The **coach UI** (`/clients-v2`, `/plans`, `/assess`, `/dashboard-v2`, `/catalogue`, etc.) stays on the Mac mini + laptop exactly as before — no auth changes, no migration. Client PHI stays in `~/fm-plans/` on the Macs; Fly has a writable replica at `/data/fm-plans/` synced bidirectionally via Mutagen.

**The deploy is a hard split, not "two halves of the same app":**
- Fly machine returns **404** on every coach-UI route (`/clients-v2`, `/plans`, etc.), regardless of auth state. The route doesn't exist as far as the public is concerned. Enforced by `FLY_INTAKE_ONLY=1` env in `fly.toml` + `middleware.ts` check.
- Coach UI on `localhost:3002` (Mac mini/laptop, PM2-managed) is unchanged — no middleware activates because the env var is unset locally.
- Public hostname `intake.theochretree.com` resolves only to the Fly machine. There is no `shivani.theochretree.com` (originally planned but dropped — coach uses localhost).

**Files added (all at repo root unless noted):**
- `Dockerfile` — 4-stage build. Stage `web-build` (Node 22 + Next.js build, `npm ci --include=dev` for Tailwind v4 postcss plugin); stage `python-build` (Python 3.12 + venv + Anthropic SDK + pyyaml + python-dotenv + html2text); stage `mutagen-agent-fetch` (downloads linux_amd64 Mutagen agent from GitHub release v0.18.1); stage `runtime` (Node + Python + venv + Next build + Mutagen agent baked at both `WORKDIR/.mutagen/agents/0.18.1/...` AND `/root/.mutagen/agents/0.18.1/...`). Final image ~388 MB.
- `.dockerignore` — excludes `.git`, all `node_modules`, `.venv`, `__pycache__`, secrets (`.env*`, `google_service_account.json`), client PHI (`fm-plans`, `fm-resources`), worktrees, screenshots.
- `fly.toml` — app `theochretree-coach`, region `bom`, mount `fmcoach_data` at `/data`, internal_port 3002, health check on `/api/health`, `auto_stop_machines = "off"` (clients submit async, no cold starts), `FLY_INTAKE_ONLY=1` in `[env]`.
- `fm-database-web/src/middleware.ts` — three operating modes: INTAKE-ONLY (return 404 for any non-public path), COACH UI WITH AUTH (HTTP Basic Auth, unused by current deploy), LOCAL DEV (no-op when neither env var set). Public path allowlist: `/intake/*`, `/start/*`, `/api/whatsapp-webhook`, `/api/whatsapp-poll-webhook`, `/api/health`, `/_next/*`, `/favicon.ico`. Uses Edge-runtime-safe `atob()` for base64 decode. Note: `/api/aisensy-webhook` was removed at v0.74 (AiSensy decommissioned).
- `fm-database-web/src/app/api/health/route.ts` — returns `{ok, service, ts}` for Fly LB.
- `DEPLOY_FLY.md` — 11-step runbook (Fly app create → volume create → secrets set → first deploy → Mutagen setup → custom domain → DNS at Wix → cert verify → smoke test → Nidhi link → cleanup). ~2-3 hr end-to-end.
- `MUTAGEN_SYNC.md` — bidirectional sync runbook + 3 empirical gotchas (iCloud-symlink path resolution, agent placement at WORKDIR not HOME, slim image missing scp/tar) + ongoing-ops section (SSH cert 72h refresh cron, LaunchAgent SSH_AUTH_SOCK survivability, MacBook bridge-vs-direct decision).

**Production reality (deployed 2026-05-14):**
- Fly app `theochretree-coach` in `bom`, machine `81107ef9461078`, IPv4 `66.241.125.67`, IPv6 `2a09:8280:1::115:bbff:0`.
- Volume `fmcoach_data` (3 GB, daily snapshots enabled).
- Custom domain `intake.theochretree.com` (CNAME at Wix DNS → `qj0gpyy.theochretree-coach.fly.dev`), Let's Encrypt cert (RSA + ECDSA), ~60 day renewal cycle.
- Secrets: ANTHROPIC_API_KEY, GMAIL_USER, GMAIL_APP_PASSWORD. COACH_AUTH_* skipped (FLY_INTAKE_ONLY makes them unused). AISENSY_API_KEY + AISENSY_WEBHOOK_SECRET removed at v0.74 (AiSensy decommissioned). WhatsApp now via self-hosted server: WHATSAPP_SERVER_URL + WHATSAPP_SERVER_API_KEY in `.env.local` (not Fly secrets — coach-side only).
- Mutagen 0.18.1 daemon on Mac mini, sync session `fm-plans` between `/Users/shivani/Library/Mobile Documents/com~apple~CloudDocs/fm-plans/` (resolved iCloud path, NOT the `~/fm-plans` symlink) and `root@theochretree-coach.internal:/data/fm-plans/` over WireGuard tunnel. Mode `two-way-safe`. Initial scan: 31 dirs / 139 files / 160 MB. Status: `Watching for changes`.
- All 6 existing clients (cl-004 through cl-008, plus nidhi-jain) visible at `/data/fm-plans/clients/` on Fly volume after Mutagen converged.

**Smoke-test results (post-deploy):**
| Surface | Expected | Got |
|---|---|---|
| `GET /api/health` | `200 {"ok":true,...}` | ✅ 200, 57ms |
| `GET /intake/<Nidhi's token>` (real) | 200 | ✅ 200, 62ms |
| `GET /clients-v2` on public host | 404 | ✅ 404 |
| `GET /plans`, `/catalogue`, `/dashboard-v2`, `/assess` | 404 each | ✅ 404 each |
| `POST /api/whatsapp-webhook` (no HMAC) | 401 | ✅ (route exists, AiSensy route removed) |
| Cert | Issued by Let's Encrypt | ✅ RSA + ECDSA |

**Workflow now operational for real clients**:
- Coach generates intake token on Mac (writes to `client.yaml#intake_token`). Mutagen propagates to Fly volume in <2s.
- Coach WhatsApps client the link `https://intake.theochretree.com/intake/<token>` (via existing one-click WA share button — updated message text: dropped "from Shivani's office", signed "Shivani").
- Client opens link on phone, fills form, autosaves every 5s. Each save writes `client.yaml#intake_form_draft` on Fly. Mutagen propagates back to Mac in ~1s — coach can watch fields populate live on localhost UI.
- Client hits Submit. ~60 structured fields land + tagged `[source: client_intake_form]` quick_note session. Token revoked.
- Coach opens `/clients-v2/<id>` on Mac (localhost) → IntakeInsightsCard offers "✨ Generate insights" → ~$0.003 Haiku call → 4 sections of patterns/red flags/hypotheses/verify-in-session populate.
- Before session with client, coach opens `/clients-v2/<id>/analyse/intake` → sticky VerifyChecklist sidebar shows AI-generated questions to ask in person.

**First real client onboarded**: Nidhi Jain (cl-id `nidhi-jain`, age 53, F, perimenopausal). Intake token `ZrRNZjBHdrICRajl7RtD1LuROFOXh1Pg` issued 2026-05-14, valid until 2026-05-28. URL `https://intake.theochretree.com/intake/ZrRNZjBHdrICRajl7RtD1LuROFOXh1Pg` confirmed HTTP 200 on Fly.

**Key invariants:**
- `FLY_INTAKE_ONLY=1` is set in `fly.toml` `[env]`, NOT a Fly secret. The middleware reads it at request time; if it ever gets unset on Fly, the coach UI becomes accessible to anyone who finds the URL — major data leak. To verify: `flyctl env list -a theochretree-coach` should show `FLY_INTAKE_ONLY = "1"`.
- Mutagen versions on Mac client + Fly agent MUST match exactly. The Dockerfile pins `MUTAGEN_VERSION=0.18.1` as an ARG. When you `brew upgrade mutagen`, bump the ARG + redeploy in the same session.
- The `--include=dev` flag on `npm ci` in Dockerfile stage `web-build` is non-negotiable — Tailwind v4's `@tailwindcss/postcss` plugin lives in `devDependencies` and is needed at build time even with `NODE_ENV=production`. Removing the flag breaks the next deploy with a Tailwind compile error.
- Fly SSH certs are 72h. Without the cert-refresh cron (see MUTAGEN_SYNC.md §1 in "Ongoing ops"), Mutagen sync silently stops after 3 days. Set this up before relying on the system unattended for more than ~48h.
- Coach data on the Mac is authoritative. Fly volume is a writable replica that surfaces public form submissions. If Mutagen ever shows `Conflicts: N`, treat the Mac's version as source of truth unless investigation proves otherwise.
