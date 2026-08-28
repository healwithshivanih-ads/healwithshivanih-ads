/**
 * POST /api/cron/infra-health — every 5 minutes, keep the remote route alive.
 *
 * Fired by scripts/cron-runner.js. Probes the things that fail SILENTLY, tries
 * to repair the tunnel itself, and emails the coach only when repair has failed
 * repeatedly (or when client data is publicly exposed, which escalates at once).
 *
 * WHY REPAIR AND NOT JUST ALERT. On 2026-08-15 the coach was away from her Mac,
 * needed to re-issue a client's intake link, and the cloudflared tunnel — the
 * only remote route to the coach UI — had been dead since at least 26 June.
 * An alert would have told her about a problem she still could not fix from a
 * phone. Restarting the service turns that outage into a blip she never sees.
 *
 * Scan-and-restart only. It never touches PHI, and it never takes the tunnel
 * DOWN: see the note on `dashboard_exposed` below for why that stays manual.
 *
 * Auth: x-cron-secret must match CRON_SECRET — same as all /api/cron/* routes.
 */
import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { getPlansRoot } from "@/lib/fmdb/paths";
import {
  decide,
  evaluate,
  EMPTY_STATE,
  isQuiet,
  type Probe,
  type ProbeSet,
  type WatchdogState,
} from "@/lib/fmdb/infra-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** launchd label for the tunnel. Overridable because a token-installed service
 *  can carry a different label than the stock one. */
const TUNNEL_SERVICE =
  process.env.COACH_TUNNEL_SERVICE || "com.cloudflare.cloudflared";

const STATE_FILE = () => path.join(getPlansRoot(), "_infra_health.json");

/** A probe never throws — a dead host is data, not an exception. */
async function probe(url: string, timeoutMs = 10_000): Promise<Probe> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // `redirect: manual` so a login redirect reads as its own status rather
    // than being followed into a 200 that would look like an open dashboard.
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      redirect: "manual",
      cache: "no-store",
    });
    return { status: res.status };
  } catch {
    return { status: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Restart the tunnel service.
 *
 * `sudo -n` is non-interactive: with no NOPASSWD rule it fails immediately
 * rather than hanging a cron job on a password prompt. That failure is
 * reported, not swallowed — a watchdog that cannot actually repair must not
 * look identical to one that repaired successfully.
 * See docs/COACH_REMOTE_ACCESS.md for the one-line sudoers entry.
 */
function restartTunnel(): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    execFile(
      "sudo",
      ["-n", "launchctl", "kickstart", "-k", `system/${TUNNEL_SERVICE}`],
      { timeout: 30_000 },
      (err, _stdout, stderr) => {
        if (err) {
          const msg = (stderr || String(err)).trim().slice(0, 300);
          resolve({
            ok: false,
            detail: /password is required|sudo:/i.test(msg)
              ? `sudo needs a password — add the NOPASSWD rule from docs/COACH_REMOTE_ACCESS.md (${msg})`
              : msg,
          });
          return;
        }
        resolve({ ok: true, detail: "kickstart issued" });
      },
    );
  });
}

async function readState(): Promise<WatchdogState> {
  try {
    const raw = await fs.readFile(STATE_FILE(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<WatchdogState>;
    return {
      consecutiveTunnelFailures: Number(parsed.consecutiveTunnelFailures) || 0,
      lastAlertAt:
        parsed.lastAlertAt && typeof parsed.lastAlertAt === "object"
          ? parsed.lastAlertAt
          : {},
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function writeState(state: WatchdogState): Promise<void> {
  try {
    await fs.writeFile(STATE_FILE(), JSON.stringify(state, null, 2), "utf-8");
  } catch (e) {
    // Losing the counter only costs us escalation timing, never correctness —
    // the probes are stateless. Log it; don't fail the run.
    console.error("[infra-health] could not persist state:", e);
  }
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const coachUrl = (process.env.COACH_PUBLIC_URL || "").replace(/\/$/, "");
  const flyUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const localUrl = (process.env.APP_URL || "http://localhost:3002").replace(/\/$/, "");

  // With no public coach URL there is no remote route to watch, and this whole
  // job is meaningless. Say so rather than inventing a hostname.
  if (!coachUrl) {
    return NextResponse.json({
      ok: true,
      skipped: "COACH_PUBLIC_URL unset — no remote route to watch",
      problems: [],
      repaired: false,
    });
  }

  // Any coach route works as the auth probe; /clients-v2 is the one the coach
  // actually opens, so a wall that would not stop her does not pass here.
  const COACH_ROUTE = "/clients-v2";

  const probes: ProbeSet = {
    tunnelHealth: await probe(`${coachUrl}/api/health`),
    tunnelCoachRoute: await probe(`${coachUrl}${COACH_ROUTE}`),
    localCoachRoute: await probe(`${localUrl}${COACH_ROUTE}`),
    flyHealth: flyUrl ? await probe(`${flyUrl}/api/health`) : { status: 200 },
  };

  let evaluation = evaluate(probes);
  let repaired = false;
  let repairDetail = "";

  // Repair, then re-probe. Only the tunnel is auto-repairable: Fly needs a
  // machine restart (a judgement call), and closing an exposed dashboard means
  // taking the coach's own remote access away — which is her decision to make,
  // not a cron's, so it alerts instead. The manual command is in the email.
  if (evaluation.tunnelNeedsRepair) {
    const r = await restartTunnel();
    repairDetail = r.detail;
    if (r.ok) {
      // cloudflared needs a moment to register with Cloudflare's edge.
      await new Promise((res) => setTimeout(res, 8_000));
      const after: ProbeSet = {
        ...probes,
        tunnelHealth: await probe(`${coachUrl}/api/health`),
        tunnelCoachRoute: await probe(`${coachUrl}${COACH_ROUTE}`),
      };
      const afterEval = evaluate(after);
      repaired = !afterEval.problems.some((p) => p.key === "tunnel_down");
      evaluation = afterEval;
    }
  }

  const prev = await readState();
  const { alert, state } = decide(evaluation, prev, {
    repairAttempted: evaluation.tunnelNeedsRepair,
    now: new Date(),
  });
  await writeState(state);

  if (repaired) {
    console.log(`[infra-health] tunnel was down — restarted, now healthy (${repairDetail})`);
  } else if (repairDetail && evaluation.tunnelNeedsRepair) {
    console.error(`[infra-health] tunnel down, repair did not stick: ${repairDetail}`);
  }

  let emailed = false;
  if (alert.length) {
    const summary = alert.map((p) => `[${p.severity}] ${p.key}: ${p.detail}`).join("\n");
    console.error(`[infra-health] alerting:\n${summary}`);

    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (user && pass) {
      const to = process.env.COACH_DIGEST_EMAIL || user;
      const critical = alert.some((p) => p.severity === "critical");
      const rows = alert
        .map(
          (p) =>
            `<li style="margin-bottom:10px;"><strong>${esc(p.detail)}</strong>` +
            (p.fix
              ? `<pre style="background:#f2efe9;padding:10px;border-radius:8px;white-space:pre-wrap;margin:6px 0 0;">${esc(p.fix)}</pre>`
              : "") +
            `</li>`,
        )
        .join("");
      const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#2b2d42;">
        <p style="background:${critical ? "#c1121f" : "#E8A87C"};color:#fff;padding:10px 14px;border-radius:8px;font-weight:600;">
          ${critical ? "⚠️ Something needs you now" : "⚠️ Remote access is down"}
        </p>
        <ul>${rows}</ul>
        <p style="color:#8d99ae;font-size:12px;margin-top:20px;">
          Automated infra watchdog · it already tried restarting the tunnel itself before sending this.
        </p>
      </div>`;
      try {
        const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
        await transporter.sendMail({
          from: `${process.env.COACH_NAME || "Shivani Hari"} <${user}>`,
          to,
          subject: critical ? "⚠️ FM Coach — needs attention now" : "⚠️ FM Coach — remote access is down",
          text: `${summary}\n\n${alert.map((p) => p.fix).filter(Boolean).join("\n\n")}`,
          html,
        });
        emailed = true;
      } catch (e) {
        console.error("[infra-health] alert email failed:", e);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    problems: evaluation.problems.map((p) => ({ key: p.key, severity: p.severity })),
    repaired,
    alerted: alert.length,
    emailed,
    quiet: isQuiet(evaluation, repaired),
  });
}
