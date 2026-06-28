/**
 * /app/<token>/keepsake — the graduation recipe keepsake.
 *
 * A print-optimised, brand-styled page of every recipe in the client's pack.
 * Linked from the REVIEW graduation report + the LIBRARY floor as a parting gift
 * ("your recipes come home with you"). Client opens it and hits Save as PDF. Pure
 * render from the same app data — no app chrome, isolated print surface.
 */

import { loadClientAppData } from "@/lib/fmdb/client-app";
import { KeepsakePrintButton } from "./keepsake-print-button";

export const dynamic = "force-dynamic";

const FOREST = "#2d5a3d";
const OCHRE = "#b07b1e";
const INK = "#2c2a24";
const MUTED = "#6f6a5d";
const LINE = "#e6e1d6";
const PAPER = "#faf8f3";

export default async function KeepsakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let data = null;
  try {
    data = await loadClientAppData(token);
  } catch (err) {
    console.error("[keepsake] failed to assemble app data:", err);
  }

  if (!data) {
    return (
      <main style={{ fontFamily: "Georgia, serif", maxWidth: 640, margin: "60px auto", padding: 24, color: INK, textAlign: "center" }}>
        <p>This keepsake link is no longer active.</p>
      </main>
    );
  }

  const recipes = data.recipePack ?? [];
  const firstName = data.client?.firstName ?? "";
  const coachName = data.coach?.name ?? "The Ochre Tree";

  return (
    <main
      style={{
        fontFamily: "Georgia, 'Times New Roman', serif",
        background: "#fff",
        color: INK,
        maxWidth: 760,
        margin: "0 auto",
        padding: "32px 28px 64px",
        lineHeight: 1.6,
      }}
    >
      <style>{`
        @page { margin: 16mm; }
        @media print {
          .no-print { display: none !important; }
          .keepsake-recipe { break-inside: avoid; }
        }
      `}</style>

      {/* Cover */}
      <header style={{ textAlign: "center", paddingBottom: 22, borderBottom: `2px solid ${OCHRE}`, marginBottom: 28 }}>
        <div style={{ fontSize: 12, letterSpacing: 3, textTransform: "uppercase", color: OCHRE, fontWeight: 700 }}>
          The Ochre Tree
        </div>
        <h1 style={{ fontSize: 30, color: FOREST, margin: "12px 0 6px", fontWeight: 600 }}>
          {firstName ? `${firstName}'s Recipe Keepsake` : "Your Recipe Keepsake"}
        </h1>
        <p style={{ fontSize: 14, color: MUTED, margin: 0 }}>
          The recipes from your healing journey — yours to keep, cook and share.
        </p>
        <div className="no-print" style={{ marginTop: 18 }}>
          <KeepsakePrintButton />
        </div>
      </header>

      {recipes.length === 0 ? (
        <p style={{ color: MUTED, textAlign: "center" }}>No recipes to gather yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 22 }}>
          {recipes.map((r, i) => (
            <article
              key={i}
              className="keepsake-recipe"
              style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: "18px 20px", background: PAPER }}
            >
              <h2 style={{ fontSize: 19, color: FOREST, margin: "0 0 4px", fontWeight: 600 }}>{r.title}</h2>
              {(r.serves || r.time) && (
                <div style={{ fontSize: 12.5, color: OCHRE, fontWeight: 600, marginBottom: 10 }}>
                  {[r.serves, r.time].filter(Boolean).join("  ·  ")}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 18 }}>
                <div>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: MUTED, fontWeight: 700, marginBottom: 5 }}>
                    Ingredients
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: INK }}>
                    {r.ingredients.map((ing, j) => <li key={j}>{ing}</li>)}
                  </ul>
                </div>
                <div>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: MUTED, fontWeight: 700, marginBottom: 5 }}>
                    Method
                  </div>
                  <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: INK }}>
                    {r.method.map((m, j) => <li key={j} style={{ marginBottom: 3 }}>{m}</li>)}
                  </ol>
                </div>
              </div>
              {r.tip && (
                <div style={{ marginTop: 12, fontSize: 12.5, color: MUTED, fontStyle: "italic", borderTop: `1px dashed ${LINE}`, paddingTop: 9 }}>
                  Tip — {r.tip}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <footer style={{ textAlign: "center", marginTop: 36, paddingTop: 18, borderTop: `1px solid ${LINE}`, fontSize: 12.5, color: MUTED }}>
        With love, from {coachName} · The Ochre Tree
      </footer>
    </main>
  );
}
