/**
 * /settings — environment state + FM defaults + app info. Read-only today.
 *
 * Shows what's configured (API keys, SMTP, storage paths) so a new
 * install can be verified end-to-end without grepping .env. Surfaces
 * the FM lab reference range defaults coach gets per-client (editable
 * on the Overview card; this is the global baseline).
 *
 * Coach profile + message template editor + supplement-links CRUD are
 * still surfaced where they're authored — message templates on the
 * client Communicate tab, supplement links on /backlog, coach profile
 * via env vars. A future v0.7 iteration will pull all into here once
 * the data persistence shapes settle.
 */
import fs from "node:fs";
import path from "node:path";
import { FmAppShell, FmPageHeader, FmPanel, FmInfoRow, FmChip } from "@/components/fm";
import { DEFAULT_FM_RANGES } from "@/components/client-widgets/lab-reference-ranges";
import { getCataloguePath } from "@/lib/fmdb/paths";

export const dynamic = "force-dynamic";

/** Check whether a given env-var key is set, either in process.env (web's
 *  .env.local) OR in the Python side's fm-database/.env file (where keys
 *  for plan-ai-check / ingest / etc. live). Mirrors the dotenv-parser that
 *  the Python shims use. */
function envVarSet(key: string): boolean {
  if (process.env[key]) return true;
  try {
    const cataloguePath = getCataloguePath();
    const fmdbEnv = path.resolve(cataloguePath, "..", ".env");
    if (!fs.existsSync(fmdbEnv)) return false;
    const raw = fs.readFileSync(fmdbEnv, "utf-8");
    const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*\\S`, "m");
    return re.test(raw);
  } catch {
    return false;
  }
}

function envVarValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    const cataloguePath = getCataloguePath();
    const fmdbEnv = path.resolve(cataloguePath, "..", ".env");
    if (!fs.existsSync(fmdbEnv)) return undefined;
    const raw = fs.readFileSync(fmdbEnv, "utf-8");
    const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*([^\\n]+)`, "m");
    const m = re.exec(raw);
    if (!m) return undefined;
    const v = m[1].trim().replace(/^['"]|['"]$/g, "");
    return v || undefined;
  } catch {
    return undefined;
  }
}

function tableHeaderStyle(): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "var(--fm-text-tertiary)",
    background: "var(--fm-surface-muted, rgba(0,0,0,0.02))",
    padding: "6px 10px",
  };
}

function tableCellStyle(striped: boolean, align: "left" | "right"): React.CSSProperties {
  return {
    fontSize: 11.5,
    padding: "5px 10px",
    background: striped
      ? "var(--fm-surface-muted, rgba(0,0,0,0.015))"
      : "transparent",
    textAlign: align,
    color: "var(--fm-text-secondary)",
  };
}

function Row({
  marker,
  low,
  high,
  unit,
  striped,
}: {
  marker: string;
  low?: number;
  high?: number;
  unit: string;
  striped: boolean;
}) {
  const fmt = (n?: number) => (n == null ? "—" : n.toString());
  return (
    <>
      <div style={tableCellStyle(striped, "left")}>{marker}</div>
      <div style={tableCellStyle(striped, "right")}>{fmt(low)}</div>
      <div style={tableCellStyle(striped, "right")}>{fmt(high)}</div>
      <div style={tableCellStyle(striped, "right")}>{unit}</div>
    </>
  );
}

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

export default function SettingsPage() {
  const whatsappOutbound =
    envVarSet("WHATSAPP_SERVER_URL") && envVarSet("WHATSAPP_SERVER_API_KEY");
  const whatsappInboundWebhook = envVarSet("WHATSAPP_WEBHOOK_SECRET");
  const gmail = envVarSet("GMAIL_USER") && envVarSet("GMAIL_APP_PASSWORD");
  const anthropic = envVarSet("ANTHROPIC_API_KEY");
  const vitaone = envVarSet("VITAONE_AFFILIATE_CODE");
  const vitaoneCode = envVarValue("VITAONE_AFFILIATE_CODE");
  const heygenKey = envVarSet("HEYGEN_API_KEY");

  return (
    <FmAppShell activeNavId="settings" crumbs={[{ label: "Settings" }]}>
      <FmPageHeader
        title="Settings"
        subtitle="Environment + integrations + FM defaults. Read-only today; edits happen in .env.local or per-client surfaces."
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
              label="WhatsApp outbound (self-hosted Cloud API)"
              value={
                <span>
                  <StatusDot ok={whatsappOutbound} />
                  {whatsappOutbound ? (
                    <FmChip tone="success">Connected</FmChip>
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
                    <FmChip tone="success">{vitaoneCode}</FmChip>
                  ) : (
                    <FmChip>Default (vita13720sh)</FmChip>
                  )}
                </span>
              }
            />
            <FmInfoRow
              label="HeyGen video API"
              value={
                <span>
                  <StatusDot ok={heygenKey} />
                  {heygenKey ? (
                    <FmChip tone="success">API key set</FmChip>
                  ) : (
                    <FmChip>Not configured</FmChip>
                  )}
                </span>
              }
            />
            <FmInfoRow
              label="WhatsApp inbound webhook"
              value={
                <span>
                  <StatusDot ok={whatsappInboundWebhook} />
                  {whatsappInboundWebhook ? (
                    <FmChip tone="success">Secret set</FmChip>
                  ) : (
                    <FmChip>Not configured</FmChip>
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

        <FmPanel
          title="FM lab reference ranges (defaults)"
          subtitle="14 markers — these are the optimal-range presets the coach loads into a client.yaml via the per-client editor. Edit globally by changing DEFAULT_FM_RANGES in lab-reference-ranges.tsx."
        >
          <div
            style={{
              fontFamily: "var(--fm-font-mono)",
              fontSize: 11.5,
              display: "grid",
              gridTemplateColumns: "minmax(140px, 1fr) 80px 80px 70px",
              gap: 0,
              border: "1px solid var(--fm-border-light)",
              borderRadius: "var(--fm-radius-sm)",
              overflow: "hidden",
            }}
          >
            <div style={tableHeaderStyle()}>Marker</div>
            <div style={{ ...tableHeaderStyle(), textAlign: "right" }}>Low</div>
            <div style={{ ...tableHeaderStyle(), textAlign: "right" }}>High</div>
            <div style={{ ...tableHeaderStyle(), textAlign: "right" }}>Unit</div>
            {Object.entries(DEFAULT_FM_RANGES).map(([marker, range], i) => (
              <Row
                key={marker}
                marker={marker}
                low={range.optimal_low}
                high={range.optimal_high}
                unit={range.unit ?? ""}
                striped={i % 2 === 1}
              />
            ))}
          </div>
          <p
            style={{
              fontSize: 11,
              color: "var(--fm-text-tertiary)",
              marginTop: 10,
              marginBottom: 0,
              lineHeight: 1.5,
            }}
          >
            Per-client overrides live on each client&apos;s Overview tab (the
            Lab Reference Ranges card). Health-trends widget colour-codes lab
            values against these — green inside the range, red outside.
          </p>
        </FmPanel>

        <FmPanel title="Where to edit what">
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 13,
              color: "var(--fm-text-secondary)",
              lineHeight: 1.8,
            }}
          >
            <li>
              <strong>API keys + SMTP</strong> →{" "}
              <code style={{ fontFamily: "var(--fm-font-mono)" }}>
                fm-database-web/.env.local
              </code>{" "}
              (restart PM2 to pick up changes)
            </li>
            <li>
              <strong>Message templates</strong> → per-client{" "}
              <em>Communicate</em> tab (5 defaults seeded in ~/fm-plans/message_templates.yaml)
            </li>
            <li>
              <strong>Custom protocol templates</strong> → per-plan Lifecycle
              tab → 💾 Save as template (lands in ~/fm-plans/custom_templates/)
            </li>
            <li>
              <strong>Supplement affiliate links</strong> → /backlog → Supplement Links tab
            </li>
            <li>
              <strong>Lab reference ranges</strong> → per-client Overview tab
              (overrides the defaults above)
            </li>
            <li>
              <strong>Coach branding / letterhead</strong> → currently hardcoded
              in <code style={{ fontFamily: "var(--fm-font-mono)" }}>
                scripts/brand_html.py
              </code>{" "}
              and{" "}
              <code style={{ fontFamily: "var(--fm-font-mono)" }}>
                scripts/render-client-letter.py
              </code>
            </li>
          </ul>
        </FmPanel>

        <FmPanel title="App">
          <div style={{ display: "grid", gap: 0 }}>
            <FmInfoRow
              label="Version"
              value={
                <span style={{ fontFamily: "var(--fm-font-mono)", fontSize: 11.5 }}>
                  0.1.0
                </span>
              }
            />
            <FmInfoRow
              label="Port"
              value={
                <span style={{ fontFamily: "var(--fm-font-mono)", fontSize: 11.5 }}>
                  3002 (PM2 process: fm-coach)
                </span>
              }
            />
            <FmInfoRow
              label="Node env"
              value={
                <span style={{ fontFamily: "var(--fm-font-mono)", fontSize: 11.5 }}>
                  {process.env.NODE_ENV ?? "unknown"}
                </span>
              }
            />
          </div>
        </FmPanel>
      </div>
    </FmAppShell>
  );
}
