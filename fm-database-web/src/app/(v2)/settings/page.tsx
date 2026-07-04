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
import { Fragment } from "react";
import { FmAppShell, FmPageHeader, FmPanel, FmInfoRow, FmChip } from "@/components/fm";
import { DEFAULT_FM_RANGES } from "@/components/client-widgets/lab-reference-ranges";
import { getCataloguePath } from "@/lib/fmdb/paths";
import { loadApiUsageMtdAllClients } from "@/lib/server-actions/usage";
import { loadAllClients } from "@/lib/fmdb/loader";

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
    fontSize: 12,
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

export default async function SettingsPage() {
  const whatsappOutbound =
    envVarSet("WHATSAPP_SERVER_URL") && envVarSet("WHATSAPP_SERVER_API_KEY");
  const whatsappInboundWebhook = envVarSet("WHATSAPP_WEBHOOK_SECRET");
  const gmail = envVarSet("GMAIL_USER") && envVarSet("GMAIL_APP_PASSWORD");
  const anthropic = envVarSet("ANTHROPIC_API_KEY");
  const vitaone = envVarSet("VITAONE_AFFILIATE_CODE");
  const vitaoneCode = envVarValue("VITAONE_AFFILIATE_CODE");
  const heygenKey = envVarSet("HEYGEN_API_KEY");

  // API spend (month-to-date) — moved here from the dashboard 2026-05-19
  // where coach said it was noise on the at-a-glance view. Now it lives
  // on Settings where you can check spend whenever needed.
  const [apiMtd, clients] = await Promise.all([
    loadApiUsageMtdAllClients(),
    loadAllClients() as Promise<Array<{ client_id: string; display_name?: string }>>,
  ]);
  const clientNameMap = new Map(
    clients.map((c) => [c.client_id, c.display_name ?? c.client_id]),
  );
  const monthLabel = new Date().toLocaleString("en-IN", {
    month: "long",
    year: "numeric",
  });
  const inrFmt = (n: number) =>
    `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

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
                  
                  {whatsappOutbound ? (
                    <FmChip tone="success">Connected</FmChip>
                  ) : (
                    <FmChip>Not configured</FmChip>
                  )}
                </span>
              }
            />
            <FmInfoRow
              label="Gmail SMTP (welcome email)"
              value={
                <span>
                  
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

        <FmPanel
          title={`API spend · ${monthLabel}`}
          subtitle="Anthropic (Claude) usage charged this month, summed across every client. Resets on the 1st."
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                padding: "14px 16px",
                background: "var(--fm-bg-cool)",
                border: "1px solid var(--fm-border-light)",
                borderRadius: "var(--fm-radius-sm)",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  fontWeight: 700,
                  color: "var(--fm-text-tertiary)",
                  marginBottom: 4,
                }}
              >
                Spent (₹)
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  fontFamily: "var(--fm-font-mono)",
                  color: "var(--fm-text-primary)",
                }}
              >
                {inrFmt(apiMtd.this_month_cost_inr)}
              </div>
            </div>
            <div
              style={{
                padding: "14px 16px",
                background: "var(--fm-bg-cool)",
                border: "1px solid var(--fm-border-light)",
                borderRadius: "var(--fm-radius-sm)",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  fontWeight: 700,
                  color: "var(--fm-text-tertiary)",
                  marginBottom: 4,
                }}
              >
                Spent (USD)
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  fontFamily: "var(--fm-font-mono)",
                  color: "var(--fm-text-secondary)",
                }}
              >
                ${apiMtd.this_month_cost_usd.toLocaleString("en-US", {
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>
            <div
              style={{
                padding: "14px 16px",
                background: "var(--fm-bg-cool)",
                border: "1px solid var(--fm-border-light)",
                borderRadius: "var(--fm-radius-sm)",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  fontWeight: 700,
                  color: "var(--fm-text-tertiary)",
                  marginBottom: 4,
                }}
              >
                Calls
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  fontFamily: "var(--fm-font-mono)",
                  color: "var(--fm-text-secondary)",
                }}
              >
                {apiMtd.this_month_calls.toLocaleString("en-IN")}
              </div>
            </div>
          </div>

          {apiMtd.by_client.length === 0 ? (
            <p
              style={{
                fontSize: 12,
                color: "var(--fm-text-tertiary)",
                fontStyle: "italic",
                margin: 0,
              }}
            >
              No Anthropic calls billed this month yet.
            </p>
          ) : (
            <div>
              <div
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  fontWeight: 700,
                  color: "var(--fm-text-tertiary)",
                  marginBottom: 6,
                }}
              >
                By client (top spend first)
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 90px 60px",
                  gap: 0,
                  border: "1px solid var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-sm)",
                  overflow: "hidden",
                  fontFamily: "var(--fm-font-mono)",
                  fontSize: 12,
                }}
              >
                <div style={tableHeaderStyle()}>Client</div>
                <div style={{ ...tableHeaderStyle(), textAlign: "right" }}>
                  Spend
                </div>
                <div style={{ ...tableHeaderStyle(), textAlign: "right" }}>
                  Calls
                </div>
                {apiMtd.by_client.map((row, i) => (
                  <Fragment key={row.client_id}>
                    <div style={tableCellStyle(i % 2 === 1, "left")}>
                      {clientNameMap.get(row.client_id) ?? row.client_id}
                      <span
                        style={{
                          color: "var(--fm-text-tertiary)",
                          marginLeft: 6,
                          fontSize: 11,
                        }}
                      >
                        {row.client_id}
                      </span>
                    </div>
                    <div style={tableCellStyle(i % 2 === 1, "right")}>
                      {inrFmt(row.cost_inr)}
                    </div>
                    <div style={tableCellStyle(i % 2 === 1, "right")}>
                      {row.calls}
                    </div>
                  </Fragment>
                ))}
              </div>
            </div>
          )}
        </FmPanel>

        <FmPanel title="Storage">
          <div style={{ display: "grid", gap: 0 }}>
            <FmInfoRow
              label="Catalogue"
              value={
                <span style={{ fontFamily: "var(--fm-font-mono)", fontSize: 12 }}>
                  {process.env.FMDB_CATALOGUE_DIR ?? "../fm-database/data"}
                </span>
              }
            />
            <FmInfoRow
              label="Plans + clients"
              value={
                <span style={{ fontFamily: "var(--fm-font-mono)", fontSize: 12 }}>
                  {process.env.FMDB_PLANS_DIR ?? "~/fm-plans"}
                </span>
              }
            />
            <FmInfoRow
              label="Resources toolkit"
              value={
                <span style={{ fontFamily: "var(--fm-font-mono)", fontSize: 12 }}>
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
              fontSize: 12,
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
                src/lib/welcome-email.ts (welcome email) + scripts/brand_html.py (handouts)
              </code>
            </li>
          </ul>
        </FmPanel>

        <FmPanel title="App">
          <div style={{ display: "grid", gap: 0 }}>
            <FmInfoRow
              label="Version"
              value={
                <span style={{ fontFamily: "var(--fm-font-mono)", fontSize: 12 }}>
                  0.1.0
                </span>
              }
            />
            <FmInfoRow
              label="Port"
              value={
                <span style={{ fontFamily: "var(--fm-font-mono)", fontSize: 12 }}>
                  3002 (PM2 process: fm-coach)
                </span>
              }
            />
            <FmInfoRow
              label="Node env"
              value={
                <span style={{ fontFamily: "var(--fm-font-mono)", fontSize: 12 }}>
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
