# Intake form — design brief (living doc)

**Purpose**: paste-ready brief for Claude Design (claude.ai/design) describing what to add or change in the FM intake form. Update this file as the brief evolves rather than rewriting from scratch each round.

**How to use**: copy this entire file into a fresh Claude Design conversation. Design returns mockups + updated CSS/markup. Coding agent ports back into `src/app/intake/[token]/`. Update the changelog at the top of this file when the brief changes.

---

## Changelog

- **v2.2** — 2026-05-14 — added Section 6 COVID-vaccine block; Section 11e pain map moved to DEV-IMPLEMENTED (skip from design); added `pain_quality` chip group.
- **v2.1** — 2026-05-14 — added Section 7 layered medications explicit pattern callout; "reuse existing design system" instruction at top.
- **v2.0** — 2026-05-14 — full coach-grade audit applied. Added: GLP-1 + sensitive med categories, weight trajectory, COVID/long-COVID, sun/Vit D, work patterns, dental, postprandial reactivity, histamine/MCAS, chemical sensitivity, cold/heat tolerance, tracking devices, recent labs. Restructured: bowel habits (Bristol sub-card), hair / nails / skin / pain / immune / mouth as own subsections within Section 11; women's reproductive with contraception + pregnancies repeaters; sleep depth (3am wake / snoring / CGM); energy crash patterns; family history depth.
- **v1.0** — 2026-05-14 — initial 16-section brief. Design delivered: Welcome / Birth & early years / Body systems accordion / Readiness slider / Thank-you snapshots + full design system (`design-system.css` + `form.css`) + spec panel. Already ported to live form.

---

# Brief

This is an addendum to the v1 brief. The existing 16-section structure stays. The changes below add fields to existing sections, restructure a few, and introduce one new interaction pattern. Field names are the dev contract — please don't rename.

## Reuse the existing design system

All atoms you built for v1 (`fm-chip`, `fm-radio` with column + pill row variants, `fm-slider` with `--graded` variant, `fm-rating`, `fm-days`, `fm-acc`, `fm-rep`, `fm-consent`, `fm-section`, `fm-fg`) should cover everything in this delta. Don't introduce new visual primitives unless the data type genuinely requires one. If you do, build it in `form.css` using the existing tokens (`var(--indigo)`, `var(--rose)`, `var(--lavender)`, `var(--bone)`, `var(--bone-warm)`, `var(--sage)`).

## One new interaction to design explicitly — Section 7 layered medications

The only pattern v1 didn't mock. Each named medication bucket (💉 GLP-1, 🩺 Acid suppressants, etc.) is a chip. Tapping the chip toggles it on AND expands an inline mini-form beneath the chip row (or inside an accordion row — your call) where the client fills: name + dose + started when + still on it + side effects. Show both empty state (chip only) and expanded state (chip selected + mini-form revealed) in the mockup.

## What dev will handle (skip from your design pass)

- **Section 11e Pain location body map** — dev will build an interactive SVG body silhouette directly in React using your existing tokens (indigo highlight at 30% opacity for selected regions, lavender outline for inactive). Please leave a placeholder rectangle ~340px wide × 240px tall labelled `[pain-body-map]` where the map goes — dev replaces with the silhouette later. The follow-up chip groups below the map (`headache_type`, `pain_pattern`, `pain_quality`) DO need your styling — they're standard `.fm-chips`.

- **Bristol stool chart imagery** — dev will source / draw the 7 stool-type illustrations separately. Leave a placeholder rectangle (Option A — see Bristol sub-card spec below) or 7 `[type-N-icon]` placeholder squares (Option B). Pick the interaction pattern and lock the layout; the actual illustrations drop in later.

---

## Section 2 — Who you are, ADD

- `weight_highest_adult` (number kg, optional)
- `weight_lowest_adult` (number kg, optional)
- `weight_trend_current` (radio: stable / gaining slowly / losing slowly / fluctuating / recently changed sharply)
- `weight_change_trigger` (text, only if "recently changed sharply") — "What was happening when it changed?"
- `work_pattern` (chip multi-select): desk-bound 8+ hrs / on feet all day / shift work / nights / works from home / heavy physical / high-stress role / commutes 1hr+ each way / travels for work weekly

## Section 5 — Family history, ADD

After existing per-relative textareas, add:
- `family_specific_conditions` (chip multi-select): early heart disease before 60 / breast cancer / colon cancer / prostate cancer / ovarian cancer / type 2 diabetes before 50 / autoimmune (any) / dementia / suicide or severe mental illness / addiction / thyroid disease / celiac
- Add to each relative prompt: "If they have / had a chronic condition, roughly what age did it start?" (free text)

## Section 6 — Medical history, ADD

### COVID infection history

- `covid_history` (chip multi-select): never tested positive / one mild infection / multiple infections / hospitalised / long-COVID symptoms now / long-COVID symptoms past, resolved
- `covid_long_symptoms` (chip multi-select, only if long-COVID ticked): fatigue / brain fog / breathlessness / palpitations / smell or taste changes / new food sensitivities / sleep changes / new period changes / new joint pain

### Post-vaccination history (NEW — same matter-of-fact tone as other meds)

Section subhead microcopy:
> *I ask everyone about all of their medical history, including vaccines — not because of any agenda, but because I need the full picture to design good care.*

- `covid_vaccine_history` (chip multi-select): not vaccinated / 1 dose / 2 doses / 1 booster / 2+ boosters / unsure
- `covid_vaccine_brand` (chip multi-select, optional): Covishield (AstraZeneca) / Covaxin / Pfizer / Moderna / Sputnik / Novavax / other / unsure
- `covid_vaccine_reactions` (chip multi-select, optional): no reactions noticed / sore arm only / fatigue lasting over a week / persistent fatigue since / period changes / heavy bleeding / cycle disruption / palpitations or chest tightness / brain fog / dizziness or POTS-like / new neurological symptoms / new joint pain / autoimmune flare / other
- `covid_vaccine_reaction_detail` (text, optional) — "Which dose, roughly when, and what happened? Skip if not relevant."

## Section 7 — Medications, EXPAND

Keep existing `current_medications` and `current_supplements` repeaters. Above them, add a layered structured prompt: **"Have you ever taken any of these regularly?"** — chip multi-select. Each tick expands an inline mini-form `(which one, dose, started when, still on it, side effects)`:

- 💉 **GLP-1 weight-loss** (Ozempic / Wegovy / Mounjaro / Tirzepatide / Saxenda / compounded semaglutide / compounded tirzepatide)
- 🩺 **Acid suppressants** (Pantoprazole / Omeprazole / Esomeprazole / daily antacids)
- 💊 **Daily NSAIDs** (ibuprofen / naproxen / diclofenac / dolo)
- 🧫 **Antibiotics in last 12 months** (how many courses, what for)
- 🌸 **Hormonal contraception or HRT** (pill / hormonal IUD / copper IUD / implant / depo / patch / HRT / vaginal oestrogen / progesterone cream / testosterone) — type + start + end + duration
- 🦋 **Thyroid medication** (levothyroxine / liothyronine / NDT / methimazole / propylthiouracil)
- 🌧 **Antidepressants / anti-anxiety / sleep aids** (SSRIs / SNRIs / benzos / Z-drugs / melatonin daily)
- 🛡 **Biologics or immunosuppressants** (Humira / Enbrel / methotrexate / etc — name + condition)
- 💉 **Statins / BP meds / diabetes meds**

Mobile: accordion. Desktop: 2-col.

## Section 8 — Typical day of eating, ADD

- `postprandial_pattern` (chip multi-select): sleepy after meals / brain fog after meals / energy crash / hungry again within 2hrs / great energy / depends on the meal
- `cold_heat_tolerance` (radio): always cold / always hot / normal / hot flushes / runs hot in evenings

## Section 10 — Five pillars, EXPAND

**Sleep**, add to existing fields:
- `time_to_fall_asleep` (radio: under 15 min / 15–30 / 30–60 / 60+)
- `wake_time_pattern` (chip multi-select): sleep through / wake around 3am consistently / wake around 5am consistently / wake multiple times / wake unrefreshed / wake to urinate
- `snore_or_apnoea` (radio: no / sometimes / often / diagnosed apnoea / use CPAP)
- `restless_legs` (radio: no / mild / disrupts sleep)
- `sleep_tracker_owned` (chip multi-select): Oura / Whoop / Apple Watch / Fitbit / Garmin / phone app / none
- `cgm_owned` (radio: yes-current / yes-past / no / interested)

**Energy**, add:
- `energy_crashes` (chip multi-select): never / after meals / mid-afternoon / after caffeine wears off / before periods / after exercise / after sugar
- `caffeine_dependency` (radio: none / drink it but fine without / need it to function / headaches without it)
- `morning_state` (radio: jump out of bed / fine after coffee / sluggish 1–2 hours / hard to wake at all)

## Section 11 — Body systems, RESTRUCTURE several subsections

### 11a — Digestion & bowel habits (deepen — give this its own sub-card)

See **Bristol sub-card spec** at the end of this brief.

### 11b — Hair (new own subsection)

- `hair_loss_pattern` (radio): no loss / diffuse thinning all over / widening part / receding hairline / patchy / clumps in shower / only with stress
- `hair_texture_change` (radio): no change / coarser / finer / drier / oilier / more brittle / grey under 30
- `hair_other` (chip multi-select): itchy scalp / dandruff / oily roots / dry ends / facial hair in women (chin or lip) / body hair thinning / new facial hair where there wasn't

### 11c — Nails (new own subsection)

- `nail_signs` (chip multi-select): vertical ridges / white spots / splitting / slow growth / fungal / nail-biting / spoon-shaped concave / pale lunulae / no concerns

### 11d — Skin (deepen)

- `acne_pattern` (chip multi-select): no acne / chin or jawline / forehead and T-zone / back or chest / cyclical with period / cystic / hyperpigmentation after spots heal
- `skin_signs` (chip multi-select): rosacea / flushes easily / melasma or pregnancy mask / skin tags / keratosis pilaris on backs of arms / easy bruising / slow wound healing / stretch marks (striae) / itchy with no rash

### 11e — Pain (DEV-IMPLEMENTED body map + designed chip groups)

**Body map**: dev will build an interactive SVG body silhouette (front + back views side-by-side) in React. Please leave a placeholder rectangle ~340px × 240px labelled `[pain-body-map]`. Dev replaces with the silhouette.

The chip groups below the map DO need your styling — standard `.fm-chips`:
- `headache_type` (chip multi-select, only if head or face ticked on the body map): tension band / migraine with aura / migraine without aura / cluster / sinus / period-linked / morning / evening
- `pain_pattern` (chip multi-select): worse in morning / worse in evening / worse with movement / worse at rest / wakes me at night / better with heat / better with cold
- `pain_quality` (chip multi-select): dull ache / sharp / burning / throbbing / pins and needles or tingling / electric or shooting / cramping / stiffness

### 11f — Hormones & metabolism, ADD

- `belly_fat_pattern` (radio): no concerns / new belly fat / always had belly fat / pear-shape (hips and thighs) / face has changed shape

### 11g — Immune, ADD

- `histamine_signals` (chip multi-select): flushing with wine or fermented foods / hives or welts / itchy with no rash / fragrance-sensitive / can't tolerate aged cheese or vinegar / diagnosed histamine intolerance
- `chemical_sensitivity` (chip multi-select): perfumes give headaches / can't be near cleaning products / strong hangovers / sensitive to alcohol / sensitive to medication side effects more than others / metal allergies
- `tolerance_changes` (chip multi-select): coffee / caffeine · alcohol · fatty or fried food · perfumes / strong smells · certain medications or supplements · none — no real change. _Declining-tolerance signal (used to handle it, now reacts) — a Phase I/II liver-biotransformation capacity clue the other sensitivity fields only capture in the present tense. Feeds `detectLiverDetoxAdvisory` (Upstream group)._

### 11h — Mouth & teeth (new own subsection)

- `oral_signs` (chip multi-select): bleeding gums / receding gums / recurrent mouth ulcers / geographic tongue (map-like patches) / white coating on tongue / mouth breathing at night / dry mouth / TMJ pain / frequent cavities / sensitive teeth

## Section 12 — Periods (women only), RESTRUCTURE

Replace the flat list with these grouped subsections:

**Cycle** (keep existing): `menarche_age`, `cycle_length_days`, `cycle_regularity`, `last_menstrual_period`, `period_flow`. Add:
- `period_pain_severity` (1–10 slider, use `.fm-slider--graded`) — replaces existing `period_pain`
- `period_pain_impact` (radio): doesn't affect my day / inconvenient / I miss work or sleep / debilitating
- `pmdd_signs` (radio: no / suspect / diagnosed)

Keep `pms_symptoms` chip.

**Contraception history — repeater** (replaces existing free-text). Each row: `{type (dropdown: combined pill / progesterone-only pill / hormonal IUD / copper IUD / implant / depo / patch / vaginal ring / barrier / none), started year, stopped year or "still on it", side effects (chip multi-select)}`

**Pregnancies — repeater** (replaces existing free-text). Each row: `{year, outcome (live birth / miscarriage / termination / stillbirth), complications (chip multi-select: gestational diabetes / pre-eclampsia / gestational hypertension / hyperemesis / postpartum thyroiditis / postpartum depression / anaemia / other), birth type (vaginal / C-section / forceps / N/A), breastfeeding duration months}`

**Diagnoses** (chip multi-select): endometriosis suspected / endometriosis diagnosed / PCOS suspected / PCOS diagnosed / fibroids / adenomyosis / ovarian cysts / IVF history / IUI history / clomid history

**Perimenopause inventory** (chip multi-select, optional): hot flushes / night sweats / belly weight gain / sleep changes / mood crashes / brain fog / vaginal dryness / hair changes / cycles shortening / cycles lengthening / heavier bleeding / lighter bleeding

## Section 14 — Environment, ADD

- `sun_exposure_daily` (radio): under 15 min / 15–60 min / 1–2 hrs / 2+ hrs / varies a lot
- `sunscreen_use` (radio): daily on face / occasionally / never / only at the beach
- `vit_d_supplement` (radio): yes daily / yes sometimes / no / not sure
- `barefoot_outdoors` (radio): regularly / occasionally / never

## Section 16 — Readiness, ADD

- `recent_labs_done` (chip multi-select): thyroid panel / CBC / lipid panel / vitamin D / B12 / iron / HbA1c / fasting insulin / sex hormones / cortisol / inflammatory markers / none of the above / not sure
- `recent_labs_when` (text, optional) — "Roughly when?"
- `willing_to_share_labs` (radio: yes happy to / yes if needed / would prefer not / no labs to share)
- `willing_to_test_further` (radio: yes / depends on cost / no / not sure)

Also: introduce `readiness_confidence` as a 1–10 `.fm-slider--graded` if not already present.

---

## Bristol stool sub-card (Section 11a, full spec)

The bowel-habits subsection gets its own visually distinct sub-card inside Section 11. Structure top-to-bottom:

**Sub-card heading**
> **Bowel habits**
> *Stick with me — this section tells me more about your gut than almost any lab. Be specific where you can.*

**Helper above the chart**
> Bowel patterns vary day to day. Tick **every type** you've seen in a typical week — most people have more than one.

**The chart — placeholder rectangles, no need to design the stool shapes (dev sources / draws separately)**

Pick ONE interaction pattern, your call:

- **Option A** — Static reference rectangle `[bristol-chart-reference-image]` (full-width, ~340px mobile / ~480px desktop) + chip multi-select below with the 7 types listed below.
- **Option B (preferred)** — Seven interactive cards stacked vertically. Each card: left `[type-N-icon]` placeholder (~64px square) + middle `Type N` heading + description + right checkbox / filled state. Whole card is the tap target.

The 7 type labels (verbatim, clinical canon — don't rephrase):

1. Type 1 — Separate hard lumps, like nuts
2. Type 2 — Sausage-shaped but lumpy
3. Type 3 — Sausage-shaped with cracks on the surface
4. Type 4 — Smooth, soft, sausage-shaped
5. Type 5 — Soft blobs with clear-cut edges
6. Type 6 — Fluffy pieces with ragged edges, mushy
7. Type 7 — Watery, no solid pieces

Skip the "very constipated / lacking fibre / inflammation" right-hand column — it over-pathologises the extremes.

**Three structured prompts below the chart, always shown**

- `bowel_frequency_per_day` — number input, range 0–10, label "How many times a day?"
- `bowel_pattern` — chip multi-select: straining / sense of incomplete evacuation / pain when passing / blood occasionally / mucus / urgency / alternating constipation and loose / wakes you at night / nothing notable
- `bowel_historical` — single-line text input, optional, label "What was normal for you 5–10 years ago?", placeholder "e.g. once a day after coffee, type 4"

**Footer reassurance** (muted small text)
> *Nothing here is shared anywhere outside our work together.*

**Brand colour you reserve for the eventual chart illustration** — pick one and note it in your output (warm terracotta / sage on cream / sepia line work). The dev-supplied illustrations will be redrawn to match.

---

## What to output

1. **Mobile mockup (375px)** of 3 representative new/changed sections: **Section 7 medications expansion**, **Section 11a Bristol sub-card**, **Section 12 women's pregnancies + contraception repeaters**.
2. **Same sections at desktop (~640px)**.
3. **Selected vs unselected state** of the Bristol interaction pattern AND the Section 7 medications expand pattern.
4. **Your choice between Option A and Option B for Bristol** + one-line rationale.
5. **Brand colour token reserved for the chart illustration**.
6. **Full styled markup** for the 3 mockup sections.

---

## Dev contract — field names that MUST stay exact

`weight_highest_adult`, `weight_lowest_adult`, `weight_trend_current`, `weight_change_trigger`, `work_pattern`, `family_specific_conditions`, `covid_history`, `covid_long_symptoms`, `covid_vaccine_history`, `covid_vaccine_brand`, `covid_vaccine_reactions`, `covid_vaccine_reaction_detail`, `glp1_medications`, `acid_suppressants`, `nsaids_daily`, `antibiotics_last_12mo`, `hormonal_contraception_hrt`, `thyroid_medication`, `psych_medications`, `biologics_immunosuppressants`, `statins_bp_diabetes`, `postprandial_pattern`, `cold_heat_tolerance`, `time_to_fall_asleep`, `wake_time_pattern`, `snore_or_apnoea`, `restless_legs`, `sleep_tracker_owned`, `cgm_owned`, `energy_crashes`, `caffeine_dependency`, `morning_state`, `bristol_stool_typical`, `bowel_frequency_per_day`, `bowel_pattern`, `bowel_historical`, `hair_loss_pattern`, `hair_texture_change`, `hair_other`, `nail_signs`, `acne_pattern`, `skin_signs`, `pain_locations`, `headache_type`, `pain_pattern`, `pain_quality`, `belly_fat_pattern`, `histamine_signals`, `chemical_sensitivity`, `tolerance_changes`, `oral_signs`, `period_pain_severity`, `period_pain_impact`, `pmdd_signs`, `contraception_history` (repeater), `pregnancies` (repeater), `repro_diagnoses`, `perimenopause_inventory`, `sun_exposure_daily`, `sunscreen_use`, `vit_d_supplement`, `barefoot_outdoors`, `recent_labs_done`, `recent_labs_when`, `willing_to_share_labs`, `willing_to_test_further`, `readiness_confidence`.

Anything generated under a different name is silently dropped at submit.

---

## Dev backlog (handled in code, not by design)

Tracked here so we don't forget — these were specced in earlier brief versions but are being implemented directly:

1. **Section 11e Pain — interactive SVG body map.** Front + back silhouettes side-by-side. Tappable regions highlight in indigo at 30% opacity. Selected regions surface as removable chips below the silhouettes.
   Tappable region slugs (used as values in `pain_locations` array):
   - Front: `head`, `face`, `jaw`, `neck_front`, `chest`, `shoulder_left`, `shoulder_right`, `arm_left`, `arm_right`, `elbow_left`, `elbow_right`, `hand_left`, `hand_right`, `upper_abdomen`, `lower_abdomen`, `pelvis`, `hip_left`, `hip_right`, `thigh_left`, `thigh_right`, `knee_left`, `knee_right`, `shin_left`, `shin_right`, `foot_left`, `foot_right`
   - Back: `head_back`, `neck_back`, `upper_back`, `mid_back`, `lower_back`, `scapula_left`, `scapula_right`, `sacrum`, `buttock_left`, `buttock_right`, `calf_left`, `calf_right`, `achilles_left`, `achilles_right`
   - Free SVG silhouettes available on Wikimedia (search "human anatomy" — public-domain or CC-BY options). Redraw in brand palette in ~30 min.

2. **Bristol stool 7 illustrations.** Either source the existing CC BY 4.0 NCBI/Open RN chart and crop into 7 tiles, or commission a soft brand-fit redraw. Whichever interaction pattern design picks (A or B), the dev wraps it in a `<BristolStoolChart variant="..." />` component so we can swap the source later without touching the form.
