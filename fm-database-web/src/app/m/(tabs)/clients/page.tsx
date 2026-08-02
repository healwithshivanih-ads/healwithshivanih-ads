/**
 * /m/clients — the contacts list. This is the screen the whole app was asked
 * for: every client, one tap from WhatsApp / email / phone.
 *
 * Reads ONLY the projection (coach-staging-action.py), never ~/fm-plans — see
 * coach-mobile.ts for why.
 */
import Link from "next/link";
import { loadCoachIndex, coachProjectionReady, type CoachIndexRow } from "@/lib/fmdb/coach-mobile";
import { C, Chip, Empty, actionBtn, ago, serif } from "../../ui";

export const dynamic = "force-dynamic";

/** Meta wants E.164 without punctuation; Indian mobiles are stored various
 *  ways, so normalise to +91 when a bare 10-digit number appears. */
function waNumber(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

function matches(row: CoachIndexRow, q: string): boolean {
  if (!q) return true;
  const hay = [row.name, row.id, row.mobile ?? "", row.email ?? "", ...(row.conditions ?? [])]
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

function Row({ row }: { row: CoachIndexRow }) {
  const wa = waNumber(row.mobile);
  const tel = row.mobile?.replace(/[^\d+]/g, "");
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.line}`,
        borderRadius: 14,
        padding: "12px 12px 10px",
        marginBottom: 10,
      }}
    >
      <Link
        href={`/m/clients/${row.id}`}
        style={{ textDecoration: "none", color: "inherit", display: "block" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 17, color: C.ink, fontWeight: 600 }}>{row.name}</div>
          {row.recent_whatsapp ? <Chip tone="good">{row.recent_whatsapp} msg</Chip> : null}
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            margin: "7px 0 10px",
            alignItems: "center",
          }}
        >
          {row.kind === "prospect" ? <Chip tone="warn">prospect</Chip> : null}
          {row.plan_status ? <Chip>{row.plan_status}</Chip> : null}
          {(row.conditions ?? []).slice(0, 2).map((c) => (
            <Chip key={c}>{c}</Chip>
          ))}
          {ago(row.last_session) ? (
            <span style={{ fontSize: 12, color: C.muted }}>· seen {ago(row.last_session)}</span>
          ) : null}
        </div>
      </Link>

      {/* The four actions. Rendered even when a channel is missing? No — a
          dead button is worse than an absent one, so each is conditional. */}
      <div style={{ display: "flex", gap: 8 }}>
        {wa ? (
          <a style={actionBtn} href={`https://wa.me/${wa}`} aria-label={`WhatsApp ${row.name}`}>
            💬
          </a>
        ) : null}
        {wa ? (
          <Link
            style={actionBtn}
            href={`/m/clients/${row.id}#send`}
            aria-label={`Send from business WhatsApp to ${row.name}`}
          >
            📲
          </Link>
        ) : null}
        {row.email ? (
          <a style={actionBtn} href={`mailto:${row.email}`} aria-label={`Email ${row.name}`}>
            ✉️
          </a>
        ) : null}
        {tel ? (
          <a style={actionBtn} href={`tel:${tel}`} aria-label={`Call ${row.name}`}>
            📞
          </a>
        ) : null}
      </div>
    </div>
  );
}

export default async function ClientsTab({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? "").trim();

  if (!coachProjectionReady()) {
    return (
      <main style={{ padding: 16 }}>
        <h1 style={{ fontFamily: serif, fontSize: 24, color: C.ink, margin: "4px 0 14px" }}>
          Clients
        </h1>
        <Empty
          title="Client list not synced yet"
          detail="FMDB_COACH_DIR isn't set on this host, so the projection hasn't been written. This is a setup step, not an empty roster."
        />
      </main>
    );
  }

  const all = loadCoachIndex();
  const rows = all.filter((r) => matches(r, q));

  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontFamily: serif, fontSize: 24, color: C.ink, margin: "4px 0 12px" }}>
        Clients <span style={{ fontSize: 15, color: C.muted }}>{all.length}</span>
      </h1>

      {/* GET form: no JS needed, and the search survives a reload / share. */}
      <form method="GET" style={{ marginBottom: 14 }}>
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name, condition, number…"
          aria-label="Search clients"
          style={{
            width: "100%",
            fontSize: 16, // 16px min or Safari zooms on focus
            padding: "11px 13px",
            borderRadius: 11,
            border: `1px solid ${C.line}`,
            background: "#fff",
          }}
        />
      </form>

      {rows.length === 0 ? (
        <Empty title={`No one matches “${q}”`} detail="Try a first name or a condition." />
      ) : (
        rows.map((r) => <Row key={r.id} row={r} />)
      )}
    </main>
  );
}
