#!/usr/bin/env python3
"""Parse a genetic / SNP test report PDF (MTHFR, COMT, APOE, MTRR, GST, etc.).

Most India genetic panels (mapmygenome, genomepatri, dnalabsindia, MedGenome)
follow a similar SNP-table format with columns: Gene · SNP/rsID · Genotype ·
Risk/Implication. This shim sends the PDF to Sonnet with structured tool-use
to extract a normalised SNP list + clinical implications.

Reads JSON from stdin:
{
  "client_id": str,
  "file_path": str,    # absolute path to the PDF
  "lab":       str,    # OPTIONAL — "mapmygenome" | "genomepatri" | "other"
  "dry_run":   bool
}

Writes JSON to stdout:
{
  "ok":         bool,
  "test_type":  "genetic",
  "summary":    str,            # 2-3 sentences
  "snps":       [               # normalised list
    {
      "gene":             str,  # e.g. "MTHFR"
      "rsid":             str,  # e.g. "rs1801133"
      "variant":          str,  # e.g. "C677T"
      "genotype":         str,  # e.g. "CT" | "TT" | "CC" | "AA" etc.
      "zygosity":         str,  # "homozygous_risk" | "heterozygous" | "homozygous_wild" | "unknown"
      "implication":      str,  # plain-language summary
      "fm_relevance":     str,  # what this means for FM intervention
    }
  ],
  "clinical_implications": [str],     # high-level clinical impact bullets
  "fm_recommendations":    [str],     # specific FM coaching recommendations
  "flagged_drivers":       [str],     # mechanism slugs surfaced (for backwards compat with
                                      #   functional-test-panel pattern)
  "file_path":  str,                  # where the YAML record was saved
  "error":      str | null
}
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import yaml


def _load_env() -> None:
    if os.environ.get("ANTHROPIC_API_KEY"):
        return
    candidates = [
        Path(__file__).resolve().parent.parent.parent / "fm-database" / ".env",
        Path(__file__).resolve().parent.parent / "fm-database" / ".env",
    ]
    for p in candidates:
        if not p.exists():
            continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export "):]
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            os.environ.setdefault(k.strip(), v)


def _plans_root() -> Path:
    p = os.environ.get("FMDB_PLANS_DIR")
    if p:
        return Path(p).expanduser()
    return Path.home() / "fm-plans"


_TOOL_SCHEMA = {
    "name": "extract_genetic_findings",
    "description": "Extract SNPs, genotypes, and FM-relevant clinical implications from a genetic report PDF.",
    "input_schema": {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": "2-3 sentence summary of the most clinically significant findings.",
            },
            "snps": {
                "type": "array",
                "description": "Each detected SNP with its genotype + plain-language implication.",
                "items": {
                    "type": "object",
                    "properties": {
                        "gene":         {"type": "string"},
                        "rsid":         {"type": "string"},
                        "variant":      {"type": "string"},
                        "genotype":     {"type": "string"},
                        "zygosity": {
                            "type": "string",
                            "enum": ["homozygous_risk", "heterozygous", "homozygous_wild", "unknown"],
                        },
                        "implication":   {"type": "string"},
                        "fm_relevance":  {"type": "string"},
                    },
                    "required": ["gene", "genotype", "zygosity", "implication", "fm_relevance"],
                },
            },
            "clinical_implications": {
                "type": "array",
                "items": {"type": "string"},
                "description": "High-level clinical impact bullets (e.g. 'Slow methylation — folate + B12 in active forms').",
            },
            "fm_recommendations": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Specific FM coaching recommendations grounded in the SNPs (e.g. 'Use methylfolate not folic acid').",
            },
            "flagged_mechanisms": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Mechanism slugs surfaced by the report (e.g. 'methylation-impairment', 'phase-2-detox-impairment').",
            },
        },
        "required": ["summary", "snps", "clinical_implications", "fm_recommendations"],
    },
}


_SYSTEM = """You are an FM-trained clinical advisor reading a genetic / SNP \
test report. Most reports come from Indian labs (mapmygenome, genomepatri, \
dnalabsindia, MedGenome) following a similar SNP-table format.

Extract every clinically relevant SNP with its genotype. Common genes to look \
for (not exhaustive):
- Methylation: MTHFR (C677T, A1298C), MTRR, MTR, BHMT, AHCY
- Detox: GSTM1, GSTT1, GSTP1, NAT2, CYP1A1, CYP1B1, CYP2D6, CYP2C19
- Hormone metabolism: COMT (V158M), CYP1A2, SULT1A1, UGT1A1
- Lipid/CV risk: APOE (e2/e3/e4), MTHFR
- Vitamin D / receptor: VDR (FokI, BsmI, TaqI)
- Inflammation: TNF-alpha, IL-6
- Iron: HFE (C282Y, H63D)
- Histamine: HNMT, DAO/AOC1

For each SNP:
- zygosity: 'homozygous_risk' if both alleles are the variant (e.g. TT for C677T); \
  'heterozygous' if one (e.g. CT); 'homozygous_wild' if neither (e.g. CC); 'unknown' \
  if the report doesn't disclose.
- implication: 1 sentence, plain language. ('Reduced enzyme activity by ~30%' is fine.)
- fm_relevance: 1 sentence on what the FM coach should DO with this. ('Use methylated \
  B12 + methylfolate' / 'Avoid high-estrogen contraceptives if also on smoking history').

clinical_implications: 3-6 high-level bullets. Group by system (methylation / detox / \
hormones / cardiovascular).

fm_recommendations: 3-8 specific actionable items the coach can use in the plan. \
Use real supplement names where known (methylfolate, methylcobalamin, NAC, glycine, \
sulforaphane, milk thistle, etc.).

flagged_mechanisms: short slug-form list of mechanism categories. Examples: \
methylation-impairment, phase-2-detox-impairment, slow-comt-catechol-clearance, \
apoe4-cardiovascular-risk, vdr-vitamin-d-resistance, hfe-iron-overload-risk.

Be honest. If the report is unclear or genotypes aren't disclosed, mark zygosity \
as 'unknown' and write that you couldn't determine."""


def main() -> int:
    _load_env()

    try:
        payload = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 1

    client_id = payload.get("client_id", "").strip()
    file_path = payload.get("file_path", "").strip()
    dry_run = bool(payload.get("dry_run", False))

    if not client_id or not file_path:
        json.dump({"ok": False, "error": "client_id and file_path required"}, sys.stdout)
        return 1

    pdf_path = Path(file_path)
    if not pdf_path.exists():
        json.dump({"ok": False, "error": f"file not found: {file_path}"}, sys.stdout)
        return 1

    if dry_run:
        result = {
            "ok": True,
            "test_type": "genetic",
            "summary": "[dry-run] Would extract SNPs from genetic report.",
            "snps": [],
            "clinical_implications": [],
            "fm_recommendations": [],
            "flagged_drivers": [],
            "file_path": "",
        }
        json.dump(result, sys.stdout)
        return 0

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        json.dump({"ok": False, "error": "ANTHROPIC_API_KEY not set"}, sys.stdout)
        return 1

    try:
        from anthropic import Anthropic
    except ImportError as e:
        json.dump({"ok": False, "error": f"anthropic not installed: {e}"}, sys.stdout)
        return 1

    import base64
    pdf_bytes = pdf_path.read_bytes()
    pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("utf-8")

    aclient = Anthropic(api_key=api_key)
    try:
        with aclient.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=8192,
            system=_SYSTEM,
            tools=[_TOOL_SCHEMA],
            tool_choice={"type": "tool", "name": "extract_genetic_findings"},
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_b64,
                        },
                    },
                    {"type": "text", "text": "Extract every clinically relevant SNP with genotype + FM implications."},
                ],
            }],
        ) as stream:
            resp = stream.get_final_message()
    except Exception as e:
        json.dump({"ok": False, "error": f"API call failed: {e}"}, sys.stdout)
        return 1

    tool_input = None
    for block in resp.content:
        if getattr(block, "type", None) == "tool_use":
            tool_input = block.input
            break

    if not tool_input:
        json.dump({"ok": False, "error": "model did not return tool_use block"}, sys.stdout)
        return 1

    record = {
        "test_type": "genetic",
        "test_date": date.today().isoformat(),
        "extracted_at": datetime.now(timezone.utc).isoformat(),
        "summary": tool_input.get("summary", ""),
        "snps": tool_input.get("snps") or [],
        "clinical_implications": tool_input.get("clinical_implications") or [],
        "fm_recommendations": tool_input.get("fm_recommendations") or [],
        "flagged_drivers": tool_input.get("flagged_mechanisms") or [],
        "source_file": pdf_path.name,
    }

    out_dir = _plans_root() / "clients" / client_id / "functional_tests"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"genetic-{record['test_date']}.yaml"
    out_file.write_text(yaml.dump(record, sort_keys=False, allow_unicode=True))

    record["ok"] = True
    record["file_path"] = str(out_file)
    json.dump(record, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
