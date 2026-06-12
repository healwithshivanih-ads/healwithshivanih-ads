"use client";

/**
 * ClientAppLinksPanel — dashboard widget listing every published-plan
 * client with their Ochre Tree client-app link (/app/<letter_token>),
 * plus rollout adoption state (2026-06-12):
 *
 *   · 📨 Send invite — fm_app_invite_v1 template via the WA server,
 *     recorded to the chat thread (sent state persists across reloads
 *     via the [template: …][sent_at: …] tag — coach rule).
 *   · Last opened — from _app_opens.yaml (logged on Fly per page load,
 *     mirrored back by the per-minute cron). Red "never opened" when an
 *     invite is ≥4 days old with zero opens → nudge candidate.
 *   · Engaged — the client has WRITTEN something from the app
 *     (check-in / MSQ / travel flag).
 *
 * Rows whose plan already carries a letter_token show Copy + WhatsApp
 * immediately; rows without one get a "Get link" button that lazily
 * issues the token (ensureLetterToken — same token the letter uses).
 */

import { useState } from "react";
import { FmPanel, FmChip } from "@/components/fm";
import { copyText } from "@/lib/copy-text";
import { relativeTimeShort } from "@/lib/fmdb/session-utils";

export interface AppLinkRow {
  client_id: string;
  display_name: string;
  mobile_number: string | null;
  plan_slug: string;
  token: string | null;
  inviteSentAt: string | null;
  lastOpenedAt: string | null;
  openCount: number;
  engaged: boolean;
  groceryReady: boolean;
}

function publicOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
    (typeof window !== "undefined" ? window.location.origin : "")
  );
}

function waShare(phone: string, name: string, url: string): string {
  const clean = phone.replace(/\D+/g, "");
  const e164 = clean.length === 10 ? `91${clean}` : clean;
  const msg = [
    `Hi ${name.split(" ")[0] || "there"},`,
    "",
    "Here's your plan as an app — your meals, supplements, practices and progress, day by day:",
    "",
    url,
    "",
    "Open it on your phone, then tap Share → “Add to Home Screen” so it sits with your other apps.",
    "",
    "Shivani",
  ].join("\n");
  return `https://wa.me/${e164}?text=${encodeURIComponent(msg)}`;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
}

function AdoptionChips({ row, sentAt }: { row: AppLinkRow; sentAt: string | null }) {
  const inviteDays = daysSince(sentAt);
  const neverOpened = sentAt !== null && row.openCount === 0 && (inviteDays ?? 0) >= 4;
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", fontSize: 11.5 }}>
      {sentAt && (
        <span style={{ color: "var(--fm-muted, #6f6a5d)" }}>
          ✓ Invited {relativeTimeShort(sentAt) || "just now"}
        </span>
      )}
      {row.lastOpenedAt ? (
        <span style={{ color: "#3d6b4f", fontWeight: 600 }}>
          Opened {relativeTimeShort(row.lastOpenedAt) || "just now"}
          {row.openCount > 1 ? ` · ${row.openCount}×` : ""}
        </span>
      ) : neverOpened ? (
        <span style={{ color: "#b3402a", fontWeight: 600 }}>never opened — nudge?</span>
      ) : sentAt ? (
        <span style={{ color: "var(--fm-muted, #6f6a5d)" }}>not opened yet</span>
      ) : null}
      {row.engaged && (
        <span style={{ color: "#3d6b4f" }}>💬 engaged</span>
      )}
    </span>
  );
}

function Row({ row, whatsappConfigured }: { row: AppLinkRow; whatsappConfigured: boolean }) {
  const [token, setToken] = useState(row.token);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  // local echo after a successful send; disk state arrives on next reload
  const [sentAt, setSentAt] = useState(row.inviteSentAt);
  const [sending, setSending] = useState(false);

  const url = token ? `${publicOrigin()}/app/${token}` : null;

  const getLink = async () => {
    setBusy(true);
    setError("");
    try {
      const { ensureLetterToken } = await import("@/lib/server-actions/letter-token");
      const out = await ensureLetterToken(row.plan_slug);
      if (!out.ok) throw new Error(out.error);
      setToken(out.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await copyText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard denied */
    }
  };

  const sendInvite = async () => {
    setSending(true);
    setError("");
    try {
      const { sendAppInviteAction } = await import("@/lib/server-actions/app-invite");
      const out = await sendAppInviteAction(row.client_id, row.plan_slug);
      if (!out.ok) throw new Error(out.error || "send failed");
      setSentAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 2px",
        borderBottom: "1px solid var(--fm-border, rgba(0,0,0,0.07))",
        flexWrap: "wrap",
      }}
    >
      <span style={{ minWidth: 150, display: "inline-flex", flexDirection: "column", gap: 2 }}>
        <a
          href={`/clients-v2/${row.client_id}`}
          style={{ fontWeight: 600, fontSize: 13.5, textDecoration: "none", color: "inherit" }}
        >
          {row.display_name}
          {!row.groceryReady && (
            <span
              title="No grocery list generated for this plan — generate one before inviting so the app feels complete"
              style={{ marginLeft: 6, fontSize: 11, color: "#a8742a" }}
            >
              🛒 missing
            </span>
          )}
        </a>
        <AdoptionChips row={row} sentAt={sentAt} />
      </span>
      <span style={{ flex: 1 }} />
      {error && <span style={{ fontSize: 12, color: "#b3402a" }}>{error}</span>}
      {!token ? (
        <button className="fm-btn" onClick={getLink} disabled={busy}>
          {busy ? "Issuing…" : "🔗 Get link"}
        </button>
      ) : (
        <>
          {whatsappConfigured && row.mobile_number && (
            <button className="fm-btn" onClick={sendInvite} disabled={sending}>
              {sending ? "Sending…" : sentAt ? "📨 Resend invite" : "📨 Send invite"}
            </button>
          )}
          <button className="fm-btn" onClick={copy}>
            {copied ? "✓ Copied" : "📋 Copy"}
          </button>
          {row.mobile_number && url && (
            <a className="fm-btn" href={waShare(row.mobile_number, row.display_name, url)} target="_blank" rel="noreferrer">
              💬 WhatsApp
            </a>
          )}
        </>
      )}
    </div>
  );
}

export function ClientAppLinksPanel({
  rows,
  whatsappConfigured = false,
}: {
  rows: AppLinkRow[];
  whatsappConfigured?: boolean;
}) {
  if (!rows.length) return null;
  const opened = rows.filter((r) => r.openCount > 0).length;
  const invited = rows.filter((r) => r.inviteSentAt).length;
  return (
    <FmPanel
      title="📲 Client app links"
      subtitle="The Ochre Tree — each published plan as a daily companion app. Client opens the link, then “Add to Home Screen” (no download / app store)."
      rightSlot={
        <FmChip>
          {invited > 0 ? `${opened}/${invited} opened` : `${rows.length}`}
        </FmChip>
      }
    >
      <div>
        {rows.map((r) => (
          <Row key={r.plan_slug} row={r} whatsappConfigured={whatsappConfigured} />
        ))}
      </div>
      <div style={{ fontSize: 12, color: "var(--fm-muted, #6f6a5d)", marginTop: 10 }}>
        Same token as the plan letter — revoking a plan disables its link. 📨 Send invite uses the
        approved template + logs to the chat thread; “Opened” comes from real app loads on the
        client&apos;s phone (your own previews don&apos;t count). Weekly check-ins from the app land in
        sessions and count toward the adherence scan.
      </div>
    </FmPanel>
  );
}
