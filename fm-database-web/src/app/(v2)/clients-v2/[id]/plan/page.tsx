/**
 * /clients-v2/[id]/plan — Phase 4 Plan tab in v2.
 *
 * Dashboard + send hub view. NOT the editor — the 10-tab editor stays at
 * legacy /plans/[slug] for now (Phase 4.5). This view is what the coach
 * lands on after a Full Assessment generates a draft, and is the sticky
 * surface for letter sending + lifecycle navigation.
 *
 * Layout:
 *   - Client identity strip + 5-tab subnav (PlanPageShell)
 *   - Workflow stage banner (no_plan / draft / active / recheck)
 *   - Active plan card (status badge, version, plan period, status history)
 *   - 2-col body:
 *       LEFT  — plan summary (drivers, topics, supplements, practices, labs,
 *               education, notes_for_coach) — read-only digest
 *       RIGHT — Send letters panel (when published), Edit in classic deeplink,
 *               supersedes link, list of archived plans
 *   - No-plan empty state with CTA → /clients-v2/[id]/analyse/full
 */
import Link from "next/link";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { loadAllPlans } from "@/lib/fmdb/loader";
import type { Plan, PlanStatus } from "@/lib/fmdb/types";

const PLAN_STATUSES = new Set<PlanStatus>([
  "draft",
  "ready_to_publish",
  "published",
  "superseded",
  "revoked",
]);

function asPlanStatus(s: string | undefined): PlanStatus | undefined {
  return s && PLAN_STATUSES.has(s as PlanStatus) ? (s as PlanStatus) : undefined;
}
import { PlanStatusBadge } from "@/components/plan-status-badge";
import { FmPanel, FmWorkflowBanner } from "@/components/fm";
import type { FmWorkflowStage } from "@/components/fm";
import { PlanPageShell } from "./plan-page-shell";
import { PlanSendPanel } from "./plan-send-panel";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = new Set(["draft", "ready_to_publish", "published"]);

interface PlanSummaryItem {
  label: string;
  detail?: string;
}

function planStatusOf(p: Plan): string {
  return (p.status as string | undefined) ?? p._bucket ?? "draft";
}

function planVersionOf(p: Plan): number {
  return (p.version as number | undefined) ?? 1;
}

function pretty(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Extract a short display-friendly digest from any unknown[] plan-section. */
function summariseSection(
  items: unknown[] | undefined,
  pickLabel: (it: Record<string, unknown>) => string | undefined,
  pickDetail?: (it: Record<string, unknown>) => string | undefined,
): PlanSummaryItem[] {
  if (!Array.isArray(items)) return [];
  const out: PlanSummaryItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const it = raw as Record<string, unknown>;
    const label = pickLabel(it);
    if (!label) continue;
    out.push({ label, detail: pickDetail ? pickDetail(it) : undefined });
  }
  return out;
}

function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "primary";
}) {
  const styles =
    tone === "primary"
      ? {
          background: "rgba(255, 107, 53, 0.10)",
          color: "var(--fm-primary)",
          border: "1px solid transparent",
        }
      : {
          background: "var(--fm-bg-cool)",
          color: "var(--fm-text-secondary)",
          border: "1px solid var(--fm-border-light)",
        };
  return (
    <span
      style={{
        ...styles,
        display: "inline-block",
        padding: "3px 9px",
        borderRadius: "var(--fm-radius-pill)",
        fontSize: 11,
        fontWeight: 600,
        marginRight: 5,
        marginBottom: 5,
      }}
    >
      {children}
    </span>
  );
}

function ChipList({
  items,
  tone,
}: {
  items: string[];
  tone?: "neutral" | "primary";
}) {
  if (items.length === 0) {
    return (
      <span style={{ fontSize: 12, color: "var(--fm-text-tertiary)" }}>—</span>
    );
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", marginTop: 4 }}>
      {items.map((s, i) => (
        <Chip key={`${s}-${i}`} tone={tone}>
          {s}
        </Chip>
      ))}
    </div>
  );
}

function MiniLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        fontWeight: 700,
        color: "var(--fm-text-tertiary)",
        marginTop: 2,
      }}
    >
      {children}
    </div>
  );
}

function deriveStage(
  activePlan: Plan | undefined,
  todayStr: string,
): {
  stage: FmWorkflowStage;
  title: React.ReactNode;
  detail?: React.ReactNode;
  cta?: React.ReactNode;
  ctaHref?: string;
} {
  if (!activePlan) {
    return {
      stage: "no_plan",
      title: "No plan on file",
      detail: "Run a Full Assessment to draft one.",
      cta: "Start full assessment",
      ctaHref: undefined,
    };
  }
  const status = planStatusOf(activePlan);
  if (status === "draft" || status === "ready_to_publish") {
    return {
      stage: "draft",
      title: `Plan in ${status.replace(/_/g, " ")}`,
      detail: "Edit in the classic editor, then submit + publish to send letters.",
      cta: "Edit in classic",
      ctaHref: `/plans/${activePlan.slug}`,
    };
  }
  if (status === "published") {
    let recheckDate: string | undefined = activePlan.plan_period_recheck_date;
    if (
      !recheckDate &&
      activePlan.plan_period_start &&
      activePlan.plan_period_weeks
    ) {
      const d = new Date(`${activePlan.plan_period_start}T00:00:00`);
      d.setDate(d.getDate() + activePlan.plan_period_weeks * 7);
      recheckDate = d.toISOString().slice(0, 10);
    }
    if (recheckDate && recheckDate < todayStr) {
      return {
        stage: "recheck",
        title: "Re-check due",
        detail: `Protocol ended ${recheckDate} · run a new Full Assessment.`,
        cta: "New full assessment",
        ctaHref: undefined,
      };
    }
    return {
      stage: "active",
      title: `Plan active — ${activePlan.slug}`,
      detail: recheckDate
        ? `Next follow-up ${recheckDate}.`
        : "Letters can go out now.",
      cta: "Generate letters",
      ctaHref: undefined,
    };
  }
  return {
    stage: "no_plan",
    title: "No active plan",
    detail: "Latest plan is archived. Start a new Full Assessment.",
    cta: "New full assessment",
    ctaHref: undefined,
  };
}

export default async function PlanTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [client, allPlans] = await Promise.all([
    loadClientById(id),
    loadAllPlans(),
  ]);
  if (!client) {
    return (
      <PlanPageShell clientId={id}>
        <div />
      </PlanPageShell>
    );
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const plans = allPlans.filter((p) => p.client_id === id);
  const activePlan = plans.find((p) => ACTIVE_STATUSES.has(planStatusOf(p)));
  const archivedPlans = plans
    .filter((p) => p !== activePlan)
    .sort((a, b) =>
      (planVersionOf(b) - planVersionOf(a)) ||
      ((b.updated_at ?? "") as string).localeCompare(
        (a.updated_at ?? "") as string,
      ),
    );

  const stage = deriveStage(activePlan, todayStr);
  const status = activePlan ? planStatusOf(activePlan) : undefined;
  const isPublished = status === "published";

  // Plan summary digest (only meaningful when activePlan exists)
  const supplements = activePlan
    ? summariseSection(
        activePlan.supplement_protocol,
        (it) => (it.supplement_slug as string) ?? (it.name as string),
        (it) => {
          const dose = it.dose as string | undefined;
          const timing = it.timing as string | undefined;
          return [dose, timing].filter(Boolean).join(" · ");
        },
      )
    : [];

  const practices = activePlan
    ? summariseSection(
        activePlan.lifestyle_practices,
        (it) => it.name as string | undefined,
        (it) => it.cadence as string | undefined,
      )
    : [];

  const labs = activePlan
    ? summariseSection(
        activePlan.lab_orders,
        (it) => it.test as string | undefined,
        (it) => it.reason as string | undefined,
      )
    : [];

  const referrals = activePlan
    ? summariseSection(
        activePlan.referrals,
        (it) => it.to as string | undefined,
        (it) => {
          const urgency = it.urgency as string | undefined;
          const reason = it.reason as string | undefined;
          return [urgency, reason].filter(Boolean).join(" · ");
        },
      )
    : [];

  const education = activePlan
    ? summariseSection(
        activePlan.education,
        (it) => (it.target_slug as string) ?? (it.target_kind as string),
        (it) => it.client_facing_summary as string | undefined,
      )
    : [];

  const drivers = activePlan
    ? summariseSection(
        activePlan.hypothesized_drivers,
        (it) => it.mechanism as string | undefined,
        (it) => it.reasoning as string | undefined,
      )
    : [];

  const primaryTopics = (activePlan?.primary_topics ?? []) as string[];
  const contributingTopics = (activePlan?.contributing_topics ?? []) as string[];
  const presentingSymptoms = (activePlan?.presenting_symptoms ?? []) as string[];
  const notesForCoach = (activePlan?.notes_for_coach as string | undefined) ?? "";
  const planPeriodWeeks = activePlan?.plan_period_weeks;
  const planPeriodStart = activePlan?.plan_period_start;
  const supersedes = activePlan?.supersedes as string | undefined;
  const statusHistory =
    (activePlan?.status_history as Array<Record<string, unknown>> | undefined) ??
    [];

  return (
    <PlanPageShell clientId={id}>
      {/* Workflow stage banner */}
      <FmWorkflowBanner
        stage={stage.stage}
        title={stage.title}
        detail={stage.detail}
        cta={stage.cta}
        ctaHref={
          stage.ctaHref ??
          (stage.stage === "no_plan" || stage.stage === "recheck"
            ? `/clients-v2/${id}/analyse/full`
            : undefined)
        }
      />

      {!activePlan ? (
        <NoPlanEmpty clientId={id} archivedCount={archivedPlans.length} />
      ) : (
        <div
          style={{
            marginTop: 16,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 360px",
            gap: 20,
            alignItems: "start",
          }}
        >
          {/* LEFT — active plan details */}
          <div style={{ minWidth: 0, display: "grid", gap: 16 }}>
            {/* Plan header card */}
            <FmPanel
              title={
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  🗂 {activePlan.slug}
                </span>
              }
              subtitle={
                planPeriodWeeks
                  ? `${planPeriodWeeks}-week protocol${planPeriodStart ? ` · started ${planPeriodStart}` : ""}`
                  : "No plan-period dates set"
              }
              rightSlot={
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    fontSize: 11,
                  }}
                >
                  <PlanStatusBadge status={asPlanStatus(status)} />
                  <span style={{ color: "var(--fm-text-tertiary)" }}>
                    v{planVersionOf(activePlan)}
                  </span>
                </div>
              }
            >
              {supersedes && (
                <div
                  style={{
                    fontSize: 11.5,
                    marginBottom: 10,
                    padding: "6px 10px",
                    background: "var(--fm-bg-cool)",
                    borderRadius: "var(--fm-radius-sm)",
                  }}
                >
                  ↩ Supersedes{" "}
                  <Link
                    href={`/plans/${supersedes}`}
                    style={{
                      fontFamily: "var(--fm-font-mono)",
                      color: "var(--fm-text-primary)",
                    }}
                  >
                    {supersedes}
                  </Link>{" "}
                  ·{" "}
                  <Link
                    href={`/plans/${activePlan.slug}?tab=lifecycle`}
                    style={{
                      color: "var(--fm-primary)",
                      fontWeight: 600,
                    }}
                  >
                    Compare versions →
                  </Link>
                </div>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                }}
              >
                <div>
                  <MiniLabel>Primary topics</MiniLabel>
                  <ChipList items={primaryTopics} tone="primary" />
                </div>
                <div>
                  <MiniLabel>Presenting symptoms</MiniLabel>
                  <ChipList items={presentingSymptoms} />
                </div>
                {contributingTopics.length > 0 && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <MiniLabel>Contributing topics</MiniLabel>
                    <ChipList items={contributingTopics} />
                  </div>
                )}
              </div>
            </FmPanel>

            {/* Supplements */}
            <FmPanel
              title={`💊 Supplements (${supplements.length})`}
              subtitle="The supplement protocol. Letter generators inject this verbatim into the client-facing schedule."
            >
              {supplements.length === 0 ? (
                <EmptyHint>No supplements in the protocol yet.</EmptyHint>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {supplements.map((s, i) => (
                    <Row key={`${s.label}-${i}`} label={s.label} detail={s.detail} />
                  ))}
                </div>
              )}
            </FmPanel>

            {/* Lifestyle */}
            <FmPanel
              title={`🌿 Lifestyle practices (${practices.length})`}
              subtitle="Daily / weekly habits the client commits to."
            >
              {practices.length === 0 ? (
                <EmptyHint>No practices set.</EmptyHint>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {practices.map((p, i) => (
                    <Row key={`${p.label}-${i}`} label={p.label} detail={p.detail} />
                  ))}
                </div>
              )}
            </FmPanel>

            {/* Labs ordered */}
            {labs.length > 0 && (
              <FmPanel
                title={`🧪 Labs ordered (${labs.length})`}
                subtitle="Marker requests on this plan. Order via PrognoHealth / Thyrocare."
              >
                <div style={{ display: "grid", gap: 6 }}>
                  {labs.map((l, i) => (
                    <Row key={`${l.label}-${i}`} label={l.label} detail={l.detail} />
                  ))}
                </div>
              </FmPanel>
            )}

            {/* Referrals */}
            {referrals.length > 0 && (
              <FmPanel title={`👩‍⚕️ Referrals (${referrals.length})`}>
                <div style={{ display: "grid", gap: 6 }}>
                  {referrals.map((r, i) => (
                    <Row key={`${r.label}-${i}`} label={r.label} detail={r.detail} />
                  ))}
                </div>
              </FmPanel>
            )}

            {/* Education modules */}
            {education.length > 0 && (
              <FmPanel
                title={`🎓 Education (${education.length})`}
                subtitle="Topic / mechanism explainers attached to the client letter."
              >
                <div style={{ display: "grid", gap: 6 }}>
                  {education.map((e, i) => (
                    <Row key={`${e.label}-${i}`} label={e.label} detail={e.detail} />
                  ))}
                </div>
              </FmPanel>
            )}

            {/* Drivers */}
            {drivers.length > 0 && (
              <FmPanel
                title={`🧬 Hypothesised drivers (${drivers.length})`}
                subtitle="The mechanisms the AI synthesis identified as upstream root causes."
              >
                <div style={{ display: "grid", gap: 6 }}>
                  {drivers.map((d, i) => (
                    <Row key={`${d.label}-${i}`} label={d.label} detail={d.detail} />
                  ))}
                </div>
              </FmPanel>
            )}

            {/* Notes for coach */}
            {notesForCoach.trim() && (
              <FmPanel
                title="📝 Notes for coach"
                subtitle="Private — never appears on client letters."
              >
                <div
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {notesForCoach}
                </div>
              </FmPanel>
            )}
          </div>

          {/* RIGHT — send + meta */}
          <div
            style={{
              position: "sticky",
              top: 24,
              display: "grid",
              gap: 14,
            }}
          >
            {/* Send letters */}
            <FmPanel
              title="📤 Client letters"
              subtitle={
                isPublished
                  ? "Generate + send. Each letter renders with the brand template."
                  : "Letters unlock once the plan is published. Activate first to lock the version + catalogue snapshot."
              }
            >
              {isPublished ? (
                <PlanSendPanel
                  planSlug={activePlan.slug}
                  clientId={id}
                  clientEmail={(client as { email?: string }).email}
                  clientName={
                    (client.display_name as string | undefined) ??
                    client.client_id
                  }
                />
              ) : (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--fm-text-tertiary)",
                    padding: "10px 12px",
                    background: "var(--fm-bg-warm)",
                    border: "1px dashed rgba(255, 107, 53, 0.4)",
                    borderRadius: "var(--fm-radius-sm)",
                  }}
                >
                  Plan is <strong>{status?.replace(/_/g, " ")}</strong>. Open
                  in classic editor to submit + publish, then letters will
                  generate here.
                </div>
              )}
            </FmPanel>

            {/* Quick actions */}
            <FmPanel title="⚙ Actions" subtitle="The editor still lives in classic for now.">
              <div style={{ display: "grid", gap: 6 }}>
                <ActionLink
                  href={`/plans/${activePlan.slug}`}
                  icon="✏️"
                  label="Edit plan in classic"
                />
                <ActionLink
                  href={`/plans/${activePlan.slug}?tab=lifecycle`}
                  icon="🚀"
                  label="Lifecycle (submit / publish)"
                />
                <ActionLink
                  href={`/clients-v2/${id}/analyse/full`}
                  icon="🔬"
                  label="Run another full assessment"
                />
              </div>
            </FmPanel>

            {/* Status history timeline */}
            {statusHistory.length > 0 && (
              <FmPanel
                title="📜 Status history"
                subtitle="Every transition is recorded."
              >
                <div style={{ display: "grid", gap: 6 }}>
                  {[...statusHistory].reverse().map((ev, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 11,
                        padding: "5px 8px",
                        borderLeft: "2px solid var(--fm-border)",
                        background: "var(--fm-bg-cool)",
                        borderRadius: "0 var(--fm-radius-sm) var(--fm-radius-sm) 0",
                      }}
                    >
                      <PlanStatusBadge
                        status={asPlanStatus(ev.state as string | undefined)}
                      />{" "}
                      <span style={{ color: "var(--fm-text-tertiary)" }}>
                        {ev.at as string | undefined}
                      </span>
                      {ev.reason ? (
                        <div style={{ marginTop: 2 }}>
                          {ev.reason as string}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </FmPanel>
            )}

            {/* Other / archived plans */}
            {archivedPlans.length > 0 && (
              <FmPanel
                title={`🗄 Other plans (${archivedPlans.length})`}
                subtitle="Earlier or archived plans for this client."
              >
                <div style={{ display: "grid", gap: 6 }}>
                  {archivedPlans.map((p) => (
                    <Link
                      key={p.slug}
                      href={`/plans/${p.slug}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 10px",
                        border: "1px solid var(--fm-border-light)",
                        borderRadius: "var(--fm-radius-sm)",
                        textDecoration: "none",
                        background: "var(--fm-surface)",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0, fontSize: 11.5 }}>
                        <div
                          style={{
                            fontFamily: "var(--fm-font-mono)",
                            fontWeight: 600,
                            color: "var(--fm-text-primary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {p.slug}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: "var(--fm-text-tertiary)",
                            marginTop: 1,
                          }}
                        >
                          v{planVersionOf(p)} ·{" "}
                          {(p.updated_at as string | undefined)?.slice(0, 10) ?? "—"}
                        </div>
                      </div>
                      <PlanStatusBadge status={asPlanStatus(planStatusOf(p))} />
                    </Link>
                  ))}
                </div>
              </FmPanel>
            )}
          </div>
        </div>
      )}
    </PlanPageShell>
  );
}

function ActionLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-sm)",
        fontSize: 12,
        fontWeight: 600,
        color: "var(--fm-text-primary)",
        textDecoration: "none",
      }}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      {label}
    </Link>
  );
}

function Row({ label, detail }: { label: string; detail?: string }) {
  return (
    <div
      style={{
        padding: "7px 10px",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-sm)",
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 700 }}>{pretty(label)}</div>
      {detail && (
        <div
          style={{
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
            marginTop: 2,
            lineHeight: 1.5,
          }}
        >
          {detail}
        </div>
      )}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11.5,
        color: "var(--fm-text-tertiary)",
        padding: "6px 10px",
        background: "var(--fm-bg-cool)",
        borderRadius: "var(--fm-radius-sm)",
      }}
    >
      {children}
    </div>
  );
}

function NoPlanEmpty({
  clientId,
  archivedCount,
}: {
  clientId: string;
  archivedCount: number;
}) {
  return (
    <FmPanel
      style={{
        marginTop: 16,
        textAlign: "center",
        padding: "40px 24px",
        background: "linear-gradient(135deg, var(--fm-bg-warm), var(--fm-surface) 70%)",
        borderColor: "rgba(255, 107, 53, 0.25)",
        borderWidth: 2,
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 10 }}>🗂</div>
      <h2
        style={{
          fontFamily: "var(--fm-font-display)",
          fontSize: 22,
          fontWeight: 400,
          margin: "0 0 6px",
          letterSpacing: "-0.3px",
          color: "var(--fm-text-primary)",
        }}
      >
        No active plan
      </h2>
      <p
        style={{
          fontSize: 13,
          color: "var(--fm-text-secondary)",
          margin: "0 0 18px",
          lineHeight: 1.55,
          maxWidth: 480,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        Run a Full Assessment — the AI synthesises drivers, supplements and
        next steps from intake + reports, and drops a structured draft into{" "}
        <code>/plans/</code> ready to refine and send.
      </p>
      <Link
        href={`/clients-v2/${clientId}/analyse/full`}
        style={{
          display: "inline-block",
          background: "var(--fm-primary)",
          color: "#fff",
          padding: "10px 20px",
          fontSize: 13,
          fontWeight: 700,
          borderRadius: "var(--fm-radius-sm)",
          textDecoration: "none",
        }}
      >
        🔬 Start full assessment →
      </Link>
      {archivedCount > 0 && (
        <div
          style={{
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
            marginTop: 14,
          }}
        >
          {archivedCount} archived plan{archivedCount === 1 ? "" : "s"} on file
          — review under <em>Other plans</em> below.
        </div>
      )}
    </FmPanel>
  );
}
