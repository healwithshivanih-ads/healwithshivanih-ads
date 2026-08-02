import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Coach · The Ochre Tree",
  description: "Coach mobile companion",
  manifest: "/coach-app/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Coach",
    statusBarStyle: "default",
  },
  icons: { apple: "/coach-app/apple-touch-icon.png" },
};

/**
 * Phone-first viewport. `viewportFit: "cover"` + the safe-area padding below
 * keeps content clear of the iPhone notch and home indicator once the app is
 * installed to the home screen and runs without browser chrome.
 *
 * Deliberately NO maximumScale — pinch-to-zoom stays available. The usual
 * reason to pin it (Safari zooming the page when a text input is focused) is
 * solved properly by giving inputs a 16px font size instead; blocking zoom
 * would break magnification for anyone who needs it.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2B2D42",
};

/**
 * Coach mobile app ("/m") layout.
 *
 * Covers the root layout's desktop sidebar with a fixed full-screen overlay —
 * same trick the public intake form uses (src/app/intake/layout.tsx), because
 * a nested layout renders INSIDE the root one rather than replacing it.
 *
 * Auth is NOT enforced here. The gate lives in src/proxy.ts so that an
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
      className="fixed inset-0 z-50 overflow-auto"
      style={{
        background: "var(--bone, #F7F4EF)",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {children}
    </div>
  );
}
