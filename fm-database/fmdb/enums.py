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
    hormonal = "hormonal"                # hot flashes, irregular cycles
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
    other = "other"


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
