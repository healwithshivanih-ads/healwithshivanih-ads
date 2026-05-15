// snapshots-v2.jsx — v2.2 delta
//   · Section 7 medications expansion (layered chip → mini-card pattern)
//   · Section 11a Bristol sub-card (Option B — interactive cards)
//   · Section 12 women's pregnancies + contraception repeaters
//
// All atoms reused from form.css. Only two new compositions:
//   .fm-medcard (Section 7 mini-form bucket)
//   .fm-stool   (Section 11a Bristol row card)
//
// Reserved color for the Bristol chart illustrations: --terracotta (#B85C3E).

const { useState, useMemo } = React;

// ──────────────────────────────────────────────────────────────
// Shared data
// ──────────────────────────────────────────────────────────────
const MED_BUCKETS = [
  { id: "glp1_medications",           emoji: "💉", name: "GLP-1 weight-loss",         hint: "Ozempic / Wegovy / Mounjaro / Tirzepatide / Saxenda / compounded" },
  { id: "acid_suppressants",          emoji: "🩺", name: "Acid suppressants",         hint: "Pantoprazole / Omeprazole / Esomeprazole / daily antacids" },
  { id: "nsaids_daily",               emoji: "💊", name: "Daily NSAIDs",              hint: "Ibuprofen / naproxen / diclofenac / dolo" },
  { id: "antibiotics_last_12mo",      emoji: "🧫", name: "Antibiotics, last 12 mo",   hint: "How many courses, what for" },
  { id: "hormonal_contraception_hrt", emoji: "🌸", name: "Hormonal contraception / HRT", hint: "Pill / IUD / patch / HRT / vaginal oestrogen / testosterone" },
  { id: "thyroid_medication",         emoji: "🦋", name: "Thyroid medication",         hint: "Levothyroxine / liothyronine / NDT / methimazole" },
  { id: "psych_medications",          emoji: "🌧",  name: "Antidepressants, anxiety, sleep aids", hint: "SSRIs / SNRIs / benzos / Z-drugs / daily melatonin" },
  { id: "biologics_immunosuppressants", emoji: "🛡", name: "Biologics or immunosuppressants",     hint: "Humira / Enbrel / methotrexate — name + condition" },
  { id: "statins_bp_diabetes",        emoji: "💉", name: "Statins / BP / diabetes meds", hint: "Statins, antihypertensives, metformin, sulphonylureas" },
];

const BRISTOL_TYPES = [
  { n: 1, label: "Separate hard lumps, like nuts" },
  { n: 2, label: "Sausage-shaped but lumpy" },
  { n: 3, label: "Sausage-shaped with cracks on the surface" },
  { n: 4, label: "Smooth, soft, sausage-shaped" },
  { n: 5, label: "Soft blobs with clear-cut edges" },
  { n: 6, label: "Fluffy pieces with ragged edges, mushy" },
  { n: 7, label: "Watery, no solid pieces" },
];

const BOWEL_PATTERN = [
  "straining",
  "sense of incomplete evacuation",
  "pain when passing",
  "blood occasionally",
  "mucus",
  "urgency",
  "alternating constipation and loose",
  "wakes you at night",
  "nothing notable",
];

// ──────────────────────────────────────────────────────────────
// Atom: layered medication block (chip row + mini-cards)
// ──────────────────────────────────────────────────────────────

const MED_DEFAULTS = {
  acid_suppressants: {
    name: "Pantoprazole 40mg",
    dose: "40mg daily",
    started: "2019, on and off",
    still: "yes",
    side: ["reflux returns when I stop", "occasional bloating"],
  },
  hormonal_contraception_hrt: {
    name: "Hormonal IUD (Mirena)",
    dose: "—",
    started: "Aug 2021",
    still: "yes",
    side: ["periods stopped", "mood lower year one"],
  },
  antibiotics_last_12mo: {
    name: "Azithromycin + Doxycycline",
    dose: "Two courses",
    started: "Jan & Oct 2024",
    still: "no",
    side: ["loose stools weeks after"],
  },
};

function MedMiniCard({ bucket, data, onRemove }) {
  return (
    <div className="fm-medcard">
      <div className="fm-medcard__head">
        <div className="fm-medcard__title">
          <span className="fm-medcard__emoji" aria-hidden="true">{bucket.emoji}</span>
          <span>{bucket.name}</span>
        </div>
        <button className="fm-medcard__close" onClick={onRemove} aria-label={`Remove ${bucket.name}`}>
          remove
        </button>
      </div>

      <div className="fm-medcard__grid">
        <div className="fm-medcard__full">
          <span className="fm-medcard__minilabel">Which one</span>
          <input
            className={"fm-input" + (data.name ? " fm-input--filled" : "")}
            defaultValue={data.name || ""}
            placeholder={bucket.hint}
          />
        </div>
        <div>
          <span className="fm-medcard__minilabel">Dose</span>
          <input
            className={"fm-input" + (data.dose ? " fm-input--filled" : "")}
            defaultValue={data.dose || ""}
            placeholder="e.g. 40mg daily"
          />
        </div>
        <div>
          <span className="fm-medcard__minilabel">Started when</span>
          <input
            className={"fm-input" + (data.started ? " fm-input--filled" : "")}
            defaultValue={data.started || ""}
            placeholder="year or rough date"
          />
        </div>
        <div className="fm-medcard__full">
          <span className="fm-medcard__minilabel">Still on it?</span>
          <div className="fm-medcard__still">
            <button className={"fm-chip fm-chip--xs" + (data.still === "yes" ? " fm-chip--on" : "")}>still on it</button>
            <button className={"fm-chip fm-chip--xs" + (data.still === "no"  ? " fm-chip--on" : "")}>stopped</button>
            <button className={"fm-chip fm-chip--xs" + (data.still === "onoff"? " fm-chip--on" : "")}>on and off</button>
          </div>
        </div>
        <div className="fm-medcard__full">
          <span className="fm-medcard__minilabel">Side effects, if any</span>
          <div className="fm-chips">
            {(data.side || []).map((s) => (
              <button key={s} className="fm-chip fm-chip--xs fm-chip--on">
                {s}<span className="fm-chip__x" aria-hidden="true">×</span>
              </button>
            ))}
            <button className="fm-chip fm-chip--xs fm-chip--add">+ add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MedsLayeredBlock({ initial = ["acid_suppressants", "hormonal_contraception_hrt", "antibiotics_last_12mo"], stackClass = "fm-medstack" }) {
  const [selected, setSelected] = useState(new Set(initial));
  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const ordered = useMemo(() => MED_BUCKETS.filter((b) => selected.has(b.id)), [selected]);

  return (
    <div className="fm-fg">
      <label className="fm-fg__label">Have you ever taken any of these regularly?</label>
      <span className="fm-fg__hint">
        Tap one and a quick form drops in — name, dose, when, still on it, side effects. Add as many as apply.
      </span>

      <div className="fm-chips">
        {MED_BUCKETS.map((b) => {
          const on = selected.has(b.id);
          return (
            <button
              key={b.id}
              className={"fm-chip" + (on ? " fm-chip--on" : "")}
              aria-pressed={on}
              onClick={() => toggle(b.id)}
            >
              <span aria-hidden="true">{b.emoji}</span>
              <span>{b.name}</span>
              {on && <span className="fm-chip__x" aria-hidden="true">×</span>}
            </button>
          );
        })}
      </div>

      {ordered.length > 0 && (
        <div className={stackClass}>
          {ordered.map((b) => (
            <MedMiniCard
              key={b.id}
              bucket={b}
              data={MED_DEFAULTS[b.id] || {}}
              onRemove={() => toggle(b.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Atom: Bristol stool card list (Option B)
// ──────────────────────────────────────────────────────────────
function BristolList({ initial = [3, 4, 6] }) {
  const [picked, setPicked] = useState(new Set(initial));
  const toggle = (n) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(n)) next.delete(n); else next.add(n);
    return next;
  });
  return (
    <div className="fm-stool-list" role="group" aria-label="Bristol stool types — tick every type you have seen this week">
      {BRISTOL_TYPES.map((t) => {
        const on = picked.has(t.n);
        return (
          <button
            key={t.n}
            type="button"
            className={"fm-stool" + (on ? " fm-stool--on" : "")}
            aria-pressed={on}
            onClick={() => toggle(t.n)}
          >
            <span className="fm-stool__icon" aria-hidden="true">[type-{t.n}-icon]</span>
            <span className="fm-stool__body">
              <span className="fm-stool__name">Type {t.n}</span>
              <span className="fm-stool__desc">{t.label}</span>
            </span>
            <span className="fm-stool__check" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Atom: number stepper
// ──────────────────────────────────────────────────────────────
function Stepper({ defaultValue = 2, min = 0, max = 10 }) {
  const [v, setV] = useState(defaultValue);
  return (
    <div className="fm-stepper" role="group" aria-label="Bowel movements per day">
      <button className="fm-stepper__btn" onClick={() => setV((x) => Math.max(min, x - 1))} disabled={v <= min} aria-label="Decrease">−</button>
      <span className="fm-stepper__val">{v}</span>
      <button className="fm-stepper__btn" onClick={() => setV((x) => Math.min(max, x + 1))} disabled={v >= max} aria-label="Increase">+</button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 7 · Medications snapshot (mobile)
// ──────────────────────────────────────────────────────────────
function S7MedsSnapshot() {
  return (
    <div className="fm" data-screen-label="07 Medications · v2.2">
      <FormChrome
        currentSection={7}
        savedTime="14:51"
        savedSections={[1, 2, 3, 4, 5, 6]}
      />

      <div className="fm-section">
        <div className="fm-section__eyebrow">
          <span className="pulse" aria-hidden="true" />
          <span>Section 07 · v2.2</span>
        </div>
        <h2 className="fm-section__title">Medications, supplements, and what you've taken before</h2>
        <p className="fm-section__sub">
          The full picture — current, past, and the categories that quietly
          reshape gut, hormones, sleep. Skip what doesn't apply.
        </p>

        <MedsLayeredBlock />

        <hr style={{
          border: 0,
          borderTop: "1px solid var(--lavender-15)",
          margin: "28px 0 20px",
        }} />

        {/* Existing v1 repeaters — referenced, not redesigned */}
        <div className="fm-fg">
          <label className="fm-fg__label">Current medications
            <span className="fm-fg__optional">existing repeater · unchanged from v1</span>
          </label>
          <span className="fm-fg__hint">Anything you take more than once a week.</span>
          <div className="fm-rep">
            <div className="fm-rep__row">
              <input className="fm-input fm-input--filled" defaultValue="Pantoprazole" />
              <input className="fm-input fm-input--filled" defaultValue="40mg, mornings" />
            </div>
          </div>
          <button className="fm-add">
            <span className="pulse" aria-hidden="true" />
            add another
          </button>
        </div>

        <div className="fm-fg" style={{ marginBottom: 8 }}>
          <label className="fm-fg__label">Current supplements
            <span className="fm-fg__optional">existing repeater · unchanged from v1</span>
          </label>
          <span className="fm-fg__hint">Vitamins, minerals, herbs, anything off-the-shelf.</span>
          <div className="fm-rep">
            <div className="fm-rep__row">
              <input className="fm-input fm-input--filled" defaultValue="Vitamin D3" />
              <input className="fm-input fm-input--filled" defaultValue="2000 IU, daily" />
            </div>
          </div>
          <button className="fm-add">
            <span className="pulse" aria-hidden="true" />
            add another
          </button>
        </div>

        <p className="fm-foot">
          If you're not sure of a dose, write what you remember — I can
          confirm the rest with you.
        </p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 11a · Bristol sub-card snapshot (mobile)
// ──────────────────────────────────────────────────────────────
function BristolSnapshot() {
  return (
    <div className="fm" data-screen-label="11a Bristol sub-card · v2.2">
      <FormChrome
        currentSection={11}
        savedTime="15:14"
        saving={true}
        savedSections={[1,2,3,4,5,6,7,8,9,10]}
      />

      <div className="fm-section">
        <div className="fm-section__eyebrow">
          <span className="pulse" aria-hidden="true" />
          <span>Section 11a · v2.2 · inside Body systems</span>
        </div>
        <h2 className="fm-section__title">Your body systems — what's bothering you</h2>
        <p className="fm-section__sub">
          Tick everything that applies, even mildly. This is how I find
          patterns.
        </p>

        {/* The other 11 sub-systems collapse as accordion (v1). Bristol
            gets pulled out into its own sub-card for breathing room. */}
        <div style={{
          padding: "12px 0 4px",
          borderTop: "1px solid var(--lavender-15)",
          borderBottom: "1px solid var(--lavender-15)",
          marginBottom: 16,
          fontSize: 12,
          color: "var(--fg-2)",
          letterSpacing: "0.02em",
          textTransform: "uppercase",
        }}>
          5 ticked so far · 11 systems · 1 sub-card
        </div>

        <div className="fm-acc">
          <button className="fm-acc__head">
            <span style={{ display: "flex", alignItems: "center" }}>
              <span className="fm-acc__title">Digestion</span>
              <span className="fm-acc__count fm-acc__count--ticked">· 5 ticked</span>
            </span>
            <span className="fm-acc__chev" aria-hidden="true">⌄</span>
          </button>
        </div>

        {/* The sub-card */}
        <div className="fm-subcard">
          <h3 className="fm-subcard__title">Bowel habits</h3>
          <p className="fm-subcard__sub">
            Stick with me — this section tells me more about your gut than
            almost any lab. Be specific where you can.
          </p>

          <p className="fm-subcard__helper">
            Bowel patterns vary day to day. Tick every type you've seen in
            a typical week — most people have more than one.
          </p>

          <BristolList />

          <div className="fm-fg" style={{ marginBottom: 18 }}>
            <label className="fm-fg__label">How many times a day?</label>
            <Stepper defaultValue={2} />
          </div>

          <div className="fm-fg" style={{ marginBottom: 18 }}>
            <label className="fm-fg__label">Anything else going on?</label>
            <div className="fm-chips">
              {BOWEL_PATTERN.map((p, i) => (
                <button
                  key={p}
                  className={"fm-chip fm-chip--xs" + ([0, 1, 5].includes(i) ? " fm-chip--on" : "")}
                >
                  {p}
                  {[0, 1, 5].includes(i) && <span className="fm-chip__x" aria-hidden="true">×</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="fm-fg" style={{ marginBottom: 0 }}>
            <label className="fm-fg__label">What was normal for you 5–10 years ago?
              <span className="fm-fg__optional">optional</span>
            </label>
            <input
              className="fm-input"
              placeholder="e.g. once a day after coffee, type 4"
            />
          </div>

          <p className="fm-foot" style={{ marginTop: 20 }}>
            Nothing here is shared anywhere outside our work together.
          </p>
        </div>

        {/* Remaining body-system accordions (collapsed, shown for context) */}
        {["Bladder", "Hair", "Nails", "Skin", "Pain", "Hormones & metabolism", "Immune", "Mouth & teeth"].map((n) => (
          <div className="fm-acc" key={n}>
            <button className="fm-acc__head">
              <span style={{ display: "flex", alignItems: "center" }}>
                <span className="fm-acc__title">{n}</span>
                <span className="fm-acc__count">· nothing yet</span>
              </span>
              <span className="fm-acc__chev" aria-hidden="true">⌄</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 12 · Periods — contraception + pregnancies repeaters (mobile)
// ──────────────────────────────────────────────────────────────

const CONTRACEPTION_TYPES = [
  "combined pill",
  "progesterone-only pill",
  "hormonal IUD",
  "copper IUD",
  "implant",
  "depo",
  "patch",
  "vaginal ring",
  "barrier",
  "none",
];

function ContraceptionRow({ num, type, started, stopped, side }) {
  return (
    <div className="fm-repcard">
      <div className="fm-repcard__head">
        <span className="fm-repcard__num"><em>{String(num).padStart(2, "0")}</em>contraception</span>
        <button className="fm-repcard__remove" aria-label="Remove row">remove</button>
      </div>
      <div className="fm-repcard__grid">
        <div className="fm-repcard__full">
          <span className="fm-medcard__minilabel">Type</span>
          <select className="fm-select" defaultValue={type}>
            {CONTRACEPTION_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <span className="fm-medcard__minilabel">Started</span>
          <input className="fm-input fm-input--filled" defaultValue={started} placeholder="year" />
        </div>
        <div>
          <span className="fm-medcard__minilabel">Stopped</span>
          <input className="fm-input fm-input--filled" defaultValue={stopped} placeholder="year or — still on it" />
        </div>
        <div className="fm-repcard__full">
          <span className="fm-medcard__minilabel">Side effects</span>
          <div className="fm-chips">
            {side.map((s) => (
              <button key={s} className="fm-chip fm-chip--xs fm-chip--on">
                {s}<span className="fm-chip__x" aria-hidden="true">×</span>
              </button>
            ))}
            <button className="fm-chip fm-chip--xs fm-chip--add">+ add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const PREG_COMPLICATIONS = [
  "gestational diabetes",
  "pre-eclampsia",
  "gestational hypertension",
  "hyperemesis",
  "postpartum thyroiditis",
  "postpartum depression",
  "anaemia",
  "other",
];

function PregnancyRow({ num, year, outcome, complications, birth, bf }) {
  const outcomes = ["live birth", "miscarriage", "termination", "stillbirth"];
  const births = ["vaginal", "C-section", "forceps", "N/A"];
  return (
    <div className="fm-repcard">
      <div className="fm-repcard__head">
        <span className="fm-repcard__num"><em>{String(num).padStart(2, "0")}</em>pregnancy</span>
        <button className="fm-repcard__remove" aria-label="Remove row">remove</button>
      </div>
      <div className="fm-repcard__grid">
        <div>
          <span className="fm-medcard__minilabel">Year</span>
          <input className="fm-input fm-input--filled" defaultValue={year} placeholder="YYYY" />
        </div>
        <div>
          <span className="fm-medcard__minilabel">Outcome</span>
          <select className="fm-select" defaultValue={outcome}>
            {outcomes.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div className="fm-repcard__full">
          <span className="fm-medcard__minilabel">Complications</span>
          <div className="fm-chips">
            {PREG_COMPLICATIONS.map((c) => {
              const on = complications.includes(c);
              return (
                <button key={c} className={"fm-chip fm-chip--xs" + (on ? " fm-chip--on" : "")}>
                  {c}{on && <span className="fm-chip__x" aria-hidden="true">×</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <span className="fm-medcard__minilabel">Birth type</span>
          <select className="fm-select" defaultValue={birth}>
            {births.map((b) => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <span className="fm-medcard__minilabel">Breastfed, months</span>
          <input className="fm-input fm-input--filled" defaultValue={bf} placeholder="0" />
        </div>
      </div>
    </div>
  );
}

function PeriodsSnapshot() {
  const [pain, setPain] = useState(7);
  const painPct = ((pain - 1) / 9) * 100;
  const trackRef = React.useRef(null);
  const setFromX = (clientX) => {
    const el = trackRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    setPain(Math.round(ratio * 9) + 1);
  };

  return (
    <div className="fm" data-screen-label="12 Periods restructured · v2.2">
      <FormChrome
        currentSection={12}
        savedTime="15:22"
        savedSections={[1,2,3,4,5,6,7,8,9,10,11]}
      />

      <div className="fm-section">
        <div className="fm-section__eyebrow">
          <span className="pulse" aria-hidden="true" />
          <span>Section 12 · v2.2 · women only</span>
        </div>
        <h2 className="fm-section__title">Your cycle, contraception, pregnancies</h2>
        <p className="fm-section__sub">
          Grouped four ways now — cycle, contraception history, pregnancies,
          and what's been diagnosed.
        </p>

        {/* Cycle group — abbreviated, two new fields shown */}
        <div className="fm-fg">
          <label className="fm-fg__label">How bad is your period pain?</label>
          <span className="fm-fg__hint">
            1 is barely there, 10 is can't-move-from-the-floor.
          </span>
          <div className="fm-slider" style={{ marginTop: 14 }}>
            <div
              className="fm-slider__track"
              ref={trackRef}
              role="slider"
              aria-valuemin={1}
              aria-valuemax={10}
              aria-valuenow={pain}
              tabIndex={0}
              onPointerDown={(e) => { setFromX(e.clientX); e.currentTarget.setPointerCapture(e.pointerId); }}
              onPointerMove={(e) => { if (e.buttons === 1) setFromX(e.clientX); }}
              style={{ touchAction: "none", cursor: "pointer" }}
            >
              <div className="fm-slider__rail" />
              <div className="fm-slider__fill" style={{ width: painPct + "%" }} />
              <div className="fm-slider__thumb" style={{ left: painPct + "%" }} />
            </div>
            <div className="fm-slider__scale">
              <span>1</span><span>2</span><span>3</span><span>4</span>
              <span>5</span><span>6</span><span>7</span><span>8</span>
              <span>9</span><span>10</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="fm-slider__value">{pain}</span>
              <span className="fm-slider__caption">— bad enough that I plan around it.</span>
            </div>
          </div>
        </div>

        <div className="fm-fg">
          <label className="fm-fg__label">How does period pain affect your day?</label>
          <div className="fm-radios fm-radios--row">
            <label className="fm-radio"><input type="radio" name="ppi" /><span className="fm-radio__label">Doesn't affect it</span></label>
            <label className="fm-radio"><input type="radio" name="ppi" /><span className="fm-radio__label">Inconvenient</span></label>
            <label className="fm-radio fm-radio--on"><input type="radio" name="ppi" defaultChecked /><span className="fm-radio__label">I miss work or sleep</span></label>
            <label className="fm-radio"><input type="radio" name="ppi" /><span className="fm-radio__label">Debilitating</span></label>
          </div>
        </div>

        {/* Contraception history — REPEATER */}
        <div className="fm-fg">
          <label className="fm-fg__label">Contraception history</label>
          <span className="fm-fg__hint">
            Every method you've used long enough to notice an effect — pill,
            IUD, implant, anything. In rough order.
          </span>

          <ContraceptionRow
            num={1}
            type="combined pill"
            started="2009"
            stopped="2014"
            side={["mood lower", "lighter bleeds"]}
          />
          <ContraceptionRow
            num={2}
            type="hormonal IUD"
            started="2021"
            stopped="still on it"
            side={["periods stopped", "low libido"]}
          />

          <button className="fm-add">
            <span className="pulse" aria-hidden="true" />
            add another method
          </button>
        </div>

        {/* Pregnancies — REPEATER */}
        <div className="fm-fg">
          <label className="fm-fg__label">Pregnancies</label>
          <span className="fm-fg__hint">
            Every pregnancy, including any that didn't continue. The body
            remembers them, so I'd like to know.
          </span>

          <PregnancyRow
            num={1}
            year="2016"
            outcome="live birth"
            complications={["pre-eclampsia", "anaemia"]}
            birth="C-section"
            bf="14"
          />
          <PregnancyRow
            num={2}
            year="2019"
            outcome="miscarriage"
            complications={[]}
            birth="N/A"
            bf="0"
          />

          <button className="fm-add">
            <span className="pulse" aria-hidden="true" />
            add another pregnancy
          </button>
        </div>

        <p className="fm-foot">
          You can leave any of this blank if you'd rather talk through it
          in person — nothing is required.
        </p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// State pairs — selected vs unselected, isolated for review
// ──────────────────────────────────────────────────────────────

function StateFrame({ label, children }) {
  return (
    <div style={{
      width: 375,
      background: "var(--bone)",
      padding: "20px 20px 24px",
      boxSizing: "border-box",
      fontFamily: "var(--font-body)",
    }}>
      <div style={{
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.16em",
        color: "var(--fg-2)",
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}>
        <span className="pulse" aria-hidden="true" />
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

function S7StateEmpty() {
  return (
    <StateFrame label="Section 7 · empty state · chip row only">
      <MedsLayeredBlock initial={[]} />
    </StateFrame>
  );
}

function S7StateExpanded() {
  return (
    <StateFrame label="Section 7 · expanded · 3 mini-cards revealed">
      <MedsLayeredBlock />
    </StateFrame>
  );
}

function BristolStateEmpty() {
  return (
    <StateFrame label="Section 11a · Bristol · empty state">
      <BristolList initial={[]} />
    </StateFrame>
  );
}

function BristolStateSelected() {
  return (
    <StateFrame label="Section 11a · Bristol · types 3, 4, 6 ticked">
      <BristolList initial={[3, 4, 6]} />
    </StateFrame>
  );
}

// ──────────────────────────────────────────────────────────────
// Desktop frames (~640px) — same compositions, two-column meds
// ──────────────────────────────────────────────────────────────

function S7Desktop() {
  return (
    <div className="fm fm--desktop" data-screen-label="07 Medications · desktop · v2.2">
      <FormChrome currentSection={7} savedTime="14:51" savedSections={[1, 2, 3, 4, 5, 6]} />
      <div className="fm-section">
        <div className="fm-section__eyebrow">
          <span className="pulse" aria-hidden="true" />
          <span>Section 07 · v2.2 · desktop</span>
        </div>
        <h2 className="fm-section__title">Medications, supplements, and what you've taken before</h2>
        <p className="fm-section__sub">
          The full picture — current, past, and the categories that quietly
          reshape gut, hormones, sleep.
        </p>
        <MedsLayeredBlock stackClass="fm-medstack fm-medstack--desktop" />
      </div>
    </div>
  );
}

function BristolDesktop() {
  return (
    <div className="fm fm--desktop" data-screen-label="11a Bristol · desktop · v2.2">
      <FormChrome currentSection={11} savedTime="15:14" saving={true} savedSections={[1,2,3,4,5,6,7,8,9,10]} />
      <div className="fm-section">
        <div className="fm-section__eyebrow">
          <span className="pulse" aria-hidden="true" />
          <span>Section 11a · v2.2 · desktop</span>
        </div>
        <h2 className="fm-section__title">Your body systems — what's bothering you</h2>
        <p className="fm-section__sub">Tick everything that applies, even mildly.</p>

        <div className="fm-subcard">
          <h3 className="fm-subcard__title">Bowel habits</h3>
          <p className="fm-subcard__sub">
            Stick with me — this section tells me more about your gut than
            almost any lab. Be specific where you can.
          </p>
          <p className="fm-subcard__helper">
            Bowel patterns vary day to day. Tick every type you've seen in
            a typical week — most people have more than one.
          </p>

          {/* Desktop = 2-col stool grid */}
          <div className="fm-stool-list" style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}>
            {BRISTOL_TYPES.map((t, i) => {
              const on = [2, 3, 5].includes(i);
              return (
                <button key={t.n} type="button" className={"fm-stool" + (on ? " fm-stool--on" : "")}>
                  <span className="fm-stool__icon" aria-hidden="true">[type-{t.n}-icon]</span>
                  <span className="fm-stool__body">
                    <span className="fm-stool__name">Type {t.n}</span>
                    <span className="fm-stool__desc">{t.label}</span>
                  </span>
                  <span className="fm-stool__check" aria-hidden="true" />
                </button>
              );
            })}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 24, alignItems: "start", marginTop: 22 }}>
            <div className="fm-fg" style={{ marginBottom: 0 }}>
              <label className="fm-fg__label">How many times a day?</label>
              <Stepper defaultValue={2} />
            </div>
            <div className="fm-fg" style={{ marginBottom: 0 }}>
              <label className="fm-fg__label">Anything else going on?</label>
              <div className="fm-chips">
                {BOWEL_PATTERN.map((p, i) => (
                  <button key={p} className={"fm-chip fm-chip--xs" + ([0, 1, 5].includes(i) ? " fm-chip--on" : "")}>
                    {p}
                    {[0, 1, 5].includes(i) && <span className="fm-chip__x" aria-hidden="true">×</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="fm-fg" style={{ marginTop: 18, marginBottom: 0 }}>
            <label className="fm-fg__label">What was normal for you 5–10 years ago?
              <span className="fm-fg__optional">optional</span>
            </label>
            <input className="fm-input" placeholder="e.g. once a day after coffee, type 4" />
          </div>

          <p className="fm-foot" style={{ marginTop: 18 }}>
            Nothing here is shared anywhere outside our work together.
          </p>
        </div>
      </div>
    </div>
  );
}

function PeriodsDesktop() {
  return (
    <div className="fm fm--desktop" data-screen-label="12 Periods · desktop · v2.2">
      <FormChrome currentSection={12} savedTime="15:22" savedSections={[1,2,3,4,5,6,7,8,9,10,11]} />
      <div className="fm-section">
        <div className="fm-section__eyebrow">
          <span className="pulse" aria-hidden="true" />
          <span>Section 12 · v2.2 · desktop</span>
        </div>
        <h2 className="fm-section__title">Your cycle, contraception, pregnancies</h2>
        <p className="fm-section__sub">
          Four groups now: cycle, contraception history, pregnancies, and
          what's been diagnosed.
        </p>

        <div className="fm-fg">
          <label className="fm-fg__label">Contraception history</label>
          <span className="fm-fg__hint">
            Every method you've used long enough to notice an effect — in
            rough order.
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <ContraceptionRow num={1} type="combined pill"  started="2009" stopped="2014" side={["mood lower", "lighter bleeds"]} />
            <ContraceptionRow num={2} type="hormonal IUD" started="2021" stopped="still on it" side={["periods stopped", "low libido"]} />
          </div>
          <button className="fm-add"><span className="pulse" aria-hidden="true" />add another method</button>
        </div>

        <div className="fm-fg">
          <label className="fm-fg__label">Pregnancies</label>
          <span className="fm-fg__hint">
            Every pregnancy, including any that didn't continue.
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <PregnancyRow num={1} year="2016" outcome="live birth"   complications={["pre-eclampsia", "anaemia"]} birth="C-section" bf="14" />
            <PregnancyRow num={2} year="2019" outcome="miscarriage"  complications={[]} birth="N/A" bf="0" />
          </div>
          <button className="fm-add"><span className="pulse" aria-hidden="true" />add another pregnancy</button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Decisions card — written up for the design review
// ──────────────────────────────────────────────────────────────
function DecisionsCard() {
  return (
    <div style={{
      width: 720,
      padding: 36,
      background: "var(--bone)",
      border: "1px solid var(--lavender-30)",
      borderRadius: "var(--radius-1)",
      fontFamily: "var(--font-body)",
      color: "var(--fg-1)",
    }}>
      <div style={{
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.16em",
        color: "var(--fg-2)",
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}>
        <span className="pulse" aria-hidden="true" />
        <span>v2.2 design decisions · for dev</span>
      </div>

      <h2 style={{
        fontFamily: "var(--font-display)",
        fontSize: 32,
        lineHeight: 1.16,
        letterSpacing: "-0.012em",
        margin: "0 0 20px",
        fontWeight: 400,
      }}>
        Three decisions to lock before the build.
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "20px 24px", fontSize: 14.5, lineHeight: 1.6 }}>
        <div className="label" style={{ marginBottom: 0 }}>Bristol pattern</div>
        <div>
          <strong style={{ fontWeight: 500 }}>Option B</strong> — seven interactive cards stacked vertically.
          <div style={{ color: "var(--fg-2)", marginTop: 6, fontStyle: "italic", fontFamily: "var(--font-display)", fontSize: 14 }}>
            One tap target per type beats a static reference + parallel chip
            list. The card is the affordance; the illustration sits inside it.
            Dev gets a single self-contained <code>.fm-stool</code> component
            to slot the artwork into later.
          </div>
        </div>

        <div className="label" style={{ marginBottom: 0 }}>Reserved chart colour</div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{
              display: "inline-block",
              width: 24, height: 24, borderRadius: 4,
              background: "var(--terracotta)",
              border: "1px solid var(--lavender-30)",
            }} />
            <strong style={{ fontWeight: 500 }}>Warm terracotta</strong>
            <code style={{ fontSize: 13, color: "var(--fg-2)" }}>#B85C3E · --terracotta</code>
          </div>
          <div style={{ color: "var(--fg-2)", marginTop: 6, fontStyle: "italic", fontFamily: "var(--font-display)", fontSize: 14 }}>
            Sits in the same warm family as <code>--rose</code> (#D6A2A2)
            but deeper, so the stool-type illustrations read on bone without
            competing with <code>--indigo</code>. Sepia line-work felt too
            historical; sage on cream too botanical. Reserved for the
            Bristol illustrations only — do not reuse elsewhere.
          </div>
        </div>

        <div className="label" style={{ marginBottom: 0 }}>S7 expand pattern</div>
        <div>
          Chip row stays anchored at the top. Each selected chip drops a
          bone-warm mini-card beneath it (mobile: vertical stack, desktop:
          2-col grid). The chip itself is the toggle — tapping it again, or
          the “remove” affordance on the mini-card, dismisses both. No
          modals, no accordion-within-accordion.
        </div>

        <div className="label" style={{ marginBottom: 0 }}>New CSS atoms</div>
        <div>
          <code>.fm-subcard</code>, <code>.fm-stool</code> /
          <code>.fm-stool-list</code>, <code>.fm-medcard</code> /
          <code>.fm-medstack</code>, <code>.fm-stepper</code>,
          <code>.fm-repcard</code>, <code>.fm-select</code>,
          <code>.fm-microcopy</code>, <code>.fm-chip--xs</code>.
          All reuse existing tokens — no new colours other than
          <code>--terracotta</code>.
        </div>

        <div className="label" style={{ marginBottom: 0 }}>Field-name contract</div>
        <div>
          Every input in the three mockups uses the dev-contract names
          verbatim from the brief. Repeaters emit
          <code>contraception_history</code> /
          <code>pregnancies</code> as arrays of the row objects shown.
        </div>

        <div className="label" style={{ marginBottom: 0 }}>Dev-implemented</div>
        <div>
          <code>pain-body-map</code> placeholder rectangle (~340×240) lives
          in Section 11e, with the three follow-up chip groups
          (<code>headache_type</code>, <code>pain_pattern</code>,
          <code>pain_quality</code>) below it using existing
          <code>.fm-chips</code>. Bristol illustrations slot into the
          <code>.fm-stool__icon</code> slot, replacing the
          <code>[type-N-icon]</code> hatched placeholder.
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  S7MedsSnapshot, BristolSnapshot, PeriodsSnapshot,
  S7StateEmpty, S7StateExpanded,
  BristolStateEmpty, BristolStateSelected,
  S7Desktop, BristolDesktop, PeriodsDesktop,
  DecisionsCard,
});
