/**
 * Tab shell for the coach mobile app.
 *
 * A route GROUP (not a path segment) so /m/(tabs)/today resolves to /m/today.
 * Login and Settings deliberately sit OUTSIDE this group — a tab bar on the
 * login screen would offer navigation the session gate is about to refuse.
 */
import Link from "next/link";
import { C } from "../ui";

const TABS = [
  { href: "/m/today", label: "Today", icon: "◉" },
  { href: "/m/clients", label: "Clients", icon: "☰" },
];

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      {/* Bottom padding clears the fixed tab bar so the last row is never
          trapped underneath it. */}
      <div style={{ flex: 1, paddingBottom: 86 }}>{children}</div>

      <nav
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          background: "rgba(255,255,255,0.94)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          borderTop: `1px solid ${C.line}`,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "10px 0 12px",
              textDecoration: "none",
              color: C.body,
              fontSize: 11,
              letterSpacing: 0.3,
            }}
          >
            <div style={{ fontSize: 19, lineHeight: 1.1 }}>{t.icon}</div>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
