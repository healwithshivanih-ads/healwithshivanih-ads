"""Deterministic validation gate for assessment suggestions — ONE fence, BOTH authors.

WHY THIS EXISTS
---------------
An assessment can be authored two ways:

  1. `synthesize()` — the paid API path. Its guardrails live in a 47-rule SYSTEM
     prompt and a subgraph slug whitelist. A prompt is a *request*: the model has
     violated it in production (Manju's off-catalogue `circadian-rhythm-disruption`
     mechanism blocked publishing; Archana's rework re-ordered a vitamin D she'd
     had done 5 days earlier, plus six duplicate oestrogen-metabolite orders).
  2. Chat-authored (`manual_suggestions`) — the $0 path. Built as a trust-the-coach
     escape hatch: schema-validated only. No slug whitelist, no contraindication
     scan, no drug-caution check, no labs-on-file dedup.

So the expensive path had guardrails that could be ignored, and the cheap path had
almost none. This module turns those rules into CODE, which is a fact rather than a
request, and runs the same battery over both authors' output.

CONTRACT
--------
`validate(suggestions, cat=…, client=…, subgraph=…)` → GateReport with
`hard_failures` (block the write) and `warnings` (persist, but surface).

Hard failures are things that are objectively checkable and clinically unsafe or
structurally broken. Warnings are heuristics that false-positive — they inform,
never block. Nothing in here scores clinical *reasoning*; that stays with the
coach, plan-check, and the plan editor, exactly as on the API path.

The gate is PURE and deterministic: no network, no model, no clock dependence.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

# ── Severity-bearing finding ─────────────────────────────────────────────────


@dataclass
class GateFinding:
    severity: str          # "HARD" | "WARN"
    section: str           # e.g. "supplement_suggestions"
    code: str              # machine-readable, e.g. "unknown_slug"
    message: str           # coach-readable, says what to DO
    target: str = ""       # the offending slug / test name, when there is one

    def line(self) -> str:
        tag = "✗ HARD" if self.severity == "HARD" else "⚠ WARN"
        loc = f" [{self.target}]" if self.target else ""
        return f"  {tag} {self.section}.{self.code}{loc}: {self.message}"


@dataclass
class GateReport:
    hard_failures: list = field(default_factory=list)
    warnings: list = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.hard_failures

    def as_dict(self) -> dict:
        return {
            "ok": self.ok,
            "hard_failures": [f.__dict__ for f in self.hard_failures],
            "warnings": [f.__dict__ for f in self.warnings],
        }

    def render(self) -> str:
        out = []
        if self.hard_failures:
            out.append(f"{len(self.hard_failures)} HARD failure(s) — assessment NOT saved:")
            out += [f.line() for f in self.hard_failures]
        if self.warnings:
            out.append(f"{len(self.warnings)} warning(s) — saved, review these:")
            out += [f.line() for f in self.warnings]
        if not out:
            out.append("Gate clean — 0 hard failures, 0 warnings.")
        return "\n".join(out)


# ── Heuristic tables ─────────────────────────────────────────────────────────

# Phrases that mean nothing to a specific client. The API SYSTEM prompt calls
# this the BANNED-GENERIC rule; here it is a warning because prose matching
# false-positives (a phrase can be legitimate inside a longer specific sentence).
_BANNED_GENERIC = (
    "eat a balanced diet", "drink plenty of water", "get enough sleep",
    "reduce stress", "exercise regularly", "eat healthy", "stay hydrated",
    "in moderation", "listen to your body", "everything in moderation",
    "as tolerated",
)

# Renal / urate markers that suppress the protein push (project protein rule).
_RENAL_NEEDLES = ("uric acid", "creatinine", "egfr", "bun", "urea")

# Text that signals a protein *push* rather than a neutral mention.
_PROTEIN_PUSH = ("protein", "whey", "high-protein", "high protein")

_VALID_CONTINUE = {"new", "continue", "adjust", "stop"}


def _norm(s: Any) -> str:
    return str(s or "").strip().lower()


def _resolve(idx: dict, slug: Any) -> Optional[str]:
    """Alias-aware slug resolution. Returns the canonical slug or None."""
    return idx.get(_norm(slug))


# ── Main entry point ─────────────────────────────────────────────────────────


def validate(
    suggestions: Any,
    *,
    cat: Any = None,
    client: Optional[dict] = None,
    subgraph: Optional[dict] = None,
    drug_context: Optional[dict] = None,
) -> GateReport:
    """Run the full battery.

    suggestions : dict | AssessSuggestions — the payload about to be persisted.
    cat         : fmdb.validator.Loaded — catalogue, for alias-aware slug checks.
    client      : client.yaml as a dict — meds, conditions, labs on file.
    subgraph    : build_subgraph() output — for the off-subgraph WARNING only.
                  Off-subgraph-but-real is a warning, not a failure: the coach
                  legitimately knows things the subgraph walk didn't surface.
    drug_context: _collect_drug_context() output — protocol_cautions.
    """
    rep = GateReport()

    # ---- 1. Schema (HARD) — everything downstream assumes this shape --------
    payload: dict
    try:
        from fmdb.assess.results import AssessSuggestions

        if hasattr(suggestions, "model_dump"):
            payload = suggestions.model_dump()
        else:
            payload = AssessSuggestions.model_validate(suggestions or {}).model_dump()
    except Exception as e:  # noqa: BLE001 — any validation error is a hard fail
        rep.hard_failures.append(GateFinding(
            "HARD", "schema", "invalid",
            f"payload does not satisfy AssessSuggestions: {type(e).__name__}: {e}. "
            "Fix the shape and resubmit.",
        ))
        return rep  # nothing else is meaningful on a malformed payload

    _check_slugs(rep, payload, cat, subgraph)
    _check_supplements(rep, payload, cat, client, drug_context)
    _check_labs(rep, payload, client)
    _check_protein(rep, payload, client)
    _check_prose(rep, payload)
    return rep


# ── 2. Slug integrity ────────────────────────────────────────────────────────


def _check_slugs(rep: GateReport, payload: dict, cat: Any, subgraph: Optional[dict]) -> None:
    """Every catalogue reference must resolve (alias-aware). Unknown → HARD,
    because an unknown slug becomes a CRITICAL plan-check finding that blocks
    publishing (the Manju failure). Real-but-off-subgraph → WARN only."""
    if cat is None:
        rep.warnings.append(GateFinding(
            "WARN", "slugs", "catalogue_unavailable",
            "catalogue not loaded — slug integrity NOT verified this run.",
        ))
        return

    from fmdb.validator import _resolve_index

    idx = {
        "topic": _resolve_index(cat.topics),
        "mechanism": _resolve_index(cat.mechanisms),
        "symptom": _resolve_index(cat.symptoms),
        "supplement": _resolve_index(cat.supplements),
        "protocol": _resolve_index(getattr(cat, "protocols", []) or []),
        "cooking_adjustment": _resolve_index(getattr(cat, "cooking_adjustments", []) or []),
        "home_remedy": _resolve_index(getattr(cat, "home_remedies", []) or []),
        "tissue_salt": _resolve_index(getattr(cat, "tissue_salts", []) or []),
    }

    # Slugs the subgraph actually offered — used for the softer warning.
    sub_slugs: set = set()
    if subgraph:
        for v in subgraph.values():
            if isinstance(v, list):
                for item in v:
                    if isinstance(item, dict) and item.get("slug"):
                        sub_slugs.add(_norm(item["slug"]))

    # (section, kind, list-of-slug-extractor)
    targets = [
        ("likely_drivers", "mechanism",
         [d.get("mechanism_slug") for d in payload.get("likely_drivers") or []]),
        ("topics_in_play", "topic",
         [t.get("topic_slug") for t in payload.get("topics_in_play") or []]),
        ("additional_symptoms_to_screen", "symptom",
         [s.get("symptom_slug") for s in payload.get("additional_symptoms_to_screen") or []]),
        ("supplement_suggestions", "supplement",
         [s.get("supplement_slug") for s in payload.get("supplement_suggestions") or []]),
        ("suggested_protocols", "protocol",
         [p.get("protocol_slug") for p in payload.get("suggested_protocols") or []]),
    ]
    nutrition = payload.get("nutrition_suggestions") or {}
    if isinstance(nutrition, dict):
        targets.append(("nutrition_suggestions", "cooking_adjustment",
                        list(nutrition.get("cooking_adjustment_slugs") or [])))
        targets.append(("nutrition_suggestions", "home_remedy",
                        list(nutrition.get("home_remedy_slugs") or [])))

    ts = payload.get("tissue_salts")
    if isinstance(ts, dict):
        targets.append(("tissue_salts", "tissue_salt",
                        [s.get("salt_slug") for s in (ts.get("salts") or [])]))

    # Slugs the author already declared as "not in the catalogue yet" — the API
    # path is told to route these to catalogue_additions_suggested instead of
    # inventing them, so honour that here rather than double-punishing.
    declared_new = {
        _norm(c.get("name")) for c in payload.get("catalogue_additions_suggested") or []
    }

    for section, kind, slugs in targets:
        for slug in slugs:
            if not slug:
                continue
            canonical = _resolve(idx[kind], slug)
            if canonical is None:
                if _norm(slug) in declared_new:
                    rep.warnings.append(GateFinding(
                        "WARN", section, "new_catalogue_entity",
                        f"{slug!r} is not in the catalogue but IS declared in "
                        "catalogue_additions_suggested — it will be dropped from the "
                        f"draft plan until a {kind} entry exists.",
                        target=str(slug),
                    ))
                else:
                    rep.hard_failures.append(GateFinding(
                        "HARD", section, "unknown_slug",
                        f"{slug!r} does not resolve to any catalogue {kind} "
                        "(alias-aware). Use a real slug, or add it to "
                        "catalogue_additions_suggested. An unknown slug becomes a "
                        "CRITICAL plan-check finding and blocks publishing.",
                        target=str(slug),
                    ))
            elif sub_slugs and _norm(canonical) not in sub_slugs:
                rep.warnings.append(GateFinding(
                    "WARN", section, "off_subgraph",
                    f"{slug!r} is a real catalogue {kind} but was not in the "
                    "subgraph offered for this assessment — fine if deliberate, "
                    "but check it belongs to this client's picture.",
                    target=str(slug),
                ))


# ── 3. Supplement safety ─────────────────────────────────────────────────────


def _check_supplements(
    rep: GateReport,
    payload: dict,
    cat: Any,
    client: Optional[dict],
    drug_context: Optional[dict],
) -> None:
    """Contraindications, med interactions, drug-caution avoid_supplement, and
    the continue_or_change enum (a bad value silently un-does a de-prescribing
    instruction — see the cl-022 ashwagandha inversion)."""
    supps = payload.get("supplement_suggestions") or []
    if not supps:
        return

    # 3a. continue_or_change enum — checkable without any catalogue.
    for s in supps:
        val = _norm(s.get("continue_or_change") or "new")
        if val not in _VALID_CONTINUE:
            rep.hard_failures.append(GateFinding(
                "HARD", "supplement_suggestions", "bad_continue_or_change",
                f"continue_or_change={s.get('continue_or_change')!r} is not one of "
                f"{sorted(_VALID_CONTINUE)}. 'stop' is what keeps a de-prescribed "
                "item OUT of the protocol — a wrong value silently turns it into a "
                "prescription.",
                target=str(s.get("supplement_slug") or ""),
            ))

    # 3b. Catalogue-driven safety.
    if cat is not None and client:
        from fmdb.validator import _resolve_index

        supp_idx = _resolve_index(cat.supplements)
        by_slug = {getattr(x, "slug", ""): x for x in cat.supplements}
        conds = {_norm(c) for c in (client.get("active_conditions") or [])}
        meds_raw = list(client.get("current_medications") or []) + list(
            client.get("medications") or []
        )
        meds = {_norm(m) for m in meds_raw if m}

        for s in supps:
            slug = s.get("supplement_slug")
            canonical = _resolve(supp_idx, slug)
            supp = by_slug.get(canonical) if canonical else None
            if supp is None:
                continue  # unknown slug already reported as HARD in _check_slugs

            contra = getattr(supp, "contraindications", None)
            for cond in (getattr(contra, "conditions", []) or []):
                if _norm(cond) in conds:
                    rep.hard_failures.append(GateFinding(
                        "HARD", "supplement_suggestions", "contraindicated_condition",
                        f"{slug!r} is contraindicated with the client's active "
                        f"condition {cond!r}. Remove it or justify explicitly.",
                        target=str(slug),
                    ))

            inter = getattr(supp, "interactions", None)
            for mi in (getattr(inter, "with_medications", []) or []):
                med_name = _norm(getattr(mi, "medication", ""))
                if not med_name:
                    continue
                # substring both ways: "metformin" vs "Janumet 50/500 (metformin)"
                if any(med_name in m or m in med_name for m in meds if len(m) > 3):
                    itype = _norm(getattr(getattr(mi, "type", None), "value", ""))
                    sev = "HARD" if itype == "avoid_together" else "WARN"
                    bucket = rep.hard_failures if sev == "HARD" else rep.warnings
                    bucket.append(GateFinding(
                        sev, "supplement_suggestions", "medication_interaction",
                        f"{slug!r} interacts with the client's medication "
                        f"{getattr(mi, 'medication', '')!r}: "
                        f"{getattr(mi, 'reason', '') or itype or 'interaction on file'}",
                        target=str(slug),
                    ))

            tier = _norm(getattr(getattr(supp, "evidence_tier", None), "value", ""))
            if tier in ("confirm_with_clinician", "fm_specific_thin") and not _norm(
                s.get("evidence_tier_caveat")
            ):
                rep.warnings.append(GateFinding(
                    "WARN", "supplement_suggestions", "missing_tier_caveat",
                    f"{slug!r} is catalogue tier {tier!r} but carries no "
                    "evidence_tier_caveat — the client-facing text should say so.",
                    target=str(slug),
                ))

    # 3c. Drug cautions — an avoid_supplement caution is a hard constraint.
    for m in ((drug_context or {}).get("matched") or []):
        for caution in (m.get("protocol_cautions") or []):
            if _norm(caution.get("kind")) != "avoid_supplement":
                continue
            item = _norm(caution.get("item"))
            if not item:
                continue
            for s in supps:
                slug = _norm(s.get("supplement_slug"))
                if not slug:
                    continue
                if item in slug or slug in item:
                    sev = _norm(caution.get("severity"))
                    is_hard = sev in ("critical", "warning")
                    bucket = rep.hard_failures if is_hard else rep.warnings
                    bucket.append(GateFinding(
                        "HARD" if is_hard else "WARN",
                        "supplement_suggestions", "drug_caution_avoid_supplement",
                        f"{s.get('supplement_slug')!r} is flagged avoid_supplement "
                        f"({sev or 'unspecified'}) by the client's medication "
                        f"{m.get('drug_name') or m.get('drug_slug')!r}: "
                        f"{caution.get('reason') or 'see drug catalogue'}",
                        target=str(s.get("supplement_slug") or ""),
                    ))


# ── 4. Lab orders ────────────────────────────────────────────────────────────


def _check_labs(rep: GateReport, payload: dict, client: Optional[dict]) -> None:
    """Never re-order a marker already on file as if it were new. The API path
    did exactly this on Archana (vitamin D, 5 days old). A repeat is legitimate —
    but it must be declared `kind: "repeat"` so downstream dedup can see it."""
    labs = payload.get("lab_followups") or []
    if not labs or not client:
        return

    on_file: set = set()
    for snap in client.get("health_snapshots") or []:
        if not isinstance(snap, dict):
            continue
        for lv in snap.get("lab_values") or []:
            if isinstance(lv, dict) and lv.get("test_name"):
                on_file.add(_norm(lv["test_name"]))
    for m in client.get("lab_markers") or []:
        if isinstance(m, dict) and m.get("marker_name"):
            on_file.add(_norm(m["marker_name"]))
    if not on_file:
        return

    # Duplicate orders within the payload itself (the 6x oestrogen-metabolite bug).
    seen: set = set()
    for lab in labs:
        test = _norm(lab.get("test"))
        if not test:
            continue
        if test in seen:
            rep.hard_failures.append(GateFinding(
                "HARD", "lab_followups", "duplicate_order",
                f"{lab.get('test')!r} is listed more than once. Order it once.",
                target=str(lab.get("test") or ""),
            ))
            continue
        seen.add(test)

        if _norm(lab.get("kind")) == "repeat":
            continue  # explicitly a re-check — fine

        # The danger this check guards against is re-ordering (and re-billing) a
        # marker the author DIDN'T REALISE was already on file. An author who
        # wrote "repeat"/"recheck" in the test name has plainly realised — that's
        # a labelling slip, not a clinical error, so warn instead of blocking.
        # The structured `kind` field is what downstream dedup actually reads, so
        # the warning still asks for it.
        declared_repeat = bool(
            re.search(r"\b(repeat|recheck|re-check|re-test|retest|follow-?up)\b", test)
        )
        for name in on_file:
            # 4+ chars avoids the "if"/"MMA" false-positive trap.
            if len(name) >= 4 and (name in test or test in name):
                if declared_repeat:
                    rep.warnings.append(GateFinding(
                        "WARN", "lab_followups", "repeat_not_structured",
                        f"{lab.get('test')!r} reads as a repeat of {name!r} (already on "
                        'file) but has no kind: "repeat". Downstream dedup reads the '
                        "structured field, not the name — set it.",
                        target=str(lab.get("test") or ""),
                    ))
                else:
                    rep.hard_failures.append(GateFinding(
                        "HARD", "lab_followups", "already_on_file",
                        f"{lab.get('test')!r} matches {name!r}, already on file for this "
                        "client. Either cite the existing value in your reasoning, or "
                        'mark it kind: "repeat" if a re-check is genuinely intended.',
                        target=str(lab.get("test") or ""),
                    ))
                break


# ── 5. Protein rule ──────────────────────────────────────────────────────────


def _protein_suppressed(client: dict) -> bool:
    """Mirror of generate-week-menu.py's rule, kept in lockstep deliberately."""
    try:
        from protein_logic import calc_protein_target  # type: ignore

        t = calc_protein_target(client)
        if t and t.get("suppressed"):
            return True
    except Exception:  # pragma: no cover — protein_logic lives in scripts/
        pass
    for m in client.get("lab_markers") or []:
        if not isinstance(m, dict):
            continue
        if _norm(m.get("flag")) == "high" and any(
            n in _norm(m.get("marker_name")) for n in _RENAL_NEEDLES
        ):
            return True
    return False


def _check_protein(rep: GateReport, payload: dict, client: Optional[dict]) -> None:
    """Never push protein on a renal/urate-flagged client (project rule)."""
    if not client or not _protein_suppressed(client):
        return

    nutrition = payload.get("nutrition_suggestions") or {}
    adds = list(nutrition.get("add") or []) if isinstance(nutrition, dict) else []
    for a in adds:
        low = _norm(a)
        if any(p in low for p in _PROTEIN_PUSH):
            rep.hard_failures.append(GateFinding(
                "HARD", "nutrition_suggestions", "protein_on_renal_flag",
                "this client has a renal/urate marker flagged high — protein must be "
                f"kept MODERATE, not pushed. Offending line: {str(a)[:90]!r}",
            ))
    for s in payload.get("supplement_suggestions") or []:
        if "whey" in _norm(s.get("supplement_slug")) or "protein" in _norm(
            s.get("supplement_slug")
        ):
            rep.hard_failures.append(GateFinding(
                "HARD", "supplement_suggestions", "protein_on_renal_flag",
                "protein supplement suggested for a client with a renal/urate marker "
                "flagged high. Remove it unless a clinician has cleared it.",
                target=str(s.get("supplement_slug") or ""),
            ))


# ── 6. Prose quality (warnings only) ─────────────────────────────────────────


def _check_prose(rep: GateReport, payload: dict) -> None:
    """Generic filler in client-facing text. WARN, never HARD — a phrase can be
    legitimate inside a longer, specific sentence, so this false-positives."""
    fields = []
    for s in payload.get("supplement_suggestions") or []:
        fields.append(("supplement_suggestions", s.get("rationale")))
    for l in payload.get("lifestyle_suggestions") or []:
        fields.append(("lifestyle_suggestions", l.get("details") or l.get("name")))
    for e in payload.get("education_framings") or []:
        fields.append(("education_framings", e.get("client_facing_summary")))
    nutrition = payload.get("nutrition_suggestions") or {}
    if isinstance(nutrition, dict):
        for a in (nutrition.get("add") or []):
            fields.append(("nutrition_suggestions", a))

    for section, text in fields:
        low = _norm(text)
        if not low:
            continue
        for phrase in _BANNED_GENERIC:
            if phrase in low:
                rep.warnings.append(GateFinding(
                    "WARN", section, "banned_generic",
                    f"generic filler {phrase!r} — say something true of THIS client "
                    "instead. Offending text: " + str(text)[:80],
                ))
                break
