import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Confirm your start date · Heal with Shivani",
  description: "Confirm when your plan begins",
};

/**
 * Public start-date confirmation layout. Mirrors /intake/layout.tsx — the
 * root layout renders <html>/<body>/<sidebar>; we float a full-screen
 * overlay on top so the client never sees the coach chrome.
 */
export default function StartLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-baseline justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-emerald-900 sm:text-xl">
              Heal with Shivani
            </h1>
            <p className="text-xs text-stone-500">Confirm your plan start</p>
          </div>
          <div className="hidden text-xs text-stone-400 sm:block">
            Just one tap.
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}
