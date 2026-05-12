/**
 * Route group layout for the v2 shell — applies to /dashboard-v2,
 * /calendar, /messages, /settings, /help.
 *
 * Imports the v2 token stylesheet once so the tokens are available to every
 * page in the group. Pages wrap their content in <FmAppShell> to render the
 * sidebar + topbar.
 *
 * This layout nests inside the root layout (which still owns the legacy
 * SidebarNav for non-v2 routes). FmAppShell positions itself fixed inset:0
 * z:100 so it covers the legacy chrome — no flash, no scroll bleed.
 */
import "@/styles/fm-v2.css";

export default function V2Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
