import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import { loadClientSessions } from "@/lib/fmdb/loader-extras";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { parseSessionType, parseRequestedLabs } from "@/lib/fmdb/session-utils";
import { NewClientForm } from "./new-client-form";
import { ClientAvatar } from "./[id]/client-avatar";

export const dynamic = "force-dynamic";

const ACTIVE_BUCKETS = new Set(["draft", "ready_to_publish", "published"]);

interface ClientSignals {
  pendingLabs: string[];
  isReturning: boolean;
  daysSinceLastSession: number | null;
}

/**
 * Loads sessions once and returns all status signals for a client:
 * - pendingLabs: labs requested in the most-recent pre-intake but not yet followed up
 * - isReturning: client had a full assessment AND hasn't been seen in 28+ days (no active plan)
 * - daysSinceLastSession: calendar days since the most-recent session
 */
async function getClientSignals(clientId: string, activePlanCount: number): Promise<ClientSignals> {
  // Clients on active plans are neither pending-labs nor returning
  if (activePlanCount > 0) {
    return { pendingLabs: [], isReturning: false, daysSinceLastSession: null };
  }
  try {
    const sessions = await loadClientSessions(clientId);
    if (sessions.length === 0) {
      return { pendingLabs: [], isReturning: false, daysSinceLastSession: null };
    }

    // ── Pending labs ──────────────────────────────────────────────────────────
    // Find the most-recent pre-intake that requested labs and hasn't been
    // superseded by a subsequent full assessment.
    const preIdx = sessions.findIndex((s) => {
      const st = parseSessionType((s as Record<string, unknown>).presenting_complaints as string | undefined);
      const labs = parseRequestedLabs((s as Record<string, unknown>).coach_notes as string | undefined);
      return st === "pre_intake" && labs.length > 0;
    });
    const pendingLabs = (() => {
      if (preIdx === -1) return [];
      const hasAssessmentAfter = sessions.slice(0, preIdx).some((s) =>
        parseSessionType((s as Record<string, unknown>).presenting_complaints as string | undefined) === "full_assessment"
      );
      if (hasAssessmentAfter) return [];
      return parseRequestedLabs((sessions[preIdx] as Record<string, unknown>).coach_notes as string | undefined);
    })();

    // ── Returning client ──────────────────────────────────────────────────────
    // A returning client had at least one full assessment AND hasn't been seen
    // in 28+ days. Check-ins also count as "recent contact".
    const mostRecent = sessions[0];
    const mostRecentDate = (mostRecent as Record<string, unknown>).date as string | undefined;
    let daysSince: number | null = null;
    let isReturning = false;
    if (mostRecentDate) {
      daysSince = Math.round(
        (Date.now() - new Date(mostRecentDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      const hadFullAssessment = sessions.some((s) =>
        parseSessionType((s as Record<string, unknown>).presenting_complaints as string | undefined) === "full_assessment"
      );
      isReturning = daysSince >= 28 && hadFullAssessment;
    }

    return { pendingLabs, isReturning, daysSinceLastSession: daysSince };
  } catch {
    return { pendingLabs: [], isReturning: false, daysSinceLastSession: null };
  }
}

export default async function ClientsPage() {
  const [clients, plans] = await Promise.all([loadAllClients(), loadAllPlans()]);

  const activePlanCount = (cid: string) =>
    plans.filter(
      (p) =>
        p.client_id === cid &&
        ACTIVE_BUCKETS.has(p.status ?? p._bucket ?? "")
    ).length;

  const sorted = [...clients].sort((a, b) =>
    (a.client_id ?? "").localeCompare(b.client_id ?? "")
  );

  // Load signals for each client in parallel
  const signalsMap = new Map<string, ClientSignals>();
  await Promise.all(
    sorted.map(async (c) => {
      const count = activePlanCount(c.client_id);
      const signals = await getClientSignals(c.client_id, count);
      signalsMap.set(c.client_id, signals);
    })
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Clients</h1>
        <p className="text-muted-foreground mt-1">
          Reading from{" "}
          <code className="font-mono text-xs">
            {getPlansRoot()}/clients/
          </code>
          .
        </p>
      </div>

      {/* Form renders as a full-width block so there's no wasted side-space */}
      <NewClientForm />

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No clients yet. Click <strong>+ New client</strong> above to create
            one.
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Sex</TableHead>
                <TableHead>Intake</TableHead>
                <TableHead>Conditions</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((c) => {
                const href = `/clients/${c.client_id}`;
                // Compute age from DOB if available, fall back to age_band
                const ageDisplay = (() => {
                  const dob = (c as { date_of_birth?: string }).date_of_birth;
                  if (dob) {
                    const dobDate = new Date(dob);
                    const today = new Date();
                    let age = today.getFullYear() - dobDate.getFullYear();
                    const m = today.getMonth() - dobDate.getMonth();
                    if (m < 0 || (m === 0 && today.getDate() < dobDate.getDate())) age--;
                    return `${age} yrs`;
                  }
                  return c.age_band ?? "—";
                })();
                return (
                  <TableRow
                    key={c.client_id}
                    className="cursor-pointer hover:bg-muted/50"
                  >
                    <TableCell>
                      <Link
                        href={href}
                        className="font-mono text-xs hover:underline"
                      >
                        {c.client_id}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={href} className="flex items-center gap-2 hover:underline">
                        <ClientAvatar
                          clientId={c.client_id}
                          displayName={(c as { display_name?: string }).display_name ?? undefined}
                          size={32}
                        />
                        {(c as { display_name?: string }).display_name ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={href} className="block">
                        {ageDisplay}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={href} className="block">
                        {c.sex ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={href} className="block">
                        {c.intake_date ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={href} className="block">
                        {(c.active_conditions ?? []).length}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={href} className="block">
                        {(() => {
                          const sig = signalsMap.get(c.client_id);
                          const planCount = activePlanCount(c.client_id);
                          if (sig?.pendingLabs && sig.pendingLabs.length > 0) {
                            return (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#D6A2A2]/20 text-[#7A3D3D]">
                                🧪 {sig.pendingLabs.length} labs pending
                              </span>
                            );
                          }
                          if (planCount > 0) {
                            return (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#2B2D42]/10 text-[#2B2D42]">
                                📋 {planCount} plan{planCount !== 1 ? "s" : ""}
                              </span>
                            );
                          }
                          if (sig?.isReturning) {
                            return (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                                🔄 returning{sig.daysSinceLastSession ? ` · ${sig.daysSinceLastSession}d` : ""}
                              </span>
                            );
                          }
                          return <span className="text-muted-foreground text-xs">No plans</span>;
                        })()}
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
