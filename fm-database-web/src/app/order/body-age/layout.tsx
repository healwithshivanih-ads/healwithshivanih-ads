import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Body age report",
  description: "A blood test at home and a written report of your body age.",
  robots: { index: false, follow: false },
};

/** Public order page. The root layout draws the coach chrome; this floats a full-screen page over it. */
export default function BodyAgeOrderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 overflow-auto" style={{ background: "#F5F0EB", color: "#2A292D" }}>
      <main className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>
    </div>
  );
}
