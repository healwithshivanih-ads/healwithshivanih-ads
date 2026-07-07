/**
 * POST /api/cron/client-yaml-integrity — daily duplicate-key health check on
 * every clients/<id>/client.yaml.
 *
 * Fired daily by scripts/cron-runner.js at 06:45 IST (before the 07:00 menu
 * rush, isolated).
 *
 * Why: a client.yaml with the SAME top-level key twice (e.g. `app_token` as a
 * `null` placeholder near the top AND a real value appended at the bottom — the
 * cl-021 incident, 2026-07-07) makes js-yaml throw `duplicated mapping key`,
 * which 500s /dashboard-v2 and the client app. PyYAML tolerates it (last-wins),
 * so every Python shim keeps working and the corruption stays invisible. No app
 * write path can produce this (every writer re-dumps a whole object); it comes
 * from out-of-band edits. loader.ts now SKIPS an unparseable file instead of
 * crashing — but a skipped client silently vanishes from the dashboard and their
 * app goes dark, so we still want to be told. This job is that early-warning:
 * scan-only, and it emails the coach ONLY when something is actually wrong.
 *
 * It does NOT auto-repair — mutating PHI unattended is a deliberate coach action.
 * The alert carries the exact one-line repair command.
 *
 * Auth: x-cron-secret must match CRON_SECRET — same as all /api/cron/* routes.
 */
import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import path from "node:path";
import nodemailer from "nodemailer";
import { PYTHON, SCRIPTS_DIR } from "@/lib/fmdb/shim";

export const dynamic = "force-dynamic";

const SCRIPT = "scan-client-yaml-dupes.py";

interface ScanFinding {
  client: string;
  file: string;
  strict_error?: string | null;
  top_level_dup_keys?: Record<string, number>;
}
interface ScanResult {
  scanned: number;
  corrupt: number;
  findings: ScanFinding[];
}

/**
 * Run the scanner in --json mode. The script exits 1 when it FINDS corruption
 * (that's a successful scan, not a failure), so read stdout regardless of exit
 * code and only treat empty/unparseable stdout as a real error.
 */
function runScan(): Promise<ScanResult> {
  const scriptPath = path.join(SCRIPTS_DIR, SCRIPT);
  return new Promise((resolve, reject) => {
    execFile(
      PYTHON,
      [scriptPath, "--json"],
      { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      (_err, stdout, stderr) => {
        const out = (stdout || "").trim();
        if (!out) {
          reject(new Error(`scan produced no output. stderr: ${(stderr || "").slice(0, 800)}`));
          return;
        }
        try {
          resolve(JSON.parse(out) as ScanResult);
        } catch (e) {
          reject(new Error(`scan produced invalid JSON: ${(e as Error).message}\n${out.slice(0, 400)}`));
        }
      },
    );
  });
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let scan: ScanResult;
  try {
    scan = await runScan();
  } catch (err) {
    // The scan itself failed to run — surface loudly (visible in `pm2 logs
    // fm-coach-cron`) and 500 so cron-runner logs a ✗.
    console.error("[client-yaml-integrity] scan failed:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }

  if (!scan.corrupt) {
    return NextResponse.json({ ok: true, scanned: scan.scanned, corrupt: 0 });
  }

  // Corruption found — this is a real, user-visible outage risk. Log loudly.
  const summary = scan.findings
    .map((f) => {
      const keys = f.top_level_dup_keys ? Object.entries(f.top_level_dup_keys).map(([k, n]) => `${k}×${n}`).join(", ") : "";
      return `${f.client}: ${f.strict_error || "parse error"}${keys ? ` [${keys}]` : ""}`;
    })
    .join("\n");
  console.error(`[client-yaml-integrity] ${scan.corrupt} corrupt client.yaml:\n${summary}`);

  const repairCmd = `fm-database/.venv/bin/python fm-database-web/scripts/${SCRIPT} --repair`;

  // Email the coach (same channel + env as menu-approval-digest). Skip silently
  // if email isn't configured — the console.error above is still the record.
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  let emailed = false;
  if (user && pass) {
    const to = process.env.COACH_DIGEST_EMAIL || user;
    const rows = scan.findings
      .map((f) => {
        const keys = f.top_level_dup_keys
          ? Object.entries(f.top_level_dup_keys).map(([k, n]) => `${esc(k)}×${n}`).join(", ")
          : "";
        return `<li><strong>${esc(f.client)}</strong> — ${esc(f.strict_error || "parse error")}${keys ? ` <span style="color:#8d99ae;">(${keys})</span>` : ""}</li>`;
      })
      .join("");
    const htmlBody = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#2b2d42;">
        <p style="background:#c1121f;color:#fff;padding:10px 14px;border-radius:8px;font-weight:600;">
          ⚠️ ${scan.corrupt} client file${scan.corrupt === 1 ? "" : "s"} won't load — the dashboard skips ${scan.corrupt === 1 ? "it" : "them"}, so ${scan.corrupt === 1 ? "that client is" : "those clients are"} invisible right now.</p>
        <p>Duplicate / unparseable keys in <code>client.yaml</code> (js-yaml rejects them; PyYAML hid it):</p>
        <ul>${rows}</ul>
        <p>Fix (backs up each original, keeps the real last-wins values, re-verifies under both parsers):</p>
        <pre style="background:#f2efe9;padding:12px;border-radius:8px;white-space:pre-wrap;">${esc(repairCmd)}</pre>
        <p style="color:#8d99ae;font-size:12px;margin-top:20px;">Automated integrity check · scanned ${scan.scanned} client files.</p>
      </div>`;
    const textBody =
      `${scan.corrupt} client.yaml file(s) won't load (duplicate/unparseable keys) — the dashboard skips them.\n\n${summary}\n\n` +
      `Fix:\n  ${repairCmd}\n\n(scanned ${scan.scanned} files)`;
    try {
      const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
      await transporter.sendMail({
        from: `${process.env.COACH_NAME || "Shivani Hari"} <${user}>`,
        to,
        subject: `⚠️ ${scan.corrupt} client file${scan.corrupt === 1 ? "" : "s"} won't load — needs a 1-line fix`,
        html: htmlBody,
        text: textBody,
      });
      emailed = true;
    } catch (err) {
      console.error("[client-yaml-integrity] email failed:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: scan.scanned,
    corrupt: scan.corrupt,
    emailed,
    clients: scan.findings.map((f) => f.client),
  });
}
