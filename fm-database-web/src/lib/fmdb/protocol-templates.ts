/**
 * Protocol templates — pre-built condition-specific plan starters.
 * Each template populates multiple plan fields at once.
 * Applied as a MERGE (union with existing data), never a replace.
 */

export interface ProtocolSupplement {
  supplement_slug: string;
  display_name: string;
  dose_display?: string;
  timing?: string;
  coach_rationale?: string;
}

export interface ProtocolTemplate {
  id: string;
  display_name: string;
  icon: string;
  description: string;
  /** Catalogue topic slugs */
  primary_topics: string[];
  contributing_topics?: string[];
  /** Catalogue symptom slugs */
  presenting_symptoms?: string[];
  supplements: ProtocolSupplement[];
  nutrition_add: string[];
  nutrition_reduce: string[];
  nutrition_pattern?: string;
  lifestyle_practices: { name: string; cadence: string; details?: string }[];
  tracking_habits: { name: string; cadence: string }[];
  tracking_symptoms: string[];
  lab_orders?: { test: string; reason?: string }[];
}

export const PROTOCOL_TEMPLATES: ProtocolTemplate[] = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "leaky-gut",
    display_name: "Leaky Gut / Intestinal Permeability",
    icon: "🫀",
    description: "4-phase gut repair: remove triggers → restore microbiome → repair lining → reintroduce",
    primary_topics: ["leaky-gut", "gut-microbiome"],
    contributing_topics: ["dysbiosis", "chronic-inflammation", "food-sensitivities"],
    presenting_symptoms: ["bloating", "food-sensitivities", "fatigue", "gas"],
    supplements: [
      {
        supplement_slug: "l-glutamine",
        display_name: "L-Glutamine",
        dose_display: "5 g powder",
        timing: "First thing in morning on empty stomach, dissolved in water",
        coach_rationale: "Primary fuel for gut lining cells — accelerates tight-junction repair",
      },
      {
        supplement_slug: "zinc-carnosine",
        display_name: "Zinc Carnosine",
        dose_display: "75 mg",
        timing: "With meals twice daily",
        coach_rationale: "Stabilises gut lining, reduces inflammation, supports tissue healing",
      },
      {
        supplement_slug: "probiotic",
        display_name: "Probiotic (VitaSpore)",
        dose_display: "1 capsule",
        timing: "With breakfast",
        coach_rationale: "Restores microbial diversity and crowds out dysbiotic bacteria",
      },
      {
        supplement_slug: "digestive-enzymes",
        display_name: "Digestive Enzymes",
        dose_display: "1–2 capsules",
        timing: "With main meals",
        coach_rationale: "Reduces undigested food particles that trigger immune activation",
      },
    ],
    nutrition_add: [
      "Bone broth (homemade — 1 cup daily, especially in Phase 1)",
      "Fermented foods: coconut curd, homemade kanji, small amounts of kimchi",
      "Cooked vegetables over raw (easier on inflamed gut lining)",
      "Collagen-rich foods: slow-cooked dals, stews",
      "Prebiotic foods: cooked and cooled rice, banana, oats",
    ],
    nutrition_reduce: [
      "Gluten (wheat, maida, bread, pasta)",
      "Cow's milk dairy (swap to ghee, coconut milk, A2 curd in small amounts)",
      "Refined sugar and ultra-processed snacks",
      "Alcohol",
      "NSAIDs / ibuprofen (discuss with doctor)",
      "Raw salads and hard-to-digest raw vegetables in first 4 weeks",
    ],
    nutrition_pattern: "Anti-inflammatory, gut-healing — cooked whole foods, limited raw, bone broth daily",
    lifestyle_practices: [
      {
        name: "Stress management — daily practice",
        cadence: "Daily",
        details: "10 min diaphragmatic breathing or yoga nidra. Chronic stress directly increases intestinal permeability via cortisol.",
      },
      {
        name: "Chew food thoroughly",
        cadence: "Every meal",
        details: "20–30 chews per mouthful. Digestion starts in the mouth — reduces undigested particle load in the gut.",
      },
      {
        name: "No eating within 3 hours of bed",
        cadence: "Daily",
        details: "Supports gut motility (migrating motor complex) that cleans the gut between meals.",
      },
      {
        name: "Sleep 7–8 hours",
        cadence: "Nightly",
        details: "Gut lining repairs during sleep. Poor sleep alone increases permeability.",
      },
    ],
    tracking_habits: [
      { name: "Bowel movement quality (Bristol scale 3–4)", cadence: "Daily" },
      { name: "Bloating level (1–10)", cadence: "Daily" },
      { name: "Food reactions journal", cadence: "Daily" },
    ],
    tracking_symptoms: ["bloating", "gas", "fatigue", "skin-rash", "brain-fog"],
    lab_orders: [
      { test: "Stool test (GI-MAP or similar)", reason: "Identify dysbiosis, parasites, H. pylori, secretory IgA" },
      { test: "Zonulin (serum)", reason: "Marker of intestinal permeability" },
      { test: "hsCRP", reason: "Systemic inflammation baseline" },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "thyroid-hashimotos",
    display_name: "Thyroid Support (Hashimoto's / Hypothyroid)",
    icon: "🦋",
    description: "Reduce antibodies, support T4→T3 conversion, address root triggers",
    primary_topics: ["thyroid-dysfunction", "autoimmune-thyroiditis"],
    contributing_topics: ["leaky-gut", "chronic-inflammation", "adrenal-dysfunction"],
    presenting_symptoms: ["fatigue", "brain-fog", "weight-gain", "constipation"],
    supplements: [
      {
        supplement_slug: "selenium",
        display_name: "Selenium",
        dose_display: "200 mcg",
        timing: "With breakfast",
        coach_rationale: "Reduces TPO and TgAb antibodies, essential for T4→T3 conversion via deiodinase enzymes",
      },
      {
        supplement_slug: "vitamin-d",
        display_name: "Vitamin D3 + K2",
        dose_display: "2000–5000 IU (based on blood level)",
        timing: "With largest meal",
        coach_rationale: "Vitamin D deficiency is strongly linked to autoimmune thyroid disease and antibody elevation",
      },
      {
        supplement_slug: "magnesium-glycinate",
        display_name: "Magnesium Glycinate",
        dose_display: "300–400 mg",
        timing: "Before bed",
        coach_rationale: "Required for T4 synthesis; supports sleep and stress response (HPA axis affects thyroid)",
      },
      {
        supplement_slug: "zinc",
        display_name: "Zinc Carnosine",
        dose_display: "30 mg elemental zinc",
        timing: "With dinner",
        coach_rationale: "Required for TSH signalling and T4 production; commonly depleted in Hashimoto's",
      },
    ],
    nutrition_add: [
      "Brazil nuts (2–3 per day — natural selenium source)",
      "Wild-caught fish 3× week (selenium, omega-3, iodine)",
      "Cooked cruciferous vegetables (cooking deactivates goitrogens)",
      "Liver or organ meats monthly (B12, zinc, copper co-factors)",
      "Bone broth (gut lining — autoimmune leaky gut connection)",
    ],
    nutrition_reduce: [
      "Gluten (strong Hashimoto's–gluten cross-reactivity evidence)",
      "Raw cruciferous vegetables in large amounts (goitrogenic when raw)",
      "Soy in large quantities (phytoestrogen impact on thyroid binding)",
      "Refined sugar (spikes inflammation, worsens antibodies)",
      "Excess iodine from supplements (can worsen Hashimoto's flares)",
    ],
    nutrition_pattern: "Gluten-free, anti-inflammatory, selenium-rich whole foods",
    lifestyle_practices: [
      {
        name: "Stress reduction — daily",
        cadence: "Daily",
        details: "HPA-axis dysregulation directly suppresses T3 conversion. 15 min gentle yoga, meditation, or nature walk.",
      },
      {
        name: "Avoid high-intensity cardio during flares",
        cadence: "Ongoing",
        details: "Excess cortisol from HIIT suppresses T3. Favour strength training, walking, yoga, Pilates.",
      },
      {
        name: "Sleep before 10:30 PM",
        cadence: "Nightly",
        details: "TSH peaks between 11 PM–2 AM. Poor sleep disrupts the thyroid–pituitary axis.",
      },
    ],
    tracking_habits: [
      { name: "Energy level (1–10)", cadence: "Daily" },
      { name: "Morning resting temperature (if tracking)", cadence: "Daily" },
      { name: "Bowel regularity", cadence: "Daily" },
    ],
    tracking_symptoms: ["fatigue", "brain-fog", "constipation", "weight-gain", "hair-loss"],
    lab_orders: [
      { test: "TSH, Free T3, Free T4", reason: "Baseline and conversion ratio tracking" },
      { test: "TPO antibodies, TgAb", reason: "Autoimmune activity — target reduction over 6 months" },
      { test: "Selenium (serum)", reason: "Confirm deficiency before supplementing" },
      { test: "Vitamin D (25-OH)", reason: "Optimise to 60–80 ng/mL for immune modulation" },
      { test: "Ferritin", reason: "Iron deficiency impairs T4→T3 conversion" },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "blood-sugar-insulin-resistance",
    display_name: "Blood Sugar & Insulin Resistance",
    icon: "🍬",
    description: "Stabilise glucose, improve insulin sensitivity, reduce HbA1c drift",
    primary_topics: ["blood-sugar-dysfunction", "insulin-resistance"],
    contributing_topics: ["chronic-inflammation", "gut-microbiome", "visceral-adiposity"],
    presenting_symptoms: ["fatigue", "brain-fog", "weight-gain", "sugar-cravings"],
    supplements: [
      {
        supplement_slug: "berberine",
        display_name: "Berberine (Liposomal)",
        dose_display: "500 mg",
        timing: "With meals, twice daily",
        coach_rationale: "Activates AMPK pathway — comparable to metformin for glucose and insulin sensitivity. Use berberine periods of 8 weeks on, 4 weeks off.",
      },
      {
        supplement_slug: "magnesium-glycinate",
        display_name: "Magnesium Glycinate",
        dose_display: "300 mg",
        timing: "Before bed",
        coach_rationale: "Magnesium is required for insulin receptor signalling — deficiency worsens insulin resistance",
      },
      {
        supplement_slug: "alpha-lipoic-acid",
        display_name: "Alpha R-Lipoic Acid",
        dose_display: "300 mg",
        timing: "Before meals",
        coach_rationale: "Enhances glucose uptake into cells and reduces oxidative stress from glycation",
      },
    ],
    nutrition_add: [
      "Protein at every meal (20–30 g) — blunts post-meal glucose spike",
      "Fibre before starch: eat salad/vegetables before rice or roti",
      "Apple cider vinegar (1 tsp in water before meals — reduces glucose spike ~20%)",
      "Cinnamon (½ tsp daily in food or tea)",
      "Legumes daily: dals, channa, rajma (low glycaemic, high fibre)",
      "Nuts and seeds as snack (not fruit alone)",
    ],
    nutrition_reduce: [
      "White rice portions — swap to smaller portions + cooled rice (resistant starch)",
      "Fruit juice and smoothies (no fibre, glucose spike)",
      "Refined carbohydrates: maida, white bread, biscuits, namkeen",
      "Sugar in chai (reduce gradually — jaggery in moderation)",
      "Eating carbohydrates alone (always pair with protein or fat)",
      "Late-night eating (glucose tolerance is worst after 8 PM)",
    ],
    nutrition_pattern: "Low-glycaemic, high-protein, high-fibre — plate sequencing: vegetables → protein → starch",
    lifestyle_practices: [
      {
        name: "10-minute walk after every meal",
        cadence: "After each meal",
        details: "Post-meal muscle contraction is the most effective single intervention for blunting glucose spikes. Even a gentle walk counts.",
      },
      {
        name: "Resistance training 3× week",
        cadence: "3× week",
        details: "Skeletal muscle is the primary glucose disposal organ. Building muscle permanently improves insulin sensitivity.",
      },
      {
        name: "Eat within a 10–12 hour window",
        cadence: "Daily",
        details: "Time-restricted eating improves insulin sensitivity and fasting glucose without calorie counting.",
      },
      {
        name: "Breakfast within 1 hour of waking",
        cadence: "Daily",
        details: "Skipping breakfast spikes cortisol and disrupts glucose rhythm for the rest of the day.",
      },
    ],
    tracking_habits: [
      { name: "Post-meal energy (1–10, 60 min after eating)", cadence: "After each meal" },
      { name: "Fasting glucose (if monitoring)", cadence: "Weekly" },
      { name: "Sugar cravings (1–10)", cadence: "Daily" },
    ],
    tracking_symptoms: ["fatigue", "brain-fog", "sugar-cravings", "weight-gain"],
    lab_orders: [
      { test: "Fasting glucose + fasting insulin", reason: "Calculate HOMA-IR baseline and track progress" },
      { test: "HbA1c", reason: "3-month average glucose — target <5.4% (FM optimal)" },
      { test: "Triglycerides and HDL", reason: "TG/HDL ratio is a surrogate insulin resistance marker (target <1.5)" },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "perimenopause-hormonal",
    display_name: "Perimenopause & Hormonal Balance",
    icon: "🌸",
    description: "Support oestrogen metabolism, progesterone, HPA axis and bone health through the transition",
    primary_topics: ["perimenopause", "estrogen-dominance"],
    contributing_topics: ["adrenal-dysfunction", "gut-microbiome", "thyroid-dysfunction"],
    presenting_symptoms: ["hot-flushes", "fatigue", "brain-fog", "weight-gain", "mood-swings"],
    supplements: [
      {
        supplement_slug: "magnesium-glycinate",
        display_name: "Magnesium Glycinate",
        dose_display: "300–400 mg",
        timing: "Before bed",
        coach_rationale: "Reduces hot flushes, supports sleep, calms HPA axis — the single most impactful mineral in perimenopause",
      },
      {
        supplement_slug: "vitamin-d",
        display_name: "Vitamin D3 + K2",
        dose_display: "2000–4000 IU",
        timing: "With largest meal",
        coach_rationale: "Critical for bone density (oestrogen fall accelerates bone loss), mood, and immune regulation",
      },
      {
        supplement_slug: "b-complex",
        display_name: "B Complex (Homocysteine Defence)",
        dose_display: "1 capsule",
        timing: "With breakfast",
        coach_rationale: "B6, B12, folate support oestrogen methylation and mood (serotonin/dopamine synthesis requires B6)",
      },
    ],
    nutrition_add: [
      "Flaxseeds (1–2 tbsp ground daily) — lignans support oestrogen metabolism",
      "Cruciferous vegetables daily (DIM precursors — support liver oestrogen clearance)",
      "Phytoestrogen foods: edamame, tofu, tempeh in moderation",
      "Calcium-rich foods: sesame seeds, ragi, dairy alternatives, sardines",
      "Protein 25–30 g per meal (preserves muscle mass lost with oestrogen decline)",
      "Fibre 30 g/day (healthy gut = healthy oestrogen recirculation)",
    ],
    nutrition_reduce: [
      "Alcohol (worsens hot flushes, disrupts sleep, increases oestrogen load on liver)",
      "Caffeine after 12 PM (worsens sleep, increases cortisol)",
      "Refined sugar and ultra-processed carbs (blood sugar swings worsen hot flushes)",
      "Soy in excess (if oestrogen-dominant — reassess after 4 weeks)",
    ],
    nutrition_pattern: "Anti-inflammatory, phytoestrogen-rich, high-protein, high-fibre",
    lifestyle_practices: [
      {
        name: "Strength training 3× week",
        cadence: "3× week",
        details: "Non-negotiable in perimenopause: preserves bone density, muscle mass, metabolic rate, and mood. Prioritise over cardio.",
      },
      {
        name: "Stress reduction — HPA axis",
        cadence: "Daily",
        details: "Adrenal glands become the primary oestrogen source post-menopause. Chronic stress depletes DHEA and cortisol rhythms. 15 min meditation or yoga daily.",
      },
      {
        name: "Sleep optimisation",
        cadence: "Nightly",
        details: "Progesterone supports deep sleep — as it declines, sleep disruption worsens. Blackout curtains, no screens 1 hr before bed, cool room.",
      },
    ],
    tracking_habits: [
      { name: "Hot flush frequency and severity", cadence: "Daily" },
      { name: "Sleep quality (1–10)", cadence: "Daily" },
      { name: "Mood and energy (1–10)", cadence: "Daily" },
    ],
    tracking_symptoms: ["hot-flushes", "fatigue", "brain-fog", "mood-swings", "insomnia"],
    lab_orders: [
      { test: "FSH, LH, Oestradiol (E2)", reason: "Confirm perimenopause stage" },
      { test: "Progesterone (day 21 if still cycling)", reason: "Assess luteal phase progesterone" },
      { test: "DHEA-S", reason: "Adrenal reserve — often depleted in peri" },
      { test: "Vitamin D (25-OH)", reason: "Bone protection baseline" },
      { test: "DEXA scan", reason: "Bone density baseline at perimenopause onset" },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "adrenal-stress",
    display_name: "Adrenal Dysfunction & Burnout",
    icon: "⚡",
    description: "Restore HPA axis rhythm, rebuild stress resilience, address root nervous system drivers",
    primary_topics: ["adrenal-dysfunction", "chronic-stress"],
    contributing_topics: ["gut-microbiome", "thyroid-dysfunction"],
    presenting_symptoms: ["fatigue", "brain-fog", "insomnia", "anxiety"],
    supplements: [
      {
        supplement_slug: "ashwagandha",
        display_name: "Ashwagandha KSM-66",
        dose_display: "600 mg",
        timing: "With dinner (or split morning + evening)",
        coach_rationale: "Clinically shown to reduce cortisol 25–30%, improve energy, sleep, and stress resilience (KSM-66 is the most studied form)",
      },
      {
        supplement_slug: "magnesium-glycinate",
        display_name: "Magnesium Glycinate",
        dose_display: "400 mg",
        timing: "Before bed",
        coach_rationale: "Magnesium is depleted by chronic stress and is required for GABA (calm) neurotransmission and cortisol regulation",
      },
      {
        supplement_slug: "vitamin-c",
        display_name: "Vitamin C",
        dose_display: "1000 mg",
        timing: "Morning with breakfast",
        coach_rationale: "Adrenal glands have the highest vitamin C concentration of any tissue — depleted rapidly under chronic stress",
      },
    ],
    nutrition_add: [
      "Protein at breakfast (within 1 hour of waking) — anchors cortisol rhythm",
      "Salt (Himalayan or sea salt) if experiencing low blood pressure or dizziness",
      "Potassium-rich foods: coconut water, banana, sweet potato",
      "B-vitamin rich foods: eggs, lentils, leafy greens, liver monthly",
      "Anti-inflammatory fats: ghee, avocado, coconut oil",
    ],
    nutrition_reduce: [
      "Caffeine after 10 AM (disrupts cortisol rhythm — cortisol is naturally highest at 8–10 AM)",
      "Sugar and refined carbohydrates (cause cortisol spikes)",
      "Skipping meals (hypoglycaemia triggers cortisol stress response)",
      "Alcohol (disrupts sleep architecture and HPA recovery)",
    ],
    nutrition_pattern: "Nourishing, regular meals — no skipping, protein at every meal, no stimulants after noon",
    lifestyle_practices: [
      {
        name: "No high-intensity cardio during recovery phase",
        cadence: "Ongoing",
        details: "HIIT and long cardio further exhaust the HPA axis. Walk, swim, gentle yoga, restorative Pilates only until energy returns.",
      },
      {
        name: "Morning sunlight — 10 min outside before 9 AM",
        cadence: "Daily",
        details: "Anchors cortisol rhythm and circadian clock. Biggest single lifestyle intervention for HPA recovery.",
      },
      {
        name: "Screen-free wind-down 9–10 PM",
        cadence: "Nightly",
        details: "Blue light suppresses melatonin and prevents the cortisol-to-melatonin handoff needed for deep sleep.",
      },
      {
        name: "Breathwork — box breathing or 4-7-8 breathing",
        cadence: "Daily (morning and before bed)",
        details: "Directly activates parasympathetic nervous system. 5 minutes twice daily shown to lower cortisol.",
      },
    ],
    tracking_habits: [
      { name: "Energy on waking (1–10)", cadence: "Daily" },
      { name: "Afternoon energy crash (yes/no)", cadence: "Daily" },
      { name: "Sleep quality (1–10)", cadence: "Daily" },
    ],
    tracking_symptoms: ["fatigue", "brain-fog", "insomnia", "anxiety"],
    lab_orders: [
      { test: "Cortisol (4-point salivary diurnal)", reason: "Maps HPA rhythm — can't assess adrenal dysfunction from a single morning blood draw" },
      { test: "DHEA-S", reason: "Adrenal reserve marker — low in burnout" },
      { test: "Fasting insulin and glucose", reason: "HPA dysfunction and blood sugar dysregulation are tightly coupled" },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "pcos",
    display_name: "PCOS",
    icon: "🌀",
    description: "Reduce androgens, correct LH:FSH ratio, restore insulin sensitivity and cycle regularity",
    primary_topics: ["pcos", "insulin-resistance"],
    contributing_topics: ["adrenal-dysfunction", "gut-microbiome", "chronic-inflammation"],
    presenting_symptoms: ["irregular-periods", "weight-gain", "acne", "hair-loss", "fatigue"],
    supplements: [
      {
        supplement_slug: "myo-inositol",
        display_name: "Myo-Inositol + D-Chiro-Inositol (40:1 ratio)",
        dose_display: "4 g myo + 100 mg d-chiro daily",
        timing: "Split — 2 g with breakfast, 2 g with dinner",
        coach_rationale: "Inositol is the most evidence-backed supplement for PCOS — improves insulin signalling in ovaries, reduces testosterone, restores ovulation. The 40:1 ratio mirrors physiological tissue ratios.",
      },
      {
        supplement_slug: "berberine",
        display_name: "Berberine",
        dose_display: "500 mg",
        timing: "With meals twice daily (8 weeks on, 4 weeks off)",
        coach_rationale: "Activates AMPK — comparable to metformin for insulin sensitivity. Reduces androgens and LH:FSH ratio in PCOS. Cycle to avoid gut tolerance.",
      },
      {
        supplement_slug: "magnesium-glycinate",
        display_name: "Magnesium Glycinate",
        dose_display: "300 mg",
        timing: "Before bed",
        coach_rationale: "Required for insulin receptor signalling. Deficiency is near-universal in PCOS and worsens insulin resistance and sleep.",
      },
      {
        supplement_slug: "vitamin-d",
        display_name: "Vitamin D3 + K2",
        dose_display: "2000–4000 IU (based on level)",
        timing: "With largest meal",
        coach_rationale: "Vitamin D deficiency worsens insulin resistance, raises androgens, and disrupts FSH signalling — correct to 60–80 ng/mL.",
      },
      {
        supplement_slug: "spearmint-tea",
        display_name: "Spearmint Tea",
        dose_display: "2 cups daily",
        timing: "Morning and afternoon",
        coach_rationale: "Clinical trials show spearmint reduces free testosterone and LH in PCOS. Anti-androgenic — easy, low-cost addition.",
      },
    ],
    nutrition_add: [
      "Low-GI whole grains: red rice, millets (jowar, bajra, ragi), oats — replace white rice and maida",
      "Protein 25–30 g at every meal — blunts insulin spike and reduces androgen production",
      "Flaxseeds (1–2 tbsp ground daily) — lignans reduce free testosterone",
      "Colourful vegetables: raw carrots, beets, dark leafy greens at every meal",
      "Seed cycling: pumpkin + flax seeds in follicular phase (Day 1–14), sunflower + sesame in luteal phase (Day 15–28)",
      "Cinnamon (½ tsp daily) — improves insulin sensitivity and may restore cycle regularity",
      "Anti-inflammatory fats: ghee, coconut oil, avocado, fatty fish",
    ],
    nutrition_reduce: [
      "Refined carbohydrates and maida (biscuits, white bread, pasta) — spike insulin, drive androgen production",
      "Sugar in all forms — including fruit juices, packaged drinks, mithai",
      "Dairy (conventional A1) — IGF-1 in dairy may worsen androgen levels; trial 4–6 weeks",
      "Soy in excess if androgen-dominant — phytoestrogens can worsen LH:FSH ratio in some women",
      "Seed oils (sunflower, canola in large quantities) — pro-inflammatory omega-6 load",
    ],
    nutrition_pattern: "Low-glycaemic, high-protein, high-fibre — millet-based, anti-inflammatory. No skipping meals.",
    lifestyle_practices: [
      {
        name: "Resistance training 3–4× week",
        cadence: "3–4× week",
        details: "The single most effective lifestyle intervention for PCOS — builds insulin-sensitive muscle, reduces testosterone, improves cycle regularity. Prioritise over cardio.",
      },
      {
        name: "Avoid excessive HIIT or long-distance cardio",
        cadence: "Ongoing",
        details: "Excess cortisol from over-training worsens adrenal androgen production (DHEA-S → testosterone). Walk, strength train, swim.",
      },
      {
        name: "Stress management — daily",
        cadence: "Daily",
        details: "Chronic stress raises cortisol → DHEA-S → testosterone. 15 min yoga nidra, meditation, or breathwork daily is non-negotiable.",
      },
      {
        name: "Sleep 7–8 hours before 10:30 PM",
        cadence: "Nightly",
        details: "LH surges overnight — poor sleep disrupts the FSH:LH balance further in PCOS.",
      },
    ],
    tracking_habits: [
      { name: "Cycle day tracker (app: Clue or Flo)", cadence: "Daily" },
      { name: "Fasting glucose or post-meal energy (1–10)", cadence: "Daily" },
      { name: "Acne / skin changes", cadence: "Weekly" },
    ],
    tracking_symptoms: ["irregular-periods", "acne", "hair-loss", "weight-gain", "fatigue"],
    lab_orders: [
      { test: "LH, FSH (day 2–4 of cycle)", reason: "LH:FSH ratio >2:1 confirms PCOS pattern" },
      { test: "Free testosterone + Total testosterone + SHBG", reason: "Androgen excess and binding protein assessment" },
      { test: "DHEA-S", reason: "Distinguishes ovarian vs adrenal androgen source" },
      { test: "Fasting insulin + fasting glucose (HOMA-IR)", reason: "IR present in 70–80% of PCOS — drives androgen production" },
      { test: "AMH (anti-Müllerian hormone)", reason: "Elevated in PCOS — also confirms diagnosis and tracks ovarian follicle load" },
      { test: "Prolactin", reason: "Rule out hyperprolactinaemia mimicking PCOS" },
      { test: "Vitamin D (25-OH)", reason: "Deficiency worsens IR and androgen levels — correct before reassessing" },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "iron-deficiency",
    display_name: "Iron Deficiency & Anaemia",
    icon: "🩸",
    description: "Restore ferritin and haemoglobin, identify root cause, optimise absorption cofactors",
    primary_topics: ["iron-deficiency", "anaemia"],
    contributing_topics: ["gut-dysfunction", "chronic-inflammation", "hypothyroidism"],
    presenting_symptoms: ["fatigue", "brain-fog", "hair-loss", "cold-hands-feet", "breathlessness"],
    supplements: [
      {
        supplement_slug: "iron-bisglycinate",
        display_name: "Iron Bisglycinate (gentle form)",
        dose_display: "25–36 mg elemental iron",
        timing: "On empty stomach in the morning, with 200 mg Vitamin C — not with tea, coffee, or calcium",
        coach_rationale: "Bisglycinate is significantly better absorbed and causes less constipation than ferrous sulphate. Vitamin C converts Fe³⁺ to Fe²⁺ (absorbed form). Takes 3–4 months to restore ferritin — consistency is everything.",
      },
      {
        supplement_slug: "vitamin-c",
        display_name: "Vitamin C",
        dose_display: "500 mg",
        timing: "Taken alongside iron supplement",
        coach_rationale: "Enhances non-haem iron absorption 2–3× by reducing Fe³⁺ to Fe²⁺. Critical if eating plant-based iron sources.",
      },
      {
        supplement_slug: "b12-methylcobalamin",
        display_name: "Methylcobalamin (B12)",
        dose_display: "1000 mcg sublingual",
        timing: "Morning",
        coach_rationale: "B12 deficiency co-occurs frequently with iron deficiency and causes macrocytic anaemia — check and correct both.",
      },
      {
        supplement_slug: "folate",
        display_name: "Methylfolate (5-MTHF)",
        dose_display: "400–800 mcg",
        timing: "With breakfast",
        coach_rationale: "Required for red blood cell synthesis. Deficiency causes megaloblastic anaemia — address alongside iron.",
      },
    ],
    nutrition_add: [
      "Ragi (finger millet) — one of the highest plant iron sources; as roti, dosa, porridge",
      "Horsegram (kulthi dal) — exceptionally high iron; traditional South Indian preparation",
      "Moringa leaves (drumstick leaves) — fresh or powder; high iron + Vit C combined",
      "Beetroot + amla juice in the morning — iron + Vit C naturally paired",
      "Dark leafy greens: palak, methi, amaranth (chauli) — cook with a squeeze of lemon",
      "Sesame seeds (til): 1–2 tbsp daily — iron + calcium",
      "Jaggery (small amounts) over refined sugar — contains iron",
      "Cook in cast-iron kadhai — leaches iron into food, especially with acidic foods",
      "Sprouted legumes — sprouting reduces phytates and improves iron absorption",
    ],
    nutrition_reduce: [
      "Tea or coffee within 1 hour of meals or supplements — tannins block iron absorption by up to 60%",
      "Calcium supplements or dairy at the same time as iron (separate by 2+ hours)",
      "Excess whole wheat bran (phytates bind iron) — soak or sprout grains",
      "Antacids / PPIs with iron supplement — stomach acid is required for iron absorption",
    ],
    nutrition_pattern: "Iron-rich, Vit C-paired meals. Separate tea/coffee and calcium from iron-rich meals by at least 1 hour.",
    lifestyle_practices: [
      {
        name: "Investigate root cause — do not just supplement",
        cadence: "One-time assessment",
        details: "Heavy periods (most common in women), gut malabsorption (coeliac, low stomach acid), chronic blood loss, or vegetarian diet. Supplementing without addressing root cause leads to recurrence.",
      },
      {
        name: "Gentle movement — avoid exhaustion",
        cadence: "Daily",
        details: "Iron deficiency impairs oxygen delivery. Do not push through intense training — it worsens fatigue and delays recovery. Gentle yoga, walking, swimming.",
      },
    ],
    tracking_habits: [
      { name: "Energy level on waking (1–10)", cadence: "Daily" },
      { name: "Hair fall — count or observe", cadence: "Weekly" },
      { name: "Menstrual blood loss (clots, duration, heaviness)", cadence: "Each cycle" },
    ],
    tracking_symptoms: ["fatigue", "hair-loss", "brain-fog", "breathlessness", "cold-extremities"],
    lab_orders: [
      { test: "Ferritin", reason: "Most sensitive iron store marker — target >70 ng/mL for symptom resolution (not just lab range of >12)" },
      { test: "Serum iron + TIBC + transferrin saturation", reason: "Full iron status picture — low sat% + high TIBC = classic iron deficiency" },
      { test: "CBC with differential", reason: "Haemoglobin, MCV (microcytic = iron, macrocytic = B12/folate)" },
      { test: "B12 + folate (RBC folate preferred)", reason: "Co-deficiency common — distinguish anaemia type" },
      { test: "CRP / ESR", reason: "Anaemia of chronic inflammation elevates ferritin falsely — must rule out before diagnosing iron deficiency" },
      { test: "TFTs (TSH, fT3, fT4)", reason: "Hypothyroidism reduces iron absorption and worsens fatigue — treat both" },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "estrogen-dominance",
    display_name: "Estrogen Dominance",
    icon: "⚖️",
    description: "Support liver Phase 1 + 2 clearance, estrobolome, and progesterone balance",
    primary_topics: ["estrogen-dominance", "estrogen-metabolism"],
    contributing_topics: ["gut-microbiome", "liver-detoxification", "adrenal-dysfunction"],
    presenting_symptoms: ["heavy-periods", "PMS", "breast-tenderness", "bloating", "weight-gain", "mood-swings"],
    supplements: [
      {
        supplement_slug: "dim",
        display_name: "DIM (Diindolylmethane)",
        dose_display: "200 mg",
        timing: "With dinner",
        coach_rationale: "DIM shifts oestrogen metabolism toward the protective 2-OH pathway and away from 16-OH (proliferative). Derived from cruciferous vegetables — supplements deliver a clinically meaningful dose.",
      },
      {
        supplement_slug: "calcium-d-glucarate",
        display_name: "Calcium D-Glucarate",
        dose_display: "500 mg",
        timing: "With meals twice daily",
        coach_rationale: "Inhibits beta-glucuronidase (produced by dysbiotic bacteria in the estrobolome) — prevents deconjugated oestrogen from being reabsorbed in the gut. Essential when gut health is poor.",
      },
      {
        supplement_slug: "magnesium-glycinate",
        display_name: "Magnesium Glycinate",
        dose_display: "300–400 mg",
        timing: "Before bed",
        coach_rationale: "Required for Phase 2 liver methylation of oestrogen (COMT enzyme needs magnesium). Also supports progesterone synthesis.",
      },
      {
        supplement_slug: "b-complex",
        display_name: "B Complex (methylated)",
        dose_display: "1 capsule",
        timing: "With breakfast",
        coach_rationale: "B6, B12, methylfolate are all required for COMT methylation — the key Phase 2 oestrogen detox pathway. Low B-vitamins = oestrogen accumulation.",
      },
    ],
    nutrition_add: [
      "Cruciferous vegetables daily: broccoli, cauliflower, Brussels sprouts, cabbage, kale — raw or lightly steamed (DIM precursors)",
      "Ground flaxseeds (1–2 tbsp daily) — lignans reduce oestrogen receptor activity and support 2-OH pathway",
      "High-fibre foods: oats, lentils, psyllium — bind oestrogen in the gut for excretion",
      "Fermented foods: homemade curd, kanji, kefir — support healthy estrobolome",
      "Liver-supporting foods: beetroot, turmeric, dandelion greens, lemon water on waking",
      "Eat organic where possible for the 'Dirty Dozen' produce — reduce xenoestrogen load",
    ],
    nutrition_reduce: [
      "Alcohol — directly impairs liver Phase 1 oestrogen clearance, raises oestradiol levels",
      "Conventional (A1) dairy — contains oestrogen from pregnant cows; try 4-week elimination",
      "Non-organic meat — hormone residues accumulate",
      "Plastics for food storage and heating — BPA and phthalates are potent xenoestrogens",
      "Refined sugar — drives insulin, which increases oestrogen production from fat cells",
      "Soy in large quantities if oestrogen-dominant (phytoestrogens add to load)",
    ],
    nutrition_pattern: "Liver-supportive, high-fibre, cruciferous-rich, organic where possible. Alcohol-free.",
    lifestyle_practices: [
      {
        name: "Reduce plastics — food and personal care",
        cadence: "Ongoing",
        details: "Switch to glass, stainless steel, or ceramic for food storage. Review personal care products (EWG Skin Deep database). Xenoestrogens from plastics bypass liver clearance.",
      },
      {
        name: "Regular bowel movements — daily is essential",
        cadence: "Daily",
        details: "If not having a daily bowel movement, oestrogen conjugated in bile is reabsorbed. Fibre + hydration + magnesium are the levers.",
      },
      {
        name: "Stress management — protect progesterone",
        cadence: "Daily",
        details: "Cortisol and progesterone share the same precursor (pregnenolone). Chronic stress steals pregnenolone for cortisol, leaving less for progesterone — worsening oestrogen dominance.",
      },
    ],
    tracking_habits: [
      { name: "Menstrual cycle symptoms diary (PMS, breast tenderness, flow)", cadence: "Daily in luteal phase" },
      { name: "Bowel movement frequency", cadence: "Daily" },
      { name: "Mood swings (1–10)", cadence: "Daily" },
    ],
    tracking_symptoms: ["heavy-periods", "PMS", "breast-tenderness", "bloating", "mood-swings"],
    lab_orders: [
      { test: "Oestradiol (E2) — day 3 and day 21", reason: "Compare follicular and luteal values — relative dominance vs absolute level" },
      { test: "Progesterone (day 21 of cycle)", reason: "Oestrogen dominance is often a progesterone deficiency — absolute or relative" },
      { test: "SHBG", reason: "Low SHBG = more free oestrogen available at tissue level" },
      { test: "LFTs (ALT, AST, GGT)", reason: "Liver clearance capacity — raised enzymes = impaired Phase 1/2" },
      { test: "DUTCH urine hormone panel (if affordable)", reason: "Maps oestrogen metabolite ratios (2-OH:16-OH), methylation, Phase 2 clearance — gold standard for oestrogen dominance workup" },
      { test: "Stool beta-glucuronidase (via GI-MAP)", reason: "Elevated = dysbiotic estrobolome reabsorbing oestrogen" },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "sibo",
    display_name: "SIBO (Small Intestinal Bacterial Overgrowth)",
    icon: "🦠",
    description: "Eradicate overgrowth with herbal antimicrobials, restore MMC motility, prevent relapse",
    primary_topics: ["sibo", "gut-dysfunction"],
    contributing_topics: ["leaky-gut", "dysbiosis", "chronic-stress"],
    presenting_symptoms: ["bloating", "gas", "constipation", "diarrhoea", "fatigue", "brain-fog"],
    supplements: [
      {
        supplement_slug: "berberine",
        display_name: "Berberine (herbal antimicrobial)",
        dose_display: "500 mg",
        timing: "Three times daily with meals — during active eradication phase (4–6 weeks)",
        coach_rationale: "Broad-spectrum herbal antimicrobial effective against hydrogen and methane SIBO. Part of a herbal protocol (combine with allicin and/or oregano oil for synergy). As effective as rifaximin in some trials.",
      },
      {
        supplement_slug: "allicin",
        display_name: "Allicin (stabilised garlic extract)",
        dose_display: "450 mg",
        timing: "Three times daily — particularly effective for methane/IMO-SIBO",
        coach_rationale: "Allicin targets methanogens (archaea causing methane-dominant SIBO / constipation type). Stabilised allicin (not raw garlic) is required for adequate dosing.",
      },
      {
        supplement_slug: "ginger-extract",
        display_name: "Ginger Extract (prokinetic)",
        dose_display: "500 mg",
        timing: "30 minutes before meals and at bedtime on empty stomach",
        coach_rationale: "Stimulates the migrating motor complex (MMC) — the gut's between-meal cleaning wave that is impaired in SIBO. Critical for preventing relapse. Take on empty stomach for prokinetic effect.",
      },
    ],
    nutrition_add: [
      "Cooked and well-tolerated low-FODMAP vegetables during treatment: carrots, courgette, green beans, spinach",
      "Rice, rice noodles, oats — safer grains during active phase",
      "Protein at every meal: eggs, fish, chicken — less fermentable than legumes during treatment",
      "Bone broth — supports gut lining repair alongside eradication",
      "Small, regular meals — do not graze; fasting between meals allows MMC to activate",
    ],
    nutrition_reduce: [
      "High-FODMAP foods during treatment phase: onion, garlic, apple, mango, milk, wheat, legumes (lentils, chickpeas)",
      "Raw vegetables — harder to digest and more fermentable in small intestine",
      "Sugar and refined carbs — feed bacterial overgrowth",
      "Fibre supplements during active treatment (psyllium, inulin) — fermentable and feeds bacteria",
      "Probiotics during active SIBO treatment — do NOT add more bacteria to an overgrown system (reintroduce after eradication)",
      "Grazing and snacking — prevents MMC activation between meals; leave 4–5 hours between meals",
    ],
    nutrition_pattern: "Low-FODMAP during 4–6 week treatment phase. Structured meals with 4–5 hour gaps. No snacking.",
    lifestyle_practices: [
      {
        name: "Meal spacing — 4–5 hours between meals, no snacks",
        cadence: "Daily",
        details: "The migrating motor complex (MMC) only activates in a fasted state after ~90 min. Constant eating prevents the gut's natural cleaning wave — the core motility issue in SIBO.",
      },
      {
        name: "Address root cause — motility, low stomach acid, or structural",
        cadence: "One-time assessment",
        details: "SIBO almost always has a root cause: low stomach acid (PPIs), slow motility (hypothyroid, diabetes, adhesions), or ileocaecal valve dysfunction. Treat root cause or SIBO will relapse within months.",
      },
      {
        name: "Stress management — gut-brain axis",
        cadence: "Daily",
        details: "Chronic stress slows motility and suppresses MMC. Vagal tone exercises (humming, gargling, cold splash on face) directly stimulate gut motility.",
      },
    ],
    tracking_habits: [
      { name: "Bloating severity (1–10) — before and after each meal", cadence: "After each meal" },
      { name: "Bowel transit regularity (Bristol scale)", cadence: "Daily" },
      { name: "Symptom diary — foods that trigger", cadence: "Daily" },
    ],
    tracking_symptoms: ["bloating", "gas", "constipation", "brain-fog", "fatigue"],
    lab_orders: [
      { test: "SIBO breath test (lactulose) — hydrogen + methane", reason: "Confirm diagnosis and subtype: H₂ = SIBO, CH₄ = IMO (intestinal methanogen overgrowth)" },
      { test: "GI-MAP or comprehensive stool test", reason: "Assess downstream dysbiosis, pathogens, secretory IgA, elastase (pancreatic insufficiency)" },
      { test: "TSH, fT3", reason: "Hypothyroidism is a leading cause of slow motility driving SIBO — must be ruled out" },
      { test: "Fasting glucose + insulin", reason: "Diabetes slows gastric emptying (gastroparesis) — major SIBO driver" },
      { test: "Organic acids test (OAT)", reason: "Arabinose and other fermentation markers indicate yeast/bacterial overgrowth even in hydrogen-negative cases" },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "nafld",
    display_name: "NAFLD / Fatty Liver",
    icon: "🫁",
    description: "Reduce hepatic fat, support Phase 1 + 2 detox, address insulin resistance as root driver",
    primary_topics: ["nafld", "liver-detoxification"],
    contributing_topics: ["insulin-resistance", "gut-microbiome", "chronic-inflammation"],
    presenting_symptoms: ["fatigue", "right-upper-quadrant-discomfort", "weight-gain", "brain-fog"],
    supplements: [
      {
        supplement_slug: "nac",
        display_name: "N-Acetyl Cysteine (NAC)",
        dose_display: "600 mg",
        timing: "Twice daily on empty stomach",
        coach_rationale: "Precursor to glutathione — the liver's master antioxidant. Reduces hepatic oxidative stress and inflammation. One of the most evidence-backed liver supplements.",
      },
      {
        supplement_slug: "milk-thistle",
        display_name: "Milk Thistle (Silymarin 80%)",
        dose_display: "300 mg",
        timing: "With meals twice daily",
        coach_rationale: "Silymarin has 30+ years of evidence for hepatoprotection — reduces ALT/AST, promotes hepatocyte regeneration, and has anti-fibrotic properties.",
      },
      {
        supplement_slug: "berberine",
        display_name: "Berberine",
        dose_display: "500 mg",
        timing: "With meals twice daily",
        coach_rationale: "Directly reduces hepatic fat via AMPK activation, improves insulin sensitivity, and lowers triglycerides — addresses NAFLD's insulin-resistance root cause.",
      },
      {
        supplement_slug: "vitamin-e",
        display_name: "Vitamin E (mixed tocopherols)",
        dose_display: "400 IU",
        timing: "With dinner",
        coach_rationale: "Recommended in NASH guidelines for non-diabetic patients — reduces hepatic inflammation and oxidative stress. Use mixed tocopherols, not synthetic d-alpha alone.",
      },
    ],
    nutrition_add: [
      "Eggs and organ meats (liver monthly) — choline is essential for hepatic fat export via VLDL; choline deficiency directly causes fatty liver",
      "Cruciferous vegetables daily — glucosinolates support Phase 2 liver detox",
      "Coffee (filter or South Indian — 2 cups/day) — consistently associated with reduced fibrosis in NAFLD; do not add sugar",
      "Turmeric with black pepper — curcumin reduces hepatic inflammation and NF-κB",
      "Green tea (matcha or loose leaf) — EGCG reduces hepatic fat accumulation",
      "Walnuts, flaxseeds, fatty fish — omega-3 DHA/EPA reduce liver triglycerides",
      "Bitter foods: karela (bitter gourd), dandelion greens, amla — stimulate bile flow",
    ],
    nutrition_reduce: [
      "Fructose — the primary driver of de novo lipogenesis in the liver; fruit juices, packaged foods with HFCS, excess fruit",
      "Alcohol completely — even moderate intake worsens NAFLD progression significantly",
      "Refined carbohydrates: maida, white rice in large portions, biscuits, namkeen",
      "Seed oils (sunflower, soybean, canola) in cooking — omega-6 load drives hepatic inflammation",
      "Ultra-processed foods — contain fructose, seed oils, and emulsifiers that worsen gut-liver axis",
    ],
    nutrition_pattern: "Mediterranean-Indian hybrid: olive/coconut oil, high vegetables, legumes, fatty fish, eggs. No alcohol, low fructose.",
    lifestyle_practices: [
      {
        name: "Resistance training 3× week — the most effective NAFLD intervention",
        cadence: "3× week",
        details: "Skeletal muscle is the primary organ for glucose disposal. Building muscle reduces hepatic glucose and fat delivery. Even 150 min/week of moderate exercise reduces liver fat by 20–30%.",
      },
      {
        name: "10-min walk after every meal",
        cadence: "After each meal",
        details: "Post-meal muscle contraction diverts glucose away from the liver — directly reduces hepatic fat accumulation.",
      },
      {
        name: "Intermittent fasting (12–14 hour overnight fast)",
        cadence: "Daily",
        details: "Fasting triggers hepatic autophagy and fat oxidation. A 12-hour overnight fast (dinner by 7 PM, breakfast at 7 AM) is achievable and clinically significant.",
      },
    ],
    tracking_habits: [
      { name: "Waist circumference (monthly)", cadence: "Monthly" },
      { name: "Energy and brain clarity (1–10)", cadence: "Daily" },
      { name: "Post-meal bloating or right-side discomfort", cadence: "Daily" },
    ],
    tracking_symptoms: ["fatigue", "brain-fog", "weight-gain", "bloating"],
    lab_orders: [
      { test: "Liver function tests (ALT, AST, GGT, ALP)", reason: "Baseline and 3-month tracking — ALT >40 in women is significant even within 'normal' range" },
      { test: "GGT (standalone)", reason: "Most sensitive marker of hepatic oxidative stress and alcohol/toxin load" },
      { test: "Fasting insulin + glucose (HOMA-IR)", reason: "Insulin resistance is the root cause of NAFLD in 80% of cases — must be treated" },
      { test: "Triglycerides + HDL", reason: "TG >150 and low HDL = liver is not processing fat efficiently" },
      { test: "Fibroscan or liver ultrasound", reason: "Quantifies hepatic fat percentage and rules out fibrosis — essential baseline" },
      { test: "Ferritin", reason: "Elevated ferritin in NAFLD (hepatic iron deposition) — does not mean iron deficiency; check TIBC to differentiate" },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "insomnia",
    display_name: "Insomnia & Sleep Optimisation",
    icon: "🌙",
    description: "Restore circadian rhythm, address root causes, use targeted nutrients for sleep architecture",
    primary_topics: ["insomnia", "nervous-system-regulation"],
    contributing_topics: ["adrenal-dysfunction", "chronic-stress", "gut-brain-axis"],
    presenting_symptoms: ["insomnia", "fatigue", "brain-fog", "anxiety", "mood-swings"],
    supplements: [
      {
        supplement_slug: "magnesium-glycinate",
        display_name: "Magnesium Glycinate",
        dose_display: "400 mg",
        timing: "45–60 minutes before bed",
        coach_rationale: "Magnesium activates GABA receptors and relaxes the nervous system. Glycinate form is best absorbed and least likely to cause loose stools. Deficiency is near-universal and directly causes insomnia.",
      },
      {
        supplement_slug: "l-theanine",
        display_name: "L-Theanine",
        dose_display: "200 mg",
        timing: "30–60 minutes before bed",
        coach_rationale: "Promotes alpha brain waves (calm-alert state), reduces sleep-onset anxiety, and improves sleep quality without sedation. Safe with long-term use.",
      },
      {
        supplement_slug: "melatonin",
        display_name: "Melatonin (low-dose)",
        dose_display: "0.5–1 mg (not the 5–10 mg commonly sold)",
        timing: "90 minutes before target bedtime",
        coach_rationale: "Low-dose melatonin (0.5 mg) resets circadian timing without causing dependence or next-day grogginess. High doses suppress natural melatonin production over time. Use for jet lag, shift work, or delayed sleep phase.",
      },
      {
        supplement_slug: "ashwagandha",
        display_name: "Ashwagandha KSM-66",
        dose_display: "300 mg",
        timing: "With dinner",
        coach_rationale: "Reduces cortisol, supports GABA activity, and has clinical evidence for improving sleep onset and quality. Particularly useful when insomnia is stress-driven.",
      },
    ],
    nutrition_add: [
      "Tart cherry (100 ml juice or 30 mg extract before bed) — natural melatonin and tryptophan source",
      "Kiwi fruit (2 before bed) — clinical evidence shows kiwi improves sleep onset and duration via serotonin",
      "Turkey, chicken, eggs at dinner — tryptophan converts to serotonin then melatonin",
      "Warm ashwagandha or saffron milk before bed — traditional Indian practice with evidence backing",
      "Magnesium-rich foods: pumpkin seeds, almonds, dark chocolate, leafy greens at dinner",
      "Herbal teas: chamomile, passionflower, valerian — calming before bed",
    ],
    nutrition_reduce: [
      "Caffeine after 12 PM (half-life 5–7 hours — a 3 PM coffee still has 50% in system at 8 PM)",
      "Alcohol (collapses sleep architecture and REM — wake after 2–3 hours as alcohol metabolises)",
      "Heavy or high-fat meal within 3 hours of bed (digestive burden delays sleep onset)",
      "High-sugar evening snacks (blood sugar drop at 2–3 AM causes cortisol spike and waking)",
      "Excess fluids after 8 PM — reduces nocturia-related waking",
    ],
    nutrition_pattern: "Light, warm dinner with tryptophan-rich protein. No caffeine after noon. Small pre-bed snack if blood sugar unstable.",
    lifestyle_practices: [
      {
        name: "Morning sunlight — 10–20 min within 30 min of waking",
        cadence: "Daily",
        details: "The single most powerful circadian anchor. Bright morning light suppresses melatonin (wakes you up) and sets the 14–16 hour countdown to evening melatonin release. Non-negotiable for circadian repair.",
      },
      {
        name: "No screens 60–90 min before bed",
        cadence: "Nightly",
        details: "Blue light from phones and laptops suppresses melatonin by 50% and delays sleep phase by 1.5 hours. Use blue-light glasses, warm lighting, or apps like f.lux/Night Shift if unavoidable.",
      },
      {
        name: "Fixed wake time — same time every day including weekends",
        cadence: "Daily",
        details: "Wake time is the master anchor for circadian rhythm — more powerful than bedtime. Sleeping in on weekends creates 'social jet lag' that resets the clock backwards.",
      },
      {
        name: "4-7-8 breathing or physiological sigh at bedtime",
        cadence: "Nightly",
        details: "4-7-8 (inhale 4s, hold 7s, exhale 8s) or double-inhale then long exhale (physiological sigh) activates parasympathetic tone within 60 seconds. Do 4–8 rounds.",
      },
      {
        name: "Cool bedroom — 18–20°C",
        cadence: "Nightly",
        details: "Core body temperature must drop 1–2°C to initiate sleep. Hot rooms are a leading cause of insomnia. Fan, AC, or a cold shower before bed accelerates this.",
      },
    ],
    tracking_habits: [
      { name: "Sleep onset time and wake time (sleep diary)", cadence: "Daily" },
      { name: "Night wakings — number and time", cadence: "Daily" },
      { name: "Sleep quality on waking (1–10)", cadence: "Daily" },
    ],
    tracking_symptoms: ["insomnia", "fatigue", "anxiety", "brain-fog"],
    lab_orders: [
      { test: "Cortisol (4-point diurnal salivary or DUTCH)", reason: "Elevated evening cortisol is the leading hormonal cause of sleep-onset insomnia" },
      { test: "Fasting insulin + glucose", reason: "Nocturnal hypoglycaemia (from IR) causes 2–3 AM wakings — common and missed" },
      { test: "TSH, fT3", reason: "Hypothyroidism causes fatigue but not always better sleep; hyperthyroid causes insomnia" },
      { test: "Ferritin", reason: "Iron deficiency causes restless legs syndrome — a common cause of insomnia in women" },
      { test: "Vitamin D (25-OH)", reason: "Deficiency linked to poor sleep quality, reduced sleep duration, and daytime sleepiness" },
      { test: "Magnesium (RBC)", reason: "Serum magnesium is unreliable; RBC reflects intracellular status — deficiency causes hyperarousal and insomnia" },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "dyslipidemia",
    display_name: "Dyslipidemia & Cardiovascular Risk",
    icon: "❤️",
    description: "Optimise ApoB, reduce small-dense LDL, address root drivers — not just manage numbers",
    primary_topics: ["dyslipidemia", "cardiometabolic-health"],
    contributing_topics: ["insulin-resistance", "chronic-inflammation", "nafld"],
    presenting_symptoms: ["fatigue", "weight-gain"],
    supplements: [
      {
        supplement_slug: "omega-3",
        display_name: "Omega-3 (EPA + DHA)",
        dose_display: "2–4 g combined EPA+DHA daily",
        timing: "With meals (improves absorption, reduces fishy reflux)",
        coach_rationale: "Reduces triglycerides 20–30% at 4g dose. Reduces VLDL, raises HDL, and has significant anti-inflammatory and plaque-stabilising effects. Use triglyceride-form omega-3 (not ethyl ester) for best absorption.",
      },
      {
        supplement_slug: "berberine",
        display_name: "Berberine",
        dose_display: "500 mg",
        timing: "Twice daily with meals",
        coach_rationale: "Upregulates LDL receptors via PCSK9 inhibition (same mechanism as statins, different pathway). Reduces LDL-C 20–30%, TG 35%, raises HDL. Excellent option for statin-intolerant clients.",
      },
      {
        supplement_slug: "bergamot-extract",
        display_name: "Bergamot Extract (standardised polyphenols)",
        dose_display: "500–1000 mg",
        timing: "With breakfast",
        coach_rationale: "Reduces LDL and triglycerides, raises HDL. Anti-inflammatory and anti-oxidant. Italian RCTs show significant lipid-lowering comparable to low-dose statins in some trials.",
      },
      {
        supplement_slug: "coq10",
        display_name: "CoQ10 (Ubiquinol form)",
        dose_display: "100–200 mg",
        timing: "With a meal containing fat",
        coach_rationale: "Statins deplete CoQ10 — essential for mitochondrial energy production. Ubiquinol is the reduced, active form (better absorbed over 40). Prevents and addresses statin-induced muscle pain.",
      },
    ],
    nutrition_add: [
      "Fatty fish 3× week: sardines, mackerel, salmon — highest EPA+DHA",
      "Walnuts (5–7 daily) — ALA omega-3, reduces LDL and inflammation",
      "Oats and psyllium husk daily — beta-glucan fibre binds bile acids, lowers LDL 5–10%",
      "Legumes daily: dal, rajma, channa — soluble fibre + plant protein lower cholesterol",
      "Olive oil as primary cooking fat — oleocanthal anti-inflammatory, raises HDL",
      "Avocado — monounsaturated fats raise HDL and shift LDL from small-dense to large-buoyant",
      "Dark chocolate (85%+, small amount) — flavanols improve endothelial function",
      "Plant sterols: found in sesame, sunflower seeds, wheat germ — block cholesterol absorption",
    ],
    nutrition_reduce: [
      "Trans fats completely — partially hydrogenated oils in packaged biscuits, namkeen, fast food",
      "Excess refined carbohydrates — the primary driver of high TG and low HDL (more important than dietary fat)",
      "Fruit juice and sweet drinks — fructose drives de novo lipogenesis and raises TG",
      "Excess saturated fat from ultra-processed sources (not from whole food ghee or coconut in moderation)",
      "Alcohol — raises triglycerides significantly; even moderate intake problematic with high TG",
    ],
    nutrition_pattern: "Mediterranean-Indian: olive/ghee, oily fish, legumes, nuts, vegetables, limited refined carbs. High fibre.",
    lifestyle_practices: [
      {
        name: "Zone 2 aerobic exercise 150+ min per week",
        cadence: "Daily or 5× week",
        details: "Zone 2 (conversational pace — can speak but slightly breathless) is the most effective exercise for raising HDL, reducing TG, and improving mitochondrial function. Walk briskly, cycle, swim.",
      },
      {
        name: "Resistance training 2–3× week",
        cadence: "2–3× week",
        details: "Builds insulin-sensitive muscle — reduces the IR-driven dyslipidemia pattern (high TG, low HDL, small LDL particles) better than any medication.",
      },
      {
        name: "Address insulin resistance as primary root cause",
        cadence: "Ongoing",
        details: "High TG + low HDL + normal or high LDL = almost always IR-driven dyslipidemia. This responds dramatically to carb reduction and exercise — more than statin therapy.",
      },
    ],
    tracking_habits: [
      { name: "Post-meal walk (10 min after each meal)", cadence: "After each meal" },
      { name: "Weekly exercise minutes (target 150+ aerobic)", cadence: "Weekly" },
      { name: "Waist circumference", cadence: "Monthly" },
    ],
    tracking_symptoms: ["fatigue", "weight-gain"],
    lab_orders: [
      { test: "Full lipid panel (TC, LDL-C, HDL, TG)", reason: "Baseline — but LDL-C alone is insufficient for risk assessment" },
      { test: "ApoB", reason: "The true particle count — better predictor of CV risk than LDL-C. Target <80 mg/dL for moderate risk, <65 for high risk" },
      { test: "Lp(a)", reason: "Genetic CV risk marker — does not respond to lifestyle; important baseline. Elevated in ~20% of Indians" },
      { test: "hs-CRP", reason: "Inflammatory component of CV risk — elevated with normal lipids still doubles event risk" },
      { test: "Homocysteine", reason: "Independent CV risk factor; elevated = B-vitamin deficiency or MTHFR variant" },
      { test: "Fasting insulin + glucose (HOMA-IR)", reason: "IR is the root cause of atherogenic dyslipidemia (high TG, low HDL, small-dense LDL)" },
      { test: "Lipoprotein subfractions / NMR lipid panel (if available)", reason: "Counts LDL particle number and size — small-dense LDL is 3× more atherogenic than large fluffy LDL" },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "low-progesterone",
    display_name: "Low Progesterone / Luteal Phase Deficiency",
    icon: "🌕",
    description: "Support corpus luteum function, reduce cortisol steal, restore luteal progesterone adequacy",
    primary_topics: ["low-progesterone", "estrogen-dominance"],
    contributing_topics: ["adrenal-dysfunction", "thyroid-dysfunction", "chronic-stress"],
    presenting_symptoms: ["PMS", "spotting-before-period", "anxiety", "insomnia", "heavy-periods", "short-luteal-phase"],
    supplements: [
      {
        supplement_slug: "vitex",
        display_name: "Vitex (Chasteberry) — AGN 194310 extract",
        dose_display: "400 mg",
        timing: "First thing in the morning on empty stomach — must be taken consistently for 3+ menstrual cycles",
        coach_rationale: "Acts on pituitary dopamine receptors to reduce excess prolactin and raise LH — supporting corpus luteum function and progesterone output in the luteal phase. Takes 3 months to see full effect. Do NOT use with hormonal contraceptives.",
      },
      {
        supplement_slug: "vitamin-b6",
        display_name: "Vitamin B6 (Pyridoxine / P5P)",
        dose_display: "50 mg P5P form",
        timing: "With dinner",
        coach_rationale: "Required for progesterone synthesis and reduces excess oestrogen. P5P is the active form — bypasses conversion issues. Clinical evidence for PMS reduction.",
      },
      {
        supplement_slug: "magnesium-glycinate",
        display_name: "Magnesium Glycinate",
        dose_display: "300–400 mg",
        timing: "Before bed",
        coach_rationale: "Magnesium is required for progesterone synthesis and reduces cortisol. Cortisol and progesterone compete for the same precursor (pregnenolone) — the 'pregnenolone steal'. Magnesium reduces cortisol demand.",
      },
      {
        supplement_slug: "zinc",
        display_name: "Zinc (bisglycinate)",
        dose_display: "25–30 mg",
        timing: "With dinner",
        coach_rationale: "Required for pituitary LH secretion and ovulation. Low zinc = poor LH surge = poor corpus luteum = low progesterone.",
      },
    ],
    nutrition_add: [
      "Seed cycling — luteal phase (Day 15–28): sunflower seeds (1 tbsp) + sesame seeds (1 tbsp) daily",
      "Seed cycling — follicular phase (Day 1–14): pumpkin seeds (1 tbsp) + flaxseeds (1 tbsp) daily",
      "Zinc-rich foods in luteal phase: pumpkin seeds, oysters, red meat, eggs",
      "Vitamin B6-rich foods: banana, sunflower seeds, tuna, pistachios, sweet potato",
      "Healthy fats throughout cycle: ghee, coconut oil, avocado — steroid hormones are synthesised from cholesterol",
      "Blood sugar stability: protein at every meal prevents the cortisol spikes that steal progesterone",
    ],
    nutrition_reduce: [
      "Caffeine — raises cortisol and competes with progesterone for pregnenolone",
      "Alcohol — reduces progesterone synthesis and disrupts LH release",
      "Refined sugar — blood sugar swings trigger cortisol, worsening pregnenolone steal",
      "Vegetable oils high in omega-6 (seed oils) — impair hormonal signalling",
    ],
    nutrition_pattern: "Hormone-supportive, blood-sugar stable. High healthy fats. Seed cycling protocol throughout cycle.",
    lifestyle_practices: [
      {
        name: "Stress reduction — protect pregnenolone",
        cadence: "Daily",
        details: "The pregnenolone steal is real: under chronic stress, the body prioritises cortisol synthesis over progesterone. 20 min daily parasympathetic practice (yoga nidra, meditation, nature walk) is the most direct intervention.",
      },
      {
        name: "Moderate exercise — avoid over-training in luteal phase",
        cadence: "Ongoing",
        details: "High-intensity training in the luteal phase (Day 15–28) is particularly depleting. Favour yoga, pilates, walking. Reserve HIIT and heavy lifting for follicular phase when oestrogen is higher and recovery is faster.",
      },
      {
        name: "Cycle tracking — basal body temperature",
        cadence: "Daily",
        details: "BBT rises 0.2–0.5°C after ovulation (progesterone causes this). Tracking confirms ovulation occurred and gives a window into luteal phase length and progesterone adequacy.",
      },
    ],
    tracking_habits: [
      { name: "Basal body temperature (BBT) — first thing on waking before getting up", cadence: "Daily" },
      { name: "Luteal phase symptom diary (PMS, mood, spotting)", cadence: "Daily in luteal phase" },
      { name: "Cycle length and luteal phase length", cadence: "Each cycle" },
    ],
    tracking_symptoms: ["PMS", "spotting", "anxiety", "insomnia", "mood-swings"],
    lab_orders: [
      { test: "Progesterone (day 21 — or 7 days after confirmed ovulation)", reason: "Timing is critical — must be day 21 of a 28-day cycle or 7 DPO. Target >10 ng/mL for adequate luteal phase; <5 = deficiency" },
      { test: "LH + FSH (day 2–4)", reason: "LH:FSH ratio and FSH level — rules out premature ovarian insufficiency and confirms hypothalamic signalling" },
      { test: "Prolactin (fasting, morning)", reason: "Elevated prolactin suppresses LH and progesterone — caused by stress, dopamine dysregulation, or pituitary adenoma" },
      { test: "TSH, fT4", reason: "Hypothyroidism directly suppresses LH surge and impairs progesterone synthesis" },
      { test: "DUTCH urine panel (if affordable)", reason: "Maps progesterone metabolites across the whole cycle — confirms production AND metabolism of progesterone" },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "bone-health",
    display_name: "Bone Health & Osteoporosis Prevention",
    icon: "🦴",
    description: "Build bone density with the full mineral matrix — not just calcium — and address accelerated loss post-menopause",
    primary_topics: ["osteoporosis", "cardiometabolic-health"],
    contributing_topics: ["perimenopause", "thyroid-dysfunction", "gut-dysfunction"],
    presenting_symptoms: ["joint-pain", "height-loss", "fracture-history", "low-back-pain"],
    supplements: [
      {
        supplement_slug: "vitamin-d3-k2",
        display_name: "Vitamin D3 + K2 (MK-7 form)",
        dose_display: "D3: 2000–5000 IU + K2: 100–200 mcg",
        timing: "With largest meal (fat-soluble)",
        coach_rationale: "D3 and K2 must be taken together: D3 increases calcium absorption from the gut, K2 (MK-7) directs calcium INTO bones (via osteocalcin) and AWAY from arteries (via Matrix Gla Protein). Taking D3 without K2 risks arterial calcification.",
      },
      {
        supplement_slug: "magnesium-glycinate",
        display_name: "Magnesium Glycinate",
        dose_display: "300–400 mg",
        timing: "Before bed",
        coach_rationale: "Over 300 enzymatic reactions require magnesium — including osteoblast activity. 60% of body magnesium is stored in bone. Magnesium and calcium must be balanced; excess calcium without magnesium is pro-inflammatory.",
      },
      {
        supplement_slug: "collagen-type-1",
        display_name: "Collagen Peptides (Type 1 — hydrolysed)",
        dose_display: "10–15 g",
        timing: "Morning with Vit C (enhances collagen cross-linking)",
        coach_rationale: "Bone is 35% collagen matrix — the scaffold calcium mineralises onto. Collagen peptide supplementation increases bone mineral density and reduces fracture markers in post-menopausal women.",
      },
      {
        supplement_slug: "boron",
        display_name: "Boron",
        dose_display: "3 mg",
        timing: "With a meal",
        coach_rationale: "Boron extends the half-life of Vitamin D, oestrogen, and testosterone — all critical for bone. Reduces urinary calcium loss. Often overlooked but highly effective trace mineral for bone.",
      },
    ],
    nutrition_add: [
      "Ragi (finger millet) daily — highest calcium of any grain (344 mg/100g); as roti, dosa, porridge",
      "Sesame seeds (til) — 1–2 tbsp daily; 975 mg calcium/100g (more than dairy)",
      "Dairy if tolerated: curd, paneer, A2 milk — choose organic",
      "Sardines and small fish with bones — calcium + Vit D + omega-3 combined",
      "Dark leafy greens: amaranth, moringa, palak — high calcium (cook to reduce oxalates)",
      "Bone broth (homemade) — glycine, proline, collagen precursors",
      "Prunes (3–6 daily) — clinical evidence shows prunes preserve bone density post-menopause via reducing bone resorption markers",
      "Silicon-rich foods: oats, barley, green beans — supports collagen matrix formation",
    ],
    nutrition_reduce: [
      "Excess caffeine — accelerates urinary calcium excretion (limit to 1–2 cups/day)",
      "Alcohol — suppresses osteoblast activity directly",
      "High-sodium processed foods — sodium competes with calcium for renal reabsorption",
      "Soft drinks / cola (especially diet) — phosphoric acid depletes bone calcium",
      "Oxalate-rich foods in excess (spinach, almonds, chocolate) if calcium absorption is poor — cook to reduce",
      "Long-term PPI use — impairs calcium absorption (requires stomach acid for dissolution)",
    ],
    nutrition_pattern: "Calcium-rich from whole foods. Daily ragi, sesame, leafy greens. Adequate protein for bone matrix. No alcohol.",
    lifestyle_practices: [
      {
        name: "Weight-bearing exercise — essential, not optional",
        cadence: "Daily",
        details: "Bone responds to mechanical load — weight-bearing is the only way to stimulate new bone formation. Walking, hiking, dancing, and all resistance training count. Swimming and cycling do NOT load bone.",
      },
      {
        name: "Resistance training with progressive overload — 3× week",
        cadence: "3× week",
        details: "Lifting heavier over time creates the mechanical stress that triggers osteoblast activation. Hip hinge and loaded squat patterns load the hip — the most critical fracture site.",
      },
      {
        name: "Fall prevention — balance training",
        cadence: "Daily",
        details: "Fractures happen from falls, not just low density. Single-leg balance, yoga, Tai Chi reduce fall risk by 25–45%. Stand on one leg while brushing teeth — 2 minutes/leg daily.",
      },
      {
        name: "Sun exposure for Vitamin D",
        cadence: "Daily",
        details: "10–20 minutes of midday sun on arms and legs (without sunscreen) produces 1000–2000 IU Vit D. Supplement in addition — food and sun alone rarely achieve optimal levels.",
      },
    ],
    tracking_habits: [
      { name: "Weight-bearing exercise minutes per week", cadence: "Weekly" },
      { name: "Single-leg balance time (seconds each leg)", cadence: "Monthly" },
      { name: "Calcium from food estimate", cadence: "Weekly" },
    ],
    tracking_symptoms: ["joint-pain", "back-pain", "muscle-cramps"],
    lab_orders: [
      { test: "Vitamin D (25-OH)", reason: "Target 60–80 ng/mL for bone protection. Below 40 = significantly impaired calcium absorption" },
      { test: "Calcium (serum) + ionised calcium", reason: "Serum calcium is tightly regulated — if low, it has been pulled from bone. Check alongside PTH" },
      { test: "PTH (parathyroid hormone)", reason: "Elevated PTH = body pulling calcium from bone to maintain serum levels — sign of chronic deficiency" },
      { test: "DEXA scan (dual-energy X-ray absorptiometry)", reason: "Gold standard bone density measurement. Essential baseline at menopause onset. Repeat every 2 years" },
      { test: "CTX (C-telopeptide) — bone resorption marker", reason: "Blood marker showing how fast bone is being broken down. Elevated post-menopause — tracks response to intervention" },
      { test: "P1NP — bone formation marker", reason: "Tracks bone building activity — should rise with effective treatment" },
      { test: "Magnesium (RBC)", reason: "Serum magnesium is unreliable. RBC magnesium reflects true intracellular/bone stores" },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "anxiety-nervous-system",
    display_name: "Anxiety & Nervous System Dysregulation",
    icon: "🧠",
    description: "Restore vagal tone, support GABA and neurotransmitter balance, calm the HPA-nervous system loop",
    primary_topics: ["anxiety", "nervous-system-regulation"],
    contributing_topics: ["adrenal-dysfunction", "gut-brain-axis", "chronic-stress"],
    presenting_symptoms: ["anxiety", "panic-attacks", "racing-thoughts", "insomnia", "fatigue", "irritability"],
    supplements: [
      {
        supplement_slug: "magnesium-glycinate",
        display_name: "Magnesium Glycinate",
        dose_display: "400 mg",
        timing: "Evening with dinner or before bed",
        coach_rationale: "Magnesium is nature's calcium channel blocker — inhibits excitatory NMDA receptors and activates GABA receptors. Deficiency causes hyperarousal, anxiety, and muscle tension. One of the most evidence-backed anti-anxiety supplements.",
      },
      {
        supplement_slug: "l-theanine",
        display_name: "L-Theanine",
        dose_display: "200–400 mg",
        timing: "Morning (with or instead of coffee) and/or during anxiety trigger periods",
        coach_rationale: "Crosses the blood-brain barrier, directly increases alpha brain waves (calm-alert), raises GABA and serotonin, and reduces cortisol response to stress. Non-sedating — perfect for daytime anxiety.",
      },
      {
        supplement_slug: "ashwagandha",
        display_name: "Ashwagandha KSM-66",
        dose_display: "600 mg",
        timing: "With dinner (some prefer split morning + evening)",
        coach_rationale: "Reduces cortisol 25–30%, increases GABA activity, and has multiple RCTs showing clinically significant anxiety reduction. KSM-66 is the most studied full-spectrum extract.",
      },
      {
        supplement_slug: "lions-mane",
        display_name: "Lion's Mane Mushroom",
        dose_display: "500–1000 mg dual-extract",
        timing: "Morning with breakfast",
        coach_rationale: "Stimulates NGF (nerve growth factor) — supports neuroplasticity and repair of stress-damaged neural circuits. Clinical evidence for reducing anxiety and depression in peri/post-menopausal women.",
      },
      {
        supplement_slug: "b-complex",
        display_name: "B Complex (methylated)",
        dose_display: "1 capsule",
        timing: "With breakfast",
        coach_rationale: "B6 is required for GABA and serotonin synthesis. B12 and methylfolate support methylation (low methylation = low neurotransmitter production = anxiety and depression).",
      },
    ],
    nutrition_add: [
      "Fermented foods daily: homemade curd, kanji, idli/dosa (gut-brain axis — 90% of serotonin is made in the gut)",
      "Omega-3 rich foods: fatty fish 3× week, flaxseeds, walnuts — anti-inflammatory, reduces neuroinflammation",
      "Magnesium-rich foods: dark chocolate (85%), pumpkin seeds, almonds, leafy greens",
      "Tryptophan-rich foods at dinner: turkey, chicken, banana, oats — tryptophan converts to serotonin",
      "Saffron (a pinch in warm milk) — clinical trials show anti-anxiety effects comparable to low-dose SSRIs",
      "Green tea over coffee — L-theanine + lower caffeine = calm alertness without anxiety spikes",
    ],
    nutrition_reduce: [
      "Caffeine (especially after 12 PM) — direct anxiogenic; blocks adenosine (calming), raises cortisol and adrenaline",
      "Alcohol — initially calms but rebounds to anxiety as it metabolises; disrupts GABA balance",
      "Refined sugar — blood sugar crashes trigger cortisol and adrenaline (anxiety symptoms)",
      "Ultra-processed food — depletes B vitamins and magnesium required for neurotransmitter synthesis",
      "Skipping meals — hypoglycaemia is physically identical to an anxiety attack (palpitations, dizziness, sweating)",
    ],
    nutrition_pattern: "Blood-sugar stable, gut-supportive, anti-inflammatory. Regular meals, fermented foods daily, reduced caffeine.",
    lifestyle_practices: [
      {
        name: "Physiological sigh — real-time anxiety reset",
        cadence: "As needed / Daily",
        details: "Double inhale through nose (fill lungs + top up), then long slow exhale through mouth. The extended exhale activates vagus nerve and drops heart rate within 1–2 breaths. Use in any anxious moment.",
      },
      {
        name: "Daily vagal tone practice",
        cadence: "Daily",
        details: "Vagal tone is trainable. Daily practices: humming, gargling, cold water face splash, singing, diaphragmatic breathing. Higher HRV = higher vagal tone = anxiety resilience. Aim for 15–20 min total.",
      },
      {
        name: "Limit news and social media — set windows",
        cadence: "Daily",
        details: "Doom-scrolling chronically activates the threat-detection system. Set specific windows (e.g. 15 min at lunch only). No phones in bedroom.",
      },
      {
        name: "Morning movement — before checking phone",
        cadence: "Daily",
        details: "10–20 min walk or yoga before any screen. Anchors the nervous system in regulation before the day's stressors begin. Outdoor light exposure adds circadian benefit.",
      },
      {
        name: "Co-regulation — social nervous system",
        cadence: "Weekly",
        details: "The nervous system is regulated in relationship. Safe, warm social connection (not just social media) directly reduces anxiety. Schedule 1–2 meaningful in-person connections per week.",
      },
    ],
    tracking_habits: [
      { name: "Anxiety level (1–10 morning and evening)", cadence: "Twice daily" },
      { name: "HRV (if using wearable)", cadence: "Daily" },
      { name: "Caffeine intake", cadence: "Daily" },
    ],
    tracking_symptoms: ["anxiety", "panic-attacks", "insomnia", "irritability", "fatigue"],
    lab_orders: [
      { test: "Cortisol (4-point diurnal salivary or DUTCH)", reason: "Chronic anxiety is often HPA dysregulation — map the cortisol rhythm before treating" },
      { test: "TSH, fT3, fT4", reason: "Hyperthyroidism and Hashimoto's flares both cause anxiety, palpitations, and insomnia — must rule out" },
      { test: "Magnesium (RBC)", reason: "Intracellular magnesium deficiency = hyperexcitability of nervous system — serum level is unreliable" },
      { test: "Vitamin B12 + folate", reason: "Deficiency causes neurological symptoms including anxiety, tingling, mood dysregulation" },
      { test: "Ferritin", reason: "Iron deficiency causes restlessness, palpitations, and anxiety symptoms — commonly missed" },
      { test: "GI-MAP stool test", reason: "Gut dysbiosis reduces serotonin and GABA production — treat the gut to treat the brain" },
      { test: "MTHFR genotyping", reason: "C677T variant impairs methylation and neurotransmitter synthesis — explains treatment-resistant anxiety" },
    ],
  },
];
