/**
 * /clients-v2/[id]/communicate — Phase 4 Communicate tab in v2.
 *
 * One hub for all client-facing comms:
 *   - 📤 Client letters (SendPackageButton — published plans only)
 *   - 💬 Quick message templates (WhatsApp via AiSensy direct API)
 *   - ✉️ Email shortcut + link to legacy plan-email modal
 *   - 📞 Contact panel (email / WhatsApp deeplinks)
 *   - 📡 AiSensy status (configured / templates)
 *   - 📥 Recent inbound (last 30 days of AiSensy webhook capture)
 *
 * Composes existing primitives (MessageTemplatesPanel, SendPackageButton)
 * in v2 chrome. Engine + AiSensy + email actions are unchanged.
 */
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { loadAllPlans } from "@/lib/fmdb/loader";
import { getRecentAisensyMessages } from "@/lib/fmdb/loader-extras";
import { checkAisensyConfigAction } from "@/app/api/aisensy-webhook/actions";
import { FmPageHeader, FmPanel } from "@/components/fm";
import { CommunicatePageShell } from "./communicate-page-shell";
import { CommunicateClient } from "./communicate-client";
import { ReworkBanner } from "@/app/clients/[id]/rework-banner";
import { getLetterStalenessAction } from "@/app/plans/[slug]/lifecycle-actions";
import { RegenerateStaleButton } from "./regenerate-stale-button";
import { PhaseLetterPanel } from "./phase-letter-panel";
import {
  loadLetterSendLogAction,
  type LetterSendEntry,
} from "@/app/api/email/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = new Set(["draft", "ready_to_publish", "published"]);

export default async function CommunicateTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [client, allPlans, aisensyConfig, sendLog] = await Promise.all([
    loadClientById(id),
    loadAllPlans(),
    checkAisensyConfigAction(),
    loadLetterSendLogAction(id),
  ]);
  if (!client) {
    return (
      <CommunicatePageShell clientId={id}>
        <div />
      </CommunicatePageShell>
    );
  }

  // Active plan (drives the letters availability). Prefer published over
  // draft when both exist — otherwise a fresh draft from a recent Full
  // Assessment masks the actually-live plan and disables letter sending.
  const plans = allPlans.filter((p) => p.client_id === id);
  const statusOf = (p: typeof plans[number]) =>
    (p.status as string | undefined) ?? (p._bucket as string | undefined) ?? "";
  const STATUS_RANK: Record<string, number> = {
    published: 3,
    ready_to_publish: 2,
    draft: 1,
  };
  const activePlan = plans
    .filter((p) => ACTIVE_STATUSES.has(statusOf(p)))
    .sort(
      (a, b) => (STATUS_RANK[statusOf(b)] ?? 0) - (STATUS_RANK[statusOf(a)] ?? 0),
    )[0];
  const activePlanInfo = activePlan
    ? {
        slug: activePlan.slug,
        status:
          (activePlan.status as string | undefined) ??
          (activePlan._bucket as string | undefined) ??
          "draft",
      }
    : null;

  // Letter staleness — same check the Plan tab runs, mirrored here so a
  // coach who deep-links straight to Communicate can't unknowingly send a
  // stale letter (plan edited after the last letter was generated).
  const staleness = activePlan
    ? await getLetterStalenessAction(activePlan.slug as string, id)
    : null;

  // Recent inbound — 30-day window (vs the dashboard's 7d). Coach wants more
  // historical context on a per-client surface than on the global dashboard.
  const displayName = client.display_name ?? client.client_id;
  const nameMap = new Map<string, string>([[id, displayName]]);
  const recentInbound = await getRecentAisensyMessages([id], nameMap, 30);

  const c = client as unknown as Record<string, unknown>;
  const clientEmail =
    typeof c.email === "string" && c.email ? (c.email as string) : undefined;
  const clientPhone =
    typeof c.mobile_number === "string" && c.mobile_number
      ? (c.mobile_number as string)
      : typeof c.mobile === "string" && c.mobile
        ? (c.mobile as string)
        : undefined;

  return (
    <CommunicatePageShell clientId={id}>
      {client.rework_suggestion && (
        <div style={{ marginBottom: 12 }}>
          <ReworkBanner clientId={id} suggestion={client.rework_suggestion} />
        </div>
      )}

      {staleness?.anyStale && activePlan && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 14px",
            background: "rgba(245, 158, 11, 0.08)",
            border: "1.5px solid rgba(245, 158, 11, 0.55)",
            borderRadius: "var(--fm-radius-md)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 16 }}>📄</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#92400e" }}>
                Letters are stale — plan edited after{" "}
                {staleness.staleCount === 1
                  ? "1 saved letter was generated"
                  : `${staleness.staleCount} saved letters were generated`}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#78350f",
                  marginTop: 2,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                }}
              >
                {staleness.entries
                  .filter((e) => e.stale)
                  .map((e) => (
                    <span
                      key={e.type}
                      style={{
                        padding: "1px 6px",
                        background: "rgba(245, 158, 11, 0.15)",
                        borderRadius: 4,
                        fontFamily: "var(--fm-font-mono)",
                      }}
                    >
                      {e.type.replace(/_/g, " ")}
                    </span>
                  ))}
              </div>
            </div>
          </div>
          <RegenerateStaleButton
            planSlug={activePlan.slug as string}
            clientId={id}
            staleTypes={staleness.entries
              .filter((e) => e.stale)
              .map((e) => e.type)}
          />
        </div>
      )}

      <FmPageHeader
        as="h2"
        size="md"
        title={
          <span style={{ color: "#3a4250" }}>
            💬 Communicate — {displayName.split(" ")[0]}
          </span>
        }
        subtitle="Everything that goes out (or comes in) lives here — letters, WhatsApp templates, email, recent inbound. One surface after every session."
      />

      {/* Phase / continuation meal-plan letters — moved to the TOP of
          the page (per coach request). This is the most common
          mid-cycle action; SendPackageButton (full letter package)
          and message templates live below. */}
      {activePlan && activePlanInfo?.status === "published" && (
        <div style={{ marginTop: 16, marginBottom: 16 }}>
          <PhaseLetterPanel
            clientId={id}
            planSlug={activePlan.slug as string}
            planPeriodWeeks={
              (activePlan.plan_period_weeks as number | undefined) ?? 12
            }
            planPeriodStart={
              activePlan.plan_period_start as string | undefined
            }
          />
        </div>
      )}

      <CommunicateClient
        clientId={id}
        displayName={displayName}
        clientEmail={clientEmail}
        clientPhone={clientPhone}
        activePlan={activePlanInfo}
        aisensyConfigured={aisensyConfig.configured}
        recentInbound={recentInbound.map((m) => ({
          date: m.date,
          text: m.text,
        }))}
      />

      {/* Letter send history — single source of truth for "what went
          out + when". Click any row to open the actual letter that
          was sent in the v2 letter editor. */}
      {sendLog.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <FmPanel
            title="📤 Letter send history"
            subtitle="Every email that's gone out to this client. Click any row to open the letter that was sent."
          >
            <div style={{ display: "grid", gap: 6 }}>
              {sendLog.slice(0, 20).map((e: LetterSendEntry, i) => {
                const dt = new Date(e.sent_at);
                const sentLabel = Number.isNaN(dt.getTime())
                  ? e.sent_at
                  : dt.toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                const primaryType = e.letter_types[0] ?? "consolidated";
                const openHref = `/clients-v2/${id}/letter-editor?plan=${e.plan_slug}&type=${primaryType}`;
                return (
                  <Link
                    key={`${e.sent_at}-${i}`}
                    href={openHref}
                    style={{
                      fontSize: 11,
                      padding: "7px 10px",
                      borderLeft: "3px solid var(--fm-primary)",
                      background: "var(--fm-bg-warm)",
                      borderRadius:
                        "0 var(--fm-radius-sm) var(--fm-radius-sm) 0",
                      textDecoration: "none",
                      color: "inherit",
                      display: "block",
                      transition: "background 0.15s",
                    }}
                    className="fm-comm-log-row"
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        alignItems: "baseline",
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          color: "var(--fm-text-primary)",
                        }}
                      >
                        ✉ {sentLabel}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--fm-text-tertiary)",
                          fontFamily: "var(--fm-font-mono)",
                        }}
                      >
                        {e.plan_slug}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 10.5,
                        color: "var(--fm-text-secondary)",
                        marginTop: 2,
                      }}
                    >
                      To {e.to}
                      {e.cc && (
                        <span style={{ color: "var(--fm-text-tertiary)" }}>
                          {" "}· cc {e.cc}
                        </span>
                      )}
                    </div>
                    {e.letter_types.length > 0 && (
                      <div
                        style={{
                          marginTop: 4,
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 3,
                          alignItems: "center",
                        }}
                      >
                        {e.letter_types.map((t) => (
                          <span
                            key={t}
                            style={{
                              fontSize: 9.5,
                              padding: "1px 6px",
                              background: "rgba(255, 107, 53, 0.10)",
                              color: "var(--fm-primary)",
                              borderRadius: "var(--fm-radius-pill)",
                              fontWeight: 600,
                            }}
                          >
                            {t.replace(/_/g, " ")}
                          </span>
                        ))}
                        <span
                          style={{
                            fontSize: 10,
                            color: "var(--fm-text-secondary)",
                            marginLeft: "auto",
                            fontWeight: 600,
                          }}
                        >
                          Open letter →
                        </span>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </FmPanel>
        </div>
      )}
    </CommunicatePageShell>
  );
}
