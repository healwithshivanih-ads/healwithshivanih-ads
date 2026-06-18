"use client";

/**
 * SendBookingLinkPanel — 3-button picker for Cal.com booking links.
 *
 * Always-expanded (no collapsible) — the panel IS the action. Coach
 * sees the 3 event types side-by-side and taps one to send.
 *
 * Each button uses the Meta-APPROVED template `fm_book_session_v1`:
 *   body: "Hi {{1}}, ready to book your next session? You can grab a
 *          time that works for you here: {{2}} — Shivani Hari / Your
 *          Functional Health Coach"
 * → params: [firstName, calComUrl]
 *
 * Why template (not free-text) by default: template sends work outside
 * Meta's 24-hour conversation window, so coach can send a booking link
 * to ANY client at any time without first nudging them. Free-text is
 * still available via the "✏️ Customise message" disclosure for the
 * "I want to add a personal note" case (only works in 24h window).
 *
 * Auto-opens via `?picker=book` query param — wired so the FAB's
 * "Send booking link" quick action on every client page lands here
 * with the picker already focused.
 */
import { useEffect, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  loadCalcomLinksAction,
  sendCalcomLinkTemplateAction,
  sendCalcomLinkAction,
} from "@/app/api/whatsapp/calcom-actions";
import { getLastSentAtBatchAction } from "@/app/api/whatsapp/actions";
import { renderCalcomBody, type CalcomLink } from "@/app/api/whatsapp/calcom-types";
import { FmPanel } from "@/components/fm";
import { relativeTimeShort } from "@/lib/fmdb/session-utils";

interface Props {
  clientId: string;
  firstName: string;
  clientPhone?: string;
  whatsappConfigured: boolean;
}

export function SendBookingLinkPanel({
  clientId,
  firstName,
  clientPhone,
  whatsappConfigured,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [links, setLinks] = useState<CalcomLink[] | null>(null);
  const [sendingSlug, setSendingSlug] = useState<string | null>(null);
  // lastSent: in-memory "just sent" (< 4s) — slug → timestamp ms
  const [lastSent, setLastSent] = useState<{ slug: string; at: number } | null>(null);
  // persistedSentAt: loaded from disk on mount — slug → ISO string
  // Implements durable rule: feedback_send_buttons_persist_state 2026-05-23
  const [persistedSentAt, setPersistedSentAt] = useState<Record<string, string | null>>({});
  const [customMode, setCustomMode] = useState(false);
  const [customSlug, setCustomSlug] = useState<string>("");
  const [customBody, setCustomBody] = useState("");
  const [customSending, setCustomSending] = useState(false);
  // Highlighted slug — coach landed here from a "Send booking link"
  // banner that pre-selected an event type via ?type=<slug>. Renders
  // a subtle ring on the recommended button so it's obvious which one
  // to click. Doesn't auto-send (coach still chooses).
  const [highlightedSlug, setHighlightedSlug] = useState<string | null>(null);

  // Load links on mount; refresh isn't needed unless coach edits yaml
  // and reloads the page.
  useEffect(() => {
    void (async () => {
      const r = await loadCalcomLinksAction();
      setLinks(r);
    })();
  }, []);

  // Once links are loaded, fetch persisted sent_at per slug from session files.
  // The send now records `fm_book_session_v2:${slug}` (UTILITY template that
  // delivers to cold contacts); historical sends recorded the v1 name. Check
  // BOTH so old "✓ sent" badges keep showing and new sends register too.
  useEffect(() => {
    if (!links || links.length === 0) return;
    const templateNames = links.flatMap((l) => [
      `fm_book_session_v2:${l.slug}`,
      `fm_book_session_v1:${l.slug}`,
    ]);
    void (async () => {
      const raw = await getLastSentAtBatchAction(clientId, templateNames);
      // Re-key from "fm_book_session_v{1,2}:slug" → "slug", keeping the most
      // recent timestamp across both template versions.
      const bySlug: Record<string, string | null> = {};
      for (const [tpl, at] of Object.entries(raw)) {
        const slug = tpl.replace(/^fm_book_session_v[12]:/, "");
        const prev = bySlug[slug];
        if (!prev || (at && at > prev)) bySlug[slug] = at;
      }
      setPersistedSentAt(bySlug);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, links?.length]);

  // Pick up `?type=<slug>` so the Booking-due banner can deep-link with
  // its recommended event type pre-highlighted (one-click intent).
  useEffect(() => {
    const t = searchParams.get("type");
    if (t) setHighlightedSlug(t);
  }, [searchParams]);

  // Auto-open the customise disclosure when ?picker=book&customise=1 is
  // present. Coach's mid-call FAB drops them here with the picker
  // focused — they pick a type and send in 1 click.
  useEffect(() => {
    if (searchParams.get("picker") === "book" && searchParams.get("customise") === "1") {
      setCustomMode(true);
    }
  }, [searchParams]);

  // Clear the ?picker=book param after first render so a re-navigation
  // doesn't keep retriggering. Best-effort; not critical if it lingers.
  useEffect(() => {
    if (searchParams.get("picker") === "book") {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("picker");
      params.delete("customise");
      params.delete("type");
      const next = params.toString();
      // Replace without scroll so the page doesn't jump
      router.replace(`${pathname}${next ? "?" + next : ""}`, { scroll: false });
    }
    // Only run on initial mount with the param — pathname intentionally omitted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!clientPhone) {
    return (
      <FmPanel
        title="📅 Send booking link"
        subtitle="Sends an approved Meta template — works outside the 24h conversation window."
      >
        <div
          style={{
            fontSize: 12,
            color: "#7f1d1d",
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            padding: "8px 12px",
            borderRadius: 6,
          }}
        >
          No mobile number on file for {firstName}. Add one on the Overview tab first.
        </div>
      </FmPanel>
    );
  }

  if (!whatsappConfigured) {
    return (
      <FmPanel
        title="📅 Send booking link"
        subtitle="WhatsApp outbound isn't configured."
      >
        <div
          style={{
            fontSize: 12,
            color: "#92400e",
            background: "rgba(245, 158, 11, 0.08)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            padding: "8px 12px",
            borderRadius: 6,
          }}
        >
          Add <code>WHATSAPP_SERVER_URL</code> + <code>WHATSAPP_SERVER_API_KEY</code> to <code>.env.local</code> to enable.
        </div>
      </FmPanel>
    );
  }

  const onSend = async (link: CalcomLink) => {
    setSendingSlug(link.slug);
    try {
      const r = await sendCalcomLinkTemplateAction(clientId, link.slug);
      if (r.ok) {
        const now = Date.now();
        setLastSent({ slug: link.slug, at: now });
        // Update persisted state immediately so reload shows the new timestamp
        setPersistedSentAt((prev) => ({
          ...prev,
          [link.slug]: new Date(now).toISOString(),
        }));
        toast.success(`📅 ${link.label} link sent to ${firstName}`);
        // Tell WhatsApp thread panel to refresh immediately
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("whatsapp-message-sent", { detail: { clientId } }),
          );
        }
      } else {
        toast.error(r.error);
      }
    } finally {
      setSendingSlug(null);
    }
  };

  const onCustomSend = async () => {
    if (!customSlug || !customBody.trim()) return;
    setCustomSending(true);
    try {
      const r = await sendCalcomLinkAction(clientId, customSlug, customBody);
      if (r.ok) {
        setLastSent({ slug: customSlug, at: Date.now() });
        toast.success(`📅 Custom booking message sent to ${firstName}`);
        setCustomMode(false);
        setCustomSlug("");
        setCustomBody("");
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("whatsapp-message-sent", { detail: { clientId } }),
          );
        }
      } else {
        toast.error(r.error);
      }
    } finally {
      setCustomSending(false);
    }
  };

  return (
    <FmPanel
      title="📅 Send booking link"
      subtitle={`Sends via approved UTILITY template fm_book_session_v2 — delivers any time, including to clients who haven't messaged recently.`}
    >
      <div style={{ display: "grid", gap: 12 }}>
        {!links && (
          <div style={{ fontSize: 12, color: "var(--fm-text-tertiary)" }}>Loading event types…</div>
        )}

        {links && links.length === 0 && (
          <div
            style={{
              padding: "8px 10px",
              background: "rgba(245, 158, 11, 0.08)",
              border: "1px dashed rgba(245, 158, 11, 0.3)",
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            No booking links configured. Add entries to{" "}
            <code>~/fm-plans/_calcom_links.yaml</code>.
          </div>
        )}

        {/* ── 3 one-click buttons ── */}
        {links && links.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(links.length, 3)}, minmax(0, 1fr))`,
              gap: 10,
            }}
          >
            {links.map((link) => {
              const recentlySent = lastSent?.slug === link.slug && Date.now() - lastSent.at < 4000;
              const diskSentAt = persistedSentAt[link.slug] ?? null;
              const sending = sendingSlug === link.slug;
              const isRecommended = highlightedSlug === link.slug && !recentlySent && !diskSentAt;
              return (
                <button
                  key={link.slug}
                  type="button"
                  onClick={() => onSend(link)}
                  disabled={sending || !!sendingSlug}
                  style={{
                    padding: "14px 12px",
                    background: recentlySent || diskSentAt
                      ? "rgba(16, 185, 129, 0.12)"
                      : isRecommended
                        ? "rgba(99, 102, 241, 0.08)"
                        : "var(--fm-surface)",
                    border: `${isRecommended ? 2 : 1}px solid ${
                      recentlySent || diskSentAt
                        ? "rgba(16, 185, 129, 0.45)"
                        : isRecommended
                          ? "#4338ca"
                          : "var(--fm-border)"
                    }`,
                    borderRadius: 10,
                    textAlign: "left",
                    cursor: sending ? "wait" : sendingSlug ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    transition: "background 0.15s, border-color 0.15s",
                    opacity: sendingSlug && !sending ? 0.5 : 1,
                    boxShadow: isRecommended ? "0 0 0 3px rgba(99, 102, 241, 0.18)" : "none",
                    position: "relative",
                  }}
                >
                  {isRecommended && (
                    <span
                      style={{
                        position: "absolute",
                        top: -8,
                        right: 8,
                        fontSize: 10,
                        fontWeight: 800,
                        background: "#4338ca",
                        color: "#fff",
                        padding: "2px 7px",
                        borderRadius: 4,
                        letterSpacing: 0.5,
                        textTransform: "uppercase",
                      }}
                    >
                      Recommended
                    </span>
                  )}
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{link.emoji}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fm-text-primary)" }}>
                    {link.label}
                  </div>
                  {link.tagline && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--fm-text-tertiary)",
                        marginTop: 4,
                        lineHeight: 1.4,
                      }}
                    >
                      {link.tagline}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: 11,
                      color: recentlySent || diskSentAt ? "#065f46" : "#25D366",
                      fontWeight: 600,
                      marginTop: 8,
                    }}
                  >
                    {sending
                      ? "Sending…"
                      : recentlySent
                        ? "✓ Sent"
                        : diskSentAt
                          ? `✓ Sent ${relativeTimeShort(diskSentAt)} · Resend`
                          : "📤 Send to " + firstName}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Customise disclosure (free-text, 24h window only) ── */}
        {links && links.length > 0 && (
          <details
            open={customMode}
            onToggle={(e) => setCustomMode((e.target as HTMLDetailsElement).open)}
            style={{
              fontSize: 11,
              border: "1px solid var(--fm-border-light)",
              borderRadius: 6,
              padding: "6px 10px",
            }}
          >
            <summary
              style={{
                cursor: "pointer",
                color: "var(--fm-text-secondary)",
                userSelect: "none",
                listStyle: "none",
              }}
            >
              ✏️ Customise message (free-text — only works if {firstName} messaged in the last 24h)
            </summary>
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {links.map((l) => (
                  <button
                    key={l.slug}
                    type="button"
                    onClick={() => {
                      setCustomSlug(l.slug);
                      setCustomBody(renderCalcomBody(l, firstName));
                    }}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: customSlug === l.slug ? "0" : "1px solid var(--fm-border)",
                      background:
                        customSlug === l.slug ? "var(--fm-primary)" : "var(--fm-surface)",
                      color: customSlug === l.slug ? "#fff" : "var(--fm-text-primary)",
                      fontWeight: customSlug === l.slug ? 700 : 500,
                      fontSize: 11,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {l.emoji} {l.label}
                  </button>
                ))}
              </div>
              {customSlug && (
                <>
                  <textarea
                    value={customBody}
                    onChange={(e) => setCustomBody(e.target.value)}
                    rows={5}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      border: "1px solid var(--fm-border)",
                      borderRadius: 6,
                      fontSize: 12,
                      fontFamily: "inherit",
                      lineHeight: 1.5,
                      resize: "vertical",
                    }}
                  />
                  <button
                    type="button"
                    onClick={onCustomSend}
                    disabled={customSending || !customBody.trim()}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 6,
                      background: customSending || !customBody.trim() ? "rgba(0,0,0,0.1)" : "#25D366",
                      color: "#fff",
                      border: 0,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: customSending ? "wait" : !customBody.trim() ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                      width: "fit-content",
                    }}
                    title="Free-text send via the 24-hour conversation window. Falls back to error if Meta refuses (window closed)."
                  >
                    {customSending ? "Sending…" : "📤 Send free-text"}
                  </button>
                </>
              )}
            </div>
          </details>
        )}
      </div>
    </FmPanel>
  );
}
