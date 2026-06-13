"use client";

/**
 * SendAppLinkButton — coach-side widget to share the client companion app
 * ("The Ochre Tree" PWA at /app/<app_token>).
 *
 * Uses a STABLE per-client app_token (stored in client.yaml) instead of the
 * per-plan letter_token. This means the same link works after a plan supersedes —
 * coach never needs to re-share the URL. The app itself resolves to the latest
 * published plan at load time.
 *
 * The letter_token (per-plan) still gates /letter/ routes; this is a separate token.
 */

import { useState } from "react";
import { FmPanel } from "@/components/fm";
import { copyText } from "@/lib/copy-text";

interface Props {
  clientId: string;
  mobileNumber?: string | null;
  displayName?: string | null;
  existingToken?: string | null;
}

function buildPublicUrl(path: string): string {
  const envOrigin =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (typeof window !== "undefined" ? window.location.origin : "");
  return envOrigin.replace(/\/$/, "") + path;
}

function buildWhatsappLink(phone: string, displayName: string, url: string): string {
  const clean = phone.replace(/\D+/g, "");
  const e164 = clean.length === 10 ? `91${clean}` : clean;
  const msg = [
    `Hi ${displayName || "there"},`,
    "",
    "Here's your plan as an app — everything for each day in one place: your meals, supplements, practices and progress:",
    "",
    url,
    "",
    "Open it on your phone, then use 'Add to Home Screen' so it sits with your other apps. Your daily ticks save automatically.",
    "",
    "Shivani",
  ].join("\n");
  return `https://wa.me/${e164}?text=${encodeURIComponent(msg)}`;
}

export function SendAppLinkButton({ clientId, mobileNumber, displayName, existingToken }: Props) {
  const [token, setToken] = useState<string | null>(existingToken ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentOk, setSentOk] = useState(false);

  const url = token ? buildPublicUrl(`/app/${token}`) : null;

  const getLink = async () => {
    setBusy(true);
    setError("");
    try {
      const { ensureClientAppToken } = await import("@/lib/server-actions/app-token");
      const out = await ensureClientAppToken(clientId);
      if (!out.ok) throw new Error(out.error);
      setToken(out.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not issue link");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await copyText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard denied */
    }
  };

  const sendViaApi = async () => {
    if (!token) return;
    setSending(true);
    setError("");
    setSentOk(false);
    try {
      const { sendAppInviteLinkAction } = await import("@/lib/server-actions/app-invite");
      const out = await sendAppInviteLinkAction(clientId, token);
      if (out.ok) setSentOk(true);
      else setError(out.error ?? "send failed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <FmPanel title="📲 Client app" subtitle="The Ochre Tree — their plan as a daily companion app">
      {!token ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 13, color: "var(--fm-muted, #6f6a5d)" }}>
            Shares the published plan as a living app — Today screen, supplement logging, remedies,
            weekly check-in that lands back here. Link stays the same when the plan updates.
          </div>
          <button className="fm-btn" onClick={getLink} disabled={busy}>
            {busy ? "Issuing…" : "🔗 Get app link"}
          </button>
          {error && <div style={{ fontSize: 12.5, color: "#b3402a" }}>{error}</div>}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <code
            style={{
              fontSize: 12,
              wordBreak: "break-all",
              background: "rgba(0,0,0,0.04)",
              borderRadius: 8,
              padding: "8px 10px",
            }}
          >
            {url}
          </code>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {mobileNumber && (
              <button className="fm-btn" onClick={sendViaApi} disabled={sending}>
                {sending ? "Sending…" : sentOk ? "📨 Resend invite" : "📨 Send via WhatsApp"}
              </button>
            )}
            <button className="fm-btn" onClick={copy}>
              {copied ? "✓ Copied" : "📋 Copy link"}
            </button>
            {mobileNumber && url && (
              <a
                className="fm-btn"
                href={buildWhatsappLink(mobileNumber, displayName ?? "", url)}
                target="_blank"
                rel="noreferrer"
              >
                💬 Open in app (manual)
              </a>
            )}
            {sentOk && <span style={{ color: "#2f7a3f", fontWeight: 600, fontSize: 13 }}>✓ Sent</span>}
          </div>
          <div style={{ fontSize: 12, color: "var(--fm-muted, #6f6a5d)" }}>
            📨 Send via WhatsApp uses your brand number + the approved template and logs to the chat
            thread. 💬 Open in app hands off to your own WhatsApp instead. Stable link — stays the
            same after plan updates.
          </div>
        </div>
      )}
    </FmPanel>
  );
}
