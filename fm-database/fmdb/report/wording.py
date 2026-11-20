"""The wording library for the body age report: every sentence a buyer reads, chosen by rule from their results.

Three kinds of text:
  APPROVED  the sentences in the two PDFs Shivani approved on 19 Nov 2026 (the fixed text below, and the
            finding blocks in findings.py marked approved). Used as they are.
  DRAFT     sentences written for results the approved samples did not have: the other finding blocks in
            findings.py and the phrases in DRAFT below. Each use is recorded in `Lib.drafts`, so the coach
            sees exactly which unapproved sentences a report carries. When she approves one, add its key to
            APPROVED_DRAFTS and it stops being reported. library_doc.py prints them all as one document.
  MISSING   a result with no wording at all (a far-out result nobody wrote for) is recorded in `Lib.missing`:
            the build stops and lists what needs writing. Nothing is invented at build time.

Rules that hold for every sentence: "body age report" and "test", never the product's internal name; no
programme, plan length or programme price; the laboratory is never named; no supplement or medicine advice;
a doctor is named only for a result far outside its range and a routine check-up for a clearly raised one;
every session is online, so nothing says "we meet", "see you", "in person", "in the room" or "sit down together".
"""
from __future__ import annotations

from typing import Any, Optional

from .findings import BY_NAME, FOLDED_INTO_LIPIDS, LINE_D, LINE_D_SHORT, Hit, at, hits_in
from .levels import rank
from .panel import FURTHER_ELEMENTS, Row, Section, b12_high, num

# Draft keys Shivani has approved. "finding.<id>.<level>" for a block in findings.py, or a key of DRAFT below.
APPROVED_DRAFTS: set[str] = {
    # The strongest level's doctor words: Shivani's "Yes, approve", 20 Nov 2026. Nothing a buyer reads is called urgent.
    "line.soon", "line.soon.short", "todo.soon", "step.soon.headline", "step.soon.para",
    # The four blocks written for the lines added on 20 Nov 2026, in the softer wording she asked for ("appears to
    # be", "sometimes", "consider a repeat test"): her "Yes, use it", 20 Nov 2026. Approved here, not with
    # Finding.approved, so the doctor sentence still comes first at far out (as she was shown).
    # Heart and arteries, all six findings: her "All approved", 20 Nov 2026.
    "finding.lipids.A", "finding.lipids.C",
    "finding.tg.A", "finding.tg.B", "finding.tg.C",
    "finding.hdl_low.A", "finding.hdl_low.B",
    "finding.crp.A", "finding.crp.B", "finding.crp.C",
    "finding.hcy.A", "finding.hcy.B", "finding.hcy.C",
    "finding.lpa.A", "finding.lpa.B", "finding.lpa.C",
    # Energy and sugar, all three findings: her "All approved", 20 Nov 2026.
    "finding.sugar.A", "finding.sugar.B", "finding.sugar.C",
    "finding.glucose_low.A", "finding.glucose_low.B", "finding.glucose_low.C",
    "finding.uric.A", "finding.uric.B", "finding.uric.C",
    # Liver, all five findings: her "Yes all approved", 20 Nov 2026.
    "finding.enzymes.A", "finding.enzymes.B", "finding.enzymes.C",
    "finding.alp.A", "finding.alp.B", "finding.alp.C",
    "finding.bilirubin.A", "finding.bilirubin.B", "finding.bilirubin.C",
    "finding.albumin.A", "finding.albumin.B", "finding.albumin.C",
    "finding.fib4.A", "finding.fib4.C",
    # Her "all approved" (typed in the report design session on 20 Nov 2026, to the wording document printed for her
    # there on 19 Nov; her message read in that session's transcript): the finding levels below and every single phrase,
    # which read exactly as in that print.
    "finding.tsh_high.A", "finding.tsh_high.B", "finding.tsh_low.A", "finding.thyroid_hormones.A",
    "finding.thyroid_hormones.B", "finding.thyroid_hormones.C", "finding.kidney.A", "finding.salts.A",
    "finding.hb_low.A", "finding.red_cells.A", "finding.red_cells.B", "finding.red_cells.C",
    "finding.white_cells.A", "finding.vitd_low.A", "finding.vitd_high.B", "finding.vitd_high.C",
    "finding.b12_low.A", "finding.iron_low.A", "finding.iron_low.B", "finding.iron_low.C", "finding.iron_high.A",
    "finding.iron_high.B", "finding.iron_high.C", "finding.metals.A", "finding.metals.B", "finding.metals.C",
    "finding.generic.A", "finding.generic.B",
    # the single phrases (sections 2 to 7 of the approval document)
    "steady.heart.head", "steady.heart.today", "steady.sugar.head", "steady.sugar.today", "steady.liver.head",
    "liver.fat_high.head", "liver.fat_high.means", "steady.thyroid.head", "steady.thyroid.today",
    "steady.nutrients.head", "steady.nutrients.today", "b12_high.head", "rest.heart", "rest.sugar", "rest.thyroid",
    "rest.nutrients", "rest.also", "todo.start.other", "todo.work.also", "todo.watch", "todo.deep.many",
    "letter.older", "letter.level", "letter.steady", "letter.other", "bodyage.older", "bodyage.level",
    "onebody.none", "conn.sugar_liver", "conn.inflammation_arteries", "conn.iron_haemoglobin",
    "conn.b12_haemoglobin", "conn.vitd_alp", "next.steady.headline", "next.steady.when", "next.steady.expect",
    "next.work.other", "next.hope.other", "step.nothing.headline", "step.nothing.para", "step.self.headline",
    "step.self.para", "step.inherited.headline", "step.inherited.para", "step.doctor_only.headline",
    "step.doctor_only.para", "step.foundation.work.headline", "step.foundation.work.why",
    "step.foundation.work.leave", "step.foundation.far",
    # The 17 finding levels softened on 20 Nov ("appears to be", "consider a repeat test"), listed for her in the
    # generator session: her "yes", 20 Nov 2026.
    "finding.tsh_low.B", "finding.tsh_low.C", "finding.kidney.B", "finding.kidney.C", "finding.salts.B", "finding.salts.C",
    "finding.hb_low.B", "finding.hb_low.C", "finding.white_cells.B", "finding.white_cells.C",
    "finding.platelets.A", "finding.platelets.B", "finding.platelets.C",
    "finding.vitd_low.B", "finding.vitd_low.C", "finding.b12_low.B", "finding.b12_low.C",
    # The wording written for the fixes found on a real panel (chloride, LDL with the particle count in range, ferritin
    # low and high, low iron when ferritin is measured, the page-1 line for Lp(a)): her "all approved", 20 Nov 2026.
    "finding.ldl_only.A",
    "finding.chloride.A", "finding.chloride.B", "finding.chloride.C",
    "finding.iron_low_stores.A", "finding.iron_low_stores.B", "finding.iron_low_stores.C",
    "finding.ferritin_low.A", "finding.ferritin_low.B", "finding.ferritin_low.C",
    "finding.ferritin_high.A", "finding.ferritin_high.B", "finding.ferritin_high.C",
    "todo.deep.lpa",
    # The extra results, F3 to F19: her "All approved" of extra-results-wording-draft.md, 20 Nov 2026, built at her
    # "Do this task here". The same approved words at every level.
    "finding.folate_low.A", "finding.folate_low.B", "finding.folate_low.C",
    "finding.magnesium_low.A", "finding.magnesium_low.B", "finding.magnesium_low.C",
    "finding.magnesium_high.A", "finding.magnesium_high.B", "finding.magnesium_high.C",
    "finding.proteins.A", "finding.proteins.B", "finding.proteins.C",
    "finding.fructosamine.A", "finding.fructosamine.B", "finding.fructosamine.C",
    "finding.lppla2.A", "finding.lppla2.B", "finding.lppla2.C",
    "finding.ige.A", "finding.ige.B", "finding.ige.C",
    "finding.autoimmune.A", "finding.autoimmune.B", "finding.autoimmune.C",
    "finding.pancreas.A", "finding.pancreas.B", "finding.pancreas.C",
    "finding.element_high.A", "finding.element_high.B", "finding.element_high.C",
    "finding.element_low.A", "finding.element_low.B", "finding.element_low.C",
    "finding.u_protein.A", "finding.u_protein.B", "finding.u_protein.C",
    "finding.u_glucose.A", "finding.u_glucose.B", "finding.u_glucose.C",
    "finding.u_ketones.A", "finding.u_ketones.B", "finding.u_ketones.C",
    "finding.u_red_cells.A", "finding.u_red_cells.B", "finding.u_red_cells.C",
    "finding.u_infection.A", "finding.u_infection.B", "finding.u_infection.C",
    "finding.u_other.A", "finding.u_other.B", "finding.u_other.C",
    "finding.egfr_low.C",
    "finding.hb_high.A", "finding.hb_high.B", "finding.hb_high.C",
    "finding.platelets_high.A", "finding.platelets_high.B", "finding.platelets_high.C",
    "finding.phosphorus_low.A", "finding.phosphorus_low.B", "finding.phosphorus_low.C",
}

# key: (where it prints and when, the sentence). {slots} are filled from the person's results.
DRAFT: dict[str, tuple[str, str]] = {
    # sections with nothing off
    "steady.heart.head": ("Heart section, steady: headline", "Your arteries are carrying a comfortable load, and the markers of wear are quiet."),
    "steady.heart.today": ("Heart section, steady: Today", "Nothing to act on."),
    "steady.sugar.head": ("Sugar section, steady: headline", "Your morning sugar and your three-month average are both calm."),
    "steady.sugar.today": ("Sugar section, steady: Today", "Your body is holding its sugar steady without strain. Nothing to act on."),
    "steady.liver.head": ("Liver section, steady with no score in the middle zone: headline", "Your liver is working quietly."),
    "liver.fat_high.head": ("Liver section, enzymes in range but the stored-fat score above its upper line: headline", "Your liver enzymes are quiet. The score for stored fat reads high."),
    "liver.fat_high.means": ("Same: One thing to look at again", "The score that estimates stored fat is above its upper line. It is worked out from enzymes and body size, so it is an estimate. Sugar, refined carbohydrate, alcohol and weight around the middle are what move it."),
    "steady.thyroid.head": ("Thyroid section, steady: headline", "Your thyroid signal is calm, and the hormones it makes are in range."),
    "steady.thyroid.today": ("Thyroid section, steady: Today", "Nothing to act on."),
    "steady.nutrients.head": ("Vitamins and iron, steady: headline", "Your vitamin D, B12 and iron are all comfortably in range."),
    "steady.nutrients.today": ("Vitamins and iron, steady: Today", "Nothing here is short and nothing is overfull."),
    "b12_high.head": ("Vitamins and iron, B12 high and vitamin D or iron also marked: headline", "Your B12 is well above its range."),
    # page 1
    "rest.heart": ("Page 1, the 'Everything else is steady' line", "your heart and arteries"),
    "rest.sugar": ("Page 1, the 'Everything else is steady' line", "your sugar handling"),
    "rest.thyroid": ("Page 1, the 'Everything else is steady' line", "your thyroid"),
    "rest.nutrients": ("Page 1, the 'Everything else is steady' line", "your vitamins and iron"),
    "rest.also": ("Page 1, a fourth section that is not steady", " Also marked “{status}”: {name}."),
    "todo.start.other": ("Page 1, step 1, when neither sugar nor cholesterol is marked", "Walk for ten minutes after your largest meal, every day until your next test. It is the cheapest way to keep these numbers where they are."),
    "todo.work.also": ("Page 1, step 2, cholesterol plus another result food moves", " The same changes work on {others}."),
    "todo.watch": ("Page 1, a step for results just outside range that food does not move", "{names} {sit} just outside {its_their} range. Nothing to do now. {it_is} read again at your next test."),
    "todo.deep.lpa": ("Page 1, deeper-look step when Lp(a) is the only such result",
                      "It is inherited, so the useful question is what to do about the rest of your heart numbers."),
    "todo.deep.many": ("Page 1, deeper-look step with three or more results", "{names}. All sit well outside their range, and blood alone cannot say why."),
    "letter.older": ("Letter, body age more than 3 years older", "{name}, this first result reads older than your age, and several of the things behind it can change."),
    "letter.level": ("Letter, body age within 3 years of age", "{name}, this is a steady first result: your blood reads close to your age."),
    "letter.steady": ("Letter, second line, report offers no session", "Nothing in here needs fixing. The few things worth keeping an eye on are marked, with what moves each one."),
    "letter.other": ("Letter, second line, something other than cholesterol leads", "Where I would put the effort this year: {parts}."),
    # body age
    "bodyage.older": ("Body age section, older than age", "A body age of {ba} at {age} says that today your blood looks like that of an older person in those studies. Many of the values behind it can change, and one illness before the test can raise it."),
    "bodyage.level": ("Body age section, about the same as age", "A body age of {ba} at {age} says that today your blood looks much like that of other people your age in those studies."),
    # reading it as one body
    "onebody.none": ("Reading it as one body, nothing connects", "Nothing in this report pulls on anything else. Each section stands on its own."),
    "conn.sugar_liver": ("Connection: sugar marked and the liver fat score high or enzymes marked", "A raised sugar reading and signs of fat in the liver often go together, because sugar the body cannot use straight away is stored as fat and the liver is one of the first places it goes. The same changes tend to bring both down."),
    "conn.inflammation_arteries": ("Connection: inflammation clearly raised and cholesterol marked", "In studies, people with both raised inflammation and a heavy particle load are at higher risk than people with either alone. That makes each of yours matter a little more."),
    "conn.iron_haemoglobin": ("Connection: haemoglobin low and iron low (deeper report)", "Your haemoglobin and your iron carriers are both low. Iron is what haemoglobin is built from, so these two belong together. The question is why iron is short."),
    "conn.b12_haemoglobin": ("Connection: haemoglobin low and B12 low (deeper report)", "Your haemoglobin and your B12 are both low. Red cells cannot be built properly without B12, so these two belong together."),
    "conn.vitd_alp": ("Connection: vitamin D low and ALP raised (deeper report)", "Your vitamin D is low and one bone-linked enzyme is raised. The two often go together, because bone turns over faster when vitamin D runs short."),
    # next test
    "next.steady.headline": ("Next test, steady report: headline", "About a year after this test, because this report is steady all through."),
    "next.steady.when": ("Next test, steady report", "<b>Your next test:</b> {date}. A year is long enough to show whether anything has started to drift."),
    "next.steady.expect": ("Next test, steady report: what we would hope to see", "The same steady picture, and a body age that has held or come down."),
    "next.work.other": ("Next test, nothing that food moves is marked", "<b>If you work on this yourself:</b> {date}. Four months is long enough for a change to show."),
    "next.hope.other": ("Next test, what we would hope to see (general)", "The marked results moving back towards their range, and your body age holding or coming down."),
    # your next step
    "step.nothing.headline": ("Next step, steady report: headline", "You do not need anything more from me."),
    "step.nothing.para": ("Next step, steady report", "Your report is steady all through. Test again in about a year, on {date}. A steady blood report does not rule out illness, so if something feels wrong, have it looked at."),
    "step.self.headline": ("Next step, one or two small things: headline", "Nothing here needs me. The steps on the first page are yours to take."),
    "step.self.para": ("Next step, one or two small things", "What is marked in this report sits just outside its range. Your next test, on {date}, will show which way it is moving."),
    "step.inherited.headline": ("Next step, an inherited result alone and clearly raised: headline", "One result here is worth mentioning at your next routine check-up: your {names}."),
    "step.inherited.para": ("Next step, an inherited result alone and clearly raised", "It is inherited, and food does not move it. Everything else in this report is steady, so you do not need a session with me."),
    "line.soon": ("Closing sentence at the strongest level, in place of the far-out sentence", LINE_D.strip()),
    "line.soon.short": ("One-page summary, a result at the strongest level", LINE_D_SHORT.strip()),
    "todo.soon": ("Page 1 steps and the email, a result at the strongest level: the first step, tagged 'See your doctor first · in the next day or two'",
                  "{names} {is_are} at a level that needs a doctor's attention soon. Please see your doctor in the next day or two, and take this report with you."),
    "step.soon.headline": ("Next step, a result at the strongest level: headline (no session is offered)", "{count} here {needs} a doctor's attention soon: your {names}."),
    "step.soon.para": ("Next step, a result at the strongest level", "Please see your doctor in the next day or two, and take this report with you. That comes before anything else here."),
    "step.doctor_only.headline": ("Next step, an inherited result alone and far out: headline", "One result here needs a doctor's attention: your {names}."),
    "step.doctor_only.para": ("Next step, an inherited result alone and far out", "It is inherited, and food does not move it. Please speak to your doctor. Everything else in this report is steady, so you do not need a session with me."),
    "step.foundation.work.headline": ("Next step, Foundation offered with nothing needing a deeper look: headline", "{count} in this report {is_are} worth working on with help: {things}."),
    "step.foundation.work.why": ("Same: first paragraph", "Blood shows what is off. What moves it is in your routine: how you eat and sleep, what you take, what runs in your family, and when things began to change. It may also take a few further tests."),
    "step.foundation.work.leave": ("Same: What you leave with", "What is driving these numbers in your own routine, and the order to work in: which to tackle first, what to change at your table and in your day, and what to leave alone."),
    "step.foundation.far": ("Next step, Foundation, a far-out result other than the thyroid signal", "Your {names} {is_are} far enough outside range to need a doctor's attention. Please speak to your doctor. The session covers the rest: what in your food, sleep, stress and routine may be feeding it."),
}

WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
         "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"]


def word(n: int) -> str:
    return WORDS[n] if 0 <= n < len(WORDS) else str(n)


def join(items: list[str]) -> str:
    items = [i for i in items if i]
    return items[0] if len(items) == 1 else (", ".join(items[:-1]) + " and " + items[-1]) if items else ""


def cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def day(d: Any, year: bool = True) -> str:
    return f"{d.day} {d:%B}" + (f" {d.year}" if year else "")


def inr(n: int) -> str:
    return f"₹{n:,}"


def distance(r: Row) -> str:
    """How far outside its range a result is, in the report's words."""
    v, kind, a, b = r.value, r.kind, r.a, r.b
    if kind == "none":
        return "outside its range"
    if kind == "range":
        d, w = ((v - b) / b, "above") if v > b else ((a - v) / a, "below")
    elif kind == "min":
        d, w = (a - v) / a, "below"
    else:
        top = b if kind == "z3" else a
        d, w = (v - top) / top, "above"
    return "just outside range" if d < 0.05 else f"{round(d * 100)}% {w} range"


def off(r: Row) -> str:
    """How a flagged result reads in words: its distance from the range, or, when the cut-off table marks it
    while it is still inside the laboratory's printed range, which end it sits at."""
    if r.state == "ok":
        end = "low" if r.side == "low" else "high"
        return f"at the {end} end of its range" if rank(r.level) <= 1 else end
    return distance(r)


def val(r: Row) -> str:
    if r.vtext:
        return r.vtext
    return f"{num(r.value)}%" if r.unit == "%" else f"{num(r.value)} {r.unit}".strip()


def ba_text(body_age: float) -> str:
    """Body age as a buyer reads it: a whole number. One decimal claimed a precision the score does not have
    (Shivani, 19 Nov 2026). The exact figure stays on the record."""
    return f"about {round(body_age)}"


def how_far(r: Row) -> str:
    if r.hi and 1.7 <= r.value / r.hi < 2:
        return "almost twice the top of the range"
    if r.hi and 2 <= r.value / r.hi < 2.3:
        return "about twice the top of the range"
    return distance(r)


class Lib:
    """Which wording one report used."""

    def __init__(self) -> None:
        self.drafts: list[str] = []
        self.missing: list[str] = []

    def _note(self, key: str) -> None:
        if key not in APPROVED_DRAFTS and key not in self.drafts:
            self.drafts.append(key)

    def d(self, key: str, **slots: Any) -> str:
        """A draft phrase from DRAFT, recorded as used."""
        self._note(key)
        return DRAFT[key][1].format(**slots) if slots else DRAFT[key][1]

    def hit(self, h: Hit) -> None:
        """Record a finding block as used when its wording at this level is not approved yet."""
        if h.level == "D":
            self._note("line.soon")
            self._note("line.soon.short")
        if not h.approved:
            self._note(f"finding.{h.finding.id}.{'C' if h.level == 'D' else h.level}")

    def need(self, key: str, what: str) -> str:
        self.missing.append(f"{key}: {what}")
        return f"[needs wording: {key}]"


# ── fixed, approved text per section ─────────────────────────────────────────
READS = {
    "heart": "Cholesterol does not travel loose in the blood. It is carried in particles, and it is the number of particles, more than the amount of cholesterol, that decides how much ends up in artery walls. This section counts both, and adds the markers of inflammation and wear that decide how the artery wall copes.",
    "sugar": "Three views of one system: your sugar this morning, your average over about three months, and how much insulin it takes to keep both in line. Trouble shows first in the effort and the average, and last in the morning number.",
    "liver": "Liver enzymes show whether liver cells are irritated today. Two calculated scores then estimate what a blood test cannot see directly: stored fat and scarring.",
    "thyroid": "TSH is the signal your brain sends to ask the thyroid for more hormone. When it runs high, the thyroid is being pushed. T4 and T3 are the hormones it makes in reply.",
    "kidneys": "Creatinine and urea show how well the kidneys are clearing waste. Sodium, potassium, chloride and calcium show whether the body's salts are in balance.",
    "blood": "The size, number and evenness of your red cells, and the make-up of your white cells. These are also the quiet workhorses of your body age: four of its nine inputs come from this panel.",
    "nutrients": "Vitamin D, vitamin B12 and iron are the reserves your energy, nerves and blood are built from. A standard panel rarely includes them, and each can run low or high for years without a symptom.",
    "metals": "Lead, mercury, arsenic and cadmium reach us through water, food, cookware, cosmetics and work. Small amounts are common. What matters is whether any is high enough to be worth tracing to its source.",
}
READS.update({
    "immune": "Four antibodies. One rises with allergy. The other three can rise when the immune system turns on the body's own joints or tissues. A raised result is a signal to look closer, and by itself it is not a diagnosis.",
    "pancreas": "Two enzymes your pancreas makes to digest food. They rise when the pancreas is irritated.",
    "urine": "A urine test is a second window on the kidneys, on sugar, and on the urinary tract. Most of it is a simple yes or no: is something there that should not be?",
})
# Her "All approved" of 20 Nov 2026. Potassium is not on either package, so the kidney intro names it only when the
# laboratory measured it; the metals intro gains a sentence when the further elements were read.
KIDNEYS_READS_NO_POTASSIUM = "Creatinine and urea show how well the kidneys are clearing waste. Sodium, chloride and calcium show whether the body's salts are in balance."
METALS_READS_FURTHER = (" Your blood was also read for {n} further elements. A few are needed in tiny amounts. The rest have no use in the body, "
                        "and are measured to see whether any has built up.")
FURTHER_ALL_IN_RANGE = "All eighteen further elements are in range."
STEADY_HEAD = {"immune": "Your allergy and autoimmune markers are quiet.", "pancreas": "Your pancreas enzymes are in range.",
               "urine": "Your urine test is clear."}
# F9 and F10: one fixed paragraph, no level, and the section's status does not move.
NOTE_WBC = ("One type of white cell sits outside its range. The mix of white cells shifts for a few days with a cold, an allergy, a hard workout "
            "or a poor night. One type a little off, with the total in range, is rarely meaningful by itself.")
NOTE_WBC_EOS = " Eosinophils rise with allergy, and with some gut infections such as worms."
NOTE_WBC_DO = " It is read again at your next test."
NOTE_INDEX = ("One of the finer measures in this panel sits outside its range. By itself it tells us little. It is read with your haemoglobin "
              "and platelet count, which are {where}.")


def reads(sec: Section, deeper: bool) -> str:
    """"What this section reads" for one section."""
    keys = {r.key for r in sec.rows}
    if sec.id == "kidneys" and "potassium" not in keys:
        return KIDNEYS_READS_NO_POTASSIUM
    t = READS[sec.id]
    if sec.id == "thyroid" and deeper and keys & {"ft4", "ft3"}:
        t += THYROID_READS_DEEPER
    n = len(keys & set(FURTHER_ELEMENTS))
    if sec.id == "metals" and n:
        t += METALS_READS_FURTHER.format(n=word(n))
    return t


def note_paras(sec: Section, rows: dict[str, Row]) -> list[tuple[str, str]]:
    """The fixed paragraphs for results that are shown and explained but never a level (F9, F10)."""
    out: list[tuple[str, str]] = []

    def names(rs: list[Row]) -> str:
        return join(list(dict.fromkeys(r.name for r in rs)))
    wbc = [r for r in sec.rows if r.note == "wbc_type"]
    total = rows.get("wbc")
    if wbc and not (total and total.level):          # with the total itself off, the white cell finding speaks
        eos = NOTE_WBC_EOS if any(r.key.startswith("eos") and r.hi is not None and r.value > r.hi for r in wbc) else ""
        out.append((names(wbc), NOTE_WBC + eos + NOTE_WBC_DO))
    idx = [r for r in sec.rows if r.note == "index"]
    if idx:
        marked = any(rows.get(k) is not None and rows[k].level for k in ("hb", "platelets"))
        out.append((names(idx), NOTE_INDEX.format(where="marked above" if marked else "in range")))
    return out


def small_extras_only(hits: list[Hit]) -> bool:
    """True when everything off in a section is an explained extra just outside its range: page 1 does not list it (D7)."""
    return bool(hits) and all(rank(h.level) <= 1 and all(r.extra for r in h.rows) for h in hits)


THYROID_READS_DEEPER = " This report adds the free hormones, which are the part your cells can use."
MOVES = {
    "heart": "The kind of fat and fibre in your food, body weight, how well the thyroid is working, alcohol and sleep all move these numbers within months. Lp(a) is set almost entirely by your genes. Some people also need medicine.",
    "sugar": "What is on the plate and when, the amount of muscle you carry, movement after meals, sleep and stress. These numbers respond within weeks.",
    "liver": "Alcohol, sugar and refined carbohydrate, weight carried around the middle, some medicines and supplements, and a hard workout in the two days before the test.",
    "thyroid": "Iodine, selenium and iron, long-term stress and some medicines all play a part.",
    "kidneys": "How much you drink, how much protein you eat, blood pressure and blood sugar over the years, and some painkillers.",
    "blood": "Iron, vitamin B12 and folate, recent infections, and long-standing inflammation.",
    "nutrients": "Sunlight and supplements for vitamin D. Diet, absorption and supplements for B12. Diet, blood loss and inflammation for iron.",
    "metals": "Drinking water, some fish, rice from certain regions, old paint and pipes, some traditional remedies and cosmetics, and smoking.",
    "immune": "Allergies and their seasons, infections, some medicines, and conditions that run in families.",
    "pancreas": "Alcohol, a heavy or fatty meal the night before, gallstones, some medicines, and how well the kidneys clear these enzymes.",
    "urine": "How much water you drank, your period, hard exercise the day before, and how the sample was collected.",
}
FH = [
    "Your doctor diagnoses and treats illness. Nothing here replaces that.",
    "Functional health reads your results as one body rather than separate organs, pays attention to numbers that are still inside the range but drifting, and then works on food, sleep, movement and stress around the life you actually live.",
]
REFS = [
    "Body age: Phenotypic Age. Levine ME et al. Aging (Albany NY). 2018;10(4):573–591. Calculated from albumin, creatinine, fasting glucose, hs-CRP, lymphocyte percentage, MCV, RDW, ALP and white cell count.",
    "What body age predicts: Liu Z et al. PLoS Med. 2018;15(12):e1002718. A study of 11,432 US adults followed for about twelve years.",
    "HOMA-IR: Matthews DR et al. Diabetologia. 1985;28:412–419.",
    "TyG index: Simental-Mendía LE et al. Metab Syndr Relat Disord. 2008;6:299–304.",
    "Fat-storage score (Hepatic Steatosis Index): Lee JH et al. Dig Liver Dis. 2010;42:503–508.",
    "Scarring score (FIB-4): Sterling RK et al. Hepatology. 2006;43:1317–1325. Cut-offs used here: Shah AG et al. Clin Gastroenterol Hepatol. 2009;7:1104–1112.",
]
ONE_PERSON = '<p class="by">One person\'s result. Results vary.</p>'
# real clients, unnamed, each shown only in the section whose finding it matches (testimonials-by-finding.md)
TESTIMONIAL = {
    "thyroid": ('<h3>In a client\'s words</h3><div class="tm">'
                '<p class="q">“I began to understand the connection between my gut health and my skin condition, which gave me a whole new perspective on my wellbeing. '
                'And when I started changing my lifestyle and diet as per the guidance, the weight I had been struggling with for years '
                'started coming off more easily and stayed off as my thyroid numbers improved.”</p>'
                '<p class="by"><b>A client who started with a thyroid finding.</b> Both thyroid antibodies were above the normal range at the start, '
                'and back inside it fourteen weeks later, at the same laboratory.</p>'
                '<p class="nums">Thyroglobulin antibody 135 → 70 <span>normal under 115, in fourteen weeks</span></p>' + ONE_PERSON + '</div>'),
    "sugar": ('<h3>A client\'s result</h3><div class="tm">'
              '<p class="q">Three-month sugar average down from 6.6 to 5.8 in fifty-three days, after months of rising.</p>'
              '<p class="by"><b>A client who started with a sugar finding.</b> Both readings from the same laboratory. She was already taking metformin, and her sugar had been rising despite it.</p>'
              '<p class="nums">HbA1c 6.6 → 5.8 <span>in 53 days</span></p>' + ONE_PERSON + '</div>'),
}


KEEP = "Your morning sugar is steady. Keep whatever you are doing there."
CLOSE_APPROVED = (" Most people know the headline. Few manage it alone, because it comes down to your own routine, "
                  "whether that is your kitchen or a restaurant menu.")


def _lv(rows: dict[str, Row], key: str) -> int:
    r = rows.get(key)
    return rank(r.level) if r else 0


def _glv(rows: dict[str, Row], group: str) -> int:
    return max((rank(r.level) for r in rows.values() if r.group == group and (not r.calc or r.key == "fib4")), default=0)


def _ok(rows: dict[str, Row], key: str) -> bool:
    r = rows.get(key)
    return bool(r and r.state == "ok" and not r.level)


def slots_for(h: Hit, sex: str) -> dict:
    """What a finding block's {slots} are filled with."""
    r = max(h.rows, key=lambda x: rank(x.level))
    names = join([x.name for x in h.rows])
    many = len(h.rows) > 1
    return dict(name=r.name, lname=r.name.lower(), dist=off(r), names=names, is_are="are" if many else "is", its_their="their" if many else "its",
                loss="regular blood loss such as heavy periods" if sex == "F" else "slow blood loss",
                # iron-rich food is the first thought for a woman at the low edge; for a man the reason comes first
                iron_food=("Iron-rich food with something sour alongside, such as lemon, amla or tomato, helps the body take iron in. "
                           if sex == "F" else ""))


def line_of(h: Hit) -> str:
    if h.level == "D":                                  # the strongest level: the same message, slightly stronger words
        return h.finding.line.get("D", LINE_D)
    return h.finding.line.get(h.level, "")


def noun_of(h: Hit) -> str:
    return join([r.name.lower() if r.name != "Lp(a)" else r.name for r in h.rows]) if h.finding.id in BY_NAME else h.finding.noun


def is_plural(h: Hit) -> bool:
    if h.finding.id in BY_NAME:       # named by their rows: one metal is singular ("your lead is")
        return len(h.rows) > 1
    return h.finding.plural


def order(h: Hit, do: str) -> str:
    """What to do, with the level's closing sentence. At far-out the doctor sentence comes FIRST, so nobody reads
    the food advice and stops; the approved blocks keep the order Shivani approved."""
    line = line_of(h).strip()
    if line and (rank(h.level) >= 4 or (rank(h.level) >= 3 and not h.approved)):
        return (line + " " + do).strip()
    return (do + " " + line).strip()


def also_para(h: Hit, lib: Lib, sex: str) -> tuple[str, str]:
    """A finding that is not its section's main one, told in one paragraph."""
    lib.hit(h)
    s = slots_for(h, sex)
    f = h.finding
    do = at(f.do, h.level).format(**s)
    if h.is_generic:
        return s["name"], at(f.why, h.level).format(**s) + " " + order(h, do)
    return f.title or s["name"], at(f.head, h.level).format(**s) + " " + order(h, do)


def also_paras(lead: Hit, others: list[Hit], lib: Lib, sex: str) -> list[tuple[str, str]]:
    """The other findings in a section that earn a paragraph: any that are clearly off, and, when the main
    finding is itself only just outside range, the small ones beside it too."""
    out = []
    for o in others:
        if rank(o.level) < 2 and rank(lead.level) >= 2 and not all(r.table in ("looks", "dissolved", "microscope") for r in o.rows):
            continue            # (a urine finding always prints its own paragraph: D6)
        if lead.finding.id == "lipids" and o.finding.id == "hcy" and o.level == "B":
            continue            # as approved: homocysteine at this level is covered by the section's check-up line
        out.append(also_para(o, lib, sex))
    return out


def compose(lead: Hit, others: list[Hit], lib: Lib, sex: str) -> tuple[str, list[tuple[str, str]]]:
    """A section's headline and "what it means for you", from its findings' blocks."""
    if lead.is_generic and rank(lead.level) >= 3:
        r = lead.rows[0]
        return lib.need(f"finding.{r.key}", f"{r.name} {num(r.value)} is level {lead.level} and nothing is written for it"), []
    lib.hit(lead)
    f, lv, s = lead.finding, lead.level, slots_for(lead, sex)
    means = [("Today", at(f.today, lv))]
    if f.why:
        means.append((f.why_title, at(f.why, lv).format(**s)))
    means += list(f.extra)
    means += also_paras(lead, others, lib, sex)
    do = at(f.do, lv).format(**s)
    if do or line_of(lead):
        means.append(("What to do", order(lead, do)))
    return at(f.head, lv).format(**s), means


# ── one section's headline and "what it means for you" ──────────────────────
def section_text(sec: Section, rows: dict[str, Row], deeper: bool, lib: Lib, sex: str = "M",
                 hits: Optional[list[Hit]] = None) -> tuple[str, list[tuple[str, str]]]:
    sid = sec.id
    hits = hits_in(sec) if hits is None else hits
    if not hits:
        return steady_text(sec, rows, lib)
    lead, others = hits[0], hits[1:]
    fid = lead.finding.id

    if fid == "sugar" and lead.level == "A" and _lv(rows, "hba1c") == 1 and _ok(rows, "glucose") and not _lv(rows, "insulin"):
        return ("Your morning sugar is calm. Your three-month average sits just above the line.",
                [("Today", "Your mornings are steady, and you may notice nothing at all."),
                 ("What we are watching", "The gap between a calm morning reading and a slightly raised three-month average is often the first thing to move, years before a morning test does. You are early, and early is the easy time.")]
                + also_paras(lead, others, lib, sex))
    if fid == "tsh_high":
        lib.hit(lead)
        f = lead.finding
        means = [("Today", at(f.today, lead.level))]
        hold = deeper and _ok(rows, "ft4") and _ok(rows, "ft3")
        if hold:
            means.append(("What the deeper tests add", "Your free hormones are in range. The signal is raised, but your thyroid is still keeping up. Whether your immune system is involved is the next thing to check."))
        means += also_paras(lead, others, lib, sex)
        do = at(f.do, lead.level)
        if hold and rank(lead.level) >= 2:
            do = "This needs a deeper look, read alongside your history: what is pushing the signal up while the hormones hold."
        means.append(("What to do", do + line_of(lead)))
        return f.head, means
    if fid == "b12_high":
        alone = not others and _ok(rows, "vitd") and (_ok(rows, "tsat") or _ok(rows, "iron"))
        means = [("Today", lead.finding.today)]
        if _lv(rows, "hcy") >= 2:
            means.append(("Why it matters in your report", "Homocysteine normally comes down when B12 is plentiful. Yours is high while your B12 is full, so a simple shortage of B12 is unlikely to be the reason. Thyroid, other B vitamins and the kidneys can all raise it, which is why it needs a deeper look."))
        means += also_paras(lead, others, lib, sex)
        head = "Your vitamin D and iron are comfortably in range. Your B12 is well above it." if alone else lib.d("b12_high.head")
        return head, means
    return compose(lead, others, lib, sex)


def steady_text(sec: Section, rows: dict[str, Row], lib: Lib) -> tuple[str, list[tuple[str, str]]]:
    sid = sec.id
    if sid == "liver":
        hsi = rows.get("hsi")
        if hsi and hsi.state == "mid":
            return ("Your liver is working quietly. One score for stored fat sits in the middle zone.",
                    [("Today", "Nothing to feel and nothing to fix."),
                     ("One thing to look at again", "The score that estimates stored fat sits in the middle zone. It is worth a second look at your next test.")])
        if hsi and hsi.state == "out":
            return lib.d("liver.fat_high.head"), [("Today", "Nothing to feel and nothing to fix."), ("One thing to look at again", lib.d("liver.fat_high.means"))]
        return lib.d("steady.liver.head"), [("Today", "Nothing to feel and nothing to fix.")]
    if sid == "kidneys":
        return "Your kidneys are clearing waste well and your salts are in balance.", [("Today", "Clear. Nothing to act on.")]
    if sid == "blood":
        return ("Your red cells are fresh and even. This is the strongest part of your report.",
                [("Today", "Red cells like these go with stamina and good recovery.")])
    if sid in STEADY_HEAD:
        return STEADY_HEAD[sid], []
    if sid == "metals":
        head = "No heavy metal is above range."
        if set(FURTHER_ELEMENTS) <= {r.key for r in sec.rows}:
            head += " " + FURTHER_ALL_IN_RANGE
        if any(r.illustrative for r in sec.rows):
            head += " These values are illustrative: the test profile has no metals results."
        return head, [("Today", "Nothing to trace and nothing to act on.")]
    means = [("Today", lib.d(f"steady.{sid}.today"))]
    if sid == "heart":
        means.append(("New in this report", "A standard check-up counts the cholesterol. This counts the particles carrying it, and adds a second marker of artery wear."))
    return lib.d(f"steady.{sid}.head"), means


def stand_numbers(sec: Section, rows: dict[str, Row], hits: list[Hit]) -> str:
    """The small line of key numbers under a finding on page 1."""
    lead = hits[0] if hits else None
    if lead and lead.finding.id == "lipids":
        r, ldl = rows.get("apob"), rows.get("ldl")
        if r and r.level:
            bits = [f"ApoB {num(r.value)} {r.unit} · usual aim under 100"]
        elif ldl and ldl.level:
            bits = [f"LDL cholesterol {num(ldl.value)} {ldl.unit} · under 100 ideal"]
        else:
            w = max(lead.rows, key=lambda x: rank(x.level))
            bits = [f"{w.name} {val(w)} · {w.rtxt}"]
        h = rows.get("hcy")
        if h and rank(h.level) >= 2:
            bits.append(f"homocysteine {num(h.value)} {h.unit} · {distance(h)}")
        return " &nbsp;|&nbsp; ".join(bits)
    if lead and lead.finding.id == "sugar" and _lv(rows, "hba1c") >= 1:
        return f"HbA1c {num(rows['hba1c'].value)}% · lab under 5.7"
    if lead:
        r = max(lead.rows, key=lambda x: rank(x.level))
        return f"{r.name} {val(r)} · {r.rtxt}"
    return ""


# ── page 1 ───────────────────────────────────────────────────────────────────
def gap_words(gap: float) -> tuple[str, str]:
    """("about ten years younger than your age", "ten") from body age minus calendar age."""
    n = round(abs(gap))
    if gap <= -1.5:
        return f"about {word(n)} year{'s' if n != 1 else ''} younger than your age", word(n)
    if gap >= 1.5:
        return f"about {word(n)} year{'s' if n != 1 else ''} older than your age", word(n)
    return "about the same as your age", ""


def all_hits(rp: Any) -> list[Hit]:
    return [h for s in rp.sections for h in rp.hits.get(s.id, [])]


def section_of(rp: Any, h: Hit) -> str:
    return next(s.id for s in rp.sections if h.rows[0] in s.rows)


def deep_hits(rp: Any) -> list[Hit]:
    """The findings that need a deeper look (clearly off, and not something food simply moves), worst first."""
    keys = set(rp.decision.deep_rows)
    out = [h for h in all_hits(rp) if any(r.key in keys for r in h.rows)]
    return sorted(out, key=lambda h: -rank(h.level))


def work_hits(rp: Any) -> list[Hit]:
    """The findings that food, movement and sleep move, clearest first."""
    out = [h for h in all_hits(rp) if h.nature == "work" and not h.is_generic]
    return sorted(out, key=lambda h: -rank(h.level))


def deep_step(deep: list[Hit], rp: Any, lib: Lib, link: bool = True) -> str:
    """Step 3 on page 1: the results that need a deeper look, with the doctor or check-up line each one earns."""
    def named(hs: list[Hit]) -> list[str]:
        return [f'your <a href="#{section_of(rp, h)}">{noun_of(h)}</a>' if link else f"your {noun_of(h)}" for h in hs]
    # Lp(a) is set by genes and the heart section says so: it is never part of "blood alone cannot say why"
    why = [h for h in deep if h.finding.id != "lpa"]
    names = named(why)
    if not why:
        s = f"{cap(named(deep)[0])}. " + lib.d("todo.deep.lpa")
    else:
        if len(why) == 1:
            s = f"{cap(names[0])}. " + ("They sit well outside their range" if is_plural(why[0]) else "It sits well outside its range") + ", and blood alone cannot say why."
        elif len(why) == 2:
            s = f"{cap(names[0])} and {names[1]}. Both sit well outside their range, and blood alone cannot say why."
        else:
            s = lib.d("todo.deep.many", names=cap(join(names)))
        s += " That takes your history and a few further tests."

    def verb(hs: list[Hit]) -> str:
        return "are" if len(hs) > 1 or is_plural(hs[0]) else "is"
    far = [h for h in deep if rank(h.level) >= 3]
    clear = [h for h in deep if rank(h.level) == 2]
    parts = []
    if far:
        parts.append(f"The {join([noun_of(h) for h in far])} {verb(far)} far enough out to need a doctor's attention")
    if clear:
        parts.append(f"{'the' if parts else 'The'} {join([noun_of(h) for h in clear])} {verb(clear)} worth mentioning at your next routine check-up")
    if parts:
        s += " " + ", and ".join(parts) + "."
    return s


def todo_steps(rp: Any, lib: Lib) -> list[dict]:
    """The numbered steps on page 1: start tonight, what we can work on, what needs a deeper look."""
    steps: list[dict] = []
    soon = [h for h in all_hits(rp) if h.level == "D"]
    if soon:                  # the strongest level: the doctor is step 1, before anything the buyer can do alone
        steps.append(dict(tag="See your doctor first", when="in the next day or two", short="seeing your doctor in the next day or two",
                          text=lib.d("todo.soon", names=cap(join(["your " + noun_of(h) for h in soon])),
                                     is_are="are" if len(soon) > 1 or is_plural(soon[0]) else "is")))
    work = [h for h in work_hits(rp) if h.finding.step]
    ids = [h.finding.id for h in work]
    walk = "Walk for ten minutes after your largest meal, every day until your next test. It helps your body clear the sugar from that meal."
    steps.append(dict(tag="Start tonight", when="free", short="a ten-minute walk after your largest meal, tonight",
                      text=walk if ("lipids" in ids or "sugar" in ids) else lib.d("todo.start.other")))
    lipids = next((h for h in work if h.finding.id == "lipids" and rank(h.level) >= 2), None)
    if lipids:
        others = [h for h in work if h is not lipids and rank(h.level) >= 2]
        also = lib.d("todo.work.also", others=join(["your " + h.finding.moves for h in others])) if others else ""
        steps.append(dict(tag="What we can work on", when="over the next few months",
                          text=lipids.finding.step + CLOSE_APPROVED + also, email=lipids.finding.step + also))
    elif work:
        for h in work:
            lib.hit(h)
        body = " ".join(h.finding.step for h in work[:3])
        steps.append(dict(tag="What we can work on", when="over the next few months", text=body, email=body))
    deep = [h for h in deep_hits(rp) if h.level != "D"]
    if deep:
        steps.append(dict(tag="Needs a deeper look", when="after you have seen your doctor" if soon else "the next step", text=deep_step(deep, rp, lib), email=deep_step(deep, rp, lib, link=False)))
    else:
        watch = [h for h in all_hits(rp) if h.nature != "work" and rank(h.level) == 1 and not all(r.extra for r in h.rows)]      # D7
        if watch:
            many = len(watch) > 1 or is_plural(watch[0])
            t = lib.d("todo.watch", names=cap(join(["your " + noun_of(h) for h in watch])), sit="sit" if many else "sits",
                      its_their="their" if many else "its", it_is="They are" if many else "It is")
            steps.append(dict(tag="Worth watching", when="at your next test", text=t))
    for s in steps:
        s.setdefault("email", s["text"])
    return steps


def letter(rp: Any, lib: Lib) -> list[str]:
    gap, name = rp.decision.body_age_gap, rp.name
    heart = rp.hits.get("heart") or []
    n = len(rp.stand)
    if gap <= -3 and n:
        first = (f"{name}, your blood reads younger than your age, and {word(n)} thing{'s' if n != 1 else ''} in this report "
                 f"need{'' if n != 1 else 's'} attention.")
    elif gap <= -3:
        first = f"{name}, this is a strong first result, and it is worth protecting."
    elif gap > 3:
        first = lib.d("letter.older", name=name)
    else:
        first = lib.d("letter.level", name=name)
    out = [first]
    if heart and heart[0].finding.id == "lipids" and rank(heart[0].level) >= 2 and gap <= -3:
        out.append("One thing in here does not match the rest: your arteries. That is where I would put the effort this year.")
    elif rp.decision.outcome in ("nothing", "self"):
        out.append(lib.d("letter.steady"))
    else:
        off = [s.name.lower() for s in rp.sections if s.key == "att"] or [s.name.lower() for s in rp.sections if s.key == "watch"]
        out.append(lib.d("letter.other", parts=join(["your " + x for x in off])))
    return out


def rest_line(rp: Any, lib: Lib) -> str:
    # the last three are the subjects of her approved steady headlines for those sections (20 Nov 2026)
    approved = {"liver": "your liver", "kidneys": "your kidneys", "blood": "your blood count", "metals": "your metals",
                "immune": "your allergy and autoimmune markers", "pancreas": "your pancreas enzymes", "urine": "your urine test"}
    names = [approved.get(s.id) or lib.d(f"rest.{s.id}") for s in rp.sections if s.status == "steady"]
    line = f"Everything else is steady: {join(names)}." if names else ""
    shown = {x["id"] for x in rp.stand}
    for s in rp.sections:
        if s.status == "steady" or s.id in shown or small_extras_only(rp.hits.get(s.id) or []):
            continue
        if s.id == "nutrients" and b12_high(rp.rows) and _lv(rp.rows, "hcy") >= 2:
            line += " Your B12 is high, which matters for one finding above."
        else:
            line += lib.d("rest.also", status=s.status, name=s.name.lower())
    return line.strip()


# ── body age ─────────────────────────────────────────────────────────────────
def body_age_means(rp: Any, lib: Lib) -> tuple[str, str]:
    """(what your number means for you, the end of the cholesterol caveat)."""
    gap, ba, age = rp.decision.body_age_gap, ba_text(rp.body_age), rp.age
    n = word(round(abs(gap)))
    heart = next((s for s in rp.sections if s.id == "heart"), None)
    if gap <= -1.5:
        means = (f"A body age of {ba} at {age} does not promise {n} extra years. It says that today your blood looks like that of "
                 "a younger person in those studies. That is worth protecting.")
    elif gap >= 1.5:
        means = lib.d("bodyage.older", ba=ba, age=age, n=n)
    else:
        means = lib.d("bodyage.level", ba=ba, age=age)
    tail = "."
    if gap <= -1.5 and heart and heart.key == "att":
        tail = f", and why yours can read {n} years younger while your heart section still needs attention."
    return means, tail


def connection_text(c: Any, lib: Lib) -> str:
    return lib.d(f"conn.{c.id}") if c.draft else c.text


# ── next test ────────────────────────────────────────────────────────────────
def next_test(rp: Any, lib: Lib) -> dict:
    rows, d = rp.rows, day(rp.next_test)
    if all(s.status == "steady" for s in rp.sections):
        return dict(headline=lib.d("next.steady.headline"), when=[lib.d("next.steady.when", date=d)],
                    expect=[("What we would hope to see", lib.d("next.steady.expect"))])
    moving: list[str] = []
    hits = work_hits(rp)
    has_lipids = any(h.finding.id == "lipids" for h in hits)
    for h in hits:
        if has_lipids and h.finding.id in FOLDED_INTO_LIPIDS:
            continue
        if h.finding.moves and h.finding.moves not in moving:
            moving.append(h.finding.moves)
    order = ["artery load", "sugar average"]
    moving.sort(key=lambda m: (order.index(m) if m in order else 9, m == "inflammation"))
    slow = [m for m in moving if m != "inflammation"]
    when = []
    if slow:
        when.append(f"<b>If you work on this yourself:</b> {d}. Four months is long enough for {join(['your ' + w for w in slow])} to show a change.")
    else:
        when.append(lib.d("next.work.other", date=d))
    if _lv(rows, "tsh") >= 2:
        when.append("<b>If your thyroid is rechecked sooner:</b> use that date. A change there can move your cholesterol too.")
    when.append("<b>When a report is steady all through:</b> about a year is enough. Yours is not there yet.")
    expect = []
    if moving:
        expect.append(("What can move in four months", cap(join(["the " + m for m in moving])) + "."))
    heart = rp.hits.get("heart") or []
    if heart and heart[0].finding.id == "lipids" and rank(heart[0].level) >= 2 and rp.decision.body_age_gap <= -1.5:
        expect.append(("What we would hope to see", "Your body age holding where it is, and the heart picture moving from “needs attention” towards “watch”."))
    else:
        expect.append(("What we would hope to see", lib.d("next.hope.other")))
    lpa = rows.get("lpa")
    if lpa and lpa.level:
        expect.append(("What will not move", f"One part of your heart picture is largely inherited (Lp(a) {num(lpa.value)} {lpa.unit} · {lpa.rtxt}). It changes little, so there is no need to repeat it at four months."))
    return dict(headline="Four months after this test, because this report has things to work on.", when=when, expect=expect)


# ── your report on one page ──────────────────────────────────────────────────
def _line(level: str) -> str:
    return {2: " Worth mentioning at your next routine check-up.", 3: " Needs a doctor's attention.", 4: LINE_D_SHORT}.get(rank(level), "")


def summary(rp: Any, lib: Lib) -> dict:
    rows, deeper = rp.rows, rp.kind == "deeper"
    deep_list = deep_hits(rp)
    work, deep = [], []
    for s in rp.sections:
        hits = rp.hits.get(s.id) or []
        if not hits:
            continue
        w = next((h for h in hits if h.nature == "work" and not h.is_generic), None)
        if w:
            sv = slots_for(w, rp.sex)
            if w.finding.id == "sugar" and w.level == "A" and _lv(rows, "hba1c") == 1 and _ok(rows, "glucose") and not _lv(rows, "insulin"):
                text = "Your three-month sugar average, just above the line."
            else:
                lib.hit(w)
                text = at(w.finding.summary, w.level).format(**sv)
            work.append((s.name, text + _line(w.level), s.id))
        elif not any(h in deep_list for h in hits):
            h = hits[0]                      # only small things food does not move: read again next time
            if h.finding.id == "b12_high" and len(hits) == 1 and _lv(rows, "hcy") >= 2 and deeper:
                continue                     # told inside the homocysteine line below
            lib.hit(h)
            text = at(h.finding.summary, h.level).format(**slots_for(h, rp.sex)) or f"{noun_of(h).capitalize()}, {off(h.rows[0])}."
            work.append((s.name, text, s.id))
    for h in deep_list:
        r = max(h.rows, key=lambda x: rank(x.level))
        sid = section_of(rp, h)
        if h.finding.id == "tsh_high":
            hold = ", while the hormones hold" if deeper and _ok(rows, "ft4") and _ok(rows, "ft3") else ""
            deep.append(("Thyroid signal", f"TSH {num(r.value)} {r.unit}, {how_far(r)}{hold}." + _line(h.level), sid))
        elif h.finding.id == "hcy":
            full = ", although your B12 is full" if deeper and b12_high(rows) else ""
            deep.append(("Homocysteine", f"{num(r.value)} {r.unit}, {distance(r)}{full}." + _line(h.level), sid))
        else:
            title = r.name if h.finding.id in BY_NAME else h.finding.title
            deep.append((title, f"{r.name} {val(r)}, {off(r)}.".replace(f"{title} ", "", 1) + _line(h.level), sid))
    gapw, _n = gap_words(rp.decision.body_age_gap)
    start = rp.todo[0]["short"] if rp.todo else ""
    return dict(headline=f"Your body age is {ba_text(rp.body_age)} at {rp.age}: {gapw}.", work=work, deep=deep,
                where=f"Where to start: {start}. Your next test: {day(rp.next_test)}.")


# ── your next step ───────────────────────────────────────────────────────────
def next_step(rp: Any, lib: Lib) -> dict:
    """The last section: one tailored step, or none. Never a price menu."""
    d = rp.decision
    sample_day, deadline = day(rp.sample_date, year=False), day(rp.deadline)
    if d.outcome == "nothing":
        return dict(outcome="nothing", headline=lib.d("step.nothing.headline"), paras=[lib.d("step.nothing.para", date=day(rp.next_test))])
    if d.outcome == "self":
        return dict(outcome="self", headline=lib.d("step.self.headline"), paras=[lib.d("step.self.para", date=day(rp.next_test))])
    deep = deep_hits(rp)
    names = [noun_of(h) for h in deep]
    if d.outcome == "doctor_soon":                      # a result at the strongest level: the doctor first, no session offer
        soon = [noun_of(h) for h in all_hits(rp) if h.level == "D"]
        k = len(soon)
        return dict(outcome="doctor_only", paras=[lib.d("step.soon.para")],
                    headline=lib.d("step.soon.headline", count=f"{word(k).capitalize()} result{'s' if k != 1 else ''}",
                                   needs="need" if k != 1 else "needs", names=join(soon[:1] + ['your ' + n for n in soon[1:]])))
    if d.outcome == "doctor_only":
        key = "doctor_only" if any(rank(h.level) >= 3 for h in deep) else "inherited"
        return dict(outcome="doctor_only", headline=lib.d(f"step.{key}.headline", names=join(names)), paras=[lib.d(f"step.{key}.para")])

    work_b = [h.finding.noun for h in work_hits(rp) if rank(h.level) >= 2]
    far = [h for h in deep if rank(h.level) >= 3]
    clear = [noun_of(h) for h in deep if rank(h.level) == 2] + work_b
    if deep:
        k = len(deep)
        headline = (f"{word(k).capitalize()} result{'s' if k != 1 else ''} in this report need{'' if k != 1 else 's'} a deeper look: "
                    f"{join(['your ' + n for n in names])}.")
        why = ("Blood shows what is off. It cannot show why. That takes your history: how you eat and sleep, what you take, what runs in your family, "
               "and when things began to change. It may also take a few further tests.")
        leave = (f"Why {'these ' + word(k) + ' results are where they are' if k != 1 else 'this result is where it is'}, as far as it can be known, "
                 "and the order to work in: which to tackle first, what to change at your table and in your day, and what to leave alone.")
    else:
        things = work_b or [s.name.lower() for s in rp.sections if s.status != "steady"]
        n = len(things)
        headline = lib.d("step.foundation.work.headline", count=f"{word(n).capitalize()} thing{'s' if n != 1 else ''}", is_are="are" if n != 1 else "is",
                         things=join(["your " + t for t in things]))
        why, leave = lib.d("step.foundation.work.why"), lib.d("step.foundation.work.leave")
    second = ""
    if far:
        if [h.finding.id for h in far] == ["tsh_high"]:
            second = ("Your thyroid signal is far enough outside its range to need a doctor's attention. Please speak to your doctor. "
                      "The session covers the rest: what in your food, sleep, stress and routine may be feeding it.")
        else:
            second = lib.d("step.foundation.far", names=join([noun_of(h) for h in far]), is_are="are" if len(far) > 1 or is_plural(far[0]) else "is")
    far_only = second
    pct_off = round(100 * (rp.foundation_list - rp.foundation_after) / rp.foundation_list)
    if clear:
        second += (" " if second else "") + f"Your {join(clear[:1] + ['your ' + c for c in clear[1:]])} {'are' if len(clear) != 1 or clear[0].endswith('s') else 'is'} worth mentioning at your next routine check-up."
    return dict(
        outcome="foundation", headline=headline, paras=[p for p in (why, second) if p],
        email_paras=[p for p in (why, far_only) if p],
        # Shivani, 20 Nov 2026: the full price crossed out, the price they pay, the discount, then her sentence
        price=rp.foundation_after, list_price=rp.foundation_list, pct_off=pct_off,
        credit=f"The price of your body age report is fully adjusted against a Foundation session if you sign up by {deadline}.",
        steps=[
            ("Before your session", "You fill in your full history in your own time, about 25 minutes, one short section at a time. It covers your health story in the order it happened, your diagnoses and family history, medicines past and present, how you eat, sleep, move and handle stress, your childhood and surroundings, what you have already tried, and each part of your body that bothers you. This is the part blood cannot show."),
            ("In your session", "It is online, by video call, wherever you are. I read your history against this report, and we go through both together."),
            ("Further tests", "You get the short list worth doing for you, and I read those with you when they are back. Most people need two to four, usually ₹1,000 to ₹5,000 in all, paid to the laboratory. You see the list and the price before you decide."),
            ("What you leave with", leave),
        ],
        fresh=f"After {deadline} the session is {inr(rp.foundation_list)}.",
        after="Nothing, unless you want it. You leave with the order to work in, and your next test will show what has moved.",
        email_offer=(f"<b>A Foundation session, online: <s>{inr(rp.foundation_list)}</s> {inr(rp.foundation_after)} ({pct_off}% off).</b> "
                     f"The price of your body age report is fully adjusted against a Foundation session if you sign up by {deadline}."),
        email_how=("You fill in your history first. Then we have an online session by video call: I read it against your report, and you leave with the short list of "
                   "further tests worth doing and the order to work in. Most people need two to four further tests, usually ₹1,000 to ₹5,000 in all, paid to the laboratory."))
