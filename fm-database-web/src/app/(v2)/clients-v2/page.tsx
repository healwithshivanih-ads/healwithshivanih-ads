/**
 * /clients-v2 — v2 clients list (all clients, filterable card grid).
 *
 * Previously the sidebar's "👥 All clients" link routed to the legacy
 * /clients page, dropping the coach out of v2 chrome the moment she
 * tried to browse her roster. This route keeps everything inside
 * FmAppShell with the FAB and the workflow-stage signals the rest
 * of v2 leans on.
 *
 * Each card surfaces:
 *   - Photo + display name + clientId (mono)
 *   - Age + sex + intake date
 *   - Active plan slug + status badge, or "No active plan"
 *   - Last session type + days-ago badge
 *   - Workflow stage hint (no_plan / draft / active / recheck) with
 *     the matching tone — same color palette FmWorkflowBanner uses
 *
 * Filters via URL search params (?q=... &filter=...):
 *   - Free-text search across name + id
 *   - filter=all (default) · active · draft · no_plan · recheck
 *
 * Click a card → /clients-v2/[id] (the existing v2 Overview).
 * "+ New client" deep-links to the existing inline form on legacy
 * /clients-v2/new (preserved as a single source of truth until the
 * intake form gets its own v2 surface).
 */
import Link from "next/link";
import path from "node:path";
import fs from "node:fs/promises";
import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import { loadClientSessions } from "@/lib/fmdb/loader-extras";
import { parseSessionType } from "@/lib/fmdb/session-utils";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { effectiveRecheckDate } from "@/lib/fmdb/plan-timing";
import type { Client } from "@/lib/fmdb/types";
import { FmAppShell, FmPanel, FmPageHeader } from "@/components/fm";
import { ClientCard, ClientFilters } from "./list-client";

export const dynamic = "force-dynamic";

type FilterId = "all" | "active" | "draft" | "no_plan" | "recheck" | "alumni";

const ACTIVE_BUCKETS = new Set(["draft", "ready_to_publish", "published"]);
const STATUS_RANK: Record<string, number> = {
  published: 3,
  ready_to_publish: 2,
  draft: 1,
};

interface PlanLite {
  slug: string;
  status: string;
  recheckDate?: string;
}

interface SessionLite {
  date: string;
  type: string;
}

export interface ClientRow {
  client_id: string;
  display_name: string;
  age?: number | string;
  sex?: string;
  intake_date?: string;
  city?: string;
  active_plan?: PlanLite;
  last_session?: SessionLite;
  /** Whether a client.jpg / .png exists in the per-client photo dir. */
  has_photo: boolean;
  /** Workflow stage same as Overview / Plan tab: no_plan / draft /
   *  active / recheck. `alumni` = client has a graduated plan + no
   *  active plan. */
  stage: "no_plan" | "draft" | "active" | "recheck" | "alumni";
  next_contact_date?: string;
}

function deriveStage(
  activePlan: PlanLite | undefined,
  todayStr: string,
): ClientRow["stage"] {
  if (!activePlan) return "no_plan";
  if (activePlan.status !== "published") return "draft";
  if (activePlan.recheckDate && activePlan.recheckDate < todayStr) return "recheck";
  return "active";
}

function deriveAge(client: Client): number | undefined {
  const c = client as unknown as Record<string, unknown>;
  const dob = c.date_of_birth as string | undefined;
  if (dob) {
    try {
      const d = new Date(dob);
      if (!Number.isNaN(d.getTime())) {
        const today = new Date();
        let age = today.getFullYear() - d.getFullYear();
        const m = today.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
        return age;
      }
    } catch {
      /* ignore */
    }
  }
  const ab = c.age_band as string | undefined;
  if (ab) {
    const parts = ab.split("-").map((n) => parseInt(n, 10));
    if (parts.length === 2 && !parts.some(Number.isNaN)) {
      return Math.round((parts[0] + parts[1]) / 2);
    }
  }
  return undefined;
}

async function clientHasPhoto(clientId: string): Promise<boolean> {
  const root = getPlansRoot();
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    try {
      await fs.access(path.join(root, "clients", clientId, `photo.${ext}`));
      return true;
    } catch {
      /* keep trying */
    }
  }
  return false;
}

export default async function ClientsListV2Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const { q = "", filter = "all" } = await searchParams;
  const filterId = (
    ["all", "active", "draft", "no_plan", "recheck", "alumni"].includes(filter)
      ? filter
      : "all"
  ) as FilterId;
  const todayStr = new Date().toISOString().slice(0, 10);

  const [clients, allPlans] = await Promise.all([
    loadAllClients(),
    loadAllPlans(),
  ]);

  // Unread-activity counts (drives the numbered chip on each client card).
  // Reuses scheduling-due for the alerts bucket so behaviour is identical
  // to dashboard-v2.
  const { getSchedulingDueRows: getDueRows } = await import("@/lib/fmdb/scheduling-due");
  const { getClientUnreadCounts } = await import("@/lib/fmdb/loader-extras");
  const dueRowsForAlerts = await getDueRows(
    clients as Array<Record<string, unknown> & { client_id: string }>,
    allPlans as Array<Record<string, unknown>>,
    todayStr,
  );
  const alertTriggeredAt = new Map<string, string>();
  for (const r of dueRowsForAlerts) {
    const candidates: string[] = [];
    if (r.last_session_date) {
      const t = new Date(r.last_session_date + "T00:00:00Z");
      t.setUTCDate(t.getUTCDate() + 12);
      candidates.push(t.toISOString());
    }
    if (r.plan_period_recheck_date) {
      candidates.push(new Date(r.plan_period_recheck_date + "T00:00:00Z").toISOString());
    }
    if (candidates.length > 0) {
      candidates.sort();
      alertTriggeredAt.set(r.client_id, candidates[candidates.length - 1]);
    }
  }
  const unreadMap = await getClientUnreadCounts(
    clients as Array<Record<string, unknown>>,
    {
      alertClientIds: new Set(dueRowsForAlerts.map((r) => r.client_id)),
      alertTriggeredAt,
    },
  );

  // Build per-client active plan lookup + most-recent session + photo
  // presence in parallel — load is small (4 clients live, scales fine).
  const rows: ClientRow[] = await Promise.all(
    clients.map(async (client): Promise<ClientRow> => {
      const c = client as unknown as Record<string, unknown>;
      const id = client.client_id as string;

      const clientPlans = allPlans.filter((p) => p.client_id === id);
      const activeSorted = clientPlans
        .filter((p) =>
          ACTIVE_BUCKETS.has(
            (p.status as string | undefined) ??
              (p._bucket as string | undefined) ??
              "",
          ),
        )
        .sort((a, b) => {
          const sa =
            STATUS_RANK[
              (a.status as string | undefined) ??
                (a._bucket as string | undefined) ??
                ""
            ] ?? 0;
          const sb =
            STATUS_RANK[
              (b.status as string | undefined) ??
                (b._bucket as string | undefined) ??
                ""
            ] ?? 0;
          return sb - sa;
        });
      const activeRaw = activeSorted[0];
      let activePlan: PlanLite | undefined;
      if (activeRaw) {
        const status =
          (activeRaw.status as string | undefined) ??
          (activeRaw._bucket as string | undefined) ??
          "draft";
        // Effective recheck date accounts for the meal-plan adoption lag
        // (3-day default) and coach-asserted meal_plan_started_on.
        // See lib/fmdb/plan-timing.ts.
        const recheckDate = effectiveRecheckDate(activeRaw as Parameters<typeof effectiveRecheckDate>[0])
          ?? (activeRaw.plan_period_recheck_date as string | undefined);
        activePlan = { slug: activeRaw.slug as string, status, recheckDate };
      }

      // Alumni detection: client has a graduated plan AND no active plan.
      // Graduated plans get bucketed via `_bucket: "graduated"` from the
      // loader. A client with both an active plan + an older graduated
      // plan stays "active" — graduation only applies when there's no
      // current protocol.
      const hasGraduatedPlan = clientPlans.some(
        (p) =>
          ((p.status as string | undefined) ??
            (p._bucket as string | undefined)) === "graduated",
      );
      const isAlumni = hasGraduatedPlan && !activePlan;

      // Last session — read the per-client sessions dir + pick the newest
      // by filename date. Avoid the SessionSummary action (which does extra
      // synthesis-notes / plan-exists work we don't need here).
      let lastSession: SessionLite | undefined;
      try {
        const raw = await loadClientSessions(id);
        const sorted = [...raw].sort((a, b) =>
          ((b.date as string) ?? "").localeCompare((a.date as string) ?? ""),
        );
        const latest = sorted[0] as Record<string, unknown> | undefined;
        if (latest && typeof latest.date === "string") {
          lastSession = {
            date: latest.date,
            type: parseSessionType(
              latest.presenting_complaints as string | undefined,
            ),
          };
        }
      } catch {
        /* no sessions dir */
      }

      const hasPhoto = await clientHasPhoto(id);

      return {
        client_id: id,
        display_name:
          (client.display_name as string | undefined) ?? id,
        age: deriveAge(client),
        sex: (c.sex as string | undefined) ?? undefined,
        intake_date: (c.intake_date as string | undefined) ?? undefined,
        city: (c.city as string | undefined) ?? undefined,
        active_plan: activePlan,
        last_session: lastSession,
        has_photo: hasPhoto,
        stage: isAlumni ? "alumni" : deriveStage(activePlan, todayStr),
        next_contact_date:
          (c.next_contact_date as string | undefined) ?? undefined,
      };
    }),
  );

  // Apply search + filter
  const qNorm = q.trim().toLowerCase();
  const filtered = rows
    .filter((r) => {
      if (qNorm) {
        const hay = `${r.display_name} ${r.client_id}`.toLowerCase();
        if (!hay.includes(qNorm)) return false;
      }
      if (filterId === "active") return r.stage === "active";
      if (filterId === "draft") return r.stage === "draft";
      if (filterId === "no_plan") return r.stage === "no_plan";
      if (filterId === "recheck") return r.stage === "recheck";
      if (filterId === "alumni") return r.stage === "alumni";
      // "all" filter hides alumni by default — coach explicitly chooses
      // the Alumni chip to see graduated clients. Keeps the default
      // view focused on active roster.
      if (filterId === "all" && r.stage === "alumni") return false;
      return true;
    })
    .sort((a, b) =>
      // Match the legacy /clients page: alphabetical by client_id.
      // Coach preference — stage-based sort kept jumping rows around as
      // protocols moved through draft → active → recheck. Stable
      // alphabetical order makes the page predictable session over
      // session.
      (a.client_id ?? "").localeCompare(b.client_id ?? ""),
    );

  // Counts for the filter chips. `all` excludes alumni so the main
  // roster view stays focused; alumni get their own chip + count.
  const counts: Record<FilterId, number> = {
    all: rows.filter((r) => r.stage !== "alumni").length,
    active: rows.filter((r) => r.stage === "active").length,
    draft: rows.filter((r) => r.stage === "draft").length,
    no_plan: rows.filter((r) => r.stage === "no_plan").length,
    recheck: rows.filter((r) => r.stage === "recheck").length,
    alumni: rows.filter((r) => r.stage === "alumni").length,
  };

  return (
    <FmAppShell
      activeNavId="clients"
      crumbs={[{ label: "Clients" }]}
    >
      <FmPageHeader
        as="h1"
        size="lg"
        title={
          <span style={{ color: "#3a4250" }}>
            👥 Clients
          </span>
        }
        subtitle="Your roster. Filter by workflow stage, search by name or ID, click any card to open."
        rightSlot={
          <Link
            href="/clients-v2/new"
            style={{
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 700,
              background: "var(--fm-primary)",
              color: "#fff",
              borderRadius: "var(--fm-radius-sm)",
              textDecoration: "none",
            }}
          >
            ＋ New client
          </Link>
        }
      />

      <ClientFilters active={filterId} counts={counts} q={q} />

      {filtered.length === 0 ? (
        <FmPanel
          style={{
            marginTop: 16,
            textAlign: "center",
            padding: "36px 24px",
            background:
              "linear-gradient(135deg, var(--fm-bg-warm), var(--fm-surface) 70%)",
            borderColor: "rgba(255, 107, 53, 0.25)",
            borderWidth: 2,
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 8 }}>🔍</div>
          <h2
            style={{
              fontFamily: "var(--fm-font-display)",
              fontSize: 20,
              fontWeight: 400,
              margin: "0 0 6px",
              letterSpacing: "-0.3px",
              color: "var(--fm-text-primary)",
            }}
          >
            No clients match
          </h2>
          <p
            style={{
              fontSize: 13,
              color: "var(--fm-text-secondary)",
              margin: "0 0 14px",
            }}
          >
            {qNorm
              ? `No client matches "${qNorm}" with filter "${filterId}".`
              : "No clients in this bucket yet."}
          </p>
          {qNorm || filterId !== "all" ? (
            <Link
              href="/clients-v2"
              style={{
                display: "inline-block",
                fontSize: 12,
                color: "var(--fm-text-secondary)",
                textDecoration: "underline",
              }}
            >
              Clear filters
            </Link>
          ) : (
            <Link
              href="/clients-v2/new"
              style={{
                display: "inline-block",
                background: "var(--fm-primary)",
                color: "#fff",
                padding: "9px 18px",
                fontSize: 13,
                fontWeight: 700,
                borderRadius: "var(--fm-radius-sm)",
                textDecoration: "none",
              }}
            >
              ＋ Add your first client
            </Link>
          )}
        </FmPanel>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 14,
            marginTop: 16,
          }}
        >
          {filtered.map((r) => (
            <ClientCard
              key={r.client_id}
              row={r}
              todayStr={todayStr}
              unread={unreadMap.get(r.client_id)}
            />
          ))}
        </div>
      )}
    </FmAppShell>
  );
}
