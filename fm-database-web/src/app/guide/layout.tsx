import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Free Guide · Shivani Hari",
  description: "Functional health guides from Shivani Hari",
};

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 overflow-auto" style={{ background: "#F7F4F3" }}>
      {children}
    </div>
  );
}
