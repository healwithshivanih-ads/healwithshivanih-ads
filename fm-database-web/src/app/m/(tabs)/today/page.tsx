/**
 * /m/today — what needs you today.
 *
 * An A–Z list is the wrong home screen for a phone: it makes you scan 21 names
 * to work out who needs attention. This surfaces only the rows with a reason,
 * and says nothing when there is nothing — "all clear" is a real answer.
 *
 * Signals are derived from the projection alone (no live computation), so this
 * screen keeps working with the Mac asleep.
 */
import Link from "next/link";
import { loadCoachIndex, coachProjectionReady, type CoachIndexRow } from "@/lib/fmdb/coach-mobile";
import { C, Chip, Empty, Panel, SectionTitle, ago, serif } from "../../ui";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / DAY);
}

function daysSince(iso?: string | null): number | null {
  const d = daysUntil(iso);
  return d === null ? null : -d;
}

function Row({ row, why, tone }: { row: CoachIndexRow; why: string; tone: "bad" | "warn" | "neutral" }) {
  return (
    <Link href={`/m/clients/${row.id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <Panel style={{ padding: "11px 12px", marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 16, color: C.ink, fontWeight: 600 }}>{row.name}</span>
          <Chip tone={tone}>{why}</Chip>
        </div>
      </Panel>
    </Link>
  );
}

export default async function TodayTab() {
  if (!coachProjectionReady()) {
    return (
      <main style={{ padding: 16 }}>
        <h1 style={{ fontFamily: serif, fontSize: 24, color: C.ink, margin: "4px 0 14px" }}>
          Today
        </h1>
        <Empty
          title="Not synced yet"
          detail="FMDB_COACH_DIR isn't set on this host, so there's nothing to read. This is a setup step."
        />
      </main>
    );
  }

  const rows = loadCoachIndex();

  const overdue = rows
    .filter((r) => (daysSince(r.next_contact_date) ?? -1) > 0)
    .sort((a, b) => (daysSince(b.next_contact_date) ?? 0) - (daysSince(a.next_contact_date) ?? 0));

  const dueSoon = rows.filter((r) => {
    const d = daysUntil(r.next_contact_date);
    return d !== null && d >= 0 && d <= 7;
  });

  const messaged = rows.filter((r) => (r.recent_whatsapp ?? 0) > 0);

  // Signed up but nothing recorded in a long while — the quiet drop-off that
  // is easy to miss when you only ever look at people who contact you.
  const quiet = rows.filter(
    (r) =>
      r.kind === "client" &&
      r.plan_status === "published" &&
      (daysSince(r.last_session) ?? 0) > 45,
  );

  const nothing =
    !overdue.length && !dueSoon.length && !messaged.length && !quiet.length;

  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontFamily: serif, fontSize: 24, color: C.ink, margin: "4px 0 4px" }}>Today</h1>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 6 }}>
        {rows.length} people on your list
      </div>

      {nothing ? (
        <Empty
          title="Nothing needs you right now"
          detail="No overdue follow-ups, no unanswered messages, nobody gone quiet."
        />
      ) : null}

      {overdue.length ? (
        <>
          <SectionTitle>Follow-up overdue</SectionTitle>
          {overdue.map((r) => (
            <Row key={r.id} row={r} tone="bad" why={`${daysSince(r.next_contact_date)}d late`} />
          ))}
        </>
      ) : null}

      {messaged.length ? (
        <>
          <SectionTitle>They messaged you</SectionTitle>
          {messaged.map((r) => (
            <Row key={r.id} row={r} tone="warn" why={`${r.recent_whatsapp} recent`} />
          ))}
        </>
      ) : null}

      {dueSoon.length ? (
        <>
          <SectionTitle>Coming up this week</SectionTitle>
          {dueSoon.map((r) => (
            <Row
              key={r.id}
              row={r}
              tone="neutral"
              why={daysUntil(r.next_contact_date) === 0 ? "today" : `in ${daysUntil(r.next_contact_date)}d`}
            />
          ))}
        </>
      ) : null}

      {quiet.length ? (
        <>
          <SectionTitle>Gone quiet</SectionTitle>
          {quiet.map((r) => (
            <Row key={r.id} row={r} tone="neutral" why={`seen ${ago(r.last_session)}`} />
          ))}
        </>
      ) : null}
    </main>
  );
}
