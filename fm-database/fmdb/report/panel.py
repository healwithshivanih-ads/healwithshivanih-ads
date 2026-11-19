"""What the body age report reads: its sections, and the rows in each, built from a person's lab results.

The standard report has six sections. The deeper report adds the free thyroid hormones, a "Vitamins and iron"
section and a "Metals" section. Row names and the short plain-language gloss under each are the approved ones.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Optional

from fmdb.assess.lab_ratios import _parse_ref_range, _peek

from .levels import level_and_side


@dataclass
class Spec:
    key: str
    name: str
    gloss: str = ""
    raw: str = ""                 # regex on the laboratory's test name
    comp: str = ""                # regex on a score the lab engine calculates
    kind: str = "lab"             # lab = the laboratory's own range · z3 = three fixed tiers
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


@dataclass
class Section:
    id: str
    name: str
    rows: list[Row] = field(default_factory=list)
    status: str = "steady"        # steady | watch | needs attention | needs a deeper look
    key: str = "steady"           # steady | watch | att  (colour)


S = Spec
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
        S("lpa", "Lp(a)", "an inherited particle, measured once", raw=r"\blp\(?a\)?|lipoprotein.{0,5}a\b|lipoprotein.little.a",
          under=True, nature="inherited", beyond=True),
        S("hcy", "Homocysteine", "linked with wear on the artery wall", raw=r"homocysteine|\bhcy\b", decimals=2, beyond=True),
        S("hscrp", "hs-CRP", "background inflammation",
          raw=r"hs.?crp|high.sensitivity.crp|high sensitivity c.reactive|c.?reactive.*sensitiv|sensitiv.*c.?reactive|crp.*sensitiv",
          kind="z3", a=1.0, b=3.0, rtxt="lab under 1.0 low · over 3.0 high", nature="work", group="inflammation", beyond=True),
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
        S("tyg", "TyG index", "triglycerides and glucose read together", comp=r"^tyg index",
          kind="z3", a=8.3, b=8.8, rtxt="under 8.3 good · over 8.8 high", nature="work", group="sugar", beyond=True),
        S("uric", "Uric acid", "rises with sugar strain and with some foods and drinks", raw=r"uric acid|serum urate|urate\b", nature="work"),
    ]),
    ("liver", "Liver", False, [
        S("alt", "ALT", "the liver's own enzyme", raw=r"\balt\b|sgpt\b|alanine.amino|alanine transaminase", group="liver_enzymes"),
        S("ast", "AST", "an enzyme shared by liver and muscle", raw=r"\bast\b|sgot\b|aspartate.amino|aspartate transaminase", group="liver_enzymes"),
        S("ggt", "GGT", "sensitive to alcohol, medicines and liver fat", raw=r"\bggtp?\b|gamma.glutamyl|gamma-gt", group="liver_enzymes"),
        S("alp", "ALP", "bile flow and bone", raw=r"\balp\b|alkaline phosphatase|alk phos"),
        S("bilirubin", "Bilirubin", "a pigment the liver clears", raw=r"total bilirubin|bilirubin.total|t.bili\b"),
        S("albumin", "Albumin", "the main protein the liver makes", raw=r"^(?!.*ratio)(?!.*binding)(?!.*urine)(?!.*micro).*\balbumin\b"),
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
          raw=r"^(?!.*urine)(?!.*ratio)(?!.*albumin)(?!.*clearance).*\bcreatinine\b", group="kidney"),
        S("urea", "Urea", "waste from protein", raw=r"^(?!.*nitrogen)(?!.*\bbun\b).*\burea\b", group="kidney"),
        S("bun", "Urea nitrogen (BUN)", "the same waste, counted another way", raw=r"\bbun\b|urea nitrogen", group="kidney"),
        S("sodium", "Sodium", raw=r"^(?!.*urine)(?!.*ratio).*\bsodium\b"),
        S("potassium", "Potassium", raw=r"^(?!.*urine)(?!.*ratio).*\bpotassium\b"),
        S("chloride", "Chloride", raw=r"^(?!.*urine).*\bchloride\b"),
        S("calcium", "Calcium", raw=r"^(?!.*urine)(?!.*ratio)(?!.*corrected)(?!.*ionised)(?!.*ionized).*\bcalcium\b"),
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
        S("wbc", "White cell count", raw=r"\bwbc\b|white blood cell|total leu[ck]ocyte|\btlc\b|leu[ck]ocyte count", unit="per cu.mm", scale="wbc"),
        S("lymph", "Lymphocytes", "one family of white cells", raw=r"^(?!.*absolute)(?!.*ratio)(?!.*atypical).*lymphocyte", group="white_cells"),
        S("nlr", "Neutrophil to lymphocyte ratio", "a read of immune stress", comp=r"neutrophil/lymphocyte",
          kind="z3", a=2.0, b=3.0, rtxt="under 2.0 good · over 3.0 high", beyond=True, group="white_cells"),
        S("platelets", "Platelets", "the clotting cells", raw=r"\bplatelet|\bplt\b", unit="thousand/uL", scale="platelets"),
    ]),
    ("nutrients", "Vitamins and iron", True, [
        S("vitd", "Vitamin D (25-OH)", raw=r"vitamin d|25.oh|calcidiol|25-hydroxyvitamin", nature="work"),
        S("b12", "Vitamin B12", raw=r"^(?!.*holotrans)(?!.*holo.?tc)(?!.*\bactive\b).*(?:vitamin b12|b-12\b|b12\b|cobalamin)"),
        S("iron", "Iron", "iron in the blood today", raw=r"serum iron|s-iron|^iron\b(?!\s*binding)", group="iron"),
        S("tibc", "Iron-binding capacity (TIBC)", "how much more iron the blood could carry", raw=r"\btibc\b|total iron binding", group="iron"),
        S("tsat", "Transferrin saturation", "how full your iron carriers are", raw=r"transferrin saturation|\btsat\b|% ?saturation", group="iron"),
        S("phosphorus", "Phosphorus", raw=r"^(?!.*urine)(?!.*ratio).*(?:phosphorus|phosphate)"),
    ]),
    ("metals", "Metals", True, [
        S("lead", "Lead", raw=r"\blead\b", under=True),
        S("mercury", "Mercury", raw=r"\bmercury\b", under=True),
        S("arsenic", "Arsenic", raw=r"\barsenic\b", under=True),
        S("cadmium", "Cadmium", raw=r"\bcadmium\b", under=True),
    ]),
]

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
                   cutoffs: Optional[dict] = None) -> list[Section]:
    """Sections with their rows, from one draw's lab values and the engine's calculated scores.

    A row whose result is not on file is left out; a section with no rows at all is left out too."""
    out: list[Section] = []
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
                v0, lab = _peek(labs, sp.raw)
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
            else:
                kind, a, b, rtxt = _lab_range_text(lo, hi, sp.under)
            st = state_of(v, kind, a, b, sp.b_incl)
            ckey, unit_warn = sp.key, ""
            if sp.key == "lpa":           # the lines are per unit; laboratories report Lp(a) in mg/dL or nmol/L
                u = unit.lower().replace(" ", "")
                if "nmol" in u:
                    ckey = "lpa_nmol"
                elif "mg/dl" not in u:
                    unit_warn = f"Lp(a): the unit ({unit or 'none'}) is neither mg/dL nor nmol/L; its level was read as mg/dL, check it"
            lv, side = level_and_side(ckey, v, lo=lo, hi=hi, sex=sex, cutoffs=cutoffs)
            illustrative = bool(lab and lab.get("illustrative"))
            sec.rows.append(Row(
                key=sp.key, name=sp.name, gloss="illustrative value" if illustrative else sp.gloss, value=v,
                unit=sp.unit if sp.unit is not None else unit, kind=kind, a=a, b=b,
                rtxt=("illustrative range, " + rtxt.replace("lab ", "")) if illustrative else rtxt,
                calc=bool(sp.comp), state=st, level=lv, nature=sp.nature, group=sp.group or sp.key, beyond=sp.beyond,
                lo=lo, hi=hi, b_incl=sp.b_incl, illustrative=illustrative, side=side,
                warn=unit_warn or ("" if kind != "none" else f"{sp.name}: the laboratory's range could not be read")))
        if sec.rows:
            out.append(sec)
    _thyroid_hormone_rule(out)
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
