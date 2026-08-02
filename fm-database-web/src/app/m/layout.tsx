import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./coach.css";

/**
 * Inter is the design system's body face (Libre Baskerville is already loaded
 * by the root layout for display). Scoped to /m via next/font so the desktop
 * coach UI keeps its own stack.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Coach · The Ochre Tree",
  description: "Coach mobile companion",
  manifest: "/coach-app/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Coach", statusBarStyle: "default" },
  icons: { apple: "/coach-app/apple-touch-icon.png" },
};

/**
 * Phone-first viewport. `viewportFit: "cover"` + the safe-area padding below
 * keeps content clear of the notch and home indicator once installed.
 *
 * Deliberately NO maximumScale — pinch-to-zoom stays available. The usual
 * reason to pin it (Safari zooming when an input is focused) is solved by
 * giving fields a 16px font size instead; blocking zoom would break
 * magnification for anyone who needs it.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f4f3",
};

/**
 * Covers the root layout's desktop sidebar with a fixed full-screen overlay —
 * the same approach the public intake form uses, because a nested layout
 * renders INSIDE the root one rather than replacing it.
 *
 * Auth is NOT enforced here. The gate lives in src/proxy.ts so an
 * unauthenticated request never reaches React at all; a layout-level check
 * would run after routing and is easy to forget on a new page.
 */
export default function CoachMobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`m-app ${inter.variable}`}
      style={{
        position: "fixed",
        inset: 0,
        overflow: "auto",
        paddingTop: "env(safe-area-inset-top)",
        zIndex: 50,
      }}
    >
      {children}
    </div>
  );
}
