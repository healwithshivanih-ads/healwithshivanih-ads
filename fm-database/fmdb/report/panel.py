"""What the body age report reads: its sections, and the rows in each, built from a person's lab results.

The standard report has six sections. The deeper report adds the free thyroid hormones, a "Vitamins and iron"
section and a "Metals and trace elements" section. Row names and the short plain-language gloss under each are the
approved ones.

EXTRA rows (added 20 Nov 2026, Shivani's "we are asking them to do these tests so we should explain the report to
them"): every other result the laboratory prints for the two packages. None enters the body age score or the
drawings (D1). Three kinds:
  noflag  the laboratory's own ratios and indices: shown and explained, never a level (D2)
  note    one type of white cell, or a finer red cell or platelet measure: never a level; outside its range it
          prints one fixed paragraph and the section's status does not move (F9, F10)
  quiet   total IgE and every urine result: a level and its own paragraph, the section goes no further than
          "watch", and it never brings the session offer by itself (D4, D6)
Rows with `table` set are printed in one compact table under that heading, not as a bar each (D8).
The deeper report also gains "Allergy and autoimmune markers" and "Pancreas", and both reports gain "Urine".
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Optional

from fmdb.assess.lab_ratios import _parse_ref_range, _peek

from .levels import _scan, level_and_side, load_cutoffs, plus_unit_ok, rank


@dataclass
class Spec:
    key: str
    name: str
    gloss: str = ""
    raw: str = ""                 # regex on the laboratory's test name
    comp: str = ""                # regex on a score the lab engine calculates
    kind: str = "lab"             # lab = the laboratory's own range · z3 = three fixed tiers · min = one fixed floor (a)
    a: Optional[float] = None
    b: Optional[float] = None
    rtxt: str = ""
    b_incl: bool = False          # z3: "b and over" is high (otherwise "over b")
    under: bool = False           # print a 0-to-x laboratory range as "under x"
    unit: Optional[str] = None    # printed unit when it should differ from the laboratory's
    decimals: Optional[int] = None
    nature: str = "deep"          # work = everyday changes move it · deep = cause not visible in blood · inherited
    group: str = ""               # results that are one finding count once (the cholesterol family)
    beyond: bool = False          # not part of a routine check-up
    deeper: bool = False          # deeper report only
    scale: Optional[str] = None   # wbc | platelets: bring the laboratory's unit to the printed one
    extra: bool = False           # an explained extra: not in the body age score or the drawings
    noflag: bool = False          # shown and explained, never a level
    note: str = ""                # wbc_type | index: never a level; a fixed paragraph when outside its range
    quiet: bool = False           # a level and a paragraph; the section goes no further than "watch"
    worked: bool = False          # the laboratory's own ratio or index: looked up among the worked-out lines too
    table: str = ""               # printed in the compact table with this heading
    needed: bool = True           # False: an element with no use in the body, whose LOW result is not marked


@dataclass
class Row:
    key: str
    name: str
    gloss: str
    value: float
    unit: str
    kind: str                     # range | max | min | z3 | none
    a: Optional[float]
    b: Optional[float]
    rtxt: str
    calc: bool
    state: str                    # ok | mid | out  (how the bar is drawn)
    level: str                    # "" | A | B | C | D
    nature: str
    group: str
    beyond: bool
    lo: Optional[float] = None    # the laboratory's printed range
    hi: Optional[float] = None
    b_incl: bool = False
    illustrative: bool = False
    warn: str = ""
    side: str = ""               # high | low: which way a flagged result is off
    extra: bool = False
    quiet: bool = False
    note: str = ""               # wbc_type | index, set only when the row is outside its range
    table: str = ""
    vtext: str = ""              # a result that is a word, as the laboratory printed it (urine)
    ref: str = ""                # the laboratory's printed range, as printed (compact tables)


@dataclass
class Section:
    id: str
    name: str
    rows: list[Row] = field(default_factory=list)
    status: str = "steady"        # steady | watch | needs attention | needs a deeper look
    key: str = "steady"           # steady | watch | att  (colour)


S = Spec
_SHARE = r"^(?!.*absolute)(?!.*count)(?!.*ratio)(?!.*immature)(?!.*urin).*"      # a white cell as a share of the total
_COUNT = r"^(?!.*ratio)(?!.*immature)(?!.*urin)(?=.*(?:absolute|count)).*"       # ... as a number
LIPIDS = dict(nature="work", group="lipids")
SECTIONS: list[tuple[str, str, bool, list[Spec]]] = [
    ("heart", "Heart and arteries", False, [
        S("apob", "ApoB", "the number of cholesterol-carrying particles", raw=r"\bapo[ -]?b\b|apolipoproteins?[\s\-:/]*b\b|apob\b",
          kind="z3", a=100, b=155, rtxt="usual aim under 100 · lab range up to 155", beyond=True, **LIPIDS),
        S("ldl", "LDL cholesterol", "the cholesterol inside those particles",
          raw=r"^(?!.*ratio)(?!.*[:/])(?!.*\bhdl\b)(?!.*\bvldl\b).*(?:\bldl\b|low.density.lipoprotein)",
          kind="z3", a=100, b=160, b_incl=True, rtxt="under 100 ideal · 160 and over high", **LIPIDS),
        S("non_hdl", "Non-HDL cholesterol", "all the cholesterol that can enter an artery wall", raw=r"non.?hdl", under=True, **LIPIDS),
        S("tc", "Total cholesterol", "everything added together",
          raw=r"total cholesterol|cholesterol.total|cholesterol[\s:/,\-]+total|\btotal.chol\b",
          kind="z3", a=200, b=240, b_incl=True, rtxt="under 200 desirable · 240 and over high", **LIPIDS),
        S("tg", "Triglycerides", "fat travelling in the blood",
          raw=r"^(?!.*ratio)(?!.*[:/])(?!.*hdl)(?!.*anti)(?!.*thyroglob).*(?:\btriglyceride|\btg\b)",
          kind="z3", a=150, b=200, b_incl=True, rtxt="under 150 normal · 200 and over high", **LIPIDS),
        S("hdl", "HDL cholesterol", "cholesterol being carried away",
          raw=r"^(?!.*ratio)(?!.*[:/])(?!.*non.?hdl).*(?:\bhdl\b|high.density.lipoprotein)", **LIPIDS),
        S("apoa1", "ApoA1", "the protective particles", raw=r"\bapo[ -]?a[ -]?1\b|apolipoproteins?[\s\-:/]*a1\b|apoa1\b",
          beyond=True, **LIPIDS),
        S("apob_apoa1", "ApoB to ApoA1 ratio", "harmful particles against protective ones", comp=r"apob\s*/\s*apoa1",
          kind="z3", a=0.7, b=0.9, rtxt="under 0.7 good · over 0.9 high", beyond=True, **LIPIDS),
        S("remnant", "Remnant cholesterol", "what is left once HDL and LDL are taken out", comp=r"remnant cholesterol",
          kind="z3", a=20, b=30, rtxt="under 20 good · over 30 high", unit="mg/dL", beyond=True, **LIPIDS),
        S("tg_hdl", "Triglyceride to HDL ratio", "a quick read of particle quality", comp=r"tg/hdl ratio",
          kind="z3", a=2.0, b=3.5, rtxt="under 2.0 good · over 3.5 high", beyond=True, **LIPIDS),
        S("vldl", "VLDL cholesterol", "the particle that carries triglycerides", raw=r"\bvldl\b", extra=True, noflag=True),
        S("tc_hdl_lab", "Total cholesterol to HDL", raw=r"^\s*(?:tc|total chol\w*|cholesterol)\b.*\bhdl\b.*ratio", extra=True, noflag=True, worked=True,
          table="chol_ratios"),
        S("ldl_hdl_lab", "LDL to HDL", raw=r"^\s*ldl\b.*\bhdl\b.*ratio", extra=True, noflag=True, worked=True, table="chol_ratios"),
        S("hdl_ldl_lab", "HDL to LDL", raw=r"^\s*hdl\b.*\bldl\b.*ratio", extra=True, noflag=True, worked=True, table="chol_ratios"),
        S("lpa", "Lp(a)", "an inherited particle, measured once", raw=r"\blp\(?a\)?|lipoprotein.{0,5}a\b|lipoprotein.little.a",
          under=True, nature="inherited", beyond=True),
        S("hcy", "Homocysteine", "linked with wear on the artery wall", raw=r"homocysteine|\bhcy\b", decimals=2, beyond=True),
        S("hscrp", "hs-CRP", "background inflammation",
          raw=r"hs.?crp|high.sensitivity.crp|high sensitivity c.reactive|c.?reactive.*sensitiv|sensitiv.*c.?reactive|crp.*sensitiv",
          kind="z3", a=1.0, b=3.0, rtxt="lab under 1.0 low · over 3.0 high", nature="work", group="inflammation", beyond=True),
        S("lppla2", "Lp-PLA2", "an enzyme made where artery walls are inflamed", raw=r"lp\W*pla\W*2|lipoprotein.associated phospholipase",
          under=True, nature="work", deeper=True, extra=True),
    ]),
    ("sugar", "Energy and sugar", False, [
        S("glucose", "Fasting glucose", "sugar in the blood after a night without food",
          raw=r"^(?!.*post)(?!.*prandial)(?!.*\bpp)(?!.*random)(?!.*average)(?!.*estimated)(?!.*urine)(?!.*\b2.?h)(?!.*hour)"
              r".*(?:fasting.*glucose|glucose.*fast|blood glucose|plasma glucose|fasting blood sugar|\bfbs\b)",
          nature="work", group="sugar"),
        S("insulin", "Fasting insulin", "how hard the body works to hold that sugar steady",
          raw=r"^(?!.*post)(?!.*prandial)(?!.*\bpp\b).*(?:insulin.*fast|fast.*insulin|serum insulin)", nature="work", group="sugar", beyond=True),
        S("homa", "HOMA-IR", "glucose and insulin read together", comp=r"^homa-ir",
          kind="z3", a=1.5, b=2.0, rtxt="under 1.5 good · over 2.0 high", nature="work", group="sugar", beyond=True),
        S("hba1c", "HbA1c", "average sugar over about three months", raw=r"hba1c|hemoglobin a1c|glycated haemoglobin|glycosylated haemoglobin|a1c\b",
          kind="z3", a=5.7, b=6.5, b_incl=True, rtxt="lab under 5.7 · 6.5 and over is high", nature="work", group="sugar"),
        S("avg_glucose", "Average blood sugar", "your HbA1c written as an everyday sugar number",
          raw=r"average blood (?:glucose|sugar)|estimated average glucose|mean blood glucose|\beag\b|\babg\b", extra=True, noflag=True),
        S("fructosamine", "Fructosamine", "average sugar over the last two to three weeks", raw=r"fructosamine", under=True,
          nature="work", deeper=True, extra=True),
        S("tyg", "TyG index", "triglycerides and glucose read together", comp=r"^tyg index",
          kind="z3", a=8.3, b=8.8, rtxt="under 8.3 good · over 8.8 high", nature="work", group="sugar", beyond=True),
        S("uric", "Uric acid", "rises with sugar strain and with some foods and drinks", raw=r"uric acid|serum urate|urate\b", nature="work"),
    ]),
    ("liver", "Liver", False, [
        S("alt", "ALT", "the liver's own enzyme", raw=r"\balt\b|sgpt\b|alanine.amino|alanine transaminase", group="liver_enzymes"),
        S("ast", "AST", "an enzyme shared by liver and muscle", raw=r"\bast\b|sgot\b|aspartate.amino|aspartate transaminase", group="liver_enzymes"),
        S("ggt", "GGT", "sensitive to alcohol, medicines and liver fat", raw=r"\bggtp?\b|gamma.glutamyl|gamma-gt", group="liver_enzymes"),
        S("alp", "ALP", "bile flow and bone", raw=r"\balp\b|alkaline phosphatase|alk phos"),
        S("bilirubin", "Bilirubin", "a pigment the liver clears", raw=r"total bilirubin|bilirubin\W*total|t.bili\b"),
        S("bili_direct", "Bilirubin, direct", "the part your liver has already processed",
          raw=r"bilirubin\W*direct|(?<!in)direct bilirubin|(?<!un)conjugated bilirubin|bilirubin\W*conjugated", extra=True),
        S("bili_indirect", "Bilirubin, indirect", "the part still waiting to be processed", raw=r"bilirubin.*(?:indirect|unconjugated)|(?:indirect|unconjugated) bilirubin", extra=True),
        S("albumin", "Albumin", "the main protein the liver makes", raw=r"^(?!.*ratio)(?!.*binding)(?!.*urin)(?!.*micro).*\balbumin\b"),
        S("total_protein", "Total protein", "all the protein in your blood",
          raw=r"^(?!.*urin)(?!.*ratio)(?!.*reactive).*(?:total protein|protein\W*total)", group="proteins", extra=True),
        S("globulin", "Globulin", "the proteins of your immune system",
          raw=r"^(?!.*ratio)(?!.*binding)(?!.*immuno)(?!.*urin).*\bglobulin\b", group="proteins", extra=True),
        S("ag_ratio", "Albumin to globulin ratio", "the two protein families against each other",
          raw=r"alb\w*\W*/\W*glob|\ba\W*/\W*g\b.*ratio|albumin.*globulin.*ratio", extra=True, noflag=True, worked=True),
        S("ast_alt", "AST to ALT ratio", "the two liver enzymes against each other",
          raw=r"sgot\s*/\s*sgpt|\bast\s*/\s*alt\b|de ritis", extra=True, noflag=True, worked=True),
        S("hsi", "Fat-storage score (HSI)", "estimates stored fat from enzymes and body size", comp=r"hepatic steatosis",
          kind="z3", a=30, b=36, rtxt="under 30 unlikely · over 36 likely", nature="work", beyond=True),
        S("fib4", "Scarring score (FIB-4)", "estimates scarring from age, enzymes and platelets", comp=r"^fib-?4",
          kind="z3", a=1.3, b=2.67, rtxt="under 1.3 low · over 2.67 high", beyond=True),
    ]),
    ("thyroid", "Thyroid", False, [
        S("tsh", "TSH", "the signal asking the thyroid to work", raw=r"\btsh\b|thyroid.stimulating.hormone|thyrotropin"),
        S("t4_total", "T4, total", "the main hormone the thyroid makes", raw=r"^(?!.*free).*(?:total t4|t4.{0,3}total|thyroxine\b)", group="thyroid_hormones"),
        S("t3_total", "T3, total", "the active hormone", raw=r"^(?!.*free)(?!.*reverse).*(?:total t3|t3.{0,3}total|tri-?iodothyronine\b)", group="thyroid_hormones"),
        S("ft4", "Free T4", "the hormone your cells can actually use", raw=r"free t4|\bft4\b|t4.free|free thyroxine", group="thyroid_hormones", deeper=True),
        S("ft3", "Free T3", "the active form", raw=r"free t3|\bft3\b|t3.free|free triiodothyronine", group="thyroid_hormones", deeper=True),
    ]),
    ("kidneys", "Kidneys and salts", False, [
        S("creatinine", "Creatinine", "waste from muscle, cleared by the kidneys",
          raw=r"^(?!.*urine)(?!.*ratio)(?!.*albumin)(?!.*clearance)(?!.*gfr)(?!.*filtration).*\bcreatinine\b", group="kidney"),
        # The laboratory's own figure (it prints one with every creatinine). Laboratories print stages beside it, not
        # a range; the report draws it against the one line doctors act on, 60 (cutoffs.yaml, added 20 Nov 2026).
        S("egfr", "Kidney filtering (eGFR)", "worked out from creatinine, age and sex", raw=r"\begfr\b|glomerular filtration",
          kind="min", a=60, rtxt="60 or over", decimals=0, group="kidney"),
        S("urea", "Urea", "waste from protein", raw=r"^(?!.*nitrogen)(?!.*\bbun\b).*\burea\b", group="kidney"),
        S("bun", "Urea nitrogen (BUN)", "the same waste, counted another way", raw=r"\bbun\b|urea nitrogen", group="kidney"),
        S("sodium", "Sodium", raw=r"^(?!.*urine)(?!.*ratio).*\bsodium\b"),
        S("potassium", "Potassium", raw=r"^(?!.*urine)(?!.*ratio).*\bpotassium\b"),
        S("chloride", "Chloride", raw=r"^(?!.*urine).*\bchloride\b"),
        S("calcium", "Calcium", raw=r"^(?!.*urine)(?!.*ratio)(?!.*corrected)(?!.*ionised)(?!.*ionized).*\bcalcium\b"),
        S("magnesium", "Magnesium", "a mineral for muscle, nerve and heart rhythm", raw=r"^(?!.*urine)(?!.*rbc)(?!.*red cell).*\bmagnesium\b",
          deeper=True, extra=True),
        S("bun_creat", "Urea nitrogen to creatinine", raw=r"\bbun\s*/\s*\w*\W*creat|urea nitrogen\W*/\W*\w*\W*creat", extra=True, noflag=True, worked=True,
          table="kidney_ratios"),
        S("urea_creat", "Urea to creatinine", raw=r"^\s*(?:blood )?urea\s*/\s*\w*\W*creat", extra=True, noflag=True, worked=True, table="kidney_ratios"),
    ]),
    ("blood", "Blood count", False, [
        S("hb", "Haemoglobin", "the oxygen carrier",
          raw=r"^(?!.*a1c)(?!.*glyc)(?!.*corpuscular)(?!.*mean cell)(?!.*\bmchc?\b)(?!.*concentration)(?!.*electrophoresis)"
              r"(?!.*urine).*(?:hemoglobin|haemoglobin|\bhgb\b|\bhb\b)", group="anaemia"),
        S("rbc", "Red cell count", raw=r"\brbc\b|red blood cell count|red cell count|erythrocyte count", unit="million/cu.mm", group="red_cells"),
        S("hct", "Haematocrit", "the share of blood that is red cells", raw=r"hematocrit|haematocrit|\bpcv\b|\bhct\b", group="red_cells"),
        S("mcv", "Red cell size (MCV)", raw=r"\bmcv\b|mean corpuscular volume|mean cell volume", group="red_cells"),
        S("mch", "Haemoglobin per cell (MCH)", raw=r"\bmch\b|mean corpuscular h(a)?emoglobin(?!\s*conc)|mean cell h(a)?emoglobin(?!\s*conc)", group="red_cells"),
        S("rdw", "Red cell variation (RDW)", "how even the red cells are", raw=r"rdw[ -]?cv|\brdw\b(?!.*sd)|red.cell.distribution(?!.*sd)", group="red_cells"),
        S("mchc", "Haemoglobin concentration (MCHC)", "how tightly haemoglobin is packed into each cell",
          raw=r"\bmchc\b|h(?:a)?emoglobin conc|hemo\W*conc", extra=True, note="index"),
        S("rdw_sd", "Red cell variation, second measure (RDW-SD)", "the same evenness, measured another way",
          raw=r"rdw\W*sd|distribution width\W*-?\W*sd", extra=True, note="index"),
        S("mentzer", "Mentzer index", raw=r"mentzer", extra=True, noflag=True, worked=True, table="small_cell_indices"),
        S("rdwi", "RDWI", raw=r"\brdwi\b|distribution width index", extra=True, noflag=True, worked=True, table="small_cell_indices"),
        S("wbc", "White cell count", raw=r"\bwbc\b|white blood cell|total leu[ck]ocyte|\btlc\b|leu[ck]ocyte count", unit="per cu.mm", scale="wbc"),
        S("lymph", "Lymphocytes", "one family of white cells", raw=r"^(?!.*absolute)(?!.*ratio)(?!.*atypical).*lymphocyte", group="white_cells"),
        S("nlr", "Neutrophil to lymphocyte ratio", "a read of immune stress", comp=r"neutrophil/lymphocyte",
          kind="z3", a=2.0, b=3.0, rtxt="under 2.0 good · over 3.0 high", beyond=True, group="white_cells"),
        S("neut", "Neutrophils", "the first white cells to arrive at an infection", raw=_SHARE + r"neutrophil", extra=True, note="wbc_type"),
        S("mono", "Monocytes", "the clean-up cells", raw=_SHARE + r"monocyte", extra=True, note="wbc_type"),
        S("eos", "Eosinophils", "rise with allergy and some gut infections", raw=_SHARE + r"eosinophil", extra=True, note="wbc_type"),
        S("baso", "Basophils", "the rarest white cell, part of allergic reactions", raw=_SHARE + r"basophil", extra=True, note="wbc_type"),
        S("ig", "Immature granulocytes", "young white cells, released when the marrow is busy",
          raw=r"immature granulocyte.*(?:percent|%)", extra=True),
        S("nrbc", "Nucleated red cells", "very young red cells, normally absent from blood", raw=r"nucleated red.*(?:percent|%)", extra=True),
        S("neut_abs", "Neutrophils", raw=_COUNT + r"neutrophil", extra=True, note="wbc_type", table="cell_counts"),
        S("lymph_abs", "Lymphocytes", raw=_COUNT + r"lymphocyte", extra=True, note="wbc_type", table="cell_counts"),
        S("mono_abs", "Monocytes", raw=_COUNT + r"monocyte", extra=True, note="wbc_type", table="cell_counts"),
        S("eos_abs", "Eosinophils", raw=_COUNT + r"eosinophil", extra=True, note="wbc_type", table="cell_counts"),
        S("baso_abs", "Basophils", raw=_COUNT + r"basophil", extra=True, note="wbc_type", table="cell_counts"),
        S("ig_abs", "Immature granulocytes", raw=r"^(?!.*percent)(?!.*%).*immature granulocyte", extra=True, table="cell_counts"),
        S("nrbc_abs", "Nucleated red cells", raw=r"^(?!.*percent)(?!.*%).*nucleated red", extra=True, table="cell_counts"),
        S("platelets", "Platelets", "the clotting cells", raw=r"\bplatelet|\bplt\b", unit="thousand/uL", scale="platelets"),
        S("mpv", "Platelet size (MPV)", "the average size of your platelets", raw=r"\bmpv\b|mean platelet volume", extra=True, note="index", worked=True),
        S("pdw", "Platelet size variation (PDW)", "how much platelet size varies", raw=r"\bpdw\b|platelet distribution", extra=True, note="index", worked=True),
        S("plcr", "Large platelets (P-LCR)", "the share of platelets that are large", raw=r"p\W?lcr|platelet to large|large cell ratio", extra=True, note="index", worked=True),
        S("pct", "Plateletcrit (PCT)", "the share of your blood made up of platelets", raw=r"plateletcrit", extra=True, note="index", worked=True),
    ]),
    ("nutrients", "Vitamins and iron", True, [
        S("vitd", "Vitamin D (25-OH)", raw=r"vitamin d|25.oh|calcidiol|25-hydroxyvitamin", nature="work"),
        S("b12", "Vitamin B12", raw=r"^(?!.*holotrans)(?!.*holo.?tc)(?!.*\bactive\b).*(?:vitamin b12|b-12\b|b12\b|cobalamin)"),
        S("iron", "Iron", "iron in the blood today", raw=r"serum iron|s-iron|^iron\b(?!\s*binding)", group="iron"),
        S("tibc", "Iron-binding capacity (TIBC)", "how much more iron the blood could carry", raw=r"\btibc\b|total iron binding", group="iron"),
        S("tsat", "Transferrin saturation", "how full your iron carriers are", raw=r"transferrin saturation|\btsat\b|% ?saturation", group="iron"),
        S("ferritin", "Ferritin", "your iron stores", raw=r"\bferritin\b", group="iron"),
        S("uibc", "Spare iron-carrying capacity (UIBC)", "the room left on your iron carriers", raw=r"\buibc\b|unsat\w*\W*iron", group="iron", extra=True),
        S("folate", "Folate", "a B vitamin your blood cells are built with", raw=r"\bfolate\b|folic acid|vitamin b9", extra=True),
        S("phosphorus", "Phosphorus", raw=r"^(?!.*urine)(?!.*ratio).*(?:phosphorus|phosphorous|phosphate)"),
    ]),
    ("immune", "Allergy and autoimmune markers", True, [
        S("ige", "Total IgE", "the antibody behind allergic reactions", raw=r"\bige\b|immunoglobulin e\b", under=True, extra=True, quiet=True),
        S("rf", "Rheumatoid factor", "an antibody often raised in rheumatoid arthritis", raw=r"rheumatoid factor|\bra factor\b", under=True,
          group="autoimmune", extra=True),
        S("anti_ccp", "Anti-CCP", "a more specific marker for rheumatoid arthritis", raw=r"anti\W*ccp|\baccp\b|citrullinated", under=True,
          group="autoimmune", extra=True),
        S("ana", "ANA", "antibodies directed at the body's own cells", raw=r"anti\W*nuclear|\bana\b", under=True, group="autoimmune", extra=True),
    ]),
    ("pancreas", "Pancreas", True, [
        S("lipase", "Lipase", "the enzyme that digests fat", raw=r"\blipase\b", group="pancreas", extra=True),
        S("amylase", "Amylase", "the enzyme that digests starch", raw=r"\bamylase\b", group="pancreas", extra=True),
    ]),
    ("metals", "Metals and trace elements", True, [
        S("lead", "Lead", raw=r"\blead\b", under=True),
        S("mercury", "Mercury", raw=r"\bmercury\b", under=True),
        S("arsenic", "Arsenic", raw=r"\barsenic\b", under=True),
        S("cadmium", "Cadmium", raw=r"\bcadmium\b", under=True),
        S("selenium", "Selenium", raw=r"\bselenium\b", under=True, extra=True, table="needed"),
        S("manganese", "Manganese", raw=r"\bmanganese\b", under=True, extra=True, table="needed"),
        S("molybdenum", "Molybdenum", raw=r"\bmolybdenum\b", under=True, extra=True, table="needed"),
        S("cobalt", "Cobalt", raw=r"\bcobalt\b", under=True, extra=True, table="needed"),
        S("chromium", "Chromium", raw=r"\bchromium\b", under=True, extra=True, table="needed"),
        S("aluminium", "Aluminium", raw=r"\balumini?um\b", under=True, extra=True, table="no_use", needed=False),
        S("antimony", "Antimony", raw=r"\bantimony\b", under=True, extra=True, table="no_use", needed=False),
        S("barium", "Barium", raw=r"\bbarium\b", under=True, extra=True, table="no_use", needed=False),
        S("beryllium", "Beryllium", raw=r"\bberyllium\b", under=True, extra=True, table="no_use", needed=False),
        S("bismuth", "Bismuth", raw=r"\bbismuth\b", under=True, extra=True, table="no_use", needed=False),
        S("caesium", "Caesium", raw=r"\bc(?:a)?esium\b", under=True, extra=True, table="no_use", needed=False),
        S("nickel", "Nickel", raw=r"\bnickel\b", under=True, extra=True, table="no_use", needed=False),
        S("silver", "Silver", raw=r"\bsilver\b", under=True, extra=True, table="no_use", needed=False),
        S("strontium", "Strontium", raw=r"\bstrontium\b", under=True, extra=True, table="no_use", needed=False),
        S("thallium", "Thallium", raw=r"\bthallium\b", under=True, extra=True, table="no_use", needed=False),
        S("tin", "Tin", raw=r"^\s*tin\b", under=True, extra=True, table="no_use", needed=False),
        S("uranium", "Uranium", raw=r"\buranium\b", under=True, extra=True, table="no_use", needed=False),
        S("vanadium", "Vanadium", raw=r"\bvanadium\b", under=True, extra=True, table="no_use", needed=False),
    ]),
]

# The compact tables: {key: (heading, the line under it)}. Headings and lines are the approved ones (C2, C12, C16,
# C23, C37 to C41).
TABLES: dict[str, tuple[str, str]] = {
    "chol_ratios": ("Your laboratory's cholesterol ratios", "worked out from the numbers above"),
    "kidney_ratios": ("Urea nitrogen to creatinine ratio, urea to creatinine ratio", "two waste products against each other; mostly a read of water and protein"),
    # these two reworded at Shivani's "it is not clear what exactly we are doing", her "yes" of 20 Nov 2026
    "small_cell_indices": ("Mentzer index and RDWI", "Two figures worked out from your red cell size and count. They are read only when red "
                           "cells are small, to help tell low iron from an inherited trait."),
    "cell_counts": ("Your white cell types, as actual counts", "The rows above show each type as a share of your white cells. This table shows "
                    "the same cells as actual numbers in your blood."),
    "needed": ("Needed in small amounts", ""),
    "no_use": ("No known use in the body", ""),
    "looks": ("How it looks", ""),
    "dissolved": ("What is dissolved in it", ""),
    "microscope": ("Under the microscope", ""),
}
INDICES_NOTHING_TO_READ = " Your red cells are a normal size, so there is nothing to read here."      # added when MCV is not low


def small_cells(rows: dict) -> bool:
    """True when the red cells are small (MCV below the laboratory's range): the only time the two indices are read."""
    r = rows.get("mcv")
    return bool(r and r.lo is not None and r.value < r.lo)


FURTHER_ELEMENTS = ['selenium', 'manganese', 'molybdenum', 'cobalt', 'chromium', 'aluminium', 'antimony', 'barium', 'beryllium', 'bismuth', 'caesium', 'nickel', 'silver', 'strontium', 'thallium', 'tin', 'uranium', 'vanadium']

# the nine values body age is worked out from, in the order the report lists them
NINE = ["mcv", "rdw", "glucose", "wbc", "albumin", "lymph", "hscrp", "alp", "creatinine"]


def num(v: float) -> str:
    """A number as the report prints it."""
    if isinstance(v, int) or (float(v).is_integer() and v >= 100):
        return f"{int(v):,}"
    return f"{v:g}" if v >= 10 else (f"{v:.2f}" if round(v, 2) != round(v, 1) else f"{v:.1f}")


def rng(v: float) -> str:
    """A bound of the laboratory's range: no trailing zeros (0.40 prints as 0.4, 13.0 as 13)."""
    return f"{int(v):,}" if float(v).is_integer() else f"{v:g}"


_WORKED_OUT = re.compile(r"\bratio\b|\bindex\b|mean platelet|platelet distribution|platelet to large|plateletcrit|"
                         r"\bmpv\b|\bpdw\b|\bplcr\b|\bpct\b")


def _round(v: float, decimals: Optional[int]) -> float:
    """Round half up, on the digits the laboratory printed (2.855 is 2.86, not the float's 2.85)."""
    places = decimals if decimals is not None else (1 if abs(v) >= 10 else 2)
    return float(Decimal(str(v)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))


def _scale(v: float, how: Optional[str]) -> float:
    if how == "wbc":           # printed per cu.mm; some laboratories print thousands
        return v * 1000 if v < 200 else v
    if how == "platelets":     # printed in thousands; some print per cu.mm or lakhs
        return v / 1000 if v > 2000 else (v * 100 if v < 10 else v)
    return v


def state_of(v: float, kind: str, a: Optional[float], b: Optional[float], b_incl: bool = False) -> str:
    if kind == "range":
        return "ok" if a <= v <= b else "out"
    if kind == "max":
        return "ok" if v <= a else "out"
    if kind == "min":
        return "ok" if v >= a else "out"
    if kind == "z3":
        if v < a:
            return "ok"
        return "out" if (v >= b if b_incl else v > b) else "mid"
    return "ok"


def _lab_range_text(lo: Optional[float], hi: Optional[float], under: bool) -> tuple[str, Optional[float], Optional[float], str]:
    """(kind, a, b, text) from the laboratory's printed range."""
    if lo is not None and hi is not None:
        if lo == 0:
            return "max", hi, None, (f"lab under {rng(hi)}" if under else f"lab 0–{rng(hi)}")
        return "range", lo, hi, f"lab {rng(lo)}–{rng(hi)}"
    if hi is not None:
        return "max", hi, None, f"lab under {rng(hi)}"
    if lo is not None:
        return "min", lo, None, f"lab over {rng(lo)}"
    return "none", None, None, "no range printed by the laboratory"


def build_sections(labs: list[dict], markers: list[dict], *, sex: Optional[str], deeper: bool,
                   cutoffs: Optional[dict] = None, age: Optional[int] = None) -> list[Section]:
    """Sections with their rows, from one draw's lab values and the engine's calculated scores.

    A row whose result is not on file is left out; a section with no rows at all is left out too."""
    out: list[Section] = []
    # A row reads the result itself, never a figure worked out from it that carries its name ("SGOT / SGPT RATIO",
    # "Mean Platelet Volume", "RDW index"): whichever the laboratory printed first used to win.
    direct = [l for l in labs if not _WORKED_OUT.search(str(l.get("test_name") or "").lower())]
    for sid, name, deeper_only, specs in SECTIONS:
        if deeper_only and not deeper:
            continue
        sec = Section(sid, name)
        for sp in specs:
            if sp.deeper and not deeper:
                continue
            lab: Optional[dict] = None
            if sp.comp:
                m = next((m for m in markers if m.get("computed") and re.search(sp.comp, str(m.get("marker_name", "")).lower())), None)
                if not m or m.get("value") is None:
                    continue
                v, unit = float(m["value"]), ""
            else:
                v0, lab = _peek(labs if sp.worked else direct, sp.raw)
                if v0 is None or lab is None:
                    continue
                v, unit = _scale(v0, sp.scale), str(lab.get("unit") or "")
            v = _round(v, sp.decimals)
            lo = hi = None
            if lab is not None:
                lo, hi = _parse_ref_range(lab.get("reference_range"))
                if sp.scale and hi is not None:
                    lo, hi = (_scale(lo, sp.scale) if lo is not None else None), _scale(hi, sp.scale)
            if sp.kind == "z3":
                kind, a, b, rtxt = "z3", sp.a, sp.b, sp.rtxt
                if sp.key == "fib4" and age is not None and age >= 65:      # the lower line is 2.0 from age 65 (cutoffs.yaml)
                    a, rtxt = 2.0, "under 2.0 low · over 2.67 high"
            elif sp.kind == "min":
                kind, a, b, rtxt, lo, hi = "min", sp.a, None, sp.rtxt, sp.a, None
            else:
                kind, a, b, rtxt = _lab_range_text(lo, hi, sp.under)
            st = state_of(v, kind, a, b, sp.b_incl)
            ckey, unit_warn = sp.key, ""
            if sp.key == "fib4" and age is not None and age >= 65:
                ckey = "fib4_65"
            if sp.key == "lpa":           # the lines are per unit; laboratories report Lp(a) in mg/dL or nmol/L
                u = unit.lower().replace(" ", "")
                if "nmol" in u:
                    ckey = "lpa_nmol"
                elif "mg/dl" not in u:
                    unit_warn = f"Lp(a): the unit ({unit or 'none'}) is neither mg/dL nor nmol/L; its level was read as mg/dL, check it"
            if sp.key == "lead":          # the lines are µg/dL; this panel's laboratory reports µg/L, ten times the number
                u = unit.lower().replace(" ", "").replace("μ", "µ").replace("mcg", "µg").replace("ug", "µg").replace("µµ", "µ")
                if u.endswith("g/l"):
                    ckey = "lead_ug_l"
                elif not u.endswith("g/dl"):
                    unit_warn = f"Lead: the unit ({unit or 'none'}) is neither µg/dL nor µg/L; its level was read as µg/dL, check it"
            if not plus_unit_ok(sp.key, unit, cutoffs):
                unit_warn = (f"{sp.name}: the unit ({unit or 'none'}) is not the one its strongest-level line is written for; "
                             "only the per-cent rule was applied, check it")
            lv, side = level_and_side(ckey, v, lo=lo, hi=hi, sex=sex, cutoffs=cutoffs, unit=unit)
            note = ""
            if sp.noflag or sp.note:          # shown and explained; outside its range it is never a level (D2, F9, F10)
                if sp.note and st == "out":
                    note = sp.note
                    if rank(lv) >= 3:
                        unit_warn = (f"{sp.name}{' (count)' if sp.table else ''} {num(v)} is far outside its range. The report prints only "
                                     "its fixed short paragraph for this kind of result: read it yourself")
                lv, side = "", ""
            if not sp.needed and side == "low":      # an element with no use in the body: a low result is not marked at all
                lv, side, st = "", "", "ok"
            illustrative = bool(lab and lab.get("illustrative"))
            sec.rows.append(Row(
                key=sp.key, name=sp.name, gloss="illustrative value" if illustrative else sp.gloss, value=v,
                unit=sp.unit if sp.unit is not None else unit, kind=kind, a=a, b=b,
                rtxt=("illustrative range, " + rtxt.replace("lab ", "")) if illustrative else rtxt,
                calc=bool(sp.comp), state=st, level=lv, nature=sp.nature, group=sp.group or sp.key, beyond=sp.beyond,
                lo=lo, hi=hi, b_incl=sp.b_incl, illustrative=illustrative, side=side,
                extra=sp.extra, quiet=sp.quiet or (lv == "B" and sp.key in ((cutoffs or load_cutoffs()).get("quiet_at_B") or [])), note=note, table=sp.table, ref=_ref_text(lab),
                warn=unit_warn or ("" if kind != "none" or sp.noflag else f"{sp.name}: the laboratory's range could not be read")))
        if sec.rows:
            out.append(sec)
    urine = urine_section(labs, cutoffs)
    if urine is not None:
        out.append(urine)
    _thyroid_hormone_rule(out)
    return out


def _ref_text(lab: Optional[dict]) -> str:
    """The laboratory's range as it printed it, for the compact tables."""
    return re.sub(r"\s+", " ", str((lab or {}).get("reference_range") or "")).strip()


# ── urine (both reports) ─────────────────────────────────────────────────────
# Results are words, not numbers (D6): "trace" is just outside (A), "present" is clearly off (B), nothing goes
# further. (key, printed name, table, regex on the test name, needs the word "urine" in the name, how it is read)
#   word   absent / trace / present        count  cells seen, against the laboratory's range
#   number against the laboratory's range  colour / clear: the usual word or not        show  never marked
_U = [
    ("u_colour", "Colour", "looks", r"colou?r", False, "colour"),
    ("u_appearance", "Appearance", "looks", r"appearance|clarity|transparency", False, "clear"),
    ("u_volume", "Volume", "looks", r"volume|quantity", True, "show"),
    ("u_sg", "Concentration (specific gravity)", "looks", r"specific gravity", False, "number"),
    ("u_ph", "Acidity (pH)", "looks", r"\bph\b|reaction", True, "number"),
    ("u_protein", "Protein", "dissolved", r"protein|albumin", True, "word"),
    ("u_glucose", "Glucose", "dissolved", r"glucose|sugar", True, "word"),
    ("u_ketones", "Ketones", "dissolved", r"ketone", False, "word"),
    ("u_bilirubin", "Bilirubin", "dissolved", r"bilirubin", True, "word"),
    ("u_urobilinogen", "Urobilinogen", "dissolved", r"urobilinogen", False, "word"),
    ("u_bile_pigment", "Bile pigment", "dissolved", r"bile pigment", False, "word"),
    ("u_bile_salt", "Bile salt", "dissolved", r"bile salt", False, "word"),
    ("u_blood", "Blood", "dissolved", r"^(?!.*cell)(?!.*rbc).*\bblood\b", True, "word"),
    ("u_nitrite", "Nitrite", "dissolved", r"nitrite", False, "word"),
    ("u_esterase", "Leucocyte esterase", "dissolved", r"leu[ck]ocyte esterase", False, "word"),
    ("u_pus", "Pus cells", "microscope", r"pus cell|urinary leu[ck]ocytes", False, "count"),
    ("u_rbc", "Red blood cells", "microscope", r"red blood cell|\brbcs?\b|erythrocyte", True, "count"),
    ("u_epithelial", "Epithelial cells", "microscope", r"epithelial", False, "show"),
    ("u_casts", "Casts", "microscope", r"\bcasts?\b", False, "word"),
    ("u_crystals", "Crystals", "microscope", r"crystal", False, "word"),
    ("u_bacteria", "Bacteria", "microscope", r"bacteria", False, "word"),
    ("u_yeast", "Yeast", "microscope", r"yeast", False, "word"),
    ("u_parasites", "Parasites", "microscope", r"parasite", False, "word"),
    ("u_mucus", "Mucus", "microscope", r"mucus|mucous", False, "show"),
]
_U_NONE = re.compile(r"\b(?:absent|nil|negative|neg|normal|not (?:detected|seen|found|present)|none|nad)\b")
_U_TRACE = re.compile(r"trace|\+\s*/\s*-|±|occasional|\bfew\b|\brare\b|scanty")
_U_SOME = re.compile(r"present|positive|detected|\bseen\b|\+|many|plenty|numerous|moderate|abundant|loaded|full field")


def _is_urine(lab: dict) -> bool:
    return any("urin" in str(lab.get(k) or "").lower() for k in ("test_name", "specimen", "sample", "panel", "category", "section"))


def _urine_level(how: str, raw: str, ref: str, cutoffs: Optional[dict]) -> tuple[str, str, bool]:
    """(state, level, read): how one urine result is read. `read` False = the words could not be understood."""
    v = raw.lower().strip()
    if how == "show" or not v:
        return "ok", "", True
    if ref and v == ref.lower().strip():
        return "ok", "", True
    lo, hi = _parse_ref_range(ref)
    nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", v)]
    if how == "number":
        if not nums or (lo is None and hi is None):
            return "ok", "", bool(nums)
        return ("out", "A", True) if ((hi is not None and nums[0] > hi) or (lo is not None and nums[0] < lo)) else ("ok", "", True)
    if how == "colour":
        return ("ok", "", True) if re.search(r"yellow|straw|amber", v) else ("out", "A", True)
    if how == "clear":
        return ("ok", "", True) if re.search(r"\bclear\b", v) and "not clear" not in v else ("out", "A", True)
    if _U_NONE.search(v):
        return "ok", "", True
    if _U_TRACE.search(v):
        return "out", "A", True
    if nums and not re.search(r"\d\s*\+|\+\s*\d", v):      # cells seen per field ("2-3", "6 - 8 /hpf"), not "2+"
        if hi is None:
            return ("ok", "", True) if max(nums) == 0 else ("ok", "", False)
        if max(nums) <= hi:
            return "ok", "", True
        fb = (cutoffs or load_cutoffs()).get("fallback_pct") or {}
        return "out", ("B" if rank(_scan(100.0 * (max(nums) - hi) / hi, fb, None)) >= 2 else "A"), True
    if _U_SOME.search(v):
        return "out", "B", True
    return "ok", "", False


def urine_section(labs: list[dict], cutoffs: Optional[dict] = None) -> Optional[Section]:
    """The Urine section, or None when the draw has no urine results (an older draw simply has no such section)."""
    urine = [l for l in labs if _is_urine(l)]
    sec = Section("urine", "Urine")
    for key, name, table, pat, needs_word, how in _U:
        lab = next((l for l in (urine if needs_word else labs)
                    if re.search(pat, str(l.get("test_name") or "").lower())), None)
        if lab is None:
            continue
        raw = str(lab.get("value") if lab.get("value") is not None else "").strip()
        ref = _ref_text(lab)
        st, lv, read = _urine_level(how, raw, ref, cutoffs)
        try:
            value = float(raw.replace(",", ""))
        except ValueError:
            value = 0.0
        sec.rows.append(Row(
            key=key, name=name, gloss="", value=value, unit=str(lab.get("unit") or ""), kind="none", a=None, b=None,
            rtxt=f"lab {ref}" if ref else "", calc=False, state=st, level=lv, nature="repeat", group=key, beyond=False,
            side="high" if lv else "", extra=True, quiet=True, table=table, vtext=raw, ref=ref,
            warn="" if read else f"Urine, {name.lower()}: the result ({raw or 'blank'}) could not be read against its range ({ref or 'none printed'}): read it yourself"))
    if len(sec.rows) < 3:           # a stray match (a "colour" or "volume" from another test) is not a urine test
        return None
    have = {r.key for r in sec.rows}
    missing = [n for k, n in (("u_protein", "protein"), ("u_glucose", "glucose"), ("u_blood", "blood")) if k not in have]
    if missing:
        sec.rows[0].warn = sec.rows[0].warn or (f"Urine: no result found for {', '.join(missing)}. Check how the laboratory names "
                                                "them (the report looks for the word 'urine' in those names)")
    return sec


def unlisted_out_of_range(labs: list[dict]) -> list[str]:
    """Measured results outside their laboratory range that the report has NO row for (total IgE, lipase...).
    The report cannot speak about them, so the coach is told: they must not pass unseen."""
    patterns = [re.compile(sp.raw) for _sid, _name, _d, specs in SECTIONS for sp in specs if sp.raw]
    urine = [re.compile(u[3]) for u in _U]
    out: list[str] = []
    for lab in labs:
        name = str(lab.get("test_name") or "").strip()
        if not name or lab.get("illustrative") or any(p.search(name.lower().replace(".", "")) for p in patterns):
            continue
        if _is_urine(lab) and any(p.search(name.lower()) for p in urine):
            continue
        if re.search(r"vldl|ratio|\bindex\b", name.lower()):     # worked out from results the report already reads
            continue
        try:
            v = float(str(lab.get("value")).replace(",", ""))
        except (TypeError, ValueError):
            continue
        lo, hi = _parse_ref_range(lab.get("reference_range"))
        if (hi is not None and v > hi) or (lo is not None and v < lo):
            out.append(f"{name} {num(v)} is outside its range ({lab.get('reference_range')}) and the report has no row for it: read it yourself")
    return out


def _thyroid_hormone_rule(sections: list[Section]) -> None:
    """Free T4 or free T3 outside range: level B with a normal TSH, C with an abnormal one."""
    rows = {r.key: r for s in sections for r in s.rows}
    tsh = rows.get("tsh")
    for k in ("ft4", "ft3"):
        r = rows.get(k)
        if r and r.state == "out":
            r.level = "C" if (tsh and tsh.level) else "B"
            r.side = r.side or ("high" if (r.hi is not None and r.value > r.hi) else "low")


def all_rows(sections: list[Section]) -> dict[str, Row]:
    return {r.key: r for s in sections for r in s.rows}


def b12_high(rows: dict[str, Any]) -> bool:
    r = rows.get("b12")
    return bool(r and r.hi is not None and r.value > r.hi)
