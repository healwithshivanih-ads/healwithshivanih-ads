"use client";

/**
 * Communicate hub client component — composes existing comms primitives.
 * Server-rendered data flows in via props; client interactions live here.
 */
import Link from "next/link";
import { MessageTemplatesPanel } from "@/components/client-widgets/message-templates-panel";
import { SendBookingLinkPanel } from "@/components/client-widgets/send-booking-link-panel";
import { WhatsAppThreadPanel } from "@/components/client-widgets/whatsapp-thread-panel";
import { FmPanel } from "@/components/fm";
import { SendAppLinkButton } from "../send-app-link-button";
import { VoiceNoteSender } from "../voice-note-sender";
// Letter generation lives in the welcome-letter hero panel above
// (NewCommunicatePanel → LetterGenerateTrigger, consolidated only).
// This panel is now purely the comms surfaces: app link, voice note,
// booking link, message templates, email, contact, WhatsApp thread.

export interface CommunicateClientProps {
  clientId: string;
  displayName: string;
  clientEmail?: string;
  clientPhone?: string;
  activePlan: { slug: string; status: string } | null;
  whatsappConfigured: boolean;
  /** stable client app token — renders the 📲 share-the-app panel here
   *  (moved from the Plan tab 2026-06-12: sharing is communication) */
  appToken?: string | null;
}

export function CommunicateClient({
  clientId,
  displayName,
  clientEmail,
  clientPhone,
  activePlan,
  whatsappConfigured,
  appToken = null,
}: CommunicateClientProps) {
  const firstName = displayName.split(" ")[0];
  const isPublished = activePlan?.status === "published";

  return (
    <div className="fm-v2-2col tight">
      {/* LEFT — main comms surfaces */}
      <div style={{ minWidth: 0, display: "grid", gap: 16 }}>
        {/* 📲 Share the client app — moved here from the Plan tab
            (2026-06-12): sharing is communication; Plan edits content. */}
        {isPublished && (
          <SendAppLinkButton
            clientId={clientId}
            mobileNumber={clientPhone}
            displayName={displayName}
            existingToken={appToken}
          />
        )}

        {/* 🎙 Voice note — personal audio from the brand number, via the WA
            server /api/send type:audio path. Within the 24h window only. */}
        {whatsappConfigured && (
          <VoiceNoteSender clientId={clientId} displayName={displayName} />
        )}

        {/* Cal.com booking link — free-text WhatsApp send via 24h window.
            Reads ~/fm-plans/_calcom_links.yaml so coach can edit event
            types without redeploying. The #booking anchor lets other
            pages (analyse banner, dashboard schedule-due panel) deep-link
            here with the scroll target pre-set. */}
        <div id="booking" style={{ scrollMarginTop: 16 }}>
          <SendBookingLinkPanel
            clientId={clientId}
            firstName={firstName}
            clientPhone={clientPhone}
            whatsappConfigured={whatsappConfigured}
          />
        </div>

        {/* Quick message templates */}
        <MessageTemplatesPanel
          clientId={clientId}
          clientName={firstName}
          clientPhone={clientPhone}
          clientEmail={clientEmail}
          whatsappConfigured={whatsappConfigured}
        />

        {/* Email — quick mailto only. Coach feedback 2026-05-19: the
            "Send plan via email" button was removed from this panel.
            Sends always originate from the Letter Editor (so the
            saved, brand-formatted letter is what goes out), never from
            this generic Email panel where the source letter is
            ambiguous. */}
        {clientEmail && (
          <FmPanel
            title="✉️ Email client"
            subtitle="Quick mailto. For Send-with-attached-letter, open the letter in the editor and use its Send button."
          >
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                fontSize: 13,
                color: "var(--fm-text-secondary)",
              }}
            >
              <a
                href={`mailto:${clientEmail}`}
                style={{
                  padding: "8px 14px",
                  background: "var(--fm-surface)",
                  border: "1px solid var(--fm-border)",
                  borderRadius: "var(--fm-radius-sm)",
                  textDecoration: "none",
                  color: "var(--fm-text-primary)",
                  fontWeight: 600,
                }}
              >
                ✉ Quick mailto: {clientEmail}
              </a>
            </div>
          </FmPanel>
        )}
      </div>

      {/* RIGHT — sticky on wide; stacks under 1180px. */}
      <div className="fm-v2-2col-rail">
        {/* Contact */}
        <FmPanel title="📞 Contact" subtitle="Channels we can reach this client on.">
          <div style={{ display: "grid", gap: 8 }}>
            <ContactRow
              icon="✉"
              label="Email"
              value={clientEmail}
              href={clientEmail ? `mailto:${clientEmail}` : undefined}
            />
            <ContactRow
              icon="📱"
              label="WhatsApp / mobile"
              value={clientPhone}
              href={
                clientPhone
                  ? `https://wa.me/${clientPhone.replace(/[^0-9]/g, "")}`
                  : undefined
              }
            />
          </div>
        </FmPanel>

        {/* 📡 WhatsApp config-status panel removed 2026-05-16 — was
            developer-facing config info that duplicated /settings.
            When misconfigured, the SendPackageButton + reply box +
            template panel each surface their own "not configured"
            states with actionable guidance. */}
        {!whatsappConfigured && (
          <FmPanel
            title="⚠ WhatsApp not configured"
            subtitle="Outbound sends will fail until WHATSAPP_SERVER_URL + WHATSAPP_SERVER_API_KEY are set in .env.local."
          >
            <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
              Add the env vars and <code>pm2 reload all</code>. See{" "}
              <Link href="/settings" style={{ color: "var(--fm-primary)" }}>
                Settings →
              </Link>{" "}
              for the full integration status.
            </div>
          </FmPanel>
        )}

        {/* 💬 Full chat thread — combines outbound sends (logged here by
            recordOutboundMessageAction when the coach clicks Send via
            WhatsApp on a template) AND inbound replies (saved by
            /api/whatsapp-webhook as quick_note sessions tagged
            [source: whatsapp_webhook]). Rendered as chat bubbles —
            right-aligned green for outbound, left-aligned grey for
            inbound. Auto-refreshes every 30s. */}
        <FmPanel
          title="💬 WhatsApp conversation"
          subtitle="Full thread — what we sent + what the client replied. Bubbles auto-refresh every 30s; new replies show up within a minute of landing on the WhatsApp server."
        >
          <WhatsAppThreadPanel
            clientId={clientId}
            clientName={displayName}
            clientPhone={clientPhone}
          />
          <Link
            href={`/clients-v2/${clientId}/sessions`}
            style={{
              display: "inline-block",
              marginTop: 8,
              fontSize: 11,
              color: "var(--fm-text-secondary)",
              textDecoration: "underline",
            }}
          >
            ↗ View full session timeline (includes intake, check-ins, etc.)
          </Link>
        </FmPanel>
      </div>
    </div>
  );
}

function ContactRow({
  icon,
  label,
  value,
  href,
}: {
  icon: string;
  label: string;
  value?: string;
  href?: string;
}) {
  const content = (
    <>
      <span style={{ fontSize: 14, marginRight: 8 }}>{icon}</span>
      <span
        style={{
          fontSize: 10,
          color: "var(--fm-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: 0.6,
          fontWeight: 700,
          marginRight: 8,
        }}
      >
        {label}
      </span>
      {value ? (
        <span style={{ fontSize: 12, fontWeight: 600 }}>{value}</span>
      ) : (
        <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
          (not on file)
        </span>
      )}
    </>
  );
  if (!value) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "6px 10px",
          background: "var(--fm-bg-cool)",
          borderRadius: "var(--fm-radius-sm)",
        }}
      >
        {content}
      </div>
    );
  }
  return (
    <a
      href={href}
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel="noopener noreferrer"
      style={{
        display: "flex",
        alignItems: "center",
        padding: "6px 10px",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-sm)",
        textDecoration: "none",
        color: "var(--fm-text-primary)",
      }}
    >
      {content}
    </a>
  );
}
