"""The draft wording, printed as one document for Shivani to approve.

    python -m fmdb.report.library_doc > wording-for-approval.md

Everything here is read straight from findings.py and wording.DRAFT, so the document is exactly what a report
would print. Sentences she has already approved are left out. When she approves an item, add its key (shown in
small type under it) to wording.APPROVED_DRAFTS.
"""
from __future__ import annotations

import re
from typing import Optional

from .findings import FINDINGS, GENERIC, Finding
from .panel import SECTIONS
from .wording import APPROVED_DRAFTS, DRAFT

LEVEL = {"A": "Just outside its range, or middle zone", "B": "Clearly off", "C": "Far out"}
SHOW = {"loss": "[women: regular blood loss such as heavy periods · men: slow blood loss]",
        "iron_food": "[women only: Iron-rich food with something sour alongside, such as lemon, amla or tomato, helps the body take iron in.] ",
        "names": "Lead", "is_are": "is", "its_their": "its", "name": "[the result's name]", "dist": "[how far outside range]"}
GROUPS = [("steady.", "Sections with nothing off"), ("liver.fat", "Sections with nothing off"), ("b12_high", "Sections with nothing off"),
          ("rest.", "Page 1 and the letter"), ("todo.", "Page 1 and the letter"), ("letter.", "Page 1 and the letter"),
          ("bodyage.", "Your body age"), ("onebody.", "What connects"), ("conn.", "What connects"),
          ("next.", "Your next test"), ("step.", "Your next step")]


# what the {slots} in the page-1 and next-step phrases are shown as: one example person
EXAMPLE = {"name": "Asha", "date": "4 November 2026", "status": "watch", "others": "your sugar average", "ba": "55.2", "age": "50",
           "n": "five", "parts": "your blood count and your vitamins and iron", "names": "Your thyroid signal", "sit": "sits",
           "its_their": "its", "it_is": "It is", "count": "Two things", "is_are": "are",
           "things": "your artery numbers and your sugar average"}
EXAMPLE_FOR = {"todo.deep.many": {"names": "Your haemoglobin, your vitamin B12 and your iron"},
               "step.inherited.headline": {"names": "Lp(a)"}, "step.doctor_only.headline": {"names": "Lp(a)"},
               "step.foundation.far": {"names": "liver enzymes"}, "step.nothing.para": {"date": "4 July 2027"},
               "next.steady.when": {"date": "4 July 2027"}, "rest.also": {"name": "vitamins and iron"}}


def _plain(t: str, slots: Optional[dict] = None) -> str:
    slots = SHOW if slots is None else slots
    t = re.sub(r"<[^>]+>", "", t)
    return re.sub(r"\{(\w+)\}", lambda m: slots.get(m.group(1), f"[{m.group(1).replace('_', ' ')}]"), t).strip()


def _levels(f: Finding) -> list[str]:
    seen = set()
    for t in (f.head, f.today, f.why, f.do, f.summary):
        if isinstance(t, dict):
            seen |= set(t)
    return [lv for lv in ("A", "B", "C") if lv in (seen or {"A", "B", "C"})]


def _text(t, lv: str) -> str:
    from .findings import at
    return _plain(at(t, lv))


SHORT = {"A": "just outside", "B": "clearly off", "C": "far out"}


def _by_level(label: str, values: dict[str, str]) -> list[str]:
    """One bullet when every level reads the same, otherwise one per distinct wording."""
    values = {lv: v for lv, v in values.items() if v}
    if not values:
        return []
    if len(set(values.values())) == 1 and len(values) > 1:
        return [f"- {label}: {next(iter(values.values()))}"]
    out, seen = [], {}
    for lv, v in values.items():
        seen.setdefault(v, []).append(SHORT[lv])
    for v, lvs in seen.items():
        out.append(f"- {label} ({' and '.join(lvs)}): {v}")
    return out


def finding_block(n: str, f: Finding) -> list[str]:
    from .findings import LINE_B, LINE_C
    way_word = " (reads low)" if f.id.endswith("_low") else " (reads high)" if f.id.endswith("_high") else ""
    out = [f"### {n} {(f.title or 'Any other result outside its range') + way_word}", ""]
    rows = sorted(set(f.high) | set(f.low) | set(f.either))
    names = {sp.key: sp.name for _sid, _name, _d, specs in SECTIONS for sp in specs}
    if rows:
        way = "off" if f.either else "high" if f.high and not f.low else "low" if f.low and not f.high else "high or low"
        out += [f"Printed when these read {way}: " + ", ".join(names.get(k, k) for k in rows) + ".", ""]
    todo = [lv for lv in _levels(f) if lv not in f.approved and f"finding.{f.id}.{lv}" not in APPROVED_DRAFTS]
    done = [SHORT[lv] for lv in _levels(f) if lv not in todo]
    if done:
        out += [f"Already approved and not repeated here: {' and '.join(done)}.", ""]
    out += _by_level("Headline", {lv: _text(f.head, lv) for lv in todo})
    out += _by_level("Today", {lv: _text(f.today, lv) for lv in todo})
    out += _by_level(f.why_title, {lv: _text(f.why, lv) for lv in todo})
    out += _by_level("What to do", {lv: _text(f.do, lv) for lv in todo})
    own = {lv: f.line[lv].strip() for lv in todo if lv in f.line and f.line[lv] not in (LINE_B, LINE_C)}
    out += _by_level("Its own closing sentence", own)
    out += _by_level("On “Your report on one page”", {lv: _text(f.summary, lv) for lv in todo})
    if f.step and "B" not in f.approved:
        out.append(f"- On page 1, under “what we can work on”: {_plain(f.step)}")
    out += ["", "<sub>" + " · ".join(f"finding.{f.id}.{lv}" for lv in todo) + "</sub>", ""]
    return out


def markdown() -> str:
    out = ["# Body age report: wording for your approval", "",
           "These are the sentences a report would print for results your two approved samples did not have. "
           "Nothing here has been sent to anyone. Until you approve an item, any report that uses it is marked not ready.", "",
           "How to answer: say “all approved”, or give the numbers of the ones to change with what you want instead "
           "(for example “1.3 far out: drop the last sentence”).", "",
           "Each finding has up to three levels: **just outside** its range (or middle zone), **clearly off**, and **far out**. "
           "Where one wording is shown without a level, it is used at every level.", "",
           "Two closing sentences are added to “What to do” unless a finding shows its own: at clearly off, "
           "“A result at this level is worth mentioning at your next routine check-up.” comes last; at far out, "
           "“A result this far outside its range needs a doctor's attention as well.” comes FIRST, before any food advice. "
           "Just outside adds nothing.", "",
           "Sections 2 to 7 are single phrases. Where a phrase takes a name, a date or a result, an example is filled in.", "",
           "Rules I held to: plain meaning first; no supplement or medicine advice; nothing about anything you sell beyond the Foundation session.", "",
           "## 1. Findings, by body system", ""]
    k = 0
    for sid, sname, _deeper_only, _specs in SECTIONS:
        fs = [f for f in FINDINGS if f.section == sid]
        if not fs:
            continue
        out += [f"## {sname}", ""]
        for f in fs:
            if all(lv in f.approved for lv in _levels(f)):
                continue
            k += 1
            out += finding_block(f"1.{k}", f)
    k += 1
    out += ["## Any section", ""] + finding_block(f"1.{k}", GENERIC)
    out += ["A far-out result with no block of its own stops the report and asks for wording.", ""]
    sec_no = 1
    done: list[str] = []
    for _prefix, title in GROUPS:
        if title in done:
            continue
        done.append(title)
        sec_no += 1
        out += [f"## {sec_no}. {title}", ""]
        i = 0
        for key, (where, text) in DRAFT.items():
            if key in APPROVED_DRAFTS or not any(key.startswith(p) for p, t in GROUPS if t == title):
                continue
            i += 1
            out += [f"**{sec_no}.{i}** {where}", "", f"> {_plain(text, dict(EXAMPLE, **EXAMPLE_FOR.get(key, {})))}", "", f"<sub>{key}</sub>", ""]
    return "\n".join(out)


if __name__ == "__main__":
    print(markdown())
