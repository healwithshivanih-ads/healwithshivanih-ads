/**
 * /dashboard-v2 — the decisions inbox.
 *
 * Rebuilt 2026-10-23 (docs/COACH_APP_RESTRUCTURE_REVIEW.md). The old page ran
 * 13 triage buckets and 16 independent "due" clocks over 18 panels, none of
 * which read the others, so a lapsed client could sit in nine places at once
 * and a maintenance client was offered a coaching booking link. Everything on
 * this page now comes from two things:
 *
 *   1. `resolveLifecycles()` — one state per person (lib/fmdb/lifecycle.ts).
 *   2. `collectDecisions()` — the rules for what is a decision TODAY, each with
 *      the lifecycle states it applies to and the age at which it drops off
 *      (lib/fmdb/decisions.ts).
 *
 * The panels below are the same approve/edit surfaces as before; they are just
 * fed rows that passed those rules. There is deliberately NO session-chasing
 * here (no booking links to send, no check-in nudges, no review nudges, no
 * start-date reminders, no polls, no broadcast) — the coach does not chase
 * clients (decision 2026-10-23). Booking a session stays a coach-initiated
 * action from the header button.
 *
 * Roster-level views (practice overview, MSQ rollup, app links, menu pause
 * roster, catalogue guardrails) moved to /practice.
 */
import Link from "next/link";
import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import {
  loadClientSessions,
  getRecentInboundMessages,
  getStrandedIntakeDrafts,
  getClientHealthSignals,
  getClientUnreadCounts,
  loadUpcomingBookings,
  loadRecentCancellations,
} from "@/lib/fmdb/loader-extras";
import { resolveLifecycles, LIFECYCLE_META, type Lifecycle } from "@/lib/fmdb/lifecycle";
import { collectDecisions, KIND_META, KIND_ORDER, type DecisionItem, type DiaryLike } from "@/lib/fmdb/decisions";
import { entryReadState, parseDiaryConfig } from "@/lib/fmdb/food-diary";
import { loadDiary, readDiarySummary } from "@/lib/fmdb/food-diary-store";
import { loadDecisions as loadRenewalDecisions } from "@/lib/fmdb/renewal-queue";
import { getArchiveCandidates } from "@/lib/fmdb/archive-candidates";
import { loadProgrammeFeedback } from "@/lib/fmdb/programme-feedback-loader";
import { loadHeldMonthlyCards } from "@/lib/fmdb/monthly-cards-store";
import { listOpenRenewalsAction } from "@/lib/server-actions/renewals";
import { listRenewalLettersAction } from "@/lib/server-actions/renewal-letters";
import { listWinbackDraftsAction, listWinbackScheduledAction } from "@/lib/server-actions/winback-drip";
import { loadDiscoveryFollowupAction } from "@/lib/server-actions/discovery-followup";
import { loadInterestedPeopleAction } from "@/lib/server-actions/interest-tracking";
import { listDeferredItemsAction } from "@/lib/server-actions/deferred-items";
import { BookSessionButton } from "@/components/client-widgets/book-session-modal";
import { RenewalQueuePanel } from "@/components/renewal-queue-panel";
import { ProgrammeFeedbackPanel } from "@/components/programme-feedback-panel";
import { MonthlyCardReviewPanel } from "@/components/monthly-card-review-panel";
import { WinbackDripPanel } from "@/components/winback-drip-panel";
import { DiscoveryFollowupPanel } from "@/components/discovery-followup-panel";
import { InterestedPeoplePanel } from "@/components/interested-people-panel";
import { WeeklyMenuQueuePanel } from "@/components/weekly-menu-queue-panel";
import { DeferredPlanItemsPanel } from "@/components/deferred-plan-items-panel";
import { ArchiveCandidatesPanel } from "@/components/archive-candidates-panel";
import {
  FmAppShell,
  FmPageHeader,
  FmPanel,
  FmChip,
  FmAlertGroup,
  FmRosterReviewChip,
  FmMaintenanceBlurChip,
  FmInboundMessagesBanner,
  FmStrandedIntakeBanner,
  FmUpcomingBookingsPanel,
  FmCancellationAlertBanner,
} from "@/components/fm";
import type { ClientSession } from "@/lib/fmdb/loader-extras";

export const dynamic = "force-dynamic";

interface ClientRow {
  client_id: string;
  display_name?: string;
  mobile_number?: string;
  email?: string;
  engagement_status?: string;
  intake_submitted_at?: string | null;
  archived?: boolean;
}

/** A coach intake session exists: the explicit tag, the structured field, or a
 *  completed AI synthesis. Lifted from the old computeSignal unchanged. */
function hasCoachIntake(sessions: ClientSession[]): boolean {
  return sessions.some((s) => {
    const so = s as unknown as Record<string, unknown>;
    const pc = String(so.presenting_complaints ?? "");
    if (/\[session_type:\s*(intake|full_assessment)\]/i.test(pc)) return true;
    const st = String(so.session_type ?? "").toLowerCase();
    if (st === "intake" || st === "full_assessment") return true;
    const ai = so.ai_analysis as Record<string, unknown> | undefined;
    const drivers = ai?.likely_drivers;
    return Array.isArray(drivers) && drivers.length > 0;
  });
}

export default async function DashboardV2() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [allClientsLoaded, plans] = await Promise.all([loadAllClients(), loadAllPlans()]);

  const isArchived = (c: unknown) => (c as { archived?: boolean }).archived === true;
  const archivedCount = allClientsLoaded.filter(isArchived).length;
  const clients = allClientsLoaded.filter((c) => !isArchived(c)) as unknown as ClientRow[];
  const nameOf = (id: string) => clients.find((c) => c.client_id === id)?.display_name ?? id;
  const clientNameMap = new Map(clients.map((c) => [c.client_id, c.display_name ?? c.client_id]));

  // ── 1. lifecycle, once ───────────────────────────────────────────────────
  const lifecycle = resolveLifecycles(
    clients as Parameters<typeof resolveLifecycles>[0],
    plans as unknown as Parameters<typeof resolveLifecycles>[1],
    todayStr,
    { decisions: loadRenewalDecisions() },
  );
  const plansByClient = new Map<string, typeof plans>();
  for (const p of plans) {
    const cid = (p as { client_id?: string }).client_id;
    if (!cid) continue;
    if (!plansByClient.has(cid)) plansByClient.set(cid, []);
    plansByClient.get(cid)!.push(p);
  }
  const inCareIds = clients
    .filter((c) => ["active", "ending", "maintenance", "onboarding"].includes(lifecycle.get(c.client_id)?.state ?? ""))
    .map((c) => c.client_id);

  // ── 2. the loaders the panels already use ────────────────────────────────
  const [
    inboundMessages,
    unreadMap,
    renewalRows,
    renewalLetters,
    winbackDrafts,
    winbackScheduled,
    discoveryFollowup,
    interestedPeople,
    programmeFeedback,
    heldMonthlyCards,
    deferredRes,
    strandedIntakeDrafts,
    healthSignals,
    archiveCandidatesRaw,
    upcomingBookings,
    recentCancellations,
  ] = await Promise.all([
    getRecentInboundMessages(clients.map((c) => c.client_id), clientNameMap, 7),
    getClientUnreadCounts(clients as unknown as Array<Record<string, unknown>>, {}),
    listOpenRenewalsAction(),
    listRenewalLettersAction(),
    listWinbackDraftsAction(),
    listWinbackScheduledAction(),
    loadDiscoveryFollowupAction(),
    loadInterestedPeopleAction().catch(() => ({ rows: [], libraryLive: 0, contentCheckedAt: null })),
    loadProgrammeFeedback(
      clients as unknown as Parameters<typeof loadProgrammeFeedback>[0],
      plansByClient as unknown as Parameters<typeof loadProgrammeFeedback>[1],
      todayStr,
    ),
    loadHeldMonthlyCards(),
    listDeferredItemsAction(),
    getStrandedIntakeDrafts(clients as unknown as Array<Record<string, unknown>>, 5),
    // Plateau / regression only matter for people in care; dormancy is not a
    // decision any more (nobody is chased for being quiet).
    getClientHealthSignals(inCareIds, { plateauThresholdKg: 0.3, plateauMinReadings: 3, regressedThresholdKg: 1.0 }),
    getArchiveCandidates(
      clients as unknown as Parameters<typeof getArchiveCandidates>[0],
      plansByClient as unknown as Parameters<typeof getArchiveCandidates>[1],
      todayStr,
    ),
    loadUpcomingBookings(clientNameMap),
    loadRecentCancellations(clientNameMap),
  ]);
  const deferredItems = deferredRes.ok ? deferredRes.rows : [];

  // ── 3. onboarding steps (signed up, something missing) ───────────────────
  const onboardingStep = new Map<string, { why: string; href: string; sinceYmd: string | null }>();
  await Promise.all(
    clients.map(async (c) => {
      const l = lifecycle.get(c.client_id);
      if (l?.state !== "onboarding") return;
      const sessions = await loadClientSessions(c.client_id);
      const intakeDone = hasCoachIntake(sessions);
      const myPlans = plansByClient.get(c.client_id) ?? [];
      const draft = myPlans.find((p) => ["draft", "ready_to_publish"].includes(String(p._bucket ?? p.status)));
      const published = myPlans.find((p) => String(p._bucket ?? p.status) === "published");
      let why: string;
      let href = `/clients-v2/${c.client_id}`;
      if (published) {
        why = l.reason; // "plan … starts <date>"
        href = `/clients-v2/${c.client_id}/plan`;
      } else if (!intakeDone) {
        why = c.intake_submitted_at
          ? "client submitted the intake form — run the intake session"
          : "signed up — run the intake session";
        href = `/clients-v2/${c.client_id}/analyse/intake`;
      } else if (draft) {
        why =
          String(draft._bucket ?? draft.status) === "ready_to_publish"
            ? "plan is ready — activate it"
            : "finish the draft plan and activate it";
        href = `/clients-v2/${c.client_id}/plan/edit/${draft.slug}`;
      } else {
        why = "intake done — build the plan";
        href = `/clients-v2/${c.client_id}/analyse`;
      }
      onboardingStep.set(c.client_id, { why, href, sinceYmd: l.since });
    }),
  );

  // ── 3b. food diaries the coach started (any phase — the rule decides) ────
  const diaries: DiaryLike[] = [];
  for (const c of clients) {
    const cfg = parseDiaryConfig((c as unknown as { food_diary?: unknown }).food_diary);
    if (!cfg) continue;
    const entries = loadDiary(c.client_id, cfg).entries;
    diaries.push({
      client_id: c.client_id,
      display_name: c.display_name ?? c.client_id,
      config: cfg,
      photos: entries.length,
      unreadable: entries.filter((e) => entryReadState(e) === "unreadable").length,
      summaryLine: readDiarySummary(c.client_id, cfg.id)?.line ?? null,
    });
  }

  // ── 4. the decisions ─────────────────────────────────────────────────────
  const repliedTo = new Set<string>();
  unreadMap.forEach((v, k) => {
    if (v.whatsapp === 0) repliedTo.add(k);
  });
  const decisions = collectDecisions({
    todayYmd: todayStr,
    lifecycle,
    nameOf,
    inbound: inboundMessages,
    repliedTo,
    renewals: renewalRows,
    followupDrafts: discoveryFollowup.drafts,
    followupScheduled: discoveryFollowup.scheduled,
    followupUnanchored: discoveryFollowup.unanchored,
    winbackDrafts,
    winbackScheduled,
    notes: interestedPeople.rows,
    plateaued: healthSignals.plateaued,
    regressed: healthSignals.regressed,
    feedback: programmeFeedback.rows.map((r) => ({
      client_id: r.clientId,
      display_name: r.clientName,
      stage: r.stage,
      answered_on: r.date,
    })),
    archiveCandidates: archiveCandidatesRaw,
    diaries,
    onboardingStep,
  });
  const f = decisions.filtered;
  const unansweredIds = new Set(decisions.items.filter((i) => i.kind === "message").map((i) => i.clientId));
  const inboundToShow = inboundMessages.filter((m) => unansweredIds.has(m.client_id));
  // Only people with a drafted note are a decision; the full interests list
  // lives on /practice.
  const interestedRows = interestedPeople.rows.filter((r) => f.noteClientIds.has(r.clientId) && r.pendingNote);
  const onboardingItems = decisions.items.filter((i) => i.kind === "onboarding");
  const flagItems = decisions.items.filter((i) => i.kind === "flag");
  const diaryItems = decisions.items.filter((i) => i.kind === "diary" || i.kind === "diary_photo");

  // Lifecycle roll-up for the header line.
  const stateCounts = new Map<string, number>();
  for (const l of lifecycle.values()) stateCounts.set(l.state, (stateCounts.get(l.state) ?? 0) + 1);

  const dateLabel = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const n = decisions.counts.total;

  return (
    <FmAppShell activeNavId="dashboard" crumbs={[{ label: "Dashboard" }]}>
      <FmPageHeader
        title={n === 0 ? "Nothing waiting on you" : `${n} decision${n === 1 ? "" : "s"} today`}
        subtitle={`${dateLabel}. ${KIND_ORDER.filter((k) => decisions.counts.byKind[k] > 0)
          .map((k) => `${decisions.counts.byKind[k]} ${KIND_META[k].label.toLowerCase()}`)
          .join(" · ")}`}
        rightSlot={
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
            <BookSessionButton
              allClients={clients.map((c) => ({
                client_id: c.client_id,
                display_name: c.display_name,
                email: c.email,
                mobile_number: c.mobile_number,
              }))}
              label="📅 Book a session"
              variant="header"
            />
            <RosterLine counts={stateCounts} archived={archivedCount} />
          </div>
        }
      />

      {/* Today's calendar — not decisions, but what the day looks like. */}
      <FmCancellationAlertBanner cancellations={recentCancellations} />
      <FmUpcomingBookingsPanel rows={upcomingBookings} webhookConfigured />

      {/* 💬 Messages — someone wrote and has not heard back (≤7 days). */}
      {inboundToShow.length > 0 && (
        <section id="messages">
          <SectionLabel kind="message" count={decisions.counts.byKind.message} />
          <FmInboundMessagesBanner messages={inboundToShow} windowDays={7} inboxHref="/messages" />
        </section>
      )}

      {/* ✅ Approvals — things the automations drafted and are holding. */}
      <WeeklyMenuQueuePanel names={Object.fromEntries(clientNameMap)} />
      <MonthlyCardReviewPanel held={heldMonthlyCards} />
      <DeferredPlanItemsPanel initialRows={deferredItems} />

      {/* 📩 Renewal decisions — ending state only. */}
      {f.renewals.length > 0 && (
        <section id="renewals">
          <SectionLabel kind="renewal" count={decisions.counts.byKind.renewal} />
          <RenewalQueuePanel rows={f.renewals as typeof renewalRows} letters={renewalLetters} />
        </section>
      )}

      {/* 🌱 Onboarding — paid, something missing. */}
      {onboardingItems.length > 0 && (
        <section id="onboarding">
          <SectionLabel kind="onboarding" count={onboardingItems.length} />
          <ItemList items={onboardingItems} />
        </section>
      )}

      {/* 🌿 Call follow-ups — prospects inside the 30-day sequence. */}
      {(f.followupDrafts.length > 0 || f.followupScheduled.length > 0 || f.followupUnanchored.length > 0 || discoveryFollowup.unplacedTriage.length > 0) && (
        <section id="followups">
          <SectionLabel kind="followup" count={decisions.counts.byKind.followup} />
          <DiscoveryFollowupPanel
            drafts={f.followupDrafts as typeof discoveryFollowup.drafts}
            scheduled={f.followupScheduled as typeof discoveryFollowup.scheduled}
            unanchored={f.followupUnanchored as typeof discoveryFollowup.unanchored}
            unplacedTriage={discoveryFollowup.unplacedTriage}
          />
        </section>
      )}

      {/* ✉️ Win-back — lapsed clients inside the 56-day drip. */}
      {(f.winbackDrafts.length > 0 || f.winbackScheduled.length > 0) && (
        <section id="winback">
          <SectionLabel kind="winback" count={decisions.counts.byKind.winback} />
          <WinbackDripPanel
            drafts={f.winbackDrafts as typeof winbackDrafts}
            scheduled={f.winbackScheduled as typeof winbackScheduled}
          />
        </section>
      )}

      {/* 💡 Thought of you — a drafted note waiting for approval. */}
      {interestedRows.length > 0 && (
        <section id="interested">
          <SectionLabel kind="note" count={decisions.counts.byKind.note} />
          <InterestedPeoplePanel rows={interestedRows} contentCheckedAt={interestedPeople.contentCheckedAt} />
        </section>
      )}

      {/* 🔔 Flags — plateau / regression for people in care, ≤14 days old. */}
      {flagItems.length > 0 && (
        <section id="flags">
          <SectionLabel kind="flag" count={flagItems.length} />
          <ItemList items={flagItems} />
        </section>
      )}

      {/* ⭐ Feedback — responses only. Nobody is asked from here any more. */}
      {programmeFeedback.rows.length > 0 && (
        <section id="feedback">
          <SectionLabel kind="feedback" count={decisions.counts.byKind.feedback} />
          <ProgrammeFeedbackPanel data={{ ...programmeFeedback, asks: [] }} />
        </section>
      )}

      {/* 🍽 Food diaries — one you started has finished; open it to look. */}
      {diaryItems.length > 0 && (
        <section id="diaries">
          <SectionLabel kind="diary" count={diaryItems.length} />
          <ItemList items={diaryItems} />
        </section>
      )}

      {/* 📝 Stranded intake drafts — answers typed, never submitted. */}
      <FmStrandedIntakeBanner drafts={strandedIntakeDrafts} />

      {/* 🗄 Archive — prospects quiet > 45d, lapsed quiet > 70d. */}
      {f.archiveCandidates.length > 0 && (
        <section id="archive">
          <SectionLabel kind="archive" count={decisions.counts.byKind.archive} />
          <ArchiveCandidatesPanel candidates={f.archiveCandidates as typeof archiveCandidatesRaw} />
        </section>
      )}

      {/* Roster-accuracy guardrails — self-loading, hide when clean. */}
      <FmAlertGroup id="dashboard.roster" tier="fyi" icon="🧾" label="Roster checks" defaultCollapsed>
        <FmRosterReviewChip />
        <FmMaintenanceBlurChip />
      </FmAlertGroup>

      {n === 0 && (
        <FmPanel>
          <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--fm-text-secondary)" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🌿</div>
            <div style={{ fontSize: 14 }}>
              Nothing needs a decision today. Roster-level views are on the{" "}
              <Link href="/practice" style={{ color: "var(--fm-primary)" }}>
                Practice page
              </Link>
              .
            </div>
          </div>
        </FmPanel>
      )}
    </FmAppShell>
  );
}

function SectionLabel({ kind, count }: { kind: keyof typeof KIND_META; count: number }) {
  const m = KIND_META[kind];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        margin: "22px 0 8px",
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: 0.7,
        fontWeight: 700,
        color: "var(--fm-text-secondary)",
      }}
    >
      <span>
        {m.icon} {m.label}
      </span>
      {count > 0 && <FmChip tone="primary">{count}</FmChip>}
      <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--fm-text-tertiary)" }}>
        {m.blurb}
      </span>
    </div>
  );
}

function ItemList({ items }: { items: DecisionItem[] }) {
  return (
    <FmPanel style={{ padding: "6px 0" }}>
      {items.map((it) => (
        <Link
          key={`${it.kind}:${it.clientId}:${it.why}`}
          href={it.href}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(140px, 1fr) 3fr auto",
            gap: 12,
            alignItems: "center",
            padding: "9px 14px",
            textDecoration: "none",
            color: "inherit",
            borderBottom: "1px solid var(--fm-border-light)",
            fontSize: 13,
          }}
        >
          <span style={{ fontWeight: 700 }}>{it.name}</span>
          <span style={{ color: "var(--fm-text-secondary)" }}>{it.why}</span>
          <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)", whiteSpace: "nowrap" }}>
            {LIFECYCLE_META[it.state].icon} {LIFECYCLE_META[it.state].label}
            {it.ageDays > 0 ? ` · ${it.ageDays}d` : ""}
          </span>
        </Link>
      ))}
    </FmPanel>
  );
}

function RosterLine({ counts, archived }: { counts: Map<string, number>; archived: number }) {
  const order: Array<Lifecycle["state"]> = ["active", "ending", "maintenance", "onboarding", "prospect", "lapsed"];
  return (
    <Link
      href="/clients-v2"
      style={{ fontSize: 12, color: "var(--fm-text-secondary)", textDecoration: "none", display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}
      title="Open the roster"
    >
      {order
        .filter((s) => (counts.get(s) ?? 0) > 0)
        .map((s) => (
          <span key={s}>
            {LIFECYCLE_META[s].icon} {counts.get(s)} {LIFECYCLE_META[s].label.toLowerCase()}
          </span>
        ))}
      {archived > 0 && <span style={{ color: "var(--fm-text-tertiary)" }}>🗄 {archived} archived</span>}
    </Link>
  );
}
