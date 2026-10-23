/**
 * /clients-v2/[id]/brief — the same brief chat reads, rendered.
 *
 * One source: scripts/client-brief.py (read-only, $0). The `/client` chat
 * skill runs the identical script, so what the coach sees here and what the
 * assistant knows in chat can never disagree. Lifecycle comes from the one
 * resolver; nothing on this page re-derives who is in care.
 *
 * Six blocks, in the order a coach reads them: who · lifecycle · plan ·
 * recent · app · do not. See docs/COACH_APP_RESTRUCTURE_REVIEW.md §4D.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { runShim } from "@/lib/fmdb/shim";
import { LIFECYCLE_META, type LifecycleState } from "@/lib/fmdb/lifecycle";
import { FmAppShell, FmPanel, FmChip } from "@/components/fm";
import { HeaderAvatar } from "../analyse/header-avatar";
import { clientQuickActions } from "../client-quick-actions";
import { clientSubnavTabs } from "../client-subnav";
import { CoachNotesButton } from "@/components/client-widgets/coach-notes-launcher";

export const dynamic = "force-dynamic";

interface Brief {
  ok: boolean;
  error?: string;
  today: string;
  who: {
    client_id: string;
    name: string;
    parked: boolean;
    age: number | null;
    sex: string | null;
    city: string | null;
    diet: string | null;
    conditions: string[];
    medical_history: string[];
    medications: string[];
    allergies: string[];
    goals: string | string[] | null;
  };
  lifecycle: {
    state: LifecycleState;
    since: string | null;
    reason: string;
    engagement_status: string;
    tier: string | null;
    renewal_decision: string | null;
    next_contact_date: string | null;
    marketing_opt_out: boolean;
    declined: boolean;
    mind_body_depth: string | null;
  };
  plan: {
    slug?: string;
    is_maintenance?: boolean;
    started?: string | null;
    ends?: string | null;
    weeks?: number;
    week_now?: number | null;
    phase?: string | null;
    supplements?: string[];
    practices?: string[];
    deferred?: string[];
    menu_weeks_live?: number;
  };
  plans_in_pipeline: string[];
  recent: {
    thread: Array<{ when: string; direction: "in" | "out"; channel: string; template: string | null; text: string }>;
    last_checkin: { date: string; week: number | null; rating_of_5: number | null; in_her_words: string; slipped: string[] } | null;
    last_msq: { date: string; total: number | null } | null;
    last_coach_session: { date: string; type: string } | null;
    labs_on_file_dates: string[];
    labs_flagged: string[];
    weights: Array<[string, number]>;
    pending_sends: Array<{ kind: string; due: string; template: string | null }>;
  };
  app: {
    app_token: boolean;
    last_open: string | null;
    opens_14d: number;
    ticks_this_week: { days_logged: number; done: number; of: number } | null;
    practices: { sessions_14d: number; last: string | null; last_name: string | null } | null;
    feedback: { date: string; stage: string; recommend_0_10: number | null; biggest_change: string } | null;
  };
  do_not: {
    marketing_opt_out: boolean;
    foods_to_avoid: string[];
    reported_triggers: string[];
    non_negotiables: string[];
    anxious_client_flags: string[];
    notes: string;
  };
}

const h2: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.7,
  fontWeight: 700,
  color: "var(--fm-text-secondary)",
  margin: "0 0 8px",
};
const row: React.CSSProperties = { fontSize: 13, lineHeight: 1.5, margin: "2px 0" };
const muted: React.CSSProperties = { color: "var(--fm-text-tertiary)" };

function List({ items, empty = "none" }: { items: string[]; empty?: string }) {
  if (!items.length) return <div style={{ ...row, ...muted }}>{empty}</div>;
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {items.map((x, i) => (
        <li key={i} style={row}>
          {x}
        </li>
      ))}
    </ul>
  );
}

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await loadClientById(id);
  if (!client) notFound();
  const displayName = client.display_name ?? client.client_id;
  const tabs = clientSubnavTabs(id);

  let brief: Brief | null = null;
  let error: string | null = null;
  try {
    const out = (await runShim("client-brief.py", { client: id }, 30_000)) as Brief;
    if (out?.ok) brief = out;
    else error = out?.error ?? "brief failed";
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <FmAppShell
      activeNavId="clients"
      quickActions={clientQuickActions(id)}
      crumbs={[
        { label: "Clients", href: "/clients-v2" },
        { label: displayName, href: `/clients-v2/${id}` },
        { label: "Brief" },
      ]}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          background: "var(--fm-surface)",
          border: "1px solid var(--fm-border-light)",
          borderRadius: "var(--fm-radius-md)",
          marginBottom: 16,
        }}
      >
        <HeaderAvatar clientId={id} displayName={displayName} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>
            {displayName}
            <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)", fontFamily: "var(--fm-font-mono)", fontWeight: 500, marginLeft: 8 }}>
              {id}
            </span>
          </div>
        </div>
        <CoachNotesButton clientId={id} />
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--fm-border)", flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            style={{
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: t.id === "brief" ? 700 : 500,
              color: t.id === "brief" ? "var(--fm-text-primary)" : "var(--fm-text-tertiary)",
              borderBottom: `2px solid ${t.id === "brief" ? "var(--fm-primary)" : "transparent"}`,
              textDecoration: "none",
              marginBottom: -1,
            }}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {!brief ? (
        <FmPanel>
          <div style={{ padding: 16, fontSize: 13 }}>Could not build the brief: {error}</div>
        </FmPanel>
      ) : (
        <BriefBody b={brief} />
      )}
    </FmAppShell>
  );
}

function BriefBody({ b }: { b: Brief }) {
  const { who, lifecycle: lc, plan: p, recent: r, app: a, do_not: dn } = b;
  const meta = LIFECYCLE_META[lc.state];
  const goals = Array.isArray(who.goals) ? who.goals.join(", ") : who.goals ?? "";
  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
      <FmPanel>
        <div style={h2}>Who</div>
        <div style={row}>
          {[who.age ? `${who.age}` : null, who.sex, who.city, who.diet].filter(Boolean).join(" · ")}
          {who.parked && <FmChip tone="warning">parked in prospects/</FmChip>}
        </div>
        <div style={{ ...row, marginTop: 6 }}>
          <strong>Conditions</strong>
        </div>
        <List items={who.conditions} />
        {who.medical_history.length > 0 && (
          <>
            <div style={{ ...row, marginTop: 6 }}>
              <strong>History</strong>
            </div>
            <List items={who.medical_history} />
          </>
        )}
        <div style={{ ...row, marginTop: 6 }}>
          <strong>Medications</strong>
        </div>
        <List items={who.medications} />
        {who.allergies.length > 0 && (
          <div style={{ ...row, marginTop: 6 }}>
            <strong>Allergies:</strong> {who.allergies.join(", ")}
          </div>
        )}
        {goals && (
          <div style={{ ...row, marginTop: 6 }}>
            <strong>Goals:</strong> {goals}
          </div>
        )}
      </FmPanel>

      <FmPanel>
        <div style={h2}>Lifecycle</div>
        <div style={{ ...row, fontSize: 16, fontWeight: 700 }}>
          {meta.icon} {meta.label}
          {lc.since && <span style={{ ...muted, fontWeight: 400, fontSize: 12, marginLeft: 8 }}>since {lc.since}</span>}
        </div>
        <div style={row}>{lc.reason}</div>
        {lc.tier && <div style={row}>tier: {lc.tier}</div>}
        {lc.renewal_decision && <div style={row}>renewal decision on file: {lc.renewal_decision}</div>}
        {lc.next_contact_date && <div style={row}>next_contact_date (hand-set): {lc.next_contact_date}</div>}
        {lc.marketing_opt_out && (
          <div style={{ ...row, color: "#c0392b", fontWeight: 700 }}>marketing opt-out — reply only</div>
        )}
        {lc.declined && <div style={row}>declined the programme</div>}
        {lc.mind_body_depth && <div style={row}>mind-body depth: {lc.mind_body_depth}</div>}
        <div style={{ ...row, ...muted, marginTop: 6 }}>engagement_status as written: {lc.engagement_status || "—"}</div>

        <div style={{ ...h2, marginTop: 16 }}>Plan</div>
        {p.slug ? (
          <>
            <div style={{ ...row, fontWeight: 700 }}>
              {p.slug}
              {p.is_maintenance && <FmChip tone="success">maintenance</FmChip>}
            </div>
            <div style={row}>
              {p.week_now ? `week ${p.week_now} of ${p.weeks}` : `${p.weeks} weeks`} · started {p.started} · ends {p.ends}
              {p.phase ? ` · phase ${p.phase}` : ""}
            </div>
            <div style={{ ...row, ...muted }}>menu weeks live in the app: {p.menu_weeks_live}</div>
            <div style={{ ...row, marginTop: 6 }}>
              <strong>Supplements</strong>
            </div>
            <List items={p.supplements ?? []} />
            <div style={{ ...row, marginTop: 6 }}>
              <strong>Practices</strong>
            </div>
            <List items={p.practices ?? []} />
            {(p.deferred?.length ?? 0) > 0 && <div style={row}>deferred: {p.deferred!.join("; ")}</div>}
          </>
        ) : (
          <div style={{ ...row, ...muted }}>no plan published</div>
        )}
        {b.plans_in_pipeline.length > 0 && <div style={row}>in pipeline: {b.plans_in_pipeline.join(", ")}</div>}
      </FmPanel>

      <FmPanel>
        <div style={h2}>Recent</div>
        {r.thread.length === 0 ? (
          <div style={{ ...row, ...muted }}>thread: nothing on record</div>
        ) : (
          <div style={{ display: "grid", gap: 4 }}>
            {r.thread.map((m, i) => (
              <div key={i} style={{ ...row, display: "grid", gridTemplateColumns: "118px 1fr", gap: 8 }}>
                <span style={{ ...muted, fontFamily: "var(--fm-font-mono)", fontSize: 11 }}>
                  {m.when} {m.direction === "in" ? "←" : "→"}
                </span>
                <span>
                  {m.template && <FmChip tone="secondary">{m.template}</FmChip>} {m.text}
                </span>
              </div>
            ))}
          </div>
        )}
        {r.last_checkin && (
          <div style={{ ...row, marginTop: 8 }}>
            <strong>Last check-in</strong> {r.last_checkin.date} (week {r.last_checkin.week}) · {r.last_checkin.rating_of_5}/5 — “{r.last_checkin.in_her_words}”
            {r.last_checkin.slipped.length > 0 && <span style={muted}> · slipped: {r.last_checkin.slipped.join(", ")}</span>}
          </div>
        )}
        {r.last_msq && (
          <div style={row}>
            <strong>Last MSQ</strong> {r.last_msq.date} · total {r.last_msq.total}
          </div>
        )}
        {r.last_coach_session && (
          <div style={row}>
            <strong>Last coach session</strong> {r.last_coach_session.date} ({r.last_coach_session.type})
          </div>
        )}
        {r.labs_on_file_dates.length > 0 && (
          <div style={row}>
            <strong>Labs on file</strong> {r.labs_on_file_dates.join(", ")}
            {r.labs_flagged.length > 0 && <span style={muted}> · flagged: {r.labs_flagged.join("; ")}</span>}
          </div>
        )}
        {r.weights.length > 0 && (
          <div style={row}>
            <strong>Weight</strong> {r.weights.map(([d, kg]) => `${kg} kg (${d})`).join(" → ")}
          </div>
        )}
        {r.pending_sends.length > 0 && (
          <div style={row}>
            <strong>Queued sends</strong> {r.pending_sends.map((s) => `${s.kind} ${s.template ?? ""} due ${s.due}`).join("; ")}
          </div>
        )}
      </FmPanel>

      <FmPanel>
        <div style={h2}>App</div>
        {!a.app_token ? (
          <div style={{ ...row, ...muted }}>no app token</div>
        ) : (
          <>
            <div style={row}>
              last open {a.last_open ?? "never"} · {a.opens_14d} opens in 14d
            </div>
            {a.ticks_this_week && (
              <div style={row}>
                this week: {a.ticks_this_week.days_logged} days logged, {a.ticks_this_week.done}/{a.ticks_this_week.of} items ticked
              </div>
            )}
            {a.practices && (
              <div style={row}>
                practices: {a.practices.sessions_14d} in 14d
                {a.practices.last && ` · last ${a.practices.last} (${a.practices.last_name})`}
              </div>
            )}
            {a.feedback && (
              <div style={row}>
                feedback {a.feedback.date} ({a.feedback.stage}): recommend {a.feedback.recommend_0_10}/10 — “{a.feedback.biggest_change}”
              </div>
            )}
          </>
        )}

        <div style={{ ...h2, marginTop: 16 }}>Do not</div>
        {dn.marketing_opt_out && <div style={{ ...row, color: "#c0392b", fontWeight: 700 }}>marketing opt-out — reply only</div>}
        {dn.foods_to_avoid.length > 0 && <div style={row}>foods to avoid: {dn.foods_to_avoid.join(", ")}</div>}
        {dn.reported_triggers.length > 0 && <div style={row}>triggers: {dn.reported_triggers.join(", ")}</div>}
        {dn.non_negotiables.length > 0 && (
          <div style={row}>
            non-negotiables <span style={muted}>(coach-only)</span>: {dn.non_negotiables.join("; ")}
          </div>
        )}
        {dn.anxious_client_flags.length > 0 && <div style={row}>anxious-client flags present — prune urgency in anything client-facing</div>}
        {dn.notes && <div style={{ ...row, ...muted, whiteSpace: "pre-wrap" }}>{dn.notes}</div>}
        <div style={{ ...row, ...muted, marginTop: 10, fontSize: 11 }}>
          Same script as the <code>/client</code> chat skill (scripts/client-brief.py). Read-only.{" "}
          <Link href={`/clients-v2/${who.client_id}/catalogue`} style={{ color: "var(--fm-primary)" }}>
            Catalogue for this client →
          </Link>
        </div>
      </FmPanel>
    </div>
  );
}
