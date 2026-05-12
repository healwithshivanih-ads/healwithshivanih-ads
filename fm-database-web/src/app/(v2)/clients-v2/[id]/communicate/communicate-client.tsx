"use client";

/**
 * Communicate hub client component — composes existing comms primitives.
 * Server-rendered data flows in via props; client interactions live here.
 */
import Link from "next/link";
import { SendPackageButton } from "@/app/clients/[id]/send-package-button";
import { MessageTemplatesPanel } from "@/app/clients/[id]/message-templates-panel";
import { FmPanel } from "@/components/fm";

interface AisensyMsg {
  date: string;
  text: string;
}

export interface CommunicateClientProps {
  clientId: string;
  displayName: string;
  clientEmail?: string;
  clientPhone?: string;
  activePlan: { slug: string; status: string } | null;
  aisensyConfigured: boolean;
  recentInbound: AisensyMsg[];
}

export function CommunicateClient({
  clientId,
  displayName,
  clientEmail,
  clientPhone,
  activePlan,
  aisensyConfigured,
  recentInbound,
}: CommunicateClientProps) {
  const firstName = displayName.split(" ")[0];
  const isPublished = activePlan?.status === "published";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 340px",
        gap: 20,
        alignItems: "start",
      }}
    >
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
            <SendPackageButton
              planSlug={activePlan.slug}
              clientId={clientId}
              clientEmail={clientEmail}
              clientName={displayName}
            />
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

        {/* Quick message templates */}
        <MessageTemplatesPanel
          clientId={clientId}
          clientName={firstName}
          clientPhone={clientPhone}
          aisensyConfigured={aisensyConfigured}
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
                  href={`/plans/${activePlan.slug}`}
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

      {/* RIGHT — sticky sidebar: contact + recent inbound */}
      <div
        style={{
          position: "sticky",
          top: 24,
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          paddingRight: 4,
          display: "grid",
          gap: 14,
        }}
      >
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

        {/* AiSensy status */}
        <FmPanel
          title="📡 AiSensy"
          subtitle={
            aisensyConfigured
              ? "Outbound configured. Templates go via the WhatsApp Business API."
              : "Outbound NOT configured. Set AISENSY_API_KEY in .env.local."
          }
        >
          <div
            style={{
              fontSize: 11,
              color: aisensyConfigured
                ? "var(--fm-text-secondary)"
                : "var(--fm-text-tertiary)",
            }}
          >
            {aisensyConfigured ? (
              <>
                Approved templates: fm_lab_reminder, fm_session_confirm,
                fm_supplement_instructions, fm_encouragement.{" "}
                <em>fm_checkin_nudge</em> pending AiSensy review — will auto-work
                once approved.
              </>
            ) : (
              <>
                Add <code>AISENSY_API_KEY</code> to <code>.env.local</code> and{" "}
                <code>pm2 restart fm-coach</code> to enable WhatsApp send.
              </>
            )}
          </div>
        </FmPanel>

        {/* Recent inbound */}
        <FmPanel
          title={`📥 Recent inbound (${recentInbound.length})`}
          subtitle="WhatsApp messages from this client in the last 30 days, captured via AiSensy webhook."
        >
          {recentInbound.length === 0 ? (
            <div
              style={{
                fontSize: 11,
                color: "var(--fm-text-tertiary)",
                padding: "6px 10px",
                background: "var(--fm-bg-cool)",
                borderRadius: "var(--fm-radius-sm)",
              }}
            >
              No inbound messages from this client in the last 30 days. Webhook
              must be live for capture (paid AiSensy plan).
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {recentInbound.map((m, i) => (
                <div
                  key={`${m.date}-${i}`}
                  style={{
                    padding: "7px 10px",
                    background: "var(--fm-surface)",
                    border: "1px solid var(--fm-border-light)",
                    borderRadius: "var(--fm-radius-sm)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--fm-text-tertiary)",
                      fontWeight: 600,
                    }}
                  >
                    {m.date}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      marginTop: 2,
                      lineHeight: 1.4,
                    }}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
            </div>
          )}
          <Link
            href={`/clients-v2/${clientId}/analyse`}
            style={{
              display: "inline-block",
              marginTop: 8,
              fontSize: 11,
              color: "var(--fm-text-secondary)",
              textDecoration: "underline",
            }}
          >
            ↗ View full session timeline
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
