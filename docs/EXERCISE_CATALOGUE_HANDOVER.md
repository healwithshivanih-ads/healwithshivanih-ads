# Exercise catalogue — handover brief

**Date:** 2026-08-05 (§§4–8 rewritten; §§1–3 still describe the original build)
**Status:** catalogue, screen, plan integration, client player, selection logic and 33
figures all shipped and green. What is left is listed in §8 — none of it blocks use.

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

**Spent across sessions: ~180 of 600.** Plan grants **600/month and unused credits are WIPED,
not carried** (ledger shows `Subscription Credits Reset −552.26`). Spend the allowance.

**To finish the catalogue:** ~12 remaining animatable exercises × 2 = ~24 credits, plus
2 video exercises × 16 = 32. Call it **~60 credits**, one month, comfortably.

---

## 4. Current state of the figure library

**33 figures ship** in `fm-database/data/_exercise_figures.json` (~1 MB, underscore-prefixed
so `fmdb validate` skips it — same footing as `_ingredient_nutrients.yaml`). Each carries its
traced path `d` strings, frame extents and one registration offset; the renderer is
`src/lib/fmdb/exercise-figure-traced.ts`, which fails closed on anything malformed.

They come from five rounds, and the asset records which in a `source` field so a later
re-draw of one figure wins over an earlier one without ambiguity:

| source | n | what it is |
|---|---|---|
| `coach-fix-2026-08-05` | 6 | redrawn after her first review — these beat every earlier version |
| `tier2-2026-08-05` | 4 | the Tier-2 progression rungs |
| `conditioning-2026-08-05` | 11 | impact + conditioning (see §6) |
| `tier1` / `solo` | 5 | earlier one-off pairs |
| `sheet6` | 7 | the original 6-frame sheets, reduced to their two extremes |

**Eight ship as video** (`public/exercise-videos/`, allow-listed in `middleware-policy.ts` so
Fly serves them): standing-trunk-rotation, joint-mobilising-sequence, neck-retraction,
neck-sidebend, plus burpee, squat-jumps, mountain-climbers and cool-down-stretch-sequence,
added after the coach's review — see §7.3. `exercise-video.ts` maps slug → file and **video
wins over the traced figure** where both exist — video is only ever made for movements two
stills cannot show, so where there is one it carries strictly more of the movement.

Two figures carry **motion arrows** (side-hops, split-jumps) — see §7.2.

**Not started:** female variants of every figure — the coach benched these deliberately
(2026-08-05) rather than deferring them by accident. Revisit when the library is otherwise
settled; it doubles at 2 credits a pair.

### Where the working files are

The reusable primitives now live in the repo at `fm-database/scripts/` (they were
scratchpad-only for three sessions running, which is why they kept getting rewritten):
- `trace.py` — raster → SVG tracer (numpy masks, BFS components, Moore-neighbour
  boundary, Douglas-Peucker)
- `pairreg.py` — max-ink-overlap registration between two traced frames
- `twopose.py` — the accept/reject gate and `extremes()`, which defines "the pair" ONCE so
  the app and the review page never disagree about which two poses those are
- `facing.py` — which way the figure faces, for catching mirrored generations

The per-batch drivers (which PNG maps to which slug) stay in the scratchpad: they point at
generated images that are not committed, so a copy in the repo would be a script that
cannot run.

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

## 5. How an exercise reaches a client — the sandwich

This is built. The join is a **screen → model → gate sandwich**, and the ordering is the
whole safety argument:

1. **Screen** (`fmdb/assess/exercise_screen.py`, mirrored in `exercise-screen.ts`) decides
   from the client record which exercises are permissible at all, and at which rung.
   Deterministic, no model involved.
2. **Model** proposes a session from the screened list, shaped by the programme structure
   in §6.
3. **`gate_prescription` runs AFTER the model**, re-screening everything it chose. A model
   that invents an exercise, or picks one the screen excluded, has its choice dropped —
   not argued with. This is why the gate is downstream and not a prompt instruction.

TS/Python parity is pinned by `__fixtures__/exercise-screen-python.json`, captured from the
real Python over the real catalogue. **Regenerate it by hand whenever the screen legitimately
changes** — the fixture is the only thing stopping the two implementations drifting.

The client sees the session in `ochre-exercise.tsx`: one exercise at a time, in the coach's
order, self-paced with no countdown. Rep-based work is paced by the body, and nobody props a
phone up while standing on one leg. It logs to `_practice_log.jsonl` on finish AND on
unmount, with measured seconds — a session abandoned half way is still practice.

---

## 6. Selection logic — what the model is actually told

**Movement patterns and muscles are first-class.** `MovementPattern` and `MuscleGroup`
(`fmdb/enums.py`) are populated on all 32 entries. A session is balanced by PATTERN, not by
counting exercises: three quad-dominant movements are not a lower-body session.

**Programme structure is ingested, not invented.** `data/_exercise_programmes.yaml` holds
5 session formats and the weekly rules, from Martinoli ch 5–7. The model composes from these
rather than free-styling a session shape.

**Menopause changes emphasis, never permission.** `menopause_stage()` in `suggester.py`
derives `perimenopause` / `postmenopause` from `active_conditions` and `medical_history`
(post wins over peri — records accumulate, and the later state is the true one). It feeds
rule 32, which asks for loading and impact over steady cardio, short hard efforts, and
strength before conditioning. It is deliberately **not** part of the screen: safety stays
where the fixture pins it, and this only reorders what was already permissible.

`test_menopause_stage.py` guards the one inversion that matters — "Premenopausal" must NOT
read as the transition, and a bare substring match on `menopaus` gets that backwards.

**Progression is measured, not assumed.** `exercise-progression.ts` will only suggest a rung
change on ≥6 finished sessions inside 28 days. Below that it says nothing, because a
threshold picked before the log had data in it would be a guess wearing a number.

**The conditioning set is hard-gated.** The 11 impact entries added for weight-loss clients
exist because the catalogue had nothing above gentle. Every one is screened out for the
frail-and-falls cohort the rest of the library was built for. Note `burpee` carries a firm
caution for hypertension rather than a hard block: the catalogue's convention is that
cautions inform the coach and blocks remove choice, and a blanket block there would have
been the wrong instrument.

---

## 7. Composing a frame the model refuses to draw

`ankle-jumps` is the worked example, and it generalises. Two attempts at "airborne, feet
pointed" came back as a **second standing figure** — and the second attempt read as *less*
movement than the first (3% vs 7%), so iterating the prompt was moving away from the answer.

A hop is a rigid vertical translation of the whole body. That is the one shape that
decomposes perfectly, so the frame was **composed**: lift the traced figure 58px, leave the
ground line where it is, and the daylight under the feet IS the movement. 15% change, gate
passed, and no generation could have been more correct than a translation.

**The trap this creates:** a composed frame is already in register with its source, so the
max-ink-overlap search must not run on it. It would find its best overlap by sliding the
lifted body back down onto the standing one — cancelling the lift, and reporting the pair as
two pictures of the same thing. Hence the `PREREGISTERED` set in the batch driver.

The general rule, which cost a full day to see: **when the image model has a fixed wrong
idea, arguing with it does not work — building the picture yourself does, and how far that
gets you depends entirely on whether the shape decomposes into rigid pieces.** A foot does.
An elbow does not. A whole body under a jump does.

### 7.1 Registration is a CORRECTION, not a step

Registration exists because the original sheets held six poses in one image and were split
apart, so each frame landed in its own arbitrary coordinate space. **Poses generated one
per call do not have that problem** — measured across the conditioning batch, all 22 images
were 1200×896 with the ground line within one pixel of row 868. One space. Identity is the
right answer.

Running the max-overlap search on already-registered frames is **not a no-op, it is silent
damage** — the output is a valid animation of the wrong movement, and nothing errors:

- **burpee** was shifted **302px sideways**. A standing figure and a plank overlap at IoU
  0.22, so "best overlap" is meaningless; the figure teleported instead of dropping.
- **jumping-jacks +144px, alternate-toe-taps +184px, split-jumps +218px** — each slid a
  figure *down off a ground line it was already standing on*.
- **ankle-jumps** had its composed 58px lift cancelled outright.

Call `pairreg.iou_at(a, b, 0, 0)` first. A high value means they already agree, and the
identity is correct. Ask whether the frames are in different spaces before correcting for it.

### 7.2 Motion arrows, for when a correct figure still does not read

Two poses can be perfectly drawn and still fail to say which WAY the movement goes: a
lateral hop cross-fades between a figure left of a towel and the same figure right of it,
which reads as a jump-cut. Figures may carry an optional `arrows` array (frame coordinate
space, `bow` = perpendicular offset of the quadratic control point). They are **arcs, not
straight lines — the curve is the hop** — and they draw themselves along the path in step
with the pose they explain.

Three traps, all now covered by tests in `exercise-figure-traced.test.ts`:
- A `path` CSS rule scoped to the whole SVG also hits the arrowhead inside the marker def,
  and a stylesheet beats an inline presentation attribute — the head fills solid and reads
  as a blob. Scope it to `g > path`.
- Opacity must do the hiding, not the dash offset. **An SVG marker draws at its vertex
  whatever the dashing**, so a dash-only hide strands the arrowhead on screen.
- **Never put an angle-bracketed tag name in a CSS comment.** SVG is XML; it parses as
  markup and the whole image silently fails to render.

### 7.3 When to reach for video instead

Beyond the rotation/neck cases in §2.2, video also earns its cost when a movement has **too
many stages for two poses** — the coach's words on the burpee were "too many movements to
come correctly with single images". Generate at **480p / fast / no audio**: these are flat
two-tone line figures, so resolution buys nothing and the clip costs **6 credits instead of
22.5**.

It is not a universal escape hatch. `split-jumps` was attempted twice and came back as a
**running stride** both times — running travels, a scissor skip does not — so it keeps its
traced pair plus arrows. When the second attempt is no closer than the first, stop.

---

## 8. Open judgement calls still to settle

- Age thresholds (≥75, balance demand ≥2) are **my** judgement. Otago's evidence is about
  ≥80 with a prior fall. Confirm or change.
- 5 Otago balance exercises + 1 warm-up remain unauthored.
- `body_regions` is empty on all 32 entries — populate it, or drop the detail-plate idea
  that depended on it.
- Lehman *Recovery Strategies* is identified as worth ingesting and has not been.
- **Published plans are frozen** — exercise edits go through Quick-edit, as practices do.
- The **staging allowlist trap**: any new `client.yaml` field the client app reads must be
  added to `_APP_CLIENT_KEYS` in `scripts/app-staging-action.py` or it is invisible on Fly.
