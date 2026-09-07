import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your Foundation Session · The Ochre Tree",
  description: "Book your foundation session with Shivani Hari",
};

/**
 * Public foundation-session layout. Mirrors /start/layout.tsx — the root layout
 * renders <html>/<body>/<sidebar>; we float a full-screen overlay on top so the
 * client never sees the coach chrome.
 */
export default function FoundationLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-baseline justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-emerald-900 sm:text-xl">
              The Ochre Tree
            </h1>
            <p className="text-xs text-stone-500">Your foundation session</p>
          </div>
          <div className="hidden text-xs text-stone-400 sm:block">With Shivani Hari</div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
