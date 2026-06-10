import type { Metadata, Viewport } from "next";
import "./app.css";

/**
 * Standalone layout for the client companion app (/app/[token]).
 * No coach-UI shell, no sidebar — this is the client's own surface,
 * opened from a WhatsApp link and added to the home screen.
 */

export const metadata: Metadata = {
  title: "The Ochre Tree — your plan",
  description: "Your personalised wellness plan, day by day.",
  robots: { index: false, follow: false },
  // PWA: manifest (no start_url — it defaults to the tokened page URL,
  // which is exactly what an installed icon should reopen) + home-screen
  // icons. iOS reads apple-touch-icon + the appleWebApp meta below.
  manifest: "/ochre-app/manifest.webmanifest",
  icons: {
    icon: "/ochre-app/icon.svg",
    apple: "/ochre-app/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "The Ochre Tree",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#faf9f7",
};

export default function ClientAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Pinyon Script for the script-style date + sign-off accents */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Pinyon+Script&display=swap"
        rel="stylesheet"
      />
      <div className="ochre-stage">{children}</div>
    </>
  );
}
