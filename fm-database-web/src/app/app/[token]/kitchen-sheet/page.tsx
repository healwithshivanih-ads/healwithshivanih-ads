/**
 * /app/<token>/kitchen-sheet — the printable bilingual "cook's sheet".
 *
 * A print-optimised page of the client's weekly menu + recipes, rendered in
 * English AND the target language (Hindi in v1) side by side, so the client can
 * print it / Save as PDF and hand it to their household cook. Pure render from
 * loadKitchenSheet() — no app chrome, isolated print surface. Mirrors the
 * /keepsake page pattern.
 */

import { cookies } from "next/headers";
import { loadKitchenSheet } from "@/lib/fmdb/kitchen-sheet";
import { KitchenSheetPrintButton } from "./kitchen-sheet-controls";
import type { Bilingual, TranslatedComponent } from "@/lib/fmdb/menu-translate";

export const dynamic = "force-dynamic";

const FOREST = "#2d5a3d";
const OCHRE = "#b07b1e";
const INK = "#2c2a24";
const MUTED = "#6f6a5d";
const LINE = "#e6e1d6";
const PAPER = "#faf8f3";
// System Devanagari fonts (no external font loads allowed) → clean fallback.
const HI_FONT =
  "'Noto Sans Devanagari', 'Nirmala UI', 'Kohinoor Devanagari', 'Devanagari MT', system-ui, sans-serif";

/** Primary line in the target language, English underneath it as the check line.
 *  Falls back to English-only when a term didn't resolve. */
function BiLine({ b, size = 15, muted = false }: { b: Bilingual; size?: number; muted?: boolean }) {
  const color = muted ? MUTED : INK;
  if (!b.hi) return <span style={{ fontSize: size, color }}>{b.en}</span>;
  return (
    <span>
      <span style={{ fontSize: size, color, fontFamily: HI_FONT }}>{b.hi}</span>
      <span style={{ fontSize: size - 3, color: MUTED, marginLeft: 6 }}>({b.en})</span>
    </span>
  );
}

function Portion({ b }: { b: Bilingual }) {
  return (
    <span style={{ fontSize: 12.5, color: OCHRE, fontWeight: 600, marginLeft: 6, fontFamily: HI_FONT }}>
      {b.hi ?? b.en}
    </span>
  );
}

function Component({ c }: { c: TranslatedComponent }) {
  return (
    <div style={{ marginBottom: 3 }}>
      <BiLine b={c.title} size={14.5} />
      {c.portion && <Portion b={c.portion} />}
    </div>
  );
}

export default async function KitchenSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { token } = await params;
  const { lang } = await searchParams;
  const deviceTz = (await cookies()).get("ochre_tz")?.value ?? null;
  const sheet = await loadKitchenSheet(token, { lang: lang || "hi", deviceTz });

  if (!sheet.available) {
    return (
      <main
        style={{
          fontFamily: "Georgia, serif",
          maxWidth: 640,
          margin: "60px auto",
          padding: 24,
          color: INK,
          textAlign: "center",
        }}
      >
        <p>This kitchen sheet link is no longer active, or a translation isn&apos;t ready yet.</p>
      </main>
    );
  }

  const ui = sheet.ui;
  const t = (k: string, fallback: string) => ui[k] || fallback;
  const untranslated = sheet.coverage.components - sheet.coverage.translated;
  const menuLabel = sheet.menuIsSample
    ? t("sample_menu", "Sample menu")
    : t("this_weeks_menu", "This week's menu");

  return (
    <main
      style={{
        fontFamily: "Georgia, 'Times New Roman', serif",
        background: "#fff",
        color: INK,
        maxWidth: 820,
        margin: "0 auto",
        padding: "32px 26px 64px",
        lineHeight: 1.55,
      }}
    >
      <style>{`
        @page { margin: 14mm; }
        @media print {
          .no-print { display: none !important; }
          .ks-day { break-inside: avoid; }
          .ks-recipe { break-inside: avoid; }
          .ks-week-head { break-after: avoid; }
        }
      `}</style>

      {/* Cover */}
      <header
        style={{
          textAlign: "center",
          paddingBottom: 20,
          borderBottom: `2px solid ${OCHRE}`,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            fontSize: 12,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: OCHRE,
            fontWeight: 700,
          }}
        >
          The Ochre Tree
        </div>
        <h1
          style={{ fontSize: 27, color: FOREST, margin: "10px 0 4px", fontWeight: 600, fontFamily: HI_FONT }}
        >
          {t("kitchen_sheet", "Kitchen Sheet")}
        </h1>
        <p style={{ fontSize: 13.5, color: MUTED, margin: 0, fontFamily: HI_FONT }}>
          {t("subtitle", "Daily meals and how to cook them — to share in your kitchen")}
        </p>
        {sheet.firstName && (
          <p style={{ fontSize: 13, color: MUTED, margin: "6px 0 0" }}>
            {sheet.firstName}
          </p>
        )}

        <div className="no-print" style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", alignItems: "center" }}>
          <KitchenSheetPrintButton label={t("print", "Save as PDF")} />
          {sheet.availableLangs.length > 1 && (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              {sheet.availableLangs.map((l) => {
                const active = l.code === sheet.lang;
                return (
                  <a
                    key={l.code}
                    href={`?lang=${l.code}`}
                    style={{
                      fontSize: 13,
                      padding: "6px 12px",
                      borderRadius: 999,
                      textDecoration: "none",
                      fontFamily: HI_FONT,
                      border: `1px solid ${active ? FOREST : LINE}`,
                      background: active ? FOREST : "#fff",
                      color: active ? "#fff" : INK,
                    }}
                  >
                    {l.name}
                  </a>
                );
              })}
            </span>
          )}
        </div>
      </header>

      {untranslated > 0 && (
        <p
          style={{
            fontSize: 12.5,
            color: MUTED,
            fontStyle: "italic",
            background: PAPER,
            border: `1px solid ${LINE}`,
            borderRadius: 8,
            padding: "8px 12px",
            marginBottom: 20,
            fontFamily: HI_FONT,
          }}
        >
          {t("some_english", "Some items are shown in English")} · {untranslated}
        </p>
      )}

      {/* Menu */}
      {sheet.weeks.map((w, wi) => (
        <section key={wi} style={{ marginBottom: 26 }}>
          <h2
            className="ks-week-head"
            style={{
              fontSize: 17,
              color: FOREST,
              fontWeight: 600,
              margin: "0 0 12px",
              paddingBottom: 6,
              borderBottom: `1px solid ${LINE}`,
              fontFamily: HI_FONT,
            }}
          >
            {menuLabel}
            {sheet.weeks.length > 1 && (
              <span style={{ color: MUTED, fontWeight: 400 }}>
                {" "}
                · {t("week", "Week")} {w.week}
              </span>
            )}
          </h2>

          <div style={{ display: "grid", gap: 12 }}>
            {w.days.map((day, di) => (
              <article
                key={di}
                className="ks-day"
                style={{
                  border: `1px solid ${LINE}`,
                  borderRadius: 10,
                  padding: "12px 16px",
                  background: PAPER,
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: OCHRE,
                    marginBottom: 8,
                    fontFamily: HI_FONT,
                  }}
                >
                  {day.dow.hi ?? day.dow.en}
                  {day.dateLabel && (
                    <span style={{ color: MUTED, fontWeight: 400, marginLeft: 8, fontFamily: "Georgia, serif" }}>
                      {day.dateLabel}
                    </span>
                  )}
                </div>
                <div style={{ display: "grid", gap: 7 }}>
                  {day.slots.map((slot, si) => (
                    <div
                      key={si}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "150px 1fr",
                        gap: 12,
                        alignItems: "start",
                        borderTop: si === 0 ? "none" : `1px dashed ${LINE}`,
                        paddingTop: si === 0 ? 0 : 7,
                      }}
                    >
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: MUTED }}>
                        <BiLine b={slot.slot} size={12.5} muted />
                      </div>
                      <div>
                        {slot.components.map((c, ci) => (
                          <Component key={ci} c={c} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {/* Recipes */}
      {sheet.recipes.length > 0 && (
        <section>
          <h2
            style={{
              fontSize: 17,
              color: FOREST,
              fontWeight: 600,
              margin: "6px 0 12px",
              paddingBottom: 6,
              borderBottom: `1px solid ${LINE}`,
              fontFamily: HI_FONT,
            }}
          >
            {t("recipes", "Recipes")}
          </h2>
          <div style={{ display: "grid", gap: 16 }}>
            {sheet.recipes.map((r, ri) => (
              <article
                key={ri}
                className="ks-recipe"
                style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: "16px 18px", background: PAPER }}
              >
                <h3 style={{ fontSize: 17, color: FOREST, margin: "0 0 3px", fontWeight: 600 }}>
                  <BiLine b={r.title} size={17} />
                </h3>
                {(r.serves || r.time) && (
                  <div style={{ fontSize: 12, color: OCHRE, fontWeight: 600, marginBottom: 10 }}>
                    {[r.serves, r.time].filter(Boolean).join("  ·  ")}
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 18 }}>
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: 0.6,
                        color: MUTED,
                        fontWeight: 700,
                        marginBottom: 5,
                        fontFamily: HI_FONT,
                      }}
                    >
                      {t("ingredients", "Ingredients")}
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: INK }}>
                      {r.ingredients.map((ing, j) => (
                        <li key={j} style={{ marginBottom: 2 }}>
                          {ing.hi ? (
                            <>
                              <span style={{ fontFamily: HI_FONT }}>{ing.hi}</span>
                              <span style={{ color: MUTED, display: "block", fontSize: 11 }}>{ing.en}</span>
                            </>
                          ) : (
                            ing.en
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: 0.6,
                        color: MUTED,
                        fontWeight: 700,
                        marginBottom: 5,
                        fontFamily: HI_FONT,
                      }}
                    >
                      {t("method", "Method")}
                    </div>
                    <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: INK }}>
                      {r.method.map((m, j) => (
                        <li key={j} style={{ marginBottom: 5 }}>
                          {m.hi ? (
                            <>
                              <span style={{ fontFamily: HI_FONT }}>{m.hi}</span>
                              <span style={{ color: MUTED, display: "block", fontSize: 11 }}>{m.en}</span>
                            </>
                          ) : (
                            m.en
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <footer
        style={{
          textAlign: "center",
          marginTop: 34,
          paddingTop: 16,
          borderTop: `1px solid ${LINE}`,
          fontSize: 12.5,
          color: MUTED,
        }}
      >
        {sheet.coachName} · The Ochre Tree
      </footer>
    </main>
  );
}
