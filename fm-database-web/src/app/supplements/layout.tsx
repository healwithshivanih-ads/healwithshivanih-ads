import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your supplements · Shivani Hari",
  description: "Order your protocol supplements",
};

/**
 * Public client-facing layout for /supplements/<planSlug>. Mirrors the
 * intake/start/letter pattern — overlays the root coach sidebar via a
 * fixed full-screen container so the client never sees coach navigation
 * (Dashboard / Clients / Catalogue / etc). Fix F25 2026-05-23.
 *
 * The page handler renders its own padding + width, so this layout is
 * a thin transparent shell.
 */
export default function SupplementsLayout({
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
