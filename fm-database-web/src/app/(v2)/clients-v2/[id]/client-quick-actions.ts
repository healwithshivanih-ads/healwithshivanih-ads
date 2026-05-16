/**
 * Shared client-context quick-action list — used by every /clients-v2/[id]/*
 * shell so the floating FAB shows the same client-scoped actions everywhere
 * the coach is "inside" a client.
 *
 * Curated to ONLY things truly "quick" — coach launches in <2 min, often
 * mid-conversation or right after hanging up. Workflows and viewers go
 * elsewhere:
 *   - Full assessment → primary CTA on the client page header (30–45 min
 *     workflow, not a side-action).
 *   - Past sessions → the Sessions tab (`?tab=sessions`).
 *   - Send letters → Plan tab → 📤 Send package.
 *   - Doctor handoff packet → per-session button or page header overflow.
 */
import type { FmFloatingActionItem } from "@/components/fm";

export function clientQuickActions(clientId: string): FmFloatingActionItem[] {
  return [
    {
      id: "quick-note",
      icon: "📝",
      label: "Quick note",
      hint: "Capture a thought, call, message",
      href: `/clients-v2/${clientId}/analyse/quick`,
    },
    {
      id: "active-plan-ref",
      icon: "📋",
      label: "Active plan reference",
      hint: "What are they on right now? — for mid-call lookups",
      href: `/clients-v2/${clientId}/reference`,
    },
    {
      // "📅 Send booking link" — routes coach to Communicate with the
      // booking picker pre-focused (auto-opens via ?picker=book).
      // Cleanest one-click path from any client page to "send me a
      // Discovery / Intake / Coaching booking link to <client>". Uses
      // the approved Meta template fm_book_session_v1 so it works
      // outside the 24-hour window. See SendBookingLinkPanel for the
      // 3-button layout that renders on arrival.
      id: "send-booking-link",
      icon: "📅",
      label: "Send booking link",
      hint: "Cal.com Discovery / Intake / Coaching — one tap",
      href: `/clients-v2/${clientId}/communicate?picker=book`,
    },
    {
      id: "check-in",
      icon: "💬",
      label: "Check-in session",
      hint: "Between-session adherence + Five Pillars",
      href: `/clients-v2/${clientId}/analyse/checkin`,
    },
    {
      id: "quick-message",
      icon: "📤",
      label: "Quick message",
      hint: "Templated WhatsApp — one-tap send",
      href: `/clients-v2/${clientId}/communicate`,
    },
    {
      id: "soap",
      icon: "📋",
      label: "SOAP Note",
      hint: "One-page S/O/A/P record — print or share for the file",
      href: `/clients-v2/${clientId}/soap`,
    },
  ];
}
