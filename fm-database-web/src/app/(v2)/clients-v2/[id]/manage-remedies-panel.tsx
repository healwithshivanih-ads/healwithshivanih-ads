"use client";

/**
 * ManageRemediesPanel — coach-side quick toggle for a client's remedies.
 *
 * The client app no longer browses the full remedy library (that was
 * confusing). The coach browses it HERE — filterable by concern pills
 * (Stress / Sleep / Digestion …) — and ticks remedies on/off based on what
 * the client reports. Saving writes straight to the published plan; the
 * client's app picks it up and shows a "Plan updated" banner. No republish,
 * no API.
 */

import { useState } from "react";
import { FmPanel } from "@/components/fm";
import {
  loadRemedyManager,
  setClientRemedies,
  type RemedyManagerRow,
} from "@/lib/server-actions/remedies";

interface Props {
  clientId: string;
  /** render bare (no FmPanel chrome) — used inside the
   *  "What the client sees" panel's Add-from-library disclosure
   *  (surfaces merged 2026-06-12; this was a standalone panel before) */
  embedded?: boolean;
}

export function ManageRemediesPanel({ clientId, embedded }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<RemedyManagerRow[]>([]);
  const [concerns, setConcerns] = useState<string[]>([]);
  const [planSlug, setPlanSlug] = useState("");

  const [activeConcern, setActiveConcern] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [baseline, setBaseline] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);

  const open = async () => {
    setBusy(true);
    setError("");
    const out = await loadRemedyManager(clientId);
    setBusy(false);
    if (!out.ok) {
      setError(out.error);
      setLoaded(true);
      return;
    }
    setRows(out.rows);
    setConcerns(out.concerns);
    setPlanSlug(out.planSlug);
    const assigned = new Set(out.rows.filter((r) => r.assigned).map((r) => r.slug));
    setSelected(assigned);
    setBaseline(assigned);
    setLoaded(true);
  };

  const toggle = (slug: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const dirty =
    selected.size !== baseline.size || [...selected].some((s) => !baseline.has(s));

  const save = async () => {
    setBusy(true);
    setSaved(false);
    const out = await setClientRemedies(clientId, [...selected], note);
    setBusy(false);
    if (!out.ok) {
      setError(out.error);
      return;
    }
    setBaseline(new Set(selected));
    setNote("");
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const filtered = rows.filter((r) => {
    if (activeConcern && !r.concerns.includes(activeConcern)) return false;
    if (q.trim()) {
      const hay = (r.name + " " + r.also + " " + r.summary + " " + r.concerns.join(" ")).toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });

  const body = (
    <>
      {!loaded ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 13, color: "var(--fm-muted, #6f6a5d)" }}>
            Browse remedies suited to this client, filter by concern (stress, sleep…),
            and tick what to show on their app. Saving updates the app and flags a
            “Plan updated” banner for them.
          </div>
          <button className="fm-btn" onClick={open} disabled={busy}>
            {busy ? "Loading…" : "🌿 Manage remedies"}
          </button>
        </div>
      ) : error ? (
        <div style={{ fontSize: 13, color: "#b3402a" }}>{error}</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ fontSize: 12, color: "var(--fm-text-tertiary, #8a857a)" }}>
            Editing <code>{planSlug}</code> · {selected.size} assigned
          </div>

          {/* concern filter pills */}
          {concerns.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Pill on={activeConcern === null} onClick={() => setActiveConcern(null)}>
                All
              </Pill>
              {concerns.map((c) => (
                <Pill key={c} on={activeConcern === c} onClick={() => setActiveConcern(activeConcern === c ? null : c)}>
                  {c}
                </Pill>
              ))}
            </div>
          )}

          {/* search */}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${rows.length} remedies…`}
            style={inputStyle}
          />

          {/* rows */}
          <div style={{ display: "grid", gap: 6, maxHeight: 360, overflowY: "auto" }}>
            {filtered.map((r) => {
              const on = selected.has(r.slug);
              return (
                <button
                  key={r.slug}
                  onClick={() => toggle(r.slug)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    textAlign: "left",
                    padding: "9px 11px",
                    border: `1px solid ${on ? "var(--fm-primary, #a9651f)" : "var(--fm-border, #e5e1d8)"}`,
                    background: on ? "rgba(169,101,31,0.06)" : "var(--fm-bg, #fff)",
                    borderRadius: 10,
                    cursor: "pointer",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      marginTop: 1,
                      width: 18,
                      height: 18,
                      flexShrink: 0,
                      borderRadius: 5,
                      border: `1.5px solid ${on ? "var(--fm-primary, #a9651f)" : "#c9c3b6"}`,
                      background: on ? "var(--fm-primary, #a9651f)" : "transparent",
                      color: "#fff",
                      fontSize: 12,
                      lineHeight: "15px",
                      textAlign: "center",
                      fontWeight: 700,
                    }}
                  >
                    {on ? "✓" : ""}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fm-text, #2b2d42)" }}>
                      {r.name}
                      {r.route === "external" && (
                        <span style={{ fontSize: 10.5, color: "#8a857a", fontWeight: 500 }}> · apply/inhale</span>
                      )}
                      {r.stub && (
                        <span style={{ fontSize: 10.5, color: "#b3902a", fontWeight: 500 }}> · stub</span>
                      )}
                    </span>
                    {r.summary && (
                      <span style={{ display: "block", fontSize: 12, color: "#6f6a5d", lineHeight: 1.4, marginTop: 1 }}>
                        {r.summary.length > 120 ? r.summary.slice(0, 120) + "…" : r.summary}
                      </span>
                    )}
                    {r.concerns.length > 0 && (
                      <span style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                        {r.concerns.map((c) => (
                          <span
                            key={c}
                            style={{
                              fontSize: 10,
                              padding: "1px 7px",
                              borderRadius: 999,
                              background: "rgba(43,45,66,0.06)",
                              color: "#4a4640",
                            }}
                          >
                            {c}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ fontSize: 12.5, color: "#8a857a", padding: "8px 2px" }}>
                No remedies match. Try a different concern or word.
              </div>
            )}
          </div>

          {/* note + save */}
          {dirty && (
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note for the client (optional) — e.g. Added jatamansi tea for sleep"
              style={inputStyle}
            />
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="fm-btn" onClick={save} disabled={busy || !dirty}>
              {busy ? "Saving…" : "💾 Save to client's app"}
            </button>
            {saved && (
              <span style={{ fontSize: 12.5, color: "#2f7d4f", fontWeight: 600 }}>
                ✓ Saved — their app will update & show a “Plan updated” banner.
              </span>
            )}
            {!dirty && !saved && (
              <span style={{ fontSize: 12, color: "#8a857a" }}>No changes</span>
            )}
          </div>
        </div>
      )}
    </>
  );

  if (embedded) return body;
  return (
    <FmPanel
      title="🌿 Manage remedies"
      subtitle="Add or remove remedies on the client's live app — no republish needed"
    >
      {body}
    </FmPanel>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 12,
        padding: "4px 11px",
        borderRadius: 999,
        border: `1px solid ${on ? "var(--fm-primary, #a9651f)" : "var(--fm-border, #e5e1d8)"}`,
        background: on ? "var(--fm-primary, #a9651f)" : "transparent",
        color: on ? "#fff" : "var(--fm-text-secondary, #4a4640)",
        cursor: "pointer",
        fontWeight: on ? 600 : 500,
      }}
    >
      {children}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 13,
  padding: "8px 10px",
  border: "1px solid var(--fm-border, #e5e1d8)",
  borderRadius: 8,
  background: "var(--fm-bg, #fff)",
  color: "var(--fm-text, #2b2d42)",
  boxSizing: "border-box",
};
