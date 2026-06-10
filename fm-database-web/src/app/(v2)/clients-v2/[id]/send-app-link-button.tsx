"use client";

/**
 * SendAppLinkButton — coach-side widget to share the client companion app
 * ("The Ochre Tree" PWA at /app/<letter_token>).
 *
 * Reuses the published plan's letter_token (issued lazily via
 * ensureLetterToken — the same token that gates /letter/). One link does
 * both: the letter stays readable, and the app renders the living plan.
 * Revoking the plan kills the link.
 */

import { useState } from "react";
import { FmPanel } from "@/components/fm";

interface Props {
  planSlug: string;
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
    "Open it on your phone, then use “Add to Home Screen” so it sits with your other apps. Your daily ticks save automatically.",
    "",
    "Shivani",
  ].join("\n");
  return `https://wa.me/${e164}?text=${encodeURIComponent(msg)}`;
}

export function SendAppLinkButton({ planSlug, mobileNumber, displayName, existingToken }: Props) {
  const [token, setToken] = useState<string | null>(existingToken ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const url = token ? buildPublicUrl(`/app/${token}`) : null;

  const getLink = async () => {
    setBusy(true);
    setError("");
    try {
      const { ensureLetterToken } = await import("@/lib/server-actions/letter-token");
      const out = await ensureLetterToken(planSlug);
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
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard denied */
    }
  };

  return (
    <FmPanel title="📲 Client app" subtitle="The Ochre Tree — their plan as a daily companion app">
      {!token ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 13, color: "var(--fm-muted, #6f6a5d)" }}>
            Shares the published plan as a living app — Today screen, supplement logging, remedies,
            weekly check-in that lands back here.
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                💬 Send via WhatsApp
              </a>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--fm-muted, #6f6a5d)" }}>
            Same token as the letter link — revoking the plan disables both.
          </div>
        </div>
      )}
    </FmPanel>
  );
}
