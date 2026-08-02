/**
 * /m/today — what needs you today.
 *
 * An A–Z list is the wrong home screen for a phone: it makes you scan 21
 * names to work out who needs attention. This surfaces only rows with a
 * reason, and says nothing when there is nothing — "all clear" is a real
 * answer, not an empty state.
 *
 * Signals derive from the projection alone, so this screen keeps working
 * with the Mac asleep.
 */
import Link from "next/link";
import {
  loadCoachIndex,
  coachProjectionReady,
  type CoachIndexRow,
} from "@/lib/fmdb/coach-mobile";
import { Avatar, Empty, Eyebrow, Icon, ago } from "../../ui";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.round((t - Date.now()) / DAY);
}
const daysSince = (iso?: string | null) => {
  const d = daysUntil(iso);
  return d === null ? null : -d;
};

function Row({
  row,
  why,
  tone,
}: {
  row: CoachIndexRow;
  why: string;
  tone?: "primary" | "success" | "warning" | "danger";
}) {
  return (
    <Link href={`/m/clients/${row.id}`} className="m-card m-card--link" style={{ display: "block", marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Avatar name={row.name} prospect={row.kind === "prospect"} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.name}
          </h3>
          <div className="m-subtle" style={{ marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
            <span className={`m-dot${tone ? ` m-dot--${tone}` : ""}`} />
            {why}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default async function TodayTab() {
  if (!coachProjectionReady()) {
    return (
      <main className="m-page">
        <h1>Today</h1>
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

  // Signed up but nothing recorded in a long while — the quiet drop-off
  // that's easy to miss when you only look at people who contact you.
  const quiet = rows.filter(
    (r) =>
      r.kind === "client" &&
      r.plan_status === "published" &&
      (daysSince(r.last_session) ?? 0) > 45,
  );

  const nothing = !overdue.length && !dueSoon.length && !messaged.length && !quiet.length;

  return (
    <main className="m-page">
      <div className="m-pagehead" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1>Today</h1>
          <p className="m-subtle">{rows.length} people on your list</p>
        </div>
        {/* Account actions live here rather than in the tab bar — two tabs is
            the right amount of navigation; these are rare. */}
        <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
          <Link href="/m/settings" className="m-iconbtn" style={{ flex: "none", border: 0 }} aria-label="Change password">
            <Icon name="key" size="sm" />
          </Link>
          <form method="POST" action="/api/m/logout">
            <button type="submit" className="m-iconbtn" style={{ flex: "none", border: 0 }} aria-label="Log out">
              <Icon name="logout" size="sm" />
            </button>
          </form>
        </div>
      </div>

      {nothing ? (
        <Empty
          title="Nothing needs you right now"
          detail="No overdue follow-ups, no unanswered messages, nobody gone quiet."
        />
      ) : null}

      {/* rose is the single accent in this composition — reserved for the
          most urgent bucket, per the system's one-rose rule. */}
      {overdue.length ? (
        <>
          <Eyebrow>Follow-up overdue</Eyebrow>
          {overdue.map((r) => (
            <Row key={r.id} row={r} tone="danger" why={`${daysSince(r.next_contact_date)} days late`} />
          ))}
        </>
      ) : null}

      {messaged.length ? (
        <>
          <Eyebrow>They messaged you</Eyebrow>
          {messaged.map((r) => (
            <Row key={r.id} row={r} why={`${r.recent_whatsapp} recent`} />
          ))}
        </>
      ) : null}

      {dueSoon.length ? (
        <>
          <Eyebrow>Coming up this week</Eyebrow>
          {dueSoon.map((r) => (
            <Row
              key={r.id}
              row={r}
              tone="success"
              why={daysUntil(r.next_contact_date) === 0 ? "today" : `in ${daysUntil(r.next_contact_date)} days`}
            />
          ))}
        </>
      ) : null}

      {quiet.length ? (
        <>
          <Eyebrow>Gone quiet</Eyebrow>
          {quiet.map((r) => (
            <Row key={r.id} row={r} why={`seen ${ago(r.last_session)}`} />
          ))}
        </>
      ) : null}
    </main>
  );
}
