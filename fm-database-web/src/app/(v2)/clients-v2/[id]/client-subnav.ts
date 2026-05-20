/**
 * Single source of truth for the client-page sub-navigation.
 *
 * Adding a 7th tab? Add it here once, not 4 times across page shells.
 * Used by:
 *   /clients-v2/[id]/page.tsx           (Overview)
 *   /clients-v2/[id]/analyse/page.tsx   (Analyse)
 *   /clients-v2/[id]/plan/plan-page-shell.tsx
 *   /clients-v2/[id]/communicate/communicate-page-shell.tsx
 *   /clients-v2/[id]/sessions/sessions-page-shell.tsx
 */
export interface ClientSubnavTab {
  id: string;
  label: string;
  href: string;
}

export function clientSubnavTabs(clientId: string): ClientSubnavTab[] {
  // Ordered to follow the coaching workflow left → right:
  //   1. Overview    — who is this client? (snapshot, always first)
  //   2. Record      — discovery / intake / check-in capture forms
  //   3. Plan        — synthesise findings into a protocol
  //   4. Communicate — deliver the plan + ongoing messages
  //   5. History     — timeline of everything done with this client
  //   6. Catalogue   — reference material (end of the bar)
  // Renamed 2026-05-19: "Sessions" → "Record", "Timeline" → "History" so
  // the action-verb tab (Record) is unambiguous about what's behind it
  // and doesn't collide with the History bucket that shows past sessions.
  return [
    { id: "overview", label: "Overview", href: `/clients-v2/${clientId}` },
    { id: "analyse", label: "Record", href: `/clients-v2/${clientId}/analyse` },
    { id: "plan", label: "Plan", href: `/clients-v2/${clientId}/plan` },
    {
      id: "communicate",
      label: "Communicate",
      href: `/clients-v2/${clientId}/communicate`,
    },
    { id: "sessions", label: "History", href: `/clients-v2/${clientId}/sessions` },
    {
      id: "catalogue",
      label: "Catalogue",
      href: `/clients-v2/${clientId}/catalogue`,
    },
  ];
}
