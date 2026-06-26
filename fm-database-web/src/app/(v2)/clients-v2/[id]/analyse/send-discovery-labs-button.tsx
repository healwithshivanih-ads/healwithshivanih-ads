"use client";

/**
 * SendDiscoveryLabsButton — surfaces in the "Last discovery call" strip
 * on the analyse page. Lets the coach send the lab list saved at the
 * discovery call straight to the client via:
 *   - 👁 Preview (modal + Download HTML for print)
 *   - 📧 Email   (Gmail SMTP, intro paragraph + brand-wrapped HTML body)
 *   - 💬 WhatsApp (wa.me deep link with prose nudge)
 *
 * Re-uses the same render-lab-requisition.py shim that the plan-side
 * LabRequisitionButtons uses — the shim was extended to accept a
 * session_id alternative input shape, so the discovery requisition
 * comes out brand-identical to the plan-side one.
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { relativeTimeShort } from "@/lib/fmdb/session-utils";
import {
  generateDiscoveryLabRequisitionAction,
  emailLabRequisitionAction,
  sendDiscoveryLabsViaWhatsappAction,
} from "@/lib/server-actions/lab-requisition";
import { updateClientFieldsAction } from "@/app/api/email/actions";
import { copyText } from "@/lib/copy-text";

interface Props {
  sessionId: string;
  clientId: string;
  clientEmail?: string | null;
  labCount: number;
  /** ISO of most-recent fm_lab_reminder send (any channel — email or WA).
   *  Read from disk (sessions tagged [template: fm_lab_reminder]) so the
   *  button renders persisted "✓ Sent X ago · Resend" state across reloads
   *  — see feedback-send-buttons-persist-state memory. */
  lastSentAt?: string | null;
  /** Discovery app token — when set, the email offers the in-app booking path. */
  appToken?: string | null;
  /** Friendly system groups for the email's "why" line (from the panel pick). */
  whyGroups?: string[];
}

export function SendDiscoveryLabsButton({
  sessionId,
  clientId,
  clientEmail,
  labCount,
  lastSentAt,
  appToken,
  whyGroups,
}: Props) {
  const [pending, start] = useTransition();
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewMd, setPreviewMd] = useState<string>("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState(clientEmail ?? "");
  // Optimistic sent-state: seed from the persisted prop, flip immediately on a
  // successful send so the button shows "Sent · Resend" without a reload.
  const [sentAt, setSentAt] = useState<string | null>(lastSentAt ?? null);
  // Remember whether the client had an email on file at mount-time. If
  // not, we prompt to save the typed address to the client profile after
  // a successful send so the coach doesn't have to type it again next
  // time. (Same pattern is generalised across the app per coach rule.)
  const initialEmailOnFile = Boolean(clientEmail);

  const onPreview = () => {
    start(async () => {
      const r = await generateDiscoveryLabRequisitionAction(sessionId, clientId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setPreviewHtml(r.html);
      setPreviewMd(r.markdown);
    });
  };

  // Combined send: email (full sheet) + WhatsApp (templated nudge).
  // The WA template body says "full list in the email" so they MUST go
  // together — sending WA alone leaves the client looking for an email
  // that never arrived. If no email is on file we open the inline strip
  // first so the coach types one before either send fires.
  const onSendBoth = () => {
    const to = emailTo.trim();
    if (!to) {
      setEmailOpen(true);
      toast.message("Add the client's email — both sends fire from one tap.");
      return;
    }
    // Persisted-state guard: if labs were already sent (any channel),
    // confirm before re-firing. Coach rule
    // feedback-send-buttons-persist-state — every send button must gate
    // resends with the time of the last send visible in the prompt.
    if (sentAt) {
      const ago = relativeTimeShort(sentAt);
      const ok = confirm(
        `Lab list was already sent to this client ${ago}.\n\n` +
        `Send the email + WhatsApp nudge AGAIN?`
      );
      if (!ok) return;
    }
    start(async () => {
      const e = await emailLabRequisitionAction({ sessionId, clientId, to, appToken, whyGroups });
      if (!e.ok) {
        toast.error(`Email failed — ${e.error}. WhatsApp NOT sent.`);
        return;
      }
      const w = await sendDiscoveryLabsViaWhatsappAction({ sessionId, clientId });
      if (!w.ok) {
        toast.error(`Email sent to ${to}, but WhatsApp failed — ${w.error}`);
        return;
      }
      setEmailOpen(false);
      setSentAt(new Date().toISOString());
      const msg = `✓ Email sent to ${to} · 💬 WhatsApp nudge sent to ${w.sentTo}`;
      if (!initialEmailOnFile) {
        toast.success(msg, {
          duration: 9000,
          action: {
            label: "💾 Save email to profile",
            onClick: () => {
              start(async () => {
                const u = await updateClientFieldsAction(clientId, { email: to });
                if (u.ok) toast.success("Email saved to client profile");
                else toast.error(u.error ?? "Couldn't save");
              });
            },
          },
        });
      } else {
        toast.success(msg);
      }
    });
  };

  const onDownload = () => {
    if (!previewHtml) return;
    const blob = new Blob([previewHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lab-requisition-${sessionId}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const btn: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    padding: "5px 10px",
    background: "var(--fm-surface)",
    color: "var(--fm-text-secondary)",
    border: "1px solid var(--fm-border)",
    borderRadius: "var(--fm-radius-sm)",
    cursor: pending ? "wait" : "pointer",
    fontFamily: "inherit",
  };

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: "var(--fm-text-tertiary)",
          fontWeight: 600,
        }}
      >
        🔬 {labCount} lab{labCount === 1 ? "" : "s"} ordered
      </span>
      <button onClick={onPreview} disabled={pending} style={btn}>
        👁 Preview
      </button>
      <button
        onClick={onSendBoth}
        disabled={pending}
        style={{
          ...btn,
          background: sentAt ? "var(--fm-surface)" : "var(--fm-primary)",
          color: sentAt ? "var(--fm-text-secondary)" : "#fff",
          border: sentAt ? "1px solid var(--fm-border)" : 0,
        }}
        title={
          sentAt
            ? `Last sent ${relativeTimeShort(sentAt)} — tap to resend (confirm prompt)`
            : "Emails the full lab sheet AND sends the fm_lab_reminder WhatsApp nudge in one tap"
        }
      >
        {pending
          ? "Sending…"
          : sentAt
            ? `↻ Resend (sent ${relativeTimeShort(sentAt)})`
            : "📧 Send via Email and a WhatsApp Update"}
      </button>
      {sentAt && !pending && (
        <span
          style={{
            fontSize: 11,
            color: "#059669",
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
          title={`Last labs send recorded ${new Date(sentAt).toLocaleString()}`}
        >
          ✓ Sent {relativeTimeShort(sentAt)}
        </span>
      )}

      {/* Email-confirm inline strip */}
      {emailOpen && (
        <div
          style={{
            flex: "1 1 100%",
            marginTop: 6,
            padding: "6px 8px",
            background: "var(--fm-bg-warm)",
            border: "1px solid var(--fm-border-light)",
            borderRadius: "var(--fm-radius-sm)",
            display: "flex",
            gap: 6,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--fm-text-secondary)" }}>
            To:
          </span>
          <input
            type="email"
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            placeholder="client@email.com"
            disabled={pending}
            style={{
              fontSize: 12,
              padding: "3px 8px",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              minWidth: 200,
              flex: "1 1 200px",
            }}
          />
          {!initialEmailOnFile && (
            <span
              style={{
                fontSize: 11,
                color: "var(--fm-text-tertiary)",
                fontStyle: "italic",
                flex: "1 1 100%",
              }}
            >
              No email on file — you&apos;ll be asked to save this to the
              client&apos;s profile after sending.
            </span>
          )}
          <button
            onClick={onSendBoth}
            disabled={pending || !emailTo.trim()}
            style={{
              ...btn,
              background: "var(--fm-primary)",
              color: "#fff",
              border: 0,
            }}
          >
            {pending ? "Sending…" : "📧 Email + 💬 WhatsApp"}
          </button>
          <button onClick={() => setEmailOpen(false)} disabled={pending} style={btn}>
            Cancel
          </button>
        </div>
      )}

      {/* Preview modal */}
      {previewHtml && (
        <div
          onClick={() => setPreviewHtml(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(20,20,24,0.55)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 8,
              maxWidth: 820,
              width: "100%",
              maxHeight: "92vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 14px",
                borderBottom: "1px solid #eee",
                background: "var(--fm-bg-warm)",
              }}
            >
              <strong style={{ fontSize: 13 }}>
                📄 Discovery lab list — preview
              </strong>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={onDownload} style={btn}>
                  ⬇ Download HTML
                </button>
                <button
                  onClick={() =>
                    copyText(previewMd).then((ok) =>
                      ok ? toast.success("Markdown copied") : toast.error("Copy failed"),
                    )
                  }
                  style={btn}
                >
                  📋 Copy markdown
                </button>
                <button onClick={() => setPreviewHtml(null)} style={btn}>
                  ✕ Close
                </button>
              </div>
            </div>
            <iframe
              srcDoc={previewHtml}
              style={{ flex: 1, border: 0, width: "100%" }}
              title="Discovery lab list preview"
            />
          </div>
        </div>
      )}
    </div>
  );
}
