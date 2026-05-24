"use client";

/**
 * WeeklyPollPanel — dashboard-side widget for the weekly WhatsApp check-in.
 *
 * Two collapsibles in one panel:
 *
 *   1. "📣 Send weekly check-in poll"
 *      Coach clicks → calls sendWeeklyPollAction([]) which auto-selects
 *      all clients with a published plan + mobile number on file. Shows
 *      sent / skipped / failed breakdown. Audit log written to
 *      ~/fm-plans/_weekly_poll_log.yaml by the action.
 *
 *   2. "🚨 Adherence drops (last 28 days)"
 *      Calls detectAdherenceDropsAction() and lists any client whose poll
 *      replies tripped the 3-strike rule (2+ "struggling" OR 3+ "partial").
 *      Each flagged client has a "🔁 Run rework" button that fires
 *      runReworkSuggestionAction(clientId) — same code path the rework
 *      banner on the client page uses.
 *
 * Both panels short-circuit when WHATSAPP_SERVER_URL isn't set — caller
 * passes `whatsappConfigured`. We don't import the env var directly because
 * this component is "use client" and process.env doesn't carry to the
 * browser.
 */

import { useState } from "react";
import { FmPanel, FmChip } from "@/components/fm";
import { relativeTimeShort } from "@/lib/fmdb/session-utils";

interface SendResult {
  ok: boolean;
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
  sent_to: string[];
}

interface AdherenceFlag {
  client_id: string;
  display_name?: string;
  strikes: number;
  dimensions_flagged: string[];
  last_response_at?: string;
}

interface PollClient {
  client_id: string;
  display_name?: string;
  mobile_number?: string;
}

interface Props {
  whatsappConfigured: boolean;
  /** Clients eligible for polling — must have a published plan + mobile.
   *  Filtered server-side; we render all of them pre-checked and let coach
   *  untick anyone they don't want included in THIS poll send (e.g. a
   *  client travelling, or someone who specifically asked not to be polled
   *  this week). Selection is per-send, not persistent. */
  pollClients?: PollClient[];
  /** Most-recent send timestamp per campaign name. Derived server-side
   *  from `_weekly_poll_log.yaml` (append-only log written by the action).
   *  Drives the persisted "✓ Sent X ago · Resend" state on each variant
   *  chip so coach reload-survives the send history. (Durable rule:
   *  feedback_send_buttons_persist_state 2026-05-23.) */
  lastSentByCampaign?: Record<string, string>;
}

/** All 4 weekly poll variants. Each is an APPROVED Meta UTILITY template
 *  on the WABA (verified 2026-05-16) with the same 1-param + 3-button
 *  shape: name + 3 quick-reply buttons. Bodies differ only in which
 *  dimension they're asking about. */
const POLL_VARIANTS: { key: string; campaign: string; label: string; emoji: string; buttons: string[]; body: string }[] = [
  {
    // Tier 1 rotating Five Pillars poll (added 2026-05-24). Each client
    // gets the next pillar in their personal rotation (sleep → stress →
    // movement → nutrition → connection → sleep ...). Triggers
    // sendPillarRotationAction, NOT sendWeeklyPollAction. Recommended
    // weekly send — over 5 weeks every client has a fresh Five Pillars
    // snapshot from button taps alone.
    key: "rotation",
    campaign: "fm_pillar_rotation_v1",
    label: "Five Pillars (rotating)",
    emoji: "🔄",
    buttons: ["sleep / stress / movement / nutrition / connection"],
    body: "Next pillar per client — sends one of fm_weekly_{sleep,stress,movement,meals,connection}_v1",
  },
  {
    key: "overall",
    campaign: "fm_weekly_check_in_v1",
    label: "Overall check-in",
    emoji: "🌿",
    buttons: ["All good", "Some struggles", "Need help"],
    body: "How are you doing overall this week?",
  },
  {
    key: "supplement",
    campaign: "fm_weekly_supplement_v1",
    label: "Supplements",
    emoji: "💊",
    buttons: ["All taken", "Missed 1–2 days", "Stopped"],
    body: "How are the supplements going?",
  },
  {
    key: "meals",
    campaign: "fm_weekly_meals_v1",
    label: "Meals",
    emoji: "🍽",
    buttons: ["Yes mostly", "Half the time", "Struggling"],
    body: "Sticking to the meal plan?",
  },
  {
    key: "movement",
    campaign: "fm_weekly_movement_v1",
    label: "Movement",
    emoji: "🏃",
    buttons: ["Most days", "A few times", "None"],
    body: "Movement this week?",
  },
];

export function WeeklyPollPanel({
  whatsappConfigured,
  pollClients = [],
  lastSentByCampaign = {},
}: Props) {
  const [variantKey, setVariantKey] = useState(POLL_VARIANTS[0].key);
  const variant = POLL_VARIANTS.find((v) => v.key === variantKey) ?? POLL_VARIANTS[0];
  // Persisted-send state for the CURRENTLY-selected variant
  const variantLastSent = lastSentByCampaign[variant.campaign] ?? null;
  const variantLastSentAgo = variantLastSent ? relativeTimeShort(variantLastSent) : "";

  // Selected recipients — pre-checked from props, freely editable per send.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(pollClients.map((c) => c.client_id)),
  );
  const toggleClient = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const selectedCount = selectedIds.size;

  const [sendLoading, setSendLoading] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const [scanLoading, setScanLoading] = useState(false);
  const [flags, setFlags] = useState<AdherenceFlag[] | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const [reworkingId, setReworkingId] = useState<string | null>(null);
  const [reworkErrors, setReworkErrors] = useState<Record<string, string>>({});
  const [reworkDone, setReworkDone] = useState<Record<string, boolean>>({});

  async function handleSend() {
    if (selectedCount === 0) {
      setSendError("Select at least one recipient");
      return;
    }
    // Persistence-aware resend gate (durable rule 2026-05-23). When the
    // currently-selected campaign was already sent recently, the confirm
    // prompt names the elapsed time so coach can't double-send by
    // muscle-memory.
    const recipients = `${selectedCount} client${selectedCount !== 1 ? "s" : ""}`;
    const resendNote = variantLastSent
      ? `\n\n⚠ This ${variant.label} poll was last sent ${variantLastSentAgo}. ` +
        `Are you sure you want to resend NOW?`
      : "";
    if (
      !confirm(
        `Send the ${variant.label} poll to ${recipients}?${resendNote}`,
      )
    )
      return;
    setSendLoading(true);
    setSendError(null);
    setSendResult(null);
    try {
      // Tier 1 rotation has its own server action — picks next pillar per
      // client based on lastTemplateSent scan. The other 4 variants stay
      // on the legacy single-template path.
      if (variant.campaign === "fm_pillar_rotation_v1") {
        const { sendPillarRotationAction } = await import(
          "@/lib/server-actions/weekly-poll"
        );
        const r = await sendPillarRotationAction(Array.from(selectedIds));
        // Shape-adapt to SendResult for the existing render path.
        setSendResult({
          ok: r.ok,
          sent: r.sent,
          skipped: r.skipped,
          failed: r.failed,
          errors: r.outcomes
            .filter((o) => !o.ok)
            .map(
              (o) =>
                `${o.client_id}: ${o.skipped_reason ?? o.error ?? "failed"}`,
            ),
          sent_to: r.outcomes.filter((o) => o.ok).map((o) => o.client_id),
        });
      } else {
        const { sendWeeklyPollAction } = await import(
          "@/lib/server-actions/weekly-poll"
        );
        const r = await sendWeeklyPollAction(
          Array.from(selectedIds),
          variant.campaign,
        );
        setSendResult(r);
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSendLoading(false);
    }
  }

  async function handleScan() {
    setScanLoading(true);
    setScanError(null);
    setFlags(null);
    try {
      const { detectAdherenceDropsAction } = await import(
        "@/lib/server-actions/weekly-poll"
      );
      const r = await detectAdherenceDropsAction(28);
      if (!r.ok) {
        setScanError(r.error);
      } else {
        setFlags(r.flags);
      }
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Failed");
    } finally {
      setScanLoading(false);
    }
  }

  async function handleRework(clientId: string) {
    setReworkingId(clientId);
    setReworkErrors((p) => ({ ...p, [clientId]: "" }));
    try {
      const { assessReworkBenefitAction } = await import(
        "@/lib/server-actions/clients"
      );
      const r = await assessReworkBenefitAction({
        clientId,
        // 'quick_note' is the closest existing trigger enum — poll responses
        // are stored as quick_note sessions tagged [source: weekly_check_in_poll].
        triggeredBy: "quick_note",
        eventSummary:
          "Weekly check-in poll: 3-strike adherence drop detected. Review whether the protocol is too demanding or the wrong fit and propose simplification or substitution.",
      });
      if (!r.ok) {
        setReworkErrors((p) => ({ ...p, [clientId]: r.error || "Rework failed" }));
      } else {
        setReworkDone((p) => ({ ...p, [clientId]: true }));
      }
    } catch (e) {
      setReworkErrors((p) => ({
        ...p,
        [clientId]: e instanceof Error ? e.message : "Failed",
      }));
    } finally {
      setReworkingId(null);
    }
  }

  // Panel is collapsed by default on the dashboard — coach only opens it
  // when actively sending a poll or scanning for adherence drops. Closed
  // it reads as a single "📣 Weekly check-in poll ▾" header strip.
  // Anything in flight (a send in progress, a result chip showing the
  // last send, or a freshly returned scan with flags) forces it open so
  // results don't vanish on first click of the panel toggle.
  const [open, setOpen] = useState(
    () => sendLoading || scanLoading || sendResult !== null || (flags?.length ?? 0) > 0,
  );

  return (
    <FmPanel
      title={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            font: "inherit",
            color: "inherit",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            textAlign: "left",
          }}
        >
          <span>📣 Weekly check-in poll</span>
          <span
            style={{
              fontSize: 11,
              color: "var(--fm-text-tertiary)",
              fontWeight: 400,
              transition: "transform 0.15s",
              transform: open ? "rotate(0deg)" : "rotate(-90deg)",
              display: "inline-block",
            }}
          >
            ▾
          </span>
          {!open && pollClients.length > 0 && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "var(--fm-text-tertiary)",
                marginLeft: "auto",
              }}
            >
              {pollClients.length} eligible client{pollClients.length === 1 ? "" : "s"}
            </span>
          )}
        </button>
      }
      subtitle={open ? "WhatsApp pulse — adherence on supplements, meals, movement" : undefined}
    >
      {!open ? null : (
      <div style={{ display: "grid", gap: 14 }}>
        {!whatsappConfigured && (
          <div
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              background: "rgba(234, 88, 12, 0.08)",
              border: "1px solid rgba(234, 88, 12, 0.25)",
              fontSize: 12,
            }}
          >
            <strong>WhatsApp outbound not configured.</strong> Add{" "}
            <code>WHATSAPP_SERVER_URL</code> + <code>WHATSAPP_SERVER_API_KEY</code> to{" "}
            <code>.env.local</code> (points at <code>whatsapp-server-shivani.fly.dev</code>).
            The <code>fm_weekly_check_in_v1</code> template + sibling polls are already
            approved on the WABA — buttons: <em>All good</em> / <em>Some struggles</em> /{" "}
            <em>Need help</em>. (Meta strips emojis from button text, so no 🌿 — webhook
            parser still matches case-insensitive substrings.)
          </div>
        )}

        {/* ── Poll variant picker ── */}
        <div style={{ display: "grid", gap: 6 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "rgba(0,0,0,0.55)",
            }}
          >
            Pick a poll
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {POLL_VARIANTS.map((v) => {
              const active = v.key === variantKey;
              // Per-variant persisted send state (durable rule 2026-05-23).
              const lastSent = lastSentByCampaign[v.campaign];
              const lastSentAgo = lastSent ? relativeTimeShort(lastSent) : "";
              return (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setVariantKey(v.key)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: active ? "0" : "1px solid rgba(0,0,0,0.15)",
                    background: active ? "#059669" : "white",
                    color: active ? "white" : "#1d1d1f",
                    fontSize: 12,
                    fontWeight: active ? 700 : 500,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                  title={
                    lastSent
                      ? `Template: ${v.campaign} · last sent ${lastSentAgo} (${new Date(lastSent).toLocaleString()})`
                      : `Template: ${v.campaign} · never sent`
                  }
                >
                  <span>{v.emoji} {v.label}</span>
                  {lastSent && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        opacity: active ? 0.95 : 0.6,
                        background: active ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.06)",
                        padding: "1px 6px",
                        borderRadius: 999,
                      }}
                    >
                      ✓ {lastSentAgo}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "rgba(0,0,0,0.6)",
              background: "rgba(5,150,105,0.06)",
              border: "1px solid rgba(5,150,105,0.2)",
              borderRadius: 6,
              padding: "8px 10px",
              lineHeight: 1.5,
            }}
          >
            <div>
              <strong>Sends:</strong> {variant.body} (template:{" "}
              <code style={{ fontSize: 11 }}>{variant.campaign}</code>
              {" · "}<span style={{ color: "#065f46" }}>✓ Meta-approved UTILITY</span>)
            </div>
            <div style={{ marginTop: 4 }}>
              <strong>Buttons:</strong>{" "}
              {variant.buttons.map((b, i) => (
                <span key={i}>
                  <em>{b}</em>
                  {i < variant.buttons.length - 1 ? " · " : ""}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Recipient checklist ── */}
        <div style={{ display: "grid", gap: 6 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 11,
            }}
          >
            <span
              style={{
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                color: "rgba(0,0,0,0.55)",
              }}
            >
              Recipients — {selectedCount} of {pollClients.length} selected
            </span>
            <button
              type="button"
              style={{
                background: "none",
                border: 0,
                color: "rgba(0,0,0,0.55)",
                textDecoration: "underline",
                cursor: "pointer",
                fontSize: 11,
              }}
              disabled={selectedCount === pollClients.length || pollClients.length === 0}
              onClick={() => setSelectedIds(new Set(pollClients.map((c) => c.client_id)))}
            >
              Select all
            </button>
            <button
              type="button"
              style={{
                background: "none",
                border: 0,
                color: "rgba(0,0,0,0.55)",
                textDecoration: "underline",
                cursor: "pointer",
                fontSize: 11,
              }}
              disabled={selectedCount === 0}
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </button>
          </div>
          {pollClients.length === 0 && (
            <div
              style={{
                fontSize: 12,
                color: "rgba(0,0,0,0.5)",
                fontStyle: "italic",
                padding: "8px 10px",
                background: "rgba(0,0,0,0.03)",
                borderRadius: 6,
              }}
            >
              No clients with a published plan + mobile number on file.
              Activate a plan and add a phone number to enable polling.
            </div>
          )}
          {pollClients.length > 0 && (
            <div
              style={{
                maxHeight: 180,
                overflowY: "auto",
                border: "1px solid rgba(0,0,0,0.1)",
                borderRadius: 6,
                background: "white",
                padding: 6,
                display: "grid",
                gap: 2,
              }}
            >
              {pollClients.map((c) => {
                const checked = selectedIds.has(c.client_id);
                return (
                  <label
                    key={c.client_id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 8px",
                      borderRadius: 4,
                      background: checked ? "rgba(5,150,105,0.08)" : "transparent",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleClient(c.client_id)}
                      style={{ accentColor: "#059669" }}
                    />
                    <span style={{ fontWeight: 500 }}>
                      {c.display_name ?? c.client_id}
                    </span>
                    {c.mobile_number && (
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 11,
                          color: "rgba(0,0,0,0.5)",
                        }}
                      >
                        {c.mobile_number}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Send poll ── */}
        <div style={{ display: "grid", gap: 8 }}>
          <button
            type="button"
            onClick={handleSend}
            disabled={!whatsappConfigured || sendLoading || selectedCount === 0}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              background:
                whatsappConfigured && selectedCount > 0
                  ? "#059669"
                  : "rgba(0,0,0,0.1)",
              color: "white",
              border: "none",
              cursor: sendLoading
                ? "wait"
                : whatsappConfigured && selectedCount > 0
                  ? "pointer"
                  : "not-allowed",
              fontWeight: 600,
              fontSize: 13,
              width: "fit-content",
            }}
          >
            {sendLoading
              ? "Sending…"
              : variantLastSent
                ? `↻ Resend ${variant.label.toLowerCase()} poll to ${selectedCount} client${selectedCount !== 1 ? "s" : ""} (last sent ${variantLastSentAgo})`
                : `📣 Send ${variant.label.toLowerCase()} poll to ${selectedCount} client${selectedCount !== 1 ? "s" : ""}`}
          </button>
          {sendResult && (
            <div
              style={{
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                fontSize: 12,
              }}
            >
              <FmChip tone="success">{sendResult.sent} sent</FmChip>
              {sendResult.skipped > 0 && (
                <FmChip tone="neutral">{sendResult.skipped} skipped</FmChip>
              )}
              {sendResult.failed > 0 && (
                <FmChip tone="danger">{sendResult.failed} failed</FmChip>
              )}
              {sendResult.errors.length > 0 && (
                <details style={{ fontSize: 11, marginTop: 4 }}>
                  <summary style={{ cursor: "pointer", opacity: 0.7 }}>
                    Errors ({sendResult.errors.length})
                  </summary>
                  <ul style={{ marginTop: 4 }}>
                    {sendResult.errors.slice(0, 10).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {sendError && (
            <div style={{ color: "#dc2626", fontSize: 12 }}>{sendError}</div>
          )}
        </div>

        {/* ── Adherence-drop scan ── */}
        <div style={{ display: "grid", gap: 8, borderTop: "1px dashed rgba(0,0,0,0.1)", paddingTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={handleScan}
              disabled={scanLoading}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                background: "white",
                border: "1px solid rgba(0,0,0,0.15)",
                cursor: scanLoading ? "wait" : "pointer",
                fontSize: 13,
              }}
            >
              {scanLoading ? "Scanning…" : "🚨 Scan for adherence drops (last 28d)"}
            </button>
            {flags !== null && (
              <span style={{ fontSize: 12, opacity: 0.7 }}>
                {flags.length} flagged
              </span>
            )}
          </div>

          {scanError && (
            <div style={{ color: "#dc2626", fontSize: 12 }}>{scanError}</div>
          )}

          {flags && flags.length === 0 && (
            <div style={{ fontSize: 13, opacity: 0.7 }}>
              No clients tripped the 3-strike rule. Adherence looks healthy.
            </div>
          )}

          {flags && flags.length > 0 && (
            <ul style={{ display: "grid", gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
              {flags.map((f) => (
                <li
                  key={f.client_id}
                  style={{
                    padding: "8px 10px",
                    border: "1px solid rgba(239, 68, 68, 0.25)",
                    borderRadius: 6,
                    background: "rgba(239, 68, 68, 0.04)",
                    display: "grid",
                    gap: 4,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {f.display_name || f.client_id}{" "}
                      <span style={{ opacity: 0.6, fontWeight: 400 }}>
                        — {f.strikes} strike{f.strikes !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <a
                        href={`/clients-v2/${f.client_id}`}
                        style={{ fontSize: 12, color: "#0369a1" }}
                      >
                        Open client →
                      </a>
                      {!reworkDone[f.client_id] && (
                        <button
                          type="button"
                          onClick={() => handleRework(f.client_id)}
                          disabled={reworkingId === f.client_id}
                          style={{
                            fontSize: 12,
                            padding: "4px 8px",
                            borderRadius: 4,
                            background: "#7c3aed",
                            color: "white",
                            border: "none",
                            cursor: reworkingId === f.client_id ? "wait" : "pointer",
                          }}
                        >
                          {reworkingId === f.client_id ? "…" : "🔁 Run rework"}
                        </button>
                      )}
                      {reworkDone[f.client_id] && (
                        <FmChip tone="success">✓ Rework run</FmChip>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>
                    Dimensions: {f.dimensions_flagged.join(", ") || "(none)"}
                    {f.last_response_at && ` · last reply ${f.last_response_at}`}
                  </div>
                  {reworkErrors[f.client_id] && (
                    <div style={{ color: "#dc2626", fontSize: 11 }}>
                      {reworkErrors[f.client_id]}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      )}
    </FmPanel>
  );
}
