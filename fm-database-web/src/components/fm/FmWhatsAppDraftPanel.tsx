"use client";

/**
 * FmWhatsAppDraftPanel — design 10B.
 *
 * Post-session AI-drafted WhatsApp follow-up. WhatsApp-styled preview bubble
 * on a tan background + editable textarea + Regenerate / Translate / Copy /
 * Send via WhatsApp.
 *
 * Wraps the existing draftFollowUpMessageAction (Haiku, Shivani's voice).
 * The "Send via WhatsApp" wiring uses the self-hosted WhatsApp server;
 * since template send requires a Meta-approved template (not free-form
 * text), the button defaults to Copy + open WhatsApp Web. A later commit
 * can wire a freeform-text send through the server once we have a
 * registered "open-text" template approved.
 */
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { FmPanel } from "./FmPanel";

export interface FmWhatsAppDraftPanelProps {
  clientId: string;
  clientName: string;
  clientPhone?: string;
  sessionId: string;
  sessionType: string;
  /** Optional language tag e.g. "Kannada" — drives the Translate button. */
  clientLanguage?: string;
  /** Async draft-generator. Reads the existing draftFollowUpMessageAction. */
  draftAction: (
    clientId: string,
    sessionId: string,
    sessionType: string,
  ) => Promise<{ ok: boolean; message?: string; error?: string }>;
}

export function FmWhatsAppDraftPanel({
  clientId,
  clientName,
  clientPhone,
  sessionId,
  sessionType,
  clientLanguage,
  draftAction,
}: FmWhatsAppDraftPanelProps) {
  const [draft, setDraft] = useState<string>("");
  const [generated, setGenerated] = useState(false);
  const [generateAt, setGenerateAt] = useState<Date | null>(null);
  const [pending, start] = useTransition();
  const [translating, startTranslate] = useTransition();

  const generate = () => {
    start(async () => {
      const r = await draftAction(clientId, sessionId, sessionType);
      if (r.ok && r.message) {
        setDraft(r.message);
        setGenerated(true);
        setGenerateAt(new Date());
      } else {
        toast.error(r.error ?? "Draft generation failed");
      }
    });
  };

  // Auto-generate on mount.
  useEffect(() => {
    if (!generated) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      toast.success("Draft copied to clipboard");
    } catch {
      toast.error("Couldn't access clipboard — select the text and copy manually.");
    }
  };

  const openWhatsApp = () => {
    if (!clientPhone) {
      toast.error("No phone number on file for this client");
      return;
    }
    // Strip non-digits, prepend country code if missing (default IN +91).
    let phone = clientPhone.replace(/\D/g, "");
    if (phone.length === 10) phone = `91${phone}`;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(draft)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const translate = () => {
    // Placeholder: actual translation would shell out to a Haiku call. For now
    // we just hint at the planned behaviour without firing an extra API call
    // before the coach asks for it.
    startTranslate(async () => {
      toast.info(
        clientLanguage
          ? `Translation to ${clientLanguage} not yet wired — Haiku call queued for Phase 4.`
          : "No client language preference on file — set Tz/lang in Settings.",
      );
    });
  };

  const charCount = draft.length;
  const smsEquiv = Math.max(1, Math.ceil(charCount / 160));

  return (
    <FmPanel
      style={{
        padding: 0,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--fm-border-light)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "var(--fm-bg-warm)",
            color: "var(--fm-primary-dark)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {clientName.split(" ").map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>
            {clientName}
            {clientPhone && (
              <span
                style={{
                  fontSize: 10.5,
                  color: "var(--fm-text-tertiary)",
                  fontWeight: 500,
                  marginLeft: 8,
                }}
              >
                · {clientPhone}
              </span>
            )}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--fm-text-tertiary)" }}>
            {generated && generateAt
              ? `Draft generated ${generateAt.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : pending
                ? "Generating draft…"
                : "Draft pending"}
          </div>
        </div>
        <span
          style={{
            padding: "2px 8px",
            borderRadius: "var(--fm-radius-pill)",
            background: "rgba(110, 76, 200, 0.10)",
            color: "#5a3fb0",
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: "uppercase",
          }}
        >
          AI draft
        </span>
      </div>

      {/* WhatsApp-styled preview */}
      <div style={{ padding: 14, background: "linear-gradient(180deg, #ECE5DD, #f2ebe0)" }}>
        {pending && !draft ? (
          <div
            style={{
              padding: "30px 0",
              textAlign: "center",
              fontSize: 12,
              color: "var(--fm-text-tertiary)",
            }}
          >
            ⏳ Haiku is drafting the follow-up…
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <div
              style={{
                maxWidth: "78%",
                padding: "10px 12px",
                background: "#DCF8C6",
                borderRadius: 8,
                fontSize: 12,
                lineHeight: 1.55,
                color: "#1a1a1a",
                whiteSpace: "pre-wrap",
                fontFamily:
                  "system-ui, -apple-system, sans-serif",
                boxShadow: "0 1px 0.5px rgba(0,0,0,0.13)",
              }}
            >
              {draft || "—"}
              {draft && (
                <div
                  style={{
                    fontSize: 9,
                    color: "#667781",
                    textAlign: "right",
                    marginTop: 3,
                  }}
                >
                  {new Date().toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  ✓
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Editor */}
      <div style={{ padding: 14, borderTop: "1px solid var(--fm-border-light)" }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            color: "var(--fm-text-tertiary)",
            marginBottom: 6,
          }}
        >
          Edit before sending
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={pending && !draft}
          style={{
            width: "100%",
            minHeight: 110,
            padding: 10,
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 12,
            fontFamily: "inherit",
            lineHeight: 1.55,
            resize: "vertical",
            outline: "none",
            background: "var(--fm-surface)",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 8,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={generate}
            disabled={pending}
            className="fm-btn"
            style={{
              background: "transparent",
              border: "1px solid var(--fm-border)",
              padding: "6px 10px",
              fontSize: 11,
              fontWeight: 600,
              borderRadius: "var(--fm-radius-sm)",
              cursor: pending ? "wait" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {pending ? "Regenerating…" : "↻ Regenerate"}
          </button>
          {clientLanguage && (
            <button
              type="button"
              onClick={translate}
              disabled={translating}
              style={{
                background: "transparent",
                border: "1px solid var(--fm-border)",
                padding: "6px 10px",
                fontSize: 11,
                fontWeight: 600,
                borderRadius: "var(--fm-radius-sm)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              🌐 Translate · {clientLanguage}
            </button>
          )}
          <span
            style={{
              flex: 1,
              fontSize: 10,
              color: "var(--fm-text-tertiary)",
            }}
          >
            {charCount} chars · ~{smsEquiv} SMS-equiv
          </span>
          <button
            type="button"
            onClick={copy}
            disabled={!draft}
            style={{
              background: "var(--fm-surface)",
              border: "1px solid var(--fm-border)",
              padding: "6px 10px",
              fontSize: 11,
              fontWeight: 600,
              borderRadius: "var(--fm-radius-sm)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            📋 Copy
          </button>
          <button
            type="button"
            onClick={openWhatsApp}
            disabled={!draft || !clientPhone}
            style={{
              background: "#25D366",
              color: "#fff",
              border: 0,
              padding: "7px 14px",
              fontSize: 11.5,
              fontWeight: 700,
              borderRadius: "var(--fm-radius-sm)",
              cursor: !draft || !clientPhone ? "not-allowed" : "pointer",
              opacity: !draft || !clientPhone ? 0.5 : 1,
              fontFamily: "inherit",
            }}
          >
            Send via WhatsApp
          </button>
        </div>
      </div>
    </FmPanel>
  );
}
