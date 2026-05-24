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
import { relativeTimeShort } from "@/lib/fmdb/session-utils";

interface Props {
  clientId: string;
  mobileNumber?: string | null;
  displayName?: string | null;
  existingToken?: string | null;          // if already issued + not submitted
  existingExpiresAt?: string | null;
  submittedAt?: string | null;
  lastSubmittedAt?: string | null;        // Path A — updates on each re-submit
  finalisedAt?: string | null;            // coach-locked, no more edits possible
  /** ISO timestamp of the most recent fm_intake_invite send to this client
   *  (derived from sessions tagged [template: fm_intake_invite]). When set,
   *  the "📨 Send via WhatsApp" button changes to "↻ Resend intake" and
   *  asks for confirmation — guards against the common misclick of resending
   *  intake when the coach actually meant to send a different template
   *  (e.g. lab list after a discovery call). Bug fix 2026-05-23. */
  lastIntakeSentAt?: string | null;
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
  lastIntakeSentAt,
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
  // B4 fix 2026-05-23 — detect expired tokens. Without this, the active-
  // link panel shows the URL as "Link active until 5/21/2026" long after
  // expiry, while the Progress card on the same page correctly says
  // "Link expired." Dhanishta cl-004 + Nidhi both hit this.
  const isExpired = Boolean(
    expiresAt && Date.parse(expiresAt) < Date.now(),
  );
  const hasUsableToken = Boolean(token) && !isExpired;
  const isEditableAfterSubmit = hasSubmittedRecord && !isFinalised && hasUsableToken;

  /**
   * B9 — undo a finalise. Coach asked 2026-05-23 (Deepti cl-011): how
   * do I re-issue a form for a client whose intake is locked? Previously
   * there was no path — the locked banner said "see Sessions tab" with
   * no way back. Now coach clicks this button, intake_finalised_at
   * clears, the Send-pre-discovery / Skip-full-intake buttons return,
   * and coach can mint a fresh token.
   */
  async function handleReopen() {
    if (!confirm(
      "Re-open the intake form so you can send a fresh link? " +
      "The client's previous answers stay on file and will pre-fill the new form. " +
      "After re-open, use the Send buttons that appear to issue a new link."
    )) return;
    setLoading(true);
    setError(null);
    try {
      const { reopenFinalisedIntake } = await import("@/lib/server-actions/intake");
      const res = await reopenFinalisedIntake(clientId);
      if (!res.ok) {
        setError(res.error || "Failed to re-open intake");
        return;
      }
      setLocalFinalisedAt(null);
      // Page refresh so the Send-and-unlock panel + IntakeProgressCard
      // re-derive from the new state. Without this the locked banner
      // would persist until next nav.
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to re-open intake");
    } finally {
      setLoading(false);
    }
  }

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

  /**
   * Generate an intake token.
   * - Default flow (unlockFull=false): client lands on the pre-discovery
   *   ~14-field form. Coach unlocks the full form post-signup via the
   *   UnlockFullIntakeButton on the Overview.
   * - Direct-signup flow (unlockFull=true): for referrals / returning
   *   clients / family-of-existing — anyone already committed. Atomically
   *   sets intake_full_unlocked_at + engagement_status=signed_up so the
   *   link serves the full intake form on first open.
   */
  async function handleGenerate(unlockFull: boolean = false) {
    setLoading(true);
    setError(null);
    try {
      const { generateIntakeToken } = await import(
        "@/lib/server-actions/intake"
      );
      const res = await generateIntakeToken(clientId, 14, unlockFull);
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
    // Misclick guard 2026-05-23: if intake was already sent to this client,
    // require an explicit confirm before resending. The most common slip
    // is the coach pressing "Send via WhatsApp" here when she meant to
    // send the discovery lab list (lives on a different surface) — and
    // the client gets the intake form for a second / third time.
    if (lastIntakeSentAt) {
      const sentAgo = relativeTimeShort(lastIntakeSentAt);
      const ok = confirm(
        `The intake form was already sent to this client ${sentAgo}.\n\n` +
        `Send it AGAIN? (If you meant to send the lab list after a discovery, ` +
        `cancel and use the “🔬 Send labs” panel above this one instead.)`
      );
      if (!ok) return;
    }
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
            <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.4 }}>
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
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(16, 185, 129, 0.08)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              fontSize: 13,
              display: "grid",
              gap: 8,
            }}
          >
            <div>
              🔒 Intake locked on{" "}
              {localFinalisedAt ? new Date(localFinalisedAt).toLocaleDateString() : "—"}.
              See Sessions tab → quick_note for the captured intake.
            </div>
            <button
              type="button"
              onClick={handleReopen}
              disabled={loading}
              style={{
                padding: "5px 10px",
                fontSize: 12,
                fontWeight: 600,
                background: "transparent",
                color: "#047857",
                border: "1px solid rgba(16, 185, 129, 0.5)",
                borderRadius: 6,
                cursor: loading ? "wait" : "pointer",
                width: "fit-content",
              }}
              title="Re-open so you can send a fresh editable link. Previous answers stay and pre-fill the new form."
            >
              {loading ? "Re-opening…" : "🔓 Re-open for edits + new send"}
            </button>
          </div>
        )}

        {/* Expired-token callout — when there's an old token on file
            that has timed out but the intake was never submitted, the
            previous UI showed "Link active until 5/21/2026" as if still
            valid (Dhanishta cl-004). Render an honest expired notice
            instead, then let the Send buttons below offer a fresh link. */}
        {!hasUsableToken && Boolean(token) && !isFinalised && !hasSubmittedRecord && (
          <div
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              background: "rgba(239, 68, 68, 0.06)",
              border: "1px solid rgba(239, 68, 68, 0.30)",
              fontSize: 13,
              color: "#991b1b",
            }}
          >
            ⏰ Previous link expired
            {expiresAt ? ` (${new Date(expiresAt).toLocaleDateString()})` : ""}.
            Generate a fresh one below.
          </div>
        )}

        {/* Send buttons render when there's no USABLE token (expired
            counts as no token here) AND intake isn't locked. Once
            finalised, the locked banner above explains the state;
            offering "send pre-discovery intake" would be wrong (intake
            is already captured) AND broken (the shim would issue a new
            token but submit-paths refuse on a locked record). For a
            Tier-1 top-up after lock, use the TierOneSuspicionsPanel on
            the Overview tab; for a full re-issue, unlock the intake
            first on the Coach Exam tab. */}
        {!hasUsableToken && !isFinalised && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              onClick={() => handleGenerate(false)}
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
                : "📨 Send pre-discovery intake (~10 min)"}
            </button>
            <button
              type="button"
              onClick={() => handleGenerate(true)}
              disabled={loading}
              title="For referrals, returning clients, or anyone who's already committed — skips the 10-min pre-discovery form."
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                background: "transparent",
                color: "#9a3412",
                border: "1px solid rgba(255, 107, 53, 0.40)",
                cursor: loading ? "wait" : "pointer",
                fontWeight: 600,
                fontSize: 13,
                textAlign: "left",
              }}
            >
              ⏩ Skip pre-discovery — send full intake (direct signup)
            </button>
            <div
              style={{
                fontSize: 11,
                color: "var(--fm-text-tertiary)",
                lineHeight: 1.45,
                paddingLeft: 2,
              }}
            >
              <strong>Default ↑</strong> sends the 10-min pre-discovery form.{" "}
              <strong>⏩ Skip</strong> is for referrals, returning clients, or anyone
              already committed — opens the full ~25-min intake directly and
              marks them signed up.
            </div>
          </div>
        )}

        {/* When intake is finalised AND no active token, surface the
            two legitimate re-issue paths so coach isn't stranded on this
            panel. Tier-1 top-up = a focused re-issue for just the Tier-1
            section (joints / lean / PEM / environment). Full re-issue
            requires explicit unlock first to make accidental data loss
            visible. */}
        {!hasUsableToken && isFinalised && (
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              color: "var(--fm-text-secondary)",
              padding: "4px 2px",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--fm-text-primary)" }}>
              Need to send something else?
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
              <li>
                For a <strong>full re-issue</strong>: tap{" "}
                <strong>🔓 Re-open for edits + new send</strong> in the locked
                banner above. The Send buttons return, and the client&apos;s
                previous answers pre-fill the new form.
              </li>
              <li>
                For a <strong>Tier-1 top-up</strong> only (joints / standing /
                PEM / mould / MCAS): open the Overview tab → <em>Tier 1 signals</em>
                {" "}panel → <em>Re-issue Tier 1 intake</em>.
              </li>
            </ul>
          </div>
        )}

        {hasUsableToken && open && (
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
                      the registered Cloud API number (+91 88501 76753),
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
                    {apiSending
                      ? "Sending…"
                      : lastIntakeSentAt
                        ? `↻ Resend intake (last sent ${relativeTimeShort(lastIntakeSentAt)})`
                        : "📨 Send via WhatsApp"}
                  </button>
                  {apiSentOk && (
                    <span style={{ fontSize: 12, color: "#059669", fontWeight: 600 }}>
                      ✓ Sent
                    </span>
                  )}
                  {/* Fallback: open the coach's own WhatsApp with pre-filled
                      text. Sends from the coach's personal/business number on
                      their phone, NOT from +91 88501 76753. Kept for when
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
