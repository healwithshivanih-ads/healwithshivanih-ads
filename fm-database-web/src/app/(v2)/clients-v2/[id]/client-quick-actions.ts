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
