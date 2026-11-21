"""Body age report: from one person's lab results to everything the report says.

    make_report(person, labs, kind=..., sample_date=..., report_date=...)  ->  Report

`person` is a client.yaml-shaped dict (a report buyer is stored like a prospect: no sign-up, no plan).
`labs` is one draw's `lab_values`. Nothing here spends money or sends anything.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Optional

from fmdb.assess.client_context import lab_client_context
from fmdb.assess.lab_ratios import compute_ratios

from . import viz, wording as W
from .decide import (FOUNDATION_AFTER_INR, FOUNDATION_LIST_INR, Decision, credit_deadline, decide, groups_of,
                     next_test_date)
from .findings import hits_in
from .levels import load_cutoffs
from .panel import NINE, Row, Section, all_rows, build_sections, num, unlisted_out_of_range

KINDS = ("standard", "deeper")


class ReportError(ValueError):
    """The report cannot be built from this record; the message says what is missing."""


@dataclass
class Report:
    kind: str
    name: str
    age: int
    sex: str
    sample_date: date
    report_date: date
    next_test: date
    deadline: date
    body_age: float
    report_no: str
    collected: str
    sample: bool
    book_url: Optional[str]
    foundation_after: int
    foundation_list: int
    sections: list[Section]
    rows: dict[str, Row]
    decision: Decision
    figures: dict[str, tuple[str, str]] = field(default_factory=dict)
    hits: dict = field(default_factory=dict)              # {section id: its findings, the main one first}
    section_text: dict[str, tuple[str, list[tuple[str, str]]]] = field(default_factory=dict)
    stand: list[dict] = field(default_factory=list)
    rest: str = ""
    todo: list[dict] = field(default_factory=list)
    keep: bool = False
    letter: list[str] = field(default_factory=list)
    body_age_means: tuple[str, str] = ("", ".")
    onebody_none: str = ""
    next_text: dict = field(default_factory=dict)
    summary: dict = field(default_factory=dict)
    step: dict = field(default_factory=dict)
    drafts: list[str] = field(default_factory=list)       # unapproved sentences this report carries
    missing: list[str] = field(default_factory=list)      # results with no wording: the report must not go out
    warnings: list[str] = field(default_factory=list)
    cutoffs_status: str = "provisional"

    @property
    def ready(self) -> bool:
        """True when nothing stops this report from being shown to its buyer."""
        return not self.missing and (self.sample or self.cutoffs_status == "approved")

    def record(self) -> dict:
        """What is kept on the buyer's record (client.yaml#body_age_reports)."""
        return {
            "report_no": self.report_no, "kind": self.kind, "sample_date": self.sample_date.isoformat(),
            "report_date": self.report_date.isoformat(), "body_age": self.body_age, "age_at_sample": self.age,
            "outcome": self.decision.outcome, "segment": self.decision.segment, "tags": list(self.decision.tags),
            "next_test": self.next_test.isoformat(), "credit_until": self.deadline.isoformat(),
        }


def _d(v: Any, what: str) -> date:
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError as e:
        raise ReportError(f"{what} is not a date: {v!r}") from e


def first_name(person: dict) -> str:
    n = str(person.get("display_name") or "").strip()
    return n.split()[0] if n else ""


def make_report(
    person: dict,
    labs: list[dict],
    *,
    kind: str,
    sample_date: Any,
    report_date: Any,
    name: Optional[str] = None,
    book_url: Optional[str] = None,
    collected: str = "at home, fasting",
    sample: bool = False,
    report_no: Optional[str] = None,
    cutoffs: Optional[dict] = None,
) -> Report:
    if kind not in KINDS:
        raise ReportError(f"kind must be one of {KINDS}, not {kind!r}")
    sd, rd = _d(sample_date, "sample date"), _d(report_date, "report date")
    if rd < sd:
        raise ReportError("the report date is before the sample date")
    ctx = lab_client_context(person, today=sd)            # age and body size as they were on the sample date
    if ctx.get("age_source") != "dob" or not ctx.get("age"):
        raise ReportError("a date of birth is needed: body age is scored at the exact age on the sample date")
    if ctx.get("sex") not in ("M", "F"):
        raise ReportError("sex (M or F) is needed: several ranges and cut-offs depend on it")
    labs = [dict(l, date_drawn=l.get("date_drawn") or sd.isoformat()) for l in labs if isinstance(l, dict)]
    if not labs:
        raise ReportError(f"no lab values on file for {sd.isoformat()}")
    markers = compute_ratios(labs, ctx)
    pa = next((m for m in markers if "phenoage" in str(m.get("marker_name", "")).lower()), None)
    if pa is None:
        raise ReportError("body age cannot be worked out: one of its nine blood values is missing "
                          "(albumin, creatinine, fasting glucose, hs-CRP, lymphocyte %, MCV, RDW, ALP, white cell count)")
    c = cutoffs or load_cutoffs()
    deeper = kind == "deeper"
    sections = build_sections(labs, markers, sex=ctx["sex"], deeper=deeper, cutoffs=c)
    rows = all_rows(sections)
    age, body_age = int(ctx["age"]), round(float(pa["value"]), 1)
    decision = decide(sections, body_age=body_age, age=age, deeper=deeper)
    who = name or first_name(person)
    if not who:
        raise ReportError("a name is needed for the letter")
    cid = str(person.get("client_id") or "").replace("cl-", "")
    rp = Report(
        kind=kind, name=who, age=age, sex=ctx["sex"], sample_date=sd, report_date=rd,
        next_test=next_test_date(sd, sections), deadline=credit_deadline(rd), body_age=body_age,
        report_no=report_no or f"BA-{'D' if deeper else 'S'}-{cid or 'X'}-{sd:%y%m%d}", collected=collected, sample=sample,
        book_url=book_url, foundation_after=FOUNDATION_AFTER_INR[kind], foundation_list=FOUNDATION_LIST_INR,
        sections=sections, rows=rows, decision=decision, cutoffs_status=c["status"])
    rp.warnings = [r.warn for r in rows.values() if r.warn]
    rp.warnings += [f"body age input missing from the tables: {k}" for k in NINE if k not in rows]
    rp.warnings += unlisted_out_of_range(labs)
    have = {x.id for x in sections}
    # the sections added on 20 Nov 2026 (allergy and autoimmune, pancreas, urine) are simply absent from an older draw
    want = ["heart", "sugar", "liver", "thyroid", "kidneys", "blood"] + (["nutrients", "metals"] if deeper else [])
    rp.warnings += [f"no results on file for the '{w}' section, so it is left out of the report" for w in want if w not in have]
    _write(rp)
    if deeper:
        groups = groups_of(sections)
        rp.figures = viz.figures_for(sections, decision.connections, rows, groups, num)
        m = viz.map_for(sections, decision.connections, rows, groups)
        if m and viz.overlaps(m[0], m[1]):
            rp.missing.append(f"map: labels overlap {viz.overlaps(m[0], m[1])}; this combination of results needs a layout")
    return rp


def _write(rp: Report) -> None:
    """Every sentence in the report, chosen from the wording library."""
    lib = W.Lib()
    deeper = rp.kind == "deeper"
    rp.hits = {s.id: hits_in(s) for s in rp.sections}
    for s in rp.sections:
        head, means = W.section_text(s, rp.rows, deeper, lib, rp.sex, rp.hits[s.id])
        rp.section_text[s.id] = (head, means + W.note_paras(s, rp.rows, lib))
    # page 1 lists an explained extra only when it is clearly off or far out (D7)
    order = [s for s in rp.sections if s.key == "att"] + [s for s in rp.sections if s.key == "watch" and not W.small_extras_only(rp.hits[s.id])]
    rp.stand = [dict(id=s.id, name=s.name, status=s.status, key=s.key, text=rp.section_text[s.id][0],
                     nums=W.stand_numbers(s, rp.rows, rp.hits[s.id])) for s in order[:3]]
    rp.rest = W.rest_line(rp, lib)
    rp.todo = W.todo_steps(rp, lib)
    g, i, h = rp.rows.get("glucose"), rp.rows.get("insulin"), rp.rows.get("homa")
    rp.keep = bool(g and g.state == "ok" and not g.level and ((i and i.state == "ok") or (h and h.state == "ok")))
    rp.letter = W.letter(rp, lib)
    rp.body_age_means = W.body_age_means(rp, lib)
    for c in rp.decision.connections:
        if c.title and c.draft:
            c.text = W.connection_text(c, lib)
    if not any(c.title for c in rp.decision.connections):
        rp.onebody_none = lib.d("onebody.none")
    rp.next_text = W.next_test(rp, lib)
    rp.summary = W.summary(rp, lib)
    rp.step = W.next_step(rp, lib)
    rp.drafts, rp.missing = lib.drafts, lib.missing
    for hs in rp.hits.values():           # a result nobody wrote a block for, clearly off: the coach should look at it herself
        for h in hs:
            if h.is_generic and h.level == "B":
                r = h.rows[0]
                rp.warnings.append(f"{r.name} {num(r.value)} is clearly outside its range and has only the catch-all wording: read it yourself")
