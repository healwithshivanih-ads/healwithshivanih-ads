/**
 * /clients-v2/[id]/communicate — Communicate tab in v2.
 *
 * One hub for all client-facing comms:
 *   - 📤 Client letters (SendPackageButton — published plans only)
 *   - 💬 Quick message templates (WhatsApp via self-hosted Cloud API server)
 *   - ✉️ Email shortcut + link to legacy plan-email modal
 *   - 📞 Contact panel (email / WhatsApp deeplinks)
 *   - 📡 WhatsApp send status (configured / templates)
 *   - 📥 Recent inbound (last 30 days of WhatsApp webhook capture)
 *
 * Composes existing primitives (MessageTemplatesPanel, SendPackageButton)
 * in v2 chrome. Outbound WhatsApp sends route through the self-hosted
 * Fly app (whatsapp-server-shivani). AiSensy fully decommissioned
 * 2026-05-15.
 */
import { loadClientById, markWhatsappInboxRead } from "@/lib/fmdb/loader-extras";
import { loadAllPlans } from "@/lib/fmdb/loader";
import { checkWhatsAppConfigAction } from "@/app/api/whatsapp/actions";
import { FmPageHeader } from "@/components/fm";
import { CommunicatePageShell } from "./communicate-page-shell";
import { CommunicateClient } from "./communicate-client";
import { PlanStartDateBanner } from "./plan-start-date-banner";
import type { Client, WeightLossGoal } from "@/lib/fmdb/types";
import { TravelOverridesPanel } from "@/components/client-widgets/travel-overrides-panel";
import { WelcomeEmailCard } from "./welcome-email-card";
import { ReworkBanner } from "@/components/client-widgets/rework-banner";
// PhaseLetterPanel, FmPanel, Link, LetterSendEntry imports removed
// 2026-05-19 — they only fed the legacy `<details>` fallback block
// that's now deleted. RegenerateStaleButton stays (used by the
// top-of-page stale-letters banner that still surfaces actually-stale
// letter types).
import { loadLetterSendLogAction } from "@/app/api/email/actions";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = new Set(["draft", "ready_to_publish", "published"]);

export default async function CommunicateTabPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  // Optional intent params — sent by the AddOverride toast CTA when
  // letters are already issued and coach opts in to generate a
  // dedicated vacation letter for the just-saved travel window. We
  // surface a top-of-page banner with a LetterGenerateTrigger in phase
  // mode, scoped to the week range that covers from→to. See
  // travel-overrides-panel.tsx onSave() for the source.
  // Mark this client's WhatsApp inbox as read — coach has opened the
  // Communicate page, so the dashboard "N new WhatsApp messages" banner
  // should clear for this client on the next dashboard render. Fire-and-
  // forget; if the write fails the banner just stays. No race-condition
  // concern: state is monotonically advancing (we only ever write
  // `now`), so concurrent renders converge.
  void markWhatsappInboxRead(id);

  const [client, allPlans, whatsappConfig, sendLog] = await Promise.all([
    loadClientById(id),
    loadAllPlans(),
    checkWhatsAppConfigAction(),
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

  // Letters retired (2026-07-04) — no saved-letter probes. The welcome
  // email + the app ARE the client-facing deliverables; sendLog still
  // powers the welcome card's persisted sent-state.

  // Recent inbound was a server-side load → prop-passed list. Now the
  // child WhatsAppThreadPanel loads its own thread via server-action
  // (combines outbound + inbound, auto-refreshes), so we don't need to
  // prefetch here.
  const displayName = client.display_name ?? client.client_id;

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

      <FmPageHeader
        as="h2"
        size="md"
        title={
          <span style={{ color: "#3a4250" }}>
            💬 Communicate — {displayName.split(" ")[0]}
          </span>
        }
        subtitle="Everything that goes out (or comes in) lives here — the welcome email, WhatsApp templates, email, recent inbound. The plan itself lives in their app."
      />

      {/* 📅 Plan start date — coach sets the client's real Day 1 here; the
          app's week counter + recheck dates anchor to it. */}
      <PlanStartDateBanner
        planSlug={activePlanInfo?.slug ?? null}
        mealPlanStartedOn={
          (activePlan?.meal_plan_started_on as string | undefined) ?? null
        }
        planPeriodStart={
          (activePlan?.plan_period_start as string | undefined) ?? null
        }
        planPeriodWeeks={
          (activePlan?.plan_period_weeks as number | undefined) ?? 12
        }
      />

      {/* 📬 Welcome email — static onboarding guide (no AI). Auto-sends on
          first publish; this card backfills pre-feature clients and handles
          re-sends. Sent state persisted via _send_log (letter_types includes
          "welcome"). */}
      <WelcomeEmailCard
        clientId={id}
        planSlug={activePlanInfo?.slug ?? null}
        firstName={displayName.split(" ")[0]}
        clientEmail={clientEmail}
        lastSentAt={
          sendLog
            .filter((e) => e.letter_types.includes("welcome"))
            .map((e) => e.sent_at)
            .sort()
            .pop() ?? null
        }
      />

      {/* ✈ Travel / festival / illness overrides — feed the weekly menu +
          the app's travel mode. Storage stays on
          client.weight_loss.week_overrides for back-compat. */}
      <TravelOverridesPanel
        clientId={id}
        overrides={
          (client as unknown as { weight_loss?: WeightLossGoal })
            .weight_loss?.week_overrides ?? []
        }
        hasIssuedLetters={false}
      />

      {/* 📞💬✉ Primary comms surfaces — contact, send booking link,
          message templates, email, WhatsApp conversation thread. These
          are KEPT in the new layout (only the "Client letters" section
          is suppressed because it's replaced by the panel above). */}
      <div style={{ marginTop: 20 }}>
        <CommunicateClient
          clientId={id}
          displayName={displayName}
          clientEmail={clientEmail}
          clientPhone={clientPhone}
          activePlan={activePlanInfo}
          whatsappConfigured={whatsappConfig.configured}
          appToken={
            ((client as unknown as { app_token?: string }).app_token as string | undefined) ?? null
          }
          discoveryCallDate={(() => {
            const v = (client as unknown as { discovery_call_date?: unknown }).discovery_call_date;
            if (v instanceof Date) return v.toISOString().slice(0, 10);
            if (typeof v === "string") return v.slice(0, 10);
            return null;
          })()}
        />
      </div>

    </CommunicatePageShell>
  );
}
