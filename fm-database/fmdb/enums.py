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
    ml = "ml"
    drops = "drops"
    capsules = "capsules"
    tablets = "tablets"
    scoops = "scoops"
    teaspoons = "teaspoons"


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


class TakeWithFood(str, Enum):
    required = "required"
    optional = "optional"
    avoid = "avoid"
