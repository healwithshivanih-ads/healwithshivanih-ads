/**
 * Static option lists for the intake form (Codex audit #6 — file split).
 *
 * Pure inert data extracted verbatim from intake-form.tsx to shrink the
 * ~5,000-line component. No logic, no React — just the dropdown / chip option
 * arrays each form section renders. MED_BUCKETS / MED_KEYS stay in the form
 * (they depend on its FormState type).
 */

export const BRISTOL_TYPES = [
  { n: 1, label: "Separate hard lumps, like nuts" },
  { n: 2, label: "Sausage-shaped but lumpy" },
  { n: 3, label: "Sausage-shaped with cracks on the surface" },
  { n: 4, label: "Smooth, soft, sausage-shaped" },
  { n: 5, label: "Soft blobs with clear-cut edges" },
  { n: 6, label: "Fluffy pieces with ragged edges, mushy" },
  { n: 7, label: "Watery, no solid pieces" },
];

export const BOWEL_PATTERN = [
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

export const CONTRACEPTION_TYPES = [
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

export const PREG_COMPLICATIONS = [
  "gestational diabetes",
  "pre-eclampsia",
  "gestational hypertension",
  "hyperemesis",
  "postpartum thyroiditis",
  "postpartum depression",
  "anaemia",
  "other",
];

export const PREG_OUTCOMES = ["live birth", "miscarriage", "termination", "stillbirth"];
export const BIRTH_TYPES = ["vaginal", "C-section", "forceps", "N/A"];

// ── Option lists (radio + chip) ─────────────────────────────────────────────

export const WEIGHT_TREND_OPTIONS = [
  { value: "stable", label: "Stable" },
  { value: "gaining_slowly", label: "Gaining slowly" },
  { value: "losing_slowly", label: "Losing slowly" },
  { value: "fluctuating", label: "Fluctuating" },
  { value: "changed_sharply", label: "Recently changed sharply" },
];

export const WORK_PATTERN_OPTIONS = [
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

export const FAMILY_SPECIFIC_CONDITIONS = [
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

export const COVID_HISTORY = [
  "never tested positive",
  "one mild infection",
  "multiple infections",
  "hospitalised",
  "long-COVID symptoms now",
  "long-COVID symptoms past, resolved",
];

export const COVID_LONG_SYMPTOMS = [
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

export const COVID_VAX_HISTORY = ["not vaccinated", "1 dose", "2 doses", "1 booster", "2+ boosters", "unsure"];
export const COVID_VAX_BRAND = ["Covishield (AstraZeneca)", "Covaxin", "Pfizer", "Moderna", "Sputnik", "Novavax", "other", "unsure"];
export const COVID_VAX_REACTIONS = [
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

export const POSTPRANDIAL = [
  "sleepy after meals",
  "brain fog after meals",
  "energy crash",
  "hungry again within 2hrs",
  "great energy",
  "depends on the meal",
];
export const COLD_HEAT_TOLERANCE = [
  { value: "always_cold", label: "Always cold" },
  { value: "always_hot", label: "Always hot" },
  { value: "normal", label: "Normal" },
  { value: "hot_flushes", label: "Hot flushes" },
  { value: "runs_hot_evenings", label: "Runs hot in evenings" },
];

export const TIME_TO_FALL_ASLEEP = [
  { value: "under_15", label: "Under 15 min" },
  { value: "15_30", label: "15–30 min" },
  { value: "30_60", label: "30–60 min" },
  { value: "60_plus", label: "60+ min" },
];
export const WAKE_TIME_PATTERN = [
  "sleep through",
  "wake around 3am consistently",
  "wake around 5am consistently",
  "wake multiple times",
  "wake unrefreshed",
  "wake to urinate",
];
export const SNORE_OR_APNOEA = [
  { value: "no", label: "No" },
  { value: "sometimes", label: "Sometimes" },
  { value: "often", label: "Often" },
  { value: "diagnosed", label: "Diagnosed apnoea" },
  { value: "cpap", label: "Use CPAP" },
];
export const RESTLESS_LEGS = [
  { value: "no", label: "No" },
  { value: "mild", label: "Mild" },
  { value: "disrupts", label: "Disrupts sleep" },
];
export const SLEEP_TRACKER = [
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
export const CGM_OWNED = [
  { value: "current", label: "Yes — current" },
  { value: "past", label: "Yes — past" },
  { value: "no", label: "No" },
  { value: "interested", label: "Interested" },
];

export const ENERGY_CRASHES = [
  "never",
  "after meals",
  "mid-afternoon",
  "after caffeine wears off",
  "before periods",
  "after exercise",
  "after sugar",
];
export const CAFFEINE_DEPENDENCY = [
  { value: "none", label: "None" },
  { value: "fine_without", label: "Drink it but fine without" },
  { value: "need_it", label: "Need it to function" },
  { value: "headaches", label: "Headaches without it" },
];
export const MORNING_STATE = [
  { value: "jump_out", label: "Jump out of bed" },
  { value: "after_coffee", label: "Fine after coffee" },
  { value: "sluggish", label: "Sluggish 1–2 hours" },
  { value: "hard_to_wake", label: "Hard to wake at all" },
];

export const SUN_EXPOSURE = [
  { value: "under_15", label: "Under 15 min" },
  { value: "15_60", label: "15–60 min" },
  { value: "1_2", label: "1–2 hrs" },
  { value: "2_plus", label: "2+ hrs" },
  { value: "varies", label: "Varies a lot" },
];
export const SUNSCREEN_USE = [
  { value: "daily_face", label: "Daily on face" },
  { value: "occasionally", label: "Occasionally" },
  { value: "never", label: "Never" },
  { value: "beach_only", label: "Only at the beach" },
];
export const VIT_D_SUPPLEMENT = [
  { value: "daily", label: "Yes — daily" },
  { value: "sometimes", label: "Yes — sometimes" },
  { value: "no", label: "No" },
  { value: "not_sure", label: "Not sure" },
];
export const BAREFOOT_OUTDOORS = [
  { value: "regularly", label: "Regularly" },
  { value: "occasionally", label: "Occasionally" },
  { value: "never", label: "Never" },
];

// Body systems
export const HAIR_LOSS = [
  { value: "no_loss", label: "No loss" },
  { value: "diffuse_thinning", label: "Diffuse thinning all over" },
  { value: "widening_part", label: "Widening part" },
  { value: "receding", label: "Receding hairline" },
  { value: "patchy", label: "Patchy" },
  { value: "clumps_shower", label: "Clumps in shower" },
  { value: "stress_only", label: "Only with stress" },
];
export const HAIR_TEXTURE = [
  { value: "no_change", label: "No change" },
  { value: "coarser", label: "Coarser" },
  { value: "finer", label: "Finer" },
  { value: "drier", label: "Drier" },
  { value: "oilier", label: "Oilier" },
  { value: "brittle", label: "More brittle" },
  { value: "grey_under_30", label: "Grey under 30" },
];
export const HAIR_OTHER = [
  "itchy scalp",
  "dandruff",
  "oily roots",
  "dry ends",
  "facial hair in women (chin or lip)",
  "body hair thinning",
  "new facial hair where there wasn't",
];
export const NAIL_SIGNS = [
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
export const ACNE_PATTERN = [
  "no acne",
  "chin or jawline",
  "forehead and T-zone",
  "back or chest",
  "cyclical with period",
  "cystic",
  "hyperpigmentation after spots heal",
];
export const SKIN_SIGNS = [
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
export const HEADACHE_TYPE = [
  "tension band",
  "migraine with aura",
  "migraine without aura",
  "cluster",
  "sinus",
  "period-linked",
  "morning",
  "evening",
];
export const PAIN_PATTERN = [
  "worse in morning",
  "worse in evening",
  "worse with movement",
  "worse at rest",
  "wakes me at night",
  "better with heat",
  "better with cold",
];
export const PAIN_QUALITY = [
  "dull ache",
  "sharp",
  "burning",
  "throbbing",
  "pins and needles or tingling",
  "electric or shooting",
  "cramping",
  "stiffness",
];
export const BELLY_FAT = [
  { value: "none", label: "No concerns" },
  { value: "new_belly", label: "New belly fat" },
  { value: "always_belly", label: "Always had belly fat" },
  { value: "pear", label: "Pear-shape (hips and thighs)" },
  { value: "face_changed", label: "Face has changed shape" },
];
export const HISTAMINE = [
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
export const CHEMICAL_SENSITIVITY = [
  "perfumes give headaches",
  "can't be near cleaning products",
  "strong hangovers",
  "sensitive to alcohol",
  "sensitive to medication side effects more than others",
  "metal allergies",
];
// Tolerance-decline signal — things the client used to handle that now bother
// them. A Phase I/II biotransformation capacity-decline clue that the rest of
// the form only captures in the present tense. Feeds detectLiverDetoxAdvisory.
export const TOLERANCE_CHANGES = [
  "coffee / caffeine",
  "alcohol",
  "fatty or fried food",
  "perfumes / strong smells",
  "certain medications or supplements",
  "none — no real change",
];
// v0.75.2 — Tier 1 screening chip option constants ─────────────────────────
export const BEIGHTON_SELF = [
  "pinky finger bends back past 90°",
  "thumb touches inside of forearm",
  "elbow bends backwards past straight",
  "knee bends backwards past straight",
  "palms flat on floor with knees locked straight",
];
export const BEIGHTON_SUPPLEMENTAL = [
  "I've been called 'double-jointed' or 'very flexible'",
  "I dislocate / subluxate joints sometimes",
  "I have stretchy or fragile skin",
  "I bruise easily / unexplained bruises",
];
export const HR_DEVICES = [
  "Smartwatch (Apple Watch, Fitbit, Garmin, Whoop)",
  "Smart ring (Oura, Ultrahuman, Ringconn)",
  "Home blood-pressure monitor (most cuffs show HR)",
  "Fingertip pulse oximeter",
  "Chest strap (Polar, Wahoo)",
  "Phone app only (less accurate but I'll use one)",
  "None of the above",
];
export const LEAN_TEST_SYMPTOMS = [
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
export const PEM_SCREEN = [
  "I crash for hours or days after exertion that used to feel normal",
  "Exercise that should help me leaves me wiped out for 24-48h",
  "Stress / emotional days knock me out the next day",
  "I have to ration my energy — pacing is the only thing that works",
  "I used to push through and can't any more",
];
export const MOULD_EXPOSURE = [
  "current/past home with visible mould",
  "current/past home with a leak that wasn't fully dried in 48h",
  "musty / damp smell in any room I spend time in",
  "I feel worse on damp or humid days",
  "worked with paints / solvents / pesticides regularly",
  "dental amalgam removal in last 5 years",
];
export const LARGE_FISH_FREQUENCY = [
  { value: "never", label: "Never / not applicable" },
  { value: "rarely", label: "Rarely (a few times a year)" },
  { value: "weekly", label: "Once a week or so" },
  { value: "multiple_weekly", label: "Multiple times a week" },
];

// v0.75.5 — Tier 2 screening chip option constants ─────────────────────────
// ACE-lite — sensitively framed; coach reads patterns, never asks for an
// explicit ACE score. The chips capture both *historical* adversity and
// *current* nervous-system patterns (hypervigilance, dissociation).
export const ACE_SIGNALS = [
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
export const STOP_BANG_SIGNALS = [
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
export const ENDOMETRIOSIS_SIGNALS = [
  "period pain bad enough to miss work / school / plans (now or in the past)",
  "pain during or after sex",
  "pain emptying bladder or bowels around my period",
  "heavy periods or clots larger than a 50p / ₹20 coin",
  "family history of endometriosis / adenomyosis / fibroids",
  "diagnosed endometriosis / adenomyosis / fibroids",
];

export const ORAL_SIGNS = [
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

export const EYE_SIGNS = [
  "Dry, gritty or burning eyes",
  "Eyes tire or strain easily",
  "Blurring or changes in vision",
  "Night vision worse than before",
  "Floaters",
  "Light sensitivity",
  "No concerns",
];

// Lifestyle exposures — smoking / tobacco + alcohol
export const SMOKING_STATUS = [
  { value: "Never", label: "Never" },
  { value: "Former — I quit", label: "Former — I quit" },
  { value: "Currently smoke or vape", label: "Currently smoke or vape" },
  { value: "I chew tobacco / gutka / paan", label: "I chew tobacco / gutka / paan" },
  { value: "Prefer not to say", label: "Prefer not to say" },
];
export const ALCOHOL_INTAKE = [
  { value: "None", label: "None" },
  { value: "Occasional (a few times a month)", label: "Occasional (a few times a month)" },
  { value: "Weekly (1–7 drinks a week)", label: "Weekly (1–7 drinks a week)" },
  { value: "Most days", label: "Most days" },
  { value: "Prefer not to say", label: "Prefer not to say" },
];

// Current mental-health care (sensitively framed)
export const MENTAL_HEALTH_CARE = [
  { value: "No", label: "No" },
  { value: "Yes — seeing a therapist/counsellor", label: "Yes — seeing a therapist/counsellor" },
  { value: "Yes — under a psychiatrist", label: "Yes — under a psychiatrist" },
  { value: "Yes — both", label: "Yes — both" },
  { value: "Prefer not to say", label: "Prefer not to say" },
];

// Intimate / urinary health (women only)
export const VAGINAL_SIGNS = [
  "Unusual or increased discharge",
  "Thick white discharge (crumbly, like paneer / cottage cheese)",
  "Greyish discharge with a fishy smell",
  "Itching or irritation around the vaginal area",
  "Frequent yeast / fungal infections",
  "Frequent urine infections (UTIs)",
  "Vaginal dryness",
  "Discomfort or pain during sex",
  "None of these",
  "Prefer to discuss in person",
];
export const VAGINAL_YEAST_FREQUENCY = [
  { value: "Never / rarely", label: "Never / rarely" },
  { value: "About once in the past year", label: "About once in the past year" },
  { value: "2–3 times in the past year", label: "2–3 times in the past year" },
  { value: "4 or more times in the past year", label: "4 or more times in the past year" },
  { value: "Not sure", label: "Not sure" },
];

// Periods
export const PERIOD_PAIN_IMPACT = [
  { value: "none", label: "Doesn't affect my day" },
  { value: "inconvenient", label: "Inconvenient" },
  { value: "miss_work", label: "I miss work or sleep" },
  { value: "debilitating", label: "Debilitating" },
];
export const PMDD = [
  { value: "no", label: "No" },
  { value: "suspect", label: "Suspect" },
  { value: "diagnosed", label: "Diagnosed" },
];
export const REPRO_DIAGNOSES = [
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
export const PERIMENOPAUSE_INVENTORY = [
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
export const RECENT_LABS = [
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
export const WILLING_SHARE_LABS = [
  { value: "yes", label: "Yes — happy to" },
  { value: "if_needed", label: "Yes — if needed" },
  { value: "prefer_not", label: "Would prefer not" },
  { value: "no_labs", label: "No labs to share" },
];
export const WILLING_TEST_FURTHER = [
  { value: "yes", label: "Yes" },
  { value: "depends", label: "Depends on cost" },
  { value: "no", label: "No" },
  { value: "not_sure", label: "Not sure" },
];

export const TIMELINE_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "symptom_onset", label: "Symptom started" },
  { value: "life_event", label: "Life event / stress" },
  { value: "treatment", label: "Treatment" },
  { value: "diagnosis", label: "Diagnosis" },
  { value: "stress", label: "Stress" },
  { value: "recovery", label: "Recovery" },
  { value: "surgery", label: "Surgery" },
  { value: "medication_change", label: "Medication change" },
];

export const DIETARY_OPTIONS = [
  "Vegetarian",
  "Jain vegetarian",
  "Non-vegetarian",
  "Vegan",
  "Eggetarian",
  "Pescatarian",
  "Other",
];

export const CYCLE_STATUS_OPTIONS = [
  { value: "menstruating", label: "Still menstruating" },
  { value: "perimenopausal", label: "Perimenopausal" },
  { value: "postmenopausal", label: "Postmenopausal" },
  { value: "not_applicable", label: "Not applicable" },
];

export const CYCLE_REGULARITY_OPTIONS = [
  { value: "regular", label: "Regular" },
  { value: "irregular", label: "Irregular" },
  { value: "very_irregular", label: "Very irregular" },
];

export const PREGNANCY_STATUS_OPTIONS = [
  { value: "not_pregnant", label: "Not pregnant" },
  { value: "trying_to_conceive", label: "Trying to conceive" },
  { value: "pregnant", label: "Currently pregnant" },
  { value: "lactating", label: "Currently breastfeeding" },
  { value: "postpartum", label: "Postpartum (last 12 mo)" },
];
