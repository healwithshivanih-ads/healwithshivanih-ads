import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your healing plan · Shivani Hari",
  description: "Your personalised wellness plan",
};

/**
 * Public client-facing layout for /letter/<token>. Sibling pattern to
 * supplements/layout.tsx + recipes/layout.tsx (Fix F25 2026-05-23) —
 * overlays the root coach sidebar via a fixed full-screen container so
 * the client never sees coach navigation.
 *
 * Up to v0.74, /letter/<token> hid the coach sidebar by rendering the
 * iframe with position: fixed; inset: 0. Fix F22 (2026-05-23) makes
 * the iframe inline + auto-sized so the outer page scrolls natively
 * — which surfaced the sidebar. This layout fixes that.
 */
export default function LetterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 overflow-auto"
      style={{ background: "#fafaf9" }}
    >
      {children}
    </div>
  );
}
