/**
 * Intake reminders are the coach's choice, per person.
 *
 * WHY THIS SUITE EXISTS. Issuing an intake link used to switch the reminder
 * cron on by itself. Krishiv (cl-910) — a one-off Foundation client whose
 * call was already done — was then told twice that his form was "still
 * waiting" (27 Oct and 1 Nov 2026), on his mother's number. The cron cannot
 * tell a one-off from someone still being onboarded, so a new link now starts
 * with reminders off and only `set_reminders` turns them on.
 *
 * Drives the REAL Python, so reinstating the old default fails here.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { PY_TEST_TIMEOUT_MS, TEST_PYTHON } from "./test-python";
import { intakeReminderDecision } from "./intake-reminder";

const SCRIPT = path.resolve(__dirname, "../../../scripts/intake-token-action.py");

function makeRoot(client: Record<string, unknown>) {
  const root = mkdtempSync(path.join(tmpdir(), "intake-optin-"));
  const dir = path.join(root, "clients", "cl-910");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "client.yaml"), yaml.dump({ client_id: "cl-910", ...client }));
  return root;
}

function run(root: string, payload: Record<string, unknown>) {
  const r = spawnSync(TEST_PYTHON, [SCRIPT], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, FMDB_PLANS_DIR: root, FMDB_STAGING_DIR: "" },
  });
  if (r.status !== 0 && !r.stdout) throw new Error(r.stderr || "python failed");
  return JSON.parse(r.stdout) as Record<string, unknown>;
}

function readClient(root: string) {
  return yaml.load(
    readFileSync(path.join(root, "clients", "cl-910", "client.yaml"), "utf8"),
  ) as Record<string, unknown>;
}

describe("intake reminders — off until the coach turns them on", () => {
  it(
    "KRISHIV'S CASE: a new link starts with reminders off, so the cron sends nothing",
    () => {
      // Even a client whose old link had reminders on gets a fresh, off link.
      const root = makeRoot({ display_name: "Krishiv", intake_reminder_enabled: true });
      expect(run(root, { action: "generate", client_id: "cl-910" }).ok).toBe(true);
      const c = readClient(root);
      expect(c.intake_reminder_enabled).toBe(false);
      expect(c.intake_reminders_sent_at).toEqual([]);
      const later = new Date(Date.now() + 6 * 86_400_000);
      expect(intakeReminderDecision(c, later)).toEqual({ send: false, reason: "not_enabled" });
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "set_reminders turns them on and off again, and leaves the sent history alone",
    () => {
      const root = makeRoot({
        display_name: "Krishiv",
        intake_reminders_sent_at: ["2026-10-27T03:00:00Z"],
      });
      run(root, { action: "generate", client_id: "cl-910" });
      // generate resets history; put one back to check set_reminders keeps it.
      const c0 = readClient(root);
      c0.intake_reminders_sent_at = ["2026-10-27T03:00:00Z"];
      writeFileSync(path.join(root, "clients", "cl-910", "client.yaml"), yaml.dump(c0));

      expect(run(root, { action: "set_reminders", client_id: "cl-910", enabled: true })).toMatchObject({
        ok: true,
        intake_reminder_enabled: true,
      });
      let c = readClient(root);
      expect(c.intake_reminder_enabled).toBe(true);
      expect(c.intake_reminders_sent_at).toEqual(["2026-10-27T03:00:00Z"]);

      run(root, { action: "set_reminders", client_id: "cl-910", enabled: false });
      c = readClient(root);
      expect(c.intake_reminder_enabled).toBe(false);
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "set_reminders refuses anything that is not a plain true/false",
    () => {
      const root = makeRoot({ display_name: "Krishiv" });
      expect(run(root, { action: "set_reminders", client_id: "cl-910", enabled: "yes" }).ok).toBe(false);
      expect(readClient(root).intake_reminder_enabled).toBeUndefined();
    },
    PY_TEST_TIMEOUT_MS,
  );
});
