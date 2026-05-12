/**
 * Dashboard v2 segment layout — imports the v2 token stylesheet so the
 * tokens are available to every page in this segment. The .fm-v2 root
 * class on each page scopes the tokens (and the design overlay).
 */
import "@/styles/fm-v2.css";

export default function DashboardV2Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
