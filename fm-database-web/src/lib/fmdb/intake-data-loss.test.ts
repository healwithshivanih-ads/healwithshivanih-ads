/**
 * Four ways the intake form quietly lost what a client typed.
 *
 * All four were found on 2026-08-19 while recovering Siddharth (cl-023), who
 * half-filled his form and then let the link lapse. None of them threw, none
 * logged, and three of them had already cost real client data:
 *
 *   1. `_write_staging_stub` REPLACED the staging client.yaml instead of
 *      merging into it. That file is shared with the companion-app projection
 *      (app-staging-action.py), so issuing an intake link to any of the 19
 *      clients whose app is live dropped `app_token` and broke their
 *      /app/<token> link until the app-staging cron happened to repair it.
 *
 *   2. `_reconcile_one`'s live-watch mirror copied `intake_form_draft` but not
 *      `intake_form_draft_saved_at`, so the authoritative record carried a
 *      draft with a null save time for ever. IntakeProgressCard computes
 *      `draftNewerThanSubmit` from that field; with NaN on one side the
 *      comparison is always false, so a client who submitted and then kept
 *      editing never got flagged as having recoverable answers.
 *
 *   3. The pre-discovery form's three free-text answers — chief_complaint,
 *      when_last_well, top_symptoms — were posted by the form and matched by
 *      nothing in `_apply_submit`'s allowlist. cl-007 and cl-022 both typed
 *      real clinical detail that reached only the audit session's raw payload.
 *
 *   4. Drug `condition_implications` were applied without a sex check.
 *      metformin.yaml rightly implies PCOS at moderate confidence, so cl-023 —
 *      a man on metformin — was given an active condition of "Suspected: PCOS",
 *      which would have flowed into his assessment and plan.
 *
 * These drive the REAL Python, so reinstating any of the four fails here.
 */
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

import { PY_TEST_TIMEOUT_MS, TEST_PYTHON } from "./test-python";

const SCRIPT = path.resolve(__dirname, "../../../scripts/intake-token-action.py");
const SCRIPTS_DIR = path.dirname(SCRIPT);

function py(body: string, env: Record<string, string> = {}): string {
  const src = `
import importlib.util, sys, json
sys.path.insert(0, ${JSON.stringify(SCRIPTS_DIR)})
spec = importlib.util.spec_from_file_location("itk", ${JSON.stringify(SCRIPT)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
from datetime import datetime, timedelta, timezone
${body}
`;
  const r = spawnSync(TEST_PYTHON, ["-c", src], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) throw new Error(r.stderr || "python failed");
  return r.stdout.trim();
}

function iso(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString();
}

function twoTrees(authYaml: string, stageYaml: string) {
  const root = mkdtempSync(path.join(tmpdir(), "intake-loss-"));
  const auth = path.join(root, "auth", "clients", "cl-023");
  const stage = path.join(root, "stage", "clients", "cl-023");
  mkdirSync(auth, { recursive: true });
  mkdirSync(stage, { recursive: true });
  writeFileSync(path.join(auth, "client.yaml"), authYaml);
  writeFileSync(path.join(stage, "client.yaml"), stageYaml);
  return {
    env: {
      FMDB_PLANS_DIR: path.join(root, "auth"),
      FMDB_STAGING_DIR: path.join(root, "stage"),
    },
    authFile: path.join(auth, "client.yaml"),
    stageFile: path.join(stage, "client.yaml"),
  };
}

describe("_write_staging_stub — shares a file with the companion app", () => {
  it(
    "merges, so issuing an intake link cannot strip a live app_token",
    () => {
      const t = twoTrees(
        `client_id: cl-023\nintake_token: fresh\n`,
        // What app-staging-action.py leaves behind for an app-live client.
        `client_id: cl-023\napp_token: APPTOKEN\nplan_modules:\n- schussler_salts\n` +
          `mind_body_depth: full\ntimezone: Asia/Kolkata\n`,
      );
      py(
        `m._write_staging_stub("cl-023", {"client_id": "cl-023", "intake_token": "fresh",
          "intake_token_expires_at": ${JSON.stringify(iso(14))}})`,
        t.env,
      );
      const after = readFileSync(t.stageFile, "utf8");
      // The app's half survives...
      expect(after).toContain("app_token: APPTOKEN");
      expect(after).toContain("schussler_salts");
      expect(after).toContain("mind_body_depth: full");
      expect(after).toContain("timezone: Asia/Kolkata");
      // ...and the intake half is written.
      expect(after).toContain("intake_token: fresh");
    },
    PY_TEST_TIMEOUT_MS,
  );
});

describe("_reconcile_one — the draft's save time is part of the draft", () => {
  it(
    "mirrors intake_form_draft_saved_at, not just the draft body",
    () => {
      const savedAt = iso(0);
      const t = twoTrees(
        `client_id: cl-023\nintake_token: tok\nintake_token_expires_at: '${iso(10)}'\n` +
          `updated_at: '${iso(-5)}'\n`,
        `client_id: cl-023\nintake_token: tok\nintake_token_expires_at: '${iso(10)}'\n` +
          `intake_form_draft:\n  sleep_notes: half filled\n` +
          `intake_form_draft_saved_at: '${savedAt}'\n`,
      );
      const out = py(`print(json.dumps(m._reconcile_one("cl-023")))`, t.env);
      expect(JSON.parse(out).actions).toContain("draft_mirrored");

      const saved = readFileSync(t.authFile, "utf8");
      expect(saved).toContain("half filled");
      // The bug: this line was absent, leaving the Mac copy null for ever.
      const got = /intake_form_draft_saved_at: '?([^'\n]+)'?/.exec(saved)?.[1] ?? "";
      expect(Date.parse(got)).toBe(Date.parse(savedAt));
    },
    PY_TEST_TIMEOUT_MS,
  );
});

describe("_apply_submit — the pre-discovery form's three free-text answers", () => {
  it(
    "persists chief_complaint / when_last_well / top_symptoms to client.yaml",
    () => {
      const t = twoTrees(`client_id: cl-007\nintake_token: tok\n`, `client_id: cl-007\n`);
      // The authoritative dir above is cl-023; write the one we submit against.
      const dir = path.join(t.env.FMDB_PLANS_DIR, "clients", "cl-007");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "client.yaml"), `client_id: cl-007\nintake_token: tok\n`);

      py(
        `data = m._load_client("cl-007")
m._apply_submit("cl-007", data, {
  "chief_complaint": "body pain and constipation for years",
  "when_last_well": "Can't remember",
  "top_symptoms": "joint pain; heaviness in the stomach",
})`,
        t.env,
      );
      const saved = readFileSync(path.join(dir, "client.yaml"), "utf8");
      expect(saved).toContain("body pain and constipation for years");
      expect(saved).toContain("Can't remember");
      expect(saved).toContain("heaviness in the stomach");
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "puts the client's own words in the session the assessment reads",
    () => {
      // analyse/full/page.tsx builds intakeSnapshot.chief_complaint from the
      // latest intake session's presenting_complaints. That used to be a
      // constant, so the coach saw boilerplate instead of the complaint.
      const out = py(`
import tempfile, os, yaml
root = tempfile.mkdtemp()
os.environ["FMDB_PLANS_DIR"] = root
os.makedirs(os.path.join(root, "clients", "cl-007"), exist_ok=True)
sid = m._write_quick_note_session("cl-007", {"chief_complaint": "body pain and constipation"})
p = os.path.join(root, "clients", "cl-007", "sessions", sid + ".yaml")
print(json.dumps(yaml.safe_load(open(p))["presenting_complaints"]))
`);
      const pc = JSON.parse(out) as string;
      expect(pc).toContain("body pain and constipation");
      // The tag stays — analyse/full/page.tsx filters intake sessions on it.
      expect(pc).toContain("[source: client_intake_form]");
    },
    PY_TEST_TIMEOUT_MS,
  );
});

describe("_merge_meds — the same drug under two spellings is one drug", () => {
  it(
    "SIDDHARTH'S CASE: 'Monjaro' in the free list absorbs the derived 'Mounjaro'",
    () => {
      // He typed the brand into current_medications AND filled the GLP-1
      // repeater. The old dedup compared spellings ("mounjaro" is not a
      // substring of "monjaro"), so his record listed the drug twice. The
      // matcher resolves both to glp1-agonists, so ask it instead.
      const out = py(`
import tempfile, os, yaml
root = tempfile.mkdtemp()
os.environ["FMDB_PLANS_DIR"] = root
d = os.path.join(root, "clients", "cl-t"); os.makedirs(d)
open(os.path.join(d, "client.yaml"), "w").write("client_id: cl-t\\nsex: M\\n")
data = m._load_client("cl-t")
m._apply_submit("cl-t", data, {"sex": "M", "current_medications": ["Monjaro"],
                               "glp1_medications": [{"name": "Mounjaro"}]})
print(json.dumps(yaml.safe_load(open(os.path.join(d, "client.yaml")))["current_medications"]))
`);
      const meds = JSON.parse(out) as string[];
      // Either spelling counts — the point is that the drug appears ONCE.
      expect(meds.filter((x) => /mo(u)?njaro/i.test(x))).toHaveLength(1);
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "GLP-1s are in the drug catalogue at all — brands, molecules and typos",
    () => {
      // There was no GLP-1 entry until 2026-08-19, so every client on one got
      // no condition implications, no protocol cautions and no drug_cautions
      // in their letters — while the intake form had a dedicated GLP-1
      // repeater and the enum a `glp1_agonist` class.
      const out = py(`print(json.dumps({n: (m._match_drug(n) or {}).get("slug")
        for n in ["Mounjaro", "Monjaro", "Ozempic 0.5mg", "Rybelsus", "semaglutide",
                  "tirzepatide", "Trulicity", "Saxenda"]}))`);
      const got = JSON.parse(out) as Record<string, string | null>;
      for (const [name, slug] of Object.entries(got)) {
        expect(slug, `${name} should resolve to the GLP-1 entry`).toBe("glp1-agonists");
      }
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "the GLP-1 entry declares no invented nutrient depletions",
    () => {
      // Its nutrient risk is intake-mediated, not pharmacological. `depletes`
      // must stay empty — the letter generator binds protocol_cautions as HARD
      // RULES, so a fabricated depletion mechanism would reach a client.
      const out = py(`
import yaml
p = m.FMDB_ROOT / "data" / "drug_depletions" / "glp1-agonists.yaml"
d = yaml.safe_load(p.read_text())
print(json.dumps({"depletes": d.get("depletes"), "sources": len(d.get("sources") or []),
                  "class": d.get("drug_class")}))
`);
      const d = JSON.parse(out) as { depletes: unknown[]; sources: number; class: string };
      expect(d.depletes).toEqual([]);
      expect(d.sources).toBeGreaterThan(0);
      expect(d.class).toBe("glp1_agonist");
    },
    PY_TEST_TIMEOUT_MS,
  );
});

describe("_derive_conditions_from_intake — anatomy gates the drug's implication", () => {
  it(
    "SIDDHARTH'S CASE: a man on metformin is not given Suspected: PCOS",
    () => {
      const out = py(`print(json.dumps(m._derive_conditions_from_intake(
        {"sex": "M", "current_medications": ["metformin 500"]})))`);
      const got = JSON.parse(out) as string[];
      expect(got.join(" | ").toLowerCase()).not.toContain("pcos");
      // The rest of metformin's implication still lands.
      expect(got.join(" | ").toLowerCase()).toContain("insulin resistance");
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "still infers PCOS for a woman on the same drug",
    () => {
      const out = py(`print(json.dumps(m._derive_conditions_from_intake(
        {"sex": "F", "current_medications": ["metformin 500"]})))`);
      expect((JSON.parse(out) as string[]).join(" | ")).toContain("Suspected: PCOS");
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "fails OPEN when sex is unrecorded — the coach reviews a Suspected: line",
    () => {
      const out = py(`print(json.dumps(m._derive_conditions_from_intake(
        {"sex": "", "current_medications": ["metformin 500"]})))`);
      expect((JSON.parse(out) as string[]).join(" | ")).toContain("Suspected: PCOS");
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "confirmed beats suspected — two drugs implying one condition give one row",
    () => {
      // metformin implies T2D at high confidence, the GLP-1 class at moderate.
      // Both fire for a client on both drugs; the record used to list
      // "Type 2 diabetes / insulin resistance" AND "Suspected: Type 2
      // diabetes / insulin resistance" together. Order must not matter.
      const both = `{"sex": "M", "current_medications": ["Mounjaro", "metformin"]}`;
      const flipped = `{"sex": "M", "current_medications": ["metformin", "Mounjaro"]}`;
      for (const p of [both, flipped]) {
        const got = JSON.parse(py(`print(json.dumps(m._derive_conditions_from_intake(${p})))`)) as string[];
        expect(got).toContain("Type 2 diabetes / insulin resistance");
        expect(got).not.toContain("Suspected: Type 2 diabetes / insulin resistance");
      }
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "gates the repro_diagnoses path too, not just the drug-catalogue one",
    () => {
      // Same gate, different entry point: `repro_diagnoses` maps a reported
      // diagnosis straight to a condition label.
      const out = py(`print(json.dumps(m._derive_conditions_from_intake(
        {"sex": "M", "repro_diagnoses": ["endometriosis"]})))`);
      expect(JSON.parse(out).join(" | ").toLowerCase()).not.toContain("endometrio");
    },
    PY_TEST_TIMEOUT_MS,
  );
});
