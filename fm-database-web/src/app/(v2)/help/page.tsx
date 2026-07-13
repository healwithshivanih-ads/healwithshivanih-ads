/**
 * /help — Phase 1 stub. Real Help (Phase 5) will host workflow guides,
 * keyboard shortcuts, troubleshooting, brand assets. For now a quick-
 * reference sheet of what's wired today.
 */
import { FmAppShell, FmPageHeader, FmPanel } from "@/components/fm";

export const dynamic = "force-dynamic";

const SHORTCUTS = [
  { keys: "⌘K", label: "Quick search — clients, catalogue, plans" },
  { keys: "⌘⇧R", label: "Record session for current client (Phase 4)" },
  { keys: "⌘⇧M", label: "Send message to current client (Phase 4)" },
  { keys: "⌘⇧P", label: "Jump to current client's plan tab (Phase 4)" },
];

const WORKFLOW = [
  {
    title: "1 · Add a client",
    body: "Click ➕ New client in the sidebar. Fill the intake form — name + chief concern is enough to start.",
  },
  {
    title: "2 · Record a Discovery session",
    body: "Open Analyse → Discovery. The Plan tab will then guide them through the intake handoff packet: welcome email, questionnaire link, lab booking link, coaching fee.",
  },
  {
    title: "3 · Run a Full Assessment",
    body: "After labs land, Analyse → Full assessment. The AI builds a root-cause analysis from the labs + transcript + food journal. Generates a draft plan.",
  },
  {
    title: "4 · Activate the plan",
    body: "Plan tab → Edit → Activate. Plan-check runs deterministic + AI sanity checks first.",
  },
  {
    title: "5 · Send the welcome email",
    body: "Communicate tab → generate + send the welcome email (the tab-by-tab app guide). Everything else — menus, supplement schedule, lifestyle, recipes — lives in the client's app, driven by the published plan.",
  },
  {
    title: "6 · Check in weekly",
    body: "Analyse → Check-in. Capture adherence, Five Pillars, new symptoms. Lab orders inline if needed.",
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--fm-font-mono)",
        fontSize: 11,
        padding: "2px 8px",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border)",
        borderRadius: 4,
        color: "var(--fm-text-secondary)",
        boxShadow: "0 1px 0 var(--fm-border-light)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export default function HelpStub() {
  return (
    <FmAppShell activeNavId="help" crumbs={[{ label: "Help" }]}>
      <FmPageHeader
        title="Help"
        subtitle="Quick reference for the workflow + keyboard shortcuts."
      />

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "2fr 1fr" }}>
        <FmPanel title="Coach workflow — 6 steps">
          <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
            {WORKFLOW.map((w, i) => (
              <div
                key={i}
                style={{
                  padding: "10px 14px",
                  background: "var(--fm-surface)",
                  border: "1px solid var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-md)",
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--fm-text-primary)",
                    marginBottom: 4,
                  }}
                >
                  {w.title}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--fm-text-secondary)",
                    lineHeight: 1.55,
                  }}
                >
                  {w.body}
                </div>
              </div>
            ))}
          </div>
        </FmPanel>

        <FmPanel title="Keyboard shortcuts">
          <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
            {SHORTCUTS.map((s) => (
              <div
                key={s.keys}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 10px",
                  background: "var(--fm-surface)",
                  border: "1px solid var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-sm)",
                }}
              >
                <Kbd>{s.keys}</Kbd>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--fm-text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </FmPanel>
      </div>
    </FmAppShell>
  );
}
