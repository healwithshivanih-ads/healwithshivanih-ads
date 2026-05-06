"""
Compute derived FM markers and individual lab values with FM-optimal interpretation.

Each returned dict includes:
  marker_name, value, unit, reference_range, flag, fm_interpretation, panel, computed

`panel` groups markers into logical systems for the dashboard UI.
`computed` = True means it was derived from other values (ratio/calculation).
`computed` = False means it was read directly from the lab result.
"""
from __future__ import annotations
import re
from datetime import datetime
from typing import Any


def _parse_lab_date(d: object) -> float:
    """Parse a lab date string to a Unix timestamp for comparison.

    Handles common formats produced by the extraction model:
      "19/Apr/2026"  (day/Mon/year)
      "2026-04-19"   (ISO)
      "Apr 2026"     (month-year only)
    Returns 0 for unparseable / missing dates so undated entries sort last.
    """
    if not d:
        return 0.0
    s = re.sub(r"^(\d{1,2})/([A-Za-z]{3})/(\d{4})$", r"\2 \1 \3", str(d).strip())
    for fmt in ("%b %d %Y", "%Y-%m-%d", "%d/%m/%Y", "%b %Y", "%d-%b-%Y"):
        try:
            return datetime.strptime(s, fmt).timestamp()
        except ValueError:
            pass
    return 0.0


def _find(labs: list[dict], *patterns: str) -> float | None:
    """Return the numeric value from the MOST RECENT lab matching any regex pattern.

    When multiple lab reports are uploaded in one session (e.g. Jan 2026 and
    Apr 2026), the AI names entries with date suffixes such as
    "TSH (Ultrasensitive) - Jan 2026" and "TSH (Ultrasensitive) - Apr 2026".
    This function collects every match, compares their date_drawn timestamps,
    and returns the value from the latest report so the client profile always
    reflects the current results rather than the oldest ones.
    """
    best_value: float | None = None
    best_ts: float = -1.0
    for lab in labs:
        n = str(lab.get("test_name", "")).lower()
        for pat in patterns:
            if re.search(pat.lower(), n):
                try:
                    val = float(re.sub(r"[^0-9.\-]", "", str(lab.get("value", ""))))
                    ts = _parse_lab_date(lab.get("date_drawn"))
                    if best_value is None or ts > best_ts:
                        best_value = val
                        best_ts = ts
                except (ValueError, TypeError):
                    pass
                break  # this lab matched — no need to check remaining patterns
    return best_value


def compute_ratios(extracted_labs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return list of FM-interpreted markers + computed ratios, grouped by panel."""
    results: list[dict[str, Any]] = []

    def add(name: str, value: float | None, unit: str, ref_range: str,
            flag: str, interpretation: str, panel: str, computed: bool = False) -> None:
        if value is None:
            return
        results.append({
            "marker_name": name,
            "value": round(value, 3) if abs(value) < 10 else round(value, 1),
            "unit": unit,
            "reference_range": ref_range,
            "flag": flag,
            "fm_interpretation": interpretation,
            "panel": panel,
            "computed": computed,
        })

    PANEL_META = "Metabolic & Insulin"
    PANEL_THYROID = "Thyroid"
    PANEL_LIVER = "Liver Function"
    PANEL_KIDNEY = "Kidney Function"
    PANEL_CARDIO = "Cardiovascular & Lipids"
    PANEL_IRON = "Iron & Blood"
    PANEL_NUTRIENTS = "Key Nutrients"

    # ══════════════════════════════════════════════════════════════════════════
    # 1. METABOLIC & INSULIN
    # ══════════════════════════════════════════════════════════════════════════
    glucose = _find(extracted_labs,
        r"fasting.glucose|glucose.fast|blood glucose|plasma glucose|fasting blood sugar|fbs\b")
    insulin = _find(extracted_labs,
        r"fasting.insulin|insulin.fast|serum insulin")
    hba1c = _find(extracted_labs,
        r"hba1c|hemoglobin a1c|glycated haemoglobin|glycosylated haemoglobin|a1c\b")
    uric_acid = _find(extracted_labs,
        r"uric acid|serum urate|urate\b")

    if glucose is not None:
        flag = "high" if glucose > 95 else ("low" if glucose < 70 else "optimal")
        add("Fasting glucose", glucose, "mg/dL",
            "70–90 FM optimal (lab: <100)",
            flag,
            f"Glucose {glucose}: {'Elevated — early IR or diet-driven glucose load; target <90' if glucose>95 else 'Low — hypoglycaemic tendency; check meal timing' if glucose<70 else 'FM optimal range'}",
            PANEL_META)

    if insulin is not None:
        flag = "high" if insulin > 8 else ("suboptimal" if insulin > 5 else "optimal")
        add("Fasting insulin", insulin, "uIU/mL",
            "<5 FM optimal; <8 acceptable; lab often passes <25",
            flag,
            f"Insulin {insulin}: {'Significant hyperinsulinaemia — prioritise insulin sensitisation protocol' if insulin>8 else 'Mildly elevated — IR risk; reduce refined carbs, increase movement' if insulin>5 else 'Optimal insulin sensitivity'}",
            PANEL_META)

    if glucose and insulin:
        homa = (glucose * insulin) / 405
        flag = "high" if homa > 2.0 else ("suboptimal" if homa > 1.5 else "optimal")
        add("HOMA-IR", homa, "",
            "<1.5 optimal; <2.0 acceptable; >2.0 insulin resistance",
            flag,
            f"HOMA-IR {round(homa,2)}: {'Significant IR — target lifestyle, sleep, blood sugar protocol' if homa>2 else 'Mild IR pattern — worth addressing early' if homa>1.5 else 'Good insulin sensitivity'}",
            PANEL_META, computed=True)

    if hba1c is not None:
        flag = "high" if hba1c >= 5.7 else ("suboptimal" if hba1c >= 5.4 else "optimal")
        add("HbA1c", hba1c, "%",
            "<5.4% FM optimal; 5.4–5.7% borderline; ≥5.7% pre-diabetic",
            flag,
            f"HbA1c {hba1c}%: {'Pre-diabetic range — urgent dietary and lifestyle intervention' if hba1c>=5.7 else 'Borderline — monitor trend, tighten carb quality' if hba1c>=5.4 else 'FM optimal'}",
            PANEL_META)

    if uric_acid is not None:
        flag = "high" if uric_acid > 5.5 else ("suboptimal" if uric_acid > 4.5 else "optimal")
        add("Uric acid", uric_acid, "mg/dL",
            "<4.5 FM optimal; >5.5 signals metabolic burden (women)",
            flag,
            f"Uric acid {uric_acid}: {'Elevated — linked to IR, gout risk, kidney stress; reduce fructose, purine load' if uric_acid>5.5 else 'Borderline — watch fructose and alcohol intake' if uric_acid>4.5 else 'Good metabolic clearance'}",
            PANEL_META)

    # ══════════════════════════════════════════════════════════════════════════
    # 2. THYROID
    # ══════════════════════════════════════════════════════════════════════════
    tsh = _find(extracted_labs,
        r"\btsh\b|thyroid.stimulating.hormone|thyrotropin")
    t4_free = _find(extracted_labs,
        r"free t4|ft4\b|t4.free|free thyroxine|fT4")
    t3_free = _find(extracted_labs,
        r"free t3|ft3\b|t3.free|free triiodothyronine|fT3")
    t4_total = _find(extracted_labs,
        r"total t4|t4.total|thyroxine\b")
    t3_total = _find(extracted_labs,
        r"total t3|t3.total|triiodothyronine\b")
    rt3 = _find(extracted_labs,
        r"reverse t3|rt3\b|r-t3|rT3")
    tpo_ab = _find(extracted_labs,
        r"tpo\b|thyroid.peroxidase|anti.tpo|thyroid peroxidase antibod|anti-tpo")
    tgab = _find(extracted_labs,
        r"tgab|thyroglobulin.antibod|anti.tg\b|anti-thyroglobulin|tg.antibod")

    if tsh is not None:
        flag = "high" if tsh > 2.5 else ("low" if tsh < 0.5 else "optimal")
        add("TSH", tsh, "mIU/L",
            "0.5–2.5 FM optimal (lab: 0.4–4.0)",
            flag,
            f"TSH {tsh}: {'Elevated — thyroid underfunction or Hashimoto\'s; target <2.5' if tsh>2.5 else 'Suppressed — assess for hyperthyroid pattern' if tsh<0.5 else 'FM optimal'}",
            PANEL_THYROID)

    if t4_free is not None:
        flag = "low" if t4_free < 1.0 else ("optimal" if t4_free <= 1.8 else "suboptimal")
        add("Free T4", t4_free, "ng/dL",
            "1.1–1.8 FM optimal",
            flag,
            f"fT4 {t4_free}: {'Low — insufficient thyroid hormone production' if t4_free<1.0 else 'FM optimal' if t4_free<=1.8 else 'High — verify dosing or hyperthyroid risk'}",
            PANEL_THYROID)

    if t3_free is not None:
        flag = "low" if t3_free < 3.2 else ("optimal" if t3_free <= 4.4 else "suboptimal")
        add("Free T3", t3_free, "pg/mL",
            "3.2–4.4 FM optimal (upper third of range)",
            flag,
            f"fT3 {t3_free}: {'Low active hormone — poor conversion or substrate deficiency; check selenium, iron, cortisol' if t3_free<3.2 else 'FM optimal — good active T3' if t3_free<=4.4 else 'High — verify'}",
            PANEL_THYROID)

    if rt3 is not None:
        flag = "high" if rt3 > 20 else ("suboptimal" if rt3 > 15 else "optimal")
        add("Reverse T3", rt3, "ng/dL",
            "<15 optimal; >20 elevated",
            flag,
            f"rT3 {rt3}: {'Elevated — cortisol burden, inflammation or conversion block shunting T4 → rT3' if rt3>20 else 'Borderline — monitor stress, inflammation' if rt3>15 else 'Acceptable'}",
            PANEL_THYROID)

    if tpo_ab is not None:
        flag = "high" if tpo_ab > 35 else "optimal"
        add("TPO antibodies", tpo_ab, "IU/mL",
            "<35 negative; any elevation = Hashimoto's",
            flag,
            f"TPO Ab {tpo_ab}: {'Elevated — confirms Hashimoto\'s; address gut, immune, stress, gluten' if tpo_ab>35 else 'Negative'}",
            PANEL_THYROID)

    if tgab is not None:
        flag = "high" if tgab > 1 else "optimal"
        add("Thyroglobulin Ab (TgAb)", tgab, "IU/mL",
            "<1 IU/mL negative",
            flag,
            f"TgAb {tgab}: {'Positive — autoimmune thyroid; assess for Hashimoto\'s or Graves\'' if tgab>1 else 'Negative'}",
            PANEL_THYROID)

    t4 = t4_free or t4_total
    t3 = t3_free or t3_total

    if t4 and t3 and t4 > 0:
        conv = t3 / t4
        flag = "low" if conv < 0.2 else ("optimal" if conv < 0.35 else "suboptimal")
        add("T3/T4 conversion ratio", conv, "",
            "0.2–0.35 fT3/fT4; low = poor peripheral conversion",
            flag,
            f"T3/T4 {round(conv,3)}: {'Poor conversion — check selenium, zinc, cortisol, liver, iron' if conv<0.2 else 'Good conversion efficiency' if conv<0.35 else 'High — verify units or hyperthyroid'}",
            PANEL_THYROID, computed=True)

    if tsh is not None and t3_free and t3_free > 0:
        tsh_ft3 = tsh / t3_free
        flag = "high" if tsh_ft3 > 0.8 else ("suboptimal" if tsh_ft3 > 0.4 else "optimal")
        add("TSH/fT3 ratio", round(tsh_ft3, 3), "",
            "<0.4 optimal; elevated = pituitary compensating for low T3",
            flag,
            f"TSH/fT3 {round(tsh_ft3,3)}: {'High — TSH driving hard for poor T3 output; conversion issue' if tsh_ft3>0.8 else 'Good pituitary-thyroid response' if tsh_ft3<0.4 else 'Borderline'}",
            PANEL_THYROID, computed=True)

    if t3_free and rt3 and rt3 > 0:
        ft3_rt3 = t3_free / rt3
        flag = "low" if ft3_rt3 < 20 else "optimal"
        add("fT3/rT3 ratio", ft3_rt3, "",
            ">20 optimal",
            flag,
            f"fT3/rT3 {round(ft3_rt3,1)}: {'Elevated rT3 — cortisol burden or conversion block; address adrenal/liver/inflammation' if ft3_rt3<20 else 'Acceptable ratio'}",
            PANEL_THYROID, computed=True)

    # ══════════════════════════════════════════════════════════════════════════
    # 3. LIVER FUNCTION
    # ══════════════════════════════════════════════════════════════════════════
    alt = _find(extracted_labs,
        r"\balt\b|sgpt\b|alanine.amino|alanine transaminase")
    ast = _find(extracted_labs,
        r"\bast\b|sgot\b|aspartate.amino|aspartate transaminase")
    ggt = _find(extracted_labs,
        r"\bggt\b|gamma.glutamyl|gamma-gt|γ-gt")
    alp = _find(extracted_labs,
        r"\balp\b|alkaline phosphatase|alk phos")
    bilirubin_total = _find(extracted_labs,
        r"total bilirubin|bilirubin.total|t.bili\b")
    bilirubin_direct = _find(extracted_labs,
        r"direct bilirubin|conjugated bilirubin|d.bili\b")
    albumin = _find(extracted_labs,
        r"\balbumin\b|serum albumin")
    globulin = _find(extracted_labs,
        r"\bglobulin\b|serum globulin")

    if alt is not None:
        flag = "high" if alt > 25 else ("suboptimal" if alt > 20 else "optimal")
        add("ALT (liver cells)", alt, "U/L",
            "<20 FM optimal (lab: <40 women, <56 men)",
            flag,
            f"ALT {alt}: {'Elevated — liver cell stress; investigate NAFLD, toxin load, medication burden' if alt>25 else 'Borderline — reduce alcohol, fructose; support methylation' if alt>20 else 'FM optimal'}",
            PANEL_LIVER)

    if ast is not None:
        flag = "high" if ast > 25 else ("suboptimal" if ast > 20 else "optimal")
        add("AST (liver/muscle)", ast, "U/L",
            "<20 FM optimal (lab: <40)",
            flag,
            f"AST {ast}: {'Elevated — liver or muscle damage; assess with ALT ratio' if ast>25 else 'Borderline' if ast>20 else 'FM optimal'}",
            PANEL_LIVER)

    if ast and alt and alt > 0:
        ast_alt = ast / alt
        flag = "high" if ast_alt > 2.0 else ("optimal" if ast_alt <= 1.2 else "suboptimal")
        add("AST/ALT ratio", ast_alt, "",
            "<1.0 with normal enzymes; >2.0 = alcoholic pattern; <1.0 with both elevated = NAFLD",
            flag,
            f"AST/ALT {round(ast_alt,2)}: {'>2 suggests alcoholic hepatitis; assess alcohol intake' if ast_alt>2 else 'Pattern consistent with NAFLD/NASH — assess metabolic risk' if ast_alt<1 and (ast>20 or alt>20) else 'Normal ratio'}",
            PANEL_LIVER, computed=True)

    if ggt is not None:
        flag = "high" if ggt > 25 else ("suboptimal" if ggt > 16 else "optimal")
        add("GGT (oxidative stress)", ggt, "U/L",
            "<16 FM optimal (highly sensitive to liver fat, alcohol, toxin load)",
            flag,
            f"GGT {ggt}: {'Elevated — oxidative stress, liver fat or alcohol load; check glutathione status' if ggt>25 else 'Borderline elevated — monitor lifestyle factors' if ggt>16 else 'FM optimal — good antioxidant/liver status'}",
            PANEL_LIVER)

    if alp is not None:
        flag = "low" if alp < 40 else ("high" if alp > 100 else "optimal")
        add("ALP (bile/bone)", alp, "U/L",
            "40–100 FM optimal; very low (<40) = zinc deficiency",
            flag,
            f"ALP {alp}: {'Very low — likely zinc deficiency; check zinc and B6' if alp<40 else 'Elevated — bile duct stress, bone turnover or liver issue' if alp>100 else 'FM optimal'}",
            PANEL_LIVER)

    if bilirubin_total is not None:
        flag = "high" if bilirubin_total > 1.2 else ("low" if bilirubin_total < 0.3 else "optimal")
        add("Total bilirubin", bilirubin_total, "mg/dL",
            "0.3–1.2 mg/dL; mild elevation (Gilbert\'s) can be protective",
            flag,
            f"Bilirubin {bilirubin_total}: {'Elevated — assess haemolysis, liver disease, or bile obstruction' if bilirubin_total>1.2 else 'Very low' if bilirubin_total<0.3 else 'Normal; mild elevation may reflect Gilbert\'s syndrome (protective)'}",
            PANEL_LIVER)

    if albumin is not None:
        flag = "low" if albumin < 4.0 else ("optimal" if albumin >= 4.5 else "suboptimal")
        add("Albumin", albumin, "g/dL",
            "≥4.5 FM optimal; <4.0 = liver synthetic decline or protein insufficiency",
            flag,
            f"Albumin {albumin}: {'Low — liver synthetic function declining or protein intake insufficient' if albumin<4.0 else 'FM optimal — good liver synthesis and protein status' if albumin>=4.5 else 'Low-normal — optimise protein intake, assess gut absorption'}",
            PANEL_LIVER)

    if globulin is not None:
        flag = "high" if globulin > 3.5 else ("low" if globulin < 2.0 else "optimal")
        add("Globulin (immune load)", globulin, "g/dL",
            "2.0–3.5 g/dL; elevated = chronic infection/inflammation burden",
            flag,
            f"Globulin {globulin}: {'Elevated — ongoing immune activation, chronic infection or inflammation' if globulin>3.5 else 'Low — possible immune suppression or protein deficiency' if globulin<2.0 else 'Normal immune and protein balance'}",
            PANEL_LIVER)

    if albumin and globulin and globulin > 0:
        ag_ratio = albumin / globulin
        flag = "low" if ag_ratio < 1.5 else "optimal"
        add("Albumin/Globulin ratio", ag_ratio, "",
            ">1.5 optimal; low = inflammation or immune burden dominating",
            flag,
            f"A/G {round(ag_ratio,2)}: {'Low — chronic immune activation or inflammation exceeding liver synthesis' if ag_ratio<1.5 else 'Good balance of liver synthesis to immune protein'}",
            PANEL_LIVER, computed=True)

    # ══════════════════════════════════════════════════════════════════════════
    # 4. KIDNEY FUNCTION
    # ══════════════════════════════════════════════════════════════════════════
    bun = _find(extracted_labs,
        r"\bbun\b|blood urea nitrogen|urea nitrogen|serum urea")
    creatinine = _find(extracted_labs,
        r"\bcreatinine\b|serum creatinine|s-creatinine")
    egfr = _find(extracted_labs,
        r"\begfr\b|glomerular filtration|estimated gfr|gfr\b")

    if bun is not None:
        flag = "high" if bun > 20 else ("low" if bun < 10 else "optimal")
        add("BUN (urea nitrogen)", bun, "mg/dL",
            "10–18 FM optimal; >20 = dehydration/catabolism; <10 = protein deficiency/liver",
            flag,
            f"BUN {bun}: {'Elevated — dehydration, high-protein catabolism, or early kidney stress' if bun>20 else 'Low — possible protein deficiency, poor liver urea synthesis' if bun<10 else 'FM optimal'}",
            PANEL_KIDNEY)

    if creatinine is not None:
        # Use women's range as default (more conservative); could add sex-aware logic later
        flag = "high" if creatinine > 1.1 else ("low" if creatinine < 0.6 else "optimal")
        add("Creatinine", creatinine, "mg/dL",
            "0.6–1.1 FM optimal (varies by muscle mass)",
            flag,
            f"Creatinine {creatinine}: {'Elevated — kidney filtration stress; assess eGFR trend' if creatinine>1.1 else 'Very low — low muscle mass; assess protein intake and muscle health' if creatinine<0.6 else 'Normal range'}",
            PANEL_KIDNEY)

    if bun and creatinine and creatinine > 0:
        bun_cr = bun / creatinine
        flag = "high" if bun_cr > 20 else ("low" if bun_cr < 10 else "optimal")
        add("BUN/Creatinine ratio", bun_cr, "",
            "10–16 optimal; >20 = dehydration/catabolism; <10 = liver issue/malnutrition",
            flag,
            f"BUN/Cr {round(bun_cr,1)}: {'High — likely dehydration or protein catabolism; increase hydration and assess protein balance' if bun_cr>20 else 'Low — possible liver under-function or protein insufficiency' if bun_cr<10 else 'Good kidney-liver balance'}",
            PANEL_KIDNEY, computed=True)

    if egfr is not None:
        flag = "low" if egfr < 60 else ("suboptimal" if egfr < 90 else "optimal")
        add("eGFR", egfr, "mL/min/1.73m²",
            ">90 optimal; 60–89 = mild reduction (watch trend); <60 = moderate decline",
            flag,
            f"eGFR {egfr}: {'Moderate kidney decline — refer; avoid nephrotoxic supplements' if egfr<60 else 'Mild reduction — monitor trend, optimise hydration and blood pressure' if egfr<90 else 'Good filtration capacity'}",
            PANEL_KIDNEY)

    # ══════════════════════════════════════════════════════════════════════════
    # 5. CARDIOVASCULAR & LIPIDS
    # ══════════════════════════════════════════════════════════════════════════
    tc = _find(extracted_labs,
        r"total cholesterol|cholesterol.total|\btotal.chol\b|\bchol\b")
    ldl = _find(extracted_labs,
        r"\bldl\b|ldl.cholesterol|low.density.lipoprotein")
    hdl = _find(extracted_labs,
        r"\bhdl\b|hdl.cholesterol|high.density.lipoprotein")
    tg = _find(extracted_labs,
        r"\btriglyceride|\btg\b|triglycerides\b")
    homocysteine = _find(extracted_labs,
        r"homocysteine|hcy\b|plasma homocysteine")
    hscrp = _find(extracted_labs,
        r"hs.crp|high.sensitivity.crp|hscrp|high sensitivity c.reactive|hs-crp")

    if tc is not None:
        flag = "low" if tc < 160 else ("high" if tc > 240 else "optimal")
        add("Total cholesterol", tc, "mg/dL",
            "160–220 FM optimal; <160 may impair hormone synthesis",
            flag,
            f"TC {tc}: {'Low — may impair steroid hormone, cell membrane and vitamin D synthesis' if tc<160 else 'Elevated — assess particle size, LDL oxidation, inflammation' if tc>240 else 'FM optimal range'}",
            PANEL_CARDIO)

    if ldl is not None:
        flag = "high" if ldl > 130 else ("suboptimal" if ldl > 100 else "optimal")
        add("LDL cholesterol", ldl, "mg/dL",
            "<100 FM optimal; context matters — assess alongside particle size and inflammation",
            flag,
            f"LDL {ldl}: {'Elevated — especially if hsCRP also high (oxidised LDL risk)' if ldl>130 else 'Borderline — optimise lipid quality, not just quantity' if ldl>100 else 'FM optimal; ensure it\'s not artificially low from low cholesterol synthesis'}",
            PANEL_CARDIO)

    if hdl is not None:
        flag = "low" if hdl < 50 else ("optimal" if hdl >= 60 else "suboptimal")
        add("HDL cholesterol", hdl, "mg/dL",
            ">60 FM optimal (protective); <50 women/<40 men = low",
            flag,
            f"HDL {hdl}: {'Low — reduced reverse cholesterol transport; increase exercise, healthy fats, reduce refined carbs' if hdl<50 else 'FM optimal — strong cardioprotective marker' if hdl>=60 else 'Acceptable — room to improve with lifestyle'}",
            PANEL_CARDIO)

    if tg is not None:
        flag = "high" if tg > 150 else ("suboptimal" if tg > 100 else "optimal")
        add("Triglycerides", tg, "mg/dL",
            "<100 FM optimal; <150 lab normal; >150 = metabolic burden",
            flag,
            f"TG {tg}: {'Elevated — IR/carb-driven; reduce sugar, refined carbs, alcohol; address insulin' if tg>150 else 'Borderline — optimise carb quality and timing' if tg>100 else 'FM optimal'}",
            PANEL_CARDIO)

    if tg and hdl and hdl > 0:
        tg_hdl = tg / hdl
        flag = "high" if tg_hdl > 3.5 else ("suboptimal" if tg_hdl > 2.0 else "optimal")
        add("TG/HDL ratio", tg_hdl, "",
            "<2.0 optimal; >3.5 = high IR and CV risk",
            flag,
            f"TG/HDL {round(tg_hdl,2)}: {'High — strong insulin resistance signal; likely small dense LDL' if tg_hdl>3.5 else 'Moderate risk — lifestyle intervention indicated' if tg_hdl>2.0 else 'Good metabolic marker — low IR risk'}",
            PANEL_CARDIO, computed=True)

    if ldl and hdl and hdl > 0:
        ldl_hdl = ldl / hdl
        flag = "high" if ldl_hdl > 3.5 else ("suboptimal" if ldl_hdl > 2.5 else "optimal")
        add("LDL/HDL ratio", ldl_hdl, "",
            "<2.5 optimal; >3.5 elevated risk",
            flag,
            f"LDL/HDL {round(ldl_hdl,2)}: {'Unfavourable — excess LDL relative to reverse transport capacity' if ldl_hdl>3.5 else 'Borderline' if ldl_hdl>2.5 else 'Favourable ratio'}",
            PANEL_CARDIO, computed=True)

    if tc and hdl and hdl > 0:
        tc_hdl = tc / hdl
        flag = "high" if tc_hdl > 5.0 else ("suboptimal" if tc_hdl > 4.0 else "optimal")
        add("TC/HDL ratio", tc_hdl, "",
            "<4.0 optimal; >5.0 = elevated CV risk",
            flag,
            f"TC/HDL {round(tc_hdl,2)}: {'High CV risk — prioritise HDL-raising strategies' if tc_hdl>5 else 'Borderline — room to improve' if tc_hdl>4 else 'Favourable cardiac risk ratio'}",
            PANEL_CARDIO, computed=True)

    if tg and ldl and hdl:
        non_hdl = (tc or ldl + hdl + tg / 5) - hdl  # approximate if TC not available
        if tc:
            non_hdl_val = tc - hdl
            flag = "high" if non_hdl_val > 160 else ("suboptimal" if non_hdl_val > 130 else "optimal")
            add("Non-HDL cholesterol", non_hdl_val, "mg/dL",
                "<130 optimal; better predictor than LDL alone in IR patients",
                flag,
                f"Non-HDL {non_hdl_val}: {'Elevated — better reflects atherogenic lipoprotein burden' if non_hdl_val>160 else 'Borderline' if non_hdl_val>130 else 'FM optimal'}",
                PANEL_CARDIO, computed=True)

    if hscrp is not None:
        flag = "high" if hscrp > 3.0 else ("suboptimal" if hscrp > 1.0 else "optimal")
        add("hsCRP (inflammation)", hscrp, "mg/L",
            "<1.0 optimal; 1.0–3.0 moderate; >3.0 high systemic inflammation",
            flag,
            f"hsCRP {hscrp}: {'Significant systemic inflammation — identify and address root drivers (gut, sleep, infection, stress)' if hscrp>3 else 'Mild-moderate inflammation — anti-inflammatory protocol indicated' if hscrp>1 else 'Low systemic inflammation'}",
            PANEL_CARDIO)

    if homocysteine is not None:
        flag = "high" if homocysteine > 10 else ("suboptimal" if homocysteine > 7 else "optimal")
        add("Homocysteine", homocysteine, "μmol/L",
            "<7 FM optimal; 7–10 suboptimal; >10 elevated methylation burden",
            flag,
            f"Homocysteine {homocysteine}: {'Elevated — methylation burden; assess B12, folate, B6, MTHFR; cardiovascular and cognitive risk' if homocysteine>10 else 'Suboptimal — optimise methylation nutrients (B12, folate, B6, riboflavin)' if homocysteine>7 else 'Optimal methylation status'}",
            PANEL_CARDIO)

    # ══════════════════════════════════════════════════════════════════════════
    # 6. IRON & BLOOD
    # ══════════════════════════════════════════════════════════════════════════
    hemoglobin = _find(extracted_labs,
        r"hemoglobin|haemoglobin|\bhgb\b|\bhb\b|blood haemoglobin")
    ferritin = _find(extracted_labs,
        r"\bferritin\b|serum ferritin")
    iron = _find(extracted_labs,
        r"\biron\b|serum iron|s-iron")
    tibc = _find(extracted_labs,
        r"\btibc\b|total iron binding|iron binding capacity")
    mcv = _find(extracted_labs,
        r"\bmcv\b|mean corpuscular volume|mean cell volume")

    if hemoglobin is not None:
        # Use women's optimal range (most common FM patient base); could be sex-aware
        flag = "low" if hemoglobin < 12.0 else ("optimal" if hemoglobin <= 14.5 else "suboptimal")
        add("Hemoglobin", hemoglobin, "g/dL",
            "12.0–14.5 women; 13.5–16.0 men (FM optimal upper-normal)",
            flag,
            f"Hgb {hemoglobin}: {'Low — anaemia; assess iron, B12, folate; fatigue, brain fog, poor oxygenation' if hemoglobin<12 else 'FM optimal range' if hemoglobin<=14.5 else 'Above typical range — assess haemoconcentration'}",
            PANEL_IRON)

    if ferritin is not None:
        flag = "low" if ferritin < 30 else ("high" if ferritin > 200 else ("optimal" if ferritin >= 50 else "suboptimal"))
        add("Ferritin (iron stores)", ferritin, "ng/mL",
            "50–150 FM optimal; <30 = iron deficiency even if Hgb normal; >200 = inflammation/overload",
            flag,
            f"Ferritin {ferritin}: {'Iron deficiency — supplement; will cause fatigue, hair loss, brain fog before anaemia develops' if ferritin<30 else 'High — inflammatory marker or iron overload; assess hsCRP, haemochromatosis' if ferritin>200 else 'FM optimal' if ferritin>=50 else 'Low-normal — consider supplementation if symptomatic'}",
            PANEL_IRON)

    if iron is not None:
        flag = "low" if iron < 60 else ("high" if iron > 170 else "optimal")
        add("Serum iron", iron, "μg/dL",
            "60–170 μg/dL",
            flag,
            f"Serum iron {iron}: {'Low — iron deficiency; assess ferritin, dietary intake' if iron<60 else 'Elevated — assess ferritin and haemochromatosis risk' if iron>170 else 'Normal range'}",
            PANEL_IRON)

    if iron and tibc and tibc > 0:
        tsat = (iron / tibc) * 100
        flag = "low" if tsat < 20 else ("high" if tsat > 50 else "optimal")
        add("Transferrin saturation", tsat, "%",
            "20–50%",
            flag,
            f"Transferrin sat {round(tsat,1)}%: {'Low — iron deficiency pattern' if tsat<20 else 'High — iron overload risk; assess haemochromatosis' if tsat>50 else 'Normal iron transport'}",
            PANEL_IRON, computed=True)

    if mcv is not None:
        flag = "low" if mcv < 80 else ("high" if mcv > 95 else "optimal")
        add("MCV (cell size)", mcv, "fL",
            "82–90 fL; <80 = microcytosis (iron deficiency); >95 = macrocytosis (B12/folate)",
            flag,
            f"MCV {mcv}: {'Microcytic — iron deficiency anaemia most likely; assess ferritin, serum iron' if mcv<80 else 'Macrocytic — B12 or folate deficiency; assess methylation, absorption' if mcv>95 else 'Normal red cell size'}",
            PANEL_IRON)

    # ══════════════════════════════════════════════════════════════════════════
    # 7. KEY NUTRIENTS
    # ══════════════════════════════════════════════════════════════════════════
    vitd = _find(extracted_labs,
        r"vitamin d|25.oh|25-oh|calcidiol|25-hydroxyvitamin")
    b12 = _find(extracted_labs,
        r"vitamin b12|b-12\b|b12\b|cobalamin|cyanocobalamin")
    folate = _find(extracted_labs,
        r"\bfolate\b|folic acid|serum folate|rbc folate")
    magnesium = _find(extracted_labs,
        r"\bmagnesium\b|serum magnesium|rbc magnesium|mg\b")
    zinc = _find(extracted_labs,
        r"\bzinc\b|serum zinc|plasma zinc")

    if vitd is not None:
        flag = "low" if vitd < 40 else ("optimal" if vitd >= 60 else "suboptimal")
        add("25-OH Vitamin D", vitd, "ng/mL",
            "60–80 FM optimal (lab: 30–100; deficient <20)",
            flag,
            f"Vit D {vitd}: {'Deficient — supplement urgently; impacts immunity, mood, thyroid, insulin sensitivity' if vitd<20 else 'Insufficient — supplementation needed' if vitd<40 else 'Sub-optimal — titrate to 60–80' if vitd<60 else 'FM optimal'}",
            PANEL_NUTRIENTS)

    if b12 is not None:
        flag = "low" if b12 < 400 else ("optimal" if b12 >= 600 else "suboptimal")
        add("Vitamin B12", b12, "pg/mL",
            "400–900 FM optimal (lab range 200–900 misses functional deficiency)",
            flag,
            f"B12 {b12}: {'Functionally deficient — neurological, methylation and energy impact; consider active B12 (MMA test)' if b12<400 else 'FM optimal' if b12>=600 else 'Low-normal — may be functionally deficient; assess MMA and homocysteine'}",
            PANEL_NUTRIENTS)

    if folate is not None:
        flag = "low" if folate < 15 else ("optimal" if folate >= 20 else "suboptimal")
        add("Folate", folate, "nmol/L",
            ">20 FM optimal; <15 = methylation/DNA synthesis risk",
            flag,
            f"Folate {folate}: {'Low — methylation burden, neural tube risk, elevated homocysteine; increase leafy greens and consider methylfolate' if folate<15 else 'FM optimal' if folate>=20 else 'Sub-optimal — optimise with food and/or methylfolate'}",
            PANEL_NUTRIENTS)

    if magnesium is not None:
        # Serum magnesium is a poor marker (only 1% extracellular) but is what most labs report
        flag = "low" if magnesium < 2.0 else ("optimal" if magnesium >= 2.2 else "suboptimal")
        add("Magnesium (serum)", magnesium, "mg/dL",
            "2.0–2.5 FM optimal; note: serum is poor marker — RBC Mg preferred",
            flag,
            f"Mg {magnesium}: {'Low serum — likely significant intracellular deficiency; impacts 300+ enzyme systems, sleep, stress, glucose' if magnesium<2.0 else 'FM optimal (serum); consider RBC Mg for true cellular status' if magnesium>=2.2 else 'Low-normal — supplementation often beneficial'}",
            PANEL_NUTRIENTS)

    if zinc is not None:
        flag = "low" if zinc < 80 else ("optimal" if zinc <= 130 else "suboptimal")
        add("Zinc", zinc, "μg/dL",
            "80–130 μg/dL FM optimal; low = immune, thyroid, taste/smell issues",
            flag,
            f"Zinc {zinc}: {'Low — immune suppression, poor wound healing, thyroid conversion impaired; supplement + assess phytate load in diet' if zinc<80 else 'FM optimal' if zinc<=130 else 'High — very unusual; assess supplementation dose'}",
            PANEL_NUTRIENTS)

    return results
