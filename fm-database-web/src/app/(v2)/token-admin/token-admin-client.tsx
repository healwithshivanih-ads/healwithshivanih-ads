"use client";

/**
 * Token register table + per-row copy / open / revoke.
 *
 * Tokens are shown masked in the list; "Copy link" puts the full public URL on
 * the clipboard. Revoke calls the kind-aware dispatcher then refreshes.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FmPanel, FmChip, FmStatusPill, type FmStatusPillKind } from "@/components/fm";
import { revokeToken } from "@/lib/server-actions/token-admin";
import type { IssuedToken, TokenStatus } from "@/lib/fmdb/token-admin-types";

const STATUS_PILL: Record<TokenStatus, FmStatusPillKind> = {
  active: "active",
  expired: "blocking",
  finalised: "locked",
  submitted: "done",
  used: "done",
};

const KIND_TONE: Record<IssuedToken["kind"], "primary" | "warning" | "secondary" | "neutral"> = {
  app: "primary",
  letter: "warning",
  intake: "secondary",
  start_confirmation: "neutral",
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s;
  return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function rowKey(t: IssuedToken): string {
  return `${t.kind}:${t.clientId}:${t.planSlug ?? ""}:${t.tokenMasked}`;
}

export function TokenAdminClient({ tokens }: { tokens: IssuedToken[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function copy(url: string, key: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      setErr("Couldn't copy to clipboard.");
    }
  }

  async function doRevoke(t: IssuedToken) {
    const label = `${t.kindLabel} link for ${t.clientName}`;
    if (!window.confirm(`Revoke the ${label}? The link stops working immediately.`)) return;
    const key = rowKey(t);
    setBusy(key);
    setErr(null);
    try {
      const res = await revokeToken({ kind: t.kind, clientId: t.clientId, planSlug: t.planSlug });
      if (!res.ok) setErr(`Revoke failed: ${res.error}`);
      else router.refresh();
    } catch {
      setErr("Revoke failed — see server logs.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <FmPanel flat>
      {err && (
        <div
          role="alert"
          style={{
            margin: "0 0 12px",
            padding: "10px 14px",
            borderRadius: "var(--fm-radius-md)",
            background: "rgba(220,53,69,0.10)",
            color: "#c0392b",
            fontSize: 13,
          }}
        >
          {err}
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--fm-text-tertiary)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              <th style={th}>Client</th>
              <th style={th}>Kind</th>
              <th style={th}>Status</th>
              <th style={th}>Unlocks</th>
              <th style={th}>Token</th>
              <th style={th}>Expires</th>
              <th style={th}>Opened</th>
              <th style={th}>Link</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => {
              const key = rowKey(t);
              return (
                <tr key={key} style={{ borderTop: "1px solid var(--fm-border)" }}>
                  <td style={td}>
                    <span style={{ fontWeight: 600 }}>{t.clientName}</span>
                    {t.planSlug && (
                      <div style={{ color: "var(--fm-text-tertiary)", fontSize: 11 }}>{t.planSlug}</div>
                    )}
                  </td>
                  <td style={td}>
                    <FmChip tone={KIND_TONE[t.kind]}>{t.kindLabel}</FmChip>
                  </td>
                  <td style={td}>
                    <FmStatusPill kind={STATUS_PILL[t.status]}>{t.status}</FmStatusPill>
                  </td>
                  <td style={{ ...td, color: "var(--fm-text-secondary)", maxWidth: 240 }}>{t.unlocks}</td>
                  <td style={{ ...td, fontFamily: "var(--fm-font-mono, monospace)", fontSize: 12 }}>
                    {t.tokenMasked}
                  </td>
                  <td style={td}>{fmtDate(t.expiresAt)}</td>
                  <td style={td}>{fmtDate(t.firstOpenedAt ?? t.usedAt)}</td>
                  <td style={td}>
                    {t.url ? (
                      <div style={{ display: "flex", gap: 6, whiteSpace: "nowrap" }}>
                        <button type="button" style={linkBtn} onClick={() => copy(t.url!, key)}>
                          {copied === key ? "✓ Copied" : "Copy link"}
                        </button>
                        <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ ...linkBtn, textDecoration: "none" }}>
                          Open ↗
                        </a>
                      </div>
                    ) : (
                      <span style={{ color: "var(--fm-text-tertiary)" }}>—</span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {t.revocable ? (
                      <button
                        type="button"
                        onClick={() => doRevoke(t)}
                        disabled={busy === key}
                        style={revokeBtn}
                      >
                        {busy === key ? "Revoking…" : "Revoke"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </FmPanel>
  );
}

const th: React.CSSProperties = { padding: "8px 10px", fontWeight: 700 };
const td: React.CSSProperties = { padding: "10px", verticalAlign: "top" };
const linkBtn: React.CSSProperties = {
  border: "1px solid var(--fm-border)",
  background: "var(--fm-surface)",
  borderRadius: "var(--fm-radius-sm)",
  padding: "4px 9px",
  fontSize: 12,
  cursor: "pointer",
  color: "var(--fm-text-secondary)",
};
const revokeBtn: React.CSSProperties = {
  border: "1px solid rgba(220,53,69,0.4)",
  background: "rgba(220,53,69,0.06)",
  color: "#c0392b",
  borderRadius: "var(--fm-radius-sm)",
  padding: "5px 12px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
