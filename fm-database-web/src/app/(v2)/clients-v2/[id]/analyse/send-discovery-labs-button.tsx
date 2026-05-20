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
import {
  generateDiscoveryLabRequisitionAction,
  emailLabRequisitionAction,
  sendDiscoveryLabsViaWhatsappAction,
} from "@/lib/server-actions/lab-requisition";
import { updateClientFieldsAction } from "@/app/api/email/actions";

interface Props {
  sessionId: string;
  clientId: string;
  clientEmail?: string | null;
  labCount: number;
}

export function SendDiscoveryLabsButton({
  sessionId,
  clientId,
  clientEmail,
  labCount,
}: Props) {
  const [pending, start] = useTransition();
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewMd, setPreviewMd] = useState<string>("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState(clientEmail ?? "");
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

  const onEmail = () => {
    const to = emailTo.trim();
    if (!to) {
      toast.error("Add an email address first");
      return;
    }
    start(async () => {
      const r = await emailLabRequisitionAction({
        sessionId,
        clientId,
        to,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setEmailOpen(false);
      // If the client.yaml had no email on file when this component
      // mounted, offer to save the typed address now. Coach rule:
      // "when an email is sent and no email on file, give the option to
      // save it" — applies across every client-email send surface.
      if (!initialEmailOnFile) {
        toast.success(`✉ Lab list emailed to ${to}`, {
          duration: 9000,
          action: {
            label: "💾 Save to profile",
            onClick: () => {
              start(async () => {
                const u = await updateClientFieldsAction(clientId, { email: to });
                if (u.ok) {
                  toast.success("Email saved to client profile");
                } else {
                  toast.error(u.error ?? "Couldn't save");
                }
              });
            },
          },
        });
      } else {
        toast.success(`✉ Lab list emailed to ${to}`);
      }
    });
  };

  const onWhatsApp = () => {
    // Route through the in-app WhatsApp pipeline (Meta-approved
    // `fm_lab_reminder` template) — NO native wa.me handoff. The full
    // sheet ships via email; the WhatsApp message is a templated nudge
    // with the panel summary.
    start(async () => {
      const r = await sendDiscoveryLabsViaWhatsappAction({
        sessionId,
        clientId,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`💬 WhatsApp sent to ${r.sentTo}`);
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
        onClick={() => setEmailOpen((v) => !v)}
        disabled={pending}
        style={btn}
      >
        📧 Email
      </button>
      <button onClick={onWhatsApp} disabled={pending} style={btn}>
        💬 WhatsApp
      </button>

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
            onClick={onEmail}
            disabled={pending || !emailTo.trim()}
            style={{
              ...btn,
              background: "var(--fm-primary)",
              color: "#fff",
              border: 0,
            }}
          >
            {pending ? "Sending…" : "Send"}
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
                    navigator.clipboard
                      .writeText(previewMd)
                      .then(() => toast.success("Markdown copied"))
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
