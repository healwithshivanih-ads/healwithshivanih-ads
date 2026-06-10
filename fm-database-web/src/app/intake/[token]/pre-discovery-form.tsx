"use client";

/**
 * Pre-discovery intake form (v0.75) — the short ~14-field form sent BEFORE
 * the discovery call so the coach goes in with structured data and can
 * recommend a personalised lab pack rather than a generic one.
 *
 * Architecture:
 * - Same /intake/<token> URL as the full intake. Server returns
 *   `stage: "pre_discovery"` until the coach calls unlockFullIntake() —
 *   typically after the client signs up for the package.
 * - On unlock, the same URL starts serving the full form (existing
 *   intake-form.tsx, 3693 lines, untouched). The client's already-saved
 *   pre-discovery answers are preserved on the client.yaml so the full
 *   form can read them as prefill / context.
 *
 * Design intent: low friction. 10-minute fill. Enough data for coach
 * to (a) prep the call, (b) recommend specific labs, (c) tee up the
 * AI insights pipeline (Haiku call uses the same insights script — runs
 * on whatever data is there).
 */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
// Using stable /api/intake fetch calls — see intake-form.tsx for the reason
async function saveIntakeDraft(
  token: string,
  draft: Record<string, unknown>
): Promise<{ ok: true; saved_at: string } | { ok: false; error: string }> {
  const res = await fetch("/api/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save_draft", token, draft }),
  });
  return res.json();
}
async function submitIntakeForm(
  token: string,
  payload: Record<string, unknown>
): Promise<
  | { ok: true; client_id: string; fields_updated: string[]; session_id: string }
  | { ok: false; error: string }
> {
  const res = await fetch("/api/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "submit", token, payload }),
  });
  return res.json();
}

interface Props {
  token: string;
  clientId: string;
  displayName: string;
  coachName?: string;
  prefill: Record<string, unknown>;
  draft: Record<string, unknown>;
}

interface FormState {
  // Confirm identity (prefilled, editable)
  display_name: string;
  date_of_birth: string;          // ISO YYYY-MM-DD
  sex: string;                    // "F" | "M" | ""
  email: string;
  mobile_number: string;
  city: string;
  country: string;

  // Discovery prep — the data that makes the discovery call valuable
  chief_complaint: string;        // 1-3 sentences — the headline
  when_last_well: string;         // "Until 2021 COVID" / "Childhood" / "Postpartum 2019" — free text
  top_symptoms: string;           // free text, comma- or line-separated
  current_medications: string;    // free text — names + doses
  recent_labs_done: string;       // free text — what + when
  goals: string;                  // 1-3 goals, free text

  // Practicalities for lab + plan personalisation
  dietary_preference: string;     // single-select
  cycle_status: string;           // single-select, women-only render
  family_history: string;         // free text — extended hint
  what_has_worked: string;
  what_hasnt_worked: string;

  readiness_confidence: number;   // 1-10 slider
}

const DIETARY_OPTIONS = [
  "Non-vegetarian",
  "Pescatarian",
  "Eggetarian",
  "Vegetarian",
  "Jain vegetarian",
  "Vegan",
  "Other",
];

const CYCLE_OPTIONS = [
  { value: "menstruating", label: "Still menstruating regularly" },
  { value: "irregular", label: "Cycles are irregular / unpredictable" },
  { value: "perimenopausal", label: "Perimenopausal (cycles changing, hot flushes, etc.)" },
  { value: "postmenopausal", label: "Postmenopausal (no period > 12 months)" },
  { value: "surgical_menopause", label: "Surgical menopause / hysterectomy" },
  { value: "pregnant", label: "Currently pregnant" },
  { value: "lactating", label: "Currently breastfeeding" },
  { value: "not_applicable", label: "Doesn't apply to me" },
];

function s(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function n(v: unknown, fallback = 5): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const parsed = Number(v);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

export function PreDiscoveryForm({ token, clientId, displayName, coachName = "Shivani", prefill, draft }: Props) {
  const initial: FormState = useMemo(() => {
    // Drafts override prefill so a partial save returns the client to
    // exactly where they left off.
    const merged = { ...prefill, ...draft } as Record<string, unknown>;
    return {
      display_name: s(merged.display_name, displayName),
      date_of_birth: s(merged.date_of_birth),
      sex: s(merged.sex).toUpperCase(),
      email: s(merged.email),
      mobile_number: s(merged.mobile_number),
      city: s(merged.city),
      country: s(merged.country, "India"),
      chief_complaint: s(merged.chief_complaint),
      when_last_well: s(merged.when_last_well),
      top_symptoms: Array.isArray(merged.goals) ? "" : s(merged.top_symptoms),
      current_medications: Array.isArray(merged.current_medications)
        ? (merged.current_medications as string[]).join(", ")
        : s(merged.current_medications),
      recent_labs_done: Array.isArray(merged.recent_labs_done)
        ? (merged.recent_labs_done as string[]).join(", ")
        : s(merged.recent_labs_done),
      goals: Array.isArray(merged.goals)
        ? (merged.goals as string[]).join("\n")
        : s(merged.goals),
      dietary_preference: s(merged.dietary_preference),
      cycle_status: s(merged.cycle_status),
      family_history: s(merged.family_history),
      what_has_worked: s(merged.what_has_worked),
      what_hasnt_worked: s(merged.what_hasnt_worked),
      readiness_confidence: n(merged.readiness_confidence, 7),
    };
  }, [prefill, draft, displayName]);

  const [state, setState] = useState<FormState>(initial);
  const [submitting, startSubmit] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState<string | null>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };

  // Autosave every 30s if dirty
  const lastSavedRef = useRef<string>(JSON.stringify(initial));
  useEffect(() => {
    const id = setInterval(() => {
      const snapshot = JSON.stringify(state);
      if (snapshot === lastSavedRef.current) return;
      saveIntakeDraft(token, state as unknown as Record<string, unknown>).then((res) => {
        if (res.ok) {
          lastSavedRef.current = snapshot;
          setDraftSaved(res.saved_at);
        }
      });
    }, 30_000);
    return () => clearInterval(id);
  }, [state, token]);

  const isWomen = state.sex === "F";

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // Build the payload — convert text-list fields back to arrays so
    // the existing client.yaml schema (list[str] for goals, meds, labs)
    // stays consistent.
    const payload = {
      ...state,
      sex: state.sex || null,
      goals: state.goals.split(/\n+/).map((x) => x.trim()).filter(Boolean),
      current_medications: state.current_medications
        .split(/,|\n/)
        .map((x) => x.trim())
        .filter(Boolean),
      recent_labs_done: state.recent_labs_done
        .split(/,|\n/)
        .map((x) => x.trim())
        .filter(Boolean),
      // Mark this submission as the pre-discovery stage so the coach UI
      // can show "filled pre-discovery" vs "filled full".
      _stage: "pre_discovery",
    };

    startSubmit(async () => {
      const res = await submitIntakeForm(token, payload);
      if (res.ok) {
        setSubmitted(true);
      } else {
        setError(res.error ?? "Save failed");
      }
    });
  };

  if (submitted) {
    return (
      <div className="fm-thanks">
        <div className="fm-thanks__eyebrow">
          <span className="pulse" aria-hidden="true" />
          <span>{coachName}</span>
        </div>
        <h1 className="fm-thanks__title">Thank you — sent to {coachName} 💚</h1>
        <p className="fm-thanks__body">
          {coachName} will review your answers before your discovery call and come
          prepared with a starting picture. If anything else comes to mind in
          the meantime, you can reopen this link and add to it — your earlier
          answers stay saved.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="fm-intake-form"
      style={{ maxWidth: 680, margin: "0 auto", padding: "32px 20px 80px", fontFamily: "-apple-system, system-ui, sans-serif", color: "#1a1a1a" }}
    >
      <header style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, color: "#8a8a8a", marginBottom: 4 }}>
          {coachName} · pre-discovery intake
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 0, marginBottom: 8 }}>
          Hi {displayName?.split(" ")[0] || "there"} — quick prep before our call
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: "#555" }}>
          This is the short version — about 10 minutes. It helps me come into
          our discovery call already knowing your story, so we can spend the
          time on what matters to you instead of starting from scratch.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: "#777", marginTop: 8 }}>
          Your answers are saved as you type, so you can close the page and
          come back. If we decide to work together after our call, this same
          link will open the longer intake form — your earlier answers will
          stay saved.
        </p>
      </header>

      <Section title="1. You">
        <Row>
          <Field label="Full name">
            <input type="text" value={state.display_name} onChange={(e) => update("display_name", e.target.value)} />
          </Field>
        </Row>
        <Row>
          <Field label="Date of birth" half>
            <input type="date" value={state.date_of_birth} onChange={(e) => update("date_of_birth", e.target.value)} />
          </Field>
          <Field label="Sex assigned at birth" half hint="Tells me cycle vs no-cycle, hormone considerations">
            <select value={state.sex} onChange={(e) => update("sex", e.target.value)}>
              <option value="">—</option>
              <option value="F">Female</option>
              <option value="M">Male</option>
              <option value="OTHER">Other / prefer not to say</option>
            </select>
          </Field>
        </Row>
        <Row>
          <Field label="Email" half>
            <input type="email" value={state.email} onChange={(e) => update("email", e.target.value)} />
          </Field>
          <Field label="Mobile (with country code)" half>
            <input type="tel" value={state.mobile_number} onChange={(e) => update("mobile_number", e.target.value)} placeholder="+91 …" />
          </Field>
        </Row>
        <Row>
          <Field label="City" half>
            <input type="text" value={state.city} onChange={(e) => update("city", e.target.value)} placeholder="e.g. Mumbai" />
          </Field>
          <Field label="Country" half>
            <input type="text" value={state.country} onChange={(e) => update("country", e.target.value)} />
          </Field>
        </Row>
      </Section>

      <Section title="2. What's going on">
        <Field
          label="In your own words — what's bringing you to me?"
          hint="1-3 sentences is plenty. Don't worry about clinical language."
        >
          <textarea
            rows={4}
            value={state.chief_complaint}
            onChange={(e) => update("chief_complaint", e.target.value)}
            placeholder="e.g. I've been exhausted since Jan, gut feels off, can't lose weight even though I'm eating well."
          />
        </Field>

        <Field
          label="When was the last time you felt genuinely well?"
          hint="Could be a year, a life event, a season. Don't overthink — your best guess is fine."
        >
          <input
            type="text"
            value={state.when_last_well}
            onChange={(e) => update("when_last_well", e.target.value)}
            placeholder="e.g. Until 2021 COVID / Before my last pregnancy / Honestly, my whole life"
          />
        </Field>

        <Field
          label="Top 3-5 symptoms or things bothering you right now"
          hint="Plain language — type each on a new line or comma-separated. I'll group them in our call."
        >
          <textarea
            rows={4}
            value={state.top_symptoms}
            onChange={(e) => update("top_symptoms", e.target.value)}
            placeholder="e.g. Afternoon energy crash, bloating after most meals, hair thinning, can't fall asleep, irritable around my period"
          />
        </Field>
      </Section>

      <Section title="3. Medications + recent labs">
        <Field
          label="Medications + supplements you take regularly"
          hint="Include doses if you know them. Include prescription, OTC, and any vitamins / herbs. List 'none' if that's the case."
        >
          <textarea
            rows={3}
            value={state.current_medications}
            onChange={(e) => update("current_medications", e.target.value)}
            placeholder="e.g. Levothyroxine 50mcg morning, Magnesium glycinate 200mg evening, Vitamin D 5000 IU weekly"
          />
        </Field>

        <Field
          label="Any blood tests / scans done in the last 6 months?"
          hint="Just list what was done + roughly when. We'll look at the actual reports together if you bring them."
        >
          <textarea
            rows={3}
            value={state.recent_labs_done}
            onChange={(e) => update("recent_labs_done", e.target.value)}
            placeholder="e.g. Thyroid panel + Vit D + B12 + iron, March 2026. Pelvic ultrasound, Jan 2026."
          />
        </Field>
      </Section>

      <Section title="4. Goals + history">
        <Field
          label="What 1-3 things would have to change for you to feel this was worth it?"
          hint="Be specific. 'More energy' is fine; 'energy to make it through 4pm without coffee' is better."
        >
          <textarea
            rows={3}
            value={state.goals}
            onChange={(e) => update("goals", e.target.value)}
            placeholder={"e.g. Sleep through the night\nGut feels calm after meals\nGet off the metformin (with my doctor's OK)"}
          />
        </Field>

        <Row>
          <Field label="Dietary preference" half>
            <select value={state.dietary_preference} onChange={(e) => update("dietary_preference", e.target.value)}>
              <option value="">—</option>
              {DIETARY_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </Field>
          {isWomen && (
            <Field label="Cycle status" half>
              <select value={state.cycle_status} onChange={(e) => update("cycle_status", e.target.value)}>
                <option value="">—</option>
                {CYCLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
          )}
        </Row>

        <Field
          label="Family history — anything that runs in your family?"
          hint="Anything: heart disease before 60, stroke, cancer (which kind), diabetes, thyroid, autoimmune, mental health, ADHD / autism / learning differences, miscarriages, blood clots, dementia. Don't filter — let me pattern-match."
        >
          <textarea
            rows={3}
            value={state.family_history}
            onChange={(e) => update("family_history", e.target.value)}
            placeholder="e.g. Father T2 diabetes, mother psoriasis, paternal aunt rheumatoid arthritis, brother diagnosed ADHD."
          />
        </Field>

        <Field
          label="What have you already tried, and what (if anything) helped?"
          hint="Diets, supplements, doctors, therapies — even temporarily. Saves us re-running experiments that already failed."
        >
          <textarea
            rows={3}
            value={state.what_has_worked}
            onChange={(e) => update("what_has_worked", e.target.value)}
            placeholder="e.g. Tried gluten-free 3 months — bloating got better but didn't stick. Magnesium helped sleep. Two functional doctors before — overwhelmed by the supplement load."
          />
        </Field>

        <Field
          label="And anything you've tried that didn't work or made you feel worse?"
          hint="Optional but useful — saves us re-running it."
        >
          <textarea
            rows={2}
            value={state.what_hasnt_worked}
            onChange={(e) => update("what_hasnt_worked", e.target.value)}
            placeholder="e.g. Keto — gave me migraines. Cold showers — too anxious. High-dose B-complex made me wired."
          />
        </Field>

        <Field
          label="On a scale of 1-10, how ready are you to make changes right now?"
          hint="Be honest — 1 = 'I want to want to', 10 = 'tell me what to do and I'll do it tomorrow'. There's no wrong answer."
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input
              type="range"
              min="1"
              max="10"
              value={state.readiness_confidence}
              onChange={(e) => update("readiness_confidence", Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ fontWeight: 700, fontSize: 16, minWidth: 28, textAlign: "right" }}>
              {state.readiness_confidence}
            </span>
          </div>
        </Field>
      </Section>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        style={{
          width: "100%",
          padding: "14px 20px",
          fontSize: 15,
          fontWeight: 700,
          background: submitting ? "#888" : "#2b2d42",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          cursor: submitting ? "wait" : "pointer",
          marginTop: 12,
        }}
      >
        {submitting ? "Sending…" : `Send to ${coachName}`}
      </button>

      <div style={{ fontSize: 12, color: "#888", marginTop: 14, textAlign: "center" }}>
        {draftSaved
          ? `Draft saved · last autosave ${new Date(draftSaved).toLocaleTimeString()}`
          : "Your answers autosave every 30 seconds — close any time, your work won't be lost."}
      </div>

      <p style={{ fontSize: 12, color: "#999", marginTop: 18, lineHeight: 1.55, textAlign: "center" }}>
        I understand this information is private and confidential, and will not
        be used in any manner except to help with my care. By sending, I agree.
      </p>
    </form>
  );
}

// ── tiny layout helpers (inlined; intake form doesn't share a design system) ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28, padding: "18px 18px 10px", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 10 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 14, color: "#2b2d42", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>{children}</div>;
}

function Field({ label, hint, half, children }: { label: string; hint?: string; half?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 14, flex: half ? "1 1 220px" : "1 1 100%", minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: "#2b2d42" }}>{label}</div>
      {hint && (
        <div style={{ fontSize: 12, color: "#888", marginBottom: 6, lineHeight: 1.45 }}>{hint}</div>
      )}
      <FieldStyleReset>{children}</FieldStyleReset>
    </label>
  );
}

function FieldStyleReset({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: "100%" }}>
      <style>{`
        .fm-intake-form input,
        .fm-intake-form textarea,
        .fm-intake-form select {
          width: 100%;
          padding: 10px 12px;
          font-size: 14px;
          font-family: inherit;
          color: #1a1a1a;
          background: #fff;
          border: 1px solid #d6d3d1;
          border-radius: 8px;
          line-height: 1.5;
          box-sizing: border-box;
        }
        .fm-intake-form input:focus,
        .fm-intake-form textarea:focus,
        .fm-intake-form select:focus {
          outline: none;
          border-color: #2b2d42;
          box-shadow: 0 0 0 3px rgba(43, 45, 66, 0.10);
        }
        .fm-intake-form textarea { resize: vertical; min-height: 60px; }
      `}</style>
      {children}
    </div>
  );
}
