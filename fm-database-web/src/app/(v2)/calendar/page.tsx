/**
 * /calendar — Phase 1 stub. Week view + upcoming appointments coming in
 * Phase 5. For now: empty state pointing at how Calendar will surface
 * follow-ups and recheck dates once it's wired to the existing
 * next_contact_date + plan_period_recheck_date fields.
 */
import Link from "next/link";
import { FmAppShell, FmPageHeader, FmPanel } from "@/components/fm";

export const dynamic = "force-dynamic";

export default function CalendarStub() {
  return (
    <FmAppShell
      activeNavId="calendar"
      crumbs={[
        { label: "Calendar" },
      ]}
    >
      <FmPageHeader
        title="Calendar"
        subtitle="Coming in Phase 5 — week view + upcoming appointments + day-view prep panel."
      />
      <FmPanel>
        <div style={{ padding: "32px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🗓️</div>
          <h3
            style={{
              fontFamily: "var(--fm-font-display)",
              fontSize: 20,
              margin: "0 0 8px",
              color: "var(--fm-text-primary)",
            }}
          >
            Calendar arrives in Phase 5
          </h3>
          <p
            style={{
              fontSize: 13,
              color: "var(--fm-text-secondary)",
              maxWidth: 460,
              margin: "0 auto 20px",
              lineHeight: 1.55,
            }}
          >
            Will anchor to <code>next_contact_date</code> on each client +{" "}
            <code>plan_period_recheck_date</code> on active plans. No external
            calendar dependency.
          </p>
          <Link
            href="/dashboard-v2"
            style={{
              display: "inline-block",
              padding: "9px 18px",
              background: "var(--fm-surface)",
              color: "var(--fm-text-primary)",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-md)",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            ← Back to Dashboard
          </Link>
        </div>
      </FmPanel>
    </FmAppShell>
  );
}
