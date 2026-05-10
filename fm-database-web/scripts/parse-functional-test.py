#!/usr/bin/env python3
"""Parse a functional-medicine specialty test PDF into structured findings.

Currently handles:
  - DUTCH (Dried Urine Test for Comprehensive Hormones, Precision Analytical)
  - GI-Map (Diagnostic Solutions GI-MAP stool PCR)

Pipeline:
  1. Read input JSON: { file_path, client_id, dry_run? }
  2. Load PDF as Anthropic document attachment
  3. Detect test type via small Sonnet preflight (keyword + section scan)
  4. Route to test-specific extractor with tool-use schema
  5. Persist findings to ~/fm-plans/clients/<id>/functional_tests/<type>-<date>.yaml
  6. Return JSON: { ok, test_type, summary, findings, flagged_drivers, file_path, error }

Cost: ~$0.30-0.60 per test (Sonnet, ~10K input + 4K output, document attachment).
Designed to fail gracefully — returns ok:false with diagnostic error rather than
crashing the upload pipeline.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import yaml
from datetime import date
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))

PLANS_ROOT = Path(os.environ.get("FMDB_PLANS_DIR", str(Path.home() / "fm-plans")))


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv  # type: ignore
        load_dotenv(FMDB_ROOT / ".env", override=True)
    except Exception:
        envp = FMDB_ROOT / ".env"
        if envp.exists():
            for line in envp.read_text().splitlines():
                line = line.strip()
                if line.startswith("export "):
                    line = line[len("export "):]
                if "=" in line and not line.startswith("#"):
                    k, _, v = line.partition("=")
                    os.environ[k.strip()] = v.strip().strip('"').strip("'")


# ── Test-type detection ──────────────────────────────────────────────────────

DUTCH_KEYWORDS = [
    "dried urine test for comprehensive hormones",
    "dutch complete",
    "dutch plus",
    "precision analytical",
    "estrone (e1)",
    "2-oh-e1",
    "4-oh-e1",
    "16-oh-e1",
    "α-pregnanediol",
    "alpha-pregnanediol",
    "metabolized cortisol",
    "free cortisone",
    "free cortisol pattern",
]
GIMAP_KEYWORDS = [
    "gi-map",
    "gi map",
    "diagnostic solutions",
    "h. pylori",
    "h pylori virulence",
    "secretory iga",
    "calprotectin",
    "beta-glucuronidase",
    "elastase-1",
    "anti-gliadin",
    "akkermansia muciniphila",
    "faecalibacterium",
    "zonulin",
]


def _detect_test_type(text: str) -> str:
    """Quick keyword scan to detect test type. Returns 'dutch', 'gi_map',
    or 'unknown'. Used as a cheap preflight before the expensive extractor.
    """
    t = (text or "").lower()
    dutch_hits = sum(1 for kw in DUTCH_KEYWORDS if kw in t)
    gimap_hits = sum(1 for kw in GIMAP_KEYWORDS if kw in t)
    if dutch_hits >= 2 and dutch_hits > gimap_hits:
        return "dutch"
    if gimap_hits >= 2 and gimap_hits > dutch_hits:
        return "gi_map"
    return "unknown"


# ── Tool schemas (per test type) ─────────────────────────────────────────────

DUTCH_TOOL = {
    "name": "report_dutch",
    "description": "Extract structured findings from a DUTCH (Precision Analytical) urine hormone test.",
    "input_schema": {
        "type": "object",
        "required": ["test_date", "summary", "flagged_drivers"],
        "properties": {
            "test_date": {"type": "string", "description": "Test collection date (YYYY-MM-DD if visible, else empty)."},
            "summary": {"type": "string", "description": "2-4 sentence FM-eye summary of the most clinically relevant findings for this client. Reference specific values (e.g. 'AM cortisol 4.2 — flat curve indicates HPA exhaustion')."},
            "cortisol_pattern": {
                "type": "object",
                "description": "4-point free cortisol diurnal curve.",
                "properties": {
                    "waking_ng_mg": {"type": "number"},
                    "morning_ng_mg": {"type": "number"},
                    "afternoon_ng_mg": {"type": "number"},
                    "bedtime_ng_mg": {"type": "number"},
                    "pattern": {"type": "string", "description": "flat | inverted | high_AM | low_AM | normal"},
                    "flag": {"type": "string", "description": "ok | borderline | abnormal"},
                },
            },
            "metabolized_cortisol": {
                "type": "object",
                "properties": {
                    "total_cortisol": {"type": "number"},
                    "total_cortisone": {"type": "number"},
                    "cortisol_to_cortisone_ratio": {"type": "number"},
                    "interpretation": {"type": "string", "description": "Notes on metabolism (HSD11β1/2 balance, weight regulation context)."},
                },
            },
            "sex_hormones": {
                "type": "object",
                "properties": {
                    "estradiol_e2": {"type": "string"},
                    "estrone_e1": {"type": "string"},
                    "estriol_e3": {"type": "string"},
                    "progesterone_metabolites": {"type": "string", "description": "α-pregnanediol + β-pregnanediol values + interpretation."},
                    "testosterone": {"type": "string"},
                    "dhea_s": {"type": "string"},
                    "cycle_phase_at_collection": {"type": "string", "description": "Day of cycle / luteal / postmenopausal"},
                    "interpretation": {"type": "string"},
                },
            },
            "estrogen_metabolism": {
                "type": "object",
                "description": "Phase I + II estrogen metabolism markers — clinically critical for breast / endometrial / liver context.",
                "properties": {
                    "two_oh_e1": {"type": "number", "description": "2-OH estrone (protective)"},
                    "four_oh_e1": {"type": "number", "description": "4-OH estrone (mutagenic — cancer risk)"},
                    "sixteen_oh_e1": {"type": "number", "description": "16-OH estrone (proliferative)"},
                    "two_to_sixteen_ratio": {"type": "number"},
                    "two_methoxy_e1": {"type": "number", "description": "2-methoxy E1 — Phase II methylation product"},
                    "methylation_ratio": {"type": "number", "description": "2-methoxy / 2-OH ratio (proxy for COMT activity)"},
                    "interpretation": {"type": "string"},
                },
            },
            "methylation_markers": {
                "type": "object",
                "properties": {
                    "homocysteine": {"type": "string"},
                    "methylhistamine": {"type": "string"},
                    "interpretation": {"type": "string"},
                },
            },
            "melatonin_6_sulfatoxymelatonin": {
                "type": "string",
                "description": "Melatonin metabolite — proxy for sleep + circadian function.",
            },
            "flagged_drivers": {
                "type": "array",
                "description": "FM mechanism slugs from the catalogue this test most strongly implicates as drivers. E.g. ['hpa-axis-dysregulation', 'estrogen-dominance', 'comt-slow', 'leaky-gut']. Be conservative — only list mechanisms with clear test evidence.",
                "items": {"type": "string"},
            },
            "clinical_recommendations": {
                "type": "array",
                "description": "Top 3-5 FM-tier recommendations the coach should consider given these findings (e.g. 'Phase II methylation support — riboflavin + methylated B-complex', 'Cruciferous vegetables daily — DIM 100mg/day', 'Saliva CAR test to confirm flat cortisol curve').",
                "items": {"type": "string"},
            },
        },
    },
}

GIMAP_TOOL = {
    "name": "report_gimap",
    "description": "Extract structured findings from a GI-MAP (Diagnostic Solutions) stool PCR test.",
    "input_schema": {
        "type": "object",
        "required": ["test_date", "summary", "flagged_drivers"],
        "properties": {
            "test_date": {"type": "string"},
            "summary": {"type": "string", "description": "2-4 sentence FM-eye summary. Reference specific positive findings (e.g. 'H. pylori positive with virulence factors CagA + VacA — eradication priority before any other gut work')."},
            "h_pylori": {
                "type": "object",
                "properties": {
                    "detected": {"type": "boolean"},
                    "level": {"type": "string"},
                    "virulence_factors_positive": {"type": "array", "items": {"type": "string"}, "description": "e.g. ['CagA', 'VacA', 'BabA'] — indicates more invasive strain"},
                    "interpretation": {"type": "string"},
                },
            },
            "pathogens_detected": {
                "type": "array",
                "description": "Bacterial / viral / parasitic / fungal pathogens detected at positive levels.",
                "items": {
                    "type": "object",
                    "properties": {
                        "organism": {"type": "string"},
                        "category": {"type": "string", "description": "bacterial | parasitic | viral | fungal"},
                        "level": {"type": "string"},
                        "clinical_significance": {"type": "string"},
                    },
                },
            },
            "opportunistic_overgrowth": {
                "type": "array",
                "description": "Opportunistic bacteria above reference range (Pseudomonas, Klebsiella, Citrobacter, Streptococcus, Methanobacteriaceae [archaea — methane SIBO marker], etc.)",
                "items": {
                    "type": "object",
                    "properties": {
                        "organism": {"type": "string"},
                        "level": {"type": "string"},
                        "interpretation": {"type": "string"},
                    },
                },
            },
            "commensal_dysbiosis": {
                "type": "object",
                "description": "Beneficial flora levels — Lactobacillus, Bifidobacterium, Akkermansia muciniphila, Faecalibacterium prausnitzii, Roseburia.",
                "properties": {
                    "low_or_absent": {"type": "array", "items": {"type": "string"}},
                    "high": {"type": "array", "items": {"type": "string"}},
                    "interpretation": {"type": "string"},
                },
            },
            "health_markers": {
                "type": "object",
                "description": "Inflammation + immune + digestion markers.",
                "properties": {
                    "secretory_iga": {"type": "string", "description": "Mucosal immune marker — high = active immune response, low = depleted / chronic stress"},
                    "calprotectin": {"type": "string", "description": "Neutrophil marker — elevated = active mucosal inflammation"},
                    "occult_blood": {"type": "string"},
                    "anti_gliadin_iga": {"type": "string", "description": "Mucosal gluten reactivity"},
                    "elastase_1": {"type": "string", "description": "Pancreatic enzyme — low = exocrine pancreatic insufficiency"},
                    "beta_glucuronidase": {"type": "string", "description": "High = increased estrogen recirculation + slow detox"},
                    "steatocrit": {"type": "string", "description": "Fat malabsorption marker"},
                    "interpretation": {"type": "string"},
                },
            },
            "flagged_drivers": {
                "type": "array",
                "description": "FM mechanism slugs from the catalogue most strongly implicated. E.g. ['h-pylori-infection', 'leaky-gut', 'sibo-methane', 'dysbiosis', 'mucosal-inflammation']. Be conservative.",
                "items": {"type": "string"},
            },
            "clinical_recommendations": {
                "type": "array",
                "description": "Top 3-5 FM-tier recommendations. E.g. 'H. pylori eradication first — refer for triple/quadruple therapy + add mastic gum, Matula tea', 'Defer 5R protocol until pathogens cleared', 'Saccharomyces boulardii 10B CFU 2x/day during + 4w after antibiotic course'.",
                "items": {"type": "string"},
            },
        },
    },
}

DUTCH_SYSTEM = """You are a Functional Medicine clinician analysing a DUTCH urine hormone test.
Extract findings into the report_dutch tool with the following clinical lens:

CORTISOL — flat or inverted patterns indicate HPA dysregulation. Total cortisol
+ cortisone matters more than free alone (HSD11β balance, weight context).
Free CAR (cortisol awakening response) requires the saliva CAR test — flag for
follow-up when curve is flat.

ESTROGEN METABOLISM — 2-OH:16-OH ratio matters more than absolute estradiol.
4-OH dominance = mutagenic risk (cervical, breast). 2-methoxy/2-OH ratio is
the proxy for Phase II methylation (COMT activity). Low methylation = high
breast / mood / anxiety risk.

METHYLATION — homocysteine + methylhistamine give methylation snapshot.
HIGH histamine = poor mast cell control / methylation / B6 status.

SEX HORMONES — interpret in context of cycle phase (menstruating women) or
postmenopausal status. Progesterone metabolites (α-pregnanediol vs β-) are
more reliable than serum progesterone.

Be honest. If a value is not visible / not extracted, leave the field empty
rather than fabricate. Use catalogue mechanism slugs in flagged_drivers
(common: hpa-axis-dysregulation, estrogen-dominance, leaky-gut, comt-slow,
methylation-impairment, mtor-pathway-overactive).
"""

GIMAP_SYSTEM = """You are a Functional Medicine clinician analysing a GI-MAP stool PCR test.
Extract findings into the report_gimap tool with the following clinical lens:

H. PYLORI — virulence factor matters. Positive H. pylori with CagA / VacA /
BabA = more invasive, higher gastric cancer + ulcer risk; eradication is a
priority before any other gut work. Without virulence factors, the call is
nuanced — context (symptoms, family history) matters.

PATHOGENS — list any positive bacterial (C. difficile, Yersinia, Vibrio, etc.)
parasitic (Giardia, Cryptosporidium, Entamoeba, Blastocystis), fungal
(Candida, Geotrichum), viral (CMV, EBV in stool).

OPPORTUNISTIC OVERGROWTH — Pseudomonas, Klebsiella, Citrobacter, Streptococcus
elevation indicates dysbiosis. Methanobacteriaceae high = methane-SIBO marker
(constipation pattern). Desulfovibrio high = hydrogen sulfide gas / leaky gut.

DYSBIOSIS — low Akkermansia + low Faecalibacterium = mucin layer + butyrate
deficit. High Lactobacillus alone is not protective if commensals depleted.

HEALTH MARKERS — sIgA high = active immune response; low = depleted / stress;
calprotectin > 50 = active inflammation; β-glucuronidase high = slow estrogen
clearance + reabsorption (cancer risk); elastase-1 < 200 = pancreatic
insufficiency; anti-gliadin IgA elevated = mucosal gluten reactivity.

CRITICAL — if pathogens or H. pylori positive, recommend addressing those
FIRST before any 5R / elimination diet protocol — gut healing happens AROUND
the infection, not despite it.

Be honest. Use catalogue mechanism slugs in flagged_drivers.
"""


# ── Extraction pipeline ──────────────────────────────────────────────────────

def _read_pdf(path: Path) -> tuple[bytes, str]:
    """Return (raw_bytes, extracted_text). Text used for cheap test-type
    detection; bytes attached to Anthropic call for the actual extraction.
    """
    raw = path.read_bytes()
    # Try a fast text extraction for the keyword scan (best-effort).
    text = ""
    try:
        import pdfplumber  # type: ignore
        with pdfplumber.open(str(path)) as pdf:
            text = "\n".join((p.extract_text() or "") for p in pdf.pages[:8])
    except Exception:
        try:
            from pypdf import PdfReader  # type: ignore
            r = PdfReader(str(path))
            text = "\n".join((p.extract_text() or "") for p in r.pages[:8])
        except Exception:
            text = ""
    return raw, text


def _save_findings(client_id: str, test_type: str, payload: dict) -> Path:
    out_dir = PLANS_ROOT / "clients" / client_id / "functional_tests"
    out_dir.mkdir(parents=True, exist_ok=True)
    test_date = (payload.get("test_date") or "").strip() or date.today().isoformat()
    stem = f"{test_type}-{test_date}"
    # If duplicate name already exists, append a counter
    out_path = out_dir / f"{stem}.yaml"
    n = 1
    while out_path.exists():
        out_path = out_dir / f"{stem}-{n}.yaml"
        n += 1
    out_path.write_text(yaml.safe_dump(payload, sort_keys=False, allow_unicode=True))
    return out_path


def main() -> int:
    _load_dotenv()
    raw_in = sys.stdin.read()
    try:
        payload = json.loads(raw_in) if raw_in.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    file_path = Path(payload.get("file_path", "")).expanduser()
    client_id = (payload.get("client_id") or "").strip()
    dry_run = bool(payload.get("dry_run"))
    forced_type = (payload.get("test_type") or "").strip().lower()

    if not file_path.exists():
        json.dump({"ok": False, "error": f"file not found: {file_path}"}, sys.stdout)
        return 2
    if not client_id:
        json.dump({"ok": False, "error": "client_id is required"}, sys.stdout)
        return 2

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key and not dry_run:
        json.dump({"ok": False, "error": "ANTHROPIC_API_KEY not set"}, sys.stdout)
        return 1

    try:
        raw_pdf, text = _read_pdf(file_path)
    except Exception as e:
        json.dump({"ok": False, "error": f"could not read PDF: {e}"}, sys.stdout)
        return 1

    test_type = forced_type if forced_type in ("dutch", "gi_map") else _detect_test_type(text)
    if test_type == "unknown":
        json.dump({
            "ok": False,
            "test_type": "unknown",
            "error": "Could not identify test type. Currently supported: DUTCH, GI-MAP. Pass `test_type` explicitly to force.",
        }, sys.stdout)
        return 0

    if dry_run:
        json.dump({
            "ok": True,
            "test_type": test_type,
            "summary": f"[dry-run] would extract {test_type.upper()} findings",
            "findings": {},
            "flagged_drivers": [],
            "clinical_recommendations": [],
            "file_path": "",
        }, sys.stdout)
        return 0

    try:
        from anthropic import Anthropic
    except ImportError as e:
        json.dump({"ok": False, "error": f"anthropic not installed: {e}"}, sys.stdout)
        return 1

    if test_type == "dutch":
        tool = DUTCH_TOOL
        system = DUTCH_SYSTEM
        tool_name = "report_dutch"
    else:
        tool = GIMAP_TOOL
        system = GIMAP_SYSTEM
        tool_name = "report_gimap"

    user_content = [
        {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": base64.standard_b64encode(raw_pdf).decode("ascii"),
            },
        },
        {"type": "text", "text": f"Extract structured findings from this {test_type.upper()} report. Use the {tool_name} tool. Be honest — leave fields empty rather than fabricate."},
    ]

    client_api = Anthropic(api_key=api_key)
    try:
        with client_api.messages.stream(
            model=os.environ.get("FMDB_FUNCTIONAL_TEST_MODEL", "claude-sonnet-4-6"),
            max_tokens=8000,
            system=system,
            tools=[tool],
            tool_choice={"type": "tool", "name": tool_name},
            messages=[{"role": "user", "content": user_content}],
        ) as stream:
            resp = stream.get_final_message()
    except Exception as e:
        json.dump({"ok": False, "test_type": test_type, "error": f"API call failed: {e}"}, sys.stdout)
        return 1

    tool_use = next((b for b in resp.content if getattr(b, "type", None) == "tool_use"), None)
    if not tool_use:
        json.dump({"ok": False, "test_type": test_type, "error": "no tool_use in response"}, sys.stdout)
        return 1

    findings = tool_use.input or {}

    # Persist
    record = {
        "test_type": test_type,
        "client_id": client_id,
        "extracted_at": date.today().isoformat(),
        "source_file": file_path.name,
        **findings,
    }
    out_path = _save_findings(client_id, test_type, record)

    json.dump({
        "ok": True,
        "test_type": test_type,
        "summary": findings.get("summary", ""),
        "findings": findings,
        "flagged_drivers": findings.get("flagged_drivers") or [],
        "clinical_recommendations": findings.get("clinical_recommendations") or [],
        "file_path": str(out_path),
        "error": None,
    }, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
