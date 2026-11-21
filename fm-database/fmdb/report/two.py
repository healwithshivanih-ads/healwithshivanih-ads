"""Body age report for two: the page two people share, alongside each person's own full report.

    make_two(report_a, report_b)  ->  Two          (two finished build.Report objects)
    two_html(two)                 ->  the printable page (pdf.build_two_pdf prints it)

The design is the four-page sample Shivani approved on 19 Nov 2026 (body-age-report-for-two-sample.pdf). Eight
sections, in its order: the two of you · side by side · where you are alike · where you differ · the two of you
on one page · your own reports · your next test · your next step.

Every sentence on the page comes from one of three places, and `Said` records which for each one (`Two.sources`):

  a  SAMPLE     the approved sample's own wording, word for word, with names, dates, counts and he/she filled in.
                tests/fixtures/body_age/approved_two_sample.txt is that sample's text; a test fails if a SAMPLE
                entry is not in it.
  b  OWN        a sentence already approved in that person's own report (their letter, section headlines, page-1
                lines, one-page summary, next-step block), reused as it is. On this page it is printed after the
                person's name in bold, so "your" is never ambiguous.
  c  DRAFT      a sentence the sample had no case for. It lives in wording.DRAFT under a "two." key, is listed in
                `Two.drafts`, and keeps `Two.ready` false until Shivani approves it (wording.APPROVED_DRAFTS).

Rules carried over from the single report and hers alone to change: the next step follows each person's own
decide.py outcome; a Foundation session is offered by name to the person who needs it, at their own price and
date, and never to the partner; a page that offers no session quotes no price; doctor wording is always the
person's own approved sentence (so nothing is called urgent and the sample's older "as well" is not printed);
body age is a whole number ("about 42"), as in the single report since 19 Nov 2026.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Optional

from . import wording as W
from .build import Report, ReportError
from .page import ASSETS, PREPARED_BY, fonts_css, ringmark, rings_svg, squares

# ── a: the approved sample, word for word ────────────────────────────────────
SAMPLE: dict[str, str] = {
    "title": "Body age report for two",
    "sub": "The page you share, alongside your own two reports",
    "meta.collected": "{date}, at home, same morning",
    "meta.own": "One each, attached to the same email",
    "meta.next": "{date}, together",
    "h1": "The two of you", "h2": "Side by side", "h3": "Where you are alike", "h4": "Where you differ",
    "h5": "The two of you on one page", "h6": "Your own reports", "h7": "Your next test", "h8": "Your next step",
    "rings": "One ring for each year of your age. The coloured ring is where your blood reads.",
    "dear": "Dear {a} and {b},",
    "letter.younger": "You are both reading younger than your years, which is a good place to start from together.",
    "letter.kitchen": "You share a kitchen, and it shows: the one thing on watch for both of you is sugar.",
    "letter.differ": "Where you differ is {whose} {parts}.",
    "letter.steadier": "{name}, yours is the steadier report.",
    "alike.title": "{thing}, for both of you.",
    "alike.sugar": ("Each of you has a calm morning reading and a three-month average sitting a little high. Two people rarely "
                    "arrive at the same pattern by chance. It usually comes from what is on the table, and when."),
    "alike.change.title": "One change you can make together.",
    "alike.change": "A ten-minute walk after your largest meal, every day until your next test.",
    "differ.detail": "Your own report has the detail.",
    "page.share": "The average you share.",
    "page.none": "Nothing.",
    "own": ("Each of you has a full report with every result against its range, as its own PDF attached to the same email. "
            "Read your own first, and share it when you are ready."),
    "next.headline": "One home visit, one morning, both of you.",
    "step.deep": "{count} in your report {need} a deeper look.",
    "step.why": ("Blood shows what is off. It cannot show why. That takes {whose} history: how {he} eats and sleeps, what {he} takes, "
                 "what runs in {his} family, and when things began to change."),
    "offer.title": "A Foundation session for {name}, online",
    "offer.price": "{price} if you book by {deadline}, {full} after that.",
    "offer.join": "{partner} is welcome to join.",
    "offer.before.label": "Before the session",
    "offer.before": ("{name} fills in {his} full history in {his} own time, about 25 minutes, one short section at a time. "
                     "This is the part blood cannot show."),
    "offer.in.label": "In the session",
    "offer.in": "It is online, by video call, wherever you are. I read {his} history against {his} report, and we go through both together.",
    "offer.tests.label": "Further tests",
    "offer.tests": ("{He} gets the short list worth doing, and I read those with you when they are back. Most people need two to four, "
                    "usually ₹1,000 to ₹5,000 in all, paid to the laboratory. You see the list and the price before you decide."),
    "offer.leave.label": "What {he} leaves with",
    "offer.leave": "Why {results}, as far as it can be known, and the order to work in, in a kitchen you share.",
    "offer.button": "Book your session",
    "fresh": ("These results show you both as you were on {sample_day}, and a deeper look is most use while they are fresh. "
              "That is why the lower price holds only until {deadline}."),
    "after.title": "And after that",
    "after": "Nothing, unless you want it. {names} {leaves} with the order to work in, and your next test will show what has moved for both of you.",
    "fine": "This is a wellness report. It does not diagnose, treat or prescribe.",
}

PRONOUN = {"M": dict(he="he", He="He", his="his"), "F": dict(he="she", He="She", his="her")}
# how the letter names a section that needs attention ("R.'s arteries and thyroid" in the sample); the rest are the
# subjects the single report's page-1 line already uses
PART = {"heart": "arteries", "thyroid": "thyroid", "sugar": "sugar", "liver": "liver", "kidneys": "kidneys", "blood": "blood count",
        "nutrients": "vitamins and iron", "metals": "metals", "immune": "allergy and autoimmune markers", "pancreas": "pancreas enzymes"}
WALK = "Walk for ten minutes after your largest meal, every day until your next test. It helps your body clear the sugar from that meal."


class TwoError(ReportError):
    """These two reports cannot share a page; the message says why."""


class Said:
    """Every sentence the page for two prints, with where it came from: "sample" (a), "own" (b) or "draft" (c)."""

    def __init__(self) -> None:
        self.lib = W.Lib()
        self.log: list[tuple[str, str, str]] = []          # (kind, key or where, the sentence)

    def a(self, key: str, **slots: Any) -> str:
        text = SAMPLE[key].format(**slots) if slots else SAMPLE[key]
        self.log.append(("sample", key, text))
        return text

    def b(self, text: str, where: str) -> str:
        text = _plain(text)
        self.log.append(("own", where, text))
        return text

    def d(self, key: str, **slots: Any) -> str:
        text = self.lib.d(key, **slots)
        self.log.append(("draft", key, text))
        return text


@dataclass
class Offer:
    who: Report
    title: str
    price: str
    line: str                                  # the price sentence, then the partner's welcome
    steps: list[tuple[str, str]]
    how: str                                   # the email's short "how it works" (the person's own approved email line)


@dataclass
class Two:
    a: Report
    b: Report
    kind: str
    sample_date: date
    report_date: date
    next_test: date
    names: str                                 # "R. and M."
    report_no: str
    letter: list[str] = field(default_factory=list)
    alike: list[tuple[str, str]] = field(default_factory=list)          # (bold lead, text)
    differ: list[tuple[str, str]] = field(default_factory=list)         # (name, text)
    one_page: list[dict] = field(default_factory=list)                  # per person: steady, work, deep
    next_text: str = ""
    step: dict = field(default_factory=dict)
    shared_average: bool = False               # the sample's case: both have a calm morning sugar and a slightly high average
    sources: list[tuple[str, str, str]] = field(default_factory=list)
    drafts: list[str] = field(default_factory=list)                     # this page's own unapproved sentences
    warnings: list[str] = field(default_factory=list)

    @property
    def people(self) -> tuple[Report, Report]:
        return self.a, self.b

    @property
    def all_drafts(self) -> list[str]:
        out = list(self.drafts)
        for rp in self.people:
            out += [d for d in rp.drafts if d not in out]
        return out

    @property
    def missing(self) -> list[str]:
        return [f"{rp.name}: {m}" for rp in self.people for m in rp.missing]

    @property
    def offered(self) -> list[Report]:
        return [o.who for o in self.step.get("offers", [])]

    @property
    def ready(self) -> bool:
        """True when nothing stops the page and both reports from being shown to their buyers."""
        return self.a.ready and self.b.ready and not self.all_drafts

    def record(self) -> dict:
        return {"report_no": self.report_no, "kind": self.kind, "names": self.names, "sample_date": self.sample_date.isoformat(),
                "report_date": self.report_date.isoformat(), "next_test": self.next_test.isoformat(),
                "people": [dict(rp.record(), name=rp.name) for rp in self.people],
                "session_offered_to": [rp.name for rp in self.offered]}


# ── small helpers ────────────────────────────────────────────────────────────
def _plain(t: str) -> str:
    """Own-report text without its in-document links (this page has no such sections to jump to)."""
    return re.sub(r"</?a\b[^>]*>", "", t)


def _lower(t: str) -> str:
    return t[:1].lower() + t[1:]


def _whose(name: str) -> str:
    return f"{name}'s"


def _marked(rp: Report) -> list[Any]:
    """The sections of a report that are not steady, leaving out one marked only by a small explained extra (as page 1 does)."""
    return [s for s in rp.sections if s.key != "steady" and not W.small_extras_only(rp.hits.get(s.id) or [])]


def _status(rp: Report) -> dict[str, str]:
    return {s.id: s.status for s in _marked(rp)}


def _average_pattern(rp: Report) -> bool:
    """A calm morning sugar with the three-month average just above the line: the pattern the sample's two people share
    (the same test the single report's one-page summary uses for "Your three-month sugar average, just above the line.")."""
    w = next((h for h in rp.hits.get("sugar") or [] if h.nature == "work" and not h.is_generic), None)
    return bool(w and w.finding.id == "sugar" and w.level == "A" and W._lv(rp.rows, "hba1c") == 1 and W._ok(rp.rows, "glucose")
                and not W._lv(rp.rows, "insulin"))


def _walks(rp: Report) -> bool:
    return any(t.get("tag") == "Start tonight" and t.get("text") == WALK for t in rp.todo)


# ── the page's text ──────────────────────────────────────────────────────────
def make_two(a: Report, b: Report, report_no: Optional[str] = None) -> Two:
    """The page two people share. `a` and `b` are their finished single reports: same kind, same morning."""
    if a.kind != b.kind:
        raise TwoError(f"both reports must be the same kind: {a.name}'s is {a.kind}, {b.name}'s is {b.kind}")
    if a.sample_date != b.sample_date:
        raise TwoError("the page for two is for one home visit: the two samples were collected on different days")
    if a.report_date != b.report_date:
        raise TwoError("both reports must carry the same report date (the 14-day price counts from it)")
    if a.name.strip().lower() == b.name.strip().lower():
        raise TwoError(f"the two people need different names on the page: both are {a.name!r}")
    said = Said()
    t = Two(a=a, b=b, kind=a.kind, sample_date=a.sample_date, report_date=a.report_date, next_test=min(a.next_test, b.next_test),
            names=f"{a.name} and {b.name}", report_no=report_no or f"{a.report_no}-and-{b.report_no}")
    sa, sb = _status(a), _status(b)
    shared = [s for s in a.sections if s.id in sa and sb.get(s.id) == sa[s.id]]          # marked the same for both
    t.shared_average = "sugar" in {s.id for s in shared} and _average_pattern(a) and _average_pattern(b)
    t.letter = _letter(t, said, sa, sb)
    t.alike = _alike(t, said, shared)
    t.differ = [_differ(rp, {s.id for s in shared}, said) for rp in t.people]
    t.one_page = [_one_page(rp, t, said) for rp in t.people]
    t.next_text = _next_test(t, said)
    t.step = _next_step(t, said)
    t.sources, t.drafts = said.log, said.lib.drafts
    for rp in t.people:
        t.warnings += [f"{rp.name}: {w}" for w in rp.warnings]
        t.warnings += [f"{rp.name}: {u}: the report asks them to see a doctor in the next day or two. Send it today." for u in rp.decision.soon]
    return t


def _letter(t: Two, said: Said, sa: dict[str, str], sb: dict[str, str]) -> list[str]:
    """The sample's letter when the two match its case; otherwise each person's own approved letter, one paragraph each."""
    a, b = t.a, t.b
    att = [[s for s in rp.sections if s.key == "att"] for rp in t.people]
    watch_both = [k for k in sa if sa[k] == "watch" == sb.get(k)]
    one_sided = bool(att[0]) != bool(att[1])
    if a.decision.body_age_gap <= -1.5 and b.decision.body_age_gap <= -1.5 and watch_both == ["sugar"] and one_sided:
        x, y = (a, b) if att[0] else (b, a)
        parts = W.join([PART.get(s.id, s.name.lower()) for s in (att[0] or att[1])])
        return [said.a("letter.younger"),
                " ".join([said.a("letter.kitchen"), said.a("letter.differ", whose=_whose(x.name), parts=parts),
                          said.a("letter.steadier", name=y.name)])]
    return [said.b(" ".join(rp.letter), f"{rp.name}: letter") for rp in t.people]


def _alike(t: Two, said: Said, shared: list[Any]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for s in shared:
        if s.id == "sugar" and t.shared_average:
            out.append((said.a("alike.title", thing="Sugar"), said.a("alike.sugar")))
        else:
            out.append((said.a("alike.title", thing=s.name), said.d("two.alike.other", status=s.status) + " " + said.a("differ.detail")))
    if not out:
        return [("", said.d("two.alike.none"))]
    if _walks(t.a) and _walks(t.b):          # both reports already start with this walk, in these words
        out.append((said.a("alike.change.title"), said.a("alike.change")))
    return out


def _differ(rp: Report, shared: set[str], said: Said) -> tuple[str, str]:
    """What is this person's alone: their own section headlines, and first of all a doctor-soon step if they have one."""
    lines = [said.b(x["text"], f"{rp.name}: page 1, see your doctor first") for x in rp.todo if x.get("tag") == "See your doctor first"]
    own = [s for s in _marked(rp) if s.id not in shared]
    lines += [said.b(rp.section_text[s.id][0], f"{rp.name}: {s.name} headline") for s in own]
    if own or lines:
        lines.append(said.a("differ.detail"))
    elif rp.rest:
        lines.append(said.b(rp.rest, f"{rp.name}: page 1, everything else is steady"))
    return rp.name, " ".join(lines)


def _one_page(rp: Report, t: Two, said: Said) -> dict:
    work = []
    for name, text, sid in rp.summary.get("work", []):
        shared = sid == "sugar" and t.shared_average
        work.append((name, said.a("page.share") if shared else said.b(text, f"{rp.name}: one-page summary, {name}")))
    deep = [(name, said.b(text, f"{rp.name}: one-page summary, {name}")) for name, text, _sid in rp.summary.get("deep", [])]
    return dict(name=rp.name, steady=[s.name for s in rp.sections if s.key == "steady"], work=work, deep=deep,
                none="" if deep else said.a("page.none"))


def _next_test(t: Two, said: Said) -> str:
    a, b = t.a, t.b
    if a.next_test == b.next_test:           # both have things to work on, or both are steady: the line both reports already carry
        return said.b(a.next_text["headline"], "both: next test headline")
    x, y = (a, b) if a.next_test < b.next_test else (b, a)
    return said.d("two.next.one_steady", whose=_whose(x.name), his=PRONOUN[x.sex]["his"], other=y.name)


def _clause(rp: Report, said: Said) -> str:
    deep = W.deep_hits(rp)
    if rp.decision.outcome == "foundation" and deep:
        k = len(deep)
        return said.a("step.deep", count=f"{W.word(k)} result{'s' if k != 1 else ''}", need="need" if k != 1 else "needs")
    return said.b(_lower(rp.step["headline"]), f"{rp.name}: next step headline")


def _offer(rp: Report, partner: Report, said: Said) -> Offer:
    p = PRONOUN[rp.sex]
    st = rp.step
    deep = W.deep_hits(rp)
    steps = [(said.a("offer.before.label"), said.a("offer.before", name=rp.name, **p)),
             (said.a("offer.in.label"), said.a("offer.in", **p)),
             (said.a("offer.tests.label"), said.a("offer.tests", **p))]
    if deep:
        k = len(deep)
        results = f"these {W.word(k)} results are where they are" if k != 1 else "this result is where it is"
        steps.append((said.a("offer.leave.label", **p), said.a("offer.leave", results=results)))
    else:                                    # nothing needs a deeper look: the person's own approved "what you leave with"
        label, text = st["steps"][-1]
        steps.append((said.b(label, f"{rp.name}: next step"), said.b(text, f"{rp.name}: next step, what you leave with")))
    price = W.inr(rp.foundation_after)
    line = said.a("offer.price", price=price, deadline=W.day(rp.deadline), full=W.inr(rp.foundation_list))
    return Offer(who=rp, title=said.a("offer.title", name=rp.name), price=price,
                 line=line + " " + said.a("offer.join", partner=partner.name), steps=steps,
                 how=said.b(st["email_how"], f"{rp.name}: email, how the session works"))


def _next_step(t: Two, said: Said) -> dict:
    """Each person's own outcome, side by side. A session is offered by name, at that person's price, to that person only."""
    a, b = t.a, t.b
    if a.decision.outcome == "nothing" == b.decision.outcome:
        return dict(headline=said.d("two.step.neither"), paras=[], offers=[], fresh="", after="")
    headline = " ".join(f"{rp.name}: {_clause(rp, said)}" for rp in t.people)
    paras: list[tuple[str, str]] = []            # (bold name or "", text)
    offers: list[Offer] = []
    for rp, partner in ((a, b), (b, a)):
        out, st = rp.decision.outcome, rp.step
        if out == "nothing":
            continue                             # as in the sample: the headline says it all
        raw = list(st["paras"])
        if out == "foundation":
            if W.deep_hits(rp):
                paras.append(("", said.a("step.why", whose=_whose(rp.name), **PRONOUN[rp.sex])))
                raw = raw[1:]                    # the sample's "why" stands in for the person's own first paragraph
            offers.append(_offer(rp, partner, said))
        elif out == "self" and rp.next_test != t.next_test:
            raw = []                             # their own line names their own later date; the shared date is in section 07
        own = [said.b(p, f"{rp.name}: next step") for p in raw]
        if own:
            paras.append((rp.name, " ".join(own)))
    fresh = after = ""
    if offers:
        fresh = said.a("fresh", sample_day=W.day(t.sample_date, year=False), deadline=W.day(offers[0].who.deadline))
        after = said.a("after", names=W.join([o.who.name for o in offers]), leaves="leaves" if len(offers) == 1 else "leave")
    return dict(headline=headline, paras=paras, offers=offers, fresh=fresh, after=after)


# ── the page ─────────────────────────────────────────────────────────────────
def head_right(t: Two) -> str:
    return f"{SAMPLE['title']} · {t.names} · sample collected {W.day(t.sample_date)}"


def title(t: Two) -> str:
    return f"{SAMPLE['title']}, {t.names}, {W.day(t.sample_date)}"


def gap_line(rp: Report) -> str:
    """Under each ring: "about ten years younger" (the single report's own words, without "than your age")."""
    return W.gap_words(rp.decision.body_age_gap)[0].replace(" than your age", "")


def two_main(t: Two) -> str:
    def head(n: int) -> str:
        return f'<div class="sh"><span class="no">{n:02d}</span><h2>{SAMPLE[f"h{n}"]}</h2></div>'

    def li(items: list[tuple[str, str]]) -> str:
        return "".join(f"<li><b>{n}</b>" + (f"<small>{x}</small>" if x else "") + "</li>" for n, x in items)

    def cell(rp: Report, sid: str) -> str:
        s = next((x for x in rp.sections if x.id == sid), None)
        return f'<td>{squares([r.state for r in s.rows])}<span class="cnt {s.key}">{s.status}</span></td>' if s else "<td></td>"

    a, b = t.a, t.b
    order = list(a.sections) + [s for s in b.sections if s.id not in {x.id for x in a.sections}]
    rows = "".join(f"<tr><td>{s.name}</td>{cell(a, s.id)}{cell(b, s.id)}</tr>" for s in order)
    pair = "".join(
        f'<div class="who2"><figure>{rings_svg(rp.age, rp.body_age, labels=False)}</figure><p class="nm">{rp.name}, {rp.age}</p>'
        f'<p class="ba">{W.ba_text(rp.body_age)}</p><p class="ln">{gap_line(rp)}</p></div>' for rp in t.people)
    alike = "".join(f"<p>{f'<b>{lead}</b> ' if lead else ''}{text}</p>" for lead, text in t.alike)
    differ = "".join(f"<p><b>{name}</b> {text}</p>" for name, text in t.differ)
    onepage = ""
    for p in t.one_page:
        cols = f'<div class="sb"><h3>Steady</h3><ul>{li([(n, "") for n in p["steady"]])}</ul></div>' if p["steady"] else ""
        if p["work"]:
            cols += f'<div class="sb"><h3>What we can work on</h3><ul>{li(p["work"])}</ul></div>'
        cols += (f'<div class="sb deep"><span class="dlabel">needs a deeper look</span><ul>{li(p["deep"])}</ul></div>' if p["deep"]
                 else f'<div class="sb"><h3>Needs a deeper look</h3><p class="none">{p["none"]}</p></div>')
        onepage += f'<p class="who3">{p["name"]}</p><div class="sum">{cols}</div>'
    st = t.step
    step = f'<p class="headline">{st["headline"]}</p>'
    if st["paras"]:
        step += '<div class="means">' + "".join(f"<p>{f'<b>{n}</b> ' if n else ''}{x}</p>" for n, x in st["paras"]) + "</div>"
    if st["offers"]:
        step += '<ol class="steps">'
        for o in st["offers"]:
            url = o.who.book_url
            call = (f'<a class="call" href="{url}">{SAMPLE["offer.button"]}</a>' if url else f'<span class="call">{SAMPLE["offer.button"]}</span>')
            step += (f'<li><div class="st"><b>{o.title}</b><span>{o.price}</span></div><p class="cr">{o.line}</p><ul class="for">'
                     + "".join(f"<li><b>{x}.</b> {y}</li>" for x, y in o.steps) + f"</ul><p>{call}</p></li>")
        step += (f'</ol><p class="fresh">{st["fresh"]}</p><h3>{SAMPLE["after.title"]}</h3>'
                 f'<div class="means"><p>{st["after"]}</p></div>')
    sample_fine = " Sample report: the values belong to a test profile." if a.sample or b.sample else ""
    stamp = '<span class="stamp">Sample</span>' if a.sample or b.sample else ""
    return f"""<main>
<header class="head">{ringmark()}<div><p class="brand">{SAMPLE["title"]}</p><p class="sub">{SAMPLE["sub"]}</p></div>{stamp}</header>
<p class="who">A wellness report from {PREPARED_BY}.</p>
<dl class="meta">
<div><dt>Names</dt><dd>{t.names}</dd></div><div><dt>Sample collected</dt><dd>{SAMPLE["meta.collected"].format(date=W.day(t.sample_date))}</dd></div><div><dt>Report issued</dt><dd>{W.day(t.report_date)}</dd></div>
<div><dt>Your own reports</dt><dd>{SAMPLE["meta.own"]}</dd></div><div><dt>Prepared by</dt><dd>{PREPARED_BY}</dd></div><div><dt>Next test due</dt><dd>{SAMPLE["meta.next"].format(date=W.day(t.next_test))}</dd></div>
</dl>

<section id="two-first" style="margin-top:34px">{head(1)}
<div class="pair">{pair}</div>
<p class="fine">{SAMPLE["rings"]}</p>
<div class="letter"><p>{SAMPLE["dear"].format(a=a.name, b=b.name)}</p>{"".join(f"<p>{x}</p>" for x in t.letter)}</div>
<p class="sign">Shivani</p><p class="signed">Shivani Hari · certified functional health coach (IAFM, FMCA)</p></section>

<section id="two-side">{head(2)}
<table class="both"><thead><tr><th></th><th>{a.name}</th><th>{b.name}</th></tr></thead><tbody>{rows}</tbody></table>
<p class="key"><span><span class="sq"><i class="ok"></i></span> in range</span><span><span class="sq"><i class="mid"></i></span> middle zone</span><span><span class="sq"><i class="out"></i></span> outside range</span><span>One square is one marker.</span></p></section>

<section id="two-alike">{head(3)}
<div class="means">{alike}</div></section>

<section id="two-differ">{head(4)}
<div class="means">{differ}</div></section>

<section id="two-page">{head(5)}
{onepage}</section>

<section id="two-own">{head(6)}
<div class="means"><p>{SAMPLE["own"]}</p></div></section>

<section id="two-test">{head(7)}<span class="status steady">{SAMPLE["meta.next"].format(date=W.day(t.next_test))}</span>
<p class="headline">{SAMPLE["next.headline"]}</p>
<div class="means"><p>{t.next_text}</p></div></section>

<section id="two-next">{head(8)}
{step}
<p class="fine" style="margin-top:22px">{SAMPLE["fine"]}{sample_fine}</p></section>
</main>"""


def two_html(t: Two, extra_css: str = "") -> str:
    """The whole printable page: the single report's fonts and stylesheets, then this page's own few rules."""
    css = (ASSETS / "report.css").read_text() + (ASSETS / "two.css").read_text()
    prn = (ASSETS / "print.css").read_text() + (ASSETS / "two-print.css").read_text()
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{title(t)}</title>'
            f"<style>{fonts_css()}</style><style>{css}</style></head><body>{two_main(t)}"
            f"<style>{prn}{extra_css}</style></body></html>")


def attachment_name(t: Two) -> str:
    return f"{title(t)}.pdf"


def sources_text(t: Two) -> str:
    """Where each sentence on the page came from, for the coach: one line per sentence."""
    label = {"sample": "approved sample", "own": "their own report", "draft": "DRAFT, not approved"}
    return "\n".join(f"[{label[k]}] ({where}) {text}" for k, where, text in t.sources)

