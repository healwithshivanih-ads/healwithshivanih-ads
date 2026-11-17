"""Pre-test confounders: things done before a blood draw that distort markers.

The coach records the client's answers once per draw as a `pretest` block on
the lab snapshot (`health_snapshots[].pretest`, validated by
`fmdb.plan.models.LabPretest`). `lab_client_context` passes the block for the
LATEST lab draw to `compute_ratios`, which calls `apply_confounders` last.

Each confounder that applies marks the markers it distorts:

    marker["confidence"] = "low"
    marker["confounded_by"] = ["Illness in the 3 weeks before", ...]

and appends one "Lower confidence: ..." sentence to the interpretation, so
every surface that already shows `fm_interpretation` carries the warning.
Nothing is re-flagged or hidden: the value stands, the read is softened.

No answers recorded → nothing changes (the synthesis says confounders are
unknown). Answers apply to the latest draw only; a marker whose newest value
came from an older report is still marked, a known simplification documented
in docs/claude/invariants-v0.81-v0.91.md — clients repeat the full panel.

Pure and deterministic: no API, no I/O.
"""
from __future__ import annotations

import re
from typing import Any

# Marker-name regexes (matched against compute_ratios' marker_name, lowercase).
_LIVER_ENZ = r"^alt\b|^ast\b|ast/alt|\bggt\b|hepatic steatosis|fatty liver index|^fib-?4"
_AST_ALT = r"^alt\b|^ast\b|ast/alt|hepatic steatosis|^fib-?4|creatine kinase|\bcpk\b|\bck\b|\bldh\b|lactate dehydrogenase"
_INFLAM = (r"hscrp|\bcrp\b|c-reactive|crp/albumin|\bsii\b|immune-inflammation|\bplr\b|"
           r"\bmlr\b|\bnlr\b|neutrophil/lymph|^wbc\b|ferritin|serum iron|transferrin sat|"
           r"^albumin\b|globulin|\besr\b|sedimentation|^platelets\b|phenoage")
_THYROID = (r"^tsh\b|free t[34]|total t[34]|reverse t3|tpo|thyroglobulin|tgab|t3/t4|"
            r"tsh/ft3|ft3/rt3|spina|tsh index|tshi")
_IMMUNO_OTHER = (r"vitamin d|vitamin b12|\bfolate\b|ferritin|estradiol|progesterone|"
                 r"testosterone|\blh\b|luteinising|\bfsh\b|follicle stim|prolactin|dhea|"
                 r"cortisol|\bpth\b|parathyroid|insulin\b|amh|troponin")
_FASTING = (r"fasting glucose|fasting insulin|homa|quicki|mcauley|triglycerides|^tyg|"
            r"lipid accumulation|tg/hdl|atherogenic index|remnant")
_ALCOHOL = (r"\bggt\b|triglycerides|^tyg|lipid accumulation|fatty liver index|tg/hdl|"
            r"atherogenic index|remnant|uric acid|mcauley")
_ESTROGEN = (r"hscrp|\bcrp\b|c-reactive|crp/albumin|\bshbg\b|triglycerides|total t[34]|"
             r"cortisol|testosterone|copper|zinc/copper|ceruloplasmin|mcauley|^tyg")
_CREATINE = r"^creatinine\b|egfr|bun/creatinine|phenoage"
_VITD = r"vitamin d|calcium|calcium/phosph|phosphorus"
_CYCLE = r"estradiol|progesterone|luteinising|\blh\b|follicle stim|\bfsh\b|lh/fsh"


def _rules(p: dict) -> list[tuple[str, str, str, str]]:
    """(key, label, marker regex, note) for every confounder the answers raise."""
    out: list[tuple[str, str, str, str]] = []
    if p.get("illness_3w"):
        note = str(p.get("illness_note") or "").strip()
        out.append((
            "illness_3w", "Illness in the 3 weeks before",
            _INFLAM + "|" + _LIVER_ENZ + "|free t3|t3/t4|tsh/ft3|spina",
            "an infection, cold or vaccine in the 3 weeks before raises CRP, ferritin and "
            "white counts, lowers albumin, iron and free T3, and can lift liver enzymes"
            + (f" ({note})" if note else "") + "; repeat once well before acting on it",
        ))
    if p.get("paracetamol_48h"):
        out.append((
            "paracetamol_48h", "Paracetamol in the 48 h before", _LIVER_ENZ,
            "paracetamol in the 48 h before can raise ALT/AST/GGT and the scores built on them",
        ))
    if p.get("alcohol_48h"):
        out.append((
            "alcohol_48h", "Alcohol in the 48 h before", _ALCOHOL,
            "alcohol in the 48 h before raises GGT, triglycerides and uric acid",
        ))
    if p.get("hard_exercise_72h"):
        out.append((
            "hard_exercise_72h", "Hard exercise in the 72 h before", _AST_ALT,
            "hard or new exercise (weights especially) in the 72 h before releases AST, "
            "ALT and CK from muscle for up to a week — GGT is not raised, so a normal GGT "
            "points to muscle, not liver",
        ))
    if p.get("biotin_72h"):
        out.append((
            "biotin_72h", "Biotin in the 72 h before", _THYROID + "|" + _IMMUNO_OTHER,
            "biotin (hair/skin/nail or B-complex supplements) in the 72 h before interferes "
            "with streptavidin immunoassays — TSH can read falsely low and FT4/FT3 falsely "
            "high (a fake 'over-active' picture); other hormone and vitamin assays can shift "
            "too. Repeat after 3 days off biotin",
        ))
    if p.get("high_dose_vitamin_d"):
        out.append((
            "high_dose_vitamin_d", "High-dose vitamin D", _VITD,
            "a recent high-dose or weekly bolus of vitamin D lifts 25-OH vitamin D for "
            "weeks and can raise calcium — read the level against the dosing schedule",
        ))
    route = str(p.get("hormone_route") or "")
    if route in ("oral_estrogen", "ocp"):
        what = "the combined pill" if route == "ocp" else "oral oestrogen (HRT)"
        out.append((
            "oral_estrogen", f"On {what}", _ESTROGEN,
            f"{what} passes through the liver and raises CRP, SHBG, triglycerides, "
            f"copper and binding proteins (so total T4/T3 and cortisol read high); "
            f"transdermal oestrogen does not",
        ))
    if p.get("creatine"):
        out.append((
            "creatine", "Taking creatine", _CREATINE,
            "creatine supplements raise blood creatinine, so eGFR reads falsely low — "
            "cystatin C is the creatine-proof kidney test",
        ))
    if p.get("fasted") is False:
        out.append((
            "not_fasted", "Not fasted", _FASTING,
            "the sample was not a true 8-12 h fast, so glucose, insulin and triglyceride "
            "readings (and the scores built on them) run high",
        ))
    out.extend(_cycle_rules(p))
    return out


def cycle_phase(day: int) -> str:
    if day <= 6:
        return "early follicular"
    if day <= 14:
        return "late follicular / ovulation window"
    if day <= 18:
        return "early luteal"
    if day <= 24:
        return "mid-luteal"
    return "late luteal"


def _cycle_rules(p: dict) -> list[tuple[str, str, str, str]]:
    if p.get("no_cycle"):
        return []
    day = p.get("cycle_day")
    if not isinstance(day, int) or day < 1:
        return [(
            "cycle_day_unknown", "Cycle day not recorded", _CYCLE,
            "sex hormones swing through the cycle and the day of the draw was not "
            "recorded, so these cannot be read against the right phase",
        )]
    phase = cycle_phase(day)
    if day <= 6:
        return [(
            "cycle_phase", f"Cycle day {day} ({phase})", r"progesterone",
            f"drawn on cycle day {day} ({phase}): progesterone is expected to be low "
            f"here and cannot show whether ovulation happened — that needs a mid-luteal "
            f"(about day 19-23) sample",
        )]
    if 19 <= day <= 24:
        return [(
            "cycle_phase", f"Cycle day {day} ({phase})",
            r"luteinising|\blh\b|follicle stim|\bfsh\b|lh/fsh|estradiol",
            f"drawn on cycle day {day} ({phase}): right for progesterone, but FSH, LH and "
            f"oestradiol are not at baseline — an early-follicular (day 2-5) sample reads "
            f"those",
        )]
    return [(
        "cycle_phase", f"Cycle day {day} ({phase})", _CYCLE,
        f"drawn on cycle day {day} ({phase}): neither the baseline (day 2-5) nor the "
        f"mid-luteal (day 19-23) window, so read these sex hormones loosely",
    )]


def apply_confounders(markers: list[dict[str, Any]], ctx: dict[str, Any] | None) -> list[dict]:
    """Mark the markers each recorded confounder distorts. Returns the list of
    confounders that applied: [{key, label, note, affects: [marker names]}]."""
    pretest = (ctx or {}).get("pretest")
    if not isinstance(pretest, dict) or not markers:
        return []
    applied: list[dict] = []
    for key, label, pattern, note in _rules(pretest):
        rx = re.compile(pattern, re.I)
        hit: list[str] = []
        for m in markers:
            name = str(m.get("marker_name") or "")
            if not rx.search(name):
                continue
            m["confidence"] = "low"
            by = m.setdefault("confounded_by", [])
            if label not in by:
                by.append(label)
                m["fm_interpretation"] = (
                    f"{m.get('fm_interpretation') or ''} Lower confidence: {note}."
                ).strip()
            hit.append(name)
        if hit:
            applied.append({"key": key, "label": label, "note": note, "affects": hit})
    return applied
