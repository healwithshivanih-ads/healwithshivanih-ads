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
import { NewCommunicatePanel } from "./new-communicate-panel";
import { PlanStartDateBanner } from "./plan-start-date-banner";
import type { Client, WeightLossGoal } from "@/lib/fmdb/types";
import { TravelOverridesPanel } from "@/components/client-widgets/travel-overrides-panel";
import { ReworkBanner } from "@/components/client-widgets/rework-banner";
import {
  loadMealPlan,
  listSavedPhasesAction,
  type LetterType,
  type SavedPhase,
} from "@/lib/server-actions/plan-lifecycle";
// Letter-staleness banner removed 2026-05-20 (coach decision): a
// timestamp-only "plan changed → letters stale" nag added friction
// without value. The coach decides when to regenerate — the letter
// editor's 🪄 Regenerate button is always available on demand.
import { LetterGenerateTrigger } from "./letter-generate-modal";
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
  const sp = (await searchParams) ?? {};
  const intent =
    typeof sp.intent === "string" ? sp.intent : undefined;
  const vacationFrom =
    typeof sp.from === "string" ? sp.from : undefined;
  const vacationTo =
    typeof sp.to === "string" ? sp.to : undefined;
  const vacationLoc =
    typeof sp.loc === "string" ? sp.loc : undefined;

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

  // ── Saved-letter probe: check disk for each letter type so the new
  // Communicate panel can show "Drafted" status without waiting for a
  // send. Also pulls saved phase letters (per-fortnight files) so the
  // weekly menu track can flip cards to Drafted/Sent correctly.
  // Cheap: fs.stat + read on at most 5 small files + a single readdir.
  type SavedLetterMap = Partial<
    Record<LetterType, { savedAt: string }>
  >;
  const DOC_LETTER_TYPES: LetterType[] = [
    "consolidated",
    "supplement_plan",
    "lifestyle_guide",
    "exercise_plan",
    "recipes",
  ];
  let savedLetters: SavedLetterMap = {};
  let savedPhases: SavedPhase[] = [];
  // When a published plan has a newer draft sibling (coach just ran
  // an assessment and the new plan is in draft), phase letters are
  // authored against the DRAFT, not the published plan. Use the draft
  // slug for the phase scan so the Drafted pills appear correctly.
  const pendingDraftPlan = activePlan && statusOf(activePlan) === "published"
    ? plans.find(
        (p) =>
          p !== activePlan &&
          (statusOf(p) === "draft" || statusOf(p) === "ready_to_publish"),
      )
    : undefined;
  const phasePlan = pendingDraftPlan ?? activePlan;
  if (activePlan?.slug) {
    const slug = activePlan.slug as string;
    const probes = await Promise.all(
      DOC_LETTER_TYPES.map((t) => loadMealPlan(slug, id, t)),
    );
    DOC_LETTER_TYPES.forEach((t, i) => {
      const r = probes[i];
      if (r.ok && r.savedAt) savedLetters[t] = { savedAt: r.savedAt };
    });
    // Scan phase letters from the phase plan (draft if one exists, else active)
    const phaseScanSlug = (phasePlan?.slug ?? slug) as string;
    savedPhases = await listSavedPhasesAction(phaseScanSlug, id);
  }

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

  // ── Vacation-letter intent ────────────────────────────────────────
  // Coach saved a travel override AND letters already exist, so the
  // AddOverride toast routed them here with the dates encoded. Convert
  // the date range into plan-week numbers (so we can drop into the
  // existing meal_plan_phase generator without inventing a new letter
  // type). If the plan has no start date OR the dates are unparseable,
  // bail out silently — banner just doesn't render; the URL params are
  // harmless leftovers.
  const planPeriodStart =
    (activePlan?.plan_period_start as string | undefined) ??
    (activePlan?.meal_plan_started_on as string | undefined) ??
    null;
  let vacationWeek: { startWeek: number; endWeek: number } | null = null;
  if (
    intent === "vacation_letter" &&
    vacationFrom &&
    vacationTo &&
    planPeriodStart &&
    activePlan
  ) {
    try {
      const startMs = Date.parse(`${planPeriodStart}T00:00:00Z`);
      const fromMs = Date.parse(`${vacationFrom}T00:00:00Z`);
      const toMs = Date.parse(`${vacationTo}T00:00:00Z`);
      if (
        Number.isFinite(startMs) &&
        Number.isFinite(fromMs) &&
        Number.isFinite(toMs)
      ) {
        const dayMs = 86_400_000;
        const fromDay = Math.floor((fromMs - startMs) / dayMs);
        const toDay = Math.floor((toMs - startMs) / dayMs);
        const planWeeks = (activePlan.plan_period_weeks as number | undefined) ?? 12;
        const sw = Math.max(1, Math.floor(fromDay / 7) + 1);
        const ew = Math.min(planWeeks, Math.floor(toDay / 7) + 1);
        if (ew >= sw) vacationWeek = { startWeek: sw, endWeek: ew };
      }
    } catch {
      // Unparseable dates → no banner. Coach can still generate the
      // letter manually from the weekly menu.
    }
  }

  return (
    <CommunicatePageShell clientId={id}>
      {client.rework_suggestion && (
        <div style={{ marginBottom: 12 }}>
          <ReworkBanner clientId={id} suggestion={client.rework_suggestion} />
        </div>
      )}

      {vacationWeek && activePlan && (
        <div
          style={{
            marginBottom: 12,
            padding: "12px 16px",
            background: "rgba(99, 102, 241, 0.08)",
            border: "1.5px solid rgba(99, 102, 241, 0.45)",
            borderRadius: "var(--fm-radius-md)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 20 }}>🧳</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#3730a3" }}>
                Generate a vacation letter for{" "}
                {vacationLoc ?? "this travel window"}?
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "#4338ca",
                  marginTop: 2,
                  lineHeight: 1.45,
                }}
              >
                {vacationFrom} → {vacationTo} · plan weeks {vacationWeek.startWeek}
                {vacationWeek.endWeek === vacationWeek.startWeek
                  ? ""
                  : `–${vacationWeek.endWeek}`}
                . Generates a fortnight letter scoped to this window using
                the plan, the travel override, and any recent quick notes
                / WhatsApp signals from {displayName.split(" ")[0]}.
              </div>
            </div>
          </div>
          <LetterGenerateTrigger
            clientId={id}
            planSlug={activePlan.slug as string}
            mode="phase"
            label={`🧳 Generate vacation letter →`}
            tone="primary"
            phase={vacationWeek}
          />
        </div>
      )}

      {/* Letter-staleness banner removed 2026-05-20 — see import note.
          The coach regenerates a letter on demand from the letter
          editor's 🪄 Regenerate button when she decides the plan
          changed materially; no nagging notification. */}

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

      {/* ✨ NEW Communicate layout — primary surface. Driven entirely
          by real data (active plan, sendLog, saved-letter probes from
          disk, weight_loss override window, letter staleness). Coach
          tested + endorsed; legacy widgets below are temporarily
          retained for fallback only and will be deleted in Phase 5. */}
      {/* 📅 Plan start date — coach sets the client's real Day 1 here
          BEFORE generating letters, so every letter's week numbering +
          the recheck date anchor to it (not to the plan-generation date). */}
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

      <NewCommunicatePanel
        clientId={id}
        displayName={displayName}
        client={client as unknown as Client}
        activePlanSlug={activePlanInfo?.slug ?? null}
        phasePlanSlug={
          pendingDraftPlan?.slug != null
            ? (pendingDraftPlan.slug as string)
            : null
        }
        planPeriodWeeks={
          ((phasePlan?.plan_period_weeks ?? activePlan?.plan_period_weeks) as number | undefined) ?? 12
        }
        planPeriodStart={
          (phasePlan?.meal_plan_started_on as string | undefined) ??
          (phasePlan?.supplements_started_on as string | undefined) ??
          (phasePlan?.plan_period_start as string | undefined) ??
          (activePlan?.meal_plan_started_on as string | undefined) ??
          (activePlan?.supplements_started_on as string | undefined) ??
          (activePlan?.plan_period_start as string | undefined) ??
          null
        }
        sendLog={sendLog}
        savedLetters={savedLetters}
        savedPhases={savedPhases}
        slotAfterHero={
          /* ✈ Travel / festival / illness overrides — set BEFORE letter
             generation. Moved here (under the hero) 2026-05-20 so it is
             seen, not missed above the big orange CTA. Storage stays on
             client.weight_loss.week_overrides for back-compat. */
          <TravelOverridesPanel
            clientId={id}
            overrides={
              (client as unknown as { weight_loss?: WeightLossGoal })
                .weight_loss?.week_overrides ?? []
            }
            hasIssuedLetters={
              Object.keys(savedLetters).length > 0 || savedPhases.length > 0
            }
          />
        }
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
        />
      </div>

    </CommunicatePageShell>
  );
}
