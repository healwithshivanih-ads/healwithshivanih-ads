#!/usr/bin/env python3
"""Extract structured clinical data from external reports.

Supported report types:
  gi_stool_test   — GI-MAP, Genova GI Effects, Doctor's Data CSA, Viome
  dutch_test      — DUTCH complete hormone panel
  dexa_scan       — Bone density + body composition
  genetic_test    — MTHFR, 23andMe summary, nutrigenomic panels
  food_sensitivity — IgG/IgE food panels (ALCAT, US BioTek, etc.)
  organic_acids   — OAT (Great Plains, Genova Organix)
  imaging         — MRI/CT/X-ray/ultrasound radiology report
  other           — Catch-all

Reads JSON from stdin:
{
  "file_path": str,       # absolute path to saved file
  "report_type": str,
  "file_name": str,
  "client_id": str
}

Writes JSON to stdout:
{
  "ok": bool,
  "extracted": dict,
  "date_of_report": str | null,
  "lab_name": str | null,
  "key_findings": [str],
  "summary": str,
  "error": str | null
}

Cost notes:
  - Uses claude-haiku-4-5 (~$0.25/MTok in, $1.25/MTok out)
  - Typical report: 5–30 pages ≈ 10–50K tokens ≈ $0.003–0.015
  - Raw genetic txt files: only first 6 KB of key sections sent
  - Images: sent as image blocks (same price tier)
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))
HAIKU = "claude-haiku-4-5"
MAX_FILE_BYTES = 30 * 1024 * 1024   # 30 MB hard limit
RAW_GENETIC_THRESHOLD = 400 * 1024  # .txt/.csv > 400 KB → treat as raw SNP data

# ── Per-type extraction prompts ───────────────────────────────────────────────

PROMPTS: dict[str, str] = {
    "gi_stool_test": """
Extract from this GI stool analysis report. Return ONLY valid JSON — no markdown.
{
  "lab_name": null or "GI-MAP" or "Genova GI Effects" or "Doctor's Data" etc,
  "date_of_report": null or "YYYY-MM-DD",
  "pathogens": {
    "h_pylori": {"present": true/false, "level": null or "high/moderate/low", "virulence_genes": null or true/false},
    "c_diff": {"present": true/false},
    "e_coli": {"present": true/false, "level": null or str},
    "other_pathogens": [{"name": str, "level": str}]
  },
  "parasites": [{"name": str, "level": str}],
  "bacteria_balance": {
    "overall_impression": null or "imbalanced/diverse/depleted",
    "notable_imbalances": [{"organism": str, "level": "high/low", "clinical_note": str}]
  },
  "inflammation": {
    "calprotectin": {"value": null or str, "unit": null or str, "flag": null or "H/N/L"},
    "lactoferrin": {"value": null or str, "flag": null or "H/N/L"},
    "lysozyme": {"value": null or str, "flag": null or "H/N/L"}
  },
  "intestinal_permeability": {
    "zonulin": {"value": null or str, "flag": null or "H/N/L"},
    "occludin_zonulin_iga": {"value": null or str, "flag": null or "H/N/L"}
  },
  "digestive_function": {
    "pancreatic_elastase": {"value": null or str, "unit": null or str, "flag": null or "H/N/L"},
    "secretory_iga": {"value": null or str, "flag": null or "H/N/L"},
    "total_short_chain_fatty_acids": {"value": null or str, "flag": null or "H/N/L"},
    "steatocrit": {"value": null or str, "flag": null or "H/N/L"}
  },
  "beneficial_bacteria": [{"organism": str, "level": str, "flag": null or "H/N/L"}],
  "key_findings": ["max 5 bullet-point strings of the most abnormal findings"],
  "summary": "2-3 sentences: key issues found and clinical significance"
}
""",

    "dutch_test": """
Extract from this DUTCH hormone panel report. Return ONLY valid JSON — no markdown.
{
  "lab_name": "DUTCH",
  "date_of_report": null or "YYYY-MM-DD",
  "cortisol_pattern": {
    "morning_car": {"value": null or str, "flag": null or "H/N/L", "note": null or str},
    "waking": {"value": null or str, "flag": null or "H/N/L"},
    "midday": {"value": null or str, "flag": null or "H/N/L"},
    "afternoon": {"value": null or str, "flag": null or "H/N/L"},
    "night": {"value": null or str, "flag": null or "H/N/L"},
    "overall_pattern": null or "normal/flat/high/low/inverted"
  },
  "cortisol_metabolites": {
    "a_thf_plus_thf": {"value": null or str, "flag": null or "H/N/L"},
    "the": {"value": null or str, "flag": null or "H/N/L"},
    "total_cortisol_metabolites": {"value": null or str, "flag": null or "H/N/L"}
  },
  "dhea": {
    "dhea_s": {"value": null or str, "flag": null or "H/N/L"},
    "androsterone": {"value": null or str, "flag": null or "H/N/L"}
  },
  "estrogen": {
    "e1": {"value": null or str, "flag": null or "H/N/L"},
    "e2": {"value": null or str, "flag": null or "H/N/L"},
    "e3": {"value": null or str, "flag": null or "H/N/L"},
    "e1_metabolites": {
      "2_oh_e1": {"value": null or str, "flag": null or "H/N/L"},
      "4_oh_e1": {"value": null or str, "flag": null or "H/N/L"},
      "16_oh_e1": {"value": null or str, "flag": null or "H/N/L"}
    },
    "methylation_ratio_2_meo_to_2oh": {"value": null or str, "flag": null or "H/N/L"}
  },
  "progesterone": {
    "pregnanediol": {"value": null or str, "flag": null or "H/N/L"}
  },
  "testosterone": {
    "value": null or str,
    "flag": null or "H/N/L",
    "androstanediol": {"value": null or str, "flag": null or "H/N/L"}
  },
  "melatonin": {
    "value": null or str,
    "flag": null or "H/N/L"
  },
  "neurotransmitter_metabolites": {
    "dopamine_hva": {"value": null or str, "flag": null or "H/N/L"},
    "norepinephrine_vma": {"value": null or str, "flag": null or "H/N/L"},
    "serotonin_5hiaa": {"value": null or str, "flag": null or "H/N/L"}
  },
  "oxidative_stress": {
    "8_ohdg": {"value": null or str, "flag": null or "H/N/L"}
  },
  "key_findings": ["max 5 bullet-point strings of the most significant findings"],
  "summary": "2-3 sentences: overall hormone picture and key imbalances"
}
""",

    "dexa_scan": """
Extract from this DEXA (DXA) bone density and/or body composition scan report. Return ONLY valid JSON — no markdown.
{
  "lab_name": null or str,
  "date_of_report": null or "YYYY-MM-DD",
  "bone_density": {
    "lumbar_spine": {
      "bmd": null or str,
      "t_score": null or float,
      "z_score": null or float,
      "classification": null or "normal/osteopenia/osteoporosis"
    },
    "femoral_neck": {
      "bmd": null or str,
      "t_score": null or float,
      "z_score": null or float,
      "classification": null or "normal/osteopenia/osteoporosis"
    },
    "total_hip": {
      "bmd": null or str,
      "t_score": null or float,
      "z_score": null or float,
      "classification": null or "normal/osteopenia/osteoporosis"
    },
    "forearm": {
      "t_score": null or float,
      "z_score": null or float
    },
    "overall_classification": null or "normal/osteopenia/osteoporosis"
  },
  "body_composition": {
    "total_weight_kg": null or float,
    "lean_mass_kg": null or float,
    "lean_mass_pct": null or float,
    "fat_mass_kg": null or float,
    "fat_mass_pct": null or float,
    "visceral_fat_area_cm2": null or float,
    "android_gynoid_ratio": null or float,
    "bone_mineral_content_kg": null or float
  },
  "fracture_risk": null or str,
  "radiologist_conclusion": null or str,
  "key_findings": ["max 4 bullet-point strings"],
  "summary": "2-3 sentences: bone health status and body composition highlights"
}
""",

    "genetic_test": """
Extract from this genetic / nutrigenomic report. Return ONLY valid JSON — no markdown.
Focus on actionable FM-relevant variants only — skip raw SNP tables and ancestry data.
{
  "lab_name": null or str,
  "date_of_report": null or "YYYY-MM-DD",
  "methylation": {
    "mthfr_c677t": {"genotype": null or str, "impact": null or "normal/reduced/significantly_reduced"},
    "mthfr_a1298c": {"genotype": null or str, "impact": null or "normal/reduced/significantly_reduced"},
    "comt": {"genotype": null or str, "impact": null or str},
    "mtr_a2756g": {"genotype": null or str, "impact": null or str},
    "mtrr_a66g": {"genotype": null or str, "impact": null or str}
  },
  "detoxification": {
    "cyp1a1": {"genotype": null or str, "impact": null or str},
    "cyp1b1": {"genotype": null or str, "impact": null or str},
    "gstp1": {"genotype": null or str, "impact": null or str},
    "nat2": {"genotype": null or str, "impact": null or str}
  },
  "cardiovascular": {
    "apoe": {"genotype": null or str, "impact": null or str},
    "factor_v_leiden": {"genotype": null or str, "impact": null or str}
  },
  "hormones_nutrients": {
    "vdr": {"genotype": null or str, "impact": null or str},
    "maoa": {"genotype": null or str, "impact": null or str},
    "fto_obesity": {"genotype": null or str, "impact": null or str}
  },
  "key_actionable_variants": ["list of variants with significant impact — max 6"],
  "dietary_implications": ["list of dietary recommendations from report — max 5"],
  "key_findings": ["max 5 bullet-point strings"],
  "summary": "2-3 sentences: most important genetic variants and their clinical relevance"
}
""",

    "food_sensitivity": """
Extract from this food sensitivity / intolerance test report. Return ONLY valid JSON — no markdown.
{
  "lab_name": null or str,
  "test_type": null or "IgG/IgE/ALCAT/MRT/other",
  "date_of_report": null or "YYYY-MM-DD",
  "reactive_foods": {
    "severe_high": [str],
    "moderate": [str],
    "mild_borderline": [str]
  },
  "food_groups_affected": [str],
  "total_reactive_count": null or int,
  "total_foods_tested": null or int,
  "candida_yeast_reaction": null or bool,
  "notable_patterns": null or str,
  "key_findings": ["max 5 bullet-point strings — highlight most reactive foods and patterns"],
  "summary": "2-3 sentences: scope of reactivity and most significant foods to avoid"
}
""",

    "organic_acids": """
Extract from this Organic Acids Test (OAT) report. Return ONLY valid JSON — no markdown.
{
  "lab_name": null or str,
  "date_of_report": null or "YYYY-MM-DD",
  "yeast_fungal": {
    "overall_elevation": null or "normal/mild/moderate/significant",
    "notable_markers": [{"marker": str, "value": str, "flag": "H/N/L"}]
  },
  "bacterial_dysbiosis": {
    "overall_elevation": null or "normal/mild/moderate/significant",
    "notable_markers": [{"marker": str, "value": str, "flag": "H/N/L"}]
  },
  "mitochondrial_function": {
    "overall": null or "normal/impaired",
    "krebs_cycle": {"impaired": null or bool},
    "fatty_acid_oxidation": {"impaired": null or bool},
    "notable_markers": [{"marker": str, "value": str, "flag": "H/N/L"}]
  },
  "neurotransmitter_metabolism": {
    "dopamine_serotonin_balance": null or str,
    "notable_markers": [{"marker": str, "value": str, "flag": "H/N/L"}]
  },
  "nutritional_status": {
    "b_vitamins": {"status": null or "adequate/low", "notable": [str]},
    "antioxidants": {"status": null or "adequate/low", "notable": [str]},
    "minerals": {"notable": [str]}
  },
  "oxidative_stress": {
    "overall": null or "low/moderate/high",
    "key_marker": null or str
  },
  "key_findings": ["max 5 bullet-point strings"],
  "summary": "2-3 sentences: major metabolic patterns and priority areas"
}
""",

    "imaging": """
Extract from this radiology / imaging report. Return ONLY valid JSON — no markdown.
Focus on the radiologist's findings and clinical impressions only — skip technical scan parameters.
{
  "lab_name": null or str,
  "imaging_type": null or "MRI/CT/X-ray/Ultrasound/DEXA/Mammogram/other",
  "body_region": null or str,
  "date_of_report": null or "YYYY-MM-DD",
  "ordering_clinician": null or str,
  "findings": {
    "primary_findings": [str],
    "incidental_findings": [str],
    "normal_structures": null or str
  },
  "impression": null or str,
  "recommendations": [str],
  "key_findings": ["max 4 bullet-point strings of the most significant findings"],
  "summary": "2-3 sentences: main clinical findings and their significance"
}
""",

    "other": """
Extract the key clinical information from this medical/functional report. Return ONLY valid JSON — no markdown.
{
  "report_type_detected": null or str,
  "lab_name": null or str,
  "date_of_report": null or "YYYY-MM-DD",
  "test_parameters": [{"name": str, "value": str, "unit": null or str, "flag": null or "H/N/L/normal/abnormal"}],
  "abnormal_findings": [{"parameter": str, "finding": str, "clinical_significance": null or str}],
  "key_findings": ["max 5 bullet-point strings"],
  "summary": "2-3 sentences: key clinical information from this report"
}
""",
}

DISPLAY_NAMES = {
    "gi_stool_test": "GI Stool Analysis",
    "dutch_test": "DUTCH Hormone Panel",
    "dexa_scan": "DEXA Scan",
    "genetic_test": "Genetic / Nutrigenomic Test",
    "food_sensitivity": "Food Sensitivity Panel",
    "organic_acids": "Organic Acids Test (OAT)",
    "imaging": "Imaging / Radiology Report",
    "other": "Other Report",
}

IMAGE_TYPES = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
PDF_TYPES = {".pdf"}
TEXT_TYPES = {".txt", ".csv", ".tsv"}


def emit(payload: dict) -> int:
    json.dump(payload, sys.stdout, default=str)
    return 0 if payload.get("ok") else 1


def _load_env():
    try:
        from dotenv import load_dotenv
        load_dotenv(FMDB_ROOT / ".env", override=True)
    except ImportError:
        env_path = FMDB_ROOT / ".env"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                line = line.strip().lstrip("export ").strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _build_content_block(file_path: Path) -> dict:
    """Build an Anthropic content block for the file."""
    ext = file_path.suffix.lower()
    data = file_path.read_bytes()

    if ext in IMAGE_TYPES:
        media_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                     ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_map.get(ext, "image/jpeg"),
                "data": base64.standard_b64encode(data).decode("utf-8"),
            }
        }
    elif ext in PDF_TYPES:
        return {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": base64.standard_b64encode(data).decode("utf-8"),
            }
        }
    else:
        # Text file — send as text block (truncate raw genetic data)
        text = data.decode("utf-8", errors="replace")
        if len(data) > RAW_GENETIC_THRESHOLD and ext in TEXT_TYPES:
            # Likely raw SNP file — extract only header + any lines with key variants
            lines = text.splitlines()
            key_snps = {"rs1801133", "rs1801131", "rs4680", "rs429358", "rs7412",
                        "rs1544410", "rs731236", "rs4646536", "rs2228570",
                        "rs2066853", "rs1801394", "rs1801198", "rs1799945"}
            header_lines = [l for l in lines[:50] if l.strip()]
            relevant_lines = [l for l in lines if any(snp in l.lower() for snp in key_snps)]
            text = "\n".join(header_lines + ["...[raw SNP data truncated — showing key FM variants only]..."] + relevant_lines[:100])

        return {"type": "text", "text": text}


def _extract(file_path: Path, report_type: str) -> dict:
    """Call Haiku with the appropriate prompt and return parsed JSON."""
    import anthropic
    from _api_guard import require_api_authorized  # cost guard C
    require_api_authorized("extract-report.py")
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    prompt = PROMPTS.get(report_type, PROMPTS["other"])
    content_block = _build_content_block(file_path)

    messages = [
        {
            "role": "user",
            "content": [
                content_block,
                {
                    "type": "text",
                    "text": (
                        f"Report type: {DISPLAY_NAMES.get(report_type, report_type)}\n\n"
                        f"{prompt.strip()}\n\n"
                        "Return ONLY the JSON object. No explanation, no markdown code fences."
                    )
                }
            ]
        }
    ]

    resp = client.messages.create(
        model=HAIKU,
        max_tokens=2000,
        messages=messages,
    )

    raw = resp.content[0].text.strip()
    # Strip markdown fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw.strip())
    return json.loads(raw)


def main() -> int:
    _load_env()

    raw = sys.stdin.read().strip()
    try:
        inp = json.loads(raw) if raw else {}
    except json.JSONDecodeError as e:
        return emit({"ok": False, "error": f"JSON parse: {e}"})

    file_path_str = inp.get("file_path", "")
    report_type = inp.get("report_type", "other")
    file_name = inp.get("file_name", "")

    if not file_path_str:
        return emit({"ok": False, "error": "file_path is required"})

    file_path = Path(file_path_str)
    if not file_path.exists():
        return emit({"ok": False, "error": f"File not found: {file_path}"})

    file_size = file_path.stat().st_size
    if file_size > MAX_FILE_BYTES:
        return emit({
            "ok": False,
            "error": f"File too large ({file_size // 1024 // 1024} MB). Maximum is 30 MB. For large reports, upload the summary/results pages as a separate PDF."
        })

    if report_type not in PROMPTS:
        report_type = "other"

    try:
        extracted = _extract(file_path, report_type)
    except json.JSONDecodeError as e:
        return emit({"ok": False, "error": f"Haiku returned non-JSON: {e}"})
    except Exception as e:
        return emit({"ok": False, "error": f"Extraction failed: {e}"})

    # Pull out common top-level fields
    date_of_report = extracted.get("date_of_report")
    lab_name = extracted.get("lab_name")
    key_findings = extracted.get("key_findings") or []
    summary = extracted.get("summary") or ""

    return emit({
        "ok": True,
        "extracted": extracted,
        "date_of_report": date_of_report,
        "lab_name": lab_name,
        "key_findings": key_findings,
        "summary": summary,
        "report_type": report_type,
        "display_type": DISPLAY_NAMES.get(report_type, report_type),
    })


if __name__ == "__main__":
    sys.exit(main())
