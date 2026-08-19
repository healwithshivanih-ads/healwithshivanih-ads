import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { findClientFacingLeaks } from "./client-facing-leak";

describe("client-facing leak guard — unit", () => {
  it("catches the two lines that actually shipped to a client", () => {
    const hits = findClientFacingLeaks({
      lab_orders: [
        {
          test: "H. pylori — stool antigen or urea breath test, AFTER a 2-week break from his PPI (not the blood antibody test)",
        },
      ],
      nutrition: {
        meal_timing:
          "no soothing churan here, because the acidity is one of the things the GI referral needs to see honestly.",
      },
    });
    expect(hits.map((h) => h.field)).toContain("lab_orders[0].test");
    expect(hits.map((h) => h.field)).toContain("nutrition.meal_timing");
  });

  it("passes text written FOR the client", () => {
    expect(
      findClientFacingLeaks({
        lab_orders: [{ test: "H. pylori test (breath or stool)" }],
        nutrition: {
          meal_timing:
            "Finish dinner well before you lie down, and keep portions moderate rather than one big evening meal.",
          add: ["FRUIT — apple, nashpati, guava and jamun. Eat them whole, never as juice."],
        },
        supplement_protocol: [
          {
            client_note:
              "Your vitamin D came back genuinely low. It matters for your bones and how your body handles sugar.",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("does not object to a client reading their own lab VALUES structurally", () => {
    // Lab Vault renders values as data, not prose — nothing here to flag.
    expect(findClientFacingLeaks({ lab_orders: [{ test: "Blood tests — the 12-week recheck panel" }] }))
      .toEqual([]);
  });
});

// ── the standing sweep: every published plan, every time CI runs ─────────────
const PUBLISHED = path.join(
  process.env.FMDB_PLANS_DIR || path.join(os.homedir(), "fm-plans"),
  "published",
);

describe("client-facing leak guard — live published plans", () => {
  const files = fs.existsSync(PUBLISHED)
    ? fs.readdirSync(PUBLISHED).filter((f) => f.endsWith(".yaml"))
    : [];

  // A RATCHET, not a wall — the same shape as the duplicate-slug baseline the
  // pre-push hook already uses. When this guard was first written it found 40
  // real leaks across 8 plans, every one of them predating it. Failing CI on
  // all of them would have meant either rewriting eight live clients' plans in
  // one sitting or, far more likely, deleting the test. So the known set is
  // frozen in a baseline file and only NEW leaks fail.
  //
  // The baseline is a debt list, not an approval. Shrink it whenever a plan is
  // next edited; it should never grow.
  const BASELINE = path.join(__dirname, "__fixtures__", "client-facing-leak-baseline.json");

  it.skipIf(files.length === 0)("no NEW published plan leaks coach language", () => {
    const found = new Set<string>();
    const detail = new Map<string, string>();
    for (const f of files) {
      let plan: Record<string, unknown>;
      try {
        plan = yaml.load(fs.readFileSync(path.join(PUBLISHED, f), "utf8")) as Record<string, unknown>;
      } catch {
        continue; // malformed YAML is a different test's problem
      }
      if (!plan || plan.status !== "published") continue;
      for (const h of findClientFacingLeaks(plan)) {
        const key = `${f}::${h.field}::${h.rule}`;
        found.add(key);
        detail.set(key, h.excerpt);
      }
    }

    const known: string[] = fs.existsSync(BASELINE)
      ? (JSON.parse(fs.readFileSync(BASELINE, "utf8")).known ?? [])
      : [];
    const knownSet = new Set(known);
    const fresh = [...found].filter((k) => !knownSet.has(k)).sort();

    expect(
      fresh,
      fresh.length
        ? `\n${fresh.length} NEW client-facing leak(s) — text written about the client, ` +
          `not to them:\n\n` +
          fresh.map((k) => `  ${k.split("::").join("\n    ")}\n    ${detail.get(k)}`).join("\n\n") +
          `\n\nRewrite it in the second person, or move the clinical detail to a field the ` +
          `client does not read (lab_orders[].reason, notes_for_coach).\n`
        : "",
    ).toEqual([]);
  });
});
