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

  // Active plan (drives the letters availability)
  const plans = allPlans.filter((p) => p.client_id === id);
  const activePlan = plans.find((p) =>
    ACTIVE_STATUSES.has(
      (p.status as string | undefined) ?? (p._bucket as string | undefined) ?? "",
    ),
  );
  const activePlanInfo = activePlan
    ? {
        slug: activePlan.slug,
        status:
          (activePlan.status as string | undefined) ??
          (activePlan._bucket as string | undefined) ??
          "draft",
      }
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
