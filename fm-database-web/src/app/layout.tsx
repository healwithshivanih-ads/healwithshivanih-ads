import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Libre_Baskerville } from "next/font/google";
import "./globals.css";
import { SidebarNav } from "@/components/sidebar-nav";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const libreBaskerville = Libre_Baskerville({
  variable: "--font-libre-baskerville",
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "FM Database",
  description: "Functional Medicine coaching catalogue + plan editor",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${libreBaskerville.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="flex min-h-screen">
          {/* Legacy chrome — only wraps the few remaining root-layout pages
              (/sources, /dashboard-legacy) + redirect shims. The 224px rail
              squished content to ~160px on phones, so hide it below md; the
              v2 surfaces (the daily-use app) have their own responsive shell
              and cover this layout entirely. */}
          <aside className="hidden md:block w-56 shrink-0 border-r bg-muted/30">
            <SidebarNav />
          </aside>
          <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8 overflow-x-auto">{children}</main>
        </div>
        <Toaster richColors closeButton position="top-right" />
      </body>
    </html>
  );
}
