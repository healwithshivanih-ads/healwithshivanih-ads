import "server-only";

/**
 * Automated meal-photo check (docs/MEAL_PHOTO_CHECK_SPEC.md).
 *
 * Runs on every photo a client sends. The coach sees only what it flags —
 * checking each photo herself was the work this replaces, not a step on the
 * way to it.
 *
 * THE CHECK IS MENU-ANCHORED. It never forms a free-standing opinion about
 * whether food is healthy: it compares the plate against the dish this
 * client's own plan lists for that meal today. "Is this consistent with
 * moong dal khichdi and lauki?" has an honest "can't tell" answer; "is this
 * meal appropriate?" does not, and on Indian home food — where dal, sambar
 * and rasam are three dishes in one steel katori, and roti differs from
 * paratha by ghee a camera cannot see — the second question invents
 * confidence it has not earned.
 *
 * IT NEVER TELLS A CLIENT THEIR FOOD IS WRONG. Affirmation or a neutral
 * acknowledgement; nothing else reaches them. Anything off-plan or unsafe
 * goes to the coach. An app issuing food verdicts to someone who cannot
 * argue back is shaming, arriving at the moment they were being open.
 *
 * AND IT FAILS TO SILENCE, NEVER TO ENCOURAGEMENT. Every uncertainty — an
 * unknown diet, no menu for today, low confidence, a malformed reply, a
 * timeout — lands on the neutral line. The one outcome worse than saying
 * nothing is "looks great!" over a plate holding something the client was
 * told to avoid, because that carries the coach's authority.
 */
import { loadClientAppData, type AppMeal } from "./client-app";
import { loadClientById } from "./loader-extras";
import { readChatPhoto } from "./chat-media";
import { allergyPromptLine } from "./allergies";

export type MealOutcome = "affirm" | "quiet" | "review" | "safety";

export type MealVerdict = {
  outcome: MealOutcome;
  /** Shown to the client. Warm on affirm; the neutral line otherwise. */
  clientLine: string;
  /** Coach-facing one-liner. Never sent to the client. */
  coachNote: string;
  dish?: string;
};

/** The neutral reply. Identical for quiet, review and safety — see the spec:
 *  if it varied, clients would learn to read the silence. */
export const NEUTRAL_LINE = "Got it, thanks for sending this — Shivani will see it.";

const MODEL = "claude-haiku-4-5";
const TIMEOUT_MS = 25_000;

/**
 * Diet normalisation.
 *
 * NEVER substring: "vegetarian" is contained in "Non-vegetarian", and this
 * codebase has already shipped that bug once. Exact match after lowering and
 * stripping punctuation, with unknown as a real answer — two clients have no
 * preference recorded at all and must not be affirmed.
 */
export function normaliseDiet(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "unknown";
  if (s.includes("jain")) return "jain";
  if (s.startsWith("non veg") || s.startsWith("nonveg")) return "non-vegetarian";
  if (s.startsWith("vegan")) return "vegan";
  if (s.startsWith("eggetarian") || s.startsWith("ovo")) return "eggetarian";
  if (s.startsWith("pescatarian") || s.startsWith("pesc")) return "pescatarian";
  if (s === "vegetarian" || s.startsWith("vegetarian ") || s.startsWith("veg ")) return "vegetarian";
  if (s === "veg") return "vegetarian";
  return "unknown";
}

/** Which meal a photo most likely belongs to, from the hour it arrived. */
export function slotForHour(hour: number): string {
  if (hour < 11) return "breakfast";
  if (hour < 16) return "lunch";
  if (hour < 19) return "snack";
  return "dinner";
}

function matchMeal(meals: AppMeal[], slot: string): AppMeal | null {
  const want = slot.toLowerCase();
  return (
    meals.find((m) => (m.slot ?? "").toLowerCase().includes(want)) ??
    meals.find((m) => want === "snack" && /snack|tea/i.test(m.slot ?? "")) ??
    null
  );
}

type ModelAnswer = {
  is_food: boolean;
  dish: string;
  matches_planned: boolean;
  exclusion_risk: boolean;
  exclusion_reason: string;
  confident: boolean;
  warm_line: string;
};

const TOOL = {
  name: "record_meal_check",
  description: "Report what the photo shows and whether it fits this client's plan.",
  input_schema: {
    type: "object" as const,
    properties: {
      is_food: { type: "boolean", description: "Is this a photo of food at all?" },
      dish: { type: "string", description: "What you see, plainly. Empty if unsure." },
      matches_planned: {
        type: "boolean",
        description: "Is the plate consistent with the planned dish? False if there is no planned dish.",
      },
      exclusion_risk: {
        type: "boolean",
        description:
          "Could this plate contain ANYTHING the client was told to avoid, or breach their diet? Say true on any doubt.",
      },
      exclusion_reason: { type: "string", description: "What raised the concern. Empty if none." },
      confident: {
        type: "boolean",
        description: "Are you confident you identified the food? False if guessing.",
      },
      warm_line: {
        type: "string",
        description:
          "One warm sentence to the client naming what you see. No quantities, no calories, no advice, no criticism.",
      },
    },
    required: [
      "is_food",
      "dish",
      "matches_planned",
      "exclusion_risk",
      "exclusion_reason",
      "confident",
      "warm_line",
    ],
  },
};

function systemPrompt(): string {
  return [
    "You help an Indian functional-medicine coach review photos her clients send of their meals.",
    "",
    "Your job is a COMPARISON, not a nutritional opinion: does this plate look consistent with the dish the client's own plan lists for this meal today?",
    "",
    "Indian home food is hard to identify from a photo. Dal, sambar and rasam look alike in a steel katori; roti and paratha differ by ghee you cannot see; portions cannot be judged from an image. When you are not sure, say so — `confident: false` is a correct and useful answer, and a wrong guess is far worse than an honest one.",
    "",
    "SAFETY IS THE PRIORITY. The client's exclusions are written in their coach's own words and may be rules rather than lists ('no red meat', 'gluten-free, Hashimoto's', 'only chicken and prawns at weekends'). Read them carefully. If the plate could contain anything excluded, or breaches their stated diet, set exclusion_risk true — err heavily toward true. A false alarm costs the coach ten seconds; a missed one costs a client a flare.",
    "",
    "If the allergy line says NOT RECORDED, that means nobody has asked this client — it does NOT mean they have no allergies. Treat a common allergen on the plate (peanut, tree nut, shellfish, fish, egg, dairy, soy, wheat, sesame) as worth flagging in that case, even though no exclusion names it.",
    "",
    "warm_line is read by the CLIENT. Warm, brief, specific to what you see. Never mention calories, grams, portions or weight. Never criticise, correct, advise or hedge. Never mention the plan being missed. If you have nothing kind and specific to say, leave it empty.",
  ].join("\n");
}

/**
 * Ask the model. Returns null on anything unexpected — the caller treats that
 * as "stay quiet", which is the safe direction.
 */
async function ask(
  imageB64: string,
  context: string,
): Promise<ModelAnswer | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[meal-check] ANTHROPIC_API_KEY not set");
    return null;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: systemPrompt(),
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data: imageB64 },
              },
              { type: "text", text: context },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error(`[meal-check] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const json = (await res.json()) as {
      content?: { type: string; name?: string; input?: unknown }[];
    };
    const call = json.content?.find((c) => c.type === "tool_use" && c.name === TOOL.name);
    return (call?.input as ModelAnswer) ?? null;
  } catch (e) {
    console.error("[meal-check] call failed:", (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Score one photo.
 *
 * Never throws: the caller runs this after the client's photo is already
 * stored and shown, and a checker failure must never surface as the app
 * losing their message.
 */
export async function checkMealPhoto(
  clientId: string,
  token: string,
  file: string,
  sentAtIso: string,
): Promise<MealVerdict> {
  const quiet = (coachNote: string): MealVerdict => ({
    outcome: "quiet",
    clientLine: NEUTRAL_LINE,
    coachNote,
  });

  try {
    const buf = await readChatPhoto(clientId, file);
    if (!buf) return quiet("photo missing");

    const client = (await loadClientById(clientId)) as {
      dietary_preference?: string;
      foods_to_avoid?: string;
      known_allergies?: string[];
    } | null;

    const diet = normaliseDiet(client?.dietary_preference);
    // Exclusions go in VERBATIM. Summarising them is exactly where the
    // meaning of "only chicken and prawns at weekends" gets lost.
    const avoid = (client?.foods_to_avoid ?? "").trim();
    // Allergies are a THREE-state answer, not a list-or-nothing. This used to
    // drop the "none" sentinel on the floor and omit the line entirely when
    // the list was empty — so a client nobody had asked and a client who had
    // answered "no allergies" produced byte-identical context, and both read
    // to the model as cleared. Now the empty case says out loud that it is
    // empty. See ./allergies.ts.
    //
    // An unrecorded allergy list does NOT suppress affirmation the way an
    // unknown diet does. The check is menu-anchored: affirming says "this
    // looks like the dish your plan lists today", not "this is safe for you"
    // — and the plan was authored against `foods_to_avoid`, which is
    // populated. Blocking here would silence the feature for the whole roster
    // to buy a guarantee affirmation never made. Safety stays where it
    // belongs, on exclusion_risk, which is now told the screen is missing.
    const allergyLine = allergyPromptLine(client);

    let planned = "";
    try {
      const app = await loadClientAppData(token);
      const hour = new Date(sentAtIso).getHours();
      const meal = app?.meals ? matchMeal(app.meals, slotForHour(hour)) : null;
      planned = meal ? (meal.pills ?? []).join(", ") : "";
    } catch {
      // No menu is a reason not to affirm, not a reason to fail.
    }

    const context = [
      `Client's diet: ${diet === "unknown" ? "NOT RECORDED" : diet}`,
      avoid ? `Foods/rules they must avoid (their coach's own words):\n${avoid}` : "No avoid-list recorded.",
      allergyLine,
      planned
        ? `Their plan for this meal today: ${planned}`
        : "There is no planned dish on record for this meal today — matches_planned must be false.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const a = await ask(buf.toString("base64"), context);
    if (!a) return quiet("checker unavailable");

    if (!a.is_food) {
      return { outcome: "quiet", clientLine: "", coachNote: "not a meal photo" };
    }

    // Safety first, and independent of everything else.
    if (a.exclusion_risk) {
      return {
        outcome: "safety",
        clientLine: NEUTRAL_LINE,
        coachNote: `Possible exclusion: ${a.exclusion_reason || "unspecified"} — ${a.dish || "unidentified dish"}`,
        dish: a.dish,
      };
    }

    // Everything below can only AFFIRM. Each condition removed here is a way
    // to affirm something we do not actually know.
    if (diet === "unknown") return quiet("no dietary preference on record — cannot affirm");
    if (!a.confident) return quiet(`unsure what this is${a.dish ? ` (guessed: ${a.dish})` : ""}`);
    if (!a.warm_line.trim()) return quiet("nothing specific to say");

    if (!a.matches_planned) {
      // Off-menu but safe and recognised: affirm the FOOD, queue the plan
      // conversation for the coach. Silence here reads as disapproval — see
      // the known hole in the spec.
      return {
        outcome: "review",
        clientLine: a.warm_line.trim(),
        coachNote: `Not today's planned meal — ${a.dish}${planned ? ` (planned: ${planned})` : ""}`,
        dish: a.dish,
      };
    }

    return {
      outcome: "affirm",
      clientLine: a.warm_line.trim(),
      coachNote: `On plan — ${a.dish}`,
      dish: a.dish,
    };
  } catch (e) {
    console.error("[meal-check] unexpected:", (e as Error).message);
    return quiet("checker error");
  }
}
