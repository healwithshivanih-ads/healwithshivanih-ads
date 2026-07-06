/**
 * POST /api/app-body — body-composition + vitals write-back from the client app.
 *
 * The client updates weight / waist / hip from the settings page (height
 * and age are read-only), and optionally logs weight / blood pressure /
 * energy from the daily quick-log sheet on the Progress tab. The numbers
 * land in client.measurements + a `source: client_app` health snapshot, so
 * they show up in the coach's health-trends and power the app's own
 * progress charts. mood_score is a daily 1-5 energy tap, not a body
 * measurement — it rides along on the same snapshot entry.
 *
 * Auth: body.token must resolve to the client's app/letter token. The
 * client is derived server-side from the token — never trusted from the
 * request. Numbers are re-validated in the Python shim against sane bounds.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import { runShim } from "@/lib/fmdb/shim";
import { allowDaily } from "@/lib/fmdb/rate-limit";

export const dynamic = "force-dynamic";

/** Accept a finite positive number, else null (the shim re-checks bounds). */
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Accept an integer 1-5, else null (the shim re-checks the range). */
function moodNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 1 && r <= 5 ? r : null;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token : "";
  if (!token || token.length < 16) {
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
  }
  if (!(await allowDaily("app-body", token, 12)).ok) {
    return NextResponse.json({ ok: false, error: "too many updates today" }, { status: 429 });
  }
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }

  try {
    const out = (await runShim("save-app-body.py", {
      client_id: lookup.client_id,
      weight_kg: num(body.weight_kg),
      waist_cm: num(body.waist_cm),
      hip_cm: num(body.hip_cm),
      bp_systolic: num(body.bp_systolic),
      bp_diastolic: num(body.bp_diastolic),
      mood_score: moodNum(body.mood_score),
    })) as { ok?: boolean; measured_on?: string; error?: string };
    if (!out.ok) {
      return NextResponse.json({ ok: false, error: out.error ?? "save failed" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, measured_on: out.measured_on });
  } catch (err) {
    console.error("[app-body] save failed:", err);
    return NextResponse.json({ ok: false, error: "save failed" }, { status: 500 });
  }
}
