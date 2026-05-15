"use client";

/**
 * StartConfirmLinkButton — coach-side widget that mints a tokenised /start/<token>
 * link and hands it to the client over WhatsApp. The client taps it, picks a
 * date (or accepts the default), and `plan.meal_plan_started_on` is filled in.
 *
 * This is the client-facing equivalent of <PlanStartDatesPanel> (coach types
 * the date directly). Sibling panel rather than a slot — keeps the two
 * concerns clean: one is coach-types-in-the-field, the other is client-taps-
 * a-link. They share the same field on disk.
 *
 * Mirrors the SendIntakeFormButton flow: generate → show URL + copy +
 * WhatsApp share → optional revoke. Terminal state ("confirmed on …") hides
 * the panel because the data on the plan now tells the story; the coach can
 * still re-issue from the plan-start-dates panel by clearing the date if she
 * needs another round.
 */

import { useState } from "react";
import { FmPanel, FmChip } from "@/components/fm";

interface Props {
  planSlug: string;
  displayName?: string | null;
  mobileNumber?: string | null;
  /** plan_period_start + 3d — what the client's link will pre-fill as default. */
  defaultStartDate?: string | null;
  /** plan.start_confirmation_token — already-issued + not-yet-used token. */
  existingToken?: string | null;
  existingExpiresAt?: string | null;
  /** plan.start_confirmation_used_at — ISO timestamp when client confirmed. */
  usedAt?: string | null;
  /** plan.meal_plan_started_on — the date the client chose. */
  confirmedDate?: string | null;
}

function buildPublicUrl(path: string): string {
  const envOrigin =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (typeof window !== "undefined" ? window.location.origin : "");
  return envOrigin.replace(/\/$/, "") + path;
}

function formatHumanShort(ymd: string | null | undefined): string {
  if (!ymd) return "";
  try {
    const d = new Date(ymd + "T00:00:00");
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  } catch {
    return ymd;
  }
}

function buildWhatsappLink(
  phone: string,
  displayName: string,
  defaultStartDate: string | null | undefined,
  url: string,
): string {
  const clean = phone.replace(/\D+/g, "");
  const e164 = clean.length === 10 ? `91${clean}` : clean;
  const defaultLabel = defaultStartDate ? formatHumanShort(defaultStartDate) : "soon";
  const msg = [
    `Hi ${displayName || "there"}, your plan is set to begin on ${defaultLabel}.`,
    "",
    "Tap below if you'd like to confirm or change the day:",
    url,
  ].join("\n");
  return `https://wa.me/${e164}?text=${encodeURIComponent(msg)}`;
}

export function StartConfirmLinkButton({
  planSlug,
  displayName,
  mobileNumber,
  defaultStartDate,
  existingToken,
  existingExpiresAt,
  usedAt,
  confirmedDate,
}: Props) {
  const [token, setToken] = useState<string | null>(existingToken ?? null);
  const [expiresAt, setExpiresAt] = useState<string | null>(existingExpiresAt ?? null);
  const [open, setOpen] = useState<boolean>(Boolean(existingToken));
  const [loading, setLoading] = useState(false);
  const [copyOk, setCopyOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Terminal state: client has confirmed. Show a quiet confirmation panel.
  if (usedAt && !token) {
    return (
      <FmPanel
        title="📅 Client start-date link"
        subtitle="Client confirmed their start date."
      >
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(16, 185, 129, 0.08)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            fontSize: 13,
          }}
        >
          ✓ Client confirmed on{" "}
          <strong>{formatHumanShort(confirmedDate)}</strong>
          {usedAt && (
            <span style={{ opacity: 0.7 }}>
              {" "}
              ({new Date(usedAt).toLocaleString()})
            </span>
          )}
        </div>
      </FmPanel>
    );
  }

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const { generateStartConfirmToken } = await import(
        "@/lib/server-actions/plans"
      );
      const res = await generateStartConfirmToken(planSlug, 14);
      if (!res.ok) {
        setError(res.error || "Failed to generate link");
        return;
      }
      setToken(res.token);
      setExpiresAt(res.expires_at);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate link");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke() {
    if (!token) return;
    if (!confirm("Revoke this start-date link? The client will no longer be able to use it.")) {
      return;
    }
    setLoading(true);
    try {
      const { revokeStartConfirmToken } = await import(
        "@/lib/server-actions/plans"
      );
      const res = await revokeStartConfirmToken(planSlug);
      if (!res.ok) {
        setError(res.error || "Failed to revoke link");
        return;
      }
      setToken(null);
      setExpiresAt(null);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke link");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1800);
    } catch {
      alert("Copy failed — please select and copy the URL manually.");
    }
  }

  const publicUrl = token ? buildPublicUrl(`/start/${token}`) : "";
  const phone = (mobileNumber || "").trim();
  const waLink =
    publicUrl && phone
      ? buildWhatsappLink(phone, displayName || "", defaultStartDate, publicUrl)
      : "";

  return (
    <FmPanel
      title="📅 Get client start-date link"
      subtitle="Send a tokenised link the client taps to confirm when she actually begins."
    >
      <div style={{ display: "grid", gap: 10 }}>
        {!token && (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              background: "#059669",
              color: "white",
              border: "none",
              cursor: loading ? "wait" : "pointer",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {loading ? "Generating…" : "📅 Get client confirm link"}
          </button>
        )}

        {token && open && (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Link active until{" "}
              {expiresAt ? new Date(expiresAt).toLocaleString() : "—"}. Single-use —
              clears when the client confirms.
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                background: "rgba(0,0,0,0.04)",
                padding: "6px 8px",
                borderRadius: 6,
                fontFamily: "monospace",
                fontSize: 12,
                wordBreak: "break-all",
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>{publicUrl}</span>
              <button
                type="button"
                onClick={() => handleCopy(publicUrl)}
                style={{
                  fontSize: 12,
                  padding: "4px 8px",
                  border: "1px solid rgba(0,0,0,0.15)",
                  borderRadius: 4,
                  background: "white",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {copyOk ? "✓ Copied" : "📋 Copy"}
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {phone ? (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: "#25D366",
                    color: "white",
                    textDecoration: "none",
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  💬 Send via WhatsApp
                </a>
              ) : (
                <FmChip tone="neutral">
                  No mobile number on file — add one to enable WhatsApp share
                </FmChip>
              )}
              <button
                type="button"
                onClick={handleRevoke}
                disabled={loading}
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "transparent",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  color: "#dc2626",
                  cursor: loading ? "wait" : "pointer",
                  fontSize: 13,
                }}
              >
                {loading ? "…" : "Revoke link"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div
            style={{
              color: "#dc2626",
              fontSize: 13,
              padding: "6px 8px",
              background: "rgba(239, 68, 68, 0.06)",
              borderRadius: 6,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </FmPanel>
  );
}
