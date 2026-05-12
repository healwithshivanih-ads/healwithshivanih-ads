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
    { id: "analyse", label: "Analyse", href: `/clients-v2/${clientId}/analyse` },
    { id: "sessions", label: "Sessions", href: `/clients-v2/${clientId}/sessions` },
    { id: "plan", label: "Plan", href: `/clients-v2/${clientId}/plan` },
    {
      id: "communicate",
      label: "Communicate",
      href: `/clients-v2/${clientId}/communicate`,
    },
    { id: "catalogue", label: "Catalogue", href: "/catalogue" },
  ];
}
