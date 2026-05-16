"use client";

/**
 * SendBookingLinkPanel — Communicate-page widget for sending a Cal.com
 * booking link to the open client.
 *
 * Why this exists: there's no Meta-approved template with a URL slot
 * for "schedule your next session", so we send free-text via the 24-h
 * WhatsApp conversation window. Coach picks an event type, edits the
 * pre-filled body (default_body from _calcom_links.yaml, with {{name}}
 * + {{url}} substituted), and hits Send.
 *
 * Outside the 24-h window Meta refuses free-text; the wa.me fallback
 * button opens the coach's own phone WhatsApp pre-filled with the body
 * — they can hit send from their phone.
 *
 * Coach can edit ~/fm-plans/_calcom_links.yaml to add / reorder event
 * types without redeploying.
 */
import { useEffect, useState } from "react";
import {
  loadCalcomLinksAction,
  sendCalcomLinkAction,
} from "@/app/api/whatsapp/calcom-actions";
import { renderCalcomBody, type CalcomLink } from "@/app/api/whatsapp/calcom-types";
import { FmPanel } from "@/components/fm";

interface Props {
  clientId: string;
  firstName: string;
  clientPhone?: string;
  /** When false, panel still renders but Send button is disabled with a
   *  hint about adding WHATSAPP_SERVER_URL to env. */
  whatsappConfigured: boolean;
}

export function SendBookingLinkPanel({
  clientId,
  firstName,
  clientPhone,
  whatsappConfigured,
}: Props) {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<CalcomLink[] | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  // Load the picker list on first expand. Refresh on every open so coach
  // can edit the yaml + reopen the panel to see new entries — no need
  // to refresh the whole page.
  useEffect(() => {
    if (!open) return;
    setResult(null);
    void (async () => {
      const r = await loadCalcomLinksAction();
      setLinks(r);
      if (r.length > 0 && !selectedSlug) {
        setSelectedSlug(r[0].slug);
      }
    })();
  }, [open, selectedSlug]);

  // Whenever the slug changes (or links load), re-render the body. Coach
  // edits override this — once they type anything, we stop auto-updating
  // and respect their text until they switch event type.
  const [bodyTouched, setBodyTouched] = useState(false);
  useEffect(() => {
    if (!links) return;
    const link = links.find((l) => l.slug === selectedSlug);
    if (!link) return;
    if (!bodyTouched) {
      setBody(renderCalcomBody(link, firstName));
    }
  }, [links, selectedSlug, firstName, bodyTouched]);

  const selectedLink = links?.find((l) => l.slug === selectedSlug);
  const canSend = !!clientPhone && whatsappConfigured && !!selectedLink && !!body.trim() && !sending;

  const handleSend = async () => {
    if (!selectedLink) return;
    setSending(true);
    setResult(null);
    const r = await sendCalcomLinkAction(clientId, selectedLink.slug, body);
    setResult(r);
    setSending(false);
    if (r.ok) {
      // Tell the WhatsApp thread panel to refresh immediately so the
      // outbound bubble appears in <1s instead of waiting for the 30s
      // auto-poll tick.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("whatsapp-message-sent", { detail: { clientId } }),
        );
      }
    }
  };

  const waMeUrl = clientPhone
    ? `https://wa.me/${clientPhone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(body)}`
    : undefined;

  return (
    <FmPanel
      title={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            font: "inherit",
            color: "inherit",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            textAlign: "left",
          }}
        >
          <span>📅 Send Cal.com booking link</span>
          <span
            style={{
              fontSize: 11,
              color: "var(--fm-text-tertiary)",
              fontWeight: 400,
              marginLeft: 4,
              transition: "transform 0.15s",
              transform: open ? "rotate(0deg)" : "rotate(-90deg)",
              display: "inline-block",
            }}
          >
            ▾
          </span>
          {!open && (
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 500,
                color: "var(--fm-text-tertiary)",
                marginLeft: "auto",
              }}
            >
              free-text · needs 24h window
            </span>
          )}
        </button>
      }
      subtitle={
        open
          ? `Sends as a regular WhatsApp message — works only when ${firstName} has messaged in the last 24 hours.`
          : undefined
      }
    >
      {open && (
        <div style={{ display: "grid", gap: 12 }}>
          {!links && (
            <div style={{ fontSize: 12, color: "var(--fm-text-tertiary)" }}>
              Loading event types…
            </div>
          )}

          {links && links.length === 0 && (
            <div
              style={{
                padding: "8px 10px",
                background: "rgba(245, 158, 11, 0.08)",
                border: "1px solid rgba(245, 158, 11, 0.3)",
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              No booking links configured. Add entries to{" "}
              <code>~/fm-plans/_calcom_links.yaml</code> and reopen this panel.
            </div>
          )}

          {links && links.length > 0 && (
            <>
              {/* Event type picker */}
              <div>
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    color: "var(--fm-text-secondary)",
                    marginBottom: 6,
                  }}
                >
                  Pick a booking type
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {links.map((l) => {
                    const active = l.slug === selectedSlug;
                    return (
                      <button
                        key={l.slug}
                        type="button"
                        onClick={() => {
                          setSelectedSlug(l.slug);
                          setBodyTouched(false);
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 999,
                          border: active ? "0" : "1px solid var(--fm-border)",
                          background: active ? "var(--fm-primary)" : "var(--fm-surface)",
                          color: active ? "#fff" : "var(--fm-text-primary)",
                          fontWeight: active ? 700 : 500,
                          fontSize: 12,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                        title={l.url}
                      >
                        {l.emoji} {l.label}
                      </button>
                    );
                  })}
                </div>
                {selectedLink && (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 10.5,
                      color: "var(--fm-text-tertiary)",
                      wordBreak: "break-all",
                    }}
                  >
                    URL: <code>{selectedLink.url}</code>
                  </div>
                )}
              </div>

              {/* Message body — editable. {{name}} + {{url}} already
                  substituted; coach can rephrase before sending. */}
              <div>
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    color: "var(--fm-text-secondary)",
                    marginBottom: 6,
                  }}
                >
                  Message — edit freely
                </div>
                <textarea
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    setBodyTouched(true);
                  }}
                  rows={6}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    border: "1px solid var(--fm-border)",
                    borderRadius: "var(--fm-radius-sm)",
                    fontSize: 12.5,
                    fontFamily: "inherit",
                    lineHeight: 1.5,
                    resize: "vertical",
                  }}
                />
              </div>

              {/* Status banners */}
              {!whatsappConfigured && (
                <div
                  style={{
                    fontSize: 11,
                    padding: "6px 10px",
                    background: "rgba(245, 158, 11, 0.08)",
                    border: "1px solid rgba(245, 158, 11, 0.3)",
                    borderRadius: 6,
                  }}
                >
                  WhatsApp outbound not configured — add{" "}
                  <code>WHATSAPP_SERVER_URL</code> to <code>.env.local</code>.
                  You can still use the wa.me fallback below.
                </div>
              )}
              {!clientPhone && (
                <div
                  style={{
                    fontSize: 11,
                    padding: "6px 10px",
                    background: "rgba(239, 68, 68, 0.08)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    borderRadius: 6,
                  }}
                >
                  No phone number on file for {firstName}. Add one on the
                  Overview tab first.
                </div>
              )}

              {/* Send buttons */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!canSend}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 6,
                    background: canSend ? "#25D366" : "rgba(0,0,0,0.1)",
                    color: "#fff",
                    border: 0,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: canSend ? "pointer" : "not-allowed",
                    fontFamily: "inherit",
                  }}
                >
                  {sending ? "Sending…" : "📤 Send via WhatsApp"}
                </button>
                {waMeUrl && (
                  <a
                    href={waMeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: "8px 14px",
                      borderRadius: 6,
                      background: "var(--fm-surface)",
                      border: "1px solid var(--fm-border)",
                      color: "var(--fm-text-primary)",
                      fontSize: 12,
                      fontWeight: 600,
                      textDecoration: "none",
                      fontFamily: "inherit",
                    }}
                    title="Opens WhatsApp on YOUR phone (not the Cloud API number) — useful as a fallback when the 24h window is closed."
                  >
                    Open on my phone (wa.me)
                  </a>
                )}
              </div>

              {result?.ok && (
                <div
                  style={{
                    fontSize: 12,
                    padding: "8px 10px",
                    background: "rgba(16, 185, 129, 0.10)",
                    border: "1px solid rgba(16, 185, 129, 0.35)",
                    color: "#065f46",
                    borderRadius: 6,
                  }}
                >
                  ✓ Sent to {firstName}.
                </div>
              )}
              {result && !result.ok && (
                <div
                  style={{
                    fontSize: 12,
                    padding: "8px 10px",
                    background: "rgba(239, 68, 68, 0.08)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "#7f1d1d",
                    borderRadius: 6,
                  }}
                >
                  ✗ {result.error}
                  {result.error?.includes("131047") && (
                    <div style={{ marginTop: 4, fontSize: 11 }}>
                      Meta&apos;s 24-hour conversation window is closed. Use
                      &ldquo;Open on my phone (wa.me)&rdquo; instead — sends
                      from your personal WhatsApp.
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </FmPanel>
  );
}
