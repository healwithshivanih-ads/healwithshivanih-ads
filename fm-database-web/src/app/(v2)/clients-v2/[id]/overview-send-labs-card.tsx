/**
 * OverviewSendLabsCard — surfaces the "send discovery lab list" controls on
 * the Overview right column, right above the Intake group panel.
 *
 * Why this exists (bug 2026-05-23):
 *   The lab-send buttons used to live ONLY on the Analyse tab. After a coach
 *   logs a discovery call from there, the next natural step is to send the
 *   client the lab list — but coaches often bounced back to Overview to do
 *   it, found only the prominent "📨 Send intake form" button, and sent the
 *   wrong template (fm_intake_invite) thinking it was labs. cl-010 Kshitija
 *   got the intake form twice in one session this way.
 *
 *   The panel self-hides unless the most-recent discovery session has a
 *   non-empty requested_labs list — so it appears only when there's
 *   actually a list pending to send.
 */
import { FmPanel } from "@/components/fm";
import { SendDiscoveryLabsButton } from "./analyse/send-discovery-labs-button";

interface Props {
  clientId: string;
  sessionId: string;
  labCount: number;
  clientEmail?: string | null;
  discoveryDateLabel?: string | null;
  /** ISO of most-recent fm_lab_reminder send to this client (any channel).
   *  When set, the inner button shows "✓ Sent X ago · Resend" instead of
   *  the fresh primary action. */
  lastSentAt?: string | null;
}

export function OverviewSendLabsCard({
  clientId,
  sessionId,
  labCount,
  clientEmail,
  discoveryDateLabel,
  lastSentAt,
}: Props) {
  return (
    <FmPanel
      title="🔬 Discovery labs — send to client"
      subtitle={
        discoveryDateLabel
          ? `From your discovery call on ${discoveryDateLabel}. Preview, email, or WhatsApp the list — the full sheet goes via email; WhatsApp is a templated nudge (fm_lab_reminder).`
          : `Preview, email, or WhatsApp the lab list — full sheet via email; WhatsApp is a templated nudge.`
      }
    >
      <SendDiscoveryLabsButton
        sessionId={sessionId}
        clientId={clientId}
        clientEmail={clientEmail ?? null}
        labCount={labCount}
        lastSentAt={lastSentAt ?? null}
      />
    </FmPanel>
  );
}
