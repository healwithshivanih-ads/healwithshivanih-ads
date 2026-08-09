from enum import Enum


class Timing(str, Enum):
    on_waking = "on_waking"
    on_empty_stomach = "on_empty_stomach"
    morning = "morning"
    mid_morning = "mid_morning"
    with_breakfast = "with_breakfast"
    with_lunch = "with_lunch"
    mid_afternoon = "mid_afternoon"
    with_dinner = "with_dinner"
    evening = "evening"
    bedtime = "bedtime"


class DoseUnit(str, Enum):
    mg = "mg"
    mcg = "mcg"
    g = "g"
    iu = "IU"  # International Units — vitamin D, vitamin E, vitamin A (often)
    ml = "ml"
    drops = "drops"
    capsules = "capsules"
    tablets = "tablets"
    scoops = "scoops"
    teaspoons = "teaspoons"
    tablespoons = "tablespoons"
    billion_cfu = "billion_CFU"  # probiotics


class EvidenceTier(str, Enum):
    strong = "strong"
    plausible_emerging = "plausible_emerging"
    fm_specific_thin = "fm_specific_thin"
    confirm_with_clinician = "confirm_with_clinician"


class EntityStatus(str, Enum):
    active = "active"
    deprecated = "deprecated"
    retired = "retired"


class SupplementForm(str, Enum):
    capsule = "capsule"
    powder = "powder"
    tablet = "tablet"
    liquid = "liquid"
    gummy = "gummy"
    lozenge = "lozenge"
    whole_food = "whole_food"  # seeds, husks, ferments — foods used as supplements


class SupplementCategory(str, Enum):
    mineral = "mineral"
    vitamin = "vitamin"
    herb = "herb"
    amino_acid = "amino_acid"
    probiotic = "probiotic"
    fatty_acid = "fatty_acid"
    enzyme = "enzyme"
    other = "other"


class InteractionType(str, Enum):
    avoid_together = "avoid_together"
    space_by_hours = "space_by_hours"
    take_together = "take_together"


class SymptomCategory(str, Enum):
    gi = "gi"                            # bloating, gas, constipation
    musculoskeletal = "musculoskeletal"  # joint pain, stiffness
    neurological = "neurological"        # brain fog, headache, dizziness
    mood = "mood"                        # anxiety, irritability, low mood
    sleep = "sleep"                      # insomnia, 3am wakeups
    skin = "skin"                        # rashes, acne, dryness
    hormonal = "hormonal"                # hot flashes, irregular cycles (gender-neutral)
    womens_health = "womens_health"      # menopause, perimenopause, vaginal symptoms, female-specific
    mens_health = "mens_health"          # prostate, erectile, andropause, male-specific
    metabolic = "metabolic"              # weight changes, sugar cravings
    constitutional = "constitutional"    # fatigue, malaise
    cardiovascular = "cardiovascular"    # palpitations
    urinary = "urinary"                  # incontinence, frequency
    other = "other"


class SymptomSeverity(str, Enum):
    common = "common"            # typical, coach-actionable
    concerning = "concerning"    # warrants attention; may need clinician input
    red_flag = "red_flag"        # refer out — possible serious pathology


class CookingAdjustmentCategory(str, Enum):
    cookware = "cookware"        # cast iron, stainless, ceramic
    oil = "oil"                  # ghee, olive oil, coconut oil swaps
    water = "water"              # filtration, mineral additions
    food_prep = "food_prep"      # soaking, sprouting, fermenting
    storage = "storage"          # glass vs plastic
    kitchen_tool = "kitchen_tool"  # mortar/pestle, spice grinder
    other = "other"


class TissueSaltCategory(str, Enum):
    """Schüssler / biochemic tissue-salt (cell-salt) classification.

    core_cell_salt      = the canonical 12 (No. 1 Calc fluor … No. 12 Calc sulph).
    supplementary_salt  = the extended set (No. 13+ — Kali ars, Kali iod, etc.).
    bio_combination     = India's pre-mixed numbered BC 1–28 combination tablets
                          (SBL / Reckeweg / Schwabe / Bakson) — how clients
                          actually buy them off the shelf.
    """
    core_cell_salt = "core_cell_salt"
    supplementary_salt = "supplementary_salt"
    bio_combination = "bio_combination"
    other = "other"


class PlanStatus(str, Enum):
    draft = "draft"                            # actively being authored
    ready_to_publish = "ready_to_publish"      # sanity-checked + warnings ack'd
    published = "published"                    # IRREVERSIBLE; client received it
    superseded = "superseded"                  # newer plan replaced this one
    revoked = "revoked"                        # withdrawn (don't act on this)
    graduated = "graduated"                    # client completed protocol → Alumni;
                                               # plan is closed but successfully (vs
                                               # revoked which is a withdrawal). Used
                                               # to clear active-triage noise while
                                               # preserving the historical record.


class ReferralUrgency(str, Enum):
    routine = "routine"
    soon = "soon"          # within ~weeks
    urgent = "urgent"      # within ~days
    emergency = "emergency"


class HomeRemedyCategory(str, Enum):
    ayurvedic_churan = "ayurvedic_churan"   # triphala, hingvastak
    infused_water = "infused_water"          # cumin, fennel, ajwain
    herbal_tea = "herbal_tea"                # chamomile, ginger, tulsi
    kashayam = "kashayam"                    # decoctions
    kitchen_remedy = "kitchen_remedy"        # ginger-lemon-honey, golden milk
    spice_blend = "spice_blend"              # gunpowder masala, gut-healing blends
    vegetable_juice = "vegetable_juice"      # ABC juice, lauki juice, amla juice
    other = "other"


class RemedyRoute(str, Enum):
    """How a home remedy is USED — orthogonal to `category` (which is the
    preparation type). `internal` = eaten / drunk / swallowed (teas, churans,
    infused waters, juices, kitchen remedies). `external` = applied to the body
    (oil massage / abhyanga, nasya nasal drops, oil pulling, eyewash, ear oil,
    steam, foot soaks, compresses, pastes, hair oils, gargles).

    Lets the system separate "things you eat/drink" from "things you do to the
    body": the dosha FOOD rules + meal logic only consider internal remedies,
    dinacharya is mostly external, and the letter frames each correctly
    (drink vs apply). Defaults to `internal` (the majority — teas/waters/churans).
    """
    internal = "internal"
    external = "external"


class SuitableSex(str, Enum):
    """Who a remedy is anatomically/physiologically FOR. `any` (default) =
    unisex. `female`/`male` = the remedy's purpose is sex-specific (menstrual
    cramps tea, prostate tea). A remedy that merely LISTS a female stage as
    one indication among general ones (golden milk -> "perimenopause") stays
    `any` — this field is the hard gate, not a relevance hint."""
    any = "any"
    female = "female"
    male = "male"


class LifeStage(str, Enum):
    """Life-stage vocabulary shared by HomeRemedy.suitable_stages (non-empty
    = remedy is ONLY for these stages) and HomeRemedy.avoid_in (hard safety
    exclusions). Client-side stage derives from Client.pregnancy_status /
    lactation_started / cycle_status, with an age fallback."""
    menstruating = "menstruating"
    perimenopausal = "perimenopausal"
    postmenopausal = "postmenopausal"
    pregnancy = "pregnancy"
    lactation = "lactation"
    children = "children"          # avoid_in only — the app serves adults


class CyclePhase(str, Enum):
    """Menstrual-cycle phase vocabulary — the values MUST stay byte-identical
    to the strings Client.cycle_context() emits (fmdb/plan/models.py), because
    phase matching is plain string comparison: a tag keyed to vocabulary the
    resolver does not emit is an absent tag (the ExerciseCaution alias lesson).

    Distinct from LifeStage (whether someone cycles at all), from
    PracticeItem.phase (plan-staging unlock layer, an int), and from
    ProtocolPhase (multi-week protocol sequencing). Postmenopause is
    deliberately NOT a value here — a postmenopausal client gets circadian-
    stable care (claim postmenopause-shift-to-circadian-self-care), never
    phase-tagged content, so a postmenopausal tag could only be misused.

    Content tags (Exercise / Supplement / recipe YAML) use these values.
    Evidence spine: mechanisms infradian-rhythm, luteal-metabolic-shift,
    luteal-progesterone-insulin-resistance, follicular-estrogen-insulin-
    sensitivity — mostly fm_specific_thin / plausible_emerging, so tags drive
    EMPHASIS (rank/warn), not hard exclusion."""
    menstrual = "menstrual"          # day 1-5 — bleed; iron, warmth, gentle movement
    follicular = "follicular"        # post-bleed to ~45% — lighter meals, HIIT fine
    ovulatory = "ovulatory"          # ~45-55% — estrogen peak; cruciferous, liver support
    early_luteal = "early_luteal"    # ~55-78% — progesterone present; slow carbs return
    late_luteal = "late_luteal"      # ~78%+ — blood-sugar stability paramount, no fasting


class Dosha(str, Enum):
    """The three Ayurvedic doshas (elemental constitutions).

    Used as a controlled vocabulary on HomeRemedy.balances_dosha /
    .aggravates_dosha so the plan checker can deterministically flag a
    heating-remedy-for-a-pitta-client mismatch (rather than the AI having to
    re-read every remedy's prose). The combined constitution label
    (e.g. "Pitta-Vata") lives as a free string on the Client; this enum is
    only for the structured per-dosha tags + the suggester's score keys.
    """
    vata = "vata"      # air + ether — dry, cold, light, mobile
    pitta = "pitta"    # fire + water — hot, sharp, oily, intense
    kapha = "kapha"    # earth + water — heavy, cold, slow, stable


class Rasa(str, Enum):
    """The six tastes (shad rasa) of Ayurvedic dravyaguna. A substance may have
    one or more. Taste predicts dosha action: sweet/sour/salty build kapha &
    pacify vata; pungent/bitter/astringent increase vata & reduce kapha;
    sour/salty/pungent increase pitta while sweet/bitter/astringent pacify it.
    Used on Supplement.rasa alongside virya/vipaka so the suggester can match a
    herb's energetics to the client's dosha. Sanskrit names in comments."""
    sweet = "sweet"            # madhura
    sour = "sour"             # amla
    salty = "salty"           # lavana
    pungent = "pungent"       # katu
    bitter = "bitter"         # tikta
    astringent = "astringent" # kashaya


class Virya(str, Enum):
    """Heating/cooling potency (virya) — a substance's primary thermal action,
    the single most decisive energetic for dosha matching. Heating (ushna)
    aggravates pitta and pacifies vata/kapha; cooling (shita) the reverse."""
    heating = "heating"   # ushna
    cooling = "cooling"   # shita


class Vipaka(str, Enum):
    """Post-digestive effect (vipaka) — the long-term action after digestion.
    Only three: sweet (anabolic, builds tissue, +kapha), sour (+pitta),
    pungent (catabolic, reducing, +vata)."""
    sweet = "sweet"       # madhura
    sour = "sour"         # amla
    pungent = "pungent"   # katu


class ProtocolCategory(str, Enum):
    """High-level FM protocol categories. A coach picks a Protocol for a
    client when their pattern matches the indications — protocols give a
    structured 4–12 week path versus ad-hoc supplement + lifestyle picks.
    """
    gut_healing = "gut_healing"                  # 5R, GAPS, candida cleanse
    elimination_diet = "elimination_diet"        # AIP, Whole30, low-FODMAP
    hormone_balance = "hormone_balance"          # cycle sync, perimenopause support
    metabolic_reset = "metabolic_reset"          # weight loss, insulin sensitization
    adrenal_recovery = "adrenal_recovery"        # HPA-axis support
    detox_liver_support = "detox_liver_support"  # phase I/II liver support
    anti_inflammatory = "anti_inflammatory"      # systemic inflammation reset
    mitochondrial_support = "mitochondrial_support"
    thyroid_optimization = "thyroid_optimization"
    blood_sugar_regulation = "blood_sugar_regulation"
    other = "other"


class DrugClass(str, Enum):
    """High-level drug classes used to group medication-nutrient depletion
    entries. Helps a coach see "all PPIs deplete B12 + magnesium" without
    needing to list every brand name.
    """
    thyroid_hormone = "thyroid_hormone"           # levothyroxine, liothyronine
    metformin = "metformin"
    ppi = "ppi"                                   # omeprazole, pantoprazole, esomeprazole
    h2_blocker = "h2_blocker"                     # ranitidine, famotidine
    statin = "statin"                             # atorvastatin, rosuvastatin, simvastatin
    oral_contraceptive = "oral_contraceptive"     # combined OCP, progestin-only
    hrt = "hrt"                                   # estradiol, conjugated estrogens
    beta_blocker = "beta_blocker"                 # metoprolol, propranolol, atenolol
    ace_inhibitor = "ace_inhibitor"               # enalapril, lisinopril, ramipril
    arb = "arb"                                   # losartan, telmisartan
    calcium_channel_blocker = "calcium_channel_blocker"  # amlodipine, nifedipine, diltiazem, verapamil
    thiazide_diuretic = "thiazide_diuretic"       # HCTZ, indapamide
    loop_diuretic = "loop_diuretic"               # furosemide, torsemide
    ssri = "ssri"                                 # fluoxetine, sertraline, escitalopram
    snri = "snri"                                 # venlafaxine, duloxetine
    benzodiazepine = "benzodiazepine"             # alprazolam, lorazepam, clonazepam
    nsaid = "nsaid"                               # ibuprofen, diclofenac, naproxen
    aspirin = "aspirin"
    corticosteroid = "corticosteroid"             # prednisone, hydrocortisone
    antibiotic = "antibiotic"
    methotrexate = "methotrexate"
    insulin = "insulin"
    sulfonylurea = "sulfonylurea"                 # glimepiride, gliclazide
    levodopa = "levodopa"
    phenytoin = "phenytoin"
    valproate = "valproate"
    antipsychotic = "antipsychotic"
    # ── MCAS / histamine-intolerance pharmacology ──
    mast_cell_stabiliser = "mast_cell_stabiliser"     # cromolyn sodium, ketotifen (also H1)
    leukotriene_receptor_antagonist = "leukotriene_receptor_antagonist"  # montelukast, zafirlukast
    anti_ige_biologic = "anti_ige_biologic"           # omalizumab (Xolair)
    h1_antihistamine = "h1_antihistamine"             # cetirizine, fexofenadine, loratadine, ketotifen
    # ── Oncology ──
    tyrosine_kinase_inhibitor = "tyrosine_kinase_inhibitor"  # imatinib, sunitinib, sorafenib, etc.
    glp1_agonist = "glp1_agonist"                     # semaglutide, tirzepatide, liraglutide
    sglt2_inhibitor = "sglt2_inhibitor"               # empagliflozin, dapagliflozin
    dpp4_inhibitor = "dpp4_inhibitor"                 # sitagliptin (Januvia / Janumet), linagliptin
    other = "other"


class CautionKind(str, Enum):
    """Kind of protocol caution declared by a medication entry.

    Used in DrugDepletion.protocol_cautions[].kind so coach + plan-check +
    meal-plan generator all interpret the constraint the same way.
    """
    avoid_food = "avoid_food"
    avoid_supplement = "avoid_supplement"
    avoid_practice = "avoid_practice"          # e.g. "no aggressive sauna / detox protocols"
    prefer_food = "prefer_food"
    prefer_supplement = "prefer_supplement"
    timing = "timing"                          # e.g. "take 4h apart from calcium"
    refer = "refer"                            # e.g. "coordinate with oncologist before any supplement change"
    monitor = "monitor"                        # e.g. "screen for neuropsych side effects monthly"


class CautionSeverity(str, Enum):
    critical = "critical"        # blocks the plan — coach must address
    warning = "warning"          # surfaces in plan-check, doesn't block
    info = "info"                # informational only


class ImplicationConfidence(str, Enum):
    """How confidently presence of this drug implies the named diagnosis."""
    high = "high"              # near-pathognomonic — e.g. cromolyn → MCAS
    moderate = "moderate"      # common but not exclusive — e.g. metformin → T2D (also PCOS, prediabetes)
    low = "low"                # one of many indications — e.g. SSRI → depression OR anxiety OR many others


class DepletionSeverity(str, Enum):
    """How significantly a drug depletes / interferes with a nutrient."""
    mild = "mild"            # subclinical; routine monitoring usually enough
    moderate = "moderate"    # clinically meaningful; consider supplementation
    severe = "severe"        # well-documented depletion; supplement is standard of care


class LabPanelCategory(str, Enum):
    """High-level categories for grouping pre-curated FM lab panels."""
    general_wellness = "general_wellness"  # baseline FM workup for new clients
    thyroid = "thyroid"                    # Hashimoto / hypothyroid workup
    metabolic = "metabolic"                # insulin resistance / prediabetes / PCOS
    hormone = "hormone"                    # perimenopause / sex hormones
    adrenal = "adrenal"                    # HPA / cortisol pattern
    cardiovascular = "cardiovascular"      # ApoB, particle size, inflammation
    gut = "gut"                            # GI workup
    autoimmune = "autoimmune"
    nutrient = "nutrient"                  # micronutrient panel
    inflammation = "inflammation"
    fatigue = "fatigue"                    # mitochondrial / chronic fatigue
    other = "other"


class SafetyStatus(str, Enum):
    """Safety classification for use during pregnancy / lactation / specific
    clinical contexts. Used on Supplement entity for auto-flagging.
    """
    safe = "safe"                          # well-studied, no concern
    likely_safe = "likely_safe"            # food-form / traditional use, limited modern data
    caution = "caution"                    # use only with clinician oversight + dose limits
    contraindicated = "contraindicated"    # do NOT use
    unknown = "unknown"                    # insufficient data — coach assumes caution


class PregnancyStatus(str, Enum):
    """Client pregnancy / fertility status — drives supplement safety overlay."""
    not_applicable = "not_applicable"      # male client / postmenopausal / sex omitted
    not_pregnant = "not_pregnant"
    trying_to_conceive = "trying_to_conceive"
    pregnant_first_trimester = "pregnant_first_trimester"
    pregnant_second_trimester = "pregnant_second_trimester"
    pregnant_third_trimester = "pregnant_third_trimester"
    lactating = "lactating"
    postpartum_not_lactating = "postpartum_not_lactating"


class MechanismCategory(str, Enum):
    endocrine = "endocrine"          # HPA axis, sex hormones, thyroid signaling
    neurological = "neurological"    # vagal tone, neurotransmitter receptors
    immune = "immune"                # Th1/Th2, cytokines, autoimmunity
    metabolic = "metabolic"          # insulin resistance, mitochondria, lipids
    gut = "gut"                      # leaky gut, dysbiosis, SCFA, motility
    structural = "structural"        # bone density, tight junctions, ECM
    signaling = "signaling"          # receptor heterodimers, gene regulation
    other = "other"


class TakeWithFood(str, Enum):
    required = "required"
    optional = "optional"
    avoid = "avoid"


class SourceType(str, Enum):
    internal_skill = "internal_skill"
    peer_reviewed_paper = "peer_reviewed_paper"
    textbook = "textbook"
    clinical_guideline = "clinical_guideline"
    expert_consensus = "expert_consensus"
    book = "book"
    website = "website"
    llm_synthesis = "llm_synthesis"  # ChatGPT/Claude/etc. output — treat skeptically; verify before trusting
    other = "other"


class SourceQuality(str, Enum):
    high = "high"
    moderate = "moderate"
    low = "low"


class SomaticCategory(str, Enum):
    """What kind of thing a somatic practice actually is.

    Deliberately describes the MODALITY, not the motion shape — the motion
    shapes are derived empirically from the step data (see SomaticPractice
    .motion_shape), not assumed up front.
    """
    breath = "breath"                # paced / diaphragmatic / extended-exhale work
    discharge = "discharge"          # completing an interrupted defensive response
    touch = "touch"                  # self-contact, pressure, massage
    movement = "movement"            # deliberate ranged movement
    imagery = "imagery"              # visualisation, safe-place, internal attention
    orientation = "orientation"      # looking around, grounding to the room
    behavioural = "behavioural"      # a protocol applied to an activity (e.g. eating)
    other = "other"


class SomaticBodyRegion(str, Enum):
    head_face = "head_face"
    jaw = "jaw"
    throat_neck = "throat_neck"
    shoulders_upper_back = "shoulders_upper_back"
    arms_hands = "arms_hands"
    chest_diaphragm = "chest_diaphragm"
    abdomen = "abdomen"
    pelvis = "pelvis"
    lower_back_hips = "lower_back_hips"
    legs_feet = "legs_feet"
    whole_body = "whole_body"


class SomaticPosition(str, Enum):
    seated = "seated"
    standing = "standing"
    lying = "lying"
    any_position = "any_position"


class SomaticSensitivity(str, Enum):
    """How safely an emotional-root reading can be surfaced to a client.

    general    — safe to show in the app to any client on `full` depth.
    sensitive  — coach judgement needed; the framing can land as blame.
    coach_only — never auto-surface; session material only.
    """
    general = "general"
    sensitive = "sensitive"
    coach_only = "coach_only"


class SomaticTargetKind(str, Enum):
    """What catalogue entity a SomaticMap hangs off.

    The book's 123 chapters land across BOTH symptoms and topics in this
    catalogue (acid reflux is a symptom; uterine fibroids is a topic), so the
    map points at either rather than living on one entity.
    """
    symptom = "symptom"
    topic = "topic"


class MotionShape(str, Enum):
    """Which player renders a somatic practice in the client app.

    NOT guessed at extraction time. Derived by clustering the whole practice
    corpus on objective step data (action verbs, holds, bilaterality, whether
    it is a timed session at all) — a four-shape guess from a 13-entry sample
    was already wrong at 87 entries and wrong again at 123. Seven is the count
    the full library actually needs.

    `bilateral` and repeated rounds are MODIFIERS layered on any shape, not
    shapes of their own.
    """
    breath_excursion = "breath_excursion"      # expand / hold / shrink — the existing BreathOverlay
    continuous_travel = "continuous_travel"    # a point tracing a path: circling, rocking, tracking
    release = "release"                        # decay only, no effort phase
    sustained_pressure = "sustained_pressure"  # load held, no release phase
    load_release = "load_release"              # effort builds, then lets go
    still = "still"                            # imagery and grounding; nothing moves
    checklist = "checklist"                    # a protocol applied to an activity — no player


# ─────────────────────────── Exercise (capacity) ────────────────────────────
# Exercise is CAPACITY work — strength, stamina, balance, bone. That is the
# line against SomaticPractice, which is REGULATION work. Some movements sit in
# both libraries under different intent (cat-cow as a mobility exercise and as a
# breath-paced regulation practice); that is deliberate, not a duplicate.


class ExerciseModality(str, Enum):
    """The six modalities of the FM exercise prescription matrix, plus pacing.

    The first six are NOT invented here — they are the columns of the
    `fm-exercise-prescription-matrix` source already in the catalogue, which
    also carries the dosing claims (48h recovery between muscle groups, the
    talk test, 150 min/week moderate, one-leg-20s as the intermediate balance
    benchmark). Snapping to them means those claims cover this entity instead
    of being restated.

    `pacing` is the seventh and is NOT a low setting of `cardiovascular`. For a
    client with post-exertional malaise, progression is the harm — see
    `nice-ng206-me-cfs-2021`. Modelling it as an intensity would let a matcher
    "progress" someone off it.
    """
    strength = "strength"
    flexibility = "flexibility"
    balance = "balance"
    cardiovascular = "cardiovascular"
    mind_body = "mind_body"                    # yoga, tai chi, qigong
    daily_activity = "daily_activity"          # ADLs: housework, gardening, carrying, stairs
    pacing = "pacing"                          # energy-envelope protocols; deliberately not a tier


class ExerciseIntensityTier(str, Enum):
    """Matches the prescription matrix's three tiers.

    Per that source's own rule, intensity is matched PER MODALITY — someone can
    be advanced at cardiovascular and beginner at balance. This tier describes
    the exercise, not the person.
    """
    beginner = "beginner"
    intermediate = "intermediate"
    advanced = "advanced"


class ExerciseImpact(str, Enum):
    """Ground-reaction impact — a benefit and a cost at the same time.

    Impact is what builds bone (see `liftmor-watson-2018`), and it is also what
    hurts arthritic knees and provokes stress incontinence. It is recorded as a
    plain property so a matcher can weigh it per client rather than assuming
    either direction.
    """
    none = "none"
    low = "low"                                # heel raises, walking
    moderate = "moderate"                      # stamping, step-downs
    high = "high"                              # hopping, jumping


class MovementPattern(str, Enum):
    """The biomechanical shape of the movement — what a balanced session covers.

    An exercise may express several (a burpee is squat + push + jump). This is
    the axis SESSION BALANCE reasons over: three pushes and no hinge is a fact
    the summaries cannot show but the patterns can. Deliberately biomechanical,
    not goal-flavoured — "conditioning" is an intensity property, not a shape.
    """
    push = "push"                              # press-ups, dips
    pull = "pull"                              # rows
    squat = "squat"                            # sit-to-stand, squats
    hinge = "hinge"                            # hip hinge, bridges, deadlift shapes
    lunge = "lunge"                            # split stance, step patterns
    core_brace = "core_brace"                  # planks, bird dog — resist movement
    core_flex = "core_flex"                    # crunch family — produce movement
    rotation = "rotation"                      # trunk turns
    balance = "balance"                        # single-leg, tandem work
    gait = "gait"                              # walking patterns
    jump = "jump"                              # plyometric expression, any impact
    mobility = "mobility"                      # range work, stretches


class MuscleGroup(str, Enum):
    """What gets STRONGER — distinct from `joint_stress`, which is what might
    hurt. Coarse on purpose: the book-level 'Targets' lists resolve here."""
    chest = "chest"
    shoulders = "shoulders"
    triceps = "triceps"
    biceps = "biceps"
    upper_back = "upper_back"
    lower_back = "lower_back"
    abdominals = "abdominals"
    obliques = "obliques"
    glutes = "glutes"
    quadriceps = "quadriceps"
    hamstrings = "hamstrings"
    hip_abductors = "hip_abductors"
    calves = "calves"
    ankles_feet = "ankles_feet"
    neck = "neck"
    full_body = "full_body"


class ExercisePosition(str, Enum):
    """Base position. Support (holding a chair vs nothing) is a LEVEL property,
    not a position — the same exercise moves through supported and unsupported
    forms as it progresses."""
    seated = "seated"
    standing = "standing"
    lying_supine = "lying_supine"
    lying_prone = "lying_prone"
    side_lying = "side_lying"
    four_point = "four_point"                  # hands and knees
    walking = "walking"
    any_position = "any_position"


class ExerciseBodyRegion(str, Enum):
    """Side-AGNOSTIC body regions, for joint-stress matching.

    Deliberately not `SomaticBodyRegion`, which lumps hip, knee and ankle into
    `legs_feet` — useless for deciding whether a squat is safe for someone who
    ticked both knees. Deliberately side-agnostic too: an exercise stresses "the
    knee", and the client record is what knows which knee hurts. The screen maps
    `knee_left`/`knee_right` from the intake body map onto `knee` here.
    """
    neck = "neck"
    shoulder = "shoulder"
    elbow = "elbow"
    wrist_hand = "wrist_hand"
    upper_back = "upper_back"
    mid_back = "mid_back"
    lower_back = "lower_back"
    sacrum_pelvis = "sacrum_pelvis"
    hip = "hip"
    thigh = "thigh"
    knee = "knee"
    calf = "calf"
    ankle_foot = "ankle_foot"
    chest = "chest"
    abdomen = "abdomen"
    whole_body = "whole_body"


class ExerciseCautionSeverity(str, Enum):
    """Two tiers, and the distinction is the whole safety model.

    `_food_cautions.yaml` deliberately has no hard block — it only down-ranks,
    because ragi is genuinely good for the same client it is cautioned for.
    Exercise does not work that way. Loaded spinal flexion for someone with
    vertebral osteoporosis is a fracture risk, not a trade-off, so this entity
    needs a real block tier that a scorer cannot outvote.

    block   — never surface for a client the condition applies to. Coach may
              override deliberately; nothing automatic may.
    caution — surface WITH the modification. A caution without a modification is
              just "be careful", which is why the validator errors on one.
    """
    block = "block"
    caution = "caution"


class EngagementStatus(str, Enum):
    """Where someone is in the commercial relationship.

    Declared (rather than left as a bare string) because every renewal and
    roster rule keys on it, and an undeclared field is one ``load -> write``
    round-trip away from vanishing — which has already happened once to a real
    record. See docs/CLIENT_VS_PROSPECT_SPEC.md section 3.2.

    ``lapsed`` is a VALUE here, deliberately not a third directory: a lapsed
    client stays in ``clients/`` and keeps their app token. Lapsing changes
    what the app renders, never what the client is allowed to see of their own
    data — the Lab Vault never locks.
    """

    pending = "pending"          # talked to, not enrolled
    signed_up = "signed_up"      # enrolled — the only value that means "client"
    declined = "declined"        # said no
    lapsed = "lapsed"            # was enrolled; plan ended and was not renewed
