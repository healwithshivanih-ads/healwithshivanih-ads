/**
 * POST /api/app-copilot — typed co-pilot questions from the client app.
 *
 * Cost guard rails: suggested chips never hit this route (canned answers
 * in the app); clinical questions are gated client-side AND re-checked
 * here; each token gets a small daily budget of model calls (Haiku,
 * ~$0.001 each). Client identity derives from the letter token.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import { loadClientAppData } from "@/lib/fmdb/client-app";
import { runShim } from "@/lib/fmdb/shim";

export const dynamic = "force-dynamic";

const DAILY_LIMIT = 15;
const usage = new Map<string, { day: string; count: number }>();

function overBudget(token: string): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const cur = usage.get(token);
  if (!cur || cur.day !== day) {
    usage.set(token, { day, count: 1 });
    return false;
  }
  cur.count += 1;
  return cur.count > DAILY_LIMIT;
}

// Authoritative gates (the client-side copies in ochre-coach.tsx are a UX
// optimization only — a direct POST skips them, so these must stand alone).
const EMERGENCY_HINTS = [
  "chest pain", "chest tightness", "can't breathe", "cant breathe", "cannot breathe",
  "trouble breathing", "breathless", "short of breath", "heart attack", "stroke",
  "seizure", "passing out", "faint", "collapsed", "unconscious", "slurred",
  "numb on one side", "severe bleeding", "bleeding heavily", "coughing blood",
  "vomiting blood", "overdose", "suicid", "kill myself", "end my life",
  "ending my life", "want to die", "harm myself", "hurt myself", "self harm",
  "self-harm",
];

const DEFER_HINTS = [
  "dose", "dosage", "how much", "how many", "increase", "reduce", "double",
  "mg", "mcg", "result", "blood", "tsh", "t3", "t4", "thyroid", "ferritin",
  "b12", "vitamin d", "cortisol", "lab", "symptom", "pain", "nausea", "vomit",
  "rash", "bleed", "fever", "headache", "diarr", "cramp", "infection", "dizzy",
  "medication", "medicine", "prescri", "pregnan", "pause", "stop my", "stop taking",
  "quit", "come off", "get off", "discontinue", "wean", "skip",
  "side effect", "doctor", "diagnos",
];

export async function POST(req: NextRequest) {
  let body: { token?: string; question?: string };
  try {
    body = (await req.json()) as { token?: string; question?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const token = body.token ?? "";
  const question = (body.question ?? "").trim().slice(0, 500);
  if (!token || token.length < 16 || !question) {
    return NextResponse.json({ ok: false, error: "token and question required" }, { status: 400 });
  }
  const q = question.toLowerCase();
  if (EMERGENCY_HINTS.some((h) => q.includes(h))) {
    return NextResponse.json({ ok: true, answer: "EMERGENCY" });
  }
  if (DEFER_HINTS.some((h) => q.includes(h))) {
    return NextResponse.json({ ok: true, answer: "DEFER" });
  }
  if (overBudget(token)) {
    return NextResponse.json({ ok: true, answer: "DEFER" });
  }
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }

  try {
    const data = await loadClientAppData(token);
    if (!data) return NextResponse.json({ ok: true, answer: "DEFER" });
    const context =
      `Client: ${data.client.firstName}, week ${data.client.week} of ${data.client.totalWeeks}, ${data.client.program}. ` +
      `Today's meals — ${data.meals.map((m) => `${m.slot}: ${m.pills.join(", ")}`).join("; ")}. ` +
      `Supplements — ${data.supplements.map((s) => `${s.name} ${s.dose} (${s.slot}, ${s.timing})`).join("; ")}. ` +
      `Daily practices — ${data.practices.map((p) => p.name).join("; ")}. ` +
      `Daily remedies — ${data.remedies.filter((r) => r.assigned && r.daily).map((r) => `${r.name} (${r.when})`).join("; ")}. ` +
      `Eat freely: ${data.planRef.foods.eat.join(", ")}. Sometimes: ${data.planRef.foods.sometimes.join(", ")}. ` +
      `Leave out: ${data.planRef.foods.avoid.join(", ")}. Cooking oils: ${data.planRef.oils.use.join(", ")} (avoid ${data.planRef.oils.avoid.join(", ")}).`;
    const out = (await runShim(
      "app-copilot.py",
      { client_id: data.clientId, context, question },
      30_000,
    )) as { ok?: boolean; answer?: string; error?: string };
    if (!out.ok) return NextResponse.json({ ok: true, answer: "DEFER" });
    return NextResponse.json({ ok: true, answer: out.answer ?? "DEFER" });
  } catch (err) {
    console.error("[app-copilot] failed:", err);
    return NextResponse.json({ ok: true, answer: "DEFER" });
  }
}
