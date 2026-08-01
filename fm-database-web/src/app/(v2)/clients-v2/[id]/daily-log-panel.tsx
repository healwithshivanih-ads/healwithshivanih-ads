/**
 * DailyLogPanel — what the client actually ticked off in her app.
 *
 * COACH-SIDE ONLY, and server-rendered: there is nothing to interact with,
 * this is a read of `_daily_ticks.jsonl`.
 *
 * The panel is built around one distinction it refuses to blur: a day with no
 * row is SILENCE, not a zero. She may have taken everything and never opened
 * the app. So the strip shows those days hollow, the counts are taken only
 * across days she actually logged, and there is no single "adherence %" —
 * a number that counted silence as failure would send the coach into a
 * difficult conversation on the strength of an artefact.
 *
 * Items are ordered worst-first, because that is the actionable end: the one
 * supplement that never gets ticked is the thing to ask about.
 */
import type { DailyTicksSummary, TickItemSummary } from "@/lib/fmdb/daily-ticks";

const KIND_ICON: Record<string, string> = {
  supplement: "💊",
  remedy: "🌿",
  practice: "🌱",
};

function shortDay(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "narrow" });
}

/** Sage at full, fading to bare outline at nothing. */
function cellStyle(done: number, total: number): React.CSSProperties {
  if (total === 0) {
    return { background: "transparent", border: "1px dashed rgba(111,106,93,.32)" };
  }
  const r = done / total;
  return {
    background: `rgba(95,140,96,${(0.15 + r * 0.7).toFixed(2)})`,
    border: "1px solid rgba(95,140,96,.35)",
  };
}

/** Above this share of her logged days, an item is "steady" and gets folded away. */
const STEADY = 0.7;

function tone(ratio: number): string {
  return ratio >= STEADY ? "#5f8c60" : ratio >= 0.4 ? "#b0976b" : "#b06b6b";
}

/** One row per item. The name WRAPS rather than truncating — this panel sits in
 *  the narrow right rail, and a supplement clipped to "Homocystein…" tells the
 *  coach nothing she can act on. */
function ItemList({ items }: { items: TickItemSummary[] }) {
  return (
    <div style={{ display: "grid", gap: 7 }}>
      {items.map((it) => {
        const ratio = it.offeredDays ? it.doneDays / it.offeredDays : 0;
        return (
          <div key={`${it.kind}:${it.name}`} style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
            <span style={{ flexShrink: 0 }}>{KIND_ICON[it.kind] ?? "•"}</span>
            <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>{it.name}</span>
            <span
              style={{
                flexShrink: 0,
                fontSize: 12,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
                color: tone(ratio),
                fontWeight: ratio < 0.4 ? 600 : 400,
              }}
            >
              {it.doneDays}/{it.offeredDays} d
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function DailyLogPanel({ summary }: { summary: DailyTicksSummary }) {
  const { days, loggedDays, windowDays, tickedOfOffered, items, lastLoggedOn } = summary;
  const ratioOf = (i: TickItemSummary) => (i.offeredDays ? i.doneDays / i.offeredDays : 0);
  const slipping = items.filter((i) => ratioOf(i) < STEADY);
  const steady = items.filter((i) => ratioOf(i) >= STEADY);

  if (loggedDays === 0) {
    return (
      <div style={{ fontSize: 13, lineHeight: 1.6, color: "#6f6a5d" }}>
        Nothing ticked in the app in the last {windowDays} days. This fills in on its own once
        she starts using the daily list on the Today screen — until then it says only that the
        list is unused, not that the protocol is.
      </div>
    );
  }

  return (
    <div style={{ fontSize: 13, lineHeight: 1.6 }}>
      <div style={{ color: "#3a4d41", marginBottom: 10 }}>
        {tickedOfOffered && (
          <strong>
            {tickedOfOffered.done} of {tickedOfOffered.offered} ticked
          </strong>
        )}
        {tickedOfOffered && " "}
        <span style={{ color: "#6f6a5d" }}>
          across {loggedDays} of the last {windowDays} days
          {lastLoggedOn ? ` · last logged ${new Date(lastLoggedOn + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
        </span>
      </div>

      {/* day strip — oldest left */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
        {days.map((d) => (
          <div
            key={d.date}
            title={
              d.total === 0
                ? `${d.date} — no log`
                : `${d.date} — ${d.done} of ${d.total} ticked`
            }
            style={{
              width: 26,
              height: 30,
              borderRadius: 6,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              color: "#3a4d41",
              ...cellStyle(d.done, d.total),
            }}
          >
            <span style={{ opacity: 0.7 }}>{shortDay(d.date)}</span>
            <span style={{ fontWeight: 600 }}>{d.total === 0 ? "·" : d.done}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: "#8b857a", marginBottom: 14 }}>
        A dashed day is one she didn&rsquo;t log — which may mean she took everything and never
        opened the app. It isn&rsquo;t counted either way.
      </div>

      {/* Slipping items are the conversation; the ones she's reliable about are
          reassurance and belong out of the way. 70% ≈ 5 days in 7. */}
      <ItemList items={slipping} />
      {slipping.length === 0 && (
        <div style={{ color: "#3f6b40" }}>Everything on her list is running at 70%+ of the days she logged.</div>
      )}
      {steady.length > 0 && (
        <details style={{ marginTop: slipping.length ? 10 : 6 }}>
          <summary style={{ cursor: "pointer", color: "#6f6a5d", fontSize: 12.5 }}>
            {steady.length} more she&rsquo;s steady on (70%+)
          </summary>
          <div style={{ marginTop: 6 }}>
            <ItemList items={steady} />
          </div>
        </details>
      )}
      <div style={{ fontSize: 11.5, color: "#8b857a", marginTop: 10 }}>
        Counted only over the days each item was actually on her list, so something added this
        week isn&rsquo;t marked down for the days before it existed.
      </div>
    </div>
  );
}
