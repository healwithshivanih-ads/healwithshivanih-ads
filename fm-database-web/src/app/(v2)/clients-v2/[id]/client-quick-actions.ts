/**
 * Shared client-context quick-action list — used by every /clients-v2/[id]/*
 * shell so the floating FAB shows the same client-scoped actions everywhere
 * the coach is "inside" a client.
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
      id: "full-assessment",
      icon: "🔬",
      label: "Full assessment",
      hint: "AI synthesis from intake + reports",
      href: `/clients-v2/${clientId}/analyse/full`,
    },
    {
      id: "communicate",
      icon: "📤",
      label: "Send letters / message",
      hint: "Letters, templates, WhatsApp",
      href: `/clients-v2/${clientId}/communicate`,
    },
    {
      id: "handoff",
      icon: "🏥",
      label: "Doctor handoff PDF",
      hint: "Print-ready summary for a referring clinician",
      href: `/clients-v2/${clientId}/handoff`,
    },
  ];
}
