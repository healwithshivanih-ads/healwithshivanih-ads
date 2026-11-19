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
import { clientIsLapsed } from "@/lib/fmdb/engagement";
import { loadClientAppData } from "@/lib/fmdb/client-app";
import { runShim } from "@/lib/fmdb/shim";
import { allowDaily } from "@/lib/fmdb/rate-limit";
import { isEmergency } from "@/lib/fmdb/triage";
import { askHandoff, askUrgent } from "@/lib/fmdb/ask-safety";
import { parseModelCard } from "@/lib/fmdb/ask-card";
import { eatingOutContextFor } from "@/lib/fmdb/eating-out";
import type { ClientAppData } from "@/lib/fmdb/client-app";

export const dynamic = "force-dynamic";

/** Typed questions that may reach the model, per client link, per day. The
 *  env override exists so the limit can be changed without a deploy of code
 *  (and raised for a local test run); anything unreadable falls back to 15. */
const DAILY_LIMIT = Math.max(1, Math.floor(Number(process.env.FMDB_COPILOT_DAILY_LIMIT)) || 15);

// Authoritative gates (the client-side copies in ochre-coach.tsx are a UX
// optimization only — a direct POST skips them, so these must stand alone).

const DEFER_HINTS = [
  "dose", "dosage", "how much", "how many", "increase", "reduce", "double",
  "mg", "mcg", "result", "blood", "tsh", "t3", "t4", "thyroid", "ferritin",
  "b12", "vitamin d", "cortisol", "lab", "symptom", "pain", "nausea", "vomit",
  "rash", "bleed", "fever", "headache", "diarr", "cramp", "infection", "dizzy",
  "medication", "medicine", "prescri", "pregnan", "pause", "stop my", "stop taking",
  "quit", "come off", "get off", "discontinue", "wean", "skip",
  "side effect", "doctor", "diagnos",
];

/**
 * What the model is told about the plan, for the new front's ask box. Today's
 * app sends a shorter version (built inline below, unchanged); the card may
 * be asked about tomorrow, approved swaps, travel and what a supplement is
 * for, so it carries those too. Everything here is already shown to the
 * client somewhere in the app — nothing coach-only is added.
 */
function cardContext(data: ClientAppData, question: string): string {
  // Tomorrow only, not the week: "is X on my menu this week" is answered on
  // the phone (sq-ask.ts dishOnMenu), and the whole week tripled the tokens —
  // and so the cost — of every question.
  const week = data.weekMenus.find((w) => w.current);
  const todayAt = week ? week.days.findIndex((d) => d.today) : -1;
  const next = week && todayAt >= 0 ? week.days[todayAt + 1] ?? data.weekMenus.find((w) => w.week === week.week + 1)?.days[0] : undefined;
  const tomorrow = next ? `${next.dow} — ${next.slots.map((x) => `${x.slot}: ${x.dish}`).join("; ")}` : "";
  const swaps = data.meals
    .map((m) => {
      const names = (data.mealExtra[m.slot]?.swaps ?? []).slice(0, 3).map((x) => x.name);
      return names.length ? `${m.slot}: ${names.join(", ")}` : "";
    })
    .filter(Boolean)
    .join("; ");
  const part = (label: string, value: string) => (value.trim() ? `${label}: ${value.trim()}\n` : "");
  return (
    part("Client", `week ${data.client.week} of ${data.client.totalWeeks}, ${data.client.program}`) +
    part("Today's meals", data.meals.map((m) => `${m.slot}${m.timeHint ? ` (${m.timeHint})` : ""}: ${m.pills.join(", ")}`).join("; ")) +
    part("Swaps the coach has approved for today's meals", swaps) +
    part("Tomorrow's meals", tomorrow) +
    part(
      "Supplements",
      data.supplements
        .map((x) => `${x.name} ${x.dose} (${x.timing || x.slot}${x.notDaily ? `, ${x.notDaily === "weekly" ? "once a week" : "every other day"}` : ""})${x.why ? ` — ${x.why}` : ""}`)
        .join("; "),
    ) +
    part("Practices", data.practices.map((p) => (p.kind === "weekly" ? `${p.name} (${p.perWeek ? `${p.perWeek}× a week` : "weekly"})` : p.name)).join("; ")) +
    part("Standing guidelines", data.guidelines.map((g) => g.name).join("; ")) +
    part("Daily remedies", data.remedies.filter((r) => r.assigned && r.daily).map((r) => `${r.name} (${r.when || r.timing})`).join("; ")) +
    part("Eat freely", data.planRef.foods.eat.join(", ")) +
    part("Sometimes", data.planRef.foods.sometimes.join(", ")) +
    part("Leave out", data.planRef.foods.avoid.join(", ")) +
    part("Why those are left out", data.planRef.avoidWhy) +
    part("Diet", data.planRef.flags.map((f) => f.label).join(", ")) +
    // The coach's own eating-out guide for this plan week. With it, a
    // food-choice question always has an answer for now.
    part("Eating out (the coach's guide)", data.planRef.eatingOut ? eatingOutContextFor(question, data.planRef.eatingOut) : "") +
    part("Cooking oils", `${data.planRef.oils.use.join(", ")}${data.planRef.oils.avoid.length ? ` (avoid ${data.planRef.oils.avoid.join(", ")})` : ""}`) +
    part("Away from home", data.travel ? `${data.travel.kind} from ${data.travel.from} to ${data.travel.to}${data.travel.location ? `, ${data.travel.location}` : ""}` : "") +
    part("Next session with the coach", data.coach.nextSession ?? "")
  );
}

export async function POST(req: NextRequest) {
  let body: { token?: string; question?: string; format?: string };
  try {
    body = (await req.json()) as { token?: string; question?: string; format?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const token = body.token ?? "";
  const question = (body.question ?? "").trim().slice(0, 500);
  if (!token || token.length < 16 || !question) {
    return NextResponse.json({ ok: false, error: "token and question required" }, { status: 400 });
  }
  // The new front's ask box. Its own branch, so today's app (free text, below)
  // is untouched. Same guard rails in the same order: fixed safety rules, the
  // daily cap, a valid link, a client still in care — and only then the model.
  if (body.format === "card") return cardAnswer(req, token, question);

  const q = question.toLowerCase();
  if (isEmergency(question)) {
    return NextResponse.json({ ok: true, answer: "EMERGENCY" });
  }
  if (DEFER_HINTS.some((h) => q.includes(h))) {
    return NextResponse.json({ ok: true, answer: "DEFER" });
  }
  if (!(await allowDaily("app-copilot", token, DAILY_LIMIT)).ok) {
    return NextResponse.json({ ok: true, answer: "DEFER" });
  }
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }
  // Programme over → no model calls. A lapsed client keeps the app (recipes,
  // keepsake, re-order links) but the co-pilot is part of active care. The
  // engagement check is the cheap one; the LIBRARY-mode check below also
  // catches a maintenance lapse, which never sets engagement_status.
  if (await clientIsLapsed(lookup.client_id)) {
    return NextResponse.json({ ok: true, answer: "DEFER" });
  }

  try {
    const data = await loadClientAppData(token, {
      deviceTz: req.cookies.get("ochre_tz")?.value ?? null,
    });
    if (!data) return NextResponse.json({ ok: true, answer: "DEFER" });
    if (data.mode === "LIBRARY") return NextResponse.json({ ok: true, answer: "DEFER" });
    const context =
      `Client: ${data.client.firstName}, week ${data.client.week} of ${data.client.totalWeeks}, ${data.client.program}. ` +
      // Continuation matters to the copilot as much as to a letter: without it
      // it answers a client of many months as though she were in week one.
      (data.client.continued
        ? `She is CONTINUING — this is phase ${data.client.phaseNumber}, and she has been on a protocol with this coach for about ${data.client.tenureWeek} weeks. Do not explain basics as though they were new; she has lived them. `
        : "") +
      `Today's meals — ${data.meals.map((m) => `${m.slot}: ${m.pills.join(", ")}`).join("; ")}. ` +
      `Supplements — ${data.supplements.map((s) => `${s.name} ${s.dose} (${s.slot}, ${s.timing})`).join("; ")}. ` +
      `Practices — ${data.practices.map((p) => (p.kind === "weekly" ? `${p.name} (${p.perWeek ? `${p.perWeek}× a week` : "weekly"})` : p.name)).join("; ")}. ` +
      `Her standing guidelines — ${data.guidelines.map((g) => g.name).join("; ") || "none"}. ` +
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

/** Never an error to the phone: anything that goes wrong is "defer", which
 *  the ask box shows as an offer to send the question to the coach. */
async function cardAnswer(req: NextRequest, token: string, question: string) {
  const defer = (reason?: string) => NextResponse.json({ ok: true, verdict: "defer", ...(reason ? { reason } : {}) });

  // Authoritative: the phone runs the same module first, but a direct POST
  // skips the phone.
  const urgent = askUrgent(question);
  if (urgent) return NextResponse.json({ ok: true, verdict: urgent });
  const handoff = askHandoff(question);
  if (handoff) return defer(handoff);

  if (!(await allowDaily("app-copilot", token, DAILY_LIMIT)).ok) return defer("limit");
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }
  if (await clientIsLapsed(lookup.client_id)) return defer();

  try {
    const data = await loadClientAppData(token, {
      deviceTz: req.cookies.get("ochre_tz")?.value ?? null,
    });
    if (!data || data.mode === "LIBRARY") return defer();
    const out = (await runShim(
      "app-copilot.py",
      { client_id: data.clientId, context: cardContext(data, question), question, mode: "card" },
      30_000,
    )) as { ok?: boolean; answer?: string; error?: string };
    if (!out.ok) return defer();
    const verdict = parseModelCard(out.answer);
    return NextResponse.json({ ok: true, ...verdict });
  } catch (err) {
    console.error("[app-copilot] card failed:", err);
    return defer();
  }
}
