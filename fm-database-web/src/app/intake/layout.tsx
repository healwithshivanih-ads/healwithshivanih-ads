import type { Metadata } from "next";
import "./_design/design-system.css";
import "./_design/form.css";

export const metadata: Metadata = {
  title: "Intake form · Heal with Shivani",
  description: "Client intake questionnaire",
};

/**
 * Public intake form layout — covers the root sidebar by floating a full-screen
 * overlay over it. The design system + form CSS are imported here so they apply
 * only on intake routes (no leakage into the rest of the coach UI).
 */
export default function IntakeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 overflow-auto" style={{ background: "var(--bone)" }}>
      <div className="fm" style={{ width: "100%", maxWidth: 560, margin: "0 auto" }}>
        {children}
      </div>
    </div>
  );
}
