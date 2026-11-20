"""The body age report as one HTML page: the approved layout, filled from a Report.

Section order, headings and class names are the approved sample's, so the approved stylesheets
(assets/report.css, assets/print.css) lay it out unchanged.
"""
from __future__ import annotations

import base64
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from . import wording as W
from .panel import NINE, Row, num, rng

ASSETS = Path(__file__).with_name("assets")
BACK = '<p class="back"><a href="#contents">Back to contents</a></p>'
# No "read by" or "reviewed by" anywhere (Shivani, 19 Nov 2026): the report is "from / prepared by" the brand.
# The brand name is embargoed until Sat 2 Jan 2027, 20:00 IST; scripts/body-age-report.py refuses to make a real
# buyer's report before then, and these two lines plus pdf.HEAD_L are the only places the name is printed.
PREPARED_BY = "Sequoya by Shivani Hari"


@lru_cache(maxsize=1)
def fonts_css() -> str:
    """The @font-face rules with each font file inlined, so the page needs no network."""
    css = (ASSETS / "fonts" / "fonts.css").read_text()

    def inline(m: re.Match) -> str:
        data = base64.b64encode((ASSETS / "fonts" / m.group(1)).read_bytes()).decode()
        return f"url(data:font/woff2;base64,{data})"
    return re.sub(r"url\(([^)]+\.woff2)\)", inline, css)


def ringmark(cls: str = "mark", opacity: float | None = None) -> str:
    svg = (ASSETS / "ring-mark.svg").read_text()
    svg = re.sub(r'\swidth="\d+"\sheight="\d+"', "", svg, count=1)
    attr = f'class="{cls}" aria-hidden="true" ' if cls else ""
    if opacity is not None:
        attr += f'opacity="{opacity}" '
    return svg.replace("<svg ", f"<svg {attr}", 1)


def ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def rings_svg(age: int, body_age: float, labels: bool = True) -> str:
    """A tree cross-section: one ring per year of age, the body-age ring drawn in the accent.

    When body age is above calendar age the extra rings are drawn outside the age ring, so the marked
    ring is always on the page."""
    thin, hot, bark, ink = "#2A292D", "#C94A77", "#2A292D", "#A93860"
    mark = max(1, round(body_age))
    total = max(age, mark)
    radii, r = [], 4.0
    for i in range(1, total + 1):
        r += 2.05 + 0.75 * math.sin(i * 12.9898) * math.sin(i * 0.7)
        radii.append(r)
    scale = 140 / radii[-1]

    def pt(rad: float, t: float, k: int) -> tuple[float, float]:
        rr = rad * scale * (1 + 0.05 * math.sin(t + 0.6) + 0.032 * math.sin(2 * t + 2.1)
                            + 0.02 * math.sin(3 * t + 4.0)) + 0.5 * math.sin(5 * t + k * 1.7)
        return rr * math.cos(t) + 4, rr * math.sin(t) - 3
    out = []
    for i, rad in enumerate(radii, 1):
        pts = [pt(rad, 2 * math.pi * j / 72, i) for j in range(72)]
        d = "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + "Z"
        if i == mark:
            out.append(f'<path d="{d}" fill="none" stroke="{hot}" stroke-width="2.6" stroke-linejoin="round"/>')
        elif i == age:
            out.append(f'<path d="{d}" fill="none" stroke="{bark}" stroke-width="3.4" stroke-linejoin="round"/>')
        else:
            out.append(f'<path d="{d}" fill="none" stroke="{thin}" stroke-width="0.55" opacity="0.42" stroke-linejoin="round"/>')
    out.append('<circle cx="4" cy="-3" r="2.6" fill="#A0673F"/>')
    h = 300
    if labels:
        h = 396
        ax, ay = pt(radii[mark - 1], math.radians(118), mark)
        bx, by = pt(radii[age - 1], math.radians(62), age)
        out.append(f'<path d="M{ax:.1f} {ay:.1f} Q{ax - 30:.1f} {ay + 50:.1f} -112 172" fill="none" stroke="{ink}" stroke-width="1.3" stroke-linecap="round"/>')
        out.append(f'<text x="-150" y="190" font-family="Caveat, cursive" font-size="21" fill="{ink}">about {round(body_age)} · where your blood reads</text>')
        out.append(f'<path d="M{bx:.1f} {by:.1f} Q{bx + 22:.1f} {by + 40:.1f} 112 198" fill="none" stroke="{bark}" stroke-width="1.3" stroke-linecap="round"/>')
        where = "the outer ring" if age >= mark else "the dark ring"
        out.append(f'<text x="150" y="220" text-anchor="end" font-family="Caveat, cursive" font-size="21" fill="{bark}">{age} · your age, {where}</text>')
    return (f'<svg class="rings" viewBox="-160 -160 320 {h}" role="img" aria-label="{rings_alt(age, body_age)}">' + "".join(out) + "</svg>")


def rings_alt(age: int, body_age: float) -> str:
    return (f"A tree cross-section with {age} rings, one for each year of age. "
            f"The {ordinal(max(1, round(body_age)))} ring is marked: body age about {round(body_age)}.")


def bar(r: Row) -> str:
    """One result drawn against its range."""
    v, kind, a, b = r.value, r.kind, r.a, r.b
    if kind == "none":
        return ""
    if kind == "range":
        w = b - a
        smin, smax = max(0, a - 0.55 * w), b + 0.55 * w
        smin, smax = min(smin, v * 0.9), max(smax, v * 1.08)
        zones, ticks = [(smin, a, "out"), (a, b, "ok"), (b, smax, "out")], [a, b]
    elif kind == "max":
        smin, smax = 0, max(a * 1.75, v * 1.12)
        zones, ticks = [(0, a, "ok"), (a, smax, "out")], [a]
    elif kind == "min":
        smin, smax = a * 0.35, max(a * 2.3, v * 1.15)
        zones, ticks = [(smin, a, "out"), (a, smax, "ok")], [a]
    else:
        w = b - a
        smin, smax = max(0, a - 1.6 * w), b + 1.6 * w
        smin, smax = min(smin, v * 0.8), max(smax, v * 1.1)
        zones, ticks = [(smin, a, "ok"), (a, b, "mid"), (b, smax, "out")], [a, b]

    def pos(x: float) -> float:
        return max(0.0, min(100.0, 100 * (x - smin) / (smax - smin)))
    z = "".join(f'<i class="z {c}" style="left:{pos(lo):.1f}%;width:{pos(hi) - pos(lo):.1f}%"></i>' for lo, hi, c in zones if hi > lo)
    tick = num if kind == "z3" else rng
    t = "".join(f'<s style="left:{pos(x):.1f}%">{tick(x)}</s>' for x in ticks)
    p = max(1.5, min(98.5, pos(v)))
    return f'<div class="rb" role="img" aria-label="result against range">{z}<b class="{r.state}" style="left:{p:.1f}%"></b>{t}</div>'


def squares(states: list[str]) -> str:
    order = sorted(states, key=["ok", "mid", "out"].index)
    return '<span class="sq" aria-hidden="true">' + "".join(f'<i class="{s}"></i>' for s in order) + "</span>"


def marker_rows(rows: list[Row], deep_rows: list[str]) -> str:
    out = []
    for r in rows:
        said = {"ok": "in range", "mid": "middle zone"}.get(r.state) or W.distance(r)
        deep = r.key in deep_rows
        out.append(
            f'<li class="m {r.state}{" deep" if deep else ""}"><div class="mn"><b>{r.name}</b>{" <em>calculated</em>" if r.calc else ""}'
            + (f"<span>{r.gloss}</span>" if r.gloss else "") + ('<i class="dk">needs a deeper look</i>' if deep else "") + "</div>"
            f'<div class="mv"><b>{num(r.value)}</b> <span>{r.unit}</span><small>{said}</small></div>'
            f'<div class="mb">{bar(r)}<span class="rt">{r.rtxt}</span></div></li>')
    return "".join(out)


def report_main(rp: Any) -> str:
    """The <main> of the report. `rp` is a build.Report."""
    deeper = rp.kind == "deeper"
    n_meas = sum(1 for s in rp.sections for r in s.rows if not r.calc)
    n_calc = sum(1 for s in rp.sections for r in s.rows if r.calc)
    toc = [("first", "Read this first"), ("glance", "At a glance"), ("adds", "What is in this report"), ("bodyage", "What your body age means")]
    toc += [(s.id, s.name) for s in rp.sections]
    toc += [("onebody", "Reading it as one body"), ("next", "Your next test"), ("fh", "What a functional health coach does"),
            ("summary", "Your report on one page"), ("help", "Your next step"), ("methods", "Methods and references")]
    no = {i: f"{k:02d}" for k, (i, _) in enumerate(toc, 1)}

    def head(i: str, t: str) -> str:
        return f'<div class="sh"><span class="no">{no[i]}</span><h2>{t}</h2></div>'

    sec_html, glance = [], []
    for s in rp.sections:
        states = [r.state for r in s.rows]
        inr_, n = states.count("ok"), len(states)
        glance.append(
            f'<tr><td><a href="#{s.id}">{s.name}</a><span class="mobst {s.key}">{s.status}</span></td>'
            f'<td class="st {s.key}">{s.status}</td>'
            f'<td>{squares(states)}<span class="cnt">{inr_} of {n} in range</span></td></tr>')
        fig = rp.figures.get(s.id)
        figure = f'<h3>{fig[0]}</h3><div class="viz">{fig[1]}</div>' if fig else ""
        text = rp.section_text[s.id]
        reads = W.READS[s.id] + (W.THYROID_READS_DEEPER if s.id == "thyroid" and deeper and any(r.key in ("ft4", "ft3") for r in s.rows) else "")
        unit = (f'{head(s.id, s.name)}<span class="status {s.key}">{s.status}</span><p class="headline">{text[0]}</p>'
                + (f'<p class="inline">{squares(states)} {inr_} of {n} in range</p>' if s.key == "steady" else "")
                + f'<h3>What this section reads</h3><p class="edu">{reads}</p>{figure}'
                f'<h3>Your results · {n} markers, {inr_} in range</h3><ul class="ml">{marker_rows(s.rows, rp.decision.deep_rows)}</ul>')
        tail = ('<h3>What it means for you</h3><div class="means">' + "".join(f"<p><b>{a}.</b> {b}</p>" for a, b in text[1]) + "</div>"
                f'<h3>What moves these numbers</h3><p class="edu">{W.MOVES[s.id]}</p>')
        if s.id in rp.decision.testimonials:
            tail += W.TESTIMONIAL[s.id]
        sec_html.append(f'<section id="{s.id}"><div class="unit">{unit}</div>{tail}{BACK}</section>')

    nine = "".join(
        f'<li class="m {r.state}"><div class="mn"><b>{r.name}</b></div>'
        f'<div class="mv"><b>{num(r.value)}</b> <span>{r.unit}</span></div><div class="mb">{bar(r)}<span class="rt">{r.rtxt}</span></div></li>'
        for r in (rp.rows[k] for k in NINE if k in rp.rows))

    stand_html = "".join(
        f'<li><div class="t"><b><a href="#{x["id"]}" style="text-decoration:none">{x["name"]}</a></b><span class="status {x["key"]}">{x["status"]}</span></div>'
        f'<p>{x["text"]}</p><p class="n">{x["nums"]}</p></li>' for x in rp.stand)
    todo = "".join(f'<li><span class="num">{i}</span><div><p class="tag">{t["tag"].lower()} <small>· {t["when"]}</small></p><p>{t["text"]}</p></div></li>'
                   for i, t in enumerate(rp.todo, 1))
    gapw, _n = W.gap_words(rp.decision.body_age_gap)
    lede = f"Your blood reads {gapw}."
    means, chol_tail = rp.body_age_means
    glance_fig = f'<div class="viz body">{rp.figures["glance"][1]}</div>' if "glance" in rp.figures else ""
    onebody_fig = f'<div class="viz">{rp.figures["onebody"][1]}</div>' if "onebody" in rp.figures else ""
    conn = [c for c in rp.decision.connections if c.title]
    onebody = ("".join(f"<p><b>{c.title}.</b> {c.text}</p>" for c in conn) if conn
               else f"<p>{rp.onebody_none}</p>")

    sm = rp.summary
    steady = "".join(f'<li><a href="#{s.id}">{s.name}</a></li>' for s in rp.sections if s.key == "steady")
    cols = f'<div class="sb"><h3>Steady</h3><p class="sl">Nothing to do here.</p><ul>{steady}</ul></div>' if steady else ""
    if sm["work"]:
        cols += ('<div class="sb"><h3>What we can work on</h3><p class="sl">Food, movement and sleep move these within months.</p><ul>'
                 + "".join(f'<li><a href="#{i}">{n}</a><small>{t}</small></li>' for n, t, i in sm["work"]) + "</ul></div>")
    if sm["deep"]:
        cols += ('<div class="sb deep"><span class="dlabel">needs a deeper look</span><p class="sl">Blood shows these are off. It cannot show why. '
                 "That takes your history and a few further tests.</p><ul>"
                 + "".join(f'<li><a href="#{i}">{n}</a><small>{t}</small></li>' for n, t, i in sm["deep"]) + "</ul></div>")

    st = rp.step
    paras = '<div class="means">' + "".join(f"<p>{p}</p>" for p in st["paras"]) + "</div>"
    if st["outcome"] == "foundation":
        call = (f'<a class="call" href="{rp.book_url}">Book your session</a>' if rp.book_url else '<span class="call">Book your session</span>')
        help_html = (f'<p class="headline">{st["headline"]}</p>{paras}<ol class="steps"><li><div class="st"><b>A Foundation session, online</b>'
                     f'<span>{W.inr(st["price"])}</span></div><p class="cr">{st["credit"]}</p><ul class="for">'
                     + "".join(f"<li><b>{a}.</b> {b}</li>" for a, b in st["steps"]) + f"</ul><p>{call}</p></li></ol>"
                     f'<p class="fresh">{st["fresh"]}</p><h3>And after that</h3><div class="means"><p>{st["after"]}</p></div>')
    else:
        help_html = f'<p class="headline">{st["headline"]}</p>{paras}'

    nt = rp.next_text
    name = rp.name
    sample_fine = " Sample report: the values belong to a test profile." if rp.sample else ""
    return f"""<main>
<header class="head">{ringmark()}<div><p class="brand">{"Body age report, with deeper tests" if deeper else "Body age report"}</p><p class="sub">{"Whole-body blood results, plus vitamins, minerals, iron, the free thyroid hormones and metals" if deeper else "With your whole-body blood results, system by system"}</p></div>{'<span class="stamp">Sample</span>' if rp.sample else ""}</header>
<p class="who">A wellness report from {PREPARED_BY}.</p>
<dl class="meta">
<div><dt>Name</dt><dd>{name}</dd></div><div><dt>Age and sex</dt><dd>{rp.age}, {"male" if rp.sex == "M" else "female"}</dd></div><div><dt>Report no.</dt><dd>{rp.report_no}</dd></div>
<div><dt>Reading</dt><dd>First</dd></div><div><dt>Sample collected</dt><dd>{W.day(rp.sample_date)}, {rp.collected}</dd></div><div><dt>Report issued</dt><dd>{W.day(rp.report_date)}</dd></div>
<div><dt>Markers covered</dt><dd>{n_meas} measured, {n_calc} calculated, and body age</dd></div><div><dt>Prepared by</dt><dd>{PREPARED_BY}</dd></div><div><dt>Next test due</dt><dd>{W.day(rp.next_test)}</dd></div>
</dl>

<section id="first" style="margin-top:44px">{head("first", "Read this first")}
<div class="two"><div><h1>Your body age is <em>{W.ba_text(rp.body_age)}</em>. You are {rp.age}.</h1><p class="lede">{lede}</p></div>
<figure>{rings_svg(rp.age, rp.body_age)}</figure></div>
{f'<h3>What stands out</h3><ul class="stand">{stand_html}</ul>' if rp.stand else ""}
<p class="rest">{rp.rest}</p>
<h3>What to do about it</h3><ol class="todo">{todo}</ol>{f'<p class="keep">{W.KEEP}</p>' if rp.keep else ""}
<div class="letter lettersep"><p>Dear {name},</p>{"".join(f"<p>{x}</p>" for x in rp.letter)}
<p>This page is the whole report in brief. Everything behind it is the detail: each result against its range, system by system, with what it means.</p></div>
<p class="sign">Shivani</p><p class="signed">Shivani Hari · certified functional health coach (IAFM, FMCA)</p>
<p class="fine">This is a wellness report. A steady result does not rule out illness, so if something feels wrong, have it looked at.</p></section>

<p class="navh" id="contents">The rest of this report</p>
<nav aria-label="Contents">{"".join(f'<a href="#{i}"><i>{no[i]}</i>{t}</a>' for i, t in toc[1:])}</nav>

<section id="glance">{head("glance", "At a glance")}{glance_fig}
<table class="glance"><tbody>{"".join(glance)}</tbody></table>
<p class="key"><span><span class="sq"><i class="ok"></i></span> in range</span><span><span class="sq"><i class="mid"></i></span> middle zone</span><span><span class="sq"><i class="out"></i></span> outside range</span><span>One square is one marker.</span></p></section>

<section id="adds">{head("adds", "What is in this report")}
<p class="headline">Your body age, worked out from your own blood, and what is moving it.</p>
<ul class="adds">
<li><b>Your body age.</b> One number, calculated from nine values in your blood, set against your age.</li>
<li><b>Each body system, read for you.</b> Where every result sits, what it means for your days, and what moves it.</li>
<li><b>What connects.</b> Your thyroid and your arteries, your sugar and your liver, read together as one body. <a href="#onebody">Section {no["onebody"]}</a> shows what connects in yours.</li>
<li><b>Where to start.</b> {W.word(len(rp.todo)).capitalize()} thing{"s" if len(rp.todo) != 1 else ""}, in order.</li>
<li><b><a href="#next">A date to test again.</a></b> So the next reading shows what changed.</li>
</ul>
<p class="fine">Alongside your {n_meas} measured results, it works out {n_calc} scores and your body age.</p></section>

<section id="bodyage">{head("bodyage", "What your body age means")}
<p class="headline">Two people can share a birthday and not be the same age.</p>
<div class="means story">
<p>Think of two people who are both {rp.age}. One takes the stairs without thinking and shakes off a cold in two days. The other is tired by mid-afternoon and takes a fortnight to recover. They have had the same number of birthdays. Their bodies have not aged at the same pace.</p>
<p>Body age is a way of measuring that pace. Researchers in the United States took routine blood results from a large national health study and asked a simple question: which ordinary values best tell apart the people who stay well from the people who do not? Nine of them did most of the work. Read together with your age, they give the age your blood looks, whatever your birth certificate says.</p>
</div>
<h3>What the research found</h3>
<div class="means"><p>The measure was then checked in a second group of 11,432 adults, who were followed for about twelve years. Three things stood out.</p>
<ol class="found">
<li><b>It tracked who lived longer.</b> Those whose body age ran behind their birthday were less likely to die over the following twelve years. Those whose body age ran ahead were more likely to. The link held for younger and older adults, and across education and lifestyle.</li>
<li><b>It held in people who looked healthy.</b> The link was there even among people with no diagnosed disease and a normal weight.</li>
<li><b>It moved with illness.</b> The more conditions a person had, the older their body age read, step by step.</li>
</ol></div>
<h3>What it means for you</h3>
<div class="means"><p>{means}</p>
<p>A tree lays down a ring every year: wide in a good year, narrow in a hard one. Your blood keeps a similar record, and unlike a birthday, the reading can move in either direction. If your markers improve, the number comes down with them. Nobody has yet shown that a lower number by itself means a longer life, so we use it as a direction to steer by and read it again at each test.</p></div>
<h3>What it does not tell you</h3>
<div class="means"><p><b>It does not read cholesterol.</b> None of the nine values is a cholesterol number, so a young body age says nothing about your arteries. That is why this report reads the heart separately{chol_tail}</p>
<p><b>It is not a diagnosis or a prediction for one person.</b> It was built on a US population and is still being tested in others. Your age is itself one of the inputs. A cold, a hard workout or a poor night before the test can nudge a single reading, so the direction over two or three tests is what counts.</p></div>
<h3>The nine values behind your number</h3><ul class="ml">{nine}</ul>
</section>

{"".join(sec_html)}

<section id="onebody">{head("onebody", "Reading it as one body")}<p class="headline">Results are filed by organ. Bodies do not work that way, so here is what connects across sections.</p>{onebody_fig}
<div class="means">{onebody}</div></section>

<section id="next">{head("next", "Your next test")}<span class="status steady">{W.day(rp.next_test)}</span>
<p class="headline">{nt["headline"]}</p>
<h3>When to come back</h3>
<ul class="adds">
{"".join(f"<li>{x}</li>" for x in nt["when"])}
</ul>
<h3>What to expect</h3>
<div class="means">{"".join(f"<p><b>{a}.</b> {b}</p>" for a, b in nt["expect"])}</div></section>

<section id="fh">{head("fh", "What a functional health coach does")}<div class="means">{"".join(f"<p>{x}</p>" for x in W.FH)}</div></section>

<section id="summary">{head("summary", "Your report on one page")}
<p class="headline">{sm["headline"]}</p>
<div class="sum">
{cols}
</div>
<p class="rest">{sm["where"]}</p>
</section>

<section id="help">{head("help", "Your next step")}
{help_html}
</section>

<section id="methods">{head("methods", "Methods and references")}
<p class="edu">Blood was collected at home and analysed by an independent diagnostic laboratory, whose pathologists sign off every result. Measured results are shown against that laboratory's reference range; cholesterol, LDL and triglycerides use the standard three-tier categories. Calculated scores use the published formulas below, with their usual cut-offs.</p>
<ol class="refs">{"".join(f"<li>{r}</li>" for r in W.REFS)}</ol>
<p class="fine">Ranges here are for adults who are not pregnant. If you take medicine for thyroid, sugar, blood pressure or cholesterol, do not change it because of this report.</p>
<p class="fine">This is a wellness report. It does not diagnose, treat or prescribe.{sample_fine}</p></section>
</main>"""


def report_html(rp: Any, extra_css: str = "") -> str:
    """The whole printable page: fonts inlined, the approved stylesheets, then the paper rules."""
    css = (ASSETS / "report.css").read_text()
    prn = (ASSETS / "print.css").read_text()
    title = f"Body age report, {rp.name}, {W.day(rp.sample_date)}"
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{title}</title>'
            f"<style>{fonts_css()}</style><style>{css}</style></head><body>{report_main(rp)}"
            f"<style>{prn}{extra_css}</style></body></html>")
