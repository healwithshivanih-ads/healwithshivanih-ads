/**
 * Guided-tier protocol content — the PUBLIC copy for self-guided programmes.
 *
 * Authored from the catalogue protocols (../fm-database/data/protocols/) with
 * the public-surface rules applied (docs in ochre-funnel:
 * APP_PRODUCT_STRUCTURE.md §4 + APP_STAGE1_FIELD_AUDIT.md):
 *
 *   - NO `indications` — a programme is never "for" a condition. The user
 *     self-selects; marketing may name the audience, the product may not
 *     claim to treat them (DMR Act / CDSCO general-wellness position).
 *   - NO supplement doses in actions. Supplements appear only in the
 *     `commonlyUsed` reference panel — names, no doses, no scheduling.
 *     (Catalogue phase 2 of adrenal-recovery and 5R's Repair were
 *     supplement-led; rewritten food-and-lifestyle-forward here.)
 *   - NO lab instructions ("re-test HbA1c at week 8") — labs belong to the
 *     assessment/maintenance tiers.
 *   - Every protocol carries `screening` built from the catalogue
 *     `contraindications`: hard=true routes to the assessment instead of
 *     purchase. Answers are never stored (checked client-side only).
 *   - The standard-version disclosure is rendered by the app on every
 *     protocol screen; it is part of the tier, not per-protocol copy.
 *
 * Phase structure is the REAL catalogue structure (verified 3 Aug 2026):
 * gut-reset 12wk/5 phases · blood-sugar 10wk/3 · energy-stress 12wk/3 ·
 * anti-inflammatory 10wk/3. (Early prototypes said "4 phases" for the last
 * three — that was illustrative and is corrected here.)
 */

export interface GuidedPhase {
  name: string;
  /** 1-indexed, inclusive. */
  startWeek: number;
  endWeek: number;
  /** Client-facing one-liner, shown in the ribbon's "You're here" card. */
  note: string;
  /** Behavioural actions for the phase — public copy, dose-free. */
  actions: string[];
}

export interface GuidedPracticeDef {
  /** Display name, e.g. "Extended-exhale breathing". */
  name: string;
  /** Cadence phrase fed to the practice-chip deriver ("Daily", "Evening"…). */
  cadence: string;
  /** Catalogue somatic practice slug (drives the guided player). */
  somatic_practice?: string;
  /** Optional detail line shown under the practice. */
  details?: string;
  /** First week this practice opens (1-indexed). Defaults to 1. */
  startWeek?: number;
}

export interface GuidedSampleWeek {
  /** Headline phase name this week belongs to (phaseForWeek output). */
  phase: string;
  /** 7 days × slot→dish. Every dish is an EXACT catalogue recipe title from
   *  fm-database/data/_recipes/ — enforced by guided-tier.test.ts. NO
   *  AI-authored recipes: the app renders the library recipe verbatim. */
  days: { dow: string; slots: { slot: string; dish: string }[] }[];
  /** One warm line about what this week is naturally rich in. */
  nourishment: string;
}

export interface GuidedLibraryPractice {
  /** Catalogue somatic practice slug. */
  slug: string;
  /** Client-voiced one-liner shown in the library + player intro — replaces
   *  the catalogue's clinical summary on guided surfaces. */
  line: string;
}

export interface GuidedAbout {
  /** What this programme is — two or three plain sentences. */
  what: string;
  /** The phase arc in one paragraph. */
  arc: string;
  /** "What members commonly notice" — experiential language ONLY (energy,
   *  bloating after meals, sleep). Never condition/treatment claims (DMR). */
  notice: string[];
  /** Who it suits — lifestyle framing. */
  rightFor: string[];
  /** Who should take the assessment path instead — mirrors the screening. */
  assessFirst: string[];
}

export interface GuidedScreeningQ {
  q: string;
  /** true → a "yes" routes to the assessment; false → informational only. */
  hard: boolean;
}

export interface GuidedProtocol {
  /** Public slug used in URLs + subscriber records. */
  slug: string;
  /** Catalogue protocol this was authored from (provenance, not rendered). */
  catalogueSlug: string;
  name: string;
  /** One-line description for pickers + the plan tab. */
  short: string;
  weeks: number;
  phases: GuidedPhase[];
  foods: {
    eat: string[];
    sometimes: string[];
    avoid: string[];
    avoidWhy: string;
  };
  principles: { t: string; b: string }[];
  practices: GuidedPracticeDef[];
  /** Reference-only supplement names — NO doses, NO schedule. */
  commonlyUsed: string[];
  faq: { q: string; a: string }[];
  screening: GuidedScreeningQ[];
  /** Midday hero line (Today) — protocol-appropriate food emphasis. */
  heroMidday?: string;
  /** The programme's introduction — renders on Plan + week zero. */
  about?: GuidedAbout;
  /** Curated playable practice library (beyond the daily prescriptions). */
  practiceLibrary?: GuidedLibraryPractice[];
  /** One illustrative rotation week per headline phase ("Sample menu"). */
  sampleWeeks?: GuidedSampleWeek[];
}

/** Appended to every food surface — allergies override every list, always.
 *  (Allergies are never stored server-side; this line does the safety work
 *  universally instead of a computed per-user filter.) */
export const ALLERGY_OVERRIDE_LINE =
  "And one rule above all of these: anything you are allergic or intolerant to overrides every list here — leave it out, whatever the programme says.";

const COMMON_SCREENING: GuidedScreeningQ[] = [
  { q: "Are you pregnant or breastfeeding?", hard: true },
  { q: "Have you ever been treated for an eating disorder?", hard: true },
  { q: "Are you taking any prescribed medication?", hard: false },
  { q: "Do you have any food allergies?", hard: false },
];

export const GUIDED_PROTOCOLS: GuidedProtocol[] = [
  // ── The 12-Week Gut Reset (5R) ──────────────────────────────────────────
  {
    slug: "gut-reset",
    catalogueSlug: "5r-gut-protocol",
    name: "The 12-Week Gut Reset",
    short:
      "A phased sequence — take things out, support digestion, rebuild, then settle into a way of eating you keep.",
    weeks: 12,
    phases: [
      {
        name: "Remove",
        startWeek: 1,
        endWeek: 2,
        note: "Taking out the usual irritants and watching what changes.",
        actions: [
          "Take gluten, dairy, processed sugar and alcohol out for now",
          "Cook with ghee, coconut oil or cold-pressed mustard oil — set the refined seed oils aside",
          "Keep a simple daily note: what you ate, how you felt",
          "Sleep 7–9 hours, at consistent times",
        ],
      },
      {
        name: "Replace",
        startWeek: 1,
        endWeek: 4,
        note: "Putting back what digestion needs to do its job.",
        actions: [
          "Sit down to eat, and chew each mouthful properly — digestion starts in the mouth",
          "A small piece of ginger with rock salt before meals to wake up digestion",
          "Eat your largest meal at midday, when digestion is strongest",
          "Stop eating about 3 hours before bed",
        ],
      },
      {
        name: "Reinoculate",
        startWeek: 3,
        endWeek: 8,
        note: "Feeding and repopulating the good bacteria.",
        actions: [
          "One serving of fermented food daily — homemade curd, kanji, idli or dosa batter ferments",
          "Cooked vegetables at every meal — variety matters more than quantity",
          "Add prebiotic foods through the week: garlic, onion, slightly cooled rice, raw banana — if you avoid onion and garlic, cooled rice, raw banana and sabja seeds do the same job",
          "Keep the daily food-and-feeling note going — patterns show up around now",
        ],
      },
      {
        name: "Repair",
        startWeek: 5,
        endWeek: 10,
        note: "Rebuilding the gut lining with food that does the work.",
        actions: [
          "A cup of slow-simmered broth most days — bone broth, or a moong-and-vegetable broth",
          "Well-cooked, soft vegetables — lauki, pumpkin, carrots — over raw salads for now",
          "Stewed apple or pear with cinnamon as your sweet",
          "Keep meals warm, simple and unhurried — the lining repairs when the system is calm",
        ],
      },
      {
        name: "Rebalance",
        startWeek: 9,
        endWeek: 12,
        note: "The sleep, stress and eating rhythm that holds it — and keeps going.",
        actions: [
          "Reintroduce one removed food at a time, three days apart, and note what you feel",
          "Keep the eating rhythm you've built — regular times, real food, no grazing",
          "Protect sleep 7–9 hours as the non-negotiable",
          "Carry your daily practice forward — this phase is yours to keep",
        ],
      },
    ],
    foods: {
      eat: [
        "Cooked vegetables, every meal",
        "Dal, moong and well-soaked legumes",
        "Fermented foods — curd, kanji, dosa/idli",
        "Slow-simmered broths — bone, or moong-and-vegetable",
        "Ghee and cold-pressed oils",
        "Stewed fruit",
      ],
      sometimes: ["Rice and millets", "Well-cooked eggs", "Fish, if you eat it"],
      avoid: [
        "Gluten (wheat, maida, suji) — for now",
        "Dairy other than fermented — for now",
        "Processed sugar",
        "Alcohol",
        "Refined seed oils",
        "Ultra-processed packaged food",
      ],
      avoidWhy:
        "These are the most common gut irritants. Taking them out for a stretch — not forever — is what lets you find out which ones matter for you. Reintroduction in the final phase is where the answer shows up.",
    },
    principles: [
      {
        t: "Remove, then rebuild — in that order",
        b: "The sequence matters. The early weeks clear the noise; the middle weeks rebuild; the last weeks teach you what your body actually reacts to.",
      },
      {
        t: "Warm, cooked, unhurried",
        b: "Through the repair weeks, warm cooked food digests with far less effort than raw. Give your gut the easy road while it heals.",
      },
    ],
    practices: [
      {
        name: "Extended-exhale breathing",
        cadence: "Daily, before your largest meal",
        somatic_practice: "extended-exhale-breathing",
        details: "A longer out-breath shifts you into rest-and-digest before you eat.",
      },
      {
        name: "5-4-3-2-1 grounding",
        cadence: "As needed",
        somatic_practice: "5-4-3-2-1-grounding",
        startWeek: 3,
      },
      {
        name: "Legs up the wall",
        cadence: "Evening",
        somatic_practice: "legs-up-the-wall",
        startWeek: 5,
        details: "Ten quiet minutes. The repair phase works best on a settled nervous system.",
      },
    ],
    commonlyUsed: [
      "L-glutamine",
      "Zinc carnosine",
      "Probiotics",
      "Digestive enzymes",
      "Aloe vera (inner leaf)",
      "Deglycyrrhizinated licorice (DGL)",
    ],
    faq: [
      {
        q: "Can I have tea or coffee?",
        a: "One or two cups a day is fine for most people — without sugar, and not as a meal replacement. If you take milk in your tea, switch to a splash or try it black through the Remove phase.",
      },
      {
        q: "What if I slip up?",
        a: "Note it and carry on from the next meal. One slip doesn't undo the phase — the pattern over weeks is what matters.",
      },
      {
        q: "I'm vegetarian — does the broth work for me?",
        a: "Yes. A slow-simmered moong and vegetable broth with ginger does the same job in the Repair phase.",
      },
      {
        q: "Why am I not seeing changes by week 3?",
        a: "Digestion usually settles first — less bloating, steadier energy after meals. Skin and deeper changes tend to arrive in the Repair weeks. Keep the daily note; slow changes hide without it.",
      },
    ],
    heroMidday:
      "Warm, cooked, unhurried — make lunch the day's biggest meal, and sit down for it.",
    about: {
      what: "A twelve-week food-and-rhythm programme for a digestive system that needs a proper reset — built on the way Indian kitchens already cook. You change what goes in, give digestion real support, and let the quiet weeks do the work.",
      arc: "It moves in five overlapping phases. The first fortnight clears the usual irritants (Remove) while simple digestion habits return (Replace). From week three you feed the good bacteria daily (Reinoculate); from week five the food turns warm and soft while the gut lining rebuilds (Repair). The final weeks bring foods back one at a time, so you leave knowing what your body actually reacts to (Rebalance).",
      notice: [
        "Less bloating and heaviness after meals is usually the first shift — often inside the first two weeks",
        "Steadier energy through the afternoon",
        "More regular, more comfortable digestion",
        "Sleep often deepens once evening eating settles",
        "By the reintroduction weeks: a clear, personal answer to \"which foods are mine to keep, and which aren't\"",
      ],
      rightFor: [
        "You suspect food is behind how you feel, but you can't tell which food",
        "You want structure and a sequence, not another list of rules",
        "You cook (or can cook) simple Indian home food most days",
        "You can give the quiet middle weeks their time — this is a 12-week arc, not a 7-day fix",
      ],
      assessFirst: [
        "You're pregnant or breastfeeding",
        "You've been treated for an eating disorder",
        "A diagnosed bowel condition is currently flaring",
        "A doctor has you on a specific diet right now",
        "You're on medication and want the programme shaped around it — that's exactly what the assessment does",
      ],
    },
    practiceLibrary: [
      { slug: "extended-exhale-breathing", line: "A longer out-breath before meals — the simplest way to switch into rest-and-digest." },
      { slug: "5-4-3-2-1-grounding", line: "Five senses, two minutes — for the moments the day runs away with you." },
      { slug: "legs-up-the-wall", line: "Ten quiet minutes with your legs up — the evening downshift." },
      { slug: "diaphragm-breathing", line: "Low, slow belly breathing — the foundation every other practice builds on." },
      { slug: "box-breathing", line: "Four counts in, hold, out, hold — steady the system anywhere, unnoticed." },
      { slug: "progressive-muscle-relaxation", line: "Tense and release, head to toe — for a body that won't put the day down." },
      { slug: "safe-body-scan", line: "A gentle scan through the body — attention without judgement." },
      { slug: "low-tone-humming", line: "A low hum on the out-breath — a quiet nudge to the calm branch of your nervous system." },
      { slug: "walking-meditation", line: "A slow, deliberate walk — movement and stillness at once." },
      { slug: "vagal-breathing-4-4-8", line: "In for four, hold four, out for eight — the long-exhale reset." },
    ],
    sampleWeeks: [
      {
        phase: "Remove",
        nourishment: "Millet mornings, one-pot dals and gentle soups — settling food while the irritants rest.",
        days: [
          { dow: "Mon", slots: [ { slot: "Breakfast", dish: "Besan chilla with methi" }, { slot: "Lunch", dish: "Moong Dal Khichdi" }, { slot: "Evening", dish: "Roasted chana & seed mix" }, { slot: "Dinner", dish: "Lauki ginger soup" } ] },
          { dow: "Tue", slots: [ { slot: "Breakfast", dish: "Ragi dosa" }, { slot: "Lunch", dish: "Jowar Vegetable Khichdi" }, { slot: "Evening", dish: "Ghee-Roasted Makhana with Pepper" }, { slot: "Dinner", dish: "Masoor dal soup" } ] },
          { dow: "Wed", slots: [ { slot: "Breakfast", dish: "Vegetable poha" }, { slot: "Lunch", dish: "Foxtail millet pulao" }, { slot: "Evening", dish: "Sprouted moong chaat" }, { slot: "Dinner", dish: "Vegetable Soup (Lauki, Ash Gourd, Drumstick)" } ] },
          { dow: "Thu", slots: [ { slot: "Breakfast", dish: "Moong dal chilla" }, { slot: "Lunch", dish: "Vegetable millet khichdi" }, { slot: "Evening", dish: "Roasted Chickpeas" }, { slot: "Dinner", dish: "Palak-moong soup" } ] },
          { dow: "Fri", slots: [ { slot: "Breakfast", dish: "Ragi porridge" }, { slot: "Lunch", dish: "Kodo millet pulao with peas and jeera" }, { slot: "Evening", dish: "Steamed Sweet Corn Chaat" }, { slot: "Dinner", dish: "Carrot-coriander soup" } ] },
          { dow: "Sat", slots: [ { slot: "Breakfast", dish: "Foxtail millet upma" }, { slot: "Lunch", dish: "Masoor dal khichdi" }, { slot: "Evening", dish: "Masala Roasted Chana" }, { slot: "Dinner", dish: "Lemon coriander soup" } ] },
          { dow: "Sun", slots: [ { slot: "Breakfast", dish: "Sama rice poha" }, { slot: "Lunch", dish: "Vegetable moong khichdi" }, { slot: "Evening", dish: "Stewed Spiced Apples" }, { slot: "Dinner", dish: "Thin moong dal soup" } ] },
        ],
      },
      {
        phase: "Reinoculate",
        nourishment: "A ferment every day — idli, kanji, curd and lassi feeding the good bacteria back.",
        days: [
          { dow: "Mon", slots: [ { slot: "Breakfast", dish: "Idli" }, { slot: "Lunch", dish: "Curd Rice (Thayir Sadam)" }, { slot: "Evening", dish: "Kanji" }, { slot: "Dinner", dish: "Moong dal soup" } ] },
          { dow: "Tue", slots: [ { slot: "Breakfast", dish: "Ragi idli" }, { slot: "Lunch", dish: "Jowar Khichdi with Cucumber Raita" }, { slot: "Evening", dish: "Everyday Digestive Lassi" }, { slot: "Dinner", dish: "Lauki soup" } ] },
          { dow: "Wed", slots: [ { slot: "Breakfast", dish: "Foxtail millet dosa" }, { slot: "Lunch", dish: "Vegetable millet khichdi" }, { slot: "Evening", dish: "Buttermilk Lassi" }, { slot: "Dinner", dish: "Bottle gourd ginger soup" } ] },
          { dow: "Thu", slots: [ { slot: "Breakfast", dish: "Little millet idli" }, { slot: "Lunch", dish: "Sprouted Mung Dal with Yogurt" }, { slot: "Evening", dish: "Sabja Seed Water" }, { slot: "Dinner", dish: "Masoor dal soup" } ] },
          { dow: "Fri", slots: [ { slot: "Breakfast", dish: "Jowar dosa" }, { slot: "Lunch", dish: "Vegetable kitchari" }, { slot: "Evening", dish: "Kanji" }, { slot: "Dinner", dish: "Tomato rasam" } ] },
          { dow: "Sat", slots: [ { slot: "Breakfast", dish: "Besan uttapam" }, { slot: "Lunch", dish: "Curd Rice (Thayir Sadam)" }, { slot: "Evening", dish: "Ginger Lime Lassi" }, { slot: "Dinner", dish: "Vegetable soup (lauki)" } ] },
          { dow: "Sun", slots: [ { slot: "Breakfast", dish: "Everyday Dosa" }, { slot: "Lunch", dish: "Foxtail millet khichdi" }, { slot: "Evening", dish: "Cooling Cucumber-Mint Raita" }, { slot: "Dinner", dish: "Rasam" } ] },
        ],
      },
      {
        phase: "Repair",
        nourishment: "Warm, soft and slow — porridges, kichari and simmered broths while the lining rebuilds.",
        days: [
          { dow: "Mon", slots: [ { slot: "Breakfast", dish: "Ragi porridge" }, { slot: "Lunch", dish: "Moong dal kitchari" }, { slot: "Evening", dish: "Everyday Vegetable Broth" }, { slot: "Dinner", dish: "Lauki ginger soup" } ] },
          { dow: "Tue", slots: [ { slot: "Breakfast", dish: "Sama porridge" }, { slot: "Lunch", dish: "Everyday Kichari" }, { slot: "Evening", dish: "Stewed Apples with Dates" }, { slot: "Dinner", dish: "Bottle gourd ginger soup" } ] },
          { dow: "Wed", slots: [ { slot: "Breakfast", dish: "Foxtail millet porridge" }, { slot: "Lunch", dish: "Mixed-veg moong dal khichdi" }, { slot: "Evening", dish: "Everyday Vegetable Broth" }, { slot: "Dinner", dish: "Carrot-coriander soup" } ] },
          { dow: "Thu", slots: [ { slot: "Breakfast", dish: "Kodo Millet Cooked Soft" }, { slot: "Lunch", dish: "Moong Dal Khichdi" }, { slot: "Evening", dish: "Cooked Apple With Nutmeg And Ghee" }, { slot: "Dinner", dish: "Palak-moong soup" } ] },
          { dow: "Fri", slots: [ { slot: "Breakfast", dish: "Ragi porridge" }, { slot: "Lunch", dish: "Foxtail millet pongal" }, { slot: "Evening", dish: "Lemon ginger soup" }, { slot: "Dinner", dish: "Moong dal soup" } ] },
          { dow: "Sat", slots: [ { slot: "Breakfast", dish: "Sama khichdi" }, { slot: "Lunch", dish: "Vegetable moong khichdi" }, { slot: "Evening", dish: "Stewed Spiced Apples" }, { slot: "Dinner", dish: "Lauki soup" } ] },
          { dow: "Sun", slots: [ { slot: "Breakfast", dish: "Foxtail millet porridge" }, { slot: "Lunch", dish: "Masoor dal khichdi" }, { slot: "Evening", dish: "Everyday Vegetable Broth" }, { slot: "Dinner", dish: "Thin dal soup" } ] },
        ],
      },
      {
        phase: "Rebalance",
        nourishment: "The settled rhythm — wider variety, ferments staying, reintroductions running alongside.",
        days: [
          { dow: "Mon", slots: [ { slot: "Breakfast", dish: "Besan chilla with methi" }, { slot: "Lunch", dish: "Vegetable millet pulao" }, { slot: "Evening", dish: "Sprouted moong salad" }, { slot: "Dinner", dish: "Sambar" } ] },
          { dow: "Tue", slots: [ { slot: "Breakfast", dish: "Idli" }, { slot: "Lunch", dish: "Palak moong dal" }, { slot: "Evening", dish: "Roasted chana & seed mix" }, { slot: "Dinner", dish: "Tomato rasam" } ] },
          { dow: "Wed", slots: [ { slot: "Breakfast", dish: "Ragi dosa" }, { slot: "Lunch", dish: "Chana masala" }, { slot: "Evening", dish: "Cucumber Mint Raita" }, { slot: "Dinner", dish: "Vegetable Soup (Lauki, Ash Gourd, Drumstick)" } ] },
          { dow: "Thu", slots: [ { slot: "Breakfast", dish: "Vegetable poha" }, { slot: "Lunch", dish: "Rajma" }, { slot: "Evening", dish: "Mixed sprouts chaat" }, { slot: "Dinner", dish: "Moong dal soup" } ] },
          { dow: "Fri", slots: [ { slot: "Breakfast", dish: "Moong dal chilla" }, { slot: "Lunch", dish: "Vegetable bajra khichdi" }, { slot: "Evening", dish: "Everyday Digestive Lassi" }, { slot: "Dinner", dish: "Rasam" } ] },
          { dow: "Sat", slots: [ { slot: "Breakfast", dish: "Foxtail millet upma" }, { slot: "Lunch", dish: "Sprouted chana curry" }, { slot: "Evening", dish: "Stewed Apples with Dates" }, { slot: "Dinner", dish: "Palak-moong soup" } ] },
          { dow: "Sun", slots: [ { slot: "Breakfast", dish: "Sama rice poha" }, { slot: "Lunch", dish: "Curd Rice (Thayir Sadam)" }, { slot: "Evening", dish: "Kanji" }, { slot: "Dinner", dish: "Lemon coriander soup" } ] },
        ],
      },
    ],
    screening: [
      ...COMMON_SCREENING,
      {
        q: "Do you have a diagnosed inflammatory bowel condition that's currently flaring?",
        hard: true,
      },
      { q: "Has a doctor told you to follow a specific diet right now?", hard: true },
    ],
  },

  // ── Blood Sugar Balance ────────────────────────────────────────────────
  {
    slug: "blood-sugar-balance",
    catalogueSlug: "blood-sugar-regulation",
    name: "Blood Sugar Balance",
    short:
      "Small changes to the order and timing of what you already eat, then the habits that keep it steady.",
    weeks: 10,
    phases: [
      {
        name: "Foundation",
        startWeek: 1,
        endWeek: 2,
        note: "Changing the order and rhythm of eating — not what you buy.",
        actions: [
          "Three meals and one snack — protein at every meal",
          "Eat in this order: vegetables first, then protein, then carbohydrates",
          "A 10-minute walk after every meal",
          "Cut liquid sugar — sweetened drinks, packaged juices",
          "Keep white rice, white bread and maida to once a week for now",
          "A simple daily note: what you ate, how your energy felt",
        ],
      },
      {
        name: "Build",
        startWeek: 3,
        endWeek: 6,
        note: "Teaching your body to run steady between meals.",
        actions: [
          "A 12-hour overnight gap — for example 8pm to 8am. Not extended fasting.",
          "Carbohydrates from whole food — millets, dal, vegetables — in moderate portions",
          "Strength work twice a week, 30 minutes — bodyweight is enough to start",
          "Walk 30 minutes on most days",
          "A spoon of apple cider vinegar in water before your biggest meal",
          "Cinnamon in your food or tea daily",
        ],
      },
      {
        name: "Hold",
        startWeek: 7,
        endWeek: 10,
        note: "Making the steady version your default.",
        actions: [
          "Keep the 12-hour overnight gap as your normal",
          "Food order at every meal — it's the habit that carries everything",
          "If things feel steady, try a small portion of a food you'd cut, and notice what happens",
          "Decide which habits are permanent — most people keep the walk and the food order for life",
        ],
      },
    ],
    foods: {
      eat: [
        "Protein at every meal — dal, paneer, eggs, fish, chicken",
        "Vegetables first, every meal",
        "Millets and whole grains",
        "Nuts and seeds",
        "Curd and fermented foods",
      ],
      sometimes: ["Rice with dal and vegetables", "Fruit, whole — not juiced", "Jaggery, occasionally"],
      avoid: [
        "Sugary drinks and packaged juice",
        "Maida — bread, biscuits, bakery",
        "Sweets as a daily habit",
        "Long gaps followed by large meals",
      ],
      avoidWhy:
        "These push glucose up fast and drop it hard, which drives the crash-and-crave cycle. The programme is built to flatten that curve with rhythm and order rather than restriction.",
    },
    principles: [
      {
        t: "Order beats willpower",
        b: "Vegetables first, then protein, then carbs measurably lowers the glucose rise from the same plate of food. Same food, different order, different day.",
      },
      {
        t: "Muscle is where glucose goes",
        b: "The walks and the twice-weekly strength work give glucose somewhere to go. That's why movement sits inside a blood-sugar programme.",
      },
    ],
    practices: [
      {
        name: "Walking after meals",
        cadence: "After every meal",
        details: "Ten minutes is enough. This is the single highest-leverage habit in the programme.",
      },
      {
        name: "Extended-exhale breathing",
        cadence: "Evening",
        somatic_practice: "extended-exhale-breathing",
        startWeek: 3,
        details: "Stress hormones raise glucose. The evening practice is part of the metabolic work, not an extra.",
      },
      {
        name: "Box breathing",
        cadence: "As needed",
        somatic_practice: "box-breathing",
        startWeek: 5,
      },
    ],
    commonlyUsed: ["Magnesium", "Chromium", "Berberine", "Myo-inositol", "Cinnamon extract"],
    faq: [
      {
        q: "Is this a low-carb diet?",
        a: "No. It keeps carbohydrates — as whole food, in moderate portions, eaten in the right order. The target is a steadier curve, not a carb-free plate.",
      },
      {
        q: "Can I do the overnight gap if I take medication?",
        a: "If you take any medication that involves food timing — especially for blood sugar — this programme isn't the right fit to self-run. The screening will have flagged this; a proper assessment is the safe way in.",
      },
      {
        q: "What about eating out?",
        a: "Use the order rule — start with whatever vegetables are on the table, protein next, carbs last — and take the after-meal walk. The habits travel better than any food list.",
      },
    ],
    screening: [
      { q: "Are you pregnant or breastfeeding?", hard: true },
      { q: "Do you take insulin or any medication for blood sugar?", hard: true },
      { q: "Have you ever been treated for an eating disorder?", hard: true },
      { q: "Are you taking any other prescribed medication?", hard: false },
      { q: "Do you have any food allergies?", hard: false },
    ],
  },

  // ── Energy & Stress Recovery ───────────────────────────────────────────
  {
    slug: "energy-stress-recovery",
    catalogueSlug: "adrenal-recovery-protocol",
    name: "Energy & Stress Recovery",
    short:
      "Rebuilding energy from the bottom up — light, sleep timing, food rhythm, and a nervous system that isn't braced all day.",
    weeks: 12,
    phases: [
      {
        name: "Foundation",
        startWeek: 1,
        endWeek: 4,
        note: "Sleep, light and food rhythm. Nothing fancy — the foundation is the medicine.",
        actions: [
          "Three balanced meals and a snack — never skip, never go more than 4 hours without food",
          "Caffeine down to one cup, before noon — taper gently if you're on more",
          "Alcohol out for now",
          "In bed by 10, aiming for 8 hours minimum",
          "Morning daylight on your face — 10 minutes, within half an hour of waking",
          "One 10-minute restorative practice daily — it's in the app",
        ],
      },
      {
        name: "Restore",
        startWeek: 5,
        endWeek: 8,
        note: "Deepening recovery once the rhythm holds.",
        actions: [
          "Keep every Foundation habit — this phase builds on it, not past it",
          "Gentle movement only: walking, yoga, swimming. No HIIT, no heavy lifting yet.",
          "A pinch of good salt in a glass of water on waking",
          "Five minutes of end-of-day journaling — empty the head before bed",
          "Protect one genuinely restful block every weekend",
        ],
      },
      {
        name: "Re-engage",
        startWeek: 9,
        endWeek: 12,
        note: "Adding intensity back at a level that gives more than it takes.",
        actions: [
          "Strength training twice a week — light, building to moderate",
          "If you want caffeine back, add half a cup and watch your sleep",
          "Name the stress sources that drained you — and pick the one you'll change long-term",
          "Keep the morning light and the daily practice. They're permanent.",
        ],
      },
    ],
    foods: {
      eat: [
        "Regular meals — rhythm over perfection",
        "Protein and fat at breakfast",
        "Root vegetables and whole grains",
        "Good salt, used normally",
        "Warm, cooked, grounding food",
      ],
      sometimes: ["One coffee or chai, before noon", "Fruit as your sweet"],
      avoid: ["Caffeine after noon", "Alcohol — for now", "Skipped meals", "Sugar surges on an empty stomach"],
      avoidWhy:
        "A stressed system reads long gaps, late caffeine and alcohol as more stress. Taking them out for a stretch gives the recovery a floor to build on.",
    },
    principles: [
      {
        t: "Energy is rebuilt, not summoned",
        b: "The programme doesn't push you to do more — it removes the leaks first. Most people feel the floor rise in the Restore weeks, not week one.",
      },
      {
        t: "Light sets the clock",
        b: "Morning daylight is the strongest signal your body clock gets. It costs ten minutes and changes how the whole day runs.",
      },
    ],
    practices: [
      {
        name: "Darkened eye rest with long exhale",
        cadence: "Daily",
        somatic_practice: "darkened-eye-rest-long-exhale",
        details: "The daily 10-minute downshift. Same time each day works best.",
      },
      {
        name: "Legs up the wall",
        cadence: "Evening",
        somatic_practice: "legs-up-the-wall",
        startWeek: 3,
      },
      {
        name: "Vagal breathing 4-4-8",
        cadence: "As needed",
        somatic_practice: "vagal-breathing-4-4-8",
        startWeek: 5,
      },
      {
        name: "Walking meditation",
        cadence: "2× / week",
        somatic_practice: "walking-meditation",
        startWeek: 9,
      },
    ],
    commonlyUsed: ["Ashwagandha", "Rhodiola", "Magnesium glycinate", "Vitamin C", "B-complex"],
    faq: [
      {
        q: "I can't sleep by 10 — does the programme still work?",
        a: "Move bedtime earlier in 20-minute steps rather than all at once. The consistency matters more than the exact hour — but the direction is non-negotiable.",
      },
      {
        q: "Why no hard exercise? I thought exercise gives energy.",
        a: "It does — once there's a reserve to draw on. On an empty tank, intense training is another stressor. The Re-engage phase brings it back deliberately.",
      },
      {
        q: "Coffee is my lifeline. One cup, really?",
        a: "Really — but taper, don't cliff-drop. Halve for a week, then halve again. By the Restore weeks most people are surprised how little they miss it.",
      },
    ],
    screening: [
      ...COMMON_SCREENING,
      { q: "Are you currently being treated for a sleep disorder?", hard: true },
      { q: "Are you being treated for a thyroid condition?", hard: false },
    ],
  },

  // ── Anti-Inflammatory Reset ────────────────────────────────────────────
  {
    slug: "anti-inflammatory-reset",
    catalogueSlug: "anti-inflammatory-reset",
    name: "Anti-Inflammatory Reset",
    short: "Turning the volume down — what you eat, how you move, how well you sleep. In that order.",
    weeks: 10,
    phases: [
      {
        name: "Remove",
        startWeek: 1,
        endWeek: 2,
        note: "Taking out the loudest drivers first.",
        actions: [
          "Refined seed oils out — cook with ghee, cold-pressed mustard or coconut oil",
          "Sugar and sweeteners out for these two weeks — including jaggery and honey",
          "Maida and refined grains out",
          "Alcohol out",
          "Processed and packaged meats out",
          "Packaged baked goods and biscuits out",
        ],
      },
      {
        name: "Add",
        startWeek: 3,
        endWeek: 6,
        note: "Crowding in the foods that actively calm the system.",
        actions: [
          "One to two cups of colourful vegetables at every meal",
          "If you eat fish: sardines, mackerel or salmon three times a week",
          "A cup of berries or seasonal fruit daily",
          "Cold-pressed olive oil or ghee as your daily fats",
          "Turmeric and ginger in your cooking, daily",
          "One serving of fermented food a day",
          "Two or three cups of green tea through the day",
        ],
      },
      {
        name: "Reinforce",
        startWeek: 7,
        endWeek: 10,
        note: "Finding your version — what returns, what stays out.",
        actions: [
          "Reintroduce unrefined sweeteners in small amounts — raw honey, jaggery — and notice",
          "Test which removed foods can come back without your body objecting",
          "Keep the vegetables, the good fats and the daily turmeric — those are permanent",
          "Thirty minutes of easy movement most days, for keeps",
        ],
      },
    ],
    foods: {
      eat: [
        "Colourful vegetables, every meal",
        "Fatty fish, if you eat fish — walnuts, flax and chia if you don't",
        "Berries and seasonal fruit",
        "Ghee and cold-pressed oils",
        "Turmeric, ginger, garlic",
        "Fermented foods",
        "Green tea",
      ],
      sometimes: ["Whole grains and millets", "Nuts, a small handful", "Eggs"],
      avoid: [
        "Refined seed oils",
        "Sugar and refined sweeteners",
        "Maida and bakery goods",
        "Processed meats",
        "Alcohol — for now",
      ],
      avoidWhy:
        "These are the most consistent dietary drivers of background inflammation. Two strict weeks, then the Add phase does most of the work by crowding in rather than cutting out.",
    },
    principles: [
      {
        t: "Crowd in, don't just cut out",
        b: "The Remove phase is short and strict; the longer Add phase is generous. Most of the anti-inflammatory effect comes from what you add.",
      },
      {
        t: "Movement is anti-inflammatory at the right dose",
        b: "Easy, regular movement lowers inflammation; occasional all-out sessions can raise it. Thirty gentle minutes most days beats one brutal workout.",
      },
    ],
    practices: [
      {
        name: "Diaphragm breathing",
        cadence: "Daily",
        somatic_practice: "diaphragm-breathing",
      },
      {
        name: "Progressive muscle relaxation",
        cadence: "Evening",
        somatic_practice: "progressive-muscle-relaxation",
        startWeek: 3,
      },
      {
        name: "Low-tone humming",
        cadence: "As needed",
        somatic_practice: "low-tone-humming",
        startWeek: 5,
      },
    ],
    commonlyUsed: ["Omega-3 (fish oil)", "Curcumin", "Ginger extract", "Vitamin D", "Magnesium"],
    faq: [
      {
        q: "No jaggery or honey even? I thought those were the healthy sugars.",
        a: "Only for the first two weeks — the point is a clean baseline. The Reinforce phase brings the unrefined ones back in small amounts, and you'll know what they do because you'll feel the difference.",
      },
      {
        q: "I'm vegetarian — what replaces the fish?",
        a: "Walnuts, flax and chia daily, and consider the omega-3 entry in the reference panel with your doctor. The vegetables, spices and fermented foods carry most of the programme regardless.",
      },
      {
        q: "How fast will I feel a difference?",
        a: "Joint and skin changes usually show in the Add weeks — weeks three to six. Energy often shifts earlier. The daily note is how you'll catch it.",
      },
    ],
    screening: [
      ...COMMON_SCREENING,
      { q: "Are you being treated for an autoimmune condition?", hard: true },
    ],
  },
];

export function getGuidedProtocol(slug: string): GuidedProtocol | null {
  return GUIDED_PROTOCOLS.find((p) => p.slug === slug) ?? null;
}

/** The HEADLINE phase for a 1-indexed week. 5R's phases genuinely overlap
 *  (Replace starts inside Remove), so the rule is: among phases active this
 *  week, the newest-begun wins — "what's new this week" — and a tie on
 *  startWeek keeps the earlier phase (week 1 reads "Remove", not "Replace").
 *  Past the end → last phase ("+ ongoing" semantics). */
export function phaseForWeek(p: GuidedProtocol, week: number): { phase: GuidedPhase; idx: number } {
  let found = 0;
  let bestStart = -1;
  for (let i = 0; i < p.phases.length; i++) {
    const ph = p.phases[i];
    if (week >= ph.startWeek && week <= ph.endWeek && ph.startWeek > bestStart) {
      found = i;
      bestStart = ph.startWeek;
    }
  }
  if (week > p.weeks) found = p.phases.length - 1;
  return { phase: p.phases[found], idx: found };
}

/** Names of OTHER phases still running in the given week (5R's overlaps) —
 *  the headline card lists them so mid-flight phases stay visible. */
export function alsoActivePhases(p: GuidedProtocol, week: number, headlineIdx: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < p.phases.length; i++) {
    if (i === headlineIdx) continue;
    const ph = p.phases[i];
    if (week >= ph.startWeek && week <= ph.endWeek) out.push(ph.name);
  }
  return out;
}
