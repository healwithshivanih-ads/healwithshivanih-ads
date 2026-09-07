"use client";

/**
 * Coach button — mint a shareable maintenance Payment Link (₹12,000 / 6 months)
 * for this client, to paste into an email/WhatsApp. Works for graduates and
 * lapsed win-backs (not gated on maintenance_status). Proxies to the Fly route
 * where the live Razorpay keys are — see generateMaintenanceLinkAction.
 */
import { useState, useTransition } from "react";
import { generateMaintenanceLinkAction } from "@/lib/server-actions/maintenance-link";

export function MaintenanceLinkButton({ clientId }: { clientId: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const generate = () =>
    start(async () => {
      setError(null);
      setCopied(false);
      const r = await generateMaintenanceLinkAction(clientId);
      if (r.ok && r.shortUrl) setLink(r.shortUrl);
      else setError(r.error || "Could not create the link.");
    });

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the coach can select the text manually */
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        type="button"
        onClick={generate}
        disabled={pending}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          fontSize: 12.5,
          fontWeight: 600,
          fontFamily: "inherit",
          color: "var(--fm-text-primary)",
          background: "var(--fm-surface)",
          border: "1px solid var(--fm-border)",
          borderRadius: "var(--fm-radius-sm)",
          cursor: pending ? "wait" : "pointer",
          opacity: pending ? 0.65 : 1,
          textAlign: "left",
        }}
      >
        🔗 {pending ? "Creating link…" : link ? "New maintenance link" : "Maintenance pay link"}
      </button>

      {link && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "8px 10px",
            background: "rgba(46,125,90,0.07)",
            border: "1px solid rgba(46,125,90,0.30)",
            borderRadius: "var(--fm-radius-sm)",
          }}
        >
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: "#2e7d5a", textTransform: "uppercase" }}>
            ₹12,000 · 6 months · Ochre Life
          </div>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 12,
              fontFamily: "var(--fm-font-mono, ui-monospace, Menlo, monospace)",
              color: "var(--fm-text-secondary)",
              wordBreak: "break-all",
              textDecoration: "underline",
            }}
          >
            {link}
          </a>
          <button
            type="button"
            onClick={copy}
            style={{
              alignSelf: "flex-start",
              padding: "3px 10px",
              fontSize: 11.5,
              fontWeight: 600,
              fontFamily: "inherit",
              color: "#fff",
              background: "#2e7d5a",
              border: "none",
              borderRadius: "var(--fm-radius-sm)",
              cursor: "pointer",
            }}
          >
            {copied ? "✓ Copied" : "📋 Copy link"}
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            fontSize: 11.5,
            lineHeight: 1.4,
            color: "#92400e",
            background: "rgba(217,119,6,0.09)",
            border: "1px solid rgba(217,119,6,0.30)",
            borderRadius: "var(--fm-radius-sm)",
            padding: "6px 9px",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
