"use client";

/**
 * SendIntakeFormButton — coach-side widget to generate a tokenised intake
 * link and hand it to the client over WhatsApp.
 *
 * Flow:
 *   1. Coach clicks "Send intake form" on the v2 client overview right column.
 *   2. We call generateIntakeToken(clientId) → server writes a fresh token to
 *      client.yaml#intake_token and returns {token, url_path, expires_at}.
 *   3. UI shows the public URL + copy button + WhatsApp share button
 *      (opens wa.me/{phone}?text=…).
 *   4. Coach can revoke any time before submission — calls revokeIntakeToken.
 *
 * Token is single-use: the submit shim clears intake_token after writing the
 * payload back into client.yaml + appending an audit quick_note session.
 *
 * Mobile/desktop client opens /intake/<token> — public route, no auth.
 *
 * NOTE: We don't import server actions at module top — they're called via
 * dynamic import inside the click handler so this stays a thin client
 * component. (Server actions imported at top would still work but feel
 * heavier than needed for a button that fires once per click.)
 */

import { useState } from "react";
import { FmPanel, FmChip } from "@/components/fm";

interface Props {
  clientId: string;
  mobileNumber?: string | null;
  displayName?: string | null;
  existingToken?: string | null;          // if already issued + not submitted
  existingExpiresAt?: string | null;
  submittedAt?: string | null;
  lastSubmittedAt?: string | null;        // Path A — updates on each re-submit
  finalisedAt?: string | null;            // coach-locked, no more edits possible
}

function buildPublicUrl(path: string): string {
  // Best-effort: prefer the deployed origin if NEXT_PUBLIC_APP_URL is set,
  // otherwise fall back to the window origin (client opens the link from
  // their own phone — they don't need our localhost). Coach sees the URL
  // and decides if they want to swap localhost for a tunnel before sending.
  const envOrigin =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (typeof window !== "undefined" ? window.location.origin : "");
  return envOrigin.replace(/\/$/, "") + path;
}

function buildWhatsappLink(phone: string, displayName: string, url: string): string {
  const clean = phone.replace(/\D+/g, "");
  // E.164ish: prepend 91 if it's a 10-digit Indian number
  const e164 = clean.length === 10 ? `91${clean}` : clean;
  // Coach edit 2026-05-14: stripped "from Shivani's office" — more personal,
  // first-person warm.
  const msg = [
    `Hi ${displayName || "there"},`,
    "",
    "Please fill in this intake form before our session — it takes about 25 minutes and helps me prepare the best plan for you:",
    "",
    url,
    "",
    "Your progress saves automatically, so feel free to pause and come back. Looking forward to it.",
    "",
    "Shivani",
  ].join("\n");
  return `https://wa.me/${e164}?text=${encodeURIComponent(msg)}`;
}

export function SendIntakeFormButton({
  clientId,
  mobileNumber,
  displayName,
  existingToken,
  existingExpiresAt,
  submittedAt,
  lastSubmittedAt,
  finalisedAt,
}: Props) {
  const [token, setToken] = useState<string | null>(existingToken ?? null);
  const [expiresAt, setExpiresAt] = useState<string | null>(existingExpiresAt ?? null);
  const [open, setOpen] = useState<boolean>(Boolean(existingToken));
  const [loading, setLoading] = useState(false);
  const [apiSending, setApiSending] = useState(false);
  const [apiSentOk, setApiSentOk] = useState(false);
  const [copyOk, setCopyOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localFinalisedAt, setLocalFinalisedAt] = useState<string | null>(finalisedAt ?? null);

  // PATH A states (2026-05-15):
  //   - "submitted but still editable" — submittedAt set, token still active,
  //     not finalised. UI shows a "still editable" banner + 🔒 Lock button.
  //   - "finalised" — coach explicitly locked. Token cleared. Permanent.
  //   - "never submitted" — no submittedAt. Same as before.
  const hasSubmittedRecord = Boolean(submittedAt);
  const isFinalised = Boolean(localFinalisedAt);
  const isEditableAfterSubmit = hasSubmittedRecord && !isFinalised && Boolean(token);

  async function handleFinalise() {
    if (!confirm(
      "Lock the intake form? The client will no longer be able to edit. " +
      "Use this just before your intake call so the version you review is final."
    )) return;
    setLoading(true);
    setError(null);
    try {
      const { finaliseIntakeForm } = await import("@/lib/server-actions/intake");
      const res = await finaliseIntakeForm(clientId);
      if (!res.ok) {
        setError(res.error || "Failed to lock intake");
        return;
      }
      setLocalFinalisedAt(res.intake_finalised_at);
      setToken(null);
      setExpiresAt(null);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to lock intake");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const { generateIntakeToken } = await import(
        "@/lib/server-actions/intake"
      );
      const res = await generateIntakeToken(clientId, 14);
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

  async function handleSendViaApi() {
    setApiSending(true);
    setApiSentOk(false);
    setError(null);
    try {
      const { sendIntakeInviteViaApi } = await import("@/lib/server-actions/intake");
      const res = await sendIntakeInviteViaApi(clientId);
      if (!res.ok) {
        setError(res.error || "Send failed");
        return;
      }
      setApiSentOk(true);
      // Clear the success badge after a few seconds so coach can resend if needed.
      setTimeout(() => setApiSentOk(false), 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setApiSending(false);
    }
  }

  async function handleRevoke() {
    if (!token) return;
    if (!confirm("Revoke this intake link? The client will no longer be able to use it.")) {
      return;
    }
    setLoading(true);
    try {
      const { revokeIntakeToken } = await import(
        "@/lib/server-actions/intake"
      );
      const res = await revokeIntakeToken(clientId);
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
      // clipboard API can fail in some browser contexts; fall back to alert
      alert("Copy failed — please select and copy the URL manually.");
    }
  }

  const publicUrl = token ? buildPublicUrl(`/intake/${token}`) : "";
  const phone = (mobileNumber || "").trim();
  const waLink =
    publicUrl && phone
      ? buildWhatsappLink(phone, displayName || "", publicUrl)
      : "";

  return (
    <FmPanel
      title="📝 Client intake form"
      subtitle="Send a tokenised link the client fills before the session"
    >
      <div style={{ display: "grid", gap: 10 }}>
        {hasSubmittedRecord && !isFinalised && (
          <div
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              background: "rgba(245, 158, 11, 0.08)",
              border: "1px solid rgba(245, 158, 11, 0.40)",
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 2 }}>
              ✓ Submitted {submittedAt ? new Date(submittedAt).toLocaleDateString() : "—"}
              {lastSubmittedAt && lastSubmittedAt !== submittedAt && (
                <span style={{ fontWeight: 400, opacity: 0.7 }}>
                  {" "}· last edit {new Date(lastSubmittedAt).toLocaleDateString()}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, opacity: 0.85, lineHeight: 1.4 }}>
              Client can still edit until you lock the form. Hit{" "}
              <strong>🔒 Lock intake</strong> before the intake call so the version
              you review is final.
            </div>
            <button
              type="button"
              onClick={handleFinalise}
              disabled={loading}
              style={{
                marginTop: 8,
                padding: "5px 10px",
                fontSize: 12,
                fontWeight: 600,
                background: "#b45309",
                color: "#fff",
                border: 0,
                borderRadius: 6,
                cursor: loading ? "wait" : "pointer",
              }}
            >
              {loading ? "Locking…" : "🔒 Lock intake"}
            </button>
          </div>
        )}

        {isFinalised && (
          <div
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              background: "rgba(16, 185, 129, 0.08)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              fontSize: 13,
            }}
          >
            🔒 Intake locked on{" "}
            {localFinalisedAt ? new Date(localFinalisedAt).toLocaleDateString() : "—"}.
            See Sessions tab → quick_note for the captured intake.
          </div>
        )}

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
            {loading
              ? "Generating…"
              : isFinalised
                ? "📨 Send a new intake form"
                : "📨 Send intake form"}
          </button>
        )}

        {token && open && (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Link active until{" "}
              {expiresAt
                ? new Date(expiresAt).toLocaleString()
                : "—"}
              . Single-use — clears when the client submits.
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

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {phone ? (
                <>
                  {/* Primary: send via WA server API — message arrives from
                      the registered Cloud API number (+91 89765 63971),
                      not the coach's personal phone. Uses fm_intake_invite. */}
                  <button
                    type="button"
                    onClick={handleSendViaApi}
                    disabled={apiSending}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 6,
                      background: "#25D366",
                      color: "white",
                      border: "none",
                      cursor: apiSending ? "wait" : "pointer",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    {apiSending ? "Sending…" : "📨 Send via WhatsApp"}
                  </button>
                  {apiSentOk && (
                    <span style={{ fontSize: 12, color: "#059669", fontWeight: 600 }}>
                      ✓ Sent
                    </span>
                  )}
                  {/* Fallback: open the coach's own WhatsApp with pre-filled
                      text. Sends from the coach's personal/business number on
                      their phone, NOT from +91 89765 63971. Kept for when
                      API send is offline or coach prefers to review/edit. */}
                  <a
                    href={waLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: "8px 12px",
                      borderRadius: 6,
                      background: "transparent",
                      border: "1px solid rgba(0,0,0,0.15)",
                      color: "#374151",
                      textDecoration: "none",
                      fontWeight: 500,
                      fontSize: 12,
                    }}
                    title="Opens WhatsApp on your phone with pre-filled text — sends from whatever number's installed there (not the registered Cloud API number)"
                  >
                    Or open in WhatsApp app
                  </a>
                </>
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
