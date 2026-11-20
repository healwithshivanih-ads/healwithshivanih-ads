"""The findings a body age report can have, and what it says about each one.

One block per finding. A finding claims the results (rows) that mean the same thing to a reader: the whole
cholesterol family is one finding, both liver enzymes are one finding. Each block carries, by level
(A just outside / B clearly off / C far out):

    head   the section's headline when this is the main finding in its section
    today  how it shows up in daily life
    why    why it matters (printed under `why_title`)
    do     what to do about it
    line   the doctor or check-up sentence the level earns (levels B and C only)

`approved=True` blocks are the sentences in the PDFs Shivani approved on 19 Nov 2026. The rest are DRAFTS
written for her approval; a report that uses one lists it. Rules for every sentence: plain meaning first, no
lecture on markers, no supplement or medicine advice, no programme; a doctor is named only at level C and a
routine check-up only at level B, in the fixed words below.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Union

from .levels import rank
from .panel import Row, Section

Text = Union[str, dict]

LINE_B = " A result at this level is worth mentioning at your next routine check-up."
LINE_C = " A result this far outside its range needs a doctor's attention. Please speak to your doctor."
# The strongest level (D). Shivani, 19 Nov 2026: nothing is called urgent, a buyer may panic; the report says the same
# thing as far-out in slightly stronger words and is sent like any other. DRAFT until she approves the sentence.
LINE_D = " A result at this level needs a doctor's attention soon. Please see your doctor in the next day or two."
LINE_D_SHORT = " Needs a doctor's attention soon."


@dataclass
class Finding:
    id: str
    section: str
    title: str                        # the bold lead-in when this is not the section's main finding
    noun: str                         # inside a sentence: "your <noun>"
    high: tuple = ()                  # rows that are this finding when they read high
    low: tuple = ()                   # ... when they read low
    either: tuple = ()                # ... either way
    head: Text = ""
    today: Text = "Nothing you would feel."
    why_title: str = "Why it matters"
    why: Text = ""
    do: Text = ""
    line: dict = field(default_factory=lambda: {"B": LINE_B, "C": LINE_C})
    extra: tuple = ()                 # further fixed paragraphs: ((title, text), ...)
    summary: Text = ""                # the line in "Your report on one page"
    step: str = ""                    # page 1, "what we can work on" (results that food, movement and sleep move)
    moves: str = ""                   # named in "what can move in four months"
    plural: bool = False
    approved: tuple = ()              # levels whose wording is approved, e.g. ("B",)


F = Finding
FINDINGS: list[Finding] = [
    # ── Heart and arteries ──────────────────────────────────────────────────
    F("lipids", "heart", "Your artery numbers", "artery numbers", plural=True,
      high=("apob", "ldl", "non_hdl", "tc"),
      head={"A": "Your arteries are carrying a slightly heavier load of cholesterol particles than we would like.",
            "B": "Your arteries are carrying a heavier load of cholesterol particles than is good for them.",
            "C": "Your arteries are carrying a heavier load of cholesterol particles than is good for them."},
      today="You feel nothing. That is the difficulty with this one.",
      why_title="Over the years",
      why={"A": "A heavier particle load is one of the patterns linked with heart disease later in life. At this level it is early, and it is one of the most changeable numbers in your report.",
           "B": "A heavy particle load is one of the patterns linked with heart disease later in life. It is also one of the most changeable.",
           "C": "A heavy particle load is one of the patterns linked with heart disease later in life. It is also one of the most changeable."},
      extra=(("New in this report", "A standard check-up counts the cholesterol. This counts the particles carrying it, and adds a second marker of artery wear."),),
      do={"A": "Food comes first: the kind of fat, the amount of fibre, what dinner looks like.",
          "B": "Food comes first, and that is where the work starts.", "C": "Food comes first, and that is where the work starts."},
      line={"B": " Numbers at this level are also worth mentioning at your next routine check-up.",
            "C": " Numbers at this level need a doctor's attention, because medicine can be part of the answer. Please speak to your doctor."},
      summary={"A": "The load of cholesterol particles your arteries carry, a little above the aim.",
               "B": "The load of cholesterol particles your arteries carry.", "C": "The load of cholesterol particles your arteries carry."},
      step='Bringing the <a href="#heart">artery load</a> down through how you eat: which fats, how much fibre, what dinner looks like, what you reach for between meals.',
      moves="artery load", approved=("B",)),
    F("tg", "heart", "Triglycerides", "triglycerides", plural=True, high=("tg",),
      head={"A": "The fat travelling in your blood sits just above the line.", "B": "The fat travelling in your blood appears to be clearly raised.",
            "C": "The fat travelling in your blood appears to be very high."},
      why={"A": "Triglycerides rise with sugar, refined carbohydrate and alcohol more than with fat, and they fall quickly when those change. Raised for years, they add to the load on your arteries.",
           "B": "Triglycerides rise with sugar, refined carbohydrate and alcohol more than with fat, and they fall quickly when those change. Raised for years, they add to the load on your arteries.",
           "C": "At this level triglycerides can become a risk of their own, because they can sometimes inflame the pancreas."},
      today={"A": "Nothing you would feel.", "B": "Nothing you would feel.",
             "C": "Often nothing. Severe pain in the upper belly would be a reason not to wait."},
      do="Less sugar, refined carbohydrate and alcohol, and a walk after meals. This number often moves within weeks.",
      summary={"A": "Triglycerides, the fat travelling in your blood, just above the line.",
               "B": "Triglycerides, the fat travelling in your blood, clearly raised.", "C": "Triglycerides, the fat travelling in your blood, very high."},
      step='Bringing your <a href="#heart">triglycerides</a> down: less sugar, refined carbohydrate and alcohol, and a walk after meals.',
      moves="triglycerides"),
    F("hdl_low", "heart", "Protective cholesterol", "protective cholesterol", low=("hdl", "apoa1"),
      head={"A": "Your protective cholesterol is on the low side.", "B": "Your protective cholesterol appears to be clearly low."},
      why="Low protective cholesterol usually travels with raised triglycerides, weight around the middle and too little movement. It is a sign of those, more than a target of its own.",
      do="Regular movement, and the changes that bring triglycerides down.",
      summary={"A": "Protective cholesterol, on the low side.", "B": "Protective cholesterol, clearly low."},
      step='More regular movement, which is what a low <a href="#heart">protective cholesterol</a> points to.', moves="protective cholesterol"),
    F("crp", "heart", "Background inflammation", "inflammation marker", high=("hscrp",),
      head={"A": "Your inflammation marker sits in the middle zone, where most adults are.",
            "B": "Your background inflammation appears to be clearly raised.",
            "C": "Your inflammation marker appears to be very high, which usually means your body was fighting something on the day of the test."},
      why={"A": "This marker rises with anything that keeps the body on alert: short sleep, extra weight around the middle, gum trouble, a recent cold. In the middle zone it is something to keep low, not something to worry about.",
           "B": "A raised reading can come from a passing infection, a hard workout or a poor week before the test, so one reading is not a verdict. If it stays raised, it adds to the wear on your arteries.",
           "C": "A reading this high is most often an infection or an injury. It also makes the body age in this report read older than it really is."},
      today={"A": "Nothing you would feel.", "B": "Nothing you would feel.", "C": "You may have felt unwell around the day of the test."},
      do={"A": "Sleep, movement and less processed food usually bring it down.",
          "B": "Consider reading it again in a few weeks, when you are well and rested. If it is still raised, it needs a deeper look for where it is coming from.",
          "C": "Consider repeating the test once you are well, and read your body age from that one."},
      summary={"A": "Background inflammation, in the middle zone.", "B": "Background inflammation, clearly raised.",
               "C": "Inflammation, very high on the day of the test."},
      step='Calming the <a href="#heart">background inflammation</a> through sleep, movement and less processed food.',
      moves="inflammation"),
    F("hcy", "heart", "Homocysteine", "homocysteine", high=("hcy",),
      head={"A": "Your homocysteine sits just above its range.", "B": "Your homocysteine appears to be clearly above its range.",
            "C": "Your homocysteine appears to be far above its range."},
      why="Homocysteine is a by-product the body clears with the help of B vitamins. High levels go with artery disease, though bringing the number down has not been shown to prevent it. The useful question is why it is raised.",
      do={"A": "Leafy greens, pulses and eggs supply the vitamins that clear it. It is read again at your next test.",
          "B": "This needs a deeper look: why it is building up. That takes your history and a few further tests.",
          "C": "This needs a deeper look: why it is building up. That takes your history and a few further tests."},
      summary={"A": "Homocysteine, just above its range. Read again at your next test."}),
    F("lpa", "heart", "Lp(a), the inherited particle", "Lp(a)", high=("lpa",),
      head={"A": "One inherited part of your heart picture sits just above the line.",
            "B": "One inherited part of your heart picture appears to be clearly raised.",
            "C": "One inherited part of your heart picture appears to be far above the line."},
      why={"A": "Lp(a) is a cholesterol particle set almost entirely by your genes. Food and exercise barely move it. Just above the line, it matters mainly as a reason to keep the rest of this section in good shape.",
           "B": "Lp(a) is a cholesterol particle set almost entirely by your genes. Food and exercise barely move it. A raised level adds to whatever the other numbers carry, so the other numbers matter more for you than for most people.",
           "C": "Lp(a) is a cholesterol particle set almost entirely by your genes. Food and exercise barely move it. At this level it can be a risk of its own, whatever the other numbers say."},
      do={"A": "Nothing to do about the number itself. It rarely needs testing again.",
          "B": "Keep the rest of this section as good as it can be. It runs in families, so it is worth telling yours.",
          "C": "Keep the rest of this section as good as it can be. It runs in families, so it is worth telling yours."},
      line={"B": LINE_B, "C": " A level this high needs a doctor's attention, because there are things a doctor can do about the overall risk. Please speak to your doctor."},
      summary={"A": "Lp(a), an inherited particle, just above the line. Nothing to do."}),
    # ── Energy and sugar ────────────────────────────────────────────────────
    F("sugar", "sugar", "Your sugar", "sugar average", high=("hba1c", "glucose", "insulin"),
      head={"A": "Your sugar sits just above the line.",
            "B": "Your sugar appears to be clearly above the line.",
            "C": "Your sugar appears to be well above the line."},
      today={"A": "You may notice nothing at all.",
             "B": "Many people feel nothing. Some notice a dip in energy after meals, or more thirst than usual.",
             "C": "Some people feel tired, thirsty or pass urine more often. Many feel nothing."},
      why_title="What it means",
      why={"A": "Your body is working a little harder than it should to handle sugar. This is the stage where it turns around most easily.",
           "B": "Laboratories mark this range as prediabetes. At this level the body may be struggling to keep sugar in line, and it tends to drift upward if nothing changes. It is also the stage where food, movement and sleep change the number most.",
           "C": "Laboratories mark this range as diabetes, and one reading is usually confirmed with a second. The three-month average can also read falsely high or low with anaemia or an inherited haemoglobin trait. Food, movement and sleep still matter a great deal, and they are the part we can work on."},
      do={"A": "What is on the plate and when, and a walk after your largest meal.",
          "B": "This is the first thing to work on: what is on the plate and when, movement after meals, and sleep.",
          "C": "What is on the plate and when, movement after meals, and sleep. If you already take medicine for sugar, do not change it because of this report."},
      summary={"A": "Your sugar, just above the line.", "B": "Your sugar, clearly above the line.",
               "C": "Your sugar, well above the line."},
      step='Bringing your <a href="#sugar">sugar average</a> down through what is on the plate and when, movement after meals, and sleep.',
      moves="sugar average"),
    F("glucose_low", "sugar", "A low morning sugar", "morning sugar", low=("glucose",),
      head="Your morning sugar is lower than its range.",
      today="Some people feel shaky, sweaty or foggy when sugar runs low, especially after a long gap without food.",
      why="A low fasting reading can simply be a long fast before the test. It can also be how your body handles sugar, or something you take.",
      do="It needs a deeper look, read with how you felt that morning and what you take.",
      summary="Your morning sugar, lower than its range."),
    F("uric", "sugar", "Uric acid", "uric acid", high=("uric",),
      head={"A": "Your uric acid sits just above its range.", "B": "Your uric acid appears to be clearly above its range.",
            "C": "Your uric acid appears to be far above its range."},
      why="Uric acid rises with sweet drinks, alcohol, red meat and shellfish, and with sugar strain in general. High for long enough, it can settle in joints.",
      today={"A": "Nothing you would feel.", "B": "Nothing you would feel.", "C": "Often nothing. A hot, swollen, painful joint would be a reason not to wait."},
      do="More water, fewer sweet drinks and less alcohol usually bring it down.",
      summary={"A": "Uric acid, just above its range.", "B": "Uric acid, clearly above its range.", "C": "Uric acid, far above its range."},
      step='Bringing your <a href="#sugar">uric acid</a> down: more water, fewer sweet drinks, less alcohol.', moves="uric acid"),
    # ── Liver ───────────────────────────────────────────────────────────────
    F("enzymes", "liver", "Liver enzymes", "liver enzymes", plural=True, high=("alt", "ast", "ggt"),
      head={"A": "One of your liver enzymes sits just above its range.", "B": "Your liver enzymes appear to be clearly raised.",
            "C": "Your liver enzymes appear to be far above their range."},
      why={"A": "Enzymes leak into the blood when liver cells are irritated. A small rise is common after a hard workout, a few drinks, a new medicine or supplement, or with fat stored in the liver.",
           "B": "Something may be irritating your liver cells. Alcohol, stored fat, a medicine or supplement, and infections are the usual reasons.",
           "C": "Something appears to be irritating your liver cells, more than a passing cause usually explains."},
      today={"A": "Nothing you would feel.", "B": "Nothing you would feel.",
             "C": "Often nothing. Yellowing of the eyes, dark urine or pain under the right ribs would be a reason not to wait."},
      do={"A": "Go easy on alcohol and sugar, and it is read again at your next test.",
          "B": "This needs a deeper look: what you take and drink, and a few further tests.",
          "C": "This needs a deeper look: what you take and drink, and a few further tests."},
      summary={"A": "A liver enzyme, just above its range. Read again at your next test."}),
    F("alp", "liver", "ALP", "ALP", high=("alp",),
      head="One enzyme linked with bile flow and bone sits above its range.",
      why="ALP comes from both the liver and the bones, so a raised reading only makes sense beside the other liver results and vitamin D.",
      do={"A": "It is read again at your next test, alongside vitamin D.", "B": "It needs a deeper look, alongside vitamin D.",
          "C": "It needs a deeper look, alongside vitamin D."},
      summary={"A": "ALP, just above its range. Read again at your next test."}),
    F("bilirubin", "liver", "Bilirubin", "bilirubin", high=("bilirubin",),
      head={"A": "The pigment your liver clears is a little raised.", "B": "The pigment your liver clears appears to be clearly raised.",
            "C": "The pigment your liver clears appears to be far above its range."},
      today={"A": "Nothing you would feel.", "B": "Sometimes a yellow tinge in the whites of the eyes. Often nothing.",
             "C": "Sometimes a yellow tinge in the whites of the eyes. Often nothing."},
      why={"A": "A mildly raised bilirubin is common. It often runs in families, and it rises after fasting, which you were doing for this test. It is read with the rest of your liver results.",
           "B": "Bilirubin is made when old red cells are broken down, and the liver clears it. A clear rise can mean more is being made or less is being cleared.",
           "C": "Bilirubin is made when old red cells are broken down, and the liver clears it. A rise this large usually means more is being made or less is being cleared."},
      do={"A": "It is read again at your next test.", "B": "It needs a deeper look, read with the rest of your liver results and your blood count.",
          "C": "It needs a deeper look, read with the rest of your liver results and your blood count."},
      summary={"A": "Bilirubin, a little raised. Read again at your next test."}),
    F("albumin", "liver", "Albumin", "albumin", low=("albumin",),
      head={"A": "Your albumin sits just below its range.", "B": "Your albumin appears to be clearly below its range.",
            "C": "Your albumin appears to be far below its range."},
      today={"A": "Nothing you would feel.", "B": "Usually nothing.",
             "C": "Often nothing. Swollen ankles or a puffy face would be a reason not to wait."},
      why={"A": "Albumin is the main protein your liver makes. It dips after an illness and when food has been short of protein for a while.",
           "B": "Albumin is the main protein your liver makes. It falls when the liver makes less, when protein is lost through the kidneys or the gut, when the body is inflamed, or when food has been short of protein for a while. One reading cannot say which.",
           "C": "Albumin is the main protein your liver makes. A fall this large usually has a reason, and it is worth finding: the liver making less, protein being lost through the kidneys or the gut, or a long-running inflammation."},
      do={"A": "It is read again at your next test.", "B": "This needs a deeper look, starting with a repeat test.",
          "C": "This needs a deeper look, starting with a repeat test in the coming days."},
      summary={"A": "Albumin, just below its range. Read again at your next test."}),
    F("fib4", "liver", "The scarring score", "liver scarring score", high=("fib4",),
      head={"A": "One score that estimates liver scarring sits in the middle zone.",
            "C": "The score that estimates liver scarring is above its upper line."},
      why={"A": "This score is worked out from your age, two liver enzymes and your platelets. In the middle zone it cannot say yes or no, and it reads higher as we get older.",
           "C": "This score is worked out from your age, two liver enzymes and your platelets. Above the upper line it is the usual signal for a scan of the liver."},
      do={"A": "It is read again at your next test. If it stays here, it needs a deeper look.", "C": "It needs a deeper look."},
      summary={"A": "The liver scarring score, in the middle zone. Read again at your next test."}),
    # ── Thyroid ─────────────────────────────────────────────────────────────
    F("tsh_high", "thyroid", "Thyroid signal", "thyroid signal", high=("tsh",),
      head="The signal asking your thyroid to work harder is raised.",
      today={"A": "At this level most people feel nothing.", "B": "People with a raised signal often feel tired, cold or slower than they used to.",
             "C": "People with a raised signal often feel tired, cold or slower than they used to."},
      do={"A": "It is only just outside its range, and many such readings settle. A repeat in two to three months shows whether it has.",
          "B": "This needs a deeper look: the full thyroid picture, read alongside your history.",
          "C": "This needs a deeper look: the full thyroid picture, read alongside your history."},
      line={"B": " A signal at this level is worth mentioning at your next routine check-up.",
            "C": " A signal this far outside its range needs a doctor's attention, because medicine can be part of the answer. Please speak to your doctor."},
      summary={"A": "Thyroid signal, just above its range. Worth repeating in two to three months."}, approved=("C",)),
    F("tsh_low", "thyroid", "Thyroid signal", "thyroid signal", low=("tsh",),
      head={"A": "The signal asking your thyroid to work sits just below its range.",
            "B": "The signal asking your thyroid to work appears to be clearly low.", "C": "The signal asking your thyroid to work appears to be very low."},
      today={"A": "Nothing you would feel.", "B": "Some people with a low signal feel restless or warm, or notice a faster heartbeat.",
             "C": "Some people with a low signal feel restless or warm, or notice a faster heartbeat."},
      why={"A": "A low signal means the brain is asking for less thyroid hormone than usual. Just below the range it is often a passing dip.",
           "B": "A low signal means the brain is asking for less thyroid hormone, usually because there is already plenty in the blood.",
           "C": "A low signal means the brain is asking for less thyroid hormone, usually because there is already plenty in the blood."},
      do={"A": "A repeat in two to three months shows whether it has settled. Biotin, found in hair and nail supplements, can make this test read falsely low, so mention it if you take any.",
          "B": "This needs a deeper look: the full thyroid picture, read alongside your history and what you take.",
          "C": "This needs a deeper look: the full thyroid picture, read alongside your history and what you take."},
      line={"B": " A signal at this level is worth mentioning at your next routine check-up.",
            "C": " A signal this far outside its range needs a doctor's attention, because medicine can be part of the answer. Please speak to your doctor."},
      summary={"A": "Thyroid signal, just below its range. Read again at your next test."}),
    F("thyroid_hormones", "thyroid", "Thyroid hormones", "thyroid hormones", plural=True, either=("t4_total", "t3_total", "ft4", "ft3"),
      head="One of the hormones your thyroid makes sits outside its range.",
      today={"A": "Nothing you would feel.", "B": "Some people notice a racing heart, shakiness or unusual tiredness. Many notice nothing.",
             "C": "Some people notice a racing heart, shakiness or unusual tiredness. If you do, do not wait."},
      why="The signal and the hormones are read as a set. When a hormone is outside its range, the question is whether the signal agrees with it.",
      do={"A": "It is read again at your next test.", "B": "This needs a deeper look: the full thyroid picture, read alongside your history.",
          "C": "This needs a deeper look: the full thyroid picture, read alongside your history."},
      summary={"A": "A thyroid hormone, just outside its range. Read again at your next test."}),
    # ── Kidneys and salts ───────────────────────────────────────────────────
    F("kidney", "kidneys", "Kidney markers", "kidney markers", plural=True, high=("creatinine", "urea", "bun"),
      head={"A": "One marker of how your kidneys clear waste sits just above its range.",
            "B": "A marker of how your kidneys clear waste appears to be clearly raised.",
            "C": "A marker of how your kidneys clear waste appears to be far above its range."},
      why={"A": "Creatinine comes from muscle and urea from protein. Both read higher after a high-protein day, a hard workout or too little water before the test, and in people who carry a lot of muscle.",
           "B": "Creatinine and urea are waste the kidneys clear. When they build up, either more is being made or the kidneys are clearing less. A dry day, a hard workout or a high-protein day before the test can do it too, and a repeat tells these apart.",
           "C": "Creatinine and urea are waste the kidneys clear. A rise like this can mean the kidneys are clearing less than they should, and it is worth confirming."},
      today={"A": "Nothing you would feel.", "B": "Nothing you would feel.",
             "C": "Often nothing. Swollen ankles, passing much less urine or feeling sick would be a reason not to wait."},
      do={"A": "Come to your next test well hydrated, unless you have been told to limit fluids. It is read again then.",
          "B": "This needs a deeper look, starting with a repeat test.",
          "C": "This needs a deeper look, starting with a repeat test in the coming days."},
      summary={"A": "A kidney marker, just above its range. Read again at your next test."}),
    F("salts", "kidneys", "Your salts", "salts", plural=True, either=("sodium", "potassium", "chloride", "calcium"),
      head="One of your body's salts sits outside its range.",
      today={"A": "Nothing you would feel.", "B": "Usually nothing.",
             "C": "Some people feel weak, confused, or notice cramps or an uneven heartbeat. If you do, do not wait."},
      why="Sodium, potassium and calcium are held in a narrow band, so even a small move is marked. The way a sample is handled on its way to the laboratory can raise potassium falsely, and some medicines move all three.",
      do={"A": "It is read again at your next test.", "B": "Consider a repeat test on a fresh sample to confirm.",
          "C": "A repeat test on a fresh sample in the coming days is the usual first step."},
      summary={"A": "One salt, just outside its range. Read again at your next test."}),
    F("egfr_low", "kidneys", "Kidney filtering", "kidney filtering figure", low=("egfr",),
      head={"C": "Your kidney filtering figure appears to be below 60, the line at which it is usually checked again."},
      today={"C": "Nothing you would feel."},
      why={"C": "This figure is worked out from your creatinine, your age and your sex. It estimates how much blood your kidneys clean each minute, and it falls slowly with age. One reading below 60 cannot say whether it will hold: too little water, a hard workout or a high-protein meal before the test can sometimes lower it."},
      do={"C": "A repeat test, with a urine test alongside it, is the usual first step."},
      summary={"C": "Kidney filtering figure, below 60."}),
    # ── Blood count ─────────────────────────────────────────────────────────
    F("hb_low", "blood", "Haemoglobin", "haemoglobin", low=("hb",),
      head={"A": "Your haemoglobin is in range, at the low edge.", "B": "Your haemoglobin appears to be below its range.",
            "C": "Your haemoglobin appears to be low enough that it is worth finding the reason."},
      today={"A": "You may notice nothing, or tire a little sooner than you used to.",
             "B": "Low haemoglobin often shows as tiredness, breathlessness on the stairs or feeling cold.",
             "C": "Low haemoglobin often shows as tiredness, breathlessness on the stairs or feeling cold."},
      why={"A": "Haemoglobin carries oxygen. At the low edge the usual reasons are iron, vitamin B12 or folate running short, or {loss}.",
           "B": "Haemoglobin carries oxygen, and there may be less of it than your body needs. The reason matters more than the number: iron, B12 or folate running short, or {loss}.",
           "C": "Haemoglobin carries oxygen, and there may be less of it than your body needs. A low reading usually has a reason: iron, B12 or folate running short, or {loss}."},
      do={"A": "{iron_food}It is read again at your next test.",
          "B": "This needs a deeper look: your iron, B12 and folate, and where the shortfall is coming from.",
          "C": "This needs a deeper look: your iron, B12 and folate, and where the shortfall is coming from."},
      summary={"A": "Haemoglobin, at the low edge of its range. Read again at your next test."}),
    F("hb_high", "blood", "High red cells", "red cells", plural=True, high=("hb", "hct"),
      head={"A": "Your red cells sit just above their range.", "B": "Your red cells appear to be clearly above their range.",
            "C": "Your red cells appear to be far above their range."},
      today={"A": "Nothing you would feel.", "B": "Nothing you would feel.",
             "C": "Often nothing. Some people notice headaches, a flushed face or itching after a warm bath."},
      why={"A": "Haemoglobin and haematocrit both measure how much of your blood is red cells. A reading a little above the range often means the blood was concentrated: too little water before the test is the commonest reason.",
           "B": "Haemoglobin and haematocrit both measure how much of your blood is red cells. A high reading can sometimes mean the blood was concentrated on the morning of the test. Smoking, living at altitude and sleep broken by pauses in breathing can raise it too. A repeat helps tell these apart.",
           "C": "Haemoglobin and haematocrit both measure how much of your blood is red cells. At this level the blood may be thicker than it should be. Smoking, living at altitude and sleep broken by pauses in breathing can do it, and sometimes the body is making too many red cells. It is worth finding the reason."},
      do={"A": "Come to your next test well hydrated, unless you have been told to limit fluids. It is read again then.",
          "B": "Consider a repeat test, well hydrated, to see whether it holds.",
          "C": "A repeat test in the coming days is the usual first step, with a look at the reason."},
      summary={"A": "Red cells, just above their range. Read again at your next test."}),
    F("red_cells", "blood", "Your red cells", "red cell measures", plural=True, either=("rbc", "mcv", "mch", "rdw"), low=("hct",),
      head="One measure of your red cells sits outside its range.",
      why="The size, number and evenness of red cells shift when iron, B12 or folate run low, sometimes before haemoglobin does. Being a little dry on the morning of the test can also raise the count.",
      do={"A": "It is read again at your next test, alongside your iron and B12.", "B": "It needs a deeper look, alongside your iron and B12.",
          "C": "It needs a deeper look, alongside your iron and B12."},
      summary={"A": "One red cell measure, just outside its range. Read again at your next test."}),
    F("white_cells", "blood", "Your white cells", "white cell count", either=("wbc", "lymph"),
      head="Your white cells sit outside their range.",
      today={"A": "Nothing you would feel.", "B": "Nothing you would feel.",
             "C": "Often nothing. Fever, infections that keep coming back or easy bruising would be a reason not to wait."},
      why={"A": "White cells rise with an infection or stress on the body, and can dip for a few weeks after a viral illness. A repeat shows whether it was passing.",
           "B": "White cells rise with an infection or stress on the body, and can dip for a few weeks after a viral illness. A repeat shows whether it was passing.",
           "C": "White cells rise with an infection or stress on the body and can fall after a viral illness. A count this far outside its range is worth checking again, not leaving to settle by itself."},
      do={"A": "It is read again at your next test.", "B": "Consider a repeat test when you are well.", "C": "A repeat test in the coming days is the usual first step."},
      summary={"A": "White cells, just outside their range. Read again at your next test."}),
    F("platelets_high", "blood", "High platelets", "platelet count", high=("platelets",),
      head={"A": "Your platelet count sits just above its range.", "B": "Your platelet count appears to be clearly above its range.",
            "C": "Your platelet count appears to be far above its range."},
      why={"A": "Platelets are the cells that help blood clot. A count a little above the range often follows an infection, low iron or inflammation somewhere in the body. A repeat shows whether it was passing.",
           "B": "Platelets are the cells that help blood clot. A raised count often follows an infection, low iron or inflammation somewhere in the body. A repeat shows whether it holds.",
           "C": "Platelets are the cells that help blood clot. A count this high can sometimes follow an infection, low iron or inflammation, and occasionally the body is making too many. It is worth finding the reason."},
      do={"A": "It is read again at your next test.", "B": "Consider a repeat test, alongside your iron.",
          "C": "A repeat test in the coming days is the usual first step, with a look at the reason."},
      summary={"A": "Platelets, just above their range. Read again at your next test."}),
    F("platelets", "blood", "Low platelets", "platelet count", low=("platelets",),
      head={"A": "Your platelet count sits just below its range.", "B": "Your platelet count appears to be clearly below its range.",
            "C": "Your platelet count appears to be far below its range."},
      today={"A": "Nothing you would feel.", "B": "Nothing you would feel.",
             "C": "Often nothing. Easy bruising, nosebleeds or bleeding gums would be a reason not to wait."},
      why={"A": "Platelets are the cells that help blood clot. A count a little below the range often follows an infection or some medicines. A repeat shows whether it was passing.",
           "B": "Platelets are the cells that help blood clot. A low count can follow an infection or some medicines, and platelets clumping in the tube can sometimes make a count read falsely low.",
           "C": "Platelets are the cells that help blood clot. At this level the count is worth confirming, because platelets clumping in the tube can sometimes make it read falsely low, and a true result this far out is worth explaining."},
      do={"A": "It is read again at your next test.", "B": "Consider a repeat test to confirm.",
          "C": "A repeat test in the coming days is the usual first step."},
      summary={"A": "Platelets, just below their range. Read again at your next test."}),
    # ── Vitamins and iron (deeper report) ───────────────────────────────────
    F("vitd_low", "nutrients", "Vitamin D", "vitamin D", low=("vitd",),
      head={"A": "Your vitamin D is a little short of where it should be.", "B": "Your vitamin D appears to be clearly low.",
            "C": "Your vitamin D appears to be very low."},
      today={"A": "Nothing you would feel at this level.", "B": "Low vitamin D can show as aching muscles, low mood or tiredness. Often it shows as nothing.",
             "C": "Low vitamin D can show as aching muscles, low mood or tiredness. Often it shows as nothing."},
      why="Vitamin D is made in the skin from sunlight, and bones, muscles and the immune system all need it. Most people who work indoors run low.",
      do={"A": "Some sun on bare arms and legs, most days, is where to start.",
          "B": "Sunlight comes first: some sun on bare arms and legs, most days.",
          "C": "Sunlight alone is unlikely to bring this up."},
      line={"B": " Whether you need more than sunlight is worth asking at your next routine check-up.",
            "C": " A level this low needs a doctor's attention, because a prescribed dose is usually part of the answer. Please speak to your doctor."},
      summary={"A": "Vitamin D, a little short.", "B": "Vitamin D, clearly low.", "C": "Vitamin D, very low."},
      step='Building your <a href="#nutrients">vitamin D</a> back up, starting with some sun most days.', moves="vitamin D level"),
    F("vitd_high", "nutrients", "Vitamin D", "vitamin D", high=("vitd",),
      head="Your vitamin D is above its range.",
      why="This almost always comes from supplements. More is not better with vitamin D: too much pulls calcium into the blood.",
      do="Note what you are taking and how much, and do not stop anything a doctor prescribed without asking them.",
      summary={"B": "Vitamin D, above its range.", "C": "Vitamin D, far above its range."}),
    F("b12_low", "nutrients", "Vitamin B12", "vitamin B12", low=("b12",),
      head={"A": "Your vitamin B12 is in range, at the low end.", "B": "Your vitamin B12 appears to be low.", "C": "Your vitamin B12 appears to be very low."},
      today="Often nothing. Sometimes tiredness, or pins and needles in the hands or feet.",
      why="B12 comes almost entirely from animal foods, so it runs low in vegetarians, and in anyone who absorbs it poorly. Acid-lowering medicines and metformin are common reasons.",
      do={"A": "Dairy, eggs and fortified foods help. It is read again at your next test.",
          "B": "This needs a deeper look: why it is low, and how best to bring it up.",
          "C": "This needs a deeper look: why it is low, and how best to bring it up."},
      line={"B": LINE_B, "C": " A level this low needs a doctor's attention, because injections are sometimes needed. Please speak to your doctor."},
      summary={"A": "Vitamin B12, at the low end of its range. Read again at your next test."}),
    F("b12_high", "nutrients", "Vitamin B12", "vitamin B12", high=("b12",),
      head="Your B12 is well above its range.",
      today="Nothing here is short. A B12 this high usually comes from supplements or fortified food.",
      summary={"A": "Vitamin B12, above its range. Usually supplements."}, approved=("A",)),
    F("iron_low", "nutrients", "Iron", "iron", low=("tsat", "iron"), high=("tibc",),
      head="Your iron carriers are running low.",
      today="Low iron often shows as tiredness, hair fall, restless legs or breathlessness on the stairs.",
      why="Transferrin saturation shows how full the carriers that move iron around your body are. When it is low, less iron is reaching your tissues. This panel does not measure iron stores, so it cannot say why.",
      do={"A": "It is read again at your next test.",
          "B": "This needs a deeper look: your iron stores, and why the carriers are low.",
          "C": "This needs a deeper look: your iron stores, and why the carriers are low."},
      summary={"A": "Iron, a little low. Read again at your next test."}),
    F("iron_high", "nutrients", "Iron", "iron", high=("tsat", "iron"),
      head="Your iron carriers are fuller than they should be.",
      why="This can follow iron supplements. It can also be a tendency to take in too much iron, which runs in families.",
      today={"A": "Nothing you would feel.", "B": "Nothing you would feel.", "C": "Often nothing."},
      do={"A": "It is read again at your next test. If you take iron, mention it.",
          "B": "This needs a deeper look, starting with your iron stores. If you take iron, say so.",
          "C": "This needs a deeper look, starting with your iron stores. If you take iron, say so."},
      summary={"A": "Iron, a little high. Read again at your next test."}),
    # ── Metals (deeper report) ──────────────────────────────────────────────
    F("metals", "metals", "Metals", "metals", plural=True, high=("lead", "mercury", "arsenic", "cadmium"),
      head="{names} {is_are} above {its_their} limit.",
      today="Usually nothing.",
      why="Blood levels mostly reflect the last few weeks: a fish meal can raise mercury and arsenic, and smoking raises cadmium. A raised level that holds on a repeat means more is coming in than the body is clearing, and the work is to find the source. Water, cookware, cosmetics, traditional remedies and the workplace are the usual ones.",
      do="This needs a deeper look: tracing the source is the first step."),
    F("phosphorus_low", "nutrients", "Phosphorus", "phosphorus", low=("phosphorus",),
      head={"A": "Your phosphorus sits just below its range.", "B": "Your phosphorus appears to be clearly low.",
            "C": "Your phosphorus appears to be far below its range."},
      today={"A": "Nothing you would feel.", "B": "Nothing you would feel.",
             "C": "Often nothing. Marked muscle weakness would be a reason not to wait."},
      why={"A": "Phosphorus works with calcium and vitamin D in bone and muscle. A reading a little below the range, with calcium in range, usually means little.",
           "B": "Phosphorus works with calcium and vitamin D in bone and muscle. A low reading can sometimes follow low vitamin D, some medicines or eating very little. A repeat shows whether it holds.",
           "C": "Phosphorus works with calcium and vitamin D in bone and muscle. A reading this low usually has a reason, and it is worth finding."},
      do={"A": "It is read again at your next test, alongside your vitamin D.", "B": "Consider a repeat test, alongside your calcium and vitamin D.",
          "C": "A repeat test in the coming days is the usual first step."},
      summary={"A": "Phosphorus, just below its range. Read again at your next test."}),
]

# any other result outside its range (a salt nobody listed, a low reading that rarely matters)
GENERIC = Finding(
    "generic", "", "", "result",
    head="One result in this section sits outside its range.",
    why={"A": "{name} is {dist}. A single result a little outside its range, with everything around it in range, usually means little.",
         "B": "{name} is {dist}. One reading cannot say whether that will hold."},
    do={"A": "It is read again at your next test.", "B": "A repeat test shows whether it holds."},
    summary={"A": "{name}, {dist}. Read again at your next test.", "B": "{name}, {dist}."})
FOLDED_INTO_LIPIDS = ("tg", "hdl_low")      # told as part of the artery load when the cholesterol finding is there too

BY_ID = {f.id: f for f in FINDINGS}


def at(text: Text, level: str) -> str:
    """The wording for a level; D reads as C, and a missing level falls back to the nearest one below it."""
    if isinstance(text, str):
        return text
    for lv in (["C"] if level == "D" else []) + [level] + [x for x in ("C", "B", "A") if rank(x) < rank(level)]:
        if lv in text:
            return text[lv]
    return ""


@dataclass
class Hit:
    finding: Finding
    level: str
    rows: list[Row]

    @property
    def nature(self) -> str:
        return "work" if any(r.nature == "work" for r in self.rows) else self.rows[0].nature

    @property
    def is_generic(self) -> bool:
        return self.finding.id == "generic"

    @property
    def approved(self) -> bool:
        return self.level in self.finding.approved


def finding_for(row: Row) -> Optional[Finding]:
    for f in FINDINGS:
        if row.key in f.either or (row.side == "high" and row.key in f.high) or (row.side == "low" and row.key in f.low):
            return f
    return None


def hits_in(sec: Section) -> list[Hit]:
    """This section's findings, the main one first."""
    out: dict[str, Hit] = {}
    for r in sec.rows:
        if not r.level or (r.calc and r.key != "fib4"):
            continue
        f = finding_for(r)
        key = f.id if f else f"generic:{r.key}"
        h = out.get(key)
        if h is None:
            out[key] = Hit(f or GENERIC, r.level, [r])
        else:
            h.rows.append(r)
            if rank(r.level) > rank(h.level):
                h.level = r.level
    order = {f.id: i for i, f in enumerate(FINDINGS)}
    return sorted(out.values(), key=lambda h: (-rank(h.level), order.get(h.finding.id, 999)))
