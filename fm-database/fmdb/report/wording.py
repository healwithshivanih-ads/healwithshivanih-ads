"""The wording library for the body age report: every sentence a buyer reads, chosen by rule from their results.

Two kinds of text live here.
  APPROVED  the sentences in the two PDFs Shivani approved on 19 Nov 2026. Used as they are.
  DRAFT     sentences written for results the approved samples did not have (a steady heart, a steady report,
            a report with nothing that needs a deeper look). Each use is recorded in `Lib.drafts`, so the
            coach sees exactly which unapproved sentences a report carries before it goes anywhere.
A result with no wording at all is recorded in `Lib.missing`: the build stops and lists what needs writing.
Nothing is invented at build time.

Rules that hold for every sentence: "body age report" and "test", never the product's internal name; no
programme, plan length or programme price; the laboratory is never named; a doctor is named only for a result
far outside its range (levels.DOCTOR) and a routine check-up for a clearly raised one (levels.CHECKUP).
"""
from __future__ import annotations

from typing import Any, Optional

from .levels import rank
from .panel import Row, Section, b12_high, num

WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
         "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"]


def word(n: int) -> str:
    return WORDS[n] if 0 <= n < len(WORDS) else str(n)


def join(items: list[str]) -> str:
    items = [i for i in items if i]
    return items[0] if len(items) == 1 else (", ".join(items[:-1]) + " and " + items[-1]) if items else ""


def day(d: Any, year: bool = True) -> str:
    return f"{d.day} {d:%B}" + (f" {d.year}" if year else "")


def inr(n: int) -> str:
    return f"₹{n:,}"


def distance(r: Row) -> str:
    """How far outside its range a result is, in the report's words."""
    v, kind, a, b = r.value, r.kind, r.a, r.b
    if kind == "range":
        d, w = ((v - b) / b, "above") if v > b else ((a - v) / a, "below")
    elif kind == "min":
        d, w = (a - v) / a, "below"
    else:
        top = b if kind == "z3" else a
        d, w = (v - top) / top, "above"
    return "just outside range" if d < 0.05 else f"{round(d * 100)}% {w} range"


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

    def draft(self, key: str, text: str) -> str:
        if key not in self.drafts:
            self.drafts.append(key)
        return text

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
}
REST_NAME = {"liver": "your liver", "kidneys": "your kidneys", "blood": "your blood count", "metals": "your metals"}
REST_NAME_DRAFT = {"heart": "your heart and arteries", "sugar": "your sugar handling", "thyroid": "your thyroid",
                   "nutrients": "your vitamins and iron"}
FH = [
    "Your doctor looks for disease and treats it. Nothing here replaces that.",
    "A nutritionist gives you a way of eating. A coach helps you keep a change going.",
    "Functional health starts earlier and asks why. It reads your results as one body rather than separate organs, pays attention to numbers that are still inside the range but drifting, and then works on food, sleep, movement and stress around the life you actually live.",
]
REFS = [
    "Body age: Phenotypic Age. Levine ME et al. Aging (Albany NY). 2018;10(4):573–591. Calculated from albumin, creatinine, fasting glucose, hs-CRP, lymphocyte percentage, MCV, RDW, ALP and white cell count.",
    "What body age predicts: Liu Z et al. PLoS Med. 2018;15(12):e1002718. A study of 11,432 US adults followed for about twelve years.",
    "HOMA-IR: Matthews DR et al. Diabetologia. 1985;28:412–419.",
    "TyG index: Simental-Mendía LE et al. Metab Syndr Relat Disord. 2008;6:299–304.",
    "Fat-storage score (Hepatic Steatosis Index): Lee JH et al. Dig Liver Dis. 2010;42:503–508.",
    "Scarring score (FIB-4): Sterling RK et al. Hepatology. 2006;43:1317–1325.",
]
KEEP = "And keep whatever you do in the mornings. It is working."

# what a result is called inside a sentence: (noun, section it links to)
NOUN = {"tsh": ("thyroid signal", "thyroid"), "hcy": ("homocysteine", "heart")}
NOUN_DRAFT = {"lpa": ("Lp(a)", "heart"), "hb": ("haemoglobin", "blood"), "creatinine": ("kidney marker", "kidneys"),
              "potassium": ("potassium", "kidneys"), "sodium": ("sodium", "kidneys"), "calcium": ("calcium", "kidneys"),
              "alt": ("liver enzymes", "liver"), "ast": ("liver enzymes", "liver"), "ggt": ("liver enzymes", "liver"),
              "wbc": ("white cell count", "blood"), "platelets": ("platelets", "blood"), "b12": ("vitamin B12", "nutrients"),
              "tsat": ("iron stores", "nutrients"), "ft4": ("free thyroid hormone", "thyroid"), "ft3": ("free thyroid hormone", "thyroid")}
# what a group of results that food and movement move is called: (in "numbers" sentences, in "load" sentences)
WORK_NOUN = {"lipids": ("artery numbers", "artery load"), "sugar": ("sugar average", "sugar average")}
WORK_NOUN_DRAFT = {"inflammation": ("inflammation marker", "inflammation"), "uric": ("uric acid", "uric acid"),
                   "vitd": ("vitamin D", "vitamin D"), "hsi": ("liver fat score", "liver fat score")}

# real clients, unnamed, each shown only in the section whose finding it matches (testimonials-by-finding.md)
TESTIMONIAL = {
    "thyroid": ('<h3>In a client\'s words</h3><div class="tm">'
                '<p class="q">“I began to understand the connection between my gut health and my skin condition, which gave me a whole new perspective on my wellbeing. '
                'And when I started changing my lifestyle and diet as per the guidance, the weight I had been struggling with for years '
                'started coming off more easily and stayed off as my thyroid numbers improved.”</p>'
                '<p class="by"><b>A client who started with a thyroid finding.</b> Both thyroid antibodies were above the normal range at the start, '
                'and back inside it fourteen weeks later, at the same laboratory.</p>'
                '<p class="nums">Thyroglobulin antibody 135 → 70 <span>normal under 115, in fourteen weeks</span></p></div>'),
    "sugar": ('<h3>A client\'s result</h3><div class="tm">'
              '<p class="q">Three-month sugar average: from the diabetes range to just above normal in fifty-three days, after months of rising. Cholesterol down too.</p>'
              '<p class="by"><b>A client who started with a sugar finding.</b> Both readings from the same laboratory.</p>'
              '<p class="nums">HbA1c 6.6 → 5.8 <span>in 53 days</span> · Total cholesterol 233 → 201</p></div>'),
}


def noun(key: str, lib: Lib) -> tuple[str, str]:
    if key in NOUN:
        return NOUN[key]
    if key in NOUN_DRAFT:
        lib.draft(f"noun.{key}", "")
        return NOUN_DRAFT[key]
    return lib.need(f"noun.{key}", "what this result is called inside a sentence"), "first"


def work_noun(group: str, lib: Lib) -> tuple[str, str]:
    if group in WORK_NOUN:
        return WORK_NOUN[group]
    if group in WORK_NOUN_DRAFT:
        lib.draft(f"work_noun.{group}", "")
        return WORK_NOUN_DRAFT[group]
    return (lib.need(f"work_noun.{group}", "what this group of results is called inside a sentence"),) * 2


def _lv(rows: dict[str, Row], key: str) -> int:
    r = rows.get(key)
    return rank(r.level) if r else 0


def _glv(rows: dict[str, Row], group: str) -> int:
    return max((rank(r.level) for r in rows.values() if r.group == group and (not r.calc or r.key == "fib4")), default=0)


def _ok(rows: dict[str, Row], key: str) -> bool:
    r = rows.get(key)
    return bool(r and r.state == "ok" and not r.level)


# ── one section's headline and "what it means for you" ──────────────────────
def section_text(sec: Section, rows: dict[str, Row], deeper: bool, lib: Lib) -> tuple[str, list[tuple[str, str]]]:
    sid, st = sec.id, sec.status
    flagged = [r for r in sec.rows if r.level and (not r.calc or r.key == "fib4")]
    what = f"status '{st}' from " + ", ".join(f"{r.name} {num(r.value)} (level {r.level})" for r in flagged)

    if sid == "heart":
        lip = _glv(rows, "lipids")
        if st == "needs attention" and lip >= 2:
            todo = "Food comes first, and that is where the work starts."
            if lip >= 3:
                todo += lib.draft("heart.lipids.C", " Numbers at this level need a doctor's attention as well.")
            else:
                todo += " Numbers at this level are also worth mentioning at your next routine check-up."
            return ("Your arteries are carrying a heavier load of cholesterol particles than is good for them.",
                    [("Today", "You feel nothing. That is the difficulty with this one."),
                     ("Over the years", "A heavy particle load is one of the patterns linked with heart disease later in life. It is also one of the most changeable."),
                     ("New in this report", "A standard check-up counts the cholesterol. This counts the particles carrying it, and adds a second marker of artery wear."),
                     ("What to do", todo)])
        if st == "steady":
            return (lib.draft("heart.steady", "Your arteries are carrying a comfortable load, and the markers of wear are quiet."),
                    [("Today", lib.draft("heart.steady", "Nothing to act on.")),
                     ("New in this report", "A standard check-up counts the cholesterol. This counts the particles carrying it, and adds a second marker of artery wear.")])
    if sid == "sugar":
        if st == "watch" and _lv(rows, "hba1c") == 1 and _ok(rows, "glucose"):
            return ("Your morning sugar is calm. Your three-month average sits just above the line.",
                    [("Today", "Your mornings are steady, and you may notice nothing at all."),
                     ("What we are watching", "The gap between a calm morning reading and a slightly raised three-month average is often the first thing to move, years before a morning test does. You are early, and early is the easy time.")])
        if st == "steady":
            return (lib.draft("sugar.steady", "Your morning sugar and your three-month average are both calm."),
                    [("Today", lib.draft("sugar.steady", "Your body is holding its sugar steady without strain. Nothing to act on."))])
    if sid == "liver" and st == "steady":
        hsi = rows.get("hsi")
        if hsi and hsi.state == "mid":
            return ("Your liver is working quietly. One score for stored fat sits in the middle zone.",
                    [("Today", "Nothing to feel and nothing to fix."),
                     ("One thing to look at again", "The score that estimates stored fat sits in the middle zone. It is worth a second look at your next test.")])
        if not hsi or hsi.state == "ok":
            return (lib.draft("liver.steady", "Your liver is working quietly."), [("Today", "Nothing to feel and nothing to fix.")])
    if sid == "thyroid":
        tsh = rows.get("tsh")
        if tsh and tsh.level and tsh.hi is not None and tsh.value > tsh.hi and not any(r.level for r in sec.rows if r.key != "tsh"):
            lvl = rank(tsh.level)
            if lvl >= 3:
                tail = " A signal this far outside its range needs a doctor's attention as well, because medicine can be part of the answer."
            elif lvl == 2:
                tail = lib.draft("thyroid.signal.B", " A signal at this level is worth mentioning at your next routine check-up.")
            else:
                tail = lib.draft("thyroid.signal.A", " It is only just outside its range, so the first step is to read it again at your next test.")
            means = [("Today", "People with a raised signal often feel tired, cold or slower than they used to.")]
            if deeper and "ft4" in rows and "ft3" in rows:
                means += [("What the deeper tests add", "Your free hormones are in range. The signal is raised, but your thyroid is still keeping up. Whether your immune system is involved is the next thing to check."),
                          ("What to do", "This needs a deeper look, read alongside your history: what is pushing the signal up while the hormones hold." + tail)]
            else:
                means += [("What to do", "This needs a deeper look: the full thyroid picture, read alongside your history." + tail)]
            return "The signal asking your thyroid to work harder is raised.", means
        if st == "steady":
            return (lib.draft("thyroid.steady", "Your thyroid signal is calm, and the hormones it makes are in range."),
                    [("Today", lib.draft("thyroid.steady", "Nothing to act on."))])
    if sid == "kidneys" and st == "steady":
        return "Your kidneys are clearing waste well and your salts are in balance.", [("Today", "Clear. Nothing to act on.")]
    if sid == "blood" and st == "steady":
        return ("Your red cells are fresh and even. This is the strongest part of your report.",
                [("Today", "Red cells like these go with stamina and good recovery.")])
    if sid == "nutrients":
        only_b12 = b12_high(rows) and [r.key for r in flagged] == ["b12"]
        if only_b12:
            means = [("Today", "Nothing here is short. A B12 this high usually comes from supplements or fortified food.")]
            if _lv(rows, "hcy") >= 2:
                means.append(("Why it matters in your report", "Homocysteine normally comes down when B12 is plentiful. Yours is high while your B12 is full, so a shortage of B12 is not the explanation. That requires a deeper look and further investigation."))
            return "Your vitamin D and iron are comfortably in range. Your B12 is well above it.", means
        if st == "steady":
            return (lib.draft("nutrients.steady", "Your vitamin D, B12 and iron are all comfortably in range."),
                    [("Today", lib.draft("nutrients.steady", "Nothing here is short and nothing is overfull."))])
    if sid == "metals" and st == "steady":
        head = "No heavy metal is above range."
        if any(r.illustrative for r in sec.rows):
            head += " These values are illustrative: the test profile has no metals results."
        return head, [("Today", "Nothing to trace and nothing to act on.")]
    return lib.need(f"section.{sid}", what or f"status '{st}'"), []


def stand_numbers(sec: Section, rows: dict[str, Row], lib: Lib) -> str:
    """The small line of key numbers under a finding on page 1."""
    if sec.id == "heart" and _glv(rows, "lipids") >= 1:
        r = rows.get("apob")
        bits = [f"ApoB {num(r.value)} {r.unit} · usual aim under 100"] if r else []
        if not r and "ldl" in rows:
            bits = [f"LDL cholesterol {num(rows['ldl'].value)} {rows['ldl'].unit} · under 100 ideal"]
        h = rows.get("hcy")
        if h and rank(h.level) >= 2:
            bits.append(f"homocysteine {num(h.value)} {h.unit} · {distance(h)}")
        return " &nbsp;|&nbsp; ".join(bits)
    if sec.id == "sugar" and _lv(rows, "hba1c") >= 1:
        return f"HbA1c {num(rows['hba1c'].value)}% · lab under 5.7"
    flagged = sorted((r for r in sec.rows if r.level and not r.calc), key=lambda r: -rank(r.level))
    if flagged:
        r = flagged[0]
        return f"{r.name} {num(r.value)} {r.unit} · {r.rtxt}"
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


def deep_step(deep: list[Row], lib: Lib, link: bool = True) -> str:
    """Step 3 on page 1: the results that need a deeper look, with the doctor or check-up line each one earns."""
    names = []
    for r in deep:
        n, sid = noun(r.key, lib)
        names.append(f'your <a href="#{sid}">{n}</a>' if link else f"your {n}")
    plain = [noun(r.key, lib)[0] for r in deep]
    if len(deep) == 1:
        s = f"{names[0][0].upper()}{names[0][1:]}. It sits well outside its range, and blood alone cannot say why."
    elif len(deep) == 2:
        s = f"{names[0][0].upper()}{names[0][1:]} and {names[1]}. Both sit well outside their range, and blood alone cannot say why."
    else:
        s = lib.draft("todo.deep.many", f"{join(names)[0].upper()}{join(names)[1:]}. All sit well outside their range, and blood alone cannot say why.")
    s += " That takes your history and a few further tests."
    far = [n for r, n in zip(deep, plain) if rank(r.level) >= 3]
    clear = [n for r, n in zip(deep, plain) if rank(r.level) == 2]
    parts = []
    if far:
        parts.append(f"The {join(far)} {'is' if len(far) == 1 else 'are'} far enough out to need a doctor's attention as well")
    if clear:
        lead = "the" if parts else "The"
        parts.append(f"{lead} {join(clear)} {'is' if len(clear) == 1 else 'are'} worth mentioning at your next routine check-up")
    if parts:
        s += " " + ", and ".join(parts) + "."
    return s


def todo_steps(rp: Any, lib: Lib) -> list[dict]:
    """The numbered steps on page 1: start tonight, what we can work on, what needs a deeper look."""
    rows = rp.rows
    steps: list[dict] = []
    lip, sug = _glv(rows, "lipids"), _glv(rows, "sugar")
    if lip or sug:
        steps.append(dict(tag="Start tonight", when="free", short="a ten-minute walk after your largest meal, tonight",
                          text="Walk for ten minutes after your largest meal, every day until your next test. It helps your body clear the sugar from that meal."))
    else:
        steps.append(dict(tag="Start tonight", when="free", short="a ten-minute walk after your largest meal, tonight",
                          text=lib.draft("todo.start.steady", "Walk for ten minutes after your largest meal, every day until your next test. It is the cheapest way to keep these numbers where they are.")))
    if lip >= 2:
        steps.append(dict(tag="What we can work on", when="over the next few months",
                          email="Bringing the artery load down through how you eat: which fats, how much fibre, what dinner looks like, what you reach for between meals.",
                          text='Bringing the <a href="#heart">artery load</a> down through how you eat: which fats, how much fibre, what dinner looks like, what you reach for between meals. Most people know the headline. Few manage it alone, because it comes down to your own routine, whether that is your kitchen or a restaurant menu.'))
    elif any(s.status in ("needs attention", "watch") for s in rp.sections):
        work = [s.name.lower() for s in rp.sections if s.status in ("needs attention", "watch")]
        t = lib.draft("todo.work.other", f"Your {join(work)}. Food, movement and sleep move these within months, and the sections behind this page show what moves each one.")
        steps.append(dict(tag="What we can work on", when="over the next few months", text=t, email=t))
    deep = [rows[k] for k in rp.decision.deep_rows]
    if deep:
        deep.sort(key=lambda r: -rank(r.level))
        steps.append(dict(tag="Needs a deeper look", when="the next step", text=deep_step(deep, lib), email=deep_step(deep, lib, link=False)))
    for s in steps:
        s.setdefault("email", s["text"])
    return steps


def letter(rp: Any, lib: Lib) -> list[str]:
    gap, name = rp.decision.body_age_gap, rp.name
    heart = next((s for s in rp.sections if s.id == "heart"), None)
    if gap <= -3:
        first = f"{name}, this is a strong first result, and it is worth protecting."
    elif gap > 3:
        first = lib.draft("letter.older", f"{name}, this first result reads older than your age, and most of what is driving it can be moved.")
    else:
        first = lib.draft("letter.level", f"{name}, this is a steady first result: your blood reads close to your age.")
    out = [first]
    if heart and heart.status == "needs attention" and gap <= -3:
        out.append("One thing in here does not match the rest: your arteries. That is where I would put the effort this year.")
    elif rp.decision.outcome in ("nothing", "self"):
        out.append(lib.draft("letter.steady", "Nothing in here needs fixing. The few things worth keeping an eye on are marked, with what moves each one."))
    else:
        off = [s.name.lower() for s in rp.sections if s.key == "att"]
        out.append(lib.draft("letter.other", f"The part I would put the effort into this year: your {join(off)}."))
    return out


def rest_line(rp: Any, lib: Lib) -> str:
    names = []
    for s in rp.sections:
        if s.status != "steady":
            continue
        if s.id in REST_NAME:
            names.append(REST_NAME[s.id])
        else:
            names.append(lib.draft(f"rest.{s.id}", REST_NAME_DRAFT[s.id]))
    line = f"Everything else is steady: {join(names)}." if names else ""
    shown = {x["id"] for x in rp.stand}
    extra = [s for s in rp.sections if s.status != "steady" and s.id not in shown]
    for s in extra:
        if s.id == "nutrients" and b12_high(rp.rows) and _lv(rp.rows, "hcy") >= 2:
            line += " Your B12 is high, which matters for one finding above."
        else:
            line += lib.draft("rest.also", f" Also marked “{s.status}”: {s.name.lower()}.")
    return line.strip()


# ── body age ─────────────────────────────────────────────────────────────────
def body_age_means(rp: Any, lib: Lib) -> tuple[str, str]:
    """(what your number means for you, the end of the cholesterol caveat)."""
    gap, ba, age = rp.decision.body_age_gap, num(rp.body_age), rp.age
    n = word(round(abs(gap)))
    heart = next((s for s in rp.sections if s.id == "heart"), None)
    if gap <= -1.5:
        means = (f"A body age of {ba} at {age} does not promise {n} extra years. It says that today your blood looks like that of "
                 "a younger person in those studies. That is worth protecting.")
    elif gap >= 1.5:
        means = lib.draft("bodyage.older", f"A body age of {ba} at {age} does not mean {n} years are lost. It says that today your blood looks like "
                          "that of an older person in those studies, and the values behind it can move.")
    else:
        means = lib.draft("bodyage.level", f"A body age of {ba} at {age} says that today your blood looks much like that of other people your age in those studies.")
    tail = "."
    if gap <= -1.5 and heart and heart.key == "att":
        tail = f", and why yours can read {n} years younger while your heart section still needs attention."
    return means, tail


# ── next test ────────────────────────────────────────────────────────────────
def next_test(rp: Any, lib: Lib) -> dict:
    rows, d = rp.rows, day(rp.next_test)
    if all(s.status == "steady" for s in rp.sections):
        return dict(headline=lib.draft("next.steady", "About a year after this test, because this report is steady all through."),
                    when=[lib.draft("next.steady", f"<b>Your next test:</b> {d}. A year is long enough to show whether anything has started to drift.")],
                    expect=[("What we would hope to see", lib.draft("next.steady", "The same steady picture, and a body age that has held or come down."))])
    work = [work_noun(g, lib)[1] for g in ("lipids", "sugar") if _glv(rows, g)]
    when = []
    if work:
        when.append(f"<b>If you work on this yourself:</b> {d}. Four months is long enough for {join(['your ' + w for w in work])} to show a change.")
    else:
        when.append(lib.draft("next.work.other", f"<b>If you work on this yourself:</b> {d}. Four months is long enough for a change to show."))
    if _lv(rows, "tsh") >= 2:
        when.append("<b>If your thyroid is rechecked sooner:</b> use that date. A change there can move your cholesterol too.")
    when.append("<b>When a report is steady all through:</b> about a year is enough. Yours is not there yet.")
    expect = []
    moving = [work_noun(g, lib)[1] for g in ("lipids", "sugar") if _glv(rows, g)] + (["inflammation"] if _lv(rows, "hscrp") else [])
    if moving:
        expect.append(("What can move in four months", "T" + join(["the " + m for m in moving])[1:] + "."))
    heart = next((s for s in rp.sections if s.id == "heart"), None)
    if heart and heart.status == "needs attention" and rp.decision.body_age_gap <= -1.5:
        expect.append(("What we would hope to see", "Your body age holding where it is, and the heart picture moving from “needs attention” towards “watch”."))
    elif moving:
        expect.append(("What we would hope to see", lib.draft("next.hope.other", "The marked results moving back towards their range, and your body age holding or coming down.")))
    lpa = rows.get("lpa")
    if lpa and lpa.level:
        expect.append(("What will not move", f"One part of your heart picture is largely inherited (Lp(a) {num(lpa.value)} {lpa.unit} · {lpa.rtxt}). It changes little, so there is no need to repeat it at four months."))
    return dict(headline="Four months after this test, because this report has things to work on.", when=when, expect=expect)


# ── your report on one page ──────────────────────────────────────────────────
def _line(level: str) -> str:
    return {2: " Worth mentioning at your next routine check-up.", 3: " Needs a doctor's attention as well.", 4: " Needs a doctor's attention as well."}.get(rank(level), "")


def summary(rp: Any, lib: Lib) -> dict:
    rows, deeper = rp.rows, rp.kind == "deeper"
    work, deep = [], []
    for s in rp.sections:
        if s.status == "steady":
            continue
        if s.id == "heart" and _glv(rows, "lipids") >= 1:
            lv = max((r for r in s.rows if r.group == "lipids" and not r.calc), key=lambda r: rank(r.level)).level
            work.append((s.name, "The load of cholesterol particles your arteries carry." + _line(lv), s.id))
        elif s.id == "sugar" and _lv(rows, "hba1c") == 1:
            work.append((s.name, "Your three-month sugar average, just above the line.", s.id))
        elif s.id == "nutrients" and b12_high(rows) and [r.key for r in s.rows if r.level] == ["b12"] and _lv(rows, "hcy") >= 2:
            pass                # told inside the homocysteine line below
        elif any(r.level and r.nature == "work" and not r.calc for r in s.rows):
            r = max((r for r in s.rows if r.level and r.nature == "work" and not r.calc), key=lambda r: rank(r.level))
            work.append((s.name, lib.draft("summary.work.other", f"{r.name} {num(r.value)} {r.unit}, {distance(r) if r.state == 'out' else 'in the middle zone'}.") + _line(r.level), s.id))
    for k in rp.decision.deep_rows:
        r = rows[k]
        sid = next(s.id for s in rp.sections if r in s.rows)
        if k == "tsh":
            hold = ", while the hormones hold" if deeper and _ok(rows, "ft4") and _ok(rows, "ft3") else ""
            deep.append(("Thyroid signal", f"TSH {num(r.value)} {r.unit}, {how_far(r)}{hold}." + _line(r.level), sid))
        elif k == "hcy":
            full = ", although your B12 is full" if deeper and b12_high(rows) else ""
            deep.append(("Homocysteine", f"{num(r.value)} {r.unit}, {distance(r)}{full}." + _line(r.level), sid))
        else:
            n, _sid = noun(k, lib)
            deep.append((n[0].upper() + n[1:], lib.draft("summary.deep.other", f"{num(r.value)} {r.unit}, {distance(r)}.") + _line(r.level), sid))
    gapw, _n = gap_words(rp.decision.body_age_gap)
    start = rp.todo[0]["short"] if rp.todo else ""
    return dict(headline=f"Your body age is {num(rp.body_age)} at {rp.age}: {gapw}.", work=work, deep=deep,
                where=f"Where to start: {start}. Your next test: {day(rp.next_test)}.")


# ── your next step ───────────────────────────────────────────────────────────
def next_step(rp: Any, lib: Lib) -> dict:
    """The last section: one tailored step, or none. Never a price menu."""
    d, rows = rp.decision, rp.rows
    sample_day, deadline = day(rp.sample_date, year=False), day(rp.deadline)
    if d.outcome == "nothing":
        return dict(outcome="nothing", headline=lib.draft("step.nothing", "You do not need anything more from me."),
                    paras=[lib.draft("step.nothing", f"Your report is steady all through. Keep doing what you are doing, and test again in about a year, on {day(rp.next_test)}.")])
    if d.outcome == "self":
        return dict(outcome="self", headline=lib.draft("step.self", "Nothing here needs me. The steps on the first page are yours to take."),
                    paras=[lib.draft("step.self", f"What is marked in this report sits just outside its range, and everyday changes move it. Your next test, on {day(rp.next_test)}, will show what they did.")])
    if d.outcome == "doctor_only":
        names = [noun(k, lib)[0] for k in d.deep_rows]
        return dict(outcome="doctor_only", headline=lib.draft("step.doctor_only", f"One result here needs a doctor's attention: your {join(names)}."),
                    paras=[lib.draft("step.doctor_only", "It is inherited, and food does not move it. Take this report to your doctor. Everything else in it is steady, so you do not need a session with me.")])

    deep = sorted((rows[k] for k in d.deep_rows), key=lambda r: -rank(r.level))
    names = [noun(r.key, lib)[0] for r in deep]
    work_b = [work_noun(g, lib)[0] for g in ("lipids", "sugar", "inflammation") if _glv(rows, g) >= 2]
    far = [n for r, n in zip(deep, names) if rank(r.level) >= 3]
    clear = [n for r, n in zip(deep, names) if rank(r.level) == 2] + work_b
    if deep:
        k = len(deep)
        headline = (f"{word(k).capitalize()} result{'s' if k != 1 else ''} in this report need{'' if k != 1 else 's'} a deeper look: "
                    f"{join(['your ' + n for n in names])}.")
        why = "Blood shows what is off. It cannot show why. That takes your history: how you eat and sleep, what you take, what runs in your family, and when things began to change."
        leave = (f"Why {'these ' + word(k) + ' results are where they are' if k != 1 else 'this result is where it is'}, as far as it can be known, "
                 "and the order to work in: which to tackle first, what to change at your table and in your day, and what to leave alone.")
    else:
        things = work_b or [s.name.lower() for s in rp.sections if s.status != "steady"]
        headline = lib.draft("step.foundation.work", f"{word(len(things)).capitalize()} thing{'s' if len(things) != 1 else ''} in this report {'are' if len(things) != 1 else 'is'} worth working on with help: {join(['your ' + t for t in things])}.")
        why = lib.draft("step.foundation.work", "Blood shows what is off. What moves it is in your routine: how you eat and sleep, what you take, what runs in your family, and when things began to change.")
        leave = lib.draft("step.foundation.work", "What is driving these numbers in your own routine, and the order to work in: which to tackle first, what to change at your table and in your day, and what to leave alone.")
    second = ""
    if far:
        if far == ["thyroid signal"]:
            second = ("Your thyroid signal is far enough outside its range to need a doctor's attention as well. See yours. The session covers the rest: "
                      "why it is happening, as far as it can be known, and what food, sleep and stress are doing to it.")
        else:
            second = lib.draft("step.foundation.far", f"Your {join(far)} {'is' if len(far) == 1 else 'are'} far enough outside range to need a doctor's attention as well. See yours. "
                               "The session covers the rest: why it is happening, as far as it can be known, and what food, sleep and stress are doing to it.")
    far_only = second
    if clear:
        second += (" " if second else "") + f"Your {join(clear[:1] + ['your ' + c for c in clear[1:]])} {'are' if len(clear) != 1 or clear[0].endswith('s') else 'is'} worth mentioning at your next routine check-up."
    return dict(
        outcome="foundation", headline=headline, paras=[p for p in (why, second) if p],
        email_paras=[p for p in (why, far_only) if p],
        price=rp.foundation_after, credit=f"{inr(rp.foundation_list)}, with what you paid for this report taken off, if you book by {deadline}.",
        steps=[
            ("Before we meet", "You fill in your full history in your own time, about 25 minutes, one short section at a time. It covers your health story in the order it happened, your diagnoses and family history, medicines past and present, how you eat, sleep, move and handle stress, your childhood and surroundings, what you have already tried, and each part of your body that bothers you. This is the part blood cannot show."),
            ("When we meet", "I read your history against this report, and we go through both together."),
            ("Further tests", "You get the short list worth doing for you, and I read those with you when they are back. Most people need two to four, usually ₹1,000 to ₹5,000 in all, paid to the laboratory. You see the list and the price before you decide."),
            ("What you leave with", leave),
        ],
        fresh=f"These results show you as you were on {sample_day}, and a deeper look is most use while they are fresh. That is why your report fee comes off only until {deadline}.",
        after="Nothing, unless you want it. You leave with the order to work in, and I see you at your next test.",
        email_offer=f"<b>A Foundation session, {inr(rp.foundation_after)}.</b> That is {inr(rp.foundation_list)}, with what you paid for this report taken off, if you book by {deadline}.",
        email_how="You fill in your history first. Then we meet, I read it against your report, and you leave with the short list of further tests worth doing and the order to work in.")
