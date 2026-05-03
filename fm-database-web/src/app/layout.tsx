import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "FM Database",
  description: "Functional Medicine coaching catalogue + plan editor",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="flex min-h-screen">
          <aside className="w-56 shrink-0 border-r bg-muted/30">
            <SidebarNav />
          </aside>
          <main className="flex-1 p-6 lg:p-8 overflow-x-auto">{children}</main>
        </div>
        <Toaster richColors closeButton position="top-right" />
      </body>
    </html>
  );
}
