"use client";

/* ======================================================================
   The Ochre Tree — ✈️ travel mode (2026-06-12)
   ----------------------------------------------------------------------
   The client flags a travel window (dates + optional context). The flag
   lands as a quick_note session with a structured travel_response:
     · this card replaces the grocery push during the window with
       rules-based eating-out guidance (no AI, always plan-safe),
     · the weekly menu generator reads the same session as feedback so
       the next drafted week leans travel-friendly.
   Server write is /api/app-travel (token re-verified server-side).
   ====================================================================== */

import { useState } from "react";
import { Icon, useOchre } from "./ochre-context";

function fmtRange(from: string, to: string): string {
  const f = (s: string) => {
    const d = new Date(`${s}T00:00:00`);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };
  return `${f(from)} – ${f(to)}`;
}

/* Rules-based guidance — deliberately generic-safe + framed around the
   client's own food framework, which lives on their lists/principles. */
const TRAVEL_RULES: { t: string; b: string }[] = [
  {
    t: "Anchor breakfast",
    b: "It's the meal you control most while travelling — keep it closest to your plan (fruit, eggs, idli/poha-style grains, curd if it suits you).",
  },
  {
    t: "Order from your food lists",
    b: "Restaurant menus almost always have a dal + sabzi + roti/rice combination — build your plate from your eat-freely foods and skip your avoid list.",
  },
  {
    t: "Carry your supplements",
    b: "Pack the week's doses in a small pouch — timing matters more than perfection. Skip rather than double up if you miss one.",
  },
  {
    t: "Hydrate + walk",
    b: "Travel days dehydrate. Sip water through the day and take a 10-minute walk after the heaviest meal.",
  },
  {
    t: "Don't chase perfect",
    b: "80% on the road is a win. Your plan picks up exactly where you left it the day you're back.",
  },
];

export function TravelCard() {
  const data = useOchre();
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const t = data.travel;
  if (!t || cancelled) return null;

  const cancel = async () => {
    setCancelling(true);
    try {
      const res = await fetch("/api/app-travel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token, cancelled: true }),
      });
      const out = (await res.json()) as { ok?: boolean };
      if (res.ok && out.ok) setCancelled(true);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="card" style={{ padding: "14px 16px", marginBottom: 12, borderLeft: "3px solid var(--ochre)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden="true" style={{ fontSize: 18 }}>✈️</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 650, fontSize: 14.5 }}>
            {t.active ? "Travel mode" : "Travel coming up"} · {fmtRange(t.from, t.to)}
          </div>
          {t.context && (
            <div className="muted" style={{ fontSize: 12.5 }}>{t.context}</div>
          )}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, margin: "8px 0 10px" }}>
        Your menu stays here for reference, but while you&apos;re away these five rules matter
        more than any recipe. {data.coach.name.split(" ")[0]} sees your dates and will shape
        next week&apos;s menu around your return.
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {TRAVEL_RULES.map((r) => (
          <div key={r.t} style={{ fontSize: 12.8, lineHeight: 1.5 }}>
            <strong>{r.t}.</strong> <span className="muted">{r.b}</span>
          </div>
        ))}
      </div>
      <button
        className="wm-pill"
        style={{ marginTop: 12 }}
        disabled={cancelling}
        onClick={cancel}
      >
        {cancelling ? "Updating…" : "I'm back — end travel mode"}
      </button>
    </div>
  );
}

export function TravelFlagButton() {
  const data = useOchre();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [context, setContext] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  if (data.travel) return null; // card already showing
  if (done) {
    return (
      <div className="card-quiet" style={{ marginTop: 10, padding: "10px 14px", fontSize: 12.8 }}>
        ✈️ Got it — travel noted. Reload the app to see your travel guide.
      </div>
    );
  }

  const submit = async () => {
    if (!from || !to) {
      setError("Pick both dates.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/app-travel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token, from, to, context }),
      });
      const out = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !out.ok) throw new Error(out.error || `HTTP ${res.status}`);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save — try again.");
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <button
        className="card-quiet"
        style={{
          marginTop: 10,
          padding: "10px 14px",
          fontSize: 12.8,
          width: "100%",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
        }}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">✈️</span>
        <span>
          <strong>Travelling soon?</strong>{" "}
          <span className="muted">Tell {data.coach.name.split(" ")[0]} — your plan adapts.</span>
        </span>
        <span className="chev" style={{ marginLeft: "auto" }}>
          <Icon name="chev" size={16} />
        </span>
      </button>
    );
  }

  return (
    <div className="card" style={{ marginTop: 10, padding: "14px 16px" }}>
      <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 8 }}>✈️ When are you away?</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <label style={{ flex: 1, fontSize: 11.5 }} className="muted">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 3, padding: "7px 8px", fontSize: 13, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8 }}
          />
        </label>
        <label style={{ flex: 1, fontSize: 11.5 }} className="muted">
          Back on
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 3, padding: "7px 8px", fontSize: 13, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8 }}
          />
        </label>
      </div>
      <textarea
        value={context}
        onChange={(e) => setContext(e.target.value)}
        placeholder="Anything useful — e.g. work trip, hotel + restaurant meals, family wedding…"
        rows={2}
        style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, resize: "vertical" }}
      />
      {error && (
        <div style={{ color: "#b3402a", fontSize: 12, marginTop: 6 }}>{error}</div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="wm-pill on" disabled={sending} onClick={submit}>
          {sending ? "Saving…" : "Save travel dates"}
        </button>
        <button className="wm-pill" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
