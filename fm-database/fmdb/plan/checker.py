"""Deterministic plan checks against the catalogue.

What this checks (no AI required):
- Every slug referenced in the plan resolves to a real catalogue entity
  (using alias-aware resolution where the entity supports it)
- Catalogue entries with `evidence_tier: confirm_with_clinician` flagged
  as authored without explicit clinician acknowledgement
- Supplement contraindications cross-referenced against the client's
  active conditions and current medications

Findings have severities:
- CRITICAL  blocks transition out of draft
- WARNING   non-blocking but requires explicit ack to publish
- INFO      surfaced for the coach's awareness, no ack required

The AI sanity check (next milestone) layers on top, evaluating things
like coaching-translation accuracy and plan-vs-assessment coherence.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ..validator import Loaded, _resolve_index
from .models import Client, Plan


Severity = Literal["CRITICAL", "WARNING", "INFO"]


@dataclass
class Finding:
    severity: Severity
    section: str          # which section of the plan
    field: str            # which field in that section
    detail: str           # human-readable explanation
    target: str = ""      # the offending slug or value (for ack tracking)

    def render(self) -> str:
        return f"[{self.severity:8s}] {self.section}.{self.field}: {self.detail}"

    @property
    def ack_id(self) -> str:
        """Stable identifier for `plan ack --finding-id ...`."""
        return f"{self.section}:{self.field}:{self.target}"


def check_plan(plan: Plan, client: Client | None, catalogue: Loaded) -> list[Finding]:
    """Run deterministic checks. Returns findings sorted by severity."""
    findings: list[Finding] = []

    # ---------- Build resolution indexes (alias-aware) ----------
    topic_idx = _resolve_index(catalogue.topics)
    mech_idx = _resolve_index(catalogue.mechanisms)
    sym_idx = _resolve_index(catalogue.symptoms)
    supp_slugs = {s.slug for s in catalogue.supplements}
    ca_slugs = {ca.slug for ca in catalogue.cooking_adjustments}
    hr_slugs = {hr.slug for hr in catalogue.home_remedies}
    claim_slugs = {c.slug for c in catalogue.claims}
    supp_by_slug = {s.slug: s for s in catalogue.supplements}

    def _xref(section, field, target, idx_or_set, kind):
        if isinstance(idx_or_set, dict):
            ok = target in idx_or_set
        else:
            ok = target in idx_or_set
        if not ok:
            findings.append(Finding(
                "CRITICAL", section, field,
                f"references unknown {kind} {target!r}", target=target,
            ))

    # ---------- Assessment ----------
    for slug in plan.primary_topics:
        _xref("assessment", "primary_topics", slug, topic_idx, "topic")
    for slug in plan.contributing_topics:
        _xref("assessment", "contributing_topics", slug, topic_idx, "topic")
    for slug in plan.presenting_symptoms:
        _xref("assessment", "presenting_symptoms", slug, sym_idx, "symptom")
    for hd in plan.hypothesized_drivers:
        _xref("assessment", "hypothesized_drivers.mechanism",
              hd.mechanism, mech_idx, "mechanism")

    # ---------- Nutrition (CookingAdjustment + HomeRemedy slugs) ----------
    for slug in plan.nutrition.cooking_adjustments:
        _xref("nutrition", "cooking_adjustments", slug, ca_slugs, "cooking_adjustment")
    for slug in plan.nutrition.home_remedies:
        _xref("nutrition", "home_remedies", slug, hr_slugs, "home_remedy")

    # ---------- Education modules ----------
    for em in plan.education:
        if em.target_kind == "topic":
            _xref("education", "target_slug", em.target_slug, topic_idx, "topic")
        elif em.target_kind == "mechanism":
            _xref("education", "target_slug", em.target_slug, mech_idx, "mechanism")
        elif em.target_kind == "claim":
            _xref("education", "target_slug", em.target_slug, claim_slugs, "claim")
        else:
            findings.append(Finding(
                "CRITICAL", "education", "target_kind",
                f"target_kind must be topic|mechanism|claim, got {em.target_kind!r}",
                target=em.target_slug,
            ))

    # ---------- Supplement protocol ----------
    for item in plan.supplement_protocol:
        if item.supplement_slug not in supp_slugs:
            findings.append(Finding(
                "CRITICAL", "supplement_protocol", "supplement_slug",
                f"references unknown supplement {item.supplement_slug!r}",
                target=item.supplement_slug,
            ))
            continue

        supp = supp_by_slug[item.supplement_slug]

        # Evidence-tier honesty: confirm_with_clinician supplements warrant a flag
        if supp.evidence_tier.value == "confirm_with_clinician":
            findings.append(Finding(
                "WARNING", "supplement_protocol", "evidence_tier",
                f"{item.supplement_slug!r} is tagged 'confirm_with_clinician' in the "
                "catalogue — coach is authoring this without clinician sign-off. "
                "Acknowledge if intentional.",
                target=item.supplement_slug,
            ))

        # Contraindication check vs client conditions
        if client:
            client_conditions_lower = {c.lower() for c in client.active_conditions}
            client_meds_lower = {m.lower() for m in client.current_medications}
            for cond in supp.contraindications.conditions:
                if cond.lower() in client_conditions_lower:
                    findings.append(Finding(
                        "CRITICAL", "supplement_protocol", "contraindications",
                        f"{item.supplement_slug!r} is contraindicated with client's "
                        f"active condition {cond!r}",
                        target=item.supplement_slug,
                    ))
            for med_inter in supp.interactions.with_medications:
                if med_inter.medication.lower() in client_meds_lower:
                    findings.append(Finding(
                        "WARNING" if med_inter.type.value != "avoid_together" else "CRITICAL",
                        "supplement_protocol", "interactions.with_medications",
                        f"{item.supplement_slug!r} interacts with client's medication "
                        f"{med_inter.medication!r}: {med_inter.reason}",
                        target=item.supplement_slug,
                    ))

        # Form sanity: declared form actually exists in the supplement entity
        if item.form:
            valid_forms = {f.value for f in supp.forms_available}
            if valid_forms and item.form not in valid_forms:
                findings.append(Finding(
                    "WARNING", "supplement_protocol", "form",
                    f"{item.supplement_slug!r} doesn't list {item.form!r} as an "
                    f"available form (catalogue has: {sorted(valid_forms)})",
                    target=item.supplement_slug,
                ))

    # ---------- Tracking ----------
    for slug in plan.tracking.symptoms_to_monitor:
        _xref("tracking", "symptoms_to_monitor", slug, sym_idx, "symptom")

    # ---------- Internal coherence ----------
    if not plan.primary_topics:
        findings.append(Finding(
            "WARNING", "assessment", "primary_topics",
            "no primary_topics declared — assessment is unanchored",
        ))
    if not plan.presenting_symptoms:
        findings.append(Finding(
            "INFO", "assessment", "presenting_symptoms",
            "no presenting_symptoms — was this captured at intake?",
        ))
    if (plan.supplement_protocol and not plan.hypothesized_drivers):
        findings.append(Finding(
            "WARNING", "assessment", "hypothesized_drivers",
            "supplements declared without any hypothesized_drivers — what's the rationale?",
        ))

    # Sort: CRITICAL first, then WARNING, then INFO
    severity_order = {"CRITICAL": 0, "WARNING": 1, "INFO": 2}
    findings.sort(key=lambda f: (severity_order[f.severity], f.section, f.field))
    return findings
