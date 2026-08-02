/**
 * Tab shell.
 *
 * A route GROUP (not a path segment) so /m/(tabs)/today resolves to /m/today.
 * Login and Settings sit OUTSIDE this group on purpose — a tab bar on the
 * login screen would offer navigation the session gate is about to refuse.
 */
import { TabBar } from "./tab-bar";

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      {/* Clears the fixed tab bar so the last row is never trapped under it. */}
      <div style={{ flex: 1, paddingBottom: 84 }}>{children}</div>
      <TabBar />
    </div>
  );
}
