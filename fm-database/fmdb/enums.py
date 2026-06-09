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
