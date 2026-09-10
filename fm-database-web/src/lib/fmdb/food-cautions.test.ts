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
import os from "node:os";
import yaml from "js-yaml";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TEST_PYTHON as PYTHON } from "./test-python";
import {
  loadFoodCautions,
  liveFoodCautions,
  cautionedFoodsInText,
  plainFoodNames,
  screenMenuForClient,
  resolveFoodCautionFindings,
  clientConditionText,
  type FoodCaution,
} from "./food-cautions";
import { loadFoodMatcher } from "./recipe-nutrients";
import { detectPlanConflicts } from "./plan-conflicts";

const execFileP = promisify(execFile);
const CATALOGUE = path.join(process.cwd(), "..", "fm-database", "data");

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

  it("splits the millets — bajra is not ragi, and neither is a brassica", async () => {
    // "Millet is goitrogenic" is too coarse. Content varies ~10x across species
    // (finger millet 31-43 mg/kg vs pearl millet 15-541), and bajra's active
    // compound inhibits TPO rather than acting as a thiocyanate — so it cannot
    // sit in the same preparation bucket as raw cabbage. Merging these back
    // into one entry is what made the tool warn hardest about ragi, the
    // mildest of them.
    const byId = new Map((await loadFoodCautions()).map((c) => [c.id, c]));
    const bajra = byId.get("goitrogen-pearl-millet-thyroid")!;
    const other = byId.get("goitrogen-millet-other-thyroid")!;
    const brassica = byId.get("goitrogen-brassica-thyroid")!;

    expect(bajra.foods).toEqual(["bajra-flour"]);
    expect(other.foods).toContain("ragi");
    expect(other.foods).not.toContain("bajra-flour");
    expect(brassica.foods).toContain("cabbage");
    expect(brassica.foods).not.toContain("ragi");

    // Mechanism drives preparation, and this is the whole reason for the split.
    expect(bajra.mechanism).toBe("tpo_binding");
    expect(bajra.preparationClears).toBeNull();
    expect(bajra.preparationNote).not.toEqual("");
    expect(other.preparationClears).toBe("cooked");
    expect(brassica.preparationClears).toBe("cooked");
  });

  it("does not caution foxtail millet for goitrogens — it is the safe rotation grain", async () => {
    // Reported negligible. Cautioning it would cost a thyroid client the
    // easiest millet to rotate in, for nothing — and rotation is the actual
    // intervention. Phytate is a separate, family-wide axis and DOES cover it.
    const goitrogenFoods = (await loadFoodCautions())
      .filter((c) => c.mechanism === "goitrogen" || c.mechanism === "tpo_binding")
      .flatMap((c) => c.foods);
    expect(goitrogenFoods).not.toContain("millet-foxtail");
  });

  it("cites the independently-ingested corroborating claim on bajra", async () => {
    // pearl-millet-goitrogens-heat-stable-unlike-brassica came from the UAS
    // Bengaluru millet-book ingest, reaching the same heat-stability
    // conclusion by a different route. If it ever disappears from the
    // catalogue this entry loses its strongest support and should be re-read.
    const bajra = (await loadFoodCautions()).find(
      (c) => c.id === "goitrogen-pearl-millet-thyroid",
    )!;
    expect(bajra.claims).toContain("pearl-millet-goitrogens-heat-stable-unlike-brassica");
  });

  it("the phytate caution covers EVERY millet in the ingredient table", async () => {
    // Drift guard. Phytate is a family-wide property, so this caution claims
    // to cover all millets — but a key that is simply absent produces no
    // error, no warning and no hit, and looks identical to a caution that
    // found nothing. `millet-little` and `millet-proso` were added to the
    // table by two PRs merging alongside this work and fell straight out of
    // coverage exactly that way. The next new millet fails here instead.
    const table = yaml.load(
      await fs.readFile(path.join(CATALOGUE, "_ingredient_nutrients.yaml"), "utf-8"),
    ) as Record<string, unknown>;
    const millets = Object.keys(table).filter(
      (k) =>
        !k.startsWith("_") &&
        (k.includes("millet") || ["ragi", "bajra-flour", "jowar-flour"].includes(k)),
    );
    const phytate = (await loadFoodCautions()).find((c) => c.id === "phytate-iron-zinc")!;
    expect(millets.filter((m) => !phytate.foods.includes(m))).toEqual([]);
  });

  it("the phytate caution covers ALL millets and barely down-ranks them", async () => {
    // The entry that proves severity is not "how bad is this food". Millets are
    // themselves iron-rich, so down-ranking them for an iron-deficient client
    // would push away part of the answer. Preparation and timing are the levers.
    const phytate = (await loadFoodCautions()).find((c) => c.id === "phytate-iron-zinc")!;
    expect(phytate.severity).toBe("monitor");
    expect(phytate.foods).toContain("millet-foxtail");
    expect(phytate.foods).toContain("ragi");
    expect(phytate.foods).toContain("bajra-flour");
    // Reduces, not inactivates — so no clearing preparation, guidance in the note.
    expect(phytate.preparationClears).toBeNull();
    expect(phytate.preparationNote).toMatch(/soak/i);
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

  it("fires the goitrogen cautions for a Hashimoto's client", async () => {
    const live = liveFoodCautions(HASHIMOTOS, await load());
    expect(live.map((c) => c.id).sort()).toEqual([
      "goitrogen-brassica-thyroid",
      "goitrogen-millet-other-thyroid",
      "goitrogen-pearl-millet-thyroid",
      "soy-thyroid",
    ]);
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

  it("fires only the phytate caution for an iron-deficient client", async () => {
    // Not the thyroid ones — millets are relevant to both, for different
    // reasons, and firing the goitrogen note at an anaemic client would be
    // noise she has to dismiss every time.
    const anaemic = { active_conditions: ["Iron deficiency anaemia", "Heavy periods"] };
    expect(liveFoodCautions(anaemic, await load()).map((c) => c.id)).toEqual([
      "phytate-iron-zinc",
    ]);
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
      "goitrogen-millet-other-thyroid",
    );
  });
});

describe("prose scanning", () => {
  it("finds a cautioned food named in coach prose", async () => {
    const cautions = await loadFoodCautions();
    const goitrogen = cautions.find((c) => c.id === "goitrogen-millet-other-thyroid")!;
    const matcher = await loadFoodMatcher();
    expect(cautionedFoodsInText("millets, seasonal vegetables, ragi", goitrogen, matcher)).toContain(
      "ragi",
    );
    expect(cautionedFoodsInText("rice, wheat roti, moong dal", goitrogen, matcher)).toEqual([]);
  });

  it("does not match a short alias inside an unrelated word", async () => {
    // The guard the backlog suggestion chips needed after "IF" matched inside
    // "Behavior Modifications".
    const cautions = await loadFoodCautions();
    const goitrogen = cautions.find((c) => c.id === "goitrogen-millet-other-thyroid")!;
    const matcher = await loadFoodMatcher();
    expect(cautionedFoodsInText("karela and kalonji", goitrogen, matcher)).toEqual([]);
  });

  it("tolerates empty and missing text", async () => {
    const goitrogen = (await loadFoodCautions()).find((c) => c.id === "goitrogen-millet-other-thyroid")!;
    const matcher = await loadFoodMatcher();
    expect(cautionedFoodsInText("", goitrogen, matcher)).toEqual([]);
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
    expect(flags[0].cautionId).toBe("goitrogen-millet-other-thyroid");
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

describe("one key per MENTION, not per text", () => {
  /**
   * Two halves that pull in opposite directions, and BOTH have to hold.
   *
   * Half one — a text can name SEVERAL cautioned foods and every one must
   * surface. The resolver used to answer "which food IS this text?" and return
   * a single winner, so the losers were dropped silently.
   *
   * Half two — within one MENTION the most specific name still wins. Simply
   * returning every alias that matched anywhere would break this, and it is
   * not a nicety: `_food_cautions.yaml` leaves foxtail millet uncautioned on
   * purpose, so letting the bare word "millet" fire inside "foxtail millet"
   * re-flags the millet that is the safe substitute.
   *
   * A fix that only does half one passes the first test and fails the second.
   */
  const GOUT = { active_conditions: ["gout"] };

  it("surfaces a cautioned food a longer alias used to swallow", async () => {
    // "drumstick" (the vegetable) is a longer alias than "chicken", so this
    // dish resolved to drumstick and a gout client's chicken carried no purine
    // caution at all.
    const cautions = await loadFoodCautions();
    const purine = cautions.find((c) => c.id === "purine-uric-acid")!;
    const matcher = await loadFoodMatcher();
    expect(cautionedFoodsInText("Chicken drumstick curry", purine, matcher)).toContain("chicken");
  });

  it("surfaces every cautioned food in one line, not just the winner", async () => {
    const cautions = await loadFoodCautions();
    const oxalate = cautions.find((c) => c.id === "oxalate-calcium-stones")!;
    const matcher = await loadFoodMatcher();
    // The library really does write lines like this; `normalize_item` split on
    // " or " and kept only the first, so the rest were invisible.
    const found = cautionedFoodsInText("kale, Swiss chard leaves or baby spinach", oxalate, matcher);
    expect(found).toContain("spinach");
    expect(found).toContain("swiss-chard");
  });

  it("keeps the millet species split — foxtail is NOT generic millet", async () => {
    const cautions = await loadFoodCautions();
    const milletOther = cautions.find((c) => c.id === "goitrogen-millet-other-thyroid")!;
    const matcher = await loadFoodMatcher();
    // `millet-generic` is on this caution; `millet-foxtail` deliberately is not.
    expect(milletOther.foods).toContain("millet-generic");
    expect(milletOther.foods).not.toContain("millet-foxtail");
    expect(cautionedFoodsInText("Foxtail millet dosa", milletOther, matcher)).toEqual([]);
    // and the generic word on its own still does fire
    expect(cautionedFoodsInText("Vegetable millet pulao", milletOther, matcher)).toContain(
      "millet-generic",
    );
  });

  it("keeps sweet potato out of the potato caution's mouth", async () => {
    const cautions = await loadFoodCautions();
    const oxalate = cautions.find((c) => c.id === "oxalate-calcium-stones")!;
    const matcher = await loadFoodMatcher();
    // Both are on this caution, so the ASSERTION is about which key is named —
    // a menu flag reads back the food it counted.
    expect(cautionedFoodsInText("Sweet potato bisque", oxalate, matcher)).toEqual(["sweet-potato"]);
  });

  it("agrees with the Python engine on every one of those texts", async () => {
    // The two resolvers are separate implementations of the same rule. Pin
    // them on the adversarial cases, not only on a happy-path week.
    const TEXTS = [
      "Chicken drumstick curry",
      "kale, Swiss chard leaves or baby spinach",
      "Foxtail millet dosa",
      "Vegetable millet pulao",
      "Sweet potato bisque",
      "jowar or bajra flour",
      "mixed vegetables (carrot, beans, cauliflower, peas)",
      "mustard powder (rai)",
      "",
    ];
    const script = [
      "import json,sys",
      "sys.path.insert(0, 'scripts')",
      "import food_cautions as fc",
      "texts = json.loads(sys.argv[1])",
      "print(json.dumps({t: sorted(fc.foods_named_in([t])) for t in texts}))",
    ].join("\n");
    const { stdout } = await execFileP(PYTHON, ["-c", script, JSON.stringify(TEXTS)], {
      cwd: process.cwd(),
    });
    const py = JSON.parse(stdout.trim()) as Record<string, string[]>;
    const matcher = await loadFoodMatcher();
    const ts = Object.fromEntries(TEXTS.map((t) => [t, [...matcher.foodsIn(t)].sort()]));
    expect(ts).toEqual(py);
  });

  it("resolves every text in the library identically to the Python engine", async () => {
    // The nine adversarial texts above are the cases I thought of. This is the
    // one that catches the cases I did not: every dish name and every
    // ingredient line in the catalogue, through both resolvers, compared key
    // for key. Same shape as the whole-library replay in
    // recipe-nutrients.test.ts, and the reason a drift between the two engines
    // fails here rather than quietly changing what a client is warned about.
    const dir = path.join(CATALOGUE, "_recipes");
    const texts = new Set<string>();
    for (const f of (await fs.readdir(dir)).filter((x) => x.endsWith(".yaml"))) {
      const r = yaml.load(await fs.readFile(path.join(dir, f), "utf-8")) as {
        name?: string;
        ingredients?: { item?: string }[];
      };
      if (r?.name) texts.add(String(r.name));
      for (const i of r?.ingredients ?? []) if (i?.item) texts.add(String(i.item));
    }
    const list = [...texts];
    expect(list.length, "the sweep must have real texts or it proves nothing").toBeGreaterThan(1500);

    //  Via a temp file, not stdin: promisified execFile has no `input` option,
    //  so a stdin-reading child just blocks until the test times out.
    const tmp = path.join(os.tmpdir(), `fm-caution-parity-${process.pid}.json`);
    await fs.writeFile(tmp, JSON.stringify(list), "utf-8");
    const script = [
      "import json,sys",
      "sys.path.insert(0, 'scripts')",
      "import food_cautions as fc",
      "texts = json.load(open(sys.argv[1]))",
      "print(json.dumps({t: sorted(fc.foods_named_in([t])) for t in texts}))",
    ].join("\n");
    let py: Record<string, string[]>;
    try {
      const { stdout } = await execFileP(PYTHON, ["-c", script, tmp], {
        cwd: process.cwd(),
        maxBuffer: 1 << 28,
      });
      py = JSON.parse(stdout.trim()) as Record<string, string[]>;
    } finally {
      await fs.rm(tmp, { force: true });
    }
    const matcher = await loadFoodMatcher();

    const diffs: string[] = [];
    for (const s of list) {
      const ours = [...matcher.foodsIn(s)].sort();
      if (JSON.stringify(ours) !== JSON.stringify(py[s]))
        diffs.push(`${JSON.stringify(s)}\n  ts=${JSON.stringify(ours)}\n  py=${JSON.stringify(py[s])}`);
    }
    expect(diffs.slice(0, 10).join("\n") || "identical").toBe("identical");
    //  One Python process over ~1.8k texts — comfortably past the 5s default.
  }, 30_000);

  it("screens a gout client's chicken curry, which it used to miss entirely", async () => {
    const script = [
      "import json,sys,yaml",
      "sys.path.insert(0, 'scripts')",
      "import food_cautions as fc",
      "r = yaml.safe_load(open(sys.argv[1]))",
      "live = fc.live_cautions(json.loads(sys.argv[2]), {})",
      "print(json.dumps(sorted({h.caution.id for h in fc.screen_recipe(r, live)})))",
    ].join("\n");
    const { stdout } = await execFileP(
      PYTHON,
      [
        "-c",
        script,
        path.join(CATALOGUE, "_recipes", "chicken-drumstick-curry.yaml"),
        JSON.stringify(GOUT),
      ],
      { cwd: process.cwd() },
    );
    expect(JSON.parse(stdout.trim())).toContain("purine-uric-acid");
  });
});

describe("plan-conflict rule 6", () => {
  it("raises a warning when a cautioned food is named in the plan", async () => {
    const plan = { nutrition: { add: ["ragi", "moong dal", "seasonal vegetables"] } };
    const findings = await resolveFoodCautionFindings(HASHIMOTOS, plan);
    const conflicts = detectPlanConflicts(HASHIMOTOS, plan as never, findings);
    const c = conflicts.find((x) => x.id === "food-caution-goitrogen-millet-other-thyroid");
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
    const plan = { nutrition: { add: ["cabbage", "kale"] } };
    const findings = await resolveFoodCautionFindings(client, plan);
    const conflicts = detectPlanConflicts(client, plan as never, findings);
    const c = conflicts.find((x) => x.id === "food-caution-goitrogen-brassica-thyroid")!;
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
