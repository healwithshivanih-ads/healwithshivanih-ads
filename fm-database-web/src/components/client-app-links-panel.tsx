"use client";

/**
 * ClientAppLinksPanel — dashboard widget listing every published-plan
 * client with their Ochre Tree client-app link (/app/<letter_token>).
 *
 * Nothing to "download" — the app is a PWA: the client opens the link
 * on their phone and uses "Add to Home Screen". The coach's job is just
 * getting the link onto their WhatsApp; this panel makes that one click
 * from the dashboard instead of a per-client page visit.
 *
 * Rows whose plan already carries a letter_token show Copy + WhatsApp
 * immediately; rows without one get a "Get link" button that lazily
 * issues the token (ensureLetterToken — same token the letter uses).
 */

import { useState } from "react";
import { FmPanel, FmChip } from "@/components/fm";
import { copyText } from "@/lib/copy-text";

export interface AppLinkRow {
  client_id: string;
  display_name: string;
  mobile_number: string | null;
  plan_slug: string;
  token: string | null;
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

function Row({ row }: { row: AppLinkRow }) {
  const [token, setToken] = useState(row.token);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

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
      <a
        href={`/clients-v2/${row.client_id}`}
        style={{ fontWeight: 600, fontSize: 13.5, textDecoration: "none", color: "inherit", minWidth: 130 }}
      >
        {row.display_name}
      </a>
      <span style={{ flex: 1 }} />
      {error && <span style={{ fontSize: 12, color: "#b3402a" }}>{error}</span>}
      {!token ? (
        <button className="fm-btn" onClick={getLink} disabled={busy}>
          {busy ? "Issuing…" : "🔗 Get link"}
        </button>
      ) : (
        <>
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

export function ClientAppLinksPanel({ rows }: { rows: AppLinkRow[] }) {
  if (!rows.length) return null;
  return (
    <FmPanel
      title="📲 Client app links"
      subtitle="The Ochre Tree — each published plan as a daily companion app. Client opens the link, then “Add to Home Screen” (no download / app store)."
      rightSlot={<FmChip>{rows.length}</FmChip>}
    >
      <div>
        {rows.map((r) => (
          <Row key={r.plan_slug} row={r} />
        ))}
      </div>
      <div style={{ fontSize: 12, color: "var(--fm-muted, #6f6a5d)", marginTop: 10 }}>
        Same token as the plan letter — revoking a plan disables its link. Weekly check-ins from the
        app land in the client&apos;s sessions and count toward the adherence scan.
      </div>
    </FmPanel>
  );
}
