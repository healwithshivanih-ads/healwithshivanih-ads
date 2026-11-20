"""What a body age report concludes from its rows: section status, the next step it offers, the buyer's
tags and segment, the testimonial that matches, and which results connect.

Nothing here writes a sentence a buyer reads except the connection paragraphs, which are the approved ones.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional

from .levels import rank
from .panel import Row, Section, all_rows, b12_high

OLDER_BY_YEARS = 3            # body age more than this many years above calendar age counts as "older"
CREDIT_DAYS = 14              # the report fee comes off a Foundation session up to and including this day
FOUNDATION_LIST_INR = 12000
FOUNDATION_AFTER_INR = {"standard": 7000, "deeper": 2000}   # her round figures, 19 Nov 2026


def _counts(r: Row) -> bool:
    """A calculated score never sets a status or an offer by itself; the scarring score is the exception."""
    return (not r.calc) or r.key == "fib4"


def set_section_status(sec: Section) -> None:
    rows = [r for r in sec.rows if _counts(r)]
    loud = [r for r in rows if not r.quiet]          # a quiet row (total IgE, urine) takes its section to "watch" at most
    work = [r for r in loud if rank(r.level) >= 2 and r.nature == "work"]
    deep = [r for r in loud if rank(r.level) >= 2 and r.nature != "work"]
    if work:
        sec.status, sec.key = "needs attention", "att"
    elif deep:
        sec.status, sec.key = "needs a deeper look", "att"
    elif any(r.level for r in rows):
        sec.status, sec.key = "watch", "watch"
    else:
        sec.status, sec.key = "steady", "steady"


@dataclass
class Group:
    key: str
    level: str
    nature: str
    section: str
    extra: bool = False           # an explained extra result: just outside its range, it does not count towards the session offer


def groups_of(sections: list[Section]) -> list[Group]:
    """One entry per finding: the cholesterol family is one finding, not six."""
    out: dict[str, Group] = {}
    for s in sections:
        for r in s.rows:
            if not _counts(r) or not r.level:
                continue
            lv = "A" if r.quiet else r.level          # quiet rows never bring the session offer by themselves (D4, D6)
            g = out.get(r.group)
            if g is None or rank(lv) > rank(g.level):
                out[r.group] = g = Group(r.group, lv, r.nature, s.id, extra=g.extra if g else True)
            g.extra = g.extra and r.extra
    return list(out.values())


@dataclass
class Connection:
    id: str
    title: str = ""               # empty = drawn on the map only
    text: str = ""
    a: str = ""
    b: str = ""
    note: tuple[str, ...] = ()
    notepos: tuple[int, int] = (0, 0)
    draft: bool = False           # wording Shivani has not approved yet (wording.DRAFT lists it for her)


@dataclass
class Decision:
    outcome: str                  # nothing | self | foundation | doctor_only | doctor_soon
    segment: Optional[str]        # longevity_customer | None
    tags: list[str]
    soon: list[str]               # level D results: the report tells the buyer to see a doctor in the next day or two
    deep_rows: list[str]          # row keys marked "needs a deeper look"
    testimonials: list[str]       # thyroid | sugar, each printed in its own section
    connections: list[Connection] = field(default_factory=list)
    body_age_gap: float = 0.0     # body age minus calendar age


def _lvl(rows: dict[str, Row], key: str) -> int:
    r = rows.get(key)
    return rank(r.level) if r else 0


def _glv(rows: dict[str, Row], group: str) -> int:
    return max((rank(r.level) for r in rows.values() if r.group == group and _counts(r)), default=0)


def _state(rows: dict[str, Row], key: str) -> str:
    r = rows.get(key)
    return r.state if r else ""


def _low(rows: dict[str, Row], key: str) -> bool:
    r = rows.get(key)
    return bool(r and r.level and r.side == "low")


def connections_for(sections: list[Section], deeper: bool) -> list[Connection]:
    rows = all_rows(sections)
    lipids = max((rank(r.level) for r in rows.values() if r.group == "lipids" and _counts(r)), default=0)
    tsh = rows.get("tsh")
    tsh_high = bool(tsh and tsh.level and tsh.hi is not None and tsh.value > tsh.hi)
    ins = rows.get("insulin")
    out: list[Connection] = []
    if tsh_high and lipids >= 1:
        out.append(Connection(
            "thyroid_arteries", "Thyroid and arteries",
            "A raised thyroid signal and a raised particle load often travel together, because thyroid hormone helps the liver "
            "clear those particles from the blood. It is one reason the thyroid result comes first.",
            "thyroid", "art", ("thyroid hormone helps", "clear these particles"), (20, 190)))
    if _lvl(rows, "tg") == 1 and _lvl(rows, "hba1c") == 1 and ins and ins.value < 5:      # "both a little high": level A only
        out.append(Connection(
            "sugar_fats", "Sugar and fats",
            "Your triglycerides and your three-month sugar average are both a little high while your insulin is very low. "
            "That is an unusual pair. It is one to look at again at your next test before anyone acts on it.",
            "art", "sugar", ("fats and sugar both a little high", "while insulin is low: an unusual pair"), (300, 372)))
    if deeper and _lvl(rows, "hcy") >= 2 and b12_high(rows):
        out.append(Connection(
            "hcy_b12", "Homocysteine and B12",
            "Your homocysteine is high although your B12 is well above range. With B12 this full, a simple shortage is unlikely "
            "to be the cause, so this pair needs a deeper look together.",
            "hcy", "b12", ("high, although", "B12 is full"), (552, 150)))
    if _lvl(rows, "hcy") >= 1 and lipids >= 1:
        out.append(Connection("hcy_arteries", a="hcy", b="art", note=("a marker of", "artery wear"), notepos=(338, 262)))
    # connections written after the approved samples (drafts): told in words, not drawn on the map
    for cid, title, cond in (
        ("sugar_liver", "Sugar and liver", _glv(rows, "sugar") >= 1 and (_state(rows, "hsi") == "out" or _glv(rows, "liver_enzymes") >= 1)),
        ("inflammation_arteries", "Inflammation and arteries", _lvl(rows, "hscrp") >= 2 and lipids >= 1),
        ("iron_haemoglobin", "Iron and haemoglobin", deeper and _low(rows, "hb") and _low(rows, "tsat")),
        ("b12_haemoglobin", "B12 and haemoglobin", deeper and _low(rows, "hb") and _low(rows, "b12")),
        ("vitd_alp", "Vitamin D and bone", deeper and _low(rows, "vitd") and _lvl(rows, "alp") >= 1),
    ):
        if cond:
            out.append(Connection(cid, title, draft=True))
    return out


def decide(sections: list[Section], *, body_age: float, age: int, deeper: bool) -> Decision:
    for s in sections:
        set_section_status(s)
    rows = all_rows(sections)
    groups = groups_of(sections)
    gap = round(body_age - age, 1)

    clear = [g for g in groups if rank(g.level) >= 2]
    clear_own = [g for g in clear if g.nature != "inherited"]
    edge = [g for g in groups if rank(g.level) == 1]
    edge_main = [g for g in edge if not g.extra]      # three small things bring the offer; the extras are not counted
    if any(r.level == "D" for r in rows.values()):
        outcome = "doctor_soon"          # the strongest level: the doctor comes first and no session is offered
    elif clear_own or gap > OLDER_BY_YEARS or len(edge_main) >= 3:
        outcome = "foundation"
    elif clear and not edge:
        outcome = "doctor_only"          # inherited and far enough out for a doctor, everything else steady
    elif clear or edge:
        outcome = "self"
    else:
        outcome = "nothing"
    segment = "longevity_customer" if outcome in ("nothing", "self") else None

    tags = [f"{g.key}:{g.level}" for g in sorted(groups, key=lambda g: (-rank(g.level), g.key))]
    tags.append("body_age:" + ("older" if gap > OLDER_BY_YEARS else "younger" if gap < -OLDER_BY_YEARS else "level"))
    conns = connections_for(sections, deeper)
    tags += [f"pattern:{c.id}" for c in conns if c.title]
    if b12_high(rows):
        tags.append("b12_high")
    if not groups:
        tags.append("steady")

    status = {s.id: s.status for s in sections}
    testimonials = [k for k in ("thyroid", "sugar") if status.get(k, "steady") != "steady"]
    return Decision(
        outcome=outcome, segment=segment, tags=tags,
        soon=[f"{r.name} {r.value:g} {r.unit}".strip() for r in rows.values() if r.level == "D"],
        deep_rows=[r.key for r in sorted(rows.values(), key=lambda r: -rank(r.level))
                   if _counts(r) and rank(r.level) >= 2 and r.nature != "work" and not r.quiet],
        testimonials=testimonials, connections=conns, body_age_gap=gap)


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    y, m = d.year + y, m + 1
    last = (date(y + (m == 12), (m % 12) + 1, 1) - timedelta(days=1)).day
    return date(y, m, min(d.day, last))


def next_test_date(sample_date: date, sections: list[Section]) -> date:
    """Four months when the report has something to work on, about a year when it is steady all through."""
    return add_months(sample_date, 4 if any(s.status != "steady" for s in sections) else 12)


def credit_deadline(report_date: date) -> date:
    return report_date + timedelta(days=CREDIT_DAYS)
