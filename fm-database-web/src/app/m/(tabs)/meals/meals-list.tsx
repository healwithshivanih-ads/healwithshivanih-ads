"use client";

/**
 * The queue itself.
 *
 * Two things shape it. Reviewed rows STAY, dimmed rather than removed — the
 * queue is also the record of what was decided, and a photo that disappears
 * when you tap gives no way back to a call you got wrong. And the agree /
 * disagree pair is always visible even with nothing proposed yet, because in
 * shadow mode her judgement IS the data being collected; there is nothing
 * else on this screen to gather.
 */
import { useState } from "react";
import Link from "next/link";
import type { MealRow } from "@/lib/fmdb/meal-queue";
import { reviewMealAction, pinMealAction } from "@/lib/server-actions/meal-review";

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return today
    ? time
    : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${time}`;
}

const OUTCOME_LABEL: Record<string, string> = {
  affirm: "Looks on plan",
  quiet: "Couldn't tell",
  review: "Not today's meal",
  safety: "Check this one",
};

export function MealsList({ initial }: { initial: MealRow[] }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function mark(r: MealRow, verdict: "agree" | "disagree") {
    const next = r.verdict === verdict ? null : verdict; // tapping again undoes it
    setBusy(r.messageId);
    setRows((rs) =>
      rs.map((x) => (x.messageId === r.messageId ? { ...x, verdict: next } : x)),
    );
    const res = await reviewMealAction(r.clientId, r.messageId, next);
    if (!res.ok) {
      // Put it back rather than showing a decision that was never stored.
      setRows((rs) =>
        rs.map((x) => (x.messageId === r.messageId ? { ...x, verdict: r.verdict } : x)),
      );
    }
    setBusy(null);
  }

  async function pin(r: MealRow) {
    const next = !r.pinned;
    setBusy(r.messageId);
    setRows((rs) =>
      rs.map((x) => (x.messageId === r.messageId ? { ...x, pinned: next } : x)),
    );
    const res = await pinMealAction(r.clientId, r.messageId, next);
    if (!res.ok) {
      setRows((rs) =>
        rs.map((x) => (x.messageId === r.messageId ? { ...x, pinned: r.pinned } : x)),
      );
    }
    setBusy(null);
  }

  if (!rows.length) {
    return (
      <div className="m-card">
        <div style={{ fontWeight: 600, marginBottom: 4 }}>No meal photos yet</div>
        <p className="m-subtle" style={{ margin: 0, lineHeight: 1.6 }}>
          Clients can now send photos from the Coach tab in their app. When they
          do, each one lands here for you to mark. Nothing goes back to them
          automatically.
        </p>
      </div>
    );
  }

  // Needs her: flagged for safety, or off-plan and not yet ruled on.
  const needsYou = rows.filter(
    (r) => r.outcome === "safety" || (r.outcome === "review" && !r.verdict),
  );
  const rest = rows.filter((r) => !needsYou.includes(r));
  const shown = showAll ? rows : needsYou;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {!showAll && needsYou.length === 0 ? (
        <div className="m-card">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Nothing needs you</div>
          <p className="m-subtle" style={{ margin: 0, lineHeight: 1.6 }}>
            {rows.length} photo{rows.length === 1 ? "" : "s"} checked automatically.
            Clients were replied to where the plate matched their plan; nothing
            was flagged.
          </p>
        </div>
      ) : null}

      {shown.map((r) => (
        <div
          key={r.messageId}
          className="m-card"
          style={{ opacity: r.verdict ? 0.62 : 1, transition: "opacity .2s" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <Link href={`/m/clients/${r.clientId}/chat`} style={{ fontWeight: 600 }}>
              {r.clientName}
            </Link>
            <span className="m-subtle" style={{ fontSize: 11 }}>
              {when(r.at)}
            </span>
          </div>

          {/* eslint-disable-next-line @next/next/no-img-element -- session-gated
              API route, not a static path the optimiser can reach. */}
          <img
            src={`/api/m/media?client=${encodeURIComponent(r.clientId)}&file=${encodeURIComponent(r.file)}`}
            alt={r.caption || `Meal photo from ${r.clientName}`}
            loading="lazy"
            style={{ display: "block", width: "100%", borderRadius: 10 }}
          />

          {r.caption ? (
            <p style={{ margin: "8px 0 0", fontSize: 14 }}>{r.caption}</p>
          ) : null}

          {r.outcome ? (
            <div className="m-subtle" style={{ fontSize: 12, marginTop: 8 }}>
              {r.outcome === "safety" ? "⚠ " : ""}
              <strong>{OUTCOME_LABEL[r.outcome] ?? r.outcome}</strong>
              {r.outcome === "affirm" || r.outcome === "review"
                ? " · client was replied to"
                : ""}
            </div>
          ) : (
            <div className="m-subtle" style={{ fontSize: 12, marginTop: 8 }}>
              Checking…
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <button
              type="button"
              className={`fm-btn${r.verdict === "agree" ? " primary" : ""}`}
              disabled={busy === r.messageId}
              onClick={() => void mark(r, "agree")}
            >
              On plan
            </button>
            <button
              type="button"
              className={`fm-btn${r.verdict === "disagree" ? " primary" : ""}`}
              disabled={busy === r.messageId}
              onClick={() => void mark(r, "disagree")}
            >
              Not quite
            </button>
            <button
              type="button"
              className="fm-btn"
              disabled={busy === r.messageId}
              onClick={() => void pin(r)}
              aria-pressed={r.pinned}
              title="Keep this photo past the 12-month clean-up"
              style={{ marginLeft: "auto" }}
            >
              {r.pinned ? "Kept" : "Keep"}
            </button>
          </div>
        </div>
      ))}

      {rest.length > 0 || showAll ? (
        <button
          type="button"
          className="fm-btn block"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Show only what needs me" : `Show all ${rows.length} photos`}
        </button>
      ) : null}
    </div>
  );
}
