"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import {
  renderPlanHtmlAction,
  sendClientEmailAction,
  updateClientFieldsAction,
  recordLetterSendAction,
} from "@/app/api/email/actions";

interface Props {
  planSlug: string;
  clientId?: string;
  clientEmail?: string;
  clientName?: string;
}

export function SendToClientButton({ planSlug, clientId, clientEmail, clientName }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg border hover:bg-muted/50 transition-all flex items-center gap-1.5"
      >
        📧 Send to client
      </button>
      {open && (
        <SendModal
          planSlug={planSlug}
          clientId={clientId}
          clientEmail={clientEmail}
          clientName={clientName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────

function SendModal({
  planSlug,
  clientId,
  clientEmail,
  clientName,
  onClose,
}: {
  planSlug: string;
  clientId?: string;
  clientEmail?: string;
  clientName?: string;
  onClose: () => void;
}) {
  const [step,      setStep]      = useState<"compose" | "preview" | "done">("compose");
  const [isSending, setIsSending] = useState(false);
  const [to, setTo]           = useState(clientEmail ?? "");
  const [cc, setCc]           = useState("");
  // The "save this email to the client's profile" checkbox is shown when the
  // To value differs from the on-file client email, OR when the client has
  // no email on file at all. Default ON when client has no email so the
  // common case (filling in a missing email) just works.
  const [saveAsClientEmail, setSaveAsClientEmail] = useState<boolean>(false);
  const [subject, setSubject] = useState(`Your personalised health plan – ${planSlug}`);
  const [intro, setIntro]     = useState(
    clientName
      ? `Hi ${clientName},\n\nPlease find your personalised functional medicine plan below. Let me know if you have any questions!\n\nWith care,\nShivani`
      : "Hi,\n\nPlease find your personalised functional medicine plan below.\n\nWith care,\nShivani"
  );
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [renderError,  setRenderError]  = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewHtml, setPreviewHtml] = useState(false);

  const handlePreview = useCallback(async () => {
    setLoading(true);
    setRenderError(null);
    const result = await renderPlanHtmlAction(planSlug);
    setLoading(false);
    if (!result.ok) {
      setRenderError(result.error);
      return;
    }
    setRenderedHtml(result.html);
    setStep("preview");
  }, [planSlug]);

  const handleSend = useCallback(async () => {
    if (!to) { toast.error("Recipient email is required"); return; }
    if (!renderedHtml) { toast.error("Preview the plan first"); return; }

    setIsSending(true);

    // Wrap: intro message above the rendered plan
    const introHtml = `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.6; max-width: 600px; margin: 0 auto 32px; color: #333;">
  ${intro.split("\n").map(l => l ? `<p style="margin:0 0 8px;">${l}</p>` : "<br/>").join("")}
</div>
<hr style="border:none; border-top:1px solid #e5e7eb; margin-bottom:32px;" />
${renderedHtml}`;

    const result = await sendClientEmailAction({
      to,
      cc: cc.trim() || undefined,
      subject,
      htmlBody: introHtml,
    });

    setIsSending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    // Persist this send to _send_log.yaml — fire-and-forget so failures
    // here don't block the success flow.
    if (clientId) {
      try {
        void recordLetterSendAction({
          clientId,
          planSlug,
          // "consolidated" matches what renderPlanHtmlAction renders —
          // this modal sends the full plan, not partials.
          letterTypes: ["consolidated"],
          to: to.trim(),
          cc: cc.trim() || undefined,
        });
      } catch { /* non-fatal */ }
    }

    // If the coach checked "save to client's profile" AND we know the
    // client_id, persist the To value back as client.email. Runs after
    // the send so a successful send is the gating event.
    if (saveAsClientEmail && clientId && to.trim()) {
      try {
        const r = await updateClientFieldsAction(clientId, { email: to.trim() });
        if (!r.ok) {
          // Don't fail the whole flow — send already succeeded.
          toast.warning(`Sent, but couldn't save the email to profile: ${r.error}`);
        } else {
          toast.success(`Saved ${to.trim()} to client profile`);
        }
      } catch (e) {
        toast.warning(
          `Sent, but couldn't save the email to profile: ${(e as Error).message}`,
        );
      }
    }

    setStep("done");
    const ccNote = cc.trim() ? ` (cc ${cc.trim()})` : "";
    toast.success(`Plan sent to ${to}${ccNote}`);
  }, [to, cc, subject, intro, renderedHtml, saveAsClientEmail, clientId]);

  // Backdrop click closes
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="bg-background rounded-2xl shadow-2xl border w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="font-semibold text-sm flex items-center gap-2">
            <span>📧</span>
            <span>Send plan to client</span>
            {step === "preview" && (
              <span className="text-xs text-muted-foreground font-normal">— preview</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        {step === "done" ? (
          <div className="flex flex-col items-center justify-center gap-4 p-10 text-center">
            <div className="text-4xl">✅</div>
            <div className="font-semibold">Plan sent successfully!</div>
            <div className="text-sm text-muted-foreground">
              Sent to {to}
              {cc.trim() && <> · cc <span className="font-mono text-xs">{cc.trim()}</span></>}
            </div>
            <button
              onClick={onClose}
              className="mt-2 text-sm px-4 py-2 rounded-lg border hover:bg-muted/50"
            >
              Close
            </button>
          </div>
        ) : step === "preview" ? (
          <>
            <div className="flex-1 overflow-y-auto p-4">
              {/* Intro preview */}
              <div className="mb-4 p-3 rounded-lg border bg-muted/20 text-xs whitespace-pre-wrap text-muted-foreground">
                {intro}
              </div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Plan content preview
                </div>
                <button
                  onClick={() => setPreviewHtml(!previewHtml)}
                  className="text-[10px] text-muted-foreground hover:underline"
                >
                  {previewHtml ? "Show rendered" : "Show HTML source"}
                </button>
              </div>
              {previewHtml ? (
                <pre className="text-[10px] bg-muted/20 rounded p-3 overflow-auto max-h-64 font-mono">
                  {renderedHtml}
                </pre>
              ) : (
                <iframe
                  srcDoc={renderedHtml ?? ""}
                  className="w-full h-64 rounded-lg border bg-white"
                  title="Plan preview"
                  sandbox="allow-same-origin"
                />
              )}
            </div>
            <div className="flex items-center gap-3 px-5 py-4 border-t shrink-0">
              <button
                onClick={() => setStep("compose")}
                className="text-sm px-3 py-1.5 rounded-lg border hover:bg-muted/50"
              >
                ← Edit
              </button>
              <button
                disabled={isSending}
                onClick={handleSend}
                className="text-sm font-semibold px-4 py-1.5 rounded-lg text-white transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: "var(--brand-indigo)" }}
              >
                {isSending ? "Sending…" : `📤 Send to ${to}`}
              </button>
            </div>
          </>
        ) : (
          /* Compose */
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  To
                </label>
                <input
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="client@example.com"
                  className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                {/* "Save to client profile" checkbox.
                    Show when: (a) client has NO email on file AND coach typed
                    something, OR (b) coach typed something different from the
                    saved email. Default ON when client had no email (the
                    common "fill missing email" case); OFF when overwriting
                    so we don't surprise the coach. */}
                {clientId &&
                  to.trim() &&
                  to.trim().toLowerCase() !==
                    (clientEmail ?? "").trim().toLowerCase() && (
                    <label className="mt-2 flex items-start gap-2 text-[11px] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={saveAsClientEmail}
                        onChange={(e) => setSaveAsClientEmail(e.target.checked)}
                        className="mt-0.5 rounded"
                      />
                      <span className="text-muted-foreground leading-snug">
                        {clientEmail
                          ? (
                              <>
                                💾 Also save{" "}
                                <code className="font-mono text-[10px]">
                                  {to.trim()}
                                </code>{" "}
                                as this client&apos;s email (replaces the
                                current{" "}
                                <code className="font-mono text-[10px]">
                                  {clientEmail}
                                </code>
                                )
                              </>
                            )
                          : (
                              <>
                                💾 Save{" "}
                                <code className="font-mono text-[10px]">
                                  {to.trim()}
                                </code>{" "}
                                to this client&apos;s profile (no email on
                                file yet)
                              </>
                            )}
                      </span>
                    </label>
                  )}
                {!clientEmail && !to.trim() && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    No email saved for this client — type one above. Tick the
                    save checkbox to persist it to the client profile.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Cc <span className="font-normal normal-case text-muted-foreground/70">(optional — comma-separated)</span>
                </label>
                <input
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="partner@example.com, doctor@clinic.com"
                  className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Useful when looping in a family member, partner, or referring
                  clinician. They&apos;ll see the recipient list.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Intro message
                </label>
                <textarea
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                  rows={6}
                  className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  The rendered plan will be appended below this intro in the email.
                </p>
              </div>

              {renderError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {renderError}
                </div>
              )}

              {!process.env.GMAIL_USER && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  ⚠️ Add <code className="font-mono">GMAIL_USER</code> and{" "}
                  <code className="font-mono">GMAIL_APP_PASSWORD</code> to{" "}
                  <code className="font-mono">.env.local</code> to enable sending.
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 px-5 py-4 border-t shrink-0">
              <button
                onClick={onClose}
                className="text-sm px-3 py-1.5 rounded-lg border hover:bg-muted/50"
              >
                Cancel
              </button>
              <button
                onClick={handlePreview}
                disabled={loading}
                className="text-sm font-semibold px-4 py-1.5 rounded-lg text-white transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: "var(--brand-indigo)" }}
              >
                {loading ? "Rendering…" : "Preview & send →"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
