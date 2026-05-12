/**
 * /settings — Phase 1 stub that already shows real environment state.
 *
 * The full settings page (Phase 5) will let the coach edit message templates,
 * custom protocol templates, supplement-links library, FM lab reference
 * range defaults, affiliate code, letterhead config. For now we just
 * surface the *read-only* state so she can verify her install end-to-end.
 */
import { FmAppShell, FmPageHeader, FmPanel, FmInfoRow, FmChip } from "@/components/fm";

export const dynamic = "force-dynamic";

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 9,
        height: 9,
        borderRadius: "50%",
        background: ok ? "var(--fm-success)" : "var(--fm-text-tertiary)",
        marginRight: 6,
        verticalAlign: "middle",
      }}
    />
  );
}

export default function SettingsStub() {
  const aisensy = !!process.env.AISENSY_API_KEY;
  const gmail = !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
  const anthropic = !!process.env.ANTHROPIC_API_KEY;
  const vitaone = !!process.env.VITAONE_AFFILIATE_CODE;

  return (
    <FmAppShell activeNavId="settings" crumbs={[{ label: "Settings" }]}>
      <FmPageHeader
        title="Settings"
        subtitle="Environment status today. Editable templates + lab ranges + affiliate code editor land in Phase 5."
      />

      <div style={{ display: "grid", gap: 16 }}>
        <FmPanel title="Integrations">
          <div style={{ display: "grid", gap: 0 }}>
            <FmInfoRow
              label="Anthropic API"
              value={
                <span>
                  <StatusDot ok={anthropic} />
                  {anthropic ? (
                    <FmChip tone="success">Configured</FmChip>
                  ) : (
                    <FmChip tone="danger">Missing key</FmChip>
                  )}
                </span>
              }
            />
            <FmInfoRow
              label="AiSensy WhatsApp"
              value={
                <span>
                  <StatusDot ok={aisensy} />
                  {aisensy ? (
                    <FmChip tone="success">API key set</FmChip>
                  ) : (
                    <FmChip>Not configured</FmChip>
                  )}
                </span>
              }
            />
            <FmInfoRow
              label="Gmail SMTP (client letters)"
              value={
                <span>
                  <StatusDot ok={gmail} />
                  {gmail ? (
                    <FmChip tone="success">Connected</FmChip>
                  ) : (
                    <FmChip>Not configured</FmChip>
                  )}
                </span>
              }
            />
            <FmInfoRow
              label="VitaOne affiliate code"
              value={
                <span>
                  <StatusDot ok={vitaone} />
                  {vitaone ? (
                    <FmChip tone="success">{process.env.VITAONE_AFFILIATE_CODE}</FmChip>
                  ) : (
                    <FmChip>Default (vita13720sh)</FmChip>
                  )}
                </span>
              }
            />
          </div>
        </FmPanel>

        <FmPanel title="Storage">
          <div style={{ display: "grid", gap: 0 }}>
            <FmInfoRow
              label="Catalogue"
              value={
                <span style={{ fontFamily: "var(--fm-font-mono)", fontSize: 11.5 }}>
                  {process.env.FMDB_CATALOGUE_DIR ?? "../fm-database/data"}
                </span>
              }
            />
            <FmInfoRow
              label="Plans + clients"
              value={
                <span style={{ fontFamily: "var(--fm-font-mono)", fontSize: 11.5 }}>
                  {process.env.FMDB_PLANS_DIR ?? "~/fm-plans"}
                </span>
              }
            />
            <FmInfoRow
              label="Resources toolkit"
              value={
                <span style={{ fontFamily: "var(--fm-font-mono)", fontSize: 11.5 }}>
                  {process.env.FMDB_RESOURCES_DIR ?? "~/fm-resources"}
                </span>
              }
            />
          </div>
        </FmPanel>

        <FmPanel title="Coming in Phase 5">
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 13,
              color: "var(--fm-text-secondary)",
              lineHeight: 1.8,
            }}
          >
            <li>Message template editor (5 default WhatsApp templates)</li>
            <li>Custom protocol template library editor</li>
            <li>Supplement-links library CRUD</li>
            <li>Lab reference range defaults (the 14 FM optimal we ship)</li>
            <li>Letterhead config (logo, footer, signature)</li>
            <li>Per-coach branding overrides</li>
          </ul>
        </FmPanel>
      </div>
    </FmAppShell>
  );
}
