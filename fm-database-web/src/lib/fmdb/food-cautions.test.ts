/**
 * Condition ↔ food cautions.
 *
 * The bug these pin: the catalogue could say a food HELPS a condition and had
 * no way to say a food warrants CARE for one, so ragi — goitrogenic, and named
 * as such in claims/murray-goitrogens-cooked-vs-raw.yaml — reached a
 * hypothyroid client's weekly menu with nothing anywhere objecting.
 *
 * Three halves:
 *   1. DATA INTEGRITY over the real _food_cautions.yaml. Every food key must
 *      resolve in _ingredient_nutrients.yaml and every claim slug must exist,
 *      because a caution that references nothing silently stops firing and
 *      looks identical to one that found nothing.
 *   2. PURE RULES for condition matching and prose scanning.
 *   3. THE TWO ENGINES AGREE — the same client fixtures through
 *      scripts/food_cautions.py must produce the same live caution ids.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  loadFoodCautions,
  liveFoodCautions,
  cautionedFoodsInText,
  foodDisplayTerms,
  plainFoodNames,
  screenMenuForClient,
  resolveFoodCautionFindings,
  clientConditionText,
  type FoodCaution,
} from "./food-cautions";
import { detectPlanConflicts } from "./plan-conflicts";

const execFileP = promisify(execFile);
const CATALOGUE = path.join(process.cwd(), "..", "fm-database", "data");

/** Same interpreter contract the other Python-driving suites use: honour
 *  FMDB_PYTHON (a git worktree has no .venv), else fall back to python3. */
const PYTHON = process.env.FMDB_PYTHON ?? "python3";

const HASHIMOTOS = { active_conditions: ["Hashimoto's thyroiditis", "Vitamin D deficiency"] };
const STONES = { active_conditions: ["Recurrent calcium oxalate kidney stones"] };
const GOUT = { active_conditions: ["Gout with raised uric acid"] };
const UNRELATED = { active_conditions: ["Seasonal allergic rhinitis"] };

describe("data integrity — _food_cautions.yaml", () => {
  it("every food key resolves in the ingredient table", async () => {
    const table = yaml.load(
      await fs.readFile(path.join(CATALOGUE, "_ingredient_nutrients.yaml"), "utf-8"),
    ) as Record<string, unknown>;
    const keys = new Set(Object.keys(table).filter((k) => !k.startsWith("_")));
    const cautions = await loadFoodCautions();
    expect(cautions.length).toBeGreaterThan(0);
    const unresolved = cautions.flatMap((c) =>
      c.foods.filter((f) => !keys.has(f)).map((f) => `${c.id}:${f}`),
    );
    expect(unresolved).toEqual([]);
  });

  it("every cited claim exists in the catalogue", async () => {
    const cautions = await loadFoodCautions();
    const missing: string[] = [];
    for (const c of cautions) {
      // Rule 4 in the data file's header: a caution with no claim is an
      // opinion, and this catalogue does not ship opinions as data.
      expect(c.claims.length, `${c.id} cites no claim`).toBeGreaterThan(0);
      for (const slug of c.claims) {
        try {
          await fs.access(path.join(CATALOGUE, "claims", `${slug}.yaml`));
        } catch {
          missing.push(`${c.id}:${slug}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("every referenced drug entry exists", async () => {
    const cautions = await loadFoodCautions();
    const missing: string[] = [];
    for (const c of cautions) {
      for (const slug of c.drugs) {
        try {
          await fs.access(path.join(CATALOGUE, "drug_depletions", `${slug}.yaml`));
        } catch {
          missing.push(`${c.id}:${slug}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("preparation_clears is only ever 'cooked' or null", async () => {
    // Header rule 3: this field means INACTIVATES, not "helps". An earlier
    // draft carried a soaked_and_cooked value for oxalate, and a word-scan for
    // "soak" hit the paneer soaking in palak-paneer and downgraded a real
    // spinach caution. Anything softer belongs in preparation_note.
    for (const c of await loadFoodCautions()) {
      expect([null, "cooked"]).toContain(c.preparationClears);
    }
  });

  it("the oxalate caution does not claim a clearing preparation", async () => {
    const oxalate = (await loadFoodCautions()).find((c) => c.mechanism === "oxalate");
    expect(oxalate).toBeDefined();
    expect(oxalate!.preparationClears).toBeNull();
    expect(oxalate!.preparationNote).not.toEqual("");
  });
});

describe("condition matching", () => {
  const load = async (): Promise<FoodCaution[]> => loadFoodCautions();

  it("fires the goitrogen caution for a Hashimoto's client", async () => {
    const live = liveFoodCautions(HASHIMOTOS, await load());
    expect(live.map((c) => c.id).sort()).toEqual(["goitrogen-thyroid", "soy-thyroid"]);
    expect(live[0].matchedConditions).toContain("hashimoto");
  });

  it("separates the two kidney-stone types", async () => {
    // murray-stone-type-dictates-therapy: the therapies are OPPOSITE. A single
    // "kidney stones" caution would give half of stone formers wrong advice.
    const stones = liveFoodCautions(STONES, await load()).map((c) => c.id);
    const gout = liveFoodCautions(GOUT, await load()).map((c) => c.id);
    expect(stones).toEqual(["oxalate-calcium-stones"]);
    expect(gout).toEqual(["purine-uric-acid"]);
  });

  it("fires nothing for an unrelated condition", async () => {
    expect(liveFoodCautions(UNRELATED, await load())).toEqual([]);
  });

  it("fires nothing for a client with no conditions on record", async () => {
    expect(liveFoodCautions({}, await load())).toEqual([]);
  });

  it("reads medical_history as well as active_conditions", async () => {
    // A Hashimoto's client whose antibodies normalised is still hypothyroid,
    // and condition-status.ts resolves a condition by MOVING it into exactly
    // this list — so ignoring it would silently drop the caution on resolve.
    const resolved = { active_conditions: [], medical_history: ["Hashimoto's — resolved Jul 2026"] };
    expect(clientConditionText(resolved)).toContain("hashimoto");
    expect(liveFoodCautions(resolved, await load()).map((c) => c.id)).toContain(
      "goitrogen-thyroid",
    );
  });
});

describe("prose scanning", () => {
  it("finds a cautioned food named in coach prose", async () => {
    const cautions = await loadFoodCautions();
    const goitrogen = cautions.find((c) => c.id === "goitrogen-thyroid")!;
    const terms = await foodDisplayTerms(goitrogen.foods);
    expect(cautionedFoodsInText("millets, seasonal vegetables, ragi", goitrogen, terms)).toContain(
      "ragi",
    );
    expect(cautionedFoodsInText("rice, wheat roti, moong dal", goitrogen, terms)).toEqual([]);
  });

  it("does not match a short alias inside an unrelated word", async () => {
    // The guard the backlog suggestion chips needed after "IF" matched inside
    // "Behavior Modifications".
    const cautions = await loadFoodCautions();
    const goitrogen = cautions.find((c) => c.id === "goitrogen-thyroid")!;
    const terms = await foodDisplayTerms(goitrogen.foods);
    expect(cautionedFoodsInText("karela and kalonji", goitrogen, terms)).toEqual([]);
  });

  it("tolerates empty and missing text", async () => {
    const goitrogen = (await loadFoodCautions()).find((c) => c.id === "goitrogen-thyroid")!;
    const terms = await foodDisplayTerms(goitrogen.foods);
    expect(cautionedFoodsInText("", goitrogen, terms)).toEqual([]);
  });
});

describe("food display names", () => {
  it("names a food from its key, not its shortest alias", () => {
    // The shortest alias for `chicken` is "leg", which rendered the purine
    // caution as "lamb, fish, prawns, leg". Aliases are matching fodder; the
    // key is the canonical name.
    expect(plainFoodNames(["chicken"])).toEqual(["chicken"]);
    expect(plainFoodNames(["sesame-seeds"])).toEqual(["sesame seeds"]);
  });

  it("strips the table's bookkeeping suffixes", () => {
    expect(plainFoodNames(["millet-generic", "millet-cooked", "chickpeas-cooked"])).toEqual([
      "millet",
      "millet",
      "chickpeas",
    ]);
  });

  it("agrees with the Python engine on the same keys", async () => {
    const keys = ["chicken", "millet-generic", "millet-cooked", "sesame-seeds", "bajra-flour"];
    const script = [
      "import json,sys",
      "sys.path.insert(0, 'scripts')",
      "import food_cautions as fc",
      "print(json.dumps(fc.plain_food_names(json.loads(sys.argv[1]))))",
    ].join("\n");
    const { stdout } = await execFileP(PYTHON, ["-c", script, JSON.stringify(keys)], {
      cwd: process.cwd(),
    });
    // Python de-dupes (a prompt should not repeat "millet"); TS keeps the
    // per-key mapping the UI indexes into. Compare the de-duped forms.
    expect([...new Set(plainFoodNames(keys))]).toEqual(JSON.parse(stdout.trim()));
  });
});

describe("menu frequency — the staple check", () => {
  // Ragi in most meals: every dish looks innocent alone, and the week is the
  // thing the coach flagged.
  const RAGI_WEEK = [
    "Ragi roti (2) + moong dal (1 bowl)",
    "Ragi dosa (2) + coconut chutney",
    "Ragi porridge (1 bowl)",
    "Ragi roti (2) + lauki sabzi (1 bowl)",
    "Ragi idli (3) + sambar",
    "Rice (1 cup) + rajma (1 bowl)",
    "Poha (1 bowl)",
  ];
  const MIXED_WEEK = [
    "Ragi roti (2) + moong dal (1 bowl)",
    "Wheat roti (2) + palak sabzi",
    "Rice (1 cup) + sambar",
    "Poha (1 bowl)",
    "Idli (3) + chutney",
    "Jowar roti (2) + dal",
    "Upma (1 bowl)",
  ];

  it("flags a cautioned food that has become the week's base", async () => {
    const flags = await screenMenuForClient(HASHIMOTOS, RAGI_WEEK);
    expect(flags).toHaveLength(1);
    expect(flags[0].cautionId).toBe("goitrogen-thyroid");
    expect(flags[0].total).toBeGreaterThanOrEqual(5);
    expect(flags[0].foodCounts[0].food).toBe("ragi");
  });

  it("stays quiet on a properly rotated week", async () => {
    // Rule 15 asks for 2-3 appearances, not zero — millets rotating through a
    // varied week is exactly right, and flagging it would train her to ignore
    // the warning.
    expect(await screenMenuForClient(HASHIMOTOS, MIXED_WEEK)).toEqual([]);
  });

  it("counts regardless of preparation — cooked every day is the case", async () => {
    // Every dish in RAGI_WEEK is cooked. If the count demoted cooked dishes the
    // way the per-dish severity does, this flag could never fire.
    const flags = await screenMenuForClient(HASHIMOTOS, RAGI_WEEK);
    expect(flags[0].total).toBeGreaterThanOrEqual(5);
  });

  it("stays quiet for a client with no live caution", async () => {
    expect(await screenMenuForClient(UNRELATED, RAGI_WEEK)).toEqual([]);
  });

  it("agrees with the Python engine on the same week", async () => {
    const script = [
      "import json,sys",
      "sys.path.insert(0, 'scripts')",
      "import food_cautions as fc",
      "client, dishes = json.loads(sys.argv[1]), json.loads(sys.argv[2])",
      "live = fc.live_cautions(client, {})",
      "out = [{'id': f.caution.id, 'total': f.total} for f in fc.screen_menu(dishes, live)]",
      "print(json.dumps(out))",
    ].join("\n");
    const { stdout } = await execFileP(
      PYTHON,
      ["-c", script, JSON.stringify(HASHIMOTOS), JSON.stringify(RAGI_WEEK)],
      { cwd: process.cwd() },
    );
    const ts = (await screenMenuForClient(HASHIMOTOS, RAGI_WEEK)).map((f) => ({
      id: f.cautionId,
      total: f.total,
    }));
    expect(ts).toEqual(JSON.parse(stdout.trim()));
  });
});

describe("plan-conflict rule 6", () => {
  it("raises a warning when a cautioned food is named in the plan", async () => {
    const plan = { nutrition: { add: ["ragi", "moong dal", "seasonal vegetables"] } };
    const findings = await resolveFoodCautionFindings(HASHIMOTOS, plan);
    const conflicts = detectPlanConflicts(HASHIMOTOS, plan as never, findings);
    const c = conflicts.find((x) => x.id === "food-caution-goitrogen-thyroid");
    expect(c).toBeDefined();
    expect(c!.severity).toBe("warning");
    expect(c!.summary).toContain("named in this plan");
    // It must never propose removing the food — see the data file's rule 2.
    expect(c!.suggested_fix?.action.type).toBe("append_client_note");
    expect(JSON.stringify(c)).not.toContain("patch_client_field");
  });

  it("drops to info once the coach has recorded it in foods-to-avoid", async () => {
    // A detector that keeps firing after it has been acted on trains people to
    // ignore it.
    const client = { ...HASHIMOTOS, foods_to_avoid: "raw cabbage, raw kale" };
    const plan = { nutrition: { add: ["ragi"] } };
    const findings = await resolveFoodCautionFindings(client, plan);
    const conflicts = detectPlanConflicts(client, plan as never, findings);
    const c = conflicts.find((x) => x.id === "food-caution-goitrogen-thyroid")!;
    expect(c.severity).toBe("info");
    expect(c.suggested_fix).toBeUndefined();
  });

  it("stays silent for a client with no live caution", async () => {
    const findings = await resolveFoodCautionFindings(UNRELATED, null);
    const conflicts = detectPlanConflicts(UNRELATED, null, findings);
    expect(conflicts.filter((c) => c.kind === "condition_food_caution")).toEqual([]);
  });

  it("is a no-op when no findings are passed — every other rule is unaffected", () => {
    const conflicts = detectPlanConflicts(HASHIMOTOS, null);
    expect(conflicts.filter((c) => c.kind === "condition_food_caution")).toEqual([]);
  });
});

describe("the TS and Python engines agree", () => {
  /** Live caution ids for a client, straight out of scripts/food_cautions.py. */
  async function pythonLiveIds(client: unknown): Promise<string[]> {
    const script = [
      "import json,sys",
      "sys.path.insert(0, 'scripts')",
      "import food_cautions as fc",
      "client = json.loads(sys.argv[1])",
      "print(json.dumps(sorted(c.id for c in fc.live_cautions(client, {}))))",
    ].join("\n");
    const { stdout } = await execFileP(
      PYTHON,
      ["-c", script, JSON.stringify(client)],
      { cwd: process.cwd() },
    );
    return JSON.parse(stdout.trim());
  }

  it.each([
    ["hashimotos", HASHIMOTOS],
    ["calcium-oxalate stones", STONES],
    ["gout", GOUT],
    ["unrelated", UNRELATED],
  ])("matches Python on %s", async (_label, client) => {
    const ts = liveFoodCautions(client, await loadFoodCautions())
      .map((c) => c.id)
      .sort();
    expect(ts).toEqual(await pythonLiveIds(client));
  });
});
