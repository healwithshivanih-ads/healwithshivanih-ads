# Exercise catalogue — handover brief

**Branch:** `claude/client-exercise-catalogue-659740` (worktree)
**Date:** 2026-08-04
**Status:** catalogue + screen shipped and green; figure pipeline proven but incomplete;
plan integration NOT built.

---

## 1. What exists and works

### 1.1 `Exercise` — a first-class catalogue entity

Not an extension of `SomaticPractice`. Added through the full six-point entity surface
in `fmdb/validator.py` (Loaded field, `load_all`, `overlay`, `_check_dupes`, the
alias-collision tuple, and the validation block) — **all six must agree or the entity
half-exists**. `fmdb validate` is clean.

- **`fmdb/enums.py`** — seven enums. `ExerciseModality` snaps to the existing six-modality
  FM prescription matrix plus `pacing`. **`pacing` is deliberately not a tier**: for
  post-exertional malaise, progression *is* the harm, so a pacing entry must not define
  levels (the validator errors if it does).
- **`ExerciseBodyRegion` is deliberately NOT `SomaticBodyRegion`.** The somatic enum lumps
  hip/knee/ankle into `legs_feet`, which is useless for screening a knee.
- **`fmdb/models.py`** — `Exercise`, `ExerciseLevel`, `ExerciseCaution`.
  Safety axes are booleans, not prose: `loads_spine`, `spinal_flexion`,
  `loaded_spinal_rotation`, `overhead`, `impact`, `balance_demand` (0–3, **recorded at the
  HARDEST level**), `requires_floor_transfer`, `joint_stress`.
- **`client_name` / `name_for_client`** — never render `display_name` to a client.

**32 entries** on disk (18 authored here, 14 from the parallel Martinoli session).

### 1.2 The suitability screen

`fmdb/plan/exercise_screen.py` → four verdicts, **blocked first** (the coach should see
what is off the table before what is on it): `blocked` > `caution` > `watch` > `clear`.

Signature is `screen_all(exercises, client)` — a list of exercise dicts and a client dict.

**Built on what the roster actually contains.** `movement_type` and `movement_intensity`
are empty for all 17 clients, so the screen never reads them; it uses `pain_locations`,
conditions, medications and age. `_SCREEN_FIELDS` includes `weight_loss` because
`exercise_limitations` lives inside it.

Measured across the real roster: Sudarshan 13 blocked (PEM — the only client blocked from
anything), Pranati 11 cautions / 0 blocked (LIFTMOR: low bone mass needs loading, not
protecting), five clients entirely clean. **It does not cry wolf.**

- TS mirror `src/lib/fmdb/exercise-screen.ts`, pinned to
  `__fixtures__/exercise-screen-python.json` by 25 tests. Regenerate the fixture by hand
  when the matcher legitimately changes.
- Coach panel: `src/app/(v2)/clients-v2/[id]/exercise-suitability-panel.tsx`.
- Tests: `tests/test_exercise_safety.py` (15), `tests/test_exercise_screen.py` (17).

### 1.3 Client coverage — the draw-order that matters

Ranked by how many of 17 clients the screen clears. **This contradicted intuition:** the
gentle mobility work reaches everyone; the impressive strength moves reach fewest.

| clear | exercise |
|---|---|
| 17/17 | ankle-mobility, neck-mobility, standing-back-extension, energy-envelope-pacing |
| 16/17 | standing-trunk-rotation |
| 15/17 | chair-sit-to-stand, prone-back-extension, seated-knee-extension, joint-mobilising-sequence |
| 14/17 | one-leg-stand, tandem-stance, floor-bridge, sideways-walking, backwards-walking |
| 13/17 | heel-raises, standing-hip-abduction, standing-knee-flexion, toe-raises, supported-knee-bends, stair-walking |
| 12/17 | bodyweight-squat, forward-lunge, press-ups, wall-squat, floor-dip, walking-intervals |

`abdominal-crunch` is the **most-blocked exercise in the catalogue** — 4 clients cannot do
it at all.

---

## 2. The figure pipeline — what actually works

### 2.1 The recipe

1. Generate **one sheet containing all N positions in a single call**, with the existing
   plate (`plate-front.png`) passed as an **image style reference**. Cost **2 credits**.
2. Split the sheet, trace to vector, register the frames, cross-fade in CSS. All free.

**Both/all poses must come from ONE generation.** Generating pose 2 as an *edit* of pose 1
produced a three-legged figure. Drawn together, the body stays consistent.

**Feeding the plate in as a style reference beat describing the style in words** — 11 of 11
came back matching on the first attempt, so the 3× retry budget was never spent.

### 2.2 The hard boundary — sagittal works, rotation does not

The image model has **no 3D representation of the body**.

- **In-plane (sagittal) movement from a side view: excellent.** Knee bends, hip hinges,
  chest lifts — a genuine 2D silhouette change.
- **Axial rotation from the front: fails.** "Rotate 20°, then 35°, then 50°" produces six
  near-identical figures. Confirmed twice, then abandoned rather than re-prompted.
- **Fix for rotation = video.** Seedance 2.0 with start + end keyframes interpolates it
  correctly (verified: frame 0 square-on → frame 118 shoulders clearly angled). **14 credits.**
- **Prompting trick that unlocked the keyframes:** describe the end pose as a
  **"three-quarter view"**, not as "rotated N degrees". The model knows what a 3/4 view
  looks like as a picture; it cannot reason about degrees.

Only **3 of 32** catalogue exercises involve rotation, so this is a narrow exception.

### 2.3 Three bugs that cost real time — do not repeat them

**(a) Splitting by pixel crops slices limbs.**
Cutting the sheet at the lowest-ink column between figures fails when a leg extends
sideways — there is no empty column, so the crop goes through the body. Measured: **nine of
twelve sheets had a frame with a limb sliced off.**
→ Fix: trace the whole sheet once in one coordinate space and assign each **whole path** to
a figure. A path is either in a frame or it is not; it is never cut in half.
→ `pairs/wholesheet.py`. Prefers genuine white gaps when n−1 exist; falls back to a
minima sweep when props bridge the figures.

**(b) Anchoring on the feet is not enough.**
The six poses are drawn separately, so no two bodies are identical. Foot-anchoring still
left the torso sliding a few pixels, and the eye reads that as *the whole figure moving*
rather than the head tilting.
→ Fix: register each frame to the first by the translation that **maximises ink overlap**
(`pairs/register.py`, coarse-to-fine). Vertical drift went from visible to **0.2%**.
→ Registration is a *correction*, not a placement: reject corrections above ~3.5% of height,
or a big pose change (floor bridge) makes it snap to the wrong alignment.

**(c) The viewBox must contain the motion, not the pose.**
Only relevant to the abandoned rig approach, but worth knowing: a viewBox fitted to the
figure at rest clips every limb that swings outside it.

### 2.4 Two measurement errors I made — check the metric before trusting it

- Judged five sheets "failed" from a **thumbnail contact sheet**. Measured silhouette
  change afterwards: only one had genuinely failed. **Measure before reporting.**
- Built a "did it change?" metric comparing **frame 1 to frame 6**. Wrong for any routine
  that *returns to its start* — the warm-up begins and ends standing relaxed, so it scored
  8% change despite arms going overhead in between. Compare max pairwise, not first-to-last.

### 2.5 Splitting mobility sequences — mixed, and not a matter of taste

- **Whole-body warm-up works UNSPLIT.** Six stages (relaxed → shoulders → arms out →
  overhead → knee lift → toes) read as a routine. Better than splitting.
- **Neck mobility fails unsplit** — six identical figures. Not a preference: head positions
  barely change a front-view silhouette. Needs video.

### 2.6 Camera angle is a clinical decision, not an aesthetic one

Heel-to-toe stand drawn from the front hides the entire movement behind the body.
Redrawn **from the side** it reads immediately. Ask "where is this movement actually
visible from?" before generating.

---

## 3. Costs, measured — not estimated

| item | credits |
|---|---|
| Still image, any size (Nano Banana Pro) | **2** |
| One sheet = all 6 (or 12) positions of one exercise | **2** |
| Video clip (Seedance 2.0) | **14** |
| Video clip (Kling 3.0 Turbo) | 7.5 |
| Trace, register, animate, loop, mirror, re-theme | **0** |

**Spent this session: ~100 of 496.** Plan grants **600/month and unused credits are WIPED,
not carried** (ledger shows `Subscription Credits Reset −552.26`). Spend the allowance.

**To finish the catalogue:** ~12 remaining animatable exercises × 2 = ~24 credits, plus
2 video exercises × 16 = 32. Call it **~60 credits**, one month, comfortably.

---

## 4. Current state of the figure library

**Nine animated and shipped** (6 positions each, registered):
standing-back-extension, neck-flexion, joint-mobilising (unsplit warm-up),
chair-sit-to-stand, one-leg-stand, tandem-stance (side view), heel-raises,
standing-hip-abduction, standing-knee-flexion.

**One as video:** standing-trunk-rotation (10s palindrome loop, 44 dB seam, 330 KB).

**Held back, needing a re-run (~8 credits):**
- `ankle-point-pull` — unclear
- `floor-bridge` — unclear
- `prone-back-extension` — will not split evenly
- `neck-side-bend` — front-view head movement, may need video

**Untested at time of writing:** 12 positions per exercise instead of 6, and a heel-to-toe
re-run fixing the back foot (it is not flat on the floor in the current sheet). The
Higgsfield MCP connection dropped mid-call; retry.

**Not started:** female variants of every sheet (the app should serve by client gender —
doubles the library at 2 credits a sheet).

### Where the working files are

Scratchpad (NOT in the repo — copy anything worth keeping):
`/private/tmp/claude-501/…/scratchpad/pairs/`
- `wholesheet.py` — whole-sheet trace + path-level frame assignment
- `register.py` — max-overlap frame registration
- `trace.py` (parent dir) — raster → SVG tracer (numpy masks, BFS components,
  Moore-neighbour boundary, Douglas-Peucker)
- `s6-*.png` — the generated sheets
- `final2.json` — traced + registered frames for the nine shipped

Repo:
- `docs/EXERCISE_SOURCE_IDS.md` — the source-id convergence contract with the book-ingest
  session
- Source records registered: `otago-exercise-programme-2003`, `liftmor-watson-2018`,
  `liftmor-m-harding-2020`, `nice-ng206-me-cfs-2021`, `cdc-steadi-falls-assessment`,
  `servier-medical-art`, `martinoli-5-minute-fitness-2011`

### Anatomy assets — a dead end worth not repeating

Servier Medical Art (CC BY 4.0, commercial OK, **not** share-alike) ships vector as
PowerPoint. Slide 3 of `SMART-Muscles.pptx` extracts cleanly to 3361 real vector paths.
**But muscles are drawn as fibre-line STROKES over a shared fill — there is no closed path
per muscle**, so you cannot select gluteus medius. See memory note
`reference_servier_anatomy_vector.md`. The generated flat plate traces far better for our
purposes.

---

## 5. What is NOT built — the next conversation

**Nothing puts an exercise onto a client's plan.** The screen says who can do what; the
figures show how; the join between them does not exist. That is the whole subject of the
integration discussion:

- How does an exercise appear in the plan editor — its own section, or inside Lifestyle?
- Does the coach pick from a screened list, or does assess suggest exercises the way it
  suggests supplements?
- Level selection: `_pick_start_level` exists in the screen — does the coach override it?
- What does the client see in the Ochre Tree app — the animation, the cue, a rep target,
  a Done button? Does it log to `_practice_log.jsonl` like the somatic practices?
- Progression: who moves a client from level A to B, and on what signal?
- **Published plans are frozen** — exercise edits would go through Quick-edit, as practices do.
- The **staging allowlist trap**: any new `client.yaml` field the client app reads must be
  added to `_APP_CLIENT_KEYS` in `scripts/app-staging-action.py` or it is invisible on Fly.

### Open judgement calls to settle

- Age thresholds (≥75, balance demand ≥2) are **my** judgement. Otago's evidence is about
  ≥80 with a prior fall. Confirm or change.
- 5 Otago balance exercises + 1 warm-up remain unauthored.
- `muscles_worked` field + a muscle-group enum, distinct from `joint_stress`
  (what gets stronger vs what might hurt).
- `body_regions` is empty on all 32 entries — populate it, or drop the detail-plate idea
  that depended on it.
