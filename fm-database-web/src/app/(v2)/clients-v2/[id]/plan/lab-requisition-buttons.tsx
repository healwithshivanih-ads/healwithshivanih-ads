"use client";

/**
 * LabRequisitionButtons — 3 actions for the lab requisition sheet:
 *   - 👁 Preview (modal with HTML preview + Download)
 *   - 📧 Email   (sends via Gmail SMTP to the on-file address)
 *   - 💬 WhatsApp (opens wa.me deep link with a short prose nudge for
 *                  the coach to approve + send from her own WhatsApp)
 *
 * Mounted inside LabsViewPanel — visible whenever lab orders exist.
 * Becomes the primary action when retests are overdue / due-soon (parent
 * panel decides emphasis via the `prominent` prop).
 */

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  generateLabRequisitionAction,
  emailLabRequisitionAction,
  sendDiscoveryLabsViaWhatsappAction,
} from "@/lib/server-actions/lab-requisition";
import { getLastSentAtAction } from "@/app/api/whatsapp/actions";
import { updateClientFieldsAction } from "@/app/api/email/actions";
import { relativeTimeShort } from "@/lib/fmdb/session-utils";
import { copyText } from "@/lib/copy-text";

interface Props {
  planSlug: string;
  clientId: string;
  clientEmail?: string | null;
  prominent?: boolean;
}

export function LabRequisitionButtons({
  planSlug,
  clientId,
  clientEmail,
  prominent,
}: Props) {
  const [pending, start] = useTransition();
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewMd, setPreviewMd] = useState<string>("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState(clientEmail ?? "");
  // Coach rule: when no email on file and one's typed at send time,
  // prompt to save it back to client.yaml.
  const initialEmailOnFile = Boolean(clientEmail);
  // Persisted WhatsApp sent_at — loaded from session files on mount.
  // Implements durable rule: feedback_send_buttons_persist_state 2026-05-23.
  const [waSentAt, setWaSentAt] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { sentAt } = await getLastSentAtAction(clientId, "fm_lab_reminder");
      setWaSentAt(sentAt);
    })();
  }, [clientId]);

  const onPreview = () => {
    start(async () => {
      const r = await generateLabRequisitionAction(planSlug, clientId);
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
        planSlug,
        clientId,
        to,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setEmailOpen(false);
      if (!initialEmailOnFile) {
        toast.success(`✉ Requisition emailed to ${to}`, {
          duration: 9000,
          action: {
            label: "💾 Save to profile",
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
        toast.success(`✉ Requisition emailed to ${to}`);
      }
    });
  };

  const onWhatsApp = () => {
    // Route through in-app WhatsApp pipeline (Meta-approved
    // `fm_lab_reminder` template) — no native wa.me handoff.
    start(async () => {
      const r = await sendDiscoveryLabsViaWhatsappAction({
        planSlug,
        clientId,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const now = new Date().toISOString();
      setWaSentAt(now);
      toast.success(`💬 WhatsApp sent to ${r.sentTo}`);
    });
  };

  const onDownload = () => {
    if (!previewHtml) return;
    const blob = new Blob([previewHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lab-requisition-${planSlug}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const btnStyle: React.CSSProperties = prominent
    ? {
        padding: "6px 12px",
        fontSize: 12,
        fontWeight: 700,
        background: "var(--fm-primary)",
        color: "#fff",
        border: 0,
        borderRadius: "var(--fm-radius-sm)",
        cursor: pending ? "wait" : "pointer",
      }
    : {
        padding: "5px 10px",
        fontSize: 11,
        fontWeight: 600,
        background: "var(--fm-surface)",
        color: "var(--fm-text-secondary)",
        border: "1px solid var(--fm-border)",
        borderRadius: "var(--fm-radius-sm)",
        cursor: pending ? "wait" : "pointer",
      };

  return (
    <>
      <div
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: prominent ? 0 : "1px dashed var(--fm-border-light)",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        {!prominent && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: "var(--fm-text-tertiary)",
              marginRight: 4,
            }}
          >
            📄 Lab requisition sheet
          </span>
        )}
        <button onClick={onPreview} disabled={pending} style={btnStyle}>
          👁 Preview
        </button>
        <button onClick={() => setEmailOpen((v) => !v)} disabled={pending} style={btnStyle}>
          📧 Email to client
        </button>
        <button onClick={onWhatsApp} disabled={pending} style={waSentAt ? { ...btnStyle, borderColor: "rgba(16, 185, 129, 0.45)" } : btnStyle}>
          {waSentAt ? `✓ WA ${relativeTimeShort(waSentAt)} · Resend` : "💬 WhatsApp"}
        </button>
      </div>

      {/* Email-confirm inline panel */}
      {emailOpen && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 10px",
            background: "var(--fm-bg-warm)",
            border: "1px solid var(--fm-border-light)",
            borderRadius: "var(--fm-radius-sm)",
            display: "flex",
            gap: 6,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--fm-text-secondary)" }}>To:</span>
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
          <button
            onClick={onEmail}
            disabled={pending || !emailTo.trim()}
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "4px 10px",
              background: "var(--fm-primary)",
              color: "#fff",
              border: 0,
              borderRadius: "var(--fm-radius-sm)",
              cursor: pending || !emailTo.trim() ? "not-allowed" : "pointer",
            }}
          >
            {pending ? "Sending…" : "Send"}
          </button>
          <button
            onClick={() => setEmailOpen(false)}
            disabled={pending}
            style={{
              fontSize: 11,
              padding: "4px 10px",
              background: "transparent",
              color: "var(--fm-text-tertiary)",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              cursor: "pointer",
            }}
          >
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
            background: "rgba(0,0,0,0.5)",
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
              <strong style={{ fontSize: 13 }}>📄 Lab requisition preview</strong>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={onDownload} style={{ ...btnStyle, padding: "4px 10px" }}>
                  ⬇ Download HTML
                </button>
                <button
                  onClick={() => copyText(previewMd).then(() => toast.success("Markdown copied"))}
                  style={{ ...btnStyle, padding: "4px 10px" }}
                >
                  📋 Copy markdown
                </button>
                <button
                  onClick={() => setPreviewHtml(null)}
                  style={{ ...btnStyle, padding: "4px 10px" }}
                >
                  ✕ Close
                </button>
              </div>
            </div>
            <iframe
              srcDoc={previewHtml}
              style={{ flex: 1, border: 0, width: "100%" }}
              title="Lab requisition preview"
            />
          </div>
        </div>
      )}
    </>
  );
}
