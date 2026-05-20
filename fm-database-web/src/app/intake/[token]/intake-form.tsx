"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveIntakeDraft, submitIntakeForm } from "@/lib/server-actions/intake";
import { FormChrome } from "./form-chrome";
import { BristolStoolIcon } from "./bristol-stool-icon";
import { PainBodyMap } from "./pain-body-map";

// ── Types ───────────────────────────────────────────────────────────────────

interface TimelineRow {
  year: string;
  event: string;
  category: string;
  date?: string;
}

interface MedicationCategoryEntry {
  name: string;
  dose: string;
  started: string;
  still_taking: boolean | null;
  side_effects: string;
}

interface ContraceptionRowState {
  type: string;
  started_year: string;
  stopped_year: string;
  side_effects: string[];
}

interface PregnancyRowState {
  year: string;
  outcome: string;
  complications: string[];
  birth_type: string;
  breastfeeding_months: string;
}

interface FormState {
  // About you
  display_name: string;
  date_of_birth: string;
  sex: string;
  email: string;
  city: string;
  country: string;

  // v2.2 — weight + work pattern
  weight_highest_adult: string;
  weight_lowest_adult: string;
  weight_trend_current: string;
  weight_change_trigger: string;
  work_pattern: string[];

  // v2.3 — body composition today (any one unit per row is fine).
  height_cm: string;
  height_ft: string;
  height_in: string;
  weight_now_kg: string;
  weight_now_lb: string;
  waist_cm: string;
  waist_in: string;
  hip_cm: string;
  hip_in: string;
  bp_systolic: string;
  bp_diastolic: string;

  // Concerns
  why_here: string; // → goals[0]
  concern_1: string;
  concern_2: string;
  concern_3: string;

  // Whats going on
  active_conditions: string[];
  known_allergies: string[];
  current_medications: string[];
  // v2.4 — Supplements split from medications. Coaches kept losing track
  // of which line was a drug vs a vitamin/herb when they were combined.
  current_supplements: string[];
  family_history: string;

  // v2.2 — family + covid
  family_specific_conditions: string[];
  covid_history: string[];
  covid_long_symptoms: string[];
  covid_vaccine_history: string[];
  covid_vaccine_brand: string[];
  covid_vaccine_reactions: string[];
  covid_vaccine_reaction_detail: string;

  // v2.2 — Medications layered
  glp1_medications: MedicationCategoryEntry[];
  acid_suppressants: MedicationCategoryEntry[];
  nsaids_daily: MedicationCategoryEntry[];
  antibiotics_last_12mo: MedicationCategoryEntry[];
  hormonal_contraception_hrt: MedicationCategoryEntry[];
  thyroid_medication: MedicationCategoryEntry[];
  psych_medications: MedicationCategoryEntry[];
  biologics_immunosuppressants: MedicationCategoryEntry[];
  statins_bp_diabetes: MedicationCategoryEntry[];

  // Timeline
  timeline_events: TimelineRow[];

  // Day-to-day narratives
  digestion_notes: string;
  sleep_notes: string;
  energy_pattern: string;
  menstrual_notes: string;
  stress_response: string;

  // Five pillars
  fp_sleep_quality: number | null;
  fp_sleep_hours: number | null;
  fp_stress: number | null;
  fp_movement_days: number | null;
  fp_nutrition_quality: number | null;
  fp_connection_quality: number | null;
  fp_notes: string;

  // v2.2 — sleep depth
  time_to_fall_asleep: string;
  wake_time_pattern: string[];
  snore_or_apnoea: string;
  restless_legs: string;
  sleep_tracker_owned: string[];
  cgm_owned: string;

  // v2.2 — energy
  energy_crashes: string[];
  caffeine_dependency: string;
  morning_state: string;

  // Past & environment
  childhood_history: string;
  toxic_exposures: string;
  what_has_worked: string;
  what_hasnt_worked: string;

  // v2.2 — environment
  sun_exposure_daily: string;
  sunscreen_use: string;
  vit_d_supplement: string;
  barefoot_outdoors: string;

  // Diet
  dietary_preference: string;
  // Only asked when dietary_preference is vegetarian / eggetarian / vegan /
  // jain. "yes" | "no" | "unsure" | "". Feeds the plan checker + letter
  // generator so we never recommend fish-oil/gelatin to someone who said no.
  animal_derived_supplements_ok: string;
  foods_to_avoid: string;
  non_negotiables: string;
  reported_triggers: string;

  // v2.2 — eating reactivity
  postprandial_pattern: string[];
  cold_heat_tolerance: string;

  // v2.2 — Body systems (Section 11)
  bristol_stool_typical: number[];
  bowel_frequency_per_day: number | null;
  bowel_pattern: string[];
  bowel_historical: string;
  hair_loss_pattern: string;
  hair_texture_change: string;
  hair_other: string[];
  nail_signs: string[];
  acne_pattern: string[];
  skin_signs: string[];
  pain_locations: string[];
  headache_type: string[];
  pain_pattern: string[];
  pain_quality: string[];
  belly_fat_pattern: string;
  histamine_signals: string[];
  chemical_sensitivity: string[];
  oral_signs: string[];

  // v0.75.2 — Tier 1 screening: hypermobility (Beighton self-score),
  // orthostatic intolerance (NASA lean self-check, device-conditional),
  // PEM (post-exertional malaise / ME/CFS signal), and mould-specific
  // environment chips. All optional; the AI insights run will pattern-
  // match them and surface MCAS-POTS-EDS / long-COVID / mould-CIRS
  // hypotheses for the coach.
  beighton_self_score: string[];      // chips for the 5 Beighton tests
  beighton_supplemental: string[];    // chips: double-jointed, dislocate, stretchy, bruise
  hr_devices_owned: string[];         // chips — Apple Watch, BP monitor, etc.
  lean_test_supine_hr: string;        // free text (bpm) — only if device owned
  lean_test_standing_hr: string;      // free text (bpm) — only if device owned
  lean_test_symptoms: string[];       // chips for standing-tolerance symptoms
  pem_screen: string[];               // chips for post-exertional malaise pattern
  mould_exposure: string[];           // chips — visible mould, leaks, work exposures
  large_fish_frequency: string;       // single-select — conditional on non-veg diet

  // v0.75.5 — Tier 2 screening (ACE-lite / STOP-BANG / Endometriosis)
  ace_signals: string[];              // childhood adversity / current hypervigilance
  stop_bang_signals: string[];        // sleep-apnoea STOP-BANG deepening
  endometriosis_signals: string[];    // women-only — endo pattern chips

  // Women only — original cycle fields
  cycle_status: string;
  last_menstrual_period: string;
  cycle_length_days: string;
  cycle_regularity: string;
  pregnancy_status: string;
  menopause_started: string;          // v0.72 — postmenopausal year / age

  // v2.2 — Periods restructure (women only)
  period_pain_severity: number | null;
  period_pain_impact: string;
  pmdd_signs: string;
  contraception_history: ContraceptionRowState[];
  pregnancies: PregnancyRowState[];
  repro_diagnoses: string[];
  perimenopause_inventory: string[];

  // v2.2 — Readiness
  recent_labs_done: string[];
  recent_labs_when: string;
  willing_to_share_labs: string;
  willing_to_test_further: string;
  readiness_confidence: number | null;

  // Anything else
  notes: string;

  // Consent (gate for submit — design intent)
  consent: boolean;
}

// ── v2.2 reference constants (imported verbatim from snapshots-v2.reference.jsx) ─

const MED_BUCKETS: Array<{ id: keyof FormState; emoji: string; name: string; hint: string }> = [
  { id: "glp1_medications", emoji: "💉", name: "GLP-1 weight-loss", hint: "Ozempic / Wegovy / Mounjaro / Tirzepatide / Saxenda / compounded" },
  { id: "acid_suppressants", emoji: "🩺", name: "Acid suppressants", hint: "Pantoprazole / Omeprazole / Esomeprazole / daily antacids" },
  { id: "nsaids_daily", emoji: "💊", name: "Daily NSAIDs", hint: "Ibuprofen / naproxen / diclofenac / dolo" },
  { id: "antibiotics_last_12mo", emoji: "🧫", name: "Antibiotics, last 12 mo", hint: "How many courses, what for" },
  { id: "hormonal_contraception_hrt", emoji: "🌸", name: "Hormonal contraception / HRT", hint: "Pill / IUD / patch / HRT / vaginal oestrogen / testosterone" },
  { id: "thyroid_medication", emoji: "🦋", name: "Thyroid medication", hint: "Levothyroxine / liothyronine / NDT / methimazole" },
  { id: "psych_medications", emoji: "🌧", name: "Antidepressants, anxiety, sleep aids", hint: "SSRIs / SNRIs / benzos / Z-drugs / daily melatonin" },
  { id: "biologics_immunosuppressants", emoji: "🛡", name: "Biologics or immunosuppressants", hint: "Humira / Enbrel / methotrexate — name + condition" },
  { id: "statins_bp_diabetes", emoji: "💉", name: "Statins / BP / diabetes meds", hint: "Statins, antihypertensives, metformin, sulphonylureas" },
];

const BRISTOL_TYPES = [
  { n: 1, label: "Separate hard lumps, like nuts" },
  { n: 2, label: "Sausage-shaped but lumpy" },
  { n: 3, label: "Sausage-shaped with cracks on the surface" },
  { n: 4, label: "Smooth, soft, sausage-shaped" },
  { n: 5, label: "Soft blobs with clear-cut edges" },
  { n: 6, label: "Fluffy pieces with ragged edges, mushy" },
  { n: 7, label: "Watery, no solid pieces" },
];

const BOWEL_PATTERN = [
  "straining",
  "sense of incomplete evacuation",
  "pain when passing",
  "blood occasionally",
  "mucus",
  "urgency",
  "alternating constipation and loose",
  "wakes you at night",
  "nothing notable",
];

const CONTRACEPTION_TYPES = [
  "combined pill",
  "progesterone-only pill",
  "hormonal IUD",
  "copper IUD",
  "implant",
  "depo",
  "patch",
  "vaginal ring",
  "barrier",
  "none",
];

const PREG_COMPLICATIONS = [
  "gestational diabetes",
  "pre-eclampsia",
  "gestational hypertension",
  "hyperemesis",
  "postpartum thyroiditis",
  "postpartum depression",
  "anaemia",
  "other",
];

const PREG_OUTCOMES = ["live birth", "miscarriage", "termination", "stillbirth"];
const BIRTH_TYPES = ["vaginal", "C-section", "forceps", "N/A"];

// ── Option lists (radio + chip) ─────────────────────────────────────────────

const WEIGHT_TREND_OPTIONS = [
  { value: "stable", label: "Stable" },
  { value: "gaining_slowly", label: "Gaining slowly" },
  { value: "losing_slowly", label: "Losing slowly" },
  { value: "fluctuating", label: "Fluctuating" },
  { value: "changed_sharply", label: "Recently changed sharply" },
];

const WORK_PATTERN_OPTIONS = [
  "desk-bound 8+ hrs",
  "on feet all day",
  "shift work",
  "nights",
  "works from home",
  "heavy physical",
  "high-stress role",
  "commutes 1hr+ each way",
  "travels for work weekly",
];

const FAMILY_SPECIFIC_CONDITIONS = [
  "early heart disease before 60",
  "stroke before 60",
  "blood clots / clotting disorder",
  "recurrent miscarriages (in mother / sister)",
  "breast cancer",
  "colon cancer",
  "prostate cancer",
  "ovarian cancer",
  "type 2 diabetes before 50",
  "autoimmune (any)",
  "Hashimoto's or other thyroid disease",
  "celiac",
  "ADHD / autism / learning differences",
  "dementia",
  "suicide or severe mental illness",
  "addiction",
  "joint hypermobility / Ehlers-Danlos",
  "mast cell disease / MCAS",
];

const COVID_HISTORY = [
  "never tested positive",
  "one mild infection",
  "multiple infections",
  "hospitalised",
  "long-COVID symptoms now",
  "long-COVID symptoms past, resolved",
];

const COVID_LONG_SYMPTOMS = [
  "fatigue",
  "brain fog",
  "breathlessness",
  "palpitations",
  "smell or taste changes",
  "new food sensitivities",
  "sleep changes",
  "new period changes",
  "new joint pain",
];

const COVID_VAX_HISTORY = ["not vaccinated", "1 dose", "2 doses", "1 booster", "2+ boosters", "unsure"];
const COVID_VAX_BRAND = ["Covishield (AstraZeneca)", "Covaxin", "Pfizer", "Moderna", "Sputnik", "Novavax", "other", "unsure"];
const COVID_VAX_REACTIONS = [
  "no reactions noticed",
  "sore arm only",
  "fatigue lasting over a week",
  "persistent fatigue since",
  "period changes",
  "heavy bleeding",
  "cycle disruption",
  "palpitations or chest tightness",
  "brain fog",
  "dizziness or POTS-like",
  "new neurological symptoms",
  "new joint pain",
  "autoimmune flare",
  "other",
];

const POSTPRANDIAL = [
  "sleepy after meals",
  "brain fog after meals",
  "energy crash",
  "hungry again within 2hrs",
  "great energy",
  "depends on the meal",
];
const COLD_HEAT_TOLERANCE = [
  { value: "always_cold", label: "Always cold" },
  { value: "always_hot", label: "Always hot" },
  { value: "normal", label: "Normal" },
  { value: "hot_flushes", label: "Hot flushes" },
  { value: "runs_hot_evenings", label: "Runs hot in evenings" },
];

const TIME_TO_FALL_ASLEEP = [
  { value: "under_15", label: "Under 15 min" },
  { value: "15_30", label: "15–30 min" },
  { value: "30_60", label: "30–60 min" },
  { value: "60_plus", label: "60+ min" },
];
const WAKE_TIME_PATTERN = [
  "sleep through",
  "wake around 3am consistently",
  "wake around 5am consistently",
  "wake multiple times",
  "wake unrefreshed",
  "wake to urinate",
];
const SNORE_OR_APNOEA = [
  { value: "no", label: "No" },
  { value: "sometimes", label: "Sometimes" },
  { value: "often", label: "Often" },
  { value: "diagnosed", label: "Diagnosed apnoea" },
  { value: "cpap", label: "Use CPAP" },
];
const RESTLESS_LEGS = [
  { value: "no", label: "No" },
  { value: "mild", label: "Mild" },
  { value: "disrupts", label: "Disrupts sleep" },
];
const SLEEP_TRACKER = [
  "Oura",
  "Ultrahuman",
  "Gabit",
  "Whoop",
  "Apple Watch",
  "Samsung Galaxy Ring",
  "Pixel Watch",
  "Fitbit",
  "Garmin",
  "RingConn",
  "Noise / boAt smart ring",
  "phone app",
  "none",
];
const CGM_OWNED = [
  { value: "current", label: "Yes — current" },
  { value: "past", label: "Yes — past" },
  { value: "no", label: "No" },
  { value: "interested", label: "Interested" },
];

const ENERGY_CRASHES = [
  "never",
  "after meals",
  "mid-afternoon",
  "after caffeine wears off",
  "before periods",
  "after exercise",
  "after sugar",
];
const CAFFEINE_DEPENDENCY = [
  { value: "none", label: "None" },
  { value: "fine_without", label: "Drink it but fine without" },
  { value: "need_it", label: "Need it to function" },
  { value: "headaches", label: "Headaches without it" },
];
const MORNING_STATE = [
  { value: "jump_out", label: "Jump out of bed" },
  { value: "after_coffee", label: "Fine after coffee" },
  { value: "sluggish", label: "Sluggish 1–2 hours" },
  { value: "hard_to_wake", label: "Hard to wake at all" },
];

const SUN_EXPOSURE = [
  { value: "under_15", label: "Under 15 min" },
  { value: "15_60", label: "15–60 min" },
  { value: "1_2", label: "1–2 hrs" },
  { value: "2_plus", label: "2+ hrs" },
  { value: "varies", label: "Varies a lot" },
];
const SUNSCREEN_USE = [
  { value: "daily_face", label: "Daily on face" },
  { value: "occasionally", label: "Occasionally" },
  { value: "never", label: "Never" },
  { value: "beach_only", label: "Only at the beach" },
];
const VIT_D_SUPPLEMENT = [
  { value: "daily", label: "Yes — daily" },
  { value: "sometimes", label: "Yes — sometimes" },
  { value: "no", label: "No" },
  { value: "not_sure", label: "Not sure" },
];
const BAREFOOT_OUTDOORS = [
  { value: "regularly", label: "Regularly" },
  { value: "occasionally", label: "Occasionally" },
  { value: "never", label: "Never" },
];

// Body systems
const HAIR_LOSS = [
  { value: "no_loss", label: "No loss" },
  { value: "diffuse_thinning", label: "Diffuse thinning all over" },
  { value: "widening_part", label: "Widening part" },
  { value: "receding", label: "Receding hairline" },
  { value: "patchy", label: "Patchy" },
  { value: "clumps_shower", label: "Clumps in shower" },
  { value: "stress_only", label: "Only with stress" },
];
const HAIR_TEXTURE = [
  { value: "no_change", label: "No change" },
  { value: "coarser", label: "Coarser" },
  { value: "finer", label: "Finer" },
  { value: "drier", label: "Drier" },
  { value: "oilier", label: "Oilier" },
  { value: "brittle", label: "More brittle" },
  { value: "grey_under_30", label: "Grey under 30" },
];
const HAIR_OTHER = [
  "itchy scalp",
  "dandruff",
  "oily roots",
  "dry ends",
  "facial hair in women (chin or lip)",
  "body hair thinning",
  "new facial hair where there wasn't",
];
const NAIL_SIGNS = [
  "vertical ridges",
  "white spots",
  "splitting",
  "slow growth",
  "fungal",
  "nail-biting",
  "spoon-shaped concave",
  "pale lunulae",
  "no concerns",
];
const ACNE_PATTERN = [
  "no acne",
  "chin or jawline",
  "forehead and T-zone",
  "back or chest",
  "cyclical with period",
  "cystic",
  "hyperpigmentation after spots heal",
];
const SKIN_SIGNS = [
  "rosacea",
  "flushes easily",
  "melasma or pregnancy mask",
  "skin tags",
  "keratosis pilaris on backs of arms",
  "easy bruising",
  "slow wound healing",
  "stretch marks (striae)",
  "itchy with no rash",
];
const HEADACHE_TYPE = [
  "tension band",
  "migraine with aura",
  "migraine without aura",
  "cluster",
  "sinus",
  "period-linked",
  "morning",
  "evening",
];
const PAIN_PATTERN = [
  "worse in morning",
  "worse in evening",
  "worse with movement",
  "worse at rest",
  "wakes me at night",
  "better with heat",
  "better with cold",
];
const PAIN_QUALITY = [
  "dull ache",
  "sharp",
  "burning",
  "throbbing",
  "pins and needles or tingling",
  "electric or shooting",
  "cramping",
  "stiffness",
];
const BELLY_FAT = [
  { value: "none", label: "No concerns" },
  { value: "new_belly", label: "New belly fat" },
  { value: "always_belly", label: "Always had belly fat" },
  { value: "pear", label: "Pear-shape (hips and thighs)" },
  { value: "face_changed", label: "Face has changed shape" },
];
const HISTAMINE = [
  "flushing with wine or fermented foods",
  "flushing in hot showers / hot weather",
  "hives or welts",
  "itchy with no rash",
  "fragrance-sensitive",
  "can't tolerate aged cheese or vinegar",
  "leftover meat / fish triggers symptoms",
  // v0.75.2 MCAS deepening — chips that catch MCAS-pattern clients
  // who don't self-identify with the histamine label.
  "food reactions shift week-to-week (sometimes fine, sometimes not)",
  "sudden brain fog within 30 min of eating",
  "unexplained palpitations come and go",
  "throat tightness or itching with certain foods",
  "react strongly to multiple medications + supplements",
  "diagnosed histamine intolerance or MCAS",
];
const CHEMICAL_SENSITIVITY = [
  "perfumes give headaches",
  "can't be near cleaning products",
  "strong hangovers",
  "sensitive to alcohol",
  "sensitive to medication side effects more than others",
  "metal allergies",
];
// v0.75.2 — Tier 1 screening chip option constants ─────────────────────────
const BEIGHTON_SELF = [
  "pinky finger bends back past 90°",
  "thumb touches inside of forearm",
  "elbow bends backwards past straight",
  "knee bends backwards past straight",
  "palms flat on floor with knees locked straight",
];
const BEIGHTON_SUPPLEMENTAL = [
  "I've been called 'double-jointed' or 'very flexible'",
  "I dislocate / subluxate joints sometimes",
  "I have stretchy or fragile skin",
  "I bruise easily / unexplained bruises",
];
const HR_DEVICES = [
  "Smartwatch (Apple Watch, Fitbit, Garmin, Whoop)",
  "Smart ring (Oura, Ultrahuman, Ringconn)",
  "Home blood-pressure monitor (most cuffs show HR)",
  "Fingertip pulse oximeter",
  "Chest strap (Polar, Wahoo)",
  "Phone app only (less accurate but I'll use one)",
  "None of the above",
];
const LEAN_TEST_SYMPTOMS = [
  "lightheaded / dizzy",
  "vision tunnelling or going dark",
  "heart racing or pounding",
  "brain fog / hard to think",
  "hot, flushed, sweaty",
  "cold, clammy",
  "nauseous",
  "had to sit down before 10 min",
  "felt completely fine",
];
const PEM_SCREEN = [
  "I crash for hours or days after exertion that used to feel normal",
  "Exercise that should help me leaves me wiped out for 24-48h",
  "Stress / emotional days knock me out the next day",
  "I have to ration my energy — pacing is the only thing that works",
  "I used to push through and can't any more",
];
const MOULD_EXPOSURE = [
  "current/past home with visible mould",
  "current/past home with a leak that wasn't fully dried in 48h",
  "musty / damp smell in any room I spend time in",
  "I feel worse on damp or humid days",
  "worked with paints / solvents / pesticides regularly",
  "dental amalgam removal in last 5 years",
];
const LARGE_FISH_FREQUENCY = [
  { value: "never", label: "Never / not applicable" },
  { value: "rarely", label: "Rarely (a few times a year)" },
  { value: "weekly", label: "Once a week or so" },
  { value: "multiple_weekly", label: "Multiple times a week" },
];

// v0.75.5 — Tier 2 screening chip option constants ─────────────────────────
// ACE-lite — sensitively framed; coach reads patterns, never asks for an
// explicit ACE score. The chips capture both *historical* adversity and
// *current* nervous-system patterns (hypervigilance, dissociation).
const ACE_SIGNALS = [
  "prolonged stress / instability / significant loss before age 18",
  "I startle easily or feel 'always on' / hypervigilant",
  "my symptoms began around a major life event (illness / death / divorce / accident)",
  "I can dissociate or 'check out' under stress",
  "I've felt this way most of my life — no clear before",
  "none of the above apply / I'd rather not say",
];
// STOP-BANG deepening — apnoea is radically underdiagnosed in women.
// snore_or_apnoea already captures the loudest signal; these add the
// rest of the STOP-BANG criteria.
const STOP_BANG_SIGNALS = [
  "I wake up gasping or choking",
  "morning headaches",
  "I need to nap by afternoon despite a full night's sleep",
  "thick neck or recessed jaw",
  "scalloped tongue (wavy edges where it touches teeth)",
  "BMI > 35",
  "treatment-resistant high blood pressure",
];
// Endometriosis — women only. Average diagnostic delay 7-10 years; coach
// can flag patterns from intake.
const ENDOMETRIOSIS_SIGNALS = [
  "period pain bad enough to miss work / school / plans (now or in the past)",
  "pain during or after sex",
  "pain emptying bladder or bowels around my period",
  "heavy periods or clots larger than a 50p / ₹20 coin",
  "family history of endometriosis / adenomyosis / fibroids",
  "diagnosed endometriosis / adenomyosis / fibroids",
];

const ORAL_SIGNS = [
  "bleeding gums",
  "receding gums",
  "recurrent mouth ulcers",
  "geographic tongue (map-like patches)",
  "white coating on tongue",
  "mouth breathing at night",
  "dry mouth",
  "TMJ pain",
  "frequent cavities",
  "sensitive teeth",
];

// Periods
const PERIOD_PAIN_IMPACT = [
  { value: "none", label: "Doesn't affect my day" },
  { value: "inconvenient", label: "Inconvenient" },
  { value: "miss_work", label: "I miss work or sleep" },
  { value: "debilitating", label: "Debilitating" },
];
const PMDD = [
  { value: "no", label: "No" },
  { value: "suspect", label: "Suspect" },
  { value: "diagnosed", label: "Diagnosed" },
];
const REPRO_DIAGNOSES = [
  "endometriosis suspected",
  "endometriosis diagnosed",
  "PCOS suspected",
  "PCOS diagnosed",
  "fibroids",
  "adenomyosis",
  "ovarian cysts",
  "IVF history",
  "IUI history",
  "clomid history",
];
const PERIMENOPAUSE_INVENTORY = [
  "hot flushes",
  "night sweats",
  "belly weight gain",
  "sleep changes",
  "mood crashes",
  "brain fog",
  "vaginal dryness",
  "hair changes",
  "cycles shortening",
  "cycles lengthening",
  "heavier bleeding",
  "lighter bleeding",
];

// Readiness
const RECENT_LABS = [
  "thyroid panel",
  "CBC",
  "lipid panel",
  "vitamin D",
  "B12",
  "iron",
  "HbA1c",
  "fasting insulin",
  "sex hormones",
  "cortisol",
  "inflammatory markers",
  "none of the above",
  "not sure",
];
const WILLING_SHARE_LABS = [
  { value: "yes", label: "Yes — happy to" },
  { value: "if_needed", label: "Yes — if needed" },
  { value: "prefer_not", label: "Would prefer not" },
  { value: "no_labs", label: "No labs to share" },
];
const WILLING_TEST_FURTHER = [
  { value: "yes", label: "Yes" },
  { value: "depends", label: "Depends on cost" },
  { value: "no", label: "No" },
  { value: "not_sure", label: "Not sure" },
];

const TIMELINE_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "symptom_onset", label: "Symptom started" },
  { value: "life_event", label: "Life event / stress" },
  { value: "treatment", label: "Treatment" },
  { value: "diagnosis", label: "Diagnosis" },
  { value: "stress", label: "Stress" },
  { value: "recovery", label: "Recovery" },
  { value: "surgery", label: "Surgery" },
  { value: "medication_change", label: "Medication change" },
];

const DIETARY_OPTIONS = [
  "Vegetarian",
  "Jain vegetarian",
  "Non-vegetarian",
  "Vegan",
  "Eggetarian",
  "Pescatarian",
  "Other",
];

const CYCLE_STATUS_OPTIONS = [
  { value: "menstruating", label: "Still menstruating" },
  { value: "perimenopausal", label: "Perimenopausal" },
  { value: "postmenopausal", label: "Postmenopausal" },
  { value: "not_applicable", label: "Not applicable" },
];

const CYCLE_REGULARITY_OPTIONS = [
  { value: "regular", label: "Regular" },
  { value: "irregular", label: "Irregular" },
  { value: "very_irregular", label: "Very irregular" },
];

const PREGNANCY_STATUS_OPTIONS = [
  { value: "not_pregnant", label: "Not pregnant" },
  { value: "trying_to_conceive", label: "Trying to conceive" },
  { value: "pregnant", label: "Currently pregnant" },
  { value: "lactating", label: "Currently breastfeeding" },
  { value: "postpartum", label: "Postpartum (last 12 mo)" },
];

// MED bucket keys — used for typed access
const MED_KEYS: Array<keyof FormState> = [
  "glp1_medications",
  "acid_suppressants",
  "nsaids_daily",
  "antibiotics_last_12mo",
  "hormonal_contraception_hrt",
  "thyroid_medication",
  "psych_medications",
  "biologics_immunosuppressants",
  "statins_bp_diabetes",
];

const EMPTY_MED_ENTRY: MedicationCategoryEntry = {
  name: "",
  dose: "",
  started: "",
  still_taking: null,
  side_effects: "",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}
function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  return [];
}
function asNumberArray(v: unknown): number[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "number" ? x : Number(x)))
      .filter((x) => Number.isFinite(x)) as number[];
  }
  return [];
}
function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function asMedEntries(v: unknown): MedicationCategoryEntry[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      name: asString(r.name),
      dose: asString(r.dose),
      started: asString(r.started),
      still_taking:
        r.still_taking === true ? true : r.still_taking === false ? false : null,
      side_effects: asString(r.side_effects),
    };
  });
}
function asContraceptionRows(v: unknown): ContraceptionRowState[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      type: asString(r.type),
      started_year: r.started_year == null ? "" : asString(r.started_year),
      stopped_year: r.stopped_year == null ? "" : asString(r.stopped_year),
      side_effects: asStringArray(r.side_effects),
    };
  });
}
function asPregnancyRows(v: unknown): PregnancyRowState[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      year: r.year == null ? "" : asString(r.year),
      outcome: asString(r.outcome),
      complications: asStringArray(r.complications),
      birth_type: asString(r.birth_type),
      breastfeeding_months:
        r.breastfeeding_months == null ? "" : asString(r.breastfeeding_months),
    };
  });
}

function mergeInitial(
  prefill: Record<string, unknown>,
  draft: Record<string, unknown>
): FormState {
  const get = (k: string) => (k in draft ? draft[k] : prefill[k]);
  const goals = asStringArray(get("goals"));
  const timeline = (draft.timeline_events ?? prefill.timeline_events) as unknown;
  const timelineRows: TimelineRow[] = Array.isArray(timeline)
    ? (timeline as unknown[]).map((row) => {
        const r = (row ?? {}) as Record<string, unknown>;
        return {
          year: asString(r.year),
          event: asString(r.event),
          category: asString(r.category) || "life_event",
        };
      })
    : [];
  if (timelineRows.length === 0) {
    timelineRows.push({ year: "", event: "", category: "life_event" });
  }
  const fp = (draft.five_pillars ?? prefill.five_pillars) as Record<string, unknown> | undefined;

  return {
    display_name: asString(get("display_name")),
    date_of_birth: asString(get("date_of_birth")),
    sex: asString(get("sex")),
    email: asString(get("email")),
    city: asString(get("city")),
    country: asString(get("country")) || "India",
    weight_highest_adult: get("weight_highest_adult") == null ? "" : asString(get("weight_highest_adult")),
    weight_lowest_adult: get("weight_lowest_adult") == null ? "" : asString(get("weight_lowest_adult")),
    weight_trend_current: asString(get("weight_trend_current")),
    weight_change_trigger: asString(get("weight_change_trigger")),
    work_pattern: asStringArray(get("work_pattern")),
    // v2.3 body comp — both unit options accepted; submit pipeline prefers metric
    height_cm: get("height_cm") == null ? "" : asString(get("height_cm")),
    height_ft: get("height_ft") == null ? "" : asString(get("height_ft")),
    height_in: get("height_in") == null ? "" : asString(get("height_in")),
    weight_now_kg: get("weight_now_kg") == null ? "" : asString(get("weight_now_kg")),
    weight_now_lb: get("weight_now_lb") == null ? "" : asString(get("weight_now_lb")),
    waist_cm: get("waist_cm") == null ? "" : asString(get("waist_cm")),
    waist_in: get("waist_in") == null ? "" : asString(get("waist_in")),
    hip_cm: get("hip_cm") == null ? "" : asString(get("hip_cm")),
    hip_in: get("hip_in") == null ? "" : asString(get("hip_in")),
    bp_systolic: get("bp_systolic") == null ? "" : asString(get("bp_systolic")),
    bp_diastolic: get("bp_diastolic") == null ? "" : asString(get("bp_diastolic")),
    why_here: asString(draft.why_here) || (goals[0] || ""),
    concern_1: asString(draft.concern_1) || (goals[1] || ""),
    concern_2: asString(draft.concern_2) || (goals[2] || ""),
    concern_3: asString(draft.concern_3) || (goals[3] || ""),
    active_conditions: asStringArray(get("active_conditions")),
    known_allergies: asStringArray(get("known_allergies")),
    current_medications: asStringArray(get("current_medications")),
    current_supplements: asStringArray(get("current_supplements")),
    family_history: asString(get("family_history")),
    family_specific_conditions: asStringArray(get("family_specific_conditions")),
    covid_history: asStringArray(get("covid_history")),
    covid_long_symptoms: asStringArray(get("covid_long_symptoms")),
    covid_vaccine_history: asStringArray(get("covid_vaccine_history")),
    covid_vaccine_brand: asStringArray(get("covid_vaccine_brand")),
    covid_vaccine_reactions: asStringArray(get("covid_vaccine_reactions")),
    covid_vaccine_reaction_detail: asString(get("covid_vaccine_reaction_detail")),
    glp1_medications: asMedEntries(get("glp1_medications")),
    acid_suppressants: asMedEntries(get("acid_suppressants")),
    nsaids_daily: asMedEntries(get("nsaids_daily")),
    antibiotics_last_12mo: asMedEntries(get("antibiotics_last_12mo")),
    hormonal_contraception_hrt: asMedEntries(get("hormonal_contraception_hrt")),
    thyroid_medication: asMedEntries(get("thyroid_medication")),
    psych_medications: asMedEntries(get("psych_medications")),
    biologics_immunosuppressants: asMedEntries(get("biologics_immunosuppressants")),
    statins_bp_diabetes: asMedEntries(get("statins_bp_diabetes")),
    timeline_events: timelineRows,
    digestion_notes: asString(get("digestion_notes")),
    sleep_notes: asString(get("sleep_notes")),
    energy_pattern: asString(get("energy_pattern")),
    menstrual_notes: asString(get("menstrual_notes")),
    stress_response: asString(get("stress_response")),
    fp_sleep_quality: asNumberOrNull(fp?.sleep_quality),
    fp_sleep_hours: asNumberOrNull(fp?.sleep_hours),
    fp_stress: asNumberOrNull(fp?.stress),
    fp_movement_days: asNumberOrNull(fp?.movement_days),
    fp_nutrition_quality: asNumberOrNull(fp?.nutrition_quality),
    fp_connection_quality: asNumberOrNull(fp?.connection_quality),
    fp_notes: asString(fp?.notes),
    time_to_fall_asleep: asString(get("time_to_fall_asleep")),
    wake_time_pattern: asStringArray(get("wake_time_pattern")),
    snore_or_apnoea: asString(get("snore_or_apnoea")),
    restless_legs: asString(get("restless_legs")),
    sleep_tracker_owned: asStringArray(get("sleep_tracker_owned")),
    cgm_owned: asString(get("cgm_owned")),
    energy_crashes: asStringArray(get("energy_crashes")),
    caffeine_dependency: asString(get("caffeine_dependency")),
    morning_state: asString(get("morning_state")),
    childhood_history: asString(get("childhood_history")),
    toxic_exposures: asString(get("toxic_exposures")),
    what_has_worked: asString(get("what_has_worked")),
    what_hasnt_worked: asString(get("what_hasnt_worked")),
    sun_exposure_daily: asString(get("sun_exposure_daily")),
    sunscreen_use: asString(get("sunscreen_use")),
    vit_d_supplement: asString(get("vit_d_supplement")),
    barefoot_outdoors: asString(get("barefoot_outdoors")),
    dietary_preference: asString(get("dietary_preference")),
    animal_derived_supplements_ok: asString(get("animal_derived_supplements_ok")),
    foods_to_avoid: asString(get("foods_to_avoid")),
    non_negotiables: asString(get("non_negotiables")),
    reported_triggers: asString(get("reported_triggers")),
    postprandial_pattern: asStringArray(get("postprandial_pattern")),
    cold_heat_tolerance: asString(get("cold_heat_tolerance")),
    bristol_stool_typical: asNumberArray(get("bristol_stool_typical")),
    bowel_frequency_per_day: asNumberOrNull(get("bowel_frequency_per_day")),
    bowel_pattern: asStringArray(get("bowel_pattern")),
    bowel_historical: asString(get("bowel_historical")),
    hair_loss_pattern: asString(get("hair_loss_pattern")),
    hair_texture_change: asString(get("hair_texture_change")),
    hair_other: asStringArray(get("hair_other")),
    nail_signs: asStringArray(get("nail_signs")),
    acne_pattern: asStringArray(get("acne_pattern")),
    skin_signs: asStringArray(get("skin_signs")),
    pain_locations: asStringArray(get("pain_locations")),
    headache_type: asStringArray(get("headache_type")),
    pain_pattern: asStringArray(get("pain_pattern")),
    pain_quality: asStringArray(get("pain_quality")),
    belly_fat_pattern: asString(get("belly_fat_pattern")),
    histamine_signals: asStringArray(get("histamine_signals")),
    chemical_sensitivity: asStringArray(get("chemical_sensitivity")),
    oral_signs: asStringArray(get("oral_signs")),
    // v0.75.2 — Tier 1 screening fields
    beighton_self_score: asStringArray(get("beighton_self_score")),
    beighton_supplemental: asStringArray(get("beighton_supplemental")),
    hr_devices_owned: asStringArray(get("hr_devices_owned")),
    lean_test_supine_hr: asString(get("lean_test_supine_hr")),
    lean_test_standing_hr: asString(get("lean_test_standing_hr")),
    lean_test_symptoms: asStringArray(get("lean_test_symptoms")),
    pem_screen: asStringArray(get("pem_screen")),
    mould_exposure: asStringArray(get("mould_exposure")),
    large_fish_frequency: asString(get("large_fish_frequency")),
    // v0.75.5 — Tier 2 screening fields
    ace_signals: asStringArray(get("ace_signals")),
    stop_bang_signals: asStringArray(get("stop_bang_signals")),
    endometriosis_signals: asStringArray(get("endometriosis_signals")),
    cycle_status: asString(get("cycle_status")),
    last_menstrual_period: asString(get("last_menstrual_period")),
    cycle_length_days: asString(get("cycle_length_days")),
    menopause_started: asString(get("menopause_started")),
    cycle_regularity: asString(get("cycle_regularity")),
    pregnancy_status: asString(get("pregnancy_status")),
    period_pain_severity: asNumberOrNull(get("period_pain_severity")),
    period_pain_impact: asString(get("period_pain_impact")),
    pmdd_signs: asString(get("pmdd_signs")),
    contraception_history: asContraceptionRows(get("contraception_history")),
    pregnancies: asPregnancyRows(get("pregnancies")),
    repro_diagnoses: asStringArray(get("repro_diagnoses")),
    perimenopause_inventory: asStringArray(get("perimenopause_inventory")),
    recent_labs_done: asStringArray(get("recent_labs_done")),
    recent_labs_when: asString(get("recent_labs_when")),
    willing_to_share_labs: asString(get("willing_to_share_labs")),
    willing_to_test_further: asString(get("willing_to_test_further")),
    readiness_confidence: asNumberOrNull(get("readiness_confidence")),
    notes: asString(get("notes")),
    consent: false,
  };
}

function buildPayload(s: FormState): Record<string, unknown> {
  const goals = [s.why_here, s.concern_1, s.concern_2, s.concern_3]
    .map((x) => x.trim())
    .filter(Boolean);
  const timeline_events = s.timeline_events
    .map((r) => ({
      year: r.year ? Number(r.year) || r.year : null,
      event: r.event.trim(),
      category: r.category || "life_event",
    }))
    .filter((r) => r.event);
  // Field names MUST match the Python FivePillarsAssessment model (see
  // fmdb/plan/models.py line 195+). Earlier this form wrote `stress` and
  // `movement_days` which the Pydantic model rejected → every assess
  // call for clients who filled the intake threw and the Plan tab on
  // those clients flashed "Failed to fetch".
  const fp_values = {
    sleep_quality: s.fp_sleep_quality,
    sleep_hours: s.fp_sleep_hours,
    stress_level: s.fp_stress,
    movement_days_per_week: s.fp_movement_days,
    nutrition_quality: s.fp_nutrition_quality,
    connection_quality: s.fp_connection_quality,
    notes: s.fp_notes.trim() || null,
  };
  const anyFp = Object.entries(fp_values).some(
    ([k, v]) => k !== "notes" && v !== null && v !== undefined
  );

  // Med entries: strip rows where everything is empty
  const cleanMeds = (rows: MedicationCategoryEntry[]) =>
    rows
      .map((r) => ({
        name: r.name.trim(),
        dose: r.dose.trim(),
        started: r.started.trim(),
        still_taking: r.still_taking,
        side_effects: r.side_effects.trim(),
      }))
      .filter(
        (r) => r.name || r.dose || r.started || r.side_effects || r.still_taking !== null
      );

  // Contraception rows — keep if any field set
  const contraception = s.contraception_history
    .map((r) => ({
      type: r.type.trim(),
      started_year: r.started_year ? Number(r.started_year) || null : null,
      stopped_year: r.stopped_year ? Number(r.stopped_year) || null : null,
      side_effects: r.side_effects,
    }))
    .filter((r) => r.type || r.started_year || r.stopped_year || r.side_effects.length);

  // Pregnancy rows — keep if any field set
  const pregnancies = s.pregnancies
    .map((r) => ({
      year: r.year ? Number(r.year) || null : null,
      outcome: r.outcome.trim(),
      complications: r.complications,
      birth_type: r.birth_type.trim(),
      breastfeeding_months: r.breastfeeding_months
        ? Number(r.breastfeeding_months) || null
        : null,
    }))
    .filter(
      (r) =>
        r.year ||
        r.outcome ||
        r.birth_type ||
        r.breastfeeding_months ||
        r.complications.length
    );

  return {
    display_name: s.display_name,
    date_of_birth: s.date_of_birth,
    sex: s.sex,
    email: s.email,
    city: s.city,
    country: s.country,
    active_conditions: s.active_conditions,
    known_allergies: s.known_allergies,
    current_medications: s.current_medications,
    current_supplements: s.current_supplements,
    goals,
    family_history: s.family_history,
    timeline_events,
    digestion_notes: s.digestion_notes,
    sleep_notes: s.sleep_notes,
    energy_pattern: s.energy_pattern,
    menstrual_notes: s.menstrual_notes,
    stress_response: s.stress_response,
    childhood_history: s.childhood_history,
    toxic_exposures: s.toxic_exposures,
    what_has_worked: s.what_has_worked,
    what_hasnt_worked: s.what_hasnt_worked,
    dietary_preference: s.dietary_preference,
    animal_derived_supplements_ok: s.animal_derived_supplements_ok,
    foods_to_avoid: s.foods_to_avoid,
    non_negotiables: s.non_negotiables,
    reported_triggers: s.reported_triggers,
    cycle_status: s.cycle_status,
    last_menstrual_period: s.last_menstrual_period,
    cycle_length_days: s.cycle_length_days,
    menopause_started: s.menopause_started,
    cycle_regularity: s.cycle_regularity,
    pregnancy_status: s.pregnancy_status,
    notes: s.notes,
    five_pillars: anyFp ? fp_values : null,

    // v2.2 additions
    weight_highest_adult: s.weight_highest_adult
      ? Number(s.weight_highest_adult) || null
      : null,
    weight_lowest_adult: s.weight_lowest_adult
      ? Number(s.weight_lowest_adult) || null
      : null,
    weight_trend_current: s.weight_trend_current,
    weight_change_trigger: s.weight_change_trigger,
    work_pattern: s.work_pattern,
    // v2.3 body composition today — submitted as-typed (numeric or null).
    // Client picks either metric or imperial per row; both stored as-given.
    height_cm: s.height_cm ? Number(s.height_cm) || null : null,
    height_ft: s.height_ft ? Number(s.height_ft) || null : null,
    height_in: s.height_in ? Number(s.height_in) || null : null,
    weight_now_kg: s.weight_now_kg ? Number(s.weight_now_kg) || null : null,
    weight_now_lb: s.weight_now_lb ? Number(s.weight_now_lb) || null : null,
    waist_cm: s.waist_cm ? Number(s.waist_cm) || null : null,
    waist_in: s.waist_in ? Number(s.waist_in) || null : null,
    hip_cm: s.hip_cm ? Number(s.hip_cm) || null : null,
    hip_in: s.hip_in ? Number(s.hip_in) || null : null,
    bp_systolic: s.bp_systolic ? Number(s.bp_systolic) || null : null,
    bp_diastolic: s.bp_diastolic ? Number(s.bp_diastolic) || null : null,
    family_specific_conditions: s.family_specific_conditions,
    covid_history: s.covid_history,
    covid_long_symptoms: s.covid_long_symptoms,
    covid_vaccine_history: s.covid_vaccine_history,
    covid_vaccine_brand: s.covid_vaccine_brand,
    covid_vaccine_reactions: s.covid_vaccine_reactions,
    covid_vaccine_reaction_detail: s.covid_vaccine_reaction_detail,
    glp1_medications: cleanMeds(s.glp1_medications),
    acid_suppressants: cleanMeds(s.acid_suppressants),
    nsaids_daily: cleanMeds(s.nsaids_daily),
    antibiotics_last_12mo: cleanMeds(s.antibiotics_last_12mo),
    hormonal_contraception_hrt: cleanMeds(s.hormonal_contraception_hrt),
    thyroid_medication: cleanMeds(s.thyroid_medication),
    psych_medications: cleanMeds(s.psych_medications),
    biologics_immunosuppressants: cleanMeds(s.biologics_immunosuppressants),
    statins_bp_diabetes: cleanMeds(s.statins_bp_diabetes),
    postprandial_pattern: s.postprandial_pattern,
    cold_heat_tolerance: s.cold_heat_tolerance,
    time_to_fall_asleep: s.time_to_fall_asleep,
    wake_time_pattern: s.wake_time_pattern,
    snore_or_apnoea: s.snore_or_apnoea,
    restless_legs: s.restless_legs,
    sleep_tracker_owned: s.sleep_tracker_owned,
    cgm_owned: s.cgm_owned,
    energy_crashes: s.energy_crashes,
    caffeine_dependency: s.caffeine_dependency,
    morning_state: s.morning_state,
    bristol_stool_typical: s.bristol_stool_typical,
    bowel_frequency_per_day: s.bowel_frequency_per_day,
    bowel_pattern: s.bowel_pattern,
    bowel_historical: s.bowel_historical,
    hair_loss_pattern: s.hair_loss_pattern,
    hair_texture_change: s.hair_texture_change,
    hair_other: s.hair_other,
    nail_signs: s.nail_signs,
    acne_pattern: s.acne_pattern,
    skin_signs: s.skin_signs,
    pain_locations: s.pain_locations,
    headache_type: s.headache_type,
    pain_pattern: s.pain_pattern,
    pain_quality: s.pain_quality,
    belly_fat_pattern: s.belly_fat_pattern,
    histamine_signals: s.histamine_signals,
    chemical_sensitivity: s.chemical_sensitivity,
    oral_signs: s.oral_signs,
    // v0.75.2 — Tier 1 screening fields
    beighton_self_score: s.beighton_self_score,
    beighton_supplemental: s.beighton_supplemental,
    hr_devices_owned: s.hr_devices_owned,
    lean_test_supine_hr: s.lean_test_supine_hr,
    lean_test_standing_hr: s.lean_test_standing_hr,
    lean_test_symptoms: s.lean_test_symptoms,
    pem_screen: s.pem_screen,
    mould_exposure: s.mould_exposure,
    large_fish_frequency: s.large_fish_frequency,
    // v0.75.5 — Tier 2 screening fields
    ace_signals: s.ace_signals,
    stop_bang_signals: s.stop_bang_signals,
    endometriosis_signals: s.endometriosis_signals,
    period_pain_severity: s.period_pain_severity,
    period_pain_impact: s.period_pain_impact,
    pmdd_signs: s.pmdd_signs,
    contraception_history: contraception,
    pregnancies: pregnancies,
    repro_diagnoses: s.repro_diagnoses,
    perimenopause_inventory: s.perimenopause_inventory,
    sun_exposure_daily: s.sun_exposure_daily,
    sunscreen_use: s.sunscreen_use,
    vit_d_supplement: s.vit_d_supplement,
    barefoot_outdoors: s.barefoot_outdoors,
    recent_labs_done: s.recent_labs_done,
    recent_labs_when: s.recent_labs_when,
    willing_to_share_labs: s.willing_to_share_labs,
    willing_to_test_further: s.willing_to_test_further,
    readiness_confidence: s.readiness_confidence,
  };
}

// ── Sub-components ──────────────────────────────────────────────────────────

function FormSection({
  number,
  totalSections,
  eyebrow,
  title,
  sub,
  sectionRef,
  soft,
  children,
}: {
  number: number;
  totalSections: number;
  eyebrow?: string;
  title: string;
  sub?: string;
  sectionRef: (el: HTMLElement | null) => void;
  soft?: boolean;
  children: React.ReactNode;
}) {
  void totalSections;
  return (
    <section
      ref={sectionRef}
      data-section={number}
      className={"fm-section" + (soft ? " fm-section--soft" : "")}
    >
      <div className="fm-section__eyebrow">
        <span className="pulse" aria-hidden="true" />
        <span>{eyebrow || `Section ${String(number).padStart(2, "0")}`}</span>
      </div>
      <h2 className="fm-section__title">{title}</h2>
      {sub ? <p className="fm-section__sub">{sub}</p> : null}
      {children}
    </section>
  );
}

function FG({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fm-fg">
      <label className="fm-fg__label">
        {label}
        {optional ? <span className="fm-fg__optional">{optional}</span> : null}
      </label>
      {hint ? <span className="fm-fg__hint">{hint}</span> : null}
      {children}
    </div>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const filled = typeof props.value === "string" && props.value.length > 0;
  return (
    <input
      {...props}
      className={"fm-input" + (filled ? " fm-input--filled" : "") + (props.className ? ` ${props.className}` : "")}
    />
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const filled = typeof props.value === "string" && props.value.length > 0;
  return (
    <textarea
      {...props}
      className={"fm-textarea" + (filled ? " fm-textarea--filled" : "") + (props.className ? ` ${props.className}` : "")}
    />
  );
}

function RadiosRow<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T | "";
  options: Array<{ value: T; label: string; sub?: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="fm-radios fm-radios--row">
      {options.map((opt) => {
        const on = value === opt.value;
        return (
          <label key={opt.value} className={"fm-radio" + (on ? " fm-radio--on" : "")}>
            <input
              type="radio"
              name={name}
              checked={on}
              onChange={() => onChange(opt.value)}
            />
            <span className="fm-radio__label">{opt.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function RadiosColumn<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T | "";
  options: Array<{ value: T; label: string; sub?: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="fm-radios">
      {options.map((opt) => {
        const on = value === opt.value;
        return (
          <label key={opt.value} className={"fm-radio" + (on ? " fm-radio--on" : "")}>
            <input
              type="radio"
              name={name}
              checked={on}
              onChange={() => onChange(opt.value)}
            />
            <span className="fm-radio__dot" aria-hidden="true" />
            <span className="fm-radio__label">
              {opt.label}
              {opt.sub ? <span className="fm-radio__sub">{opt.sub}</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function ChipInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    if (value.map((v) => v.toLowerCase()).includes(t.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, t]);
    setDraft("");
  };
  return (
    <div>
      <div className="fm-chips" style={{ marginBottom: value.length ? 12 : 0 }}>
        {value.map((chip, i) => (
          <button
            type="button"
            key={`${chip}-${i}`}
            className="fm-chip fm-chip--on"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            aria-label={`Remove ${chip}`}
          >
            {chip}
            <span className="fm-chip__x" aria-hidden="true">×</span>
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder || "Type and press Enter"}
          className={"fm-input" + (draft ? " fm-input--filled" : "")}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          onClick={add}
          className="fm-chip fm-chip--add"
          style={{ flex: "0 0 auto" }}
        >
          + add
        </button>
      </div>
    </div>
  );
}

// Multi-select chip group from a fixed option list (no freeform).
function ChipMulti({
  value,
  options,
  onChange,
  xs,
}: {
  value: string[];
  options: string[];
  onChange: (next: string[]) => void;
  xs?: boolean;
}) {
  const toggle = (opt: string) => {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt));
    else onChange([...value, opt]);
  };
  return (
    <div className="fm-chips">
      {options.map((opt) => {
        const on = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            className={"fm-chip" + (xs ? " fm-chip--xs" : "") + (on ? " fm-chip--on" : "")}
            aria-pressed={on}
            onClick={() => toggle(opt)}
          >
            {opt}
            {on ? <span className="fm-chip__x" aria-hidden="true">×</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function RatingDots({
  value,
  onChange,
  max = 5,
  labelLow,
  labelHigh,
  startFrom = 1,
}: {
  value: number | null;
  onChange: (n: number | null) => void;
  max?: number;
  labelLow?: string;
  labelHigh?: string;
  startFrom?: 0 | 1;
}) {
  const values: number[] = [];
  for (let i = startFrom; i <= max; i++) values.push(i);
  return (
    <div>
      <div className="fm-rating">
        <div className="fm-rating__opts">
          {values.map((n) => {
            const active = value === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => onChange(active ? null : n)}
                className={"fm-rating__btn" + (active ? " fm-rating__btn--on" : "")}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>
      {labelLow || labelHigh ? (
        <div
          style={{
            marginTop: 6,
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--fg-3)",
            letterSpacing: "0.02em",
          }}
        >
          <span>{labelLow}</span>
          <span>{labelHigh}</span>
        </div>
      ) : null}
    </div>
  );
}

function DayChips({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (n: number | null) => void;
}) {
  return (
    <div className="fm-days">
      {Array.from({ length: 8 }, (_, i) => i).map((n) => {
        const on = value === n;
        return (
          <button
            key={n}
            type="button"
            className={"fm-day" + (on ? " fm-day--on" : "")}
            onClick={() => onChange(on ? null : n)}
            aria-pressed={on}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

// ── v2.2 helpers: Stepper, BristolStoolPicker, GradedSlider, MedicationStack ─

function Stepper({
  value,
  min = 0,
  max = 10,
  onChange,
}: {
  value: number | null;
  min?: number;
  max?: number;
  onChange: (v: number | null) => void;
}) {
  const v = value ?? min;
  const decr = () => onChange(Math.max(min, v - 1));
  const incr = () => onChange(Math.min(max, v + 1));
  return (
    <div className="fm-stepper" role="group">
      <button
        type="button"
        className="fm-stepper__btn"
        onClick={decr}
        disabled={value !== null && v <= min}
        aria-label="Decrease"
      >
        −
      </button>
      <span className="fm-stepper__val">{value === null ? "—" : v}</span>
      <button
        type="button"
        className="fm-stepper__btn"
        onClick={incr}
        disabled={v >= max}
        aria-label="Increase"
      >
        +
      </button>
    </div>
  );
}

function BristolStoolPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  const toggle = (n: number) => {
    if (value.includes(n)) onChange(value.filter((x) => x !== n));
    else onChange([...value, n]);
  };
  return (
    <div
      className="fm-stool-list"
      role="group"
      aria-label="Bristol stool types — tick every type you have seen this week"
    >
      {BRISTOL_TYPES.map((t) => {
        const on = value.includes(t.n);
        return (
          <button
            key={t.n}
            type="button"
            className={"fm-stool" + (on ? " fm-stool--on" : "")}
            aria-pressed={on}
            onClick={() => toggle(t.n)}
          >
            <span className="fm-stool__icon" aria-hidden="true">
              <BristolStoolIcon type={t.n as 1 | 2 | 3 | 4 | 5 | 6 | 7} />
            </span>
            <span className="fm-stool__body">
              <span className="fm-stool__name">Type {t.n}</span>
              <span className="fm-stool__desc">{t.label}</span>
            </span>
            <span className="fm-stool__check" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

function GradedSlider({
  value,
  onChange,
  min = 1,
  max = 10,
  caption,
}: {
  value: number | null;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  caption?: (v: number) => string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const v = value ?? Math.round((min + max) / 2);
  const pct = ((v - min) / (max - min)) * 100;
  const setFromX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    onChange(Math.round(ratio * (max - min)) + min);
  };
  const scaleNums: number[] = [];
  for (let i = min; i <= max; i++) scaleNums.push(i);
  return (
    <div className="fm-slider fm-slider--graded" style={{ marginTop: 14 }}>
      <div
        className="fm-slider__track"
        ref={trackRef}
        role="slider"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={v}
        tabIndex={0}
        onPointerDown={(e) => {
          setFromX(e.clientX);
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) setFromX(e.clientX);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onChange(Math.max(min, v - 1));
          if (e.key === "ArrowRight") onChange(Math.min(max, v + 1));
        }}
        style={{ touchAction: "none", cursor: "pointer" }}
      >
        <div className="fm-slider__rail" />
        <div className="fm-slider__fill" style={{ width: pct + "%" }} />
        <div className="fm-slider__thumb" style={{ left: pct + "%" }} />
      </div>
      <div className="fm-slider__scale">
        {scaleNums.map((n) => <span key={n}>{n}</span>)}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="fm-slider__value">{v}</span>
        {caption ? <span className="fm-slider__caption">{caption(v)}</span> : null}
      </div>
    </div>
  );
}

function MedMiniCardForm({
  bucket,
  data,
  onChange,
  onRemove,
}: {
  bucket: { id: keyof FormState; emoji: string; name: string; hint: string };
  data: MedicationCategoryEntry;
  onChange: (patch: Partial<MedicationCategoryEntry>) => void;
  onRemove: () => void;
}) {
  const stillOpts: Array<{ k: "yes" | "no" | "onoff"; label: string; mapTo: boolean | null }> = [
    { k: "yes", label: "still on it", mapTo: true },
    { k: "no", label: "stopped", mapTo: false },
    { k: "onoff", label: "on and off", mapTo: null },
  ];
  // Map still_taking back to chip key
  const stillKey: "yes" | "no" | "onoff" | "" =
    data.still_taking === true
      ? "yes"
      : data.still_taking === false
        ? "no"
        : data.started || data.name || data.dose || data.side_effects
          ? "onoff"
          : "";
  return (
    <div className="fm-medcard">
      <div className="fm-medcard__head">
        <div className="fm-medcard__title">
          <span className="fm-medcard__emoji" aria-hidden="true">{bucket.emoji}</span>
          <span>{bucket.name}</span>
        </div>
        <button
          type="button"
          className="fm-medcard__close"
          onClick={onRemove}
          aria-label={`Remove ${bucket.name}`}
        >
          remove
        </button>
      </div>

      <div className="fm-medcard__grid">
        <div className="fm-medcard__full">
          <span className="fm-medcard__minilabel">Which one</span>
          <input
            className={"fm-input" + (data.name ? " fm-input--filled" : "")}
            value={data.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={bucket.hint}
          />
        </div>
        <div>
          <span className="fm-medcard__minilabel">Dose</span>
          <input
            className={"fm-input" + (data.dose ? " fm-input--filled" : "")}
            value={data.dose}
            onChange={(e) => onChange({ dose: e.target.value })}
            placeholder="e.g. 40mg daily"
          />
        </div>
        <div>
          <span className="fm-medcard__minilabel">Started when</span>
          <input
            className={"fm-input" + (data.started ? " fm-input--filled" : "")}
            value={data.started}
            onChange={(e) => onChange({ started: e.target.value })}
            placeholder="year or rough date"
          />
        </div>
        <div className="fm-medcard__full">
          <span className="fm-medcard__minilabel">Still on it?</span>
          <div className="fm-medcard__still">
            {stillOpts.map((opt) => (
              <button
                key={opt.k}
                type="button"
                className={
                  "fm-chip fm-chip--xs" + (stillKey === opt.k ? " fm-chip--on" : "")
                }
                onClick={() => onChange({ still_taking: opt.mapTo })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="fm-medcard__full">
          <span className="fm-medcard__minilabel">Side effects, if any</span>
          <input
            className={"fm-input" + (data.side_effects ? " fm-input--filled" : "")}
            value={data.side_effects}
            onChange={(e) => onChange({ side_effects: e.target.value })}
            placeholder="e.g. reflux returns when I stop"
          />
        </div>
      </div>
    </div>
  );
}

// ── Main form ───────────────────────────────────────────────────────────────

export function IntakeForm({
  token,
  clientId,
  displayName,
  prefill,
  draft,
  previouslySubmitted = false,
}: {
  token: string;
  clientId: string;
  displayName: string;
  prefill: Record<string, unknown>;
  draft: Record<string, unknown>;
  /**
   * v0.75.4 — true if the client has already submitted the form at
   * least once (typically the pre-discovery stage; coach has since
   * unlocked the full intake). Drives the welcome-back screen so
   * returning clients don't see "Begin" as if starting from scratch.
   */
  previouslySubmitted?: boolean;
}) {
  void clientId;
  const initial = useMemo(() => mergeInitial(prefill, draft), [prefill, draft]);
  const [state, setState] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hasBegun, setHasBegun] = useState<boolean>(() => {
    return Boolean(
      initial.display_name ||
        initial.date_of_birth ||
        initial.why_here ||
        initial.timeline_events.some((t) => t.event)
    );
  });

  const mobileNumber = asString(prefill.mobile_number);
  const isFemale = state.sex === "F" || state.sex === "f";

  // Section count is variable:
  // 1 About you · 2 Concerns · 3 Diagnoses/meds/allergies/COVID · 4 Medications layered
  // 5 Timeline · 6 Day-to-day · 7 Five pillars · 8 Past & environment · 9 Diet
  // 10 Body systems · [11 Cycle & hormones (women only)] · 12 Readiness · 13 Anything else · 14 Consent
  // v0.75.2 — totalSections bumped by 1 for the new "Movement, joints,
  // standing" section between Body and Cycle.
  const totalSections = isFemale ? 15 : 14;

  const sectionRefs = useRef<Record<number, HTMLElement | null>>({});
  const setSectionRef = (n: number) => (el: HTMLElement | null) => {
    sectionRefs.current[n] = el;
  };

  const [currentSection, setCurrentSection] = useState(1);

  useEffect(() => {
    if (!hasBegun || submitted) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        visible.sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0].target as HTMLElement;
        const n = Number(top.dataset.section);
        if (Number.isFinite(n) && n > 0) setCurrentSection(n);
      },
      { rootMargin: "-40% 0px -40% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    Object.values(sectionRefs.current).forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [hasBegun, submitted, totalSections, isFemale]);

  // Saved-sections heuristic — flexible: any "primary" field filled marks the section saved
  const savedSections = useMemo<number[]>(() => {
    const out: number[] = [];
    if (state.display_name || state.date_of_birth || state.sex || state.work_pattern.length)
      out.push(1);
    if (state.why_here || state.concern_1 || state.concern_2 || state.concern_3) out.push(2);
    if (
      state.active_conditions.length ||
      state.known_allergies.length ||
      state.current_medications.length ||
      state.current_supplements.length ||
      state.family_history ||
      state.family_specific_conditions.length ||
      state.covid_history.length ||
      state.covid_vaccine_history.length
    )
      out.push(3);
    const anyMeds = MED_KEYS.some((k) => (state[k] as MedicationCategoryEntry[]).length > 0);
    if (anyMeds) out.push(4);
    if (state.timeline_events.some((t) => t.event)) out.push(5);
    if (
      state.digestion_notes ||
      state.sleep_notes ||
      state.energy_pattern ||
      state.menstrual_notes ||
      state.stress_response
    )
      out.push(6);
    if (
      state.fp_sleep_quality !== null ||
      state.fp_sleep_hours !== null ||
      state.fp_stress !== null ||
      state.fp_movement_days !== null ||
      state.fp_nutrition_quality !== null ||
      state.fp_connection_quality !== null ||
      state.fp_notes ||
      state.time_to_fall_asleep ||
      state.wake_time_pattern.length ||
      state.snore_or_apnoea ||
      state.energy_crashes.length ||
      state.caffeine_dependency ||
      state.morning_state
    )
      out.push(7);
    if (
      state.childhood_history ||
      state.toxic_exposures ||
      state.what_has_worked ||
      state.what_hasnt_worked ||
      state.sun_exposure_daily ||
      state.sunscreen_use ||
      state.vit_d_supplement ||
      state.barefoot_outdoors
    )
      out.push(8);
    if (
      state.dietary_preference ||
      state.foods_to_avoid ||
      state.non_negotiables ||
      state.reported_triggers ||
      state.postprandial_pattern.length ||
      state.cold_heat_tolerance
    )
      out.push(9);
    if (
      state.bristol_stool_typical.length ||
      state.bowel_pattern.length ||
      state.hair_other.length ||
      state.nail_signs.length ||
      state.acne_pattern.length ||
      state.skin_signs.length ||
      state.pain_locations.length ||
      state.headache_type.length ||
      state.pain_pattern.length ||
      state.pain_quality.length ||
      state.histamine_signals.length ||
      state.chemical_sensitivity.length ||
      state.oral_signs.length ||
      state.hair_loss_pattern ||
      state.belly_fat_pattern
    )
      out.push(10);
    if (isFemale) {
      if (
        state.cycle_status ||
        state.last_menstrual_period ||
        state.cycle_length_days ||
        state.cycle_regularity ||
        state.pregnancy_status ||
        state.period_pain_severity !== null ||
        state.contraception_history.length ||
        state.pregnancies.length ||
        state.repro_diagnoses.length ||
        state.perimenopause_inventory.length
      )
        out.push(11);
      if (
        state.recent_labs_done.length ||
        state.willing_to_share_labs ||
        state.willing_to_test_further ||
        state.readiness_confidence !== null
      )
        out.push(12);
      if (state.notes) out.push(13);
      if (state.consent) out.push(14);
    } else {
      if (
        state.recent_labs_done.length ||
        state.willing_to_share_labs ||
        state.willing_to_test_further ||
        state.readiness_confidence !== null
      )
        out.push(11);
      if (state.notes) out.push(12);
      if (state.consent) out.push(13);
    }
    return out;
  }, [state, isFemale]);

  const stateRef = useRef(state);
  stateRef.current = state;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistDraft = useCallback(async () => {
    setSaving(true);
    try {
      const draftBody = buildPayload(stateRef.current);
      const res = await saveIntakeDraft(token, draftBody);
      if (res.ok) {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        setLastSavedAt(`${hh}:${mm}`);
      }
    } catch {
      // swallow
    } finally {
      setSaving(false);
    }
  }, [token]);

  useEffect(() => {
    if (submitted) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persistDraft();
    }, 5000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, persistDraft, submitted]);

  const handleBlur = useCallback(() => {
    if (submitted) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    void persistDraft();
  }, [persistDraft, submitted]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  const updateRow = (i: number, patch: Partial<TimelineRow>) =>
    setState((s) => ({
      ...s,
      timeline_events: s.timeline_events.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    }));
  const addRow = () =>
    setState((s) => ({
      ...s,
      timeline_events: [...s.timeline_events, { year: "", event: "", category: "life_event" }],
    }));
  const removeRow = (i: number) =>
    setState((s) => ({
      ...s,
      timeline_events: s.timeline_events.filter((_, j) => j !== i),
    }));

  // Medication helpers
  const medList = (key: keyof FormState) => state[key] as MedicationCategoryEntry[];
  const isMedActive = (key: keyof FormState) => medList(key).length > 0;
  const toggleMedBucket = (key: keyof FormState) => {
    setState((s) => {
      const list = s[key] as MedicationCategoryEntry[];
      if (list.length > 0) {
        // toggle off — clear all entries for this bucket
        return { ...s, [key]: [] } as FormState;
      }
      return { ...s, [key]: [{ ...EMPTY_MED_ENTRY }] } as FormState;
    });
  };
  const updateMedEntry = (
    key: keyof FormState,
    idx: number,
    patch: Partial<MedicationCategoryEntry>
  ) => {
    setState((s) => {
      const list = (s[key] as MedicationCategoryEntry[]).map((row, j) =>
        j === idx ? { ...row, ...patch } : row
      );
      return { ...s, [key]: list } as FormState;
    });
  };
  const removeMedEntry = (key: keyof FormState, idx: number) => {
    setState((s) => {
      const list = (s[key] as MedicationCategoryEntry[]).filter((_, j) => j !== idx);
      return { ...s, [key]: list } as FormState;
    });
  };

  // Contraception repeater helpers
  const addContraception = () =>
    setState((s) => ({
      ...s,
      contraception_history: [
        ...s.contraception_history,
        { type: "", started_year: "", stopped_year: "", side_effects: [] },
      ],
    }));
  const updateContraception = (i: number, patch: Partial<ContraceptionRowState>) =>
    setState((s) => ({
      ...s,
      contraception_history: s.contraception_history.map((r, j) =>
        j === i ? { ...r, ...patch } : r
      ),
    }));
  const removeContraception = (i: number) =>
    setState((s) => ({
      ...s,
      contraception_history: s.contraception_history.filter((_, j) => j !== i),
    }));

  // Pregnancy repeater helpers
  const addPregnancy = () =>
    setState((s) => ({
      ...s,
      pregnancies: [
        ...s.pregnancies,
        { year: "", outcome: "", complications: [], birth_type: "", breastfeeding_months: "" },
      ],
    }));
  const updatePregnancy = (i: number, patch: Partial<PregnancyRowState>) =>
    setState((s) => ({
      ...s,
      pregnancies: s.pregnancies.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    }));
  const removePregnancy = (i: number) =>
    setState((s) => ({
      ...s,
      pregnancies: s.pregnancies.filter((_, j) => j !== i),
    }));

  const handleSectionClick = (n: number) => {
    const el = sectionRefs.current[n];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state.consent) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = buildPayload(state);
      const res = await submitIntakeForm(token, payload);
      if (res.ok) {
        setSubmitted(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setSubmitError(
          res.error === "already_submitted"
            ? "This form has already been submitted."
            : res.error === "invalid_or_expired" || res.error === "expired"
              ? "This link is no longer valid. Please ask your coach for a new one."
              : "Something went wrong. Please try again, or message your coach if it keeps failing."
        );
      }
    } catch {
      setSubmitError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const firstName = (state.display_name || displayName).split(" ")[0] || "";

  // ── Thank-you screen ─────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="fm-thanks">
        <div className="fm-thanks__eyebrow">
          <span className="pulse" aria-hidden="true" />
          <span>Received · {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</span>
        </div>
        <h1 className="fm-thanks__title">
          Thank you{firstName ? <>, <em>{firstName}</em></> : null}.
        </h1>
        <p className="fm-thanks__body">
          Your intake is with me. I&apos;ll read every line carefully before we meet — the timeline, the
          patterns, what&apos;s been tried, what hasn&apos;t.
        </p>
        <p className="fm-thanks__body">Nothing more to do until then. Rest. Drink water.</p>
        <hr className="fm-divider-thin" />
        <p className="fm-thanks__body" style={{ fontSize: 14, color: "var(--fg-2)" }}>
          If anything important comes up before then — a new symptom, a medication change, a thought you
          forgot to add — you can message Shivani directly, or come back and edit your intake any time
          using the same link.
        </p>
        <div style={{ marginTop: "auto", paddingTop: 32 }}>
          <span className="fm-submit__sub">
            <em>Shivani Hari</em> · Functional medicine &amp; subconscious specialist
          </span>
        </div>
      </div>
    );
  }

  // ── Welcome screen ───────────────────────────────────────────────────
  if (!hasBegun) {
    // v0.75.4 — Returning client (typically: pre-discovery submitted,
    // coach has now unlocked the full intake). Show a "welcome back"
    // screen that reflects continuity rather than starting from scratch.
    if (previouslySubmitted) {
      return (
        <div className="fm-welcome">
          <div className="fm-welcome__eyebrow">
            <span className="pulse" aria-hidden="true" />
            <span>Welcome back · longer version unlocked</span>
          </div>

          <h1 className="fm-welcome__hi">
            Welcome back{firstName ? <>, <em>{firstName}</em></> : null} ✨
          </h1>

          <p className="fm-welcome__body">
            I&apos;ve read what you shared before our discovery call. Now that we&apos;re
            working together, I&apos;d like to learn more about your day-to-day,
            your body&apos;s patterns, and the longer arc of your story — so the plan
            I build for you is specifically yours, not a template.
          </p>

          <p className="fm-welcome__body">
            <strong>Your earlier answers are saved.</strong> You&apos;ll see them
            pre-filled in the early sections — feel free to review, edit, or
            skim through. The newer sections (Day-to-day, Five Pillars, Body,
            Joints &amp; standing, Cycle deep-dive) are the ones I&apos;m most
            keen to learn.
          </p>

          <hr className="fm-divider-thin" />

          <div className="fm-welcome__meta">
            <div className="fm-welcome__meta-row">
              <span className="fm-pulse" aria-hidden="true" />
              <span>About 20–25 more minutes · pauses any time</span>
            </div>
            <div className="fm-welcome__meta-row">
              <span className="fm-pulse" aria-hidden="true" />
              <span>Your pre-discovery answers carry through automatically</span>
            </div>
            <div className="fm-welcome__meta-row">
              <span className="fm-pulse" aria-hidden="true" />
              <span>Skip anything that feels heavy or doesn&apos;t apply</span>
            </div>
          </div>

          <button
            type="button"
            className="fm-submit"
            style={{ marginTop: "auto" }}
            onClick={() => setHasBegun(true)}
          >
            Pick up where I left off
          </button>
          <span className="fm-submit__sub">
            Your earlier answers + everything you add now both save themselves.
          </span>
        </div>
      );
    }

    return (
      <div className="fm-welcome">
        <div className="fm-welcome__eyebrow">
          <span className="pulse" aria-hidden="true" />
          <span>Section 01 of {String(totalSections).padStart(2, "0")} · Welcome</span>
        </div>

        <h1 className="fm-welcome__hi">
          Hi{firstName ? <> <em>{firstName}</em></> : null}, thank you for taking the time.
        </h1>

        <p className="fm-welcome__body">
          I read every answer before our session. Take your time — there&apos;s no rush, your progress
          saves itself, and you can pause and come back any time over the next few days.
        </p>

        <p className="fm-welcome__body">
          The more you share, the more personalised your plan will be.
        </p>

        <hr className="fm-divider-thin" />

        <div className="fm-welcome__meta">
          <div className="fm-welcome__meta-row">
            <span className="fm-pulse" aria-hidden="true" />
            <span>About 25 minutes · {totalSections} short sections</span>
          </div>
          <div className="fm-welcome__meta-row">
            <span className="fm-pulse" aria-hidden="true" />
            <span>Only your name, date of birth, and consent are required</span>
          </div>
          <div className="fm-welcome__meta-row">
            <span className="fm-pulse" aria-hidden="true" />
            <span>Everything else — encouraged, never gated</span>
          </div>
        </div>

        <button
          type="button"
          className="fm-submit"
          style={{ marginTop: "auto" }}
          onClick={() => setHasBegun(true)}
        >
          Begin
        </button>
        <span className="fm-submit__sub">Your answers save themselves as you go.</span>
      </div>
    );
  }

  // Computed section numbers (1-indexed). v0.75.2 — SEC_MOVEMENT slotted
  // between BODY (10) and CYCLE (11), bumping subsequent section numbers
  // by 1. The new section covers Beighton hypermobility + NASA lean
  // orthostatic + PEM screen — Tier 1 screening for the MCAS-POTS-EDS /
  // long-COVID family of conditions.
  const SEC_ABOUT = 1;
  const SEC_CONCERNS = 2;
  const SEC_DIAGNOSES = 3;
  const SEC_MEDS = 4;
  const SEC_TIMELINE = 5;
  const SEC_DAY = 6;
  const SEC_PILLARS = 7;
  const SEC_PAST = 8;
  const SEC_DIET = 9;
  const SEC_BODY = 10;
  const SEC_MOVEMENT = 11;
  const SEC_CYCLE = isFemale ? 12 : -1;
  const SEC_READINESS = isFemale ? 13 : 12;
  const SEC_NOTES = isFemale ? 14 : 13;
  const SEC_CONSENT = isFemale ? 15 : 14;

  // ── Main form ────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} onBlur={handleBlur}>
      <FormChrome
        currentSection={currentSection}
        totalSections={totalSections}
        savedTime={lastSavedAt}
        saving={saving}
        savedSections={savedSections}
        onSectionClick={handleSectionClick}
      />

      {/* 1. About you */}
      <FormSection
        number={SEC_ABOUT}
        totalSections={totalSections}
        sectionRef={setSectionRef(SEC_ABOUT)}
        title="About you"
        sub="The basics, so I know who I'm meeting."
      >
        <FG label="Your name">
          <TextInput
            type="text"
            value={state.display_name}
            onChange={(e) => set("display_name", e.target.value)}
            placeholder="Your full name"
          />
        </FG>
        <FG label="Date of birth">
          <TextInput
            type="date"
            value={state.date_of_birth}
            onChange={(e) => set("date_of_birth", e.target.value)}
          />
        </FG>
        <FG label="Sex">
          <RadiosRow<"F" | "M" | "other">
            name="sex"
            value={state.sex as "F" | "M" | "other" | ""}
            options={[
              { value: "F", label: "Female" },
              { value: "M", label: "Male" },
              { value: "other", label: "Other" },
            ]}
            onChange={(v) => set("sex", v)}
          />
        </FG>
        <FG label="Email">
          <TextInput
            type="email"
            value={state.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="you@example.com"
          />
        </FG>
        {mobileNumber ? (
          <FG label="Mobile number" hint="To change this, please message your coach.">
            <span className="fm-readonly">{mobileNumber}</span>
          </FG>
        ) : null}
        <div className="fm-row-2">
          <FG label="City">
            <TextInput
              type="text"
              value={state.city}
              onChange={(e) => set("city", e.target.value)}
              placeholder="e.g. Mumbai"
            />
          </FG>
          <FG label="Country">
            <TextInput
              type="text"
              value={state.country}
              onChange={(e) => set("country", e.target.value)}
              placeholder="India"
            />
          </FG>
        </div>

        {/* v2.3 — Body composition today. Either unit per row is fine.
            Coach prefers metric; imperial accepted for clients used to lb/in. */}
        <h3 className="fm-section__sub" style={{ marginTop: 16 }}>Body measurements today</h3>
        <p className="fm-hint" style={{ marginTop: -4 }}>
          Skip anything you don&apos;t know off-hand — fill in either unit (e.g. cm OR ft+in).
        </p>
        <div className="fm-row-2">
          <FG label="Height (cm)" optional="optional">
            <TextInput
              type="number" inputMode="decimal" step={0.5} min={80} max={230}
              value={state.height_cm}
              onChange={(e) => set("height_cm", e.target.value)}
              placeholder="e.g. 165"
            />
          </FG>
          <FG label="Height (ft + in)" optional="optional">
            <div style={{ display: "flex", gap: 8 }}>
              <TextInput
                type="number" inputMode="numeric" min={3} max={8}
                value={state.height_ft}
                onChange={(e) => set("height_ft", e.target.value)}
                placeholder="ft"
              />
              <TextInput
                type="number" inputMode="numeric" min={0} max={11}
                value={state.height_in}
                onChange={(e) => set("height_in", e.target.value)}
                placeholder="in"
              />
            </div>
          </FG>
        </div>
        <div className="fm-row-2">
          <FG label="Current weight (kg)" optional="optional">
            <TextInput
              type="number" inputMode="decimal" step={0.5} min={20} max={300}
              value={state.weight_now_kg}
              onChange={(e) => set("weight_now_kg", e.target.value)}
              placeholder="e.g. 68"
            />
          </FG>
          <FG label="Current weight (lb)" optional="optional">
            <TextInput
              type="number" inputMode="decimal" step={0.5} min={40} max={660}
              value={state.weight_now_lb}
              onChange={(e) => set("weight_now_lb", e.target.value)}
              placeholder="e.g. 150"
            />
          </FG>
        </div>
        <div className="fm-row-2">
          <FG label="Waist (cm)" optional="optional" hint="At the belly button.">
            <TextInput
              type="number" inputMode="decimal" step={0.5} min={40} max={200}
              value={state.waist_cm}
              onChange={(e) => set("waist_cm", e.target.value)}
              placeholder="e.g. 82"
            />
          </FG>
          <FG label="Waist (in)" optional="optional">
            <TextInput
              type="number" inputMode="decimal" step={0.5} min={16} max={80}
              value={state.waist_in}
              onChange={(e) => set("waist_in", e.target.value)}
              placeholder="e.g. 32"
            />
          </FG>
        </div>
        <div className="fm-row-2">
          <FG label="Hips (cm)" optional="optional" hint="Widest point.">
            <TextInput
              type="number" inputMode="decimal" step={0.5} min={50} max={220}
              value={state.hip_cm}
              onChange={(e) => set("hip_cm", e.target.value)}
              placeholder="e.g. 96"
            />
          </FG>
          <FG label="Hips (in)" optional="optional">
            <TextInput
              type="number" inputMode="decimal" step={0.5} min={20} max={88}
              value={state.hip_in}
              onChange={(e) => set("hip_in", e.target.value)}
              placeholder="e.g. 38"
            />
          </FG>
        </div>
        <FG
          label="Blood pressure"
          optional="optional"
          hint="If you've measured recently. Systolic / diastolic (e.g. 118 / 76)."
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <TextInput
              type="number" inputMode="numeric" min={60} max={250}
              value={state.bp_systolic}
              onChange={(e) => set("bp_systolic", e.target.value)}
              placeholder="systolic"
            />
            <span style={{ opacity: 0.5 }}>/</span>
            <TextInput
              type="number" inputMode="numeric" min={30} max={160}
              value={state.bp_diastolic}
              onChange={(e) => set("bp_diastolic", e.target.value)}
              placeholder="diastolic"
            />
          </div>
        </FG>

        {/* v2.2 — Weight */}
        <h3 className="fm-section__sub" style={{ marginTop: 16 }}>Weight history</h3>
        <div className="fm-row-2">
          <FG label="Highest adult weight (kg)" optional="optional">
            <TextInput
              type="number"
              inputMode="decimal"
              step={0.5}
              min={20}
              max={300}
              value={state.weight_highest_adult}
              onChange={(e) => set("weight_highest_adult", e.target.value)}
              placeholder="e.g. 78"
            />
          </FG>
          <FG label="Lowest adult weight (kg)" optional="optional">
            <TextInput
              type="number"
              inputMode="decimal"
              step={0.5}
              min={20}
              max={300}
              value={state.weight_lowest_adult}
              onChange={(e) => set("weight_lowest_adult", e.target.value)}
              placeholder="e.g. 58"
            />
          </FG>
        </div>
        <FG label="Weight trend right now" optional="optional">
          <RadiosColumn
            name="weight_trend_current"
            value={state.weight_trend_current}
            options={WEIGHT_TREND_OPTIONS}
            onChange={(v) => set("weight_trend_current", v)}
          />
        </FG>
        {state.weight_trend_current === "changed_sharply" ? (
          <FG label="What was happening when it changed?">
            <TextArea
              rows={2}
              value={state.weight_change_trigger}
              onChange={(e) => set("weight_change_trigger", e.target.value)}
              placeholder="e.g. After my second pregnancy / new medication / job change"
            />
          </FG>
        ) : null}

        {/* v2.2 — Work pattern */}
        <FG
          label="Work pattern"
          optional="tick all that apply"
          hint="What your day actually looks like."
        >
          <ChipMulti
            value={state.work_pattern}
            options={WORK_PATTERN_OPTIONS}
            onChange={(v) => set("work_pattern", v)}
          />
        </FG>

        <p className="fm-foot">
          Private. Used only by Shivani to design your plan.
        </p>
      </FormSection>

      {/* 2. Concerns */}
      <FormSection
        number={SEC_CONCERNS}
        totalSections={totalSections}
        sectionRef={setSectionRef(SEC_CONCERNS)}
        title="Why you're here, in your own words"
        sub="What brought you to me. Write it the way you'd say it."
        soft
      >
        <FG
          label="Why are you here? What do you want help with?"
          hint="A few sentences is plenty."
        >
          <TextArea
            rows={4}
            value={state.why_here}
            onChange={(e) => set("why_here", e.target.value)}
            placeholder="e.g. I've been feeling tired all the time for the past year and want to get to the bottom of it…"
          />
        </FG>
        <FG
          label="Top three concerns right now"
          hint="One per line. Repeat the main one if it's the only thing on your mind."
        >
          <div className="fm-stack-12">
            <TextInput
              type="text"
              value={state.concern_1}
              onChange={(e) => set("concern_1", e.target.value)}
              placeholder="1. e.g. Bloating after every meal"
            />
            <TextInput
              type="text"
              value={state.concern_2}
              onChange={(e) => set("concern_2", e.target.value)}
              placeholder="2. e.g. Trouble falling asleep"
            />
            <TextInput
              type="text"
              value={state.concern_3}
              onChange={(e) => set("concern_3", e.target.value)}
              placeholder="3. e.g. Weight gain around the middle"
            />
          </div>
        </FG>
      </FormSection>

      {/* 3. Diagnoses / meds / allergies / family / COVID */}
      <FormSection
        number={SEC_DIAGNOSES}
        totalSections={totalSections}
        sectionRef={setSectionRef(SEC_DIAGNOSES)}
        title="Your diagnoses, allergies & family"
        sub="What's on the record, what's in the cupboard."
      >
        <FG
          label="Current diagnoses"
          optional="optional"
          hint="Anything a doctor has named — thyroid, PCOS, IBS, anxiety, etc."
        >
          <ChipInput
            value={state.active_conditions}
            onChange={(v) => set("active_conditions", v)}
            placeholder="e.g. Hypothyroidism"
          />
        </FG>
        <FG
          label="Known allergies"
          optional="optional"
          hint="Foods, medications, environment."
        >
          <ChipInput
            value={state.known_allergies}
            onChange={(v) => set("known_allergies", v)}
            placeholder="e.g. Peanuts"
          />
        </FG>
        <FG
          label="Current medications"
          optional="optional"
          hint="Prescription drugs only. Name + dose if you have it."
        >
          <ChipInput
            value={state.current_medications}
            onChange={(v) => set("current_medications", v)}
            placeholder="e.g. Levothyroxine 50mcg"
          />
        </FG>
        <FG
          label="Current supplements"
          optional="optional"
          hint="Vitamins, minerals, herbs, probiotics, protein powders, ayurvedic mixes — anything you take regularly. Name + dose + how often if you know."
        >
          <ChipInput
            value={state.current_supplements}
            onChange={(v) => set("current_supplements", v)}
            placeholder="e.g. Vitamin D3 2000IU daily, Magnesium glycinate 400mg at night, Ashwagandha"
          />
        </FG>
        <FG
          label="Family history"
          optional="optional"
          hint="Conditions in immediate family — diabetes, thyroid, cancer, heart, mental health."
        >
          <TextArea
            rows={3}
            value={state.family_history}
            onChange={(e) => set("family_history", e.target.value)}
            placeholder="e.g. Mother — type 2 diabetes; Father — heart disease; Sister — Hashimoto's"
          />
        </FG>
        <FG
          label="Specific conditions in immediate family"
          optional="tick any that apply"
          hint="The ones that change how I plan your care."
        >
          <ChipMulti
            value={state.family_specific_conditions}
            options={FAMILY_SPECIFIC_CONDITIONS}
            onChange={(v) => set("family_specific_conditions", v)}
          />
        </FG>

        <hr className="fm-divider-thin" style={{ margin: "24px 0 8px" }} />

        <p className="fm-microcopy" style={{ marginBottom: 14 }}>
          I ask everyone about all of their medical history, including vaccines —
          not because of any agenda, but because I need the full picture to design good care.
        </p>

        <FG label="COVID infection history" optional="tick all that apply">
          <ChipMulti
            value={state.covid_history}
            options={COVID_HISTORY}
            onChange={(v) => set("covid_history", v)}
          />
        </FG>
        {(state.covid_history.includes("long-COVID symptoms now") ||
          state.covid_history.includes("long-COVID symptoms past, resolved")) ? (
          <FG label="Long-COVID symptoms" optional="tick all that apply">
            <ChipMulti
              value={state.covid_long_symptoms}
              options={COVID_LONG_SYMPTOMS}
              onChange={(v) => set("covid_long_symptoms", v)}
            />
          </FG>
        ) : null}
        <FG label="COVID vaccination history" optional="tick all that apply">
          <ChipMulti
            value={state.covid_vaccine_history}
            options={COVID_VAX_HISTORY}
            onChange={(v) => set("covid_vaccine_history", v)}
          />
        </FG>
        <FG label="Vaccine brand(s)" optional="optional">
          <ChipMulti
            value={state.covid_vaccine_brand}
            options={COVID_VAX_BRAND}
            onChange={(v) => set("covid_vaccine_brand", v)}
          />
        </FG>
        <FG label="Reactions you noticed" optional="optional">
          <ChipMulti
            value={state.covid_vaccine_reactions}
            options={COVID_VAX_REACTIONS}
            onChange={(v) => set("covid_vaccine_reactions", v)}
          />
        </FG>
        <FG
          label="Which dose, roughly when, and what happened?"
          optional="skip if not relevant"
        >
          <TextArea
            rows={2}
            value={state.covid_vaccine_reaction_detail}
            onChange={(e) => set("covid_vaccine_reaction_detail", e.target.value)}
            placeholder="e.g. Second dose, July 2021 — period went haywire for 4 months"
          />
        </FG>
      </FormSection>

      {/* 4. Medications layered */}
      <FormSection
        number={SEC_MEDS}
        totalSections={totalSections}
        sectionRef={setSectionRef(SEC_MEDS)}
        title="Medications, current and past"
        sub="The categories that quietly reshape gut, hormones, sleep. Skip what doesn't apply."
        soft
      >
        <div className="fm-fg">
          <label className="fm-fg__label">Have you ever taken any of these regularly?</label>
          <span className="fm-fg__hint">
            Tap one and a quick form drops in — name, dose, when, still on it, side effects.
            Add as many as apply.
          </span>

          <div className="fm-chips">
            {MED_BUCKETS.map((b) => {
              const on = isMedActive(b.id);
              return (
                <button
                  key={b.id as string}
                  type="button"
                  className={"fm-chip" + (on ? " fm-chip--on" : "")}
                  aria-pressed={on}
                  onClick={() => toggleMedBucket(b.id)}
                >
                  <span aria-hidden="true">{b.emoji}</span>
                  <span style={{ marginLeft: 6 }}>{b.name}</span>
                  {on ? <span className="fm-chip__x" aria-hidden="true">×</span> : null}
                </button>
              );
            })}
          </div>

          {MED_BUCKETS.some((b) => isMedActive(b.id)) ? (
            <div className="fm-medstack">
              {MED_BUCKETS.filter((b) => isMedActive(b.id)).map((b) => (
                <div key={b.id as string}>
                  {(state[b.id] as MedicationCategoryEntry[]).map((entry, idx) => (
                    <MedMiniCardForm
                      key={idx}
                      bucket={b}
                      data={entry}
                      onChange={(patch) => updateMedEntry(b.id, idx, patch)}
                      onRemove={() => {
                        const list = state[b.id] as MedicationCategoryEntry[];
                        if (list.length <= 1) {
                          toggleMedBucket(b.id);
                        } else {
                          removeMedEntry(b.id, idx);
                        }
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <p className="fm-foot">
          If you&apos;re not sure of a dose, write what you remember — I can confirm the rest.
        </p>
      </FormSection>

      {/* 5. Timeline */}
      <FormSection
        number={SEC_TIMELINE}
        totalSections={totalSections}
        sectionRef={setSectionRef(SEC_TIMELINE)}
        title="Your health story, in time"
        sub="When did things start? Big life events — moves, surgeries, infections, losses, COVID — often play a part."
      >
        {state.timeline_events.map((row, i) => (
          <div key={i} className="fm-rep">
            {state.timeline_events.length > 1 ? (
              <button
                type="button"
                className="fm-rep__remove"
                onClick={() => removeRow(i)}
                aria-label="Remove row"
              >
                remove
              </button>
            ) : null}
            <div className="fm-rep__row">
              <div>
                <label className="fm-fg__label" style={{ fontSize: 12 }}>Year</label>
                <TextInput
                  type="number"
                  inputMode="numeric"
                  value={row.year}
                  onChange={(e) => updateRow(i, { year: e.target.value })}
                  placeholder="e.g. 2019"
                  min={1900}
                  max={2100}
                />
              </div>
              <div>
                <label className="fm-fg__label" style={{ fontSize: 12 }}>Category</label>
                <select
                  className="fm-input fm-input--filled"
                  value={row.category}
                  onChange={(e) => updateRow(i, { category: e.target.value })}
                  style={{ padding: "8px 0 10px" }}
                >
                  {TIMELINE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="fm-rep__row fm-rep__row--full">
              <div>
                <label className="fm-fg__label" style={{ fontSize: 12 }}>What happened</label>
                <TextInput
                  type="text"
                  value={row.event}
                  onChange={(e) => updateRow(i, { event: e.target.value })}
                  placeholder="e.g. Started getting bloated after meals"
                />
              </div>
            </div>
          </div>
        ))}
        <button type="button" onClick={addRow} className="fm-add">
          <span className="pulse" aria-hidden="true" />
          add another event
        </button>
        <p className="fm-foot">
          You can come back and add more later — nothing is locked.
        </p>
      </FormSection>

      {/* 6. Day-to-day */}
      <FormSection
        number={SEC_DAY}
        totalSections={totalSections}
        sectionRef={setSectionRef(SEC_DAY)}
        title="Day to day — how you're living"
        sub="Even a few words per box helps."
        soft
      >
        <FG label="Digestion" optional="optional">
          <TextArea
            rows={3}
            value={state.digestion_notes}
            onChange={(e) => set("digestion_notes", e.target.value)}
            placeholder="How are your bowels? Bloating? Gas? Reflux?"
          />
        </FG>
        <FG label="Sleep" optional="optional">
          <TextArea
            rows={3}
            value={state.sleep_notes}
            onChange={(e) => set("sleep_notes", e.target.value)}
            placeholder="What time do you sleep / wake? Do you wake at night? Dreams?"
          />
        </FG>
        <FG label="Energy through the day" optional="optional">
          <TextArea
            rows={3}
            value={state.energy_pattern}
            onChange={(e) => set("energy_pattern", e.target.value)}
            placeholder="When do you feel most / least energetic? Afternoon slumps?"
          />
        </FG>
        {isFemale ? (
          <FG label="Menstrual cycle" optional="optional">
            <TextArea
              rows={3}
              value={state.menstrual_notes}
              onChange={(e) => set("menstrual_notes", e.target.value)}
              placeholder="Cycle length, PMS, pain, flow, mood shifts"
            />
          </FG>
        ) : null}
        <FG label="Under stress, how do you feel?" optional="optional">
          <TextArea
            rows={3}
            value={state.stress_response}
            onChange={(e) => set("stress_response", e.target.value)}
            placeholder="More 'wired' (anxious, can't switch off) or 'shut down' (exhausted, numb)?"
          />
        </FG>
      </FormSection>

      {/* 7. Five Pillars */}
      <FormSection
        number={SEC_PILLARS}
        totalSections={totalSections}
        sectionRef={setSectionRef(SEC_PILLARS)}
        title="Your five pillars + sleep depth"
        sub="Tap a number for each. Skip any you'd rather not rate."
      >
        <FG label="Sleep quality" hint="1 = poor · 5 = excellent">
          <RatingDots
            value={state.fp_sleep_quality}
            onChange={(n) => set("fp_sleep_quality", n)}
            labelLow="poor"
            labelHigh="excellent"
          />
        </FG>
        <FG label="Average hours of sleep per night" optional="optional">
          <TextInput
            type="number"
            inputMode="numeric"
            min={0}
            max={14}
            step={0.5}
            value={state.fp_sleep_hours ?? ""}
            onChange={(e) =>
              set("fp_sleep_hours", e.target.value === "" ? null : Number(e.target.value))
            }
            placeholder="e.g. 7"
          />
        </FG>
        <FG label="How long to fall asleep?" optional="optional">
          <RadiosColumn
            name="time_to_fall_asleep"
            value={state.time_to_fall_asleep}
            options={TIME_TO_FALL_ASLEEP}
            onChange={(v) => set("time_to_fall_asleep", v)}
          />
        </FG>
        <FG label="Wake-time pattern" optional="tick all that apply">
          <ChipMulti
            value={state.wake_time_pattern}
            options={WAKE_TIME_PATTERN}
            onChange={(v) => set("wake_time_pattern", v)}
          />
        </FG>
        <FG label="Snoring or apnoea" optional="optional">
          <RadiosColumn
            name="snore_or_apnoea"
            value={state.snore_or_apnoea}
            options={SNORE_OR_APNOEA}
            onChange={(v) => set("snore_or_apnoea", v)}
          />
        </FG>
        {/* v0.75.5 STOP-BANG deepening — apnoea is widely missed in women */}
        <FG
          label="Any of these also ring true?"
          optional="tick all that apply"
          hint="Apnoea presents differently in women and is often missed. These extras help me catch it."
        >
          <ChipMulti
            value={state.stop_bang_signals}
            options={STOP_BANG_SIGNALS}
            onChange={(v) => set("stop_bang_signals", v)}
          />
        </FG>
        <FG label="Restless legs" optional="optional">
          <RadiosRow
            name="restless_legs"
            value={state.restless_legs}
            options={RESTLESS_LEGS}
            onChange={(v) => set("restless_legs", v)}
          />
        </FG>
        <FG label="Sleep tracker?" optional="tick any you use">
          <ChipMulti
            value={state.sleep_tracker_owned}
            options={SLEEP_TRACKER}
            onChange={(v) => set("sleep_tracker_owned", v)}
          />
        </FG>
        <FG label="Continuous glucose monitor (CGM)?" optional="optional">
          <RadiosRow
            name="cgm_owned"
            value={state.cgm_owned}
            options={CGM_OWNED}
            onChange={(v) => set("cgm_owned", v)}
          />
        </FG>

        <hr className="fm-divider-thin" style={{ margin: "20px 0 8px" }} />

        <FG label="Stress level" hint="1 = very low · 5 = very high">
          <RatingDots
            value={state.fp_stress}
            onChange={(n) => set("fp_stress", n)}
            labelLow="low"
            labelHigh="high"
          />
        </FG>
        <FG label="Movement days per week" hint="0 – 7">
          <DayChips
            value={state.fp_movement_days}
            onChange={(n) => set("fp_movement_days", n)}
          />
        </FG>
        <FG label="Nutrition quality" hint="1 = poor · 5 = excellent">
          <RatingDots
            value={state.fp_nutrition_quality}
            onChange={(n) => set("fp_nutrition_quality", n)}
            labelLow="poor"
            labelHigh="excellent"
          />
        </FG>
        <FG label="Connection / relationships" hint="1 = isolated · 5 = deeply supported">
          <RatingDots
            value={state.fp_connection_quality}
            onChange={(n) => set("fp_connection_quality", n)}
            labelLow="isolated"
            labelHigh="supported"
          />
        </FG>

        <hr className="fm-divider-thin" style={{ margin: "20px 0 8px" }} />

        <FG label="Energy crashes" optional="tick all that apply">
          <ChipMulti
            value={state.energy_crashes}
            options={ENERGY_CRASHES}
            onChange={(v) => set("energy_crashes", v)}
          />
        </FG>
        <FG label="Caffeine dependency" optional="optional">
          <RadiosColumn
            name="caffeine_dependency"
            value={state.caffeine_dependency}
            options={CAFFEINE_DEPENDENCY}
            onChange={(v) => set("caffeine_dependency", v)}
          />
        </FG>
        <FG label="How do mornings feel?" optional="optional">
          <RadiosColumn
            name="morning_state"
            value={state.morning_state}
            options={MORNING_STATE}
            onChange={(v) => set("morning_state", v)}
          />
        </FG>

        <FG label="Anything to add about the above?" optional="optional">
          <TextArea
            rows={2}
            value={state.fp_notes}
            onChange={(e) => set("fp_notes", e.target.value)}
            placeholder="Optional"
          />
        </FG>
      </FormSection>

      {/* 8. Past & environment */}
      <FormSection
        number={SEC_PAST}
        totalSections={totalSections}
        sectionRef={setSectionRef(SEC_PAST)}
        title="Childhood, environment, what's been tried"
        sub="The longer view often holds the clue."
        soft
      >
        <FG label="Childhood health" optional="optional">
          <TextArea
            rows={3}
            value={state.childhood_history}
            onChange={(e) => set("childhood_history", e.target.value)}
            placeholder="Antibiotics often? Tummy issues? Asthma / eczema / allergies? Difficult childhood events?"
          />
        </FG>
        {/* v0.75.5 ACE-lite — sensitively framed; coach reads patterns,
            never asks for an explicit ACE score. Drives HPA-axis framing
            + trauma-informed protocol cautions. */}
        <FG
          label="Stress patterns — past or present"
          optional="tick anything that resonates, skip anything that doesn't"
          hint="The body holds long stories. Even one tick changes the lens I bring to your plan. There are no wrong answers, and you never owe me details — these are screens, not interviews."
        >
          <ChipMulti
            value={state.ace_signals}
            options={ACE_SIGNALS}
            onChange={(v) => set("ace_signals", v)}
          />
        </FG>
        <FG label="Exposures" optional="optional">
          <TextArea
            rows={3}
            value={state.toxic_exposures}
            onChange={(e) => set("toxic_exposures", e.target.value)}
            placeholder="Mould, chemicals at work, long-term medication, smoking history"
          />
        </FG>
        <FG label="What has genuinely helped you" optional="even temporarily">
          <TextArea
            rows={3}
            value={state.what_has_worked}
            onChange={(e) => set("what_has_worked", e.target.value)}
            placeholder="Diets, supplements, lifestyle changes, therapies that moved the needle."
          />
        </FG>
        <FG label="What hasn't helped, or made things worse" optional="optional">
          <TextArea
            rows={3}
            value={state.what_hasnt_worked}
            onChange={(e) => set("what_hasnt_worked", e.target.value)}
            placeholder="Be specific if you can — names, doses, what changed."
          />
        </FG>

        <hr className="fm-divider-thin" style={{ margin: "20px 0 8px" }} />

        <FG label="Sun exposure on a typical day" optional="optional">
          <RadiosColumn
            name="sun_exposure_daily"
            value={state.sun_exposure_daily}
            options={SUN_EXPOSURE}
            onChange={(v) => set("sun_exposure_daily", v)}
          />
        </FG>
        <FG label="Sunscreen use" optional="optional">
          <RadiosColumn
            name="sunscreen_use"
            value={state.sunscreen_use}
            options={SUNSCREEN_USE}
            onChange={(v) => set("sunscreen_use", v)}
          />
        </FG>
        <FG label="Vitamin D supplement" optional="optional">
          <RadiosColumn
            name="vit_d_supplement"
            value={state.vit_d_supplement}
            options={VIT_D_SUPPLEMENT}
            onChange={(v) => set("vit_d_supplement", v)}
          />
        </FG>
        <FG label="Barefoot outdoors" optional="optional">
          <RadiosRow
            name="barefoot_outdoors"
            value={state.barefoot_outdoors}
            options={BAREFOOT_OUTDOORS}
            onChange={(v) => set("barefoot_outdoors", v)}
          />
        </FG>
      </FormSection>

      {/* 9. Diet */}
      <FormSection
        number={SEC_DIET}
        totalSections={totalSections}
        sectionRef={setSectionRef(SEC_DIET)}
        title="How you eat"
        sub="The way you actually eat — not the way you wish you ate."
      >
        <FG label="Dietary preference">
          <RadiosColumn
            name="dietary_preference"
            value={state.dietary_preference}
            options={DIETARY_OPTIONS.map((d) => ({ value: d, label: d }))}
            onChange={(v) => set("dietary_preference", v)}
          />
        </FG>
        {/* Animal-derived supplements — asked ONLY for veg-spectrum diets.
            Many supplements (omega-3 fish oil, gelatin capsule shells,
            collagen, cod-liver oil) contain animal ingredients. Knowing
            this upfront lets the coach pick plant/algae forms from the
            start instead of finding out after the plan is built. Skipped
            for Non-vegetarian / Pescatarian / Other. */}
        {["Vegetarian", "Jain vegetarian", "Vegan", "Eggetarian"].includes(
          state.dietary_preference,
        ) && (
          <FG
            label="Are you okay with supplements that may contain animal-derived ingredients?"
            hint="Some supplements — like omega-3 fish oil, cod-liver oil, gelatin capsule shells, or collagen — come from animal sources. Plant or algae-based alternatives usually exist. Your answer helps us pick the right forms for you from the start."
          >
            <RadiosColumn
              name="animal_derived_supplements_ok"
              value={state.animal_derived_supplements_ok}
              options={[
                {
                  value: "yes",
                  label: "Yes — animal-derived supplements are fine",
                },
                {
                  value: "no",
                  label: "No — plant / algae-based only, please",
                },
                {
                  value: "unsure",
                  label: "Not sure — let's discuss on the call",
                },
              ]}
              onChange={(v) => set("animal_derived_supplements_ok", v)}
            />
          </FG>
        )}
        <FG label="Foods you avoid, and why" optional="optional">
          <TextArea
            rows={2}
            value={state.foods_to_avoid}
            onChange={(e) => set("foods_to_avoid", e.target.value)}
            placeholder="e.g. Brinjal (allergy), raw onion (heartburn)"
          />
        </FG>
        <FG
          label="Non-negotiables"
          optional="be honest"
          hint="Things you absolutely won't give up — your morning chai, weekend mutton."
        >
          <TextArea
            rows={2}
            value={state.non_negotiables}
            onChange={(e) => set("non_negotiables", e.target.value)}
            placeholder="e.g. Morning chai with sugar, weekly biryani"
          />
        </FG>
        <FG
          label="Triggers you've noticed"
          optional="optional"
          hint="Anything that consistently triggers symptoms."
        >
          <TextArea
            rows={2}
            value={state.reported_triggers}
            onChange={(e) => set("reported_triggers", e.target.value)}
            placeholder="e.g. Gluten → bloating; afternoon coffee → poor sleep"
          />
        </FG>

        <hr className="fm-divider-thin" style={{ margin: "20px 0 8px" }} />

        <FG label="After eating, what tends to happen?" optional="tick all that apply">
          <ChipMulti
            value={state.postprandial_pattern}
            options={POSTPRANDIAL}
            onChange={(v) => set("postprandial_pattern", v)}
          />
        </FG>
        <FG label="Cold or heat tolerance" optional="optional">
          <RadiosColumn
            name="cold_heat_tolerance"
            value={state.cold_heat_tolerance}
            options={COLD_HEAT_TOLERANCE}
            onChange={(v) => set("cold_heat_tolerance", v)}
          />
        </FG>
      </FormSection>

      {/* 10. Body systems */}
      <FormSection
        number={SEC_BODY}
        totalSections={totalSections}
        sectionRef={setSectionRef(SEC_BODY)}
        title="Your body systems — what's bothering you"
        sub="Tick everything that applies, even mildly. This is how I find patterns."
        soft
      >
        {/* 11a Bristol sub-card */}
        <div className="fm-subcard">
          <h3 className="fm-subcard__title">Bowel habits</h3>
          <p className="fm-subcard__sub">
            Stick with me — this section tells me more about your gut than almost any lab.
            Be specific where you can.
          </p>
          <p className="fm-subcard__helper">
            Bowel patterns vary day to day. Tick every type you&apos;ve seen in a typical week —
            most people have more than one.
          </p>

          <BristolStoolPicker
            value={state.bristol_stool_typical}
            onChange={(v) => set("bristol_stool_typical", v)}
          />

          <div className="fm-fg" style={{ marginTop: 18, marginBottom: 18 }}>
            <label className="fm-fg__label">How many times a day?</label>
            <Stepper
              value={state.bowel_frequency_per_day}
              min={0}
              max={10}
              onChange={(n) => set("bowel_frequency_per_day", n)}
            />
          </div>

          <div className="fm-fg" style={{ marginBottom: 18 }}>
            <label className="fm-fg__label">Anything else going on?</label>
            <ChipMulti
              value={state.bowel_pattern}
              options={BOWEL_PATTERN}
              onChange={(v) => set("bowel_pattern", v)}
              xs
            />
          </div>

          <div className="fm-fg" style={{ marginBottom: 0 }}>
            <label className="fm-fg__label">
              What was normal for you 5–10 years ago?
              <span className="fm-fg__optional">optional</span>
            </label>
            <TextInput
              type="text"
              value={state.bowel_historical}
              onChange={(e) => set("bowel_historical", e.target.value)}
              placeholder="e.g. once a day after coffee, type 4"
            />
          </div>

          <p className="fm-foot" style={{ marginTop: 20 }}>
            Nothing here is shared anywhere outside our work together.
          </p>
        </div>

        {/* 11b Hair */}
        <FG label="Hair loss pattern" optional="optional">
          <RadiosColumn
            name="hair_loss_pattern"
            value={state.hair_loss_pattern}
            options={HAIR_LOSS}
            onChange={(v) => set("hair_loss_pattern", v)}
          />
        </FG>
        <FG label="Hair texture changes" optional="optional">
          <RadiosColumn
            name="hair_texture_change"
            value={state.hair_texture_change}
            options={HAIR_TEXTURE}
            onChange={(v) => set("hair_texture_change", v)}
          />
        </FG>
        <FG label="Other hair signs" optional="tick all that apply">
          <ChipMulti
            value={state.hair_other}
            options={HAIR_OTHER}
            onChange={(v) => set("hair_other", v)}
          />
        </FG>

        {/* 11c Nails */}
        <FG label="Nails" optional="tick all that apply">
          <ChipMulti
            value={state.nail_signs}
            options={NAIL_SIGNS}
            onChange={(v) => set("nail_signs", v)}
          />
        </FG>

        {/* 11d Skin */}
        <FG label="Acne pattern" optional="tick all that apply">
          <ChipMulti
            value={state.acne_pattern}
            options={ACNE_PATTERN}
            onChange={(v) => set("acne_pattern", v)}
          />
        </FG>
        <FG label="Skin signs" optional="tick all that apply">
          <ChipMulti
            value={state.skin_signs}
            options={SKIN_SIGNS}
            onChange={(v) => set("skin_signs", v)}
          />
        </FG>

        {/* 11e Pain — interactive body map */}
        <FG label="Pain — where on your body?" optional="tap the areas that hurt">
          <PainBodyMap
            value={state.pain_locations ?? []}
            onChange={(next) => set("pain_locations", next)}
          />
        </FG>
        <FG label="If head or face hurts — what kind?" optional="tick all that apply">
          <ChipMulti
            value={state.headache_type}
            options={HEADACHE_TYPE}
            onChange={(v) => set("headache_type", v)}
          />
        </FG>
        <FG label="Pain pattern" optional="tick all that apply">
          <ChipMulti
            value={state.pain_pattern}
            options={PAIN_PATTERN}
            onChange={(v) => set("pain_pattern", v)}
          />
        </FG>
        <FG label="Pain quality" optional="tick all that apply">
          <ChipMulti
            value={state.pain_quality}
            options={PAIN_QUALITY}
            onChange={(v) => set("pain_quality", v)}
          />
        </FG>

        {/* 11f Hormones */}
        <FG label="Belly fat / shape change" optional="optional">
          <RadiosColumn
            name="belly_fat_pattern"
            value={state.belly_fat_pattern}
            options={BELLY_FAT}
            onChange={(v) => set("belly_fat_pattern", v)}
          />
        </FG>

        {/* 11g Immune */}
        <FG label="Histamine signals" optional="tick all that apply">
          <ChipMulti
            value={state.histamine_signals}
            options={HISTAMINE}
            onChange={(v) => set("histamine_signals", v)}
          />
        </FG>
        <FG label="Chemical / medication sensitivity" optional="tick all that apply">
          <ChipMulti
            value={state.chemical_sensitivity}
            options={CHEMICAL_SENSITIVITY}
            onChange={(v) => set("chemical_sensitivity", v)}
          />
        </FG>

        {/* 11h Mouth */}
        <FG label="Mouth & teeth" optional="tick all that apply">
          <ChipMulti
            value={state.oral_signs}
            options={ORAL_SIGNS}
            onChange={(v) => set("oral_signs", v)}
          />
        </FG>
      </FormSection>

      {/* ════════════════════════════════════════════════════════════════════
          11. Movement, joints, standing (v0.75.2 — Tier 1 screening)

          Five blocks:
          (a) Joint hypermobility (Beighton self-screen, 5 image-illustrated
              chips + 4 supplemental chips). Catches the EDS / hypermobility-
              spectrum population. Re-checked bilaterally by coach on Zoom.
          (b) Standing tolerance — device-conditional NASA lean self-check.
              Q1 always: do you own a HR-measuring device? Q2 conditional on
              device: 10-min wall-lean with supine + standing HR + symptoms.
              No-device branch: symptoms only.
          (c) Post-exertional malaise (PEM) screen — cardinal feature of
              ME/CFS and long COVID. Catching it on intake prevents
              well-meaning but harmful "graded exercise therapy" advice.
          (d) Environment — mould + chemical exposure chips. Fish question
              conditional on non-vegetarian diet only.
          (e) Hint that coach re-checks Beighton + lean test on the Zoom
              session — self-report is the starting point, not the final
              answer.
       ════════════════════════════════════════════════════════════════════ */}
      <FormSection
        number={SEC_MOVEMENT}
        totalSections={totalSections}
        sectionRef={setSectionRef(SEC_MOVEMENT)}
        title="Joints, standing, recovery"
        sub="A few patterns I want to catch early — easier to plan well when I know them."
      >
        {/* ── 11a. Beighton hypermobility self-screen ── */}
        <FG
          label="Joint flexibility — tick the ones you can do easily without pain"
          optional="image guide below"
          hint="Look at each test in the image, then tick what you can do. Don't tick a test if you have to push hard or it hurts. We'll re-check together on our session — your self-report is a starting point."
        >
          <div style={{ marginBottom: 12 }}>
            {/* CC0 — Hypermobility Beighton Score by Rollcloud, Wikimedia Commons */}
            <img
              src="/intake-illustrations/beighton-composite.png"
              alt="Joint flexibility tests — Beighton score illustration showing pinky bend, thumb to forearm, elbow hyperextension, knee hyperextension, and palms flat on floor"
              style={{
                maxWidth: "100%",
                height: "auto",
                display: "block",
                margin: "0 auto",
                background: "#f5f5f4",
                border: "1px solid #e7e5e4",
                borderRadius: 10,
              }}
            />
          </div>
          <ChipMulti
            value={state.beighton_self_score}
            options={BEIGHTON_SELF}
            onChange={(v) => set("beighton_self_score", v)}
          />
        </FG>

        <FG label="Anything else that applies" optional="tick all that apply">
          <ChipMulti
            value={state.beighton_supplemental}
            options={BEIGHTON_SUPPLEMENTAL}
            onChange={(v) => set("beighton_supplemental", v)}
          />
        </FG>

        {/* ── 11b. Standing tolerance — device-conditional NASA lean ── */}
        <hr className="fm-divider-thin" style={{ margin: "24px 0 12px" }} />

        <FG
          label="Do you have any device that measures heart rate?"
          optional="tick all you have access to"
          hint="If you have one, I'll ask you to do a quick 10-min self-check. If not, no worries — we'll do it together on our session."
        >
          <ChipMulti
            value={state.hr_devices_owned}
            options={HR_DEVICES}
            onChange={(v) => set("hr_devices_owned", v)}
          />
        </FG>

        {/* Lean self-check appears only if at least one device (other than
            "none of the above") is ticked. */}
        {state.hr_devices_owned.length > 0 &&
        !(
          state.hr_devices_owned.length === 1 &&
          state.hr_devices_owned[0] === "None of the above"
        ) ? (
          <FG
            label="10-min standing self-check (optional but high-yield)"
            optional="if you can spare 15 min before our session"
            hint={
              "Lie down on your back for 5 min. Note your heart rate. " +
              "Then stand with heels about 15 cm from a wall, head + shoulders touching the wall, arms relaxed. " +
              "Stay 10 min (sit earlier if you feel close to fainting). Note your heart rate again. Then tick the symptoms you felt."
            }
          >
            <div className="fm-row-2">
              <div>
                <label className="fm-label-small">Resting HR after 5 min lying down (bpm)</label>
                <TextInput
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 68"
                  value={state.lean_test_supine_hr}
                  onChange={(e) => set("lean_test_supine_hr", e.target.value)}
                />
              </div>
              <div>
                <label className="fm-label-small">HR after 10 min standing against wall (bpm)</label>
                <TextInput
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 110"
                  value={state.lean_test_standing_hr}
                  onChange={(e) => set("lean_test_standing_hr", e.target.value)}
                />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label className="fm-label-small">During the 10 minutes — what did you feel?</label>
              <ChipMulti
                value={state.lean_test_symptoms}
                options={LEAN_TEST_SYMPTOMS}
                onChange={(v) => set("lean_test_symptoms", v)}
              />
            </div>
          </FG>
        ) : (
          <FG
            label="When you stand for 5+ minutes (queues, kitchen, lifts), do any of these happen?"
            optional="tick all that apply"
            hint="No device needed — just notice what your body does."
          >
            <ChipMulti
              value={state.lean_test_symptoms}
              options={LEAN_TEST_SYMPTOMS}
              onChange={(v) => set("lean_test_symptoms", v)}
            />
          </FG>
        )}

        {/* ── 11c. Post-exertional malaise screen ── */}
        <hr className="fm-divider-thin" style={{ margin: "24px 0 12px" }} />

        <FG
          label="Recovery from exertion"
          optional="tick anything that resonates"
          hint="These patterns change the kind of exercise + pacing I'd suggest, so it matters to know."
        >
          <ChipMulti
            value={state.pem_screen}
            options={PEM_SCREEN}
            onChange={(v) => set("pem_screen", v)}
          />
        </FG>

        {/* ── 11d. Environment — mould + chemical exposure ── */}
        <hr className="fm-divider-thin" style={{ margin: "24px 0 12px" }} />

        <FG
          label="Environmental exposure"
          optional="tick any that apply"
          hint="Mould + chemical exposures are easy to miss but matter for how your body's been coping."
        >
          <ChipMulti
            value={state.mould_exposure}
            options={MOULD_EXPOSURE}
            onChange={(v) => set("mould_exposure", v)}
          />
        </FG>

        {/* Fish question — conditional on non-veg diet. Indian veg / Jain /
            vegan clients almost never eat sea fish, so the question is
            noise for them. */}
        {state.dietary_preference &&
        !["Vegetarian", "Vegetarian Jain", "Jain vegetarian", "Vegan"].includes(
          state.dietary_preference,
        ) ? (
          <FG
            label="How often do you eat large fish?"
            optional="optional"
            hint="Tuna (especially canned albacore), swordfish, king mackerel, shark — these bioaccumulate mercury. Sardines / mackerel / salmon are low-mercury and fine."
          >
            <RadiosColumn
              name="large_fish_frequency"
              value={state.large_fish_frequency}
              options={LARGE_FISH_FREQUENCY}
              onChange={(v) => set("large_fish_frequency", v)}
            />
          </FG>
        ) : null}

        <p className="fm-microcopy" style={{ marginTop: 18 }}>
          We&apos;ll re-check the flexibility + standing pieces together on the
          call — your self-report is a starting point, not the final word.
        </p>
      </FormSection>

      {/* 12. Cycle & hormones (women only) */}
      {isFemale ? (
        <FormSection
          number={SEC_CYCLE}
          totalSections={totalSections}
          sectionRef={setSectionRef(SEC_CYCLE)}
          title="Your cycle, contraception, pregnancies"
          sub="Grouped four ways: cycle, contraception history, pregnancies, and what's been diagnosed."
        >
          {/* Cycle */}
          <FG label="Cycle status">
            <RadiosColumn
              name="cycle_status"
              value={state.cycle_status}
              options={CYCLE_STATUS_OPTIONS}
              onChange={(v) => set("cycle_status", v)}
            />
          </FG>
          {state.cycle_status === "menstruating" || state.cycle_status === "perimenopausal" ? (
            <>
              <div className="fm-row-2">
                <FG label="Last period started">
                  <TextInput
                    type="date"
                    value={state.last_menstrual_period}
                    onChange={(e) => set("last_menstrual_period", e.target.value)}
                  />
                </FG>
                <FG label="Typical cycle length" hint="days">
                  <TextInput
                    type="number"
                    inputMode="numeric"
                    min={15}
                    max={90}
                    value={state.cycle_length_days}
                    onChange={(e) => set("cycle_length_days", e.target.value)}
                    placeholder="e.g. 28"
                  />
                </FG>
              </div>
              <FG label="Cycle regularity">
                <RadiosRow
                  name="cycle_regularity"
                  value={state.cycle_regularity}
                  options={CYCLE_REGULARITY_OPTIONS}
                  onChange={(v) => set("cycle_regularity", v)}
                />
              </FG>
            </>
          ) : null}
          {state.cycle_status !== "postmenopausal" && state.cycle_status !== "surgical_menopause" ? (
            <FG label="Pregnancy / breastfeeding status">
              <RadiosColumn
                name="pregnancy_status"
                value={state.pregnancy_status}
                options={PREGNANCY_STATUS_OPTIONS}
                onChange={(v) => set("pregnancy_status", v)}
              />
            </FG>
          ) : null}

          {/* Period-pain + PMDD only apply when cycles are still happening.
              Hidden for postmenopausal / surgical-menopause users to avoid
              asking about something that no longer exists. */}
          {state.cycle_status === "menstruating" || state.cycle_status === "perimenopausal" ? (
            <>
              <FG label="How bad is your period pain?" hint="1 is barely there, 10 is can't-move-from-the-floor.">
                <GradedSlider
                  value={state.period_pain_severity}
                  onChange={(v) => set("period_pain_severity", v)}
                  min={1}
                  max={10}
                  caption={(v) =>
                    v <= 3 ? "— manageable." : v <= 6 ? "— noticeable." : v <= 8 ? "— bad enough that I plan around it." : "— I can't function."
                  }
                />
              </FG>
              <FG label="How does period pain affect your day?" optional="optional">
                <RadiosRow
                  name="period_pain_impact"
                  value={state.period_pain_impact}
                  options={PERIOD_PAIN_IMPACT}
                  onChange={(v) => set("period_pain_impact", v)}
                />
              </FG>
              <FG label="PMDD signs?" optional="optional">
                <RadiosRow
                  name="pmdd_signs"
                  value={state.pmdd_signs}
                  options={PMDD}
                  onChange={(v) => set("pmdd_signs", v)}
                />
              </FG>
            </>
          ) : null}

          {/* Postmenopausal hint — shifts the section's focus from cycle
              specifics to lifetime hormonal history + postmeno symptoms.
              The contraception + pregnancy repeaters and repro_diagnoses
              chip group below ARE relevant lifelong and stay visible. */}
          {(state.cycle_status === "postmenopausal" || state.cycle_status === "surgical_menopause") ? (
            <FG
              label="When did your periods stop?"
              hint="Roughly — year is fine. Skip if you'd rather discuss in person."
            >
              <TextInput
                type="text"
                value={state.menopause_started ?? ""}
                onChange={(e) => set("menopause_started", e.target.value)}
                placeholder="e.g. 2019 or around age 51"
              />
            </FG>
          ) : null}

          <hr className="fm-divider-thin" style={{ margin: "24px 0 8px" }} />

          {/* Contraception history repeater */}
          <div className="fm-fg">
            <label className="fm-fg__label">Contraception history</label>
            <span className="fm-fg__hint">
              Every method you&apos;ve used long enough to notice an effect — pill, IUD, implant,
              anything. In rough order.
            </span>

            {state.contraception_history.map((row, i) => (
              <div key={i} className="fm-repcard">
                <div className="fm-repcard__head">
                  <span className="fm-repcard__num">
                    <em>{String(i + 1).padStart(2, "0")}</em>contraception
                  </span>
                  <button
                    type="button"
                    className="fm-repcard__remove"
                    onClick={() => removeContraception(i)}
                    aria-label="Remove row"
                  >
                    remove
                  </button>
                </div>
                <div className="fm-repcard__grid">
                  <div className="fm-repcard__full">
                    <span className="fm-medcard__minilabel">Type</span>
                    <select
                      className="fm-select"
                      value={row.type}
                      onChange={(e) => updateContraception(i, { type: e.target.value })}
                    >
                      <option value="">Select…</option>
                      {CONTRACEPTION_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="fm-medcard__minilabel">Started</span>
                    <input
                      className={"fm-input" + (row.started_year ? " fm-input--filled" : "")}
                      type="number"
                      inputMode="numeric"
                      value={row.started_year}
                      onChange={(e) => updateContraception(i, { started_year: e.target.value })}
                      placeholder="year"
                    />
                  </div>
                  <div>
                    <span className="fm-medcard__minilabel">Stopped</span>
                    <input
                      className={"fm-input" + (row.stopped_year ? " fm-input--filled" : "")}
                      value={row.stopped_year}
                      onChange={(e) => updateContraception(i, { stopped_year: e.target.value })}
                      placeholder="year or — still on it"
                    />
                  </div>
                  <div className="fm-repcard__full">
                    <span className="fm-medcard__minilabel">Side effects</span>
                    <ChipInput
                      value={row.side_effects}
                      onChange={(v) => updateContraception(i, { side_effects: v })}
                      placeholder="e.g. mood lower"
                    />
                  </div>
                </div>
              </div>
            ))}

            <button type="button" onClick={addContraception} className="fm-add">
              <span className="pulse" aria-hidden="true" />
              add another method
            </button>
          </div>

          {/* Pregnancies repeater */}
          <div className="fm-fg">
            <label className="fm-fg__label">Pregnancies</label>
            <span className="fm-fg__hint">
              Every pregnancy, including any that didn&apos;t continue. The body remembers them,
              so I&apos;d like to know.
            </span>

            {state.pregnancies.map((row, i) => (
              <div key={i} className="fm-repcard">
                <div className="fm-repcard__head">
                  <span className="fm-repcard__num">
                    <em>{String(i + 1).padStart(2, "0")}</em>pregnancy
                  </span>
                  <button
                    type="button"
                    className="fm-repcard__remove"
                    onClick={() => removePregnancy(i)}
                    aria-label="Remove row"
                  >
                    remove
                  </button>
                </div>
                <div className="fm-repcard__grid">
                  <div>
                    <span className="fm-medcard__minilabel">Year</span>
                    <input
                      className={"fm-input" + (row.year ? " fm-input--filled" : "")}
                      type="number"
                      inputMode="numeric"
                      value={row.year}
                      onChange={(e) => updatePregnancy(i, { year: e.target.value })}
                      placeholder="YYYY"
                    />
                  </div>
                  <div>
                    <span className="fm-medcard__minilabel">Outcome</span>
                    <select
                      className="fm-select"
                      value={row.outcome}
                      onChange={(e) => updatePregnancy(i, { outcome: e.target.value })}
                    >
                      <option value="">Select…</option>
                      {PREG_OUTCOMES.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="fm-repcard__full">
                    <span className="fm-medcard__minilabel">Complications</span>
                    <ChipMulti
                      value={row.complications}
                      options={PREG_COMPLICATIONS}
                      onChange={(v) => updatePregnancy(i, { complications: v })}
                      xs
                    />
                  </div>
                  <div>
                    <span className="fm-medcard__minilabel">Birth type</span>
                    <select
                      className="fm-select"
                      value={row.birth_type}
                      onChange={(e) => updatePregnancy(i, { birth_type: e.target.value })}
                    >
                      <option value="">Select…</option>
                      {BIRTH_TYPES.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="fm-medcard__minilabel">Breastfed, months</span>
                    <input
                      className={"fm-input" + (row.breastfeeding_months ? " fm-input--filled" : "")}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={60}
                      value={row.breastfeeding_months}
                      onChange={(e) =>
                        updatePregnancy(i, { breastfeeding_months: e.target.value })
                      }
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>
            ))}

            <button type="button" onClick={addPregnancy} className="fm-add">
              <span className="pulse" aria-hidden="true" />
              add another pregnancy
            </button>
          </div>

          <hr className="fm-divider-thin" style={{ margin: "24px 0 8px" }} />

          {/* Diagnoses */}
          <FG label="Reproductive diagnoses" optional="tick all that apply">
            <ChipMulti
              value={state.repro_diagnoses}
              options={REPRO_DIAGNOSES}
              onChange={(v) => set("repro_diagnoses", v)}
            />
          </FG>

          {/* v0.75.5 Endometriosis screen — avg 7-10y diagnostic delay
              for endo. Catching the pattern from intake is high-yield even
              for post-menopausal women (retrospective signal informs
              current pelvic-inflammation framing). */}
          <FG
            label="Period + pelvic pattern (now or in the past)"
            optional="tick all that apply"
            hint="Even if you're past your periods, ticking what was true historically helps me read the bigger picture."
          >
            <ChipMulti
              value={state.endometriosis_signals}
              options={ENDOMETRIOSIS_SIGNALS}
              onChange={(v) => set("endometriosis_signals", v)}
            />
          </FG>

          {/* Perimenopause inventory only when cycles are still happening
              or just stopped (post-meno can be transitional). Repurpose the
              same chip list for "what symptoms persist?" framing post-meno. */}
          {state.cycle_status !== "not_applicable" ? (
            <FG
              label={
                state.cycle_status === "postmenopausal" || state.cycle_status === "surgical_menopause"
                  ? "Postmenopausal symptoms still bothering you"
                  : "Perimenopause inventory"
              }
              optional="tick all that apply"
            >
              <ChipMulti
                value={state.perimenopause_inventory}
                options={PERIMENOPAUSE_INVENTORY}
                onChange={(v) => set("perimenopause_inventory", v)}
              />
            </FG>
          ) : null}

          <p className="fm-foot">
            You can leave any of this blank if you&apos;d rather talk through it in person —
            nothing is required.
          </p>
        </FormSection>
      ) : null}

      {/* Readiness */}
      <FormSection
        number={SEC_READINESS}
        totalSections={totalSections}
        sectionRef={setSectionRef(SEC_READINESS)}
        title="Recent labs & how ready you feel"
        sub="So I know what's already on file and how to pace this."
        soft
      >
        <FG label="What were the last labs you had done?" optional="tick all you remember">
          <ChipMulti
            value={state.recent_labs_done}
            options={RECENT_LABS}
            onChange={(v) => set("recent_labs_done", v)}
          />
        </FG>
        <FG label="Roughly when?" optional="optional">
          <TextInput
            type="text"
            value={state.recent_labs_when}
            onChange={(e) => set("recent_labs_when", e.target.value)}
            placeholder="e.g. last 3 months, last year"
          />
        </FG>
        <FG label="Happy to share those results with me?" optional="optional">
          <RadiosColumn
            name="willing_to_share_labs"
            value={state.willing_to_share_labs}
            options={WILLING_SHARE_LABS}
            onChange={(v) => set("willing_to_share_labs", v)}
          />
        </FG>
        <FG
          label="How confident do you feel about making changes right now?"
          hint="1 = not at all · 10 = let's go."
        >
          <GradedSlider
            value={state.readiness_confidence}
            onChange={(v) => set("readiness_confidence", v)}
            min={1}
            max={10}
            caption={(v) =>
              v <= 3 ? "— I'd need a lot of support." : v <= 6 ? "— I can do small things." : v <= 8 ? "— I'm ready to commit." : "— let's go."
            }
          />
        </FG>
      </FormSection>

      {/* Anything else */}
      <FormSection
        number={SEC_NOTES}
        totalSections={totalSections}
        sectionRef={setSectionRef(SEC_NOTES)}
        title="Anything else"
        sub="Anything that didn't fit anywhere above."
      >
        <FG label="Notes for Shivani" optional="optional">
          <TextArea
            rows={4}
            value={state.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Anything you'd like her to have before our session."
          />
        </FG>
      </FormSection>

      {/* Consent + submit */}
      <FormSection
        number={SEC_CONSENT}
        totalSections={totalSections}
        sectionRef={setSectionRef(SEC_CONSENT)}
        eyebrow={`Section ${String(SEC_CONSENT).padStart(2, "0")} · the last bit`}
        title="One thing before you send"
        sub="So we're both clear on how this works."
        soft
      >
        <label className={"fm-consent" + (state.consent ? " fm-consent--on" : "")}>
          <input
            type="checkbox"
            checked={state.consent}
            onChange={(e) => set("consent", e.target.checked)}
          />
          <span className="fm-consent__box" aria-hidden="true" />
          <span className="fm-consent__text">
            <strong>I understand</strong> this information is private and confidential, and
            will not be used in any manner except to help with my care.
          </span>
        </label>

        {submitError ? (
          <p
            style={{
              fontSize: 13,
              color: "var(--rose)",
              marginBottom: 16,
              fontStyle: "italic",
              fontFamily: "var(--font-display)",
            }}
          >
            {submitError}
          </p>
        ) : null}

        <button
          type="submit"
          className="fm-submit"
          disabled={!state.consent || submitting}
          style={!state.consent || submitting ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
        <span className="fm-submit__sub">
          You can keep editing until our session begins.
        </span>
      </FormSection>
    </form>
  );
}
