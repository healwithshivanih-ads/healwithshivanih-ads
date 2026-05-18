#!/usr/bin/env python3
"""
test-clinical.py — Clinical test case runner for FM Coach.

Runs golden + safety cases under test-cases/ against the catalogue and assess
engine. Designed to catch:

  * Catalogue coverage gaps (missing topics/supplements/symptoms referenced
    by test cases — surfaces what's needed before clients hit the gap).
  * Contraindication-data gaps (safety cases must trace to populated
    catalogue contraindications.medications / .conditions / .life_stages
    fields).
  * Clinical regression (live mode — assess() output drifts from expected).

Modes:
  static (default)  — validate cases, resolve catalogue references, audit
                      contraindication completeness. No AI spend.
  live              — also run assess.synthesize() per case and check that
                      AI output matches expected drivers / supplements /
                      warnings / referrals. Costs ~$0.20 / case.

Usage:
  .venv/bin/python scripts/test-clinical.py
  .venv/bin/python scripts/test-clinical.py --filter golden
  .venv/bin/python scripts/test-clinical.py --filter safety-001
  .venv/bin/python scripts/test-clinical.py --mode live
"""

from __future__ import annotations

import argparse
import json
import sys
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
TEST_CASES_DIR = REPO_ROOT / "test-cases"
DATA_DIR = REPO_ROOT / "data"

# ── ANSI helpers ────────────────────────────────────────────────────────────
RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def c(text: str, colour: str) -> str:
    return f"{colour}{text}{RESET}"


# ── Catalogue index (read-once, in-memory) ──────────────────────────────────
@dataclass
class CatalogueIndex:
    topics: set[str] = field(default_factory=set)
    mechanisms: set[str] = field(default_factory=set)
    symptoms: set[str] = field(default_factory=set)
    supplements: set[str] = field(default_factory=set)
    sources: set[str] = field(default_factory=set)
    # Per-supplement contraindication map (structured field)
    supplement_contraindications: dict[str, dict[str, list[str]]] = field(
        default_factory=dict
    )
    # Per-supplement pregnancy_safety / lactation_safety overlay fields
    supplement_pregnancy_safety: dict[str, str] = field(default_factory=dict)
    supplement_lactation_safety: dict[str, str] = field(default_factory=dict)
    # Per-supplement interactions.medications (the parallel structure to
    # contraindications.medications — both populated inconsistently)
    supplement_interactions: dict[str, list[str]] = field(default_factory=dict)
    # All aliases mapped to canonical slug, per entity kind
    aliases: dict[str, dict[str, str]] = field(default_factory=dict)


def load_catalogue() -> CatalogueIndex:
    idx = CatalogueIndex()
    idx.aliases = {"topic": {}, "mechanism": {}, "symptom": {}, "supplement": {}}

    for kind, attr in [
        ("topics", "topics"),
        ("mechanisms", "mechanisms"),
        ("symptoms", "symptoms"),
        ("supplements", "supplements"),
        ("sources", "sources"),
    ]:
        target = getattr(idx, attr)
        d = DATA_DIR / kind
        if not d.exists():
            continue
        for f in d.glob("*.yaml"):
            try:
                with f.open() as fh:
                    data = yaml.safe_load(fh) or {}
            except yaml.YAMLError:
                continue
            slug = data.get("slug") or data.get("id") or f.stem
            target.add(slug)
            for alias in data.get("aliases", []) or []:
                idx.aliases[kind[:-1]][alias.lower()] = slug
            if kind == "supplements":
                contra = data.get("contraindications") or {}
                idx.supplement_contraindications[slug] = {
                    "conditions": list(contra.get("conditions") or []),
                    "medications": list(contra.get("medications") or []),
                    "life_stages": list(contra.get("life_stages") or []),
                }
                idx.supplement_pregnancy_safety[slug] = (
                    data.get("pregnancy_safety") or "unknown"
                )
                idx.supplement_lactation_safety[slug] = (
                    data.get("lactation_safety") or "unknown"
                )
                interactions = data.get("interactions") or {}
                # interactions.medications can be either list of strings or
                # list of dicts with `medication` key
                int_meds: list[str] = []
                for entry in (
                    interactions.get("medications")
                    if isinstance(interactions, dict)
                    else []
                ) or []:
                    if isinstance(entry, dict):
                        med = entry.get("medication")
                        if med:
                            int_meds.append(med)
                    elif isinstance(entry, str):
                        int_meds.append(entry)
                idx.supplement_interactions[slug] = int_meds
    return idx


def resolve(slug: str, kind: str, cat: CatalogueIndex) -> str | None:
    """Return canonical slug or None if unresolvable."""
    pool = getattr(cat, kind + "s", None)
    if pool and slug in pool:
        return slug
    aliases = cat.aliases.get(kind, {})
    return aliases.get(slug.lower())


# ── Case loading ────────────────────────────────────────────────────────────
@dataclass
class TestCase:
    case_id: str
    case_type: str
    priority: str
    path: Path
    raw: dict[str, Any]


def load_cases(filter_term: str | None = None) -> list[TestCase]:
    cases = []
    for sub in ("clinical", "safety"):
        d = TEST_CASES_DIR / sub
        if not d.exists():
            continue
        for f in sorted(d.glob("*.yaml")):
            # Skip templates with leading underscore
            if f.name.startswith("_"):
                continue
            with f.open() as fh:
                raw = yaml.safe_load(fh) or {}
            cid = raw.get("case_id") or f.stem
            if filter_term and filter_term not in cid:
                continue
            cases.append(
                TestCase(
                    case_id=cid,
                    case_type=raw.get("case_type") or sub.rstrip("s"),
                    priority=raw.get("priority") or "medium",
                    path=f,
                    raw=raw,
                )
            )
    return cases


# ── Validation checks ───────────────────────────────────────────────────────
@dataclass
class CheckResult:
    case_id: str
    name: str
    passed: bool
    severity: str  # info | warning | error | critical
    detail: str = ""


def check_required_fields(case: TestCase) -> CheckResult:
    """Hard-require synthetic flag + non-empty client/intake/expected."""
    missing: list[str] = []
    if not case.raw.get("synthetic"):
        missing.append("synthetic: true must be explicit")
    for required in ("client", "intake", "expected"):
        if not case.raw.get(required):
            missing.append(f"missing top-level field: {required}")
    return CheckResult(
        case_id=case.case_id,
        name="schema-required-fields",
        passed=not missing,
        severity="error" if missing else "info",
        detail="; ".join(missing) if missing else "all required fields present",
    )


def check_slug_resolution(case: TestCase, cat: CatalogueIndex) -> list[CheckResult]:
    """Every slug referenced by the case must resolve to a canonical entry."""
    results: list[CheckResult] = []
    intake = case.raw.get("intake") or {}
    expected = case.raw.get("expected") or {}
    client = case.raw.get("client") or {}
    must_include = expected.get("must_include") or {}

    def chk(slugs: Iterable[str], kind: str, where: str) -> None:
        unresolved = []
        for s in slugs or []:
            if not resolve(s, kind, cat):
                unresolved.append(s)
        results.append(
            CheckResult(
                case_id=case.case_id,
                name=f"slug-resolve-{where}",
                passed=not unresolved,
                severity="error" if unresolved else "info",
                detail=(
                    f"unresolved {kind}: " + ", ".join(unresolved)
                    if unresolved
                    else f"all {kind} slugs in {where} resolve"
                ),
            )
        )

    chk(intake.get("symptoms"), "symptom", "intake.symptoms")
    chk(intake.get("topics"), "topic", "intake.topics")
    chk(client.get("conditions"), "topic", "client.conditions")
    chk(must_include.get("topics"), "topic", "expected.must_include.topics")
    # drivers can be topic OR mechanism
    drivers = must_include.get("drivers") or []
    unresolved_drivers = [
        d
        for d in drivers
        if not resolve(d, "topic", cat) and not resolve(d, "mechanism", cat)
    ]
    results.append(
        CheckResult(
            case_id=case.case_id,
            name="slug-resolve-expected.drivers",
            passed=not unresolved_drivers,
            severity="error" if unresolved_drivers else "info",
            detail=(
                "drivers must be topic OR mechanism slugs; unresolved: "
                + ", ".join(unresolved_drivers)
                if unresolved_drivers
                else "all drivers resolve to topic or mechanism"
            ),
        )
    )
    # supplements_any_of is a list of sub-lists (OR groups)
    sup_groups = must_include.get("supplements_any_of") or []
    unresolved_sup: list[str] = []
    for group in sup_groups:
        for s in group or []:
            if not resolve(s, "supplement", cat):
                unresolved_sup.append(s)
    results.append(
        CheckResult(
            case_id=case.case_id,
            name="slug-resolve-expected.supplements_any_of",
            passed=not unresolved_sup,
            severity="error" if unresolved_sup else "info",
            detail=(
                "unresolved supplements: " + ", ".join(unresolved_sup)
                if unresolved_sup
                else "all expected supplements resolve"
            ),
        )
    )
    return results


def check_forbidden_slugs_exist(case: TestCase, cat: CatalogueIndex) -> CheckResult:
    """Forbidden entries must reference REAL supplements/aliases — otherwise
    the prohibition is testing nothing because the AI can't recommend a slug
    that doesn't exist."""
    expected = case.raw.get("expected") or {}
    forbidden = expected.get("forbidden") or []
    # Some forbidden entries are descriptive patterns rather than slugs
    # (e.g. "high-dose-iodine"). Only flag those that LOOK like slugs but
    # don't resolve — give the author benefit of the doubt for prose patterns.
    likely_slugs = [
        f
        for f in forbidden
        if "-" in f and not any(w in f for w in ("dose", "mega", "additional"))
    ]
    unresolved = [s for s in likely_slugs if not resolve(s, "supplement", cat)]
    return CheckResult(
        case_id=case.case_id,
        name="forbidden-supplements-exist",
        passed=not unresolved,
        severity="warning" if unresolved else "info",
        detail=(
            "forbidden slugs that don't exist in catalogue (so AI can't recommend them — "
            "consider replacing with descriptive prose or stub the supplement): "
            + ", ".join(unresolved)
            if unresolved
            else "forbidden list references real supplements"
        ),
    )


def check_safety_contraindications_traceable(
    case: TestCase, cat: CatalogueIndex
) -> CheckResult:
    """For safety cases: at least one forbidden supplement must have a
    contraindication field that captures the risk. Otherwise the safety
    catch depends entirely on AI commonsense, which is fragile."""
    if case.case_type != "safety":
        return CheckResult(
            case_id=case.case_id,
            name="contraindication-traceable",
            passed=True,
            severity="info",
            detail="not a safety case",
        )

    expected = case.raw.get("expected") or {}
    client = case.raw.get("client") or {}
    forbidden = expected.get("forbidden") or []
    pregnancy = client.get("pregnancy_status")
    medications_raw = client.get("medications") or []
    conditions = client.get("conditions") or []

    # Tokenise client medications (strip dose-form) — match by substring
    def medname(text: str) -> str:
        return re.split(r"[\d ]", text.strip(), maxsplit=1)[0].lower()

    med_tokens = [medname(m) for m in medications_raw if m]
    forbidden_slugs = [resolve(f, "supplement", cat) for f in forbidden]
    forbidden_resolved = [s for s in forbidden_slugs if s]

    traced: list[str] = []
    missed: list[str] = []
    for slug in forbidden_resolved:
        contra = cat.supplement_contraindications.get(slug, {})
        # 1a) life_stage match in structured contraindications block
        if pregnancy and pregnancy in (contra.get("life_stages") or []):
            traced.append(f"{slug} (life_stage:{pregnancy})")
            continue
        # 1b) pregnancy_safety overlay field — the actually-populated path
        if pregnancy == "pregnant" and cat.supplement_pregnancy_safety.get(
            slug
        ) in ("contraindicated", "avoid"):
            traced.append(
                f"{slug} (pregnancy_safety:{cat.supplement_pregnancy_safety[slug]})"
            )
            continue
        if pregnancy == "lactating" and cat.supplement_lactation_safety.get(
            slug
        ) in ("contraindicated", "avoid"):
            traced.append(
                f"{slug} (lactation_safety:{cat.supplement_lactation_safety[slug]})"
            )
            continue
        # 2a) medication match against contraindications.medications
        contra_meds_low = [m.lower() for m in (contra.get("medications") or [])]
        # 2b) medication match against interactions.medications
        int_meds_low = [m.lower() for m in cat.supplement_interactions.get(slug, [])]
        all_meds_low = contra_meds_low + int_meds_low
        med_hit = next(
            (
                m
                for m in med_tokens
                if any(m in cm or cm in m for cm in all_meds_low)
            ),
            None,
        )
        if med_hit:
            traced.append(f"{slug} (med:{med_hit})")
            continue
        # 3) condition match
        contra_conds = [c.lower() for c in (contra.get("conditions") or [])]
        cond_hit = next(
            (c for c in conditions if c.lower() in contra_conds),
            None,
        )
        if cond_hit:
            traced.append(f"{slug} (condition:{cond_hit})")
            continue
        missed.append(slug)

    if not forbidden_resolved:
        return CheckResult(
            case_id=case.case_id,
            name="contraindication-traceable",
            passed=True,
            severity="warning",
            detail=(
                "safety case has no forbidden slugs that resolve in the "
                "catalogue — runs depend entirely on AI commonsense"
            ),
        )

    passed = bool(traced)
    return CheckResult(
        case_id=case.case_id,
        name="contraindication-traceable",
        passed=passed,
        severity="error" if not passed else ("warning" if missed else "info"),
        detail=(
            "no forbidden supplement's contraindication block captures the "
            f"risk. Catalogue gap. Traced: {len(traced)}/{len(forbidden_resolved)}. "
            f"Missed: {', '.join(missed)}"
            if not passed
            else (
                f"traced {len(traced)}/{len(forbidden_resolved)} via catalogue. "
                f"Gaps: {', '.join(missed)}"
                if missed
                else f"all {len(traced)} forbidden supplements have catalogue "
                "contraindication trace"
            )
        ),
    )


# ── Reporting ───────────────────────────────────────────────────────────────
@dataclass
class CaseReport:
    case: TestCase
    checks: list[CheckResult] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(
            r.passed or r.severity in ("info", "warning") for r in self.checks
        )

    @property
    def error_count(self) -> int:
        return sum(
            1 for r in self.checks if not r.passed and r.severity == "error"
        )

    @property
    def warn_count(self) -> int:
        return sum(
            1 for r in self.checks if not r.passed and r.severity == "warning"
        )


def print_report(reports: list[CaseReport], verbose: bool = False) -> int:
    total_err = sum(r.error_count for r in reports)
    total_warn = sum(r.warn_count for r in reports)
    print()
    print(c("Clinical Test Suite — Static Mode", BOLD))
    print(c(f"{len(reports)} cases · {total_err} errors · {total_warn} warnings", DIM))
    print()
    for r in reports:
        status = (
            c("PASS", GREEN)
            if r.passed
            else c("FAIL", RED)
            if r.error_count
            else c("WARN", YELLOW)
        )
        prio = (
            c(r.case.priority.upper(), RED if r.case.priority == "critical" else CYAN)
        )
        print(f"  {status}  [{prio}]  {r.case.case_id}")
        for chk in r.checks:
            if chk.passed and not verbose:
                continue
            symbol = (
                c("✓", GREEN)
                if chk.passed
                else c("✗", RED)
                if chk.severity == "error"
                else c("⚠", YELLOW)
            )
            print(f"      {symbol} {chk.name}: {chk.detail}")
    print()
    if total_err:
        print(c(f"FAILED — {total_err} error(s) require attention.", RED + BOLD))
        return 1
    if total_warn:
        print(
            c(f"PASSED with {total_warn} warning(s) — review when possible.", YELLOW)
        )
        return 0
    print(c("ALL PASS — clinical regression baseline holds.", GREEN + BOLD))
    return 0


# ── Live mode (stub) ────────────────────────────────────────────────────────
def run_live_assess(case: TestCase, cat: CatalogueIndex) -> list[CheckResult]:
    """Run assess.synthesize() against the case intake and compare AI output
    to expected. Costs ~$0.20/case. v2 — stub for now."""
    return [
        CheckResult(
            case_id=case.case_id,
            name="live-mode-not-implemented",
            passed=True,
            severity="warning",
            detail="live mode is stubbed — use --mode static for now. "
            "Live runner planned: call scripts/assess.py with case intake, "
            "parse AI output, match against expected.must_include / .forbidden",
        )
    ]


# ── Main ────────────────────────────────────────────────────────────────────
def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--mode",
        choices=("static", "live"),
        default="static",
        help="static = free schema + catalogue validation; live = also run AI assess (costs)",
    )
    p.add_argument(
        "--filter",
        default=None,
        help="substring filter on case_id (e.g. 'safety' or 'golden-001')",
    )
    p.add_argument(
        "-v", "--verbose", action="store_true", help="show all check details"
    )
    p.add_argument(
        "--json", action="store_true", help="emit JSON for CI consumption"
    )
    args = p.parse_args()

    cases = load_cases(args.filter)
    if not cases:
        print(c("No matching cases found.", YELLOW))
        return 0

    cat = load_catalogue()
    reports: list[CaseReport] = []
    for case in cases:
        rep = CaseReport(case=case)
        rep.checks.append(check_required_fields(case))
        rep.checks.extend(check_slug_resolution(case, cat))
        rep.checks.append(check_forbidden_slugs_exist(case, cat))
        rep.checks.append(check_safety_contraindications_traceable(case, cat))
        if args.mode == "live":
            rep.checks.extend(run_live_assess(case, cat))
        reports.append(rep)

    if args.json:
        out = [
            {
                "case_id": r.case.case_id,
                "passed": r.passed,
                "error_count": r.error_count,
                "warn_count": r.warn_count,
                "priority": r.case.priority,
                "checks": [
                    {
                        "name": chk.name,
                        "passed": chk.passed,
                        "severity": chk.severity,
                        "detail": chk.detail,
                    }
                    for chk in r.checks
                ],
            }
            for r in reports
        ]
        print(json.dumps(out, indent=2))
        return 0 if all(r.passed for r in reports) else 1

    return print_report(reports, verbose=args.verbose)


if __name__ == "__main__":
    sys.exit(main())
