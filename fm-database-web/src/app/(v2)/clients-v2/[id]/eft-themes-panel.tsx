"use client";

/* Coach control for which EFT tapping issues a client gets in the app. By
   default the issues are auto-detected from the case (deriveEft); this lets the
   coach curate the set — force-add one the keywords missed, or drop one. Writes
   client.yaml#eft_themes via setEftThemes (empty / equal-to-auto → deletes it,
   back to auto-detection). The per-minute reconcile projects it to the Fly app.

   Theme keys + labels + the auto-detected set are passed in from the server
   page — this stays a thin client component (can't import the server module). */

import { useMemo, useState, useTransition } from "react";
import { setEftThemes } from "@/lib/server-actions/clients";

type Option = { key: string; label: string; auto: boolean };

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((k) => b.includes(k));

export function EftThemesPanel({
  clientId,
  options,
  override,
}: {
  clientId: string;
  options: Option[];
  /** current coach override (client.eft_themes), or null when on auto-detect */
  override: string[] | null;
}) {
  const autoKeys = useMemo(() => options.filter((o) => o.auto).map((o) => o.key), [options]);
  const [selected, setSelected] = useState<string[]>(override ?? autoKeys);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // "Custom" once the saved selection differs from the auto-detected set.
  const isCustom = !sameSet(selected, autoKeys);

  const persist = (next: string[]) => {
    // Empty, or back to exactly the auto set → clear the override (auto-detect).
    const useAuto = next.length === 0 || sameSet(next, autoKeys);
    setSelected(useAuto ? autoKeys : next);
    setErr(null);
    start(async () => {
      const r = await setEftThemes(clientId, useAuto ? null : next);
      if (!r.ok) setErr(r.error);
    });
  };

  const toggle = (key: string) => {
    if (pending) return;
    persist(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  };

  return (
    <div>
      <div style={{ fontSize: 12.5, color: "var(--fm-muted, #6f6a5d)", marginBottom: 4, lineHeight: 1.5 }}>
        Which issues this client can tap on in the app. Picked automatically from their case — tick or untick to override.
      </div>
      <div style={{ fontSize: 11.5, marginBottom: 10 }}>
        {isCustom ? (
          <span style={{ color: "#8a4f50", fontWeight: 600 }}>● Custom — you set these</span>
        ) : (
          <span style={{ color: "#3f6b40", fontWeight: 600 }}>● Auto — detected from the case</span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {options.map((o) => {
          const on = selected.includes(o.key);
          return (
            <button
              key={o.key}
              onClick={() => toggle(o.key)}
              disabled={pending}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 12px",
                borderRadius: 12,
                textAlign: "left",
                cursor: pending ? "default" : "pointer",
                border: on ? "1.5px solid #b06b6b" : "1px solid var(--fm-line, #e3ddd1)",
                background: on ? "rgba(176,107,107,0.08)" : "#fff",
                opacity: pending ? 0.7 : 1,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 18,
                  height: 18,
                  flexShrink: 0,
                  borderRadius: 5,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 12,
                  color: "#fff",
                  border: on ? "none" : "1.5px solid #cfc7b8",
                  background: on ? "#b06b6b" : "transparent",
                }}
              >
                {on ? "✓" : ""}
              </span>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500, color: "var(--fm-ink, #262219)" }}>{o.label}</span>
              {o.auto && (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    padding: "1px 7px",
                    borderRadius: 999,
                    background: "rgba(95,140,96,0.12)",
                    color: "#3f6b40",
                  }}
                >
                  auto
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isCustom && (
        <button
          onClick={() => persist(autoKeys)}
          disabled={pending}
          style={{
            marginTop: 10,
            background: "none",
            border: "none",
            color: "var(--fm-muted, #6f6a5d)",
            fontSize: 12.5,
            cursor: pending ? "default" : "pointer",
            padding: 0,
          }}
        >
          ↺ Reset to auto-detected
        </button>
      )}

      {err && <div style={{ fontSize: 12, color: "#b3402a", marginTop: 8 }}>{err}</div>}
    </div>
  );
}
