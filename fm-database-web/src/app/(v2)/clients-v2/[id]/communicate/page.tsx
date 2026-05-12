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
import { FmPageHeader } from "@/components/fm";
import { CommunicatePageShell } from "./communicate-page-shell";
import { CommunicateClient } from "./communicate-client";
import { ReworkBanner } from "@/app/clients/[id]/rework-banner";
import { getLetterStalenessAction } from "@/app/plans/[slug]/lifecycle-actions";
import { RegenerateStaleButton } from "./regenerate-stale-button";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = new Set(["draft", "ready_to_publish", "published"]);

export default async function CommunicateTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [client, allPlans, aisensyConfig] = await Promise.all([
    loadClientById(id),
    loadAllPlans(),
    checkAisensyConfigAction(),
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
    </CommunicatePageShell>
  );
}
