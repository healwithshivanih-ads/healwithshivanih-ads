"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  scoreAssessment,
  DG_BAND_LABEL,
  type DgQuestionnaire,
  type ClientSnp,
  type DgBand,
  type DgPathwayResult,
} from "@/lib/fmdb/dirty-genes";
import { saveDirtyGenesAssessment } from "@/lib/server-actions/dirty-genes";

const BAND_COLOR: Record<DgBand, { bg: string; fg: string; border: string }> = {
  clear: { bg: "var(--fm-surface-subtle, #f4f4f2)", fg: "var(--fm-text-tertiary)", border: "var(--fm-border-light)" },
  mild: { bg: "rgba(59,130,246,0.10)", fg: "#1d4ed8", border: "rgba(59,130,246,0.35)" },
  moderate: { bg: "rgba(217,119,6,0.12)", fg: "#b45309", border: "rgba(217,119,6,0.4)" },
  high: { bg: "rgba(220,38,38,0.12)", fg: "#b91c1c", border: "rgba(220,38,38,0.4)" },
};

function BandChip({ band, pct }: { band: DgBand; pct: number }) {
  const c = BAND_COLOR[band];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {DG_BAND_LABEL[band]} · {pct}%
    </span>
  );
}

function Chips({ items, hrefBase, muted }: { items: string[]; hrefBase?: string; muted?: boolean }) {
  if (!items?.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
      {items.map((s) =>
        hrefBase ? (
          <Link
            key={s}
            href={`${hrefBase}/${s}`}
            style={{
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 6,
              background: "var(--fm-surface)",
              border: "1px solid var(--fm-border-light)",
              color: "var(--fm-text-secondary)",
              textDecoration: "none",
              fontFamily: "var(--fm-font-mono)",
            }}
          >
            {s}
          </Link>
        ) : (
          <span
            key={s}
            style={{
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 6,
              background: muted ? "transparent" : "var(--fm-surface-subtle, #f4f4f2)",
              border: "1px solid var(--fm-border-light)",
              color: "var(--fm-text-secondary)",
            }}
          >
            {s}
          </span>
        ),
      )}
    </div>
  );
}

function ResultCard({ p }: { p: DgPathwayResult }) {
  const iv = p.interventions;
  return (
    <div
      style={{
        border: `1px solid ${BAND_COLOR[p.band].border}`,
        borderRadius: "var(--fm-radius-md)",
        overflow: "hidden",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 12px",
          background: BAND_COLOR[p.band].bg,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700 }}>{p.label}</div>
        <BandChip band={p.band} pct={Math.round(p.fraction * 100)} />
      </div>
      <div style={{ padding: "10px 12px", fontSize: 12.5, color: "var(--fm-text-secondary)", lineHeight: 1.5 }}>
        {/* what the client ticked */}
        {p.drivers.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 600, color: "var(--fm-text)", fontSize: 12, marginBottom: 2 }}>
              What's driving it
            </div>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {p.drivers.map((d) => (
                <li key={d.id}>{d.text}</li>
              ))}
            </ul>
          </div>
        )}

        {/* genetics overlay — nudge, never verdict */}
        {p.genetics.length > 0 && (
          <div
            style={{
              marginBottom: 8,
              padding: "6px 8px",
              borderRadius: 6,
              background: "rgba(124,58,237,0.08)",
              border: "1px solid rgba(124,58,237,0.25)",
            }}
          >
            <div style={{ fontWeight: 700, color: "#6d28d9", fontSize: 11.5 }}>
              🧬 Genetics on file (context only — not a verdict)
            </div>
            {p.genetics.map((g, i) => (
              <div key={i} style={{ marginTop: 3 }}>
                <span style={{ fontFamily: "var(--fm-font-mono)", fontWeight: 600 }}>
                  {g.gene}
                  {g.genotype ? ` ${g.genotype}` : ""}
                </span>{" "}
                {g.risk ? "— risk genotype reported" : "— not a risk genotype"}
                {g.risk_note ? <div style={{ fontStyle: "italic" }}>{g.risk_note}</div> : null}
              </div>
            ))}
          </div>
        )}

        {/* interventions — soak & scrub */}
        {iv && (
          <div style={{ display: "grid", gap: 6 }}>
            {iv.foods_emphasise?.length ? (
              <div>
                <b style={{ fontSize: 12 }}>Emphasise:</b> {iv.foods_emphasise.join(", ")}
              </div>
            ) : null}
            {iv.foods_reduce?.length ? (
              <div>
                <b style={{ fontSize: 12 }}>Ease off:</b> {iv.foods_reduce.join(", ")}
              </div>
            ) : null}
            {iv.lifestyle?.length ? (
              <div>
                <b style={{ fontSize: 12 }}>Lifestyle:</b> {iv.lifestyle.join(" · ")}
              </div>
            ) : null}
            {iv.supplements?.length ? (
              <div>
                <b style={{ fontSize: 12 }}>Supplements to consider:</b>
                <Chips items={iv.supplements} hrefBase="/catalogue/supplements" />
              </div>
            ) : null}
            {iv.labs_to_track?.length ? (
              <div>
                <b style={{ fontSize: 12 }}>Track:</b> {iv.labs_to_track.join(", ")}
              </div>
            ) : null}
            {p.mechanism_slugs.length ? (
              <div>
                <b style={{ fontSize: 12 }}>Pathways:</b>
                <Chips items={p.mechanism_slugs} hrefBase="/catalogue/mechanisms" />
              </div>
            ) : null}
            {iv.caution ? (
              <div
                style={{
                  marginTop: 2,
                  padding: "6px 8px",
                  borderRadius: 6,
                  background: "rgba(220,38,38,0.06)",
                  border: "1px solid rgba(220,38,38,0.2)",
                  color: "#b91c1c",
                  fontSize: 11.5,
                }}
              >
                ⚠ {iv.caution}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export function DirtyGenesClient({
  clientId,
  questionnaire,
  snps,
  geneticSourceCount,
  initialChecked,
  initialNote,
  previousScreenDate,
}: {
  clientId: string;
  questionnaire: DgQuestionnaire;
  snps: ClientSnp[];
  geneticSourceCount: number;
  initialChecked: string[];
  initialNote: string;
  previousScreenDate?: string;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set(initialChecked));
  const [note, setNote] = useState(initialNote);
  const [saving, startSave] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const result = useMemo(
    () => scoreAssessment(questionnaire, [...checked], snps),
    [questionnaire, checked, snps],
  );

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSave() {
    startSave(async () => {
      const summary = result.pathways.map((p) => ({
        id: p.id,
        label: p.label,
        band: p.band,
        fraction: Number(p.fraction.toFixed(3)),
      }));
      const res = await saveDirtyGenesAssessment({
        clientId,
        checkedIds: [...checked],
        note,
        summary,
      });
      if (res.ok) setSavedAt(new Date().toLocaleTimeString());
    });
  }

  const flagged = result.flagged;

  return (
    <div>
      {/* scope banner */}
      <div
        style={{
          padding: "10px 12px",
          borderRadius: "var(--fm-radius-md)",
          background: "rgba(217,119,6,0.08)",
          border: "1px solid rgba(217,119,6,0.3)",
          fontSize: 12,
          color: "#92400e",
          marginBottom: 16,
          lineHeight: 1.5,
        }}
      >
        <b>Coaching screen — not a genetic diagnosis.</b> This scores how heavily
        symptoms + lifestyle load onto seven gene-associated pathways (the "Dirty
        Genes" framework). It guides where lifestyle and nutrition support is worth
        focusing. Genetic reports, if on file, are shown as <i>context only — a nudge,
        never a verdict</i>. Educate lifestyle; never interpret SNPs diagnostically or
        prescribe.{" "}
        {geneticSourceCount > 0 ? (
          <span>🧬 {geneticSourceCount} genetic report(s) on file — overlaid below.</span>
        ) : (
          <span>No genetic report on file — questionnaire-only screen.</span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 20 }} className="dg-grid">
        {/* LEFT: questionnaire */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
            Tick everything that applies ({result.totalChecked} selected)
          </div>
          {questionnaire.pathways.map((p) => {
            const pr = result.pathways.find((x) => x.id === p.id)!;
            return (
              <div
                key={p.id}
                style={{
                  border: "1px solid var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-md)",
                  marginBottom: 12,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "8px 12px",
                    background: "var(--fm-surface)",
                    borderBottom: "1px solid var(--fm-border-light)",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{p.label}</div>
                    <div style={{ fontSize: 11.5, color: "var(--fm-text-tertiary)" }}>{p.plain}</div>
                  </div>
                  <BandChip band={pr.band} pct={Math.round(pr.fraction * 100)} />
                </div>
                <div style={{ padding: "6px 12px 10px" }}>
                  {p.items.map((it) => (
                    <label
                      key={it.id}
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "flex-start",
                        padding: "5px 0",
                        fontSize: 12.5,
                        cursor: "pointer",
                        lineHeight: 1.4,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked.has(it.id)}
                        onChange={() => toggle(it.id)}
                        style={{ marginTop: 2 }}
                      />
                      <span>{it.text}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* RIGHT: results */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              Where to focus{flagged.length ? ` · ${flagged.length} flagged` : ""}
            </div>
            {previousScreenDate && (
              <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
                last screen {previousScreenDate}
              </span>
            )}
          </div>

          {flagged.length === 0 ? (
            <div
              style={{
                padding: 16,
                border: "1px dashed var(--fm-border-light)",
                borderRadius: "var(--fm-radius-md)",
                fontSize: 12.5,
                color: "var(--fm-text-tertiary)",
              }}
            >
              No pathway at moderate+ burden yet. Tick the client's symptoms on the
              left and the priority pathways appear here, most-burdened first.
            </div>
          ) : (
            flagged.map((p) => <ResultCard key={p.id} p={p} />)
          )}

          {/* save */}
          <div style={{ marginTop: 12 }}>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Coach note for this screen (optional)…"
              rows={3}
              style={{
                width: "100%",
                fontSize: 12.5,
                padding: 8,
                borderRadius: "var(--fm-radius-md)",
                border: "1px solid var(--fm-border-light)",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
              <button
                onClick={onSave}
                disabled={saving}
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  padding: "7px 14px",
                  borderRadius: "var(--fm-radius-md)",
                  border: "1px solid var(--fm-border)",
                  background: "var(--fm-accent, #2f5233)",
                  color: "#fff",
                  cursor: saving ? "default" : "pointer",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? "Saving…" : "Save screen to client"}
              </button>
              {savedAt && (
                <span style={{ fontSize: 11.5, color: "var(--fm-text-tertiary)" }}>
                  ✓ saved {savedAt}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (min-width: 960px) {
          .dg-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
