"use client";

/**
 * 🔍 Check supplement for this client — one-click suitability.
 *
 * Type any supplement or home-remedy name → deterministic (no-API) check of:
 *   - catalogue contraindications vs the client's conditions
 *   - medication interactions vs current meds
 *   - dosha match across BOTH vikruti (current) AND prakruti (constitution)
 * The vikruti-only plan-checker misses prakruti / thyroid / BP cautions — this
 * surfaces them before you add anything to a plan.
 */

import { useState, useTransition } from "react";
import {
  checkSupplementForClientAction,
  type SupplementCheckResult,
} from "@/lib/server-actions/clients";

const VERDICT: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  avoid: { label: "Avoid", bg: "rgba(220,38,38,0.10)", fg: "#b91c1c", border: "#dc2626" },
  caution: { label: "Caution", bg: "rgba(217,119,6,0.10)", fg: "#b45309", border: "#d97706" },
  good_fit: { label: "Good fit", bg: "rgba(22,163,74,0.10)", fg: "#15803d", border: "#16a34a" },
  neutral: { label: "Neutral", bg: "rgba(100,116,139,0.10)", fg: "#475569", border: "#94a3b8" },
};

interface Props {
  clientId: string;
}

export function SupplementCheckWidget({ clientId }: Props) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SupplementCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (q?: string) => {
    const term = (q ?? query).trim();
    if (!term) return;
    setError(null);
    start(async () => {
      const r = await checkSupplementForClientAction(clientId, term);
      if (!r.ok) {
        setError(r.error);
        setResult(null);
      } else {
        setResult(r.result);
      }
    });
  };

  const v = result?.verdict ? VERDICT[result.verdict] ?? VERDICT.neutral : null;

  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border)",
        borderRadius: "var(--fm-radius-sm)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        🔍 Check a supplement for this client
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type="text"
          value={query}
          disabled={pending}
          placeholder="e.g. guggul, ashwagandha, triphala…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          style={{
            flex: 1,
            fontSize: 13,
            padding: "6px 9px",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            background: "var(--fm-bg)",
          }}
        />
        <button
          onClick={() => run()}
          disabled={pending || !query.trim()}
          style={{
            fontSize: 13,
            fontWeight: 600,
            padding: "6px 14px",
            borderRadius: "var(--fm-radius-sm)",
            border: "1.5px solid var(--fm-primary)",
            background: "var(--fm-primary)",
            color: "#fff",
            cursor: pending ? "wait" : "pointer",
          }}
        >
          {pending ? "Checking…" : "Check"}
        </button>
      </div>

      {error && (
        <p style={{ fontSize: 12, color: "#b91c1c", marginTop: 8 }}>{error}</p>
      )}

      {result && !result.found && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--fm-text-secondary)" }}>
          No catalogue match for <strong>{result.query}</strong>.
          {result.suggestions && result.suggestions.length > 0 && (
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {result.suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => { setQuery(s); run(s); }}
                  style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, border: "1px solid var(--fm-border)", background: "var(--fm-bg)", cursor: "pointer" }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {result && result.found && v && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{result.display_name}</span>
            <span
              style={{
                fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 999,
                background: v.bg, color: v.fg, border: `1px solid ${v.border}`,
              }}
            >
              {v.label}
            </span>
            <span style={{ fontSize: 10, color: "var(--fm-text-tertiary)", textTransform: "uppercase" }}>
              {result.kind === "home_remedy" ? "remedy" : "supplement"} · {result.evidence_tier}
            </span>
          </div>

          {/* Dosha line */}
          {(result.balances_dosha?.length || result.aggravates_dosha?.length) ? (
            <div style={{ fontSize: 11, color: "var(--fm-text-secondary)", marginTop: 6 }}>
              {result.balances_dosha?.length ? <>balances <strong>{result.balances_dosha.join("/")}</strong> </> : null}
              {result.aggravates_dosha?.length ? <>· aggravates <strong>{result.aggravates_dosha.join("/")}</strong> </> : null}
              {(result.client_vikruti?.length || result.client_prakruti?.length) ? (
                <> · client: vikruti {result.client_vikruti?.join("/") || "—"}, prakruti {result.client_prakruti?.join("/") || "—"}</>
              ) : null}
            </div>
          ) : null}

          {result.supports && result.supports.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "#15803d" }}>
              {result.supports.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}

          {result.cautions && result.cautions.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12 }}>
              {result.cautions.map((c, i) => (
                <li key={i} style={{ color: c.severity === "avoid" ? "#b91c1c" : "#b45309" }}>
                  <strong>{c.severity === "avoid" ? "Avoid: " : "Caution: "}</strong>{c.detail}
                </li>
              ))}
            </ul>
          )}

          {result.catalogue_contraindications && result.catalogue_contraindications.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 11, color: "var(--fm-text-tertiary)", cursor: "pointer" }}>
                Catalogue contraindications ({result.catalogue_contraindications.length})
              </summary>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 11, color: "var(--fm-text-secondary)" }}>
                {result.catalogue_contraindications.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </details>
          )}

          <p style={{ fontSize: 10, color: "var(--fm-text-tertiary)", marginTop: 8, fontStyle: "italic" }}>
            Deterministic catalogue check — not a substitute for clinical judgement. For a full
            reasoning pass, ask the AI Plan Assistant on a plan.
          </p>
        </div>
      )}
    </div>
  );
}
