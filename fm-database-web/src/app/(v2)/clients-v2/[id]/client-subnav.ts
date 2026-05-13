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
  return [
    { id: "overview", label: "Overview", href: `/clients-v2/${clientId}` },
    // "Analyse" was misleading — this tab is where every client contact
    // gets recorded (discovery, intake, full assessment, check-in, quick
    // note). Renamed to "Sessions" per coach.
    { id: "analyse", label: "Sessions", href: `/clients-v2/${clientId}/analyse` },
    // The old "Sessions" tab is a chronological inspector of prior
    // sessions — renamed to "Timeline" to disambiguate.
    { id: "sessions", label: "Timeline", href: `/clients-v2/${clientId}/sessions` },
    { id: "plan", label: "Plan", href: `/clients-v2/${clientId}/plan` },
    {
      id: "communicate",
      label: "Communicate",
      href: `/clients-v2/${clientId}/communicate`,
    },
    { id: "catalogue", label: "Catalogue", href: "/catalogue" },
  ];
}
