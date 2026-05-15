"use client";

/**
 * Communicate hub client component — composes existing comms primitives.
 * Server-rendered data flows in via props; client interactions live here.
 */
import Link from "next/link";
import { useState } from "react";
import { SendPackageButton } from "@/components/client-widgets/send-package-button";
import { LetterTypesToggle } from "@/components/client-widgets/letter-types-toggle";
import { MessageTemplatesPanel } from "@/components/client-widgets/message-templates-panel";
import { WhatsAppThreadPanel } from "@/components/client-widgets/whatsapp-thread-panel";
import { FmPanel } from "@/components/fm";
// GeneratedLettersPanel was mounted here briefly to surface the meal plan
// inline with a chat. Removed 2026-05-15 — SendPackageButton already
// renders a preview + the same discuss→finalise refinement chat per
// letter type. Single edit surface, no duplication.

export interface CommunicateClientProps {
  clientId: string;
  displayName: string;
  clientEmail?: string;
  clientPhone?: string;
  activePlan: { slug: string; status: string } | null;
  whatsappConfigured: boolean;
  activeLetterTypes?: string[];
}

export function CommunicateClient({
  clientId,
  displayName,
  clientEmail,
  clientPhone,
  activePlan,
  whatsappConfigured,
  activeLetterTypes,
}: CommunicateClientProps) {
  const firstName = displayName.split(" ")[0];
  const isPublished = activePlan?.status === "published";
  // Live letter-types list — seeded from server prop, mutated by the
  // inline LetterTypesToggle. Lifting the state here means SendPackageButton
  // re-filters its checkbox grid the moment the coach toggles a chip;
  // no page refresh required.
  const seedLetterTypes =
    activeLetterTypes && activeLetterTypes.length > 0
      ? activeLetterTypes
      : ["consolidated"];
  const [liveLetterTypes, setLiveLetterTypes] = useState<string[]>(seedLetterTypes);

  return (
    <div className="fm-v2-2col tight">
      {/* LEFT — main comms surfaces */}
      <div style={{ minWidth: 0, display: "grid", gap: 16 }}>
        {/* Letters package */}
        <FmPanel
          title="📤 Client letters"
          subtitle={
            isPublished
              ? "Generate, edit and download / email. Brand-templated."
              : activePlan
                ? `Plan is ${activePlan.status.replace(/_/g, " ")} — activate to unlock letters.`
                : "No active plan yet."
          }
          rightSlot={
            activePlan && (
              <Link
                href={`/clients-v2/${clientId}/plan`}
                style={{
                  fontSize: 11,
                  color: "var(--fm-text-secondary)",
                  textDecoration: "underline",
                }}
              >
                ↗ Plan tab
              </Link>
            )
          }
        >
          {isPublished && activePlan ? (
            <>
              <LetterTypesToggle
                clientId={clientId}
                initial={liveLetterTypes}
                onChange={setLiveLetterTypes}
              />
              <SendPackageButton
                key={liveLetterTypes.join(",")}
                planSlug={activePlan.slug}
                clientId={clientId}
                clientEmail={clientEmail}
                clientName={displayName}
                activeLetterTypes={liveLetterTypes}
              />
            </>
          ) : (
            <div
              style={{
                fontSize: 12,
                color: "var(--fm-text-tertiary)",
                padding: "10px 14px",
                background: "var(--fm-bg-warm)",
                border: "1px dashed rgba(255, 107, 53, 0.4)",
                borderRadius: "var(--fm-radius-sm)",
              }}
            >
              {activePlan ? (
                <>
                  Plan <strong>{activePlan.slug}</strong> is{" "}
                  <strong>{activePlan.status.replace(/_/g, " ")}</strong>. Activate
                  on the Plan tab to lock the version + catalogue snapshot, then
                  letters become available here.
                </>
              ) : (
                <>
                  No plan to send. Start a Full Assessment to draft one.
                </>
              )}
            </div>
          )}
        </FmPanel>

        {/* Inline meal-plan viewer + chat USED to live here. Removed —
            SendPackageButton above already shows each saved letter with
            👁 Preview + the discuss→finalise chat inside the preview pane.
            One edit surface, one source of truth. */}

        {/* Quick message templates */}
        <MessageTemplatesPanel
          clientId={clientId}
          clientName={firstName}
          clientPhone={clientPhone}
          clientEmail={clientEmail}
          whatsappConfigured={whatsappConfigured}
        />

        {/* Email — link to legacy modal flow until v2 native */}
        {clientEmail && (
          <FmPanel
            title="✉️ Email client"
            subtitle="Compose + preview + send via Gmail SMTP. Renders the plan HTML for inline email body."
          >
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                fontSize: 12.5,
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
              {activePlan && isPublished && (
                <Link
                  href={`/clients-v2/${clientId}/plan/edit/${activePlan.slug}`}
                  style={{
                    padding: "8px 14px",
                    background: "var(--fm-primary)",
                    border: 0,
                    borderRadius: "var(--fm-radius-sm)",
                    textDecoration: "none",
                    color: "#fff",
                    fontWeight: 700,
                  }}
                >
                  📨 Send plan via email →
                </Link>
              )}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--fm-text-tertiary)",
                marginTop: 8,
              }}
            >
              The full compose-preview-send flow lives on the classic plan page
              while v2 email is being built. Quick mailto opens your default mail
              app with the address pre-filled.
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

        {/* WhatsApp send status (self-hosted Cloud API server) */}
        <FmPanel
          title="📡 WhatsApp"
          subtitle={
            whatsappConfigured
              ? "Outbound configured via the self-hosted WhatsApp Cloud API server."
              : "Outbound NOT configured. Set WHATSAPP_SERVER_URL + WHATSAPP_SERVER_API_KEY in .env.local."
          }
        >
          <div
            style={{
              fontSize: 11,
              color: whatsappConfigured
                ? "var(--fm-text-secondary)"
                : "var(--fm-text-tertiary)",
            }}
          >
            {whatsappConfigured ? (
              <>
                Templates sent via the self-hosted WhatsApp Cloud API server.
                Template names + approval status are managed in the WhatsApp
                Business Manager — see <code>docs/whatsapp-templates.md</code>.
              </>
            ) : (
              <>
                Add <code>WHATSAPP_SERVER_URL</code> + <code>WHATSAPP_SERVER_API_KEY</code>{" "}
                to <code>.env.local</code> and <code>pm2 reload all</code> to enable
                WhatsApp send.
              </>
            )}
          </div>
        </FmPanel>

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
          <WhatsAppThreadPanel clientId={clientId} clientName={displayName} />
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
