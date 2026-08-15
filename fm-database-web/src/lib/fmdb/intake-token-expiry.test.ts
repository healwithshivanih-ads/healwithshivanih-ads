/**
 * An intake link must not expire under a client who is still filling it in.
 *
 * WHY THIS SUITE EXISTS. The 14-day TTL ran from ISSUE and nothing reset it,
 * so a client who started the form and came back a fortnight later found it
 * dead with half their answers behind it. Three clients hit it: Dhanishta
 * (cl-004) and Nidhi (see the B4 note in send-intake-form-button.tsx), then
 * Siddharth (cl-023) mid-form at roughly half filled.
 *
 * It also degrades badly. On Fly the per-minute reconciler purges the staging
 * copy the moment the token lapses, so the token stops resolving at all and
 * the honest "This link has expired" becomes "We couldn't find this link".
 *
 * Second contract pinned here: the purge must never be lossy. Both revoke and
 * finalise reconcile first, deliberately, "so finalising can never strand a
 * final submission on Fly" — but the coach-edit guard can make that reconcile
 * a no-op, and the purge then deletes answers that existed only in staging.
 *
 * These drive the REAL Python, so a refactor that reinstates either hole fails
 * here rather than in front of a client.
 */
import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

import { PY_TEST_TIMEOUT_MS, TEST_PYTHON } from "./test-python";

const SCRIPT = path.resolve(__dirname, "../../../scripts/intake-token-action.py");
const SCRIPTS_DIR = path.dirname(SCRIPT);

/** Run a snippet against the real shim, with the module bound as `m`. */
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

/** A plans root with one client, returning {root, id}. */
function makeRoot(clientYaml: string, bucket = "clients") {
  const root = mkdtempSync(path.join(tmpdir(), "intake-exp-"));
  const dir = path.join(root, bucket, "cl-023");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "client.yaml"), clientYaml);
  return root;
}

describe("_maybe_extend_token — sliding expiry", () => {
  it(
    "SIDDHARTH'S CASE: a live token about to lapse slides forward",
    () => {
      const out = py(`
data = {"intake_token": "tok", "intake_token_expires_at": ${JSON.stringify(iso(2))}}
changed = m._maybe_extend_token(data)
exp = m._parse_dt(data["intake_token_expires_at"])
days = (exp - datetime.now(timezone.utc)).total_seconds() / 86400
print(json.dumps({"changed": changed, "days": round(days)}))
`);
      expect(JSON.parse(out)).toEqual({ changed: true, days: 14 });
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "refuses to revive an ALREADY-expired link — that stays the coach's call",
    () => {
      const out = py(`
data = {"intake_token": "tok", "intake_token_expires_at": ${JSON.stringify(iso(-1))}}
print(json.dumps({"changed": m._maybe_extend_token(data),
                  "exp": data["intake_token_expires_at"]}))
`);
      const r = JSON.parse(out);
      expect(r.changed).toBe(false);
      // untouched
      expect(new Date(r.exp).getTime()).toBeLessThan(Date.now());
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "is a no-op once the token is cleared (revoked / finalised)",
    () => {
      const out = py(`
data = {"intake_token": None, "intake_token_expires_at": ${JSON.stringify(iso(3))}}
print(json.dumps(m._maybe_extend_token(data)))
`);
      expect(JSON.parse(out)).toBe(false);
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "is forward-only — never pulls a far-future expiry back in",
    () => {
      const out = py(`
data = {"intake_token": "tok", "intake_token_expires_at": ${JSON.stringify(iso(40))},
        "intake_token_issued_at": ${JSON.stringify(iso(-1))}}
print(json.dumps({"changed": m._maybe_extend_token(data),
                  "exp": data["intake_token_expires_at"]}))
`);
      const r = JSON.parse(out);
      expect(r.changed).toBe(false);
      expect(new Date(r.exp).getTime()).toBeGreaterThan(Date.now() + 35 * 86_400_000);
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "caps at 90 days from issue — an active link still cannot live forever",
    () => {
      const out = py(`
# Issued 85 days ago and still being touched: the slide must clip to the
# ceiling (90d from issue = 5d from now), not run to 14 days.
data = {"intake_token": "tok",
        "intake_token_issued_at": ${JSON.stringify(iso(-85))},
        "intake_token_expires_at": ${JSON.stringify(iso(1))}}
changed = m._maybe_extend_token(data)
exp = m._parse_dt(data["intake_token_expires_at"])
print(json.dumps({"changed": changed,
                  "days": round((exp - datetime.now(timezone.utc)).total_seconds()/86400)}))
`);
      expect(JSON.parse(out)).toEqual({ changed: true, days: 5 });
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "past the ceiling entirely, it stops sliding",
    () => {
      const out = py(`
data = {"intake_token": "tok",
        "intake_token_issued_at": ${JSON.stringify(iso(-120))},
        "intake_token_expires_at": ${JSON.stringify(iso(2))}}
print(json.dumps(m._maybe_extend_token(data)))
`);
      expect(JSON.parse(out)).toBe(false);
    },
    PY_TEST_TIMEOUT_MS,
  );
});

describe("action_save_draft — typing keeps the link alive", () => {
  it(
    "an autosave slides the expiry, so the form cannot die mid-answer",
    () => {
      const root = makeRoot(
        `client_id: cl-023\ndisplay_name: Test\nintake_token: tok-abc\n` +
          `intake_token_expires_at: '${iso(1)}'\n`,
      );
      const out = py(
        `
print(json.dumps(m.action_save_draft({"token": "tok-abc", "draft": {"sleep_notes": "half filled"}})))
`,
        { FMDB_PLANS_DIR: root },
      );
      expect(JSON.parse(out).ok).toBe(true);

      const saved = readFileSync(
        path.join(root, "clients", "cl-023", "client.yaml"),
        "utf8",
      );
      const exp = /intake_token_expires_at: '?([^'\n]+)'?/.exec(saved)?.[1] ?? "";
      const days = (Date.parse(exp) - Date.now()) / 86_400_000;
      expect(Math.round(days)).toBe(14);
      // and the draft itself landed
      expect(saved).toContain("half filled");
    },
    PY_TEST_TIMEOUT_MS,
  );
});

describe("_reconcile_one — expiry mirrors forward, guard still guards", () => {
  /** Build authoritative + staging trees for one client. */
  function twoTrees(authYaml: string, stageYaml: string) {
    const root = mkdtempSync(path.join(tmpdir(), "intake-rec-"));
    const auth = path.join(root, "auth", "clients", "cl-023");
    const stage = path.join(root, "stage", "clients", "cl-023");
    mkdirSync(auth, { recursive: true });
    mkdirSync(stage, { recursive: true });
    writeFileSync(path.join(auth, "client.yaml"), authYaml);
    writeFileSync(path.join(stage, "client.yaml"), stageYaml);
    return {
      root,
      env: {
        FMDB_PLANS_DIR: path.join(root, "auth"),
        FMDB_STAGING_DIR: path.join(root, "stage"),
      },
      authFile: path.join(auth, "client.yaml"),
    };
  }

  it(
    "carries a client-extended expiry back to the Mac, so the cron stops purging them",
    () => {
      const t = twoTrees(
        `client_id: cl-023\nintake_token: tok\nintake_token_expires_at: '${iso(1)}'\n` +
          `updated_at: '${iso(-5)}'\n`,
        `client_id: cl-023\nintake_token: tok\nintake_token_expires_at: '${iso(14)}'\n` +
          `intake_form_draft:\n  sleep_notes: half filled\n` +
          `intake_form_draft_saved_at: '${iso(0)}'\n`,
      );
      const out = py(`print(json.dumps(m._reconcile_one("cl-023")))`, t.env);
      expect(JSON.parse(out).actions).toContain("expiry_extended");

      const saved = readFileSync(t.authFile, "utf8");
      const exp = /intake_token_expires_at: '?([^'\n]+)'?/.exec(saved)?.[1] ?? "";
      expect(Math.round((Date.parse(exp) - Date.now()) / 86_400_000)).toBe(14);
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "REGRESSION: extending the expiry must not make the guard swallow the draft",
    () => {
      // The expiry write calls _save_client, which stamps updated_at = now.
      // Read updated_at AFTER that and the guard compares the client's activity
      // against this function's own save and skips every time — silently
      // freezing the draft mirror for everyone.
      const t = twoTrees(
        `client_id: cl-023\nintake_token: tok\nintake_token_expires_at: '${iso(1)}'\n` +
          `updated_at: '${iso(-5)}'\n`,
        `client_id: cl-023\nintake_token: tok\nintake_token_expires_at: '${iso(14)}'\n` +
          `intake_form_draft:\n  sleep_notes: half filled\n` +
          `intake_form_draft_saved_at: '${iso(0)}'\n`,
      );
      const out = py(`print(json.dumps(m._reconcile_one("cl-023")))`, t.env);
      const actions = JSON.parse(out).actions;
      expect(actions).toContain("draft_mirrored");
      expect(actions).not.toContain("skipped_coach_newer");
      expect(readFileSync(t.authFile, "utf8")).toContain("half filled");
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "never pulls the expiry IN from staging — forward-only",
    () => {
      const t = twoTrees(
        `client_id: cl-023\nintake_token: tok\nintake_token_expires_at: '${iso(20)}'\n` +
          `updated_at: '${iso(-5)}'\n`,
        `client_id: cl-023\nintake_token: tok\nintake_token_expires_at: '${iso(2)}'\n` +
          `intake_form_draft_saved_at: '${iso(0)}'\n`,
      );
      const out = py(`print(json.dumps(m._reconcile_one("cl-023")))`, t.env);
      expect(JSON.parse(out).actions).not.toContain("expiry_extended");

      const saved = readFileSync(t.authFile, "utf8");
      const exp = /intake_token_expires_at: '?([^'\n]+)'?/.exec(saved)?.[1] ?? "";
      expect(Math.round((Date.parse(exp) - Date.now()) / 86_400_000)).toBe(20);
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "the coach-edit guard still wins when the coach really is newer",
    () => {
      const t = twoTrees(
        `client_id: cl-023\nintake_token: tok\nintake_token_expires_at: '${iso(10)}'\n` +
          `non_negotiables: coach wrote this\nupdated_at: '${iso(0)}'\n`,
        `client_id: cl-023\nintake_token: tok\nintake_token_expires_at: '${iso(10)}'\n` +
          `intake_form_draft:\n  non_negotiables: stale prefill echo\n` +
          `intake_form_draft_saved_at: '${iso(-3)}'\n`,
      );
      const out = py(`print(json.dumps(m._reconcile_one("cl-023")))`, t.env);
      expect(JSON.parse(out).actions).toEqual(["skipped_coach_newer"]);
      expect(readFileSync(t.authFile, "utf8")).toContain("coach wrote this");
    },
    PY_TEST_TIMEOUT_MS,
  );
});

describe("_purge_staging_after — deleting staging is never lossy", () => {
  function twoTrees(authYaml: string, stageYaml: string) {
    const root = mkdtempSync(path.join(tmpdir(), "intake-purge-"));
    const auth = path.join(root, "auth", "clients", "cl-023");
    const stage = path.join(root, "stage", "clients", "cl-023");
    mkdirSync(auth, { recursive: true });
    mkdirSync(stage, { recursive: true });
    writeFileSync(path.join(auth, "client.yaml"), authYaml);
    writeFileSync(path.join(stage, "client.yaml"), stageYaml);
    return {
      authDir: auth,
      stageDir: stage,
      env: {
        FMDB_PLANS_DIR: path.join(root, "auth"),
        FMDB_STAGING_DIR: path.join(root, "stage"),
      },
    };
  }

  it(
    "THE HOLE: a draft the guard refused to merge is rescued before the delete",
    () => {
      const t = twoTrees(
        `client_id: cl-023\nintake_token: null\nnon_negotiables: coach wrote this\n` +
          `updated_at: '${iso(0)}'\n`,
        `client_id: cl-023\nintake_token: tok\n` +
          `intake_form_draft:\n  sleep_notes: answers only on Fly\n` +
          `intake_form_draft_saved_at: '${iso(-3)}'\n`,
      );
      const out = py(
        `
recon = m._reconcile_one("cl-023")
purged = m._purge_staging_after("cl-023", recon)
print(json.dumps({"actions": recon["actions"], "purged": purged}))
`,
        t.env,
      );
      const r = JSON.parse(out);
      expect(r.actions).toEqual(["skipped_coach_newer"]);
      expect(r.purged).toBe(true);

      // staging really is gone…
      expect(existsSync(path.join(t.stageDir, "client.yaml"))).toBe(false);
      // …but the answers survived, and the coach's field is untouched.
      const rescues = readdirSync(t.authDir).filter((f) =>
        f.startsWith("_unreconciled_intake_"),
      );
      expect(rescues).toHaveLength(1);
      expect(readFileSync(path.join(t.authDir, rescues[0]), "utf8")).toContain(
        "answers only on Fly",
      );
      expect(readFileSync(path.join(t.authDir, "client.yaml"), "utf8")).toContain(
        "coach wrote this",
      );
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "a normal purge writes no rescue clutter",
    () => {
      const t = twoTrees(
        `client_id: cl-023\nintake_token: null\nupdated_at: '${iso(-5)}'\n`,
        `client_id: cl-023\nintake_token: tok\n` +
          `intake_form_draft:\n  sleep_notes: mirrored fine\n` +
          `intake_form_draft_saved_at: '${iso(0)}'\n`,
      );
      py(
        `
recon = m._reconcile_one("cl-023")
m._purge_staging_after("cl-023", recon)
`,
        t.env,
      );
      expect(
        readdirSync(t.authDir).filter((f) => f.startsWith("_unreconciled_intake_")),
      ).toHaveLength(0);
      // the draft went the normal route instead
      expect(readFileSync(path.join(t.authDir, "client.yaml"), "utf8")).toContain(
        "mirrored fine",
      );
    },
    PY_TEST_TIMEOUT_MS,
  );
});
