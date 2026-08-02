import type { Metadata, Viewport } from "next";
// The coach dashboard's own design system. Importing it (rather than copying
// its tokens) is what keeps the phone app from drifting: change a token there
// and it changes here.
import "@/styles/fm-v2.css";
import "./coach.css";

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
  themeColor: "#FF6B35",
};

/**
 * Covers the root layout's desktop sidebar with a fixed full-screen overlay —
 * the same approach the public intake form uses, because a nested layout
 * renders INSIDE the root one rather than replacing it.
 *
 * `fm-v2` carries the dashboard tokens; `m-app` carries the phone layer.
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
      className="fm-v2 m-app"
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
