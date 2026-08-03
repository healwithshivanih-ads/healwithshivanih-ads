/**
 * /m/clients — the contacts list. This is the screen the app was asked for:
 * every client, one tap from WhatsApp / email / phone.
 *
 * Reads ONLY the projection (coach-staging-action.py), never ~/fm-plans —
 * see coach-mobile.ts for why.
 *
 * CLIENTS AND PROSPECTS ARE SEPARATE LISTS, not one list with a tint. They
 * were mixed here — 16 clients and 5 prospects in one A–Z run, distinguished
 * only by avatar colour and a small label — which quietly undoes the
 * separation the rest of the system maintains: someone who declined sits
 * between two people mid-protocol, and every count on the screen is a number
 * for a group that does not exist. Prospects stay one tap away, because they
 * still need calling; they just are not clients until they are.
 */
import Link from "next/link";
import {
  clientAppUrl,
  loadCoachIndex,
  coachProjectionReady,
  type CoachIndexRow,
} from "@/lib/fmdb/coach-mobile";
import { Avatar, Chip, Empty, Icon, ago, waNumber } from "../../ui";

export const dynamic = "force-dynamic";

function matches(row: CoachIndexRow, q: string): boolean {
  if (!q) return true;
  return [row.name, row.id, row.mobile ?? "", row.email ?? "", ...(row.conditions ?? [])]
    .join(" ")
    .toLowerCase()
    .includes(q.toLowerCase());
}

function Row({ row }: { row: CoachIndexRow }) {
  const wa = waNumber(row.mobile);
  const tel = row.mobile?.replace(/[^\d+]/g, "");
  const seen = ago(row.last_session);
  const appUrl = clientAppUrl(row.app_token);

  return (
    <div className="m-card m-card--link" style={{ marginBottom: 8 }}>
      <Link href={`/m/clients/${row.id}`} style={{ display: "block" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Avatar name={row.name} prospect={row.kind === "prospect"} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <h3 style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.name}
              </h3>
              {row.recent_whatsapp ? <span className="m-dot m-dot--danger" /> : null}
            </div>
            <div className="m-subtle" style={{ marginTop: 2 }}>
              {[
                row.kind === "prospect" ? "Prospect" : row.plan_status,
                seen ? `seen ${seen}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        </div>

        {(row.conditions ?? []).length ? (
          <div className="m-chips" style={{ marginTop: 10 }}>
            {(row.conditions ?? []).slice(0, 2).map((c) => (
              <Chip key={c}>{c}</Chip>
            ))}
          </div>
        ) : null}
      </Link>

      {/* Each action is conditional — a dead button is worse than an absent one. */}
      <div className="m-row" style={{ marginTop: 12 }}>
        {wa ? (
          <a className="m-iconbtn" href={`https://wa.me/${wa}`} aria-label={`WhatsApp ${row.name}`}>
            <Icon name="message" />
          </a>
        ) : null}
        {wa ? (
          <Link
            className="m-iconbtn"
            href={`/m/clients/${row.id}#send`}
            aria-label={`Message ${row.name} from the business number`}
          >
            <Icon name="send" />
          </Link>
        ) : null}
        {row.email ? (
          <a className="m-iconbtn" href={`mailto:${row.email}`} aria-label={`Email ${row.name}`}>
            <Icon name="mail" />
          </a>
        ) : null}
        {tel ? (
          <a className="m-iconbtn" href={`tel:${tel}`} aria-label={`Call ${row.name}`}>
            <Icon name="phone" />
          </a>
        ) : null}
        {appUrl ? (
          <Link
            className="m-iconbtn"
            href={`/m/clients/${row.id}/app`}
            aria-label={`Open ${row.name}'s app`}
          >
            <Icon name="phoneApp" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export default async function ClientsTab({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const showProspects = sp.kind === "prospect";

  if (!coachProjectionReady()) {
    return (
      <main className="m-page">
        <h1>Clients</h1>
          <Empty
          title="Client list not synced yet"
          detail="FMDB_COACH_DIR isn't set on this host, so the projection hasn't been written. This is a setup step, not an empty roster."
        />
      </main>
    );
  }

  const all = loadCoachIndex();
  const clientRows = all.filter((r) => r.kind === "client");
  const prospectRows = all.filter((r) => r.kind === "prospect");
  const rows = (showProspects ? prospectRows : clientRows).filter((r) => matches(r, q));

  return (
    <main className="m-page">
      <div className="m-pagehead" style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <h1>{showProspects ? "Prospects" : "Clients"}</h1>
        <span className="m-subtle">{showProspects ? prospectRows.length : clientRows.length}</span>
      </div>

      {/* Plain links, so the split survives with JS off — same reasoning as
          the tab bar. The counts are per group, never a combined total: one
          number over two populations is how they got conflated. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Link
          href="/m/clients"
          className={`fm-btn${showProspects ? "" : " primary"}`}
          aria-current={showProspects ? undefined : "page"}
        >
          Clients {clientRows.length}
        </Link>
        <Link
          href="/m/clients?kind=prospect"
          className={`fm-btn${showProspects ? " primary" : ""}`}
          aria-current={showProspects ? "page" : undefined}
        >
          Prospects {prospectRows.length}
        </Link>
      </div>

      {/* GET form: works without JS, and the search survives a reload. */}
      <form method="GET" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <Icon name="search" className="m-subtle" />
        <input
          name="q"
          defaultValue={q}
          className="m-field"
          placeholder="Search name, condition, number"
          aria-label="Search clients"
        />
      </form>

      {rows.length === 0 ? (
        <Empty title={`Nobody matches “${q}”`} detail="Try a first name or a condition." />
      ) : (
        rows.map((r) => <Row key={r.id} row={r} />)
      )}
    </main>
  );
}
