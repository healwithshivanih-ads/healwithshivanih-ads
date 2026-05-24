import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Recipe pack · Shivani Hari",
  description: "Recipes from your healing plan",
};

/**
 * Public client-facing layout for /recipes/<planSlug>. Mirrors the
 * intake/start/letter pattern — overlays the root coach sidebar via a
 * fixed full-screen container so the client never sees coach navigation
 * (Dashboard / Clients / Catalogue / etc). Fix F25 2026-05-23.
 */
export default function RecipesLayout({
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
