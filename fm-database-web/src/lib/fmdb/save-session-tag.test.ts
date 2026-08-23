/**
 * save-session.py owns the `[session_type: X]` tag at the head of
 * presenting_complaints — and must write it exactly once.
 *
 * Every v2 form (quick note, check-in, intake, discovery, message capture)
 * pre-embeds the tag in the text AND passes the structured `session_type`
 * field; the shim derived its own tag from the field and prepended it
 * blindly, so every such save landed on disk as
 *   "[session_type: quick_note] [session_type: quick_note] [source: coach] …"
 * (observed on cl-900, 2026-08-22; 46 of 240 sessions on disk). Readers
 * mostly coped (parseSessionType takes the first tag, the SOAP panel strips
 * all leading tags), but the duplicate was load-bearing in one place: the
 * protocol-checkin panel's `protocol_checkin` sub-type only parsed as a
 * check-in because the shim's canonical tag sat in front of it. So the
 * idempotent shim is paired with a parser alias, and this suite pins both.
 *
 * Drives the real shim against a throwaway FMDB_PLANS_DIR.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PY_TEST_TIMEOUT_MS, TEST_PYTHON } from "./test-python";
import { parseSessionType } from "./session-utils";

const SCRIPT = path.resolve(process.cwd(), "scripts", "save-session.py");
const CLIENT = "cl-900";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "save-session-tag-"));
  const dir = path.join(root, "clients", CLIENT);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "client.yaml"),
    `client_id: ${CLIENT}\ndisplay_name: Ochre Test\nintake_date: "2026-08-01"\n`,
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Run the shim with the payload a form would send; return what landed on disk. */
function save(payload: Record<string, unknown>): { presenting: string; tags: string[] } {
  const r = spawnSync(TEST_PYTHON, [SCRIPT], {
    input: JSON.stringify({ client_id: CLIENT, session_date: "2026-08-22", ...payload }),
    encoding: "utf-8",
    env: { ...process.env, FMDB_PLANS_DIR: root },
    timeout: PY_TEST_TIMEOUT_MS,
  });
  expect(r.status, r.stderr).toBe(0);
  const out = JSON.parse(r.stdout) as { ok: boolean; session_id: string | null; error: string | null };
  expect(out.ok, out.error ?? "").toBe(true);
  const file = path.join(root, "clients", CLIENT, "sessions", `${out.session_id}.yaml`);
  const rec = yaml.load(fs.readFileSync(file, "utf-8")) as { presenting_complaints?: string };
  const presenting = rec.presenting_complaints ?? "";
  const tags = [...presenting.matchAll(/\[session_type:\s*([^\]]+)\]/g)].map((m) => m[1]);
  return { presenting, tags };
}

describe("save-session.py session_type tag", () => {
  it(
    "keeps a caller-supplied tag and does not add a second (the cl-900 quick note)",
    () => {
      const text = "[session_type: quick_note] [source: coach] 🧠 Coach observation";
      const { presenting, tags } = save({
        session_type: "quick_note",
        presenting_complaints: text,
        coach_notes: "Mentioned she skipped the evening magnesium twice this week.",
      });
      expect(presenting).toBe(text);
      expect(tags).toEqual(["quick_note"]);
      expect(parseSessionType(presenting)).toBe("quick_note");
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "prepends the tag when the caller sends none (pre-session brief, legacy check-in form)",
    () => {
      const { presenting, tags } = save({
        session_type: "quick_note",
        presenting_complaints: "[source: pre_session_brief] [origin: coach_observation]\n\nSlept badly all week.",
      });
      expect(presenting).toBe(
        "[session_type: quick_note] [source: pre_session_brief] [origin: coach_observation]\n\nSlept badly all week.",
      );
      expect(tags).toEqual(["quick_note"]);
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "writes just the tag when presenting_complaints is empty",
    () => {
      const { presenting, tags } = save({ session_type: "discovery" });
      expect(presenting).toBe("[session_type: discovery]");
      expect(tags).toEqual(["discovery"]);
      expect(parseSessionType(presenting)).toBe("discovery");
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "keeps a form's more specific sub-type as the only tag — and it still parses as its canonical type",
    () => {
      // protocol-checkin-panel: the adherence chart keys on this literal tag,
      // and the dashboard / client journey need it to count as a check-in.
      const checkin = save({
        session_type: "check_in",
        presenting_complaints: "[session_type: protocol_checkin]\n\n💊 Supplements\n✅ magnesium-glycinate — still taking",
      });
      expect(checkin.tags).toEqual(["protocol_checkin"]);
      expect(checkin.presenting.startsWith("[session_type: protocol_checkin]")).toBe(true);
      expect(parseSessionType(checkin.presenting)).toBe("check_in");

      // v2 discovery form: discovery_consultation is the pre-v0.63 alias.
      const discovery = save({
        session_type: "discovery",
        presenting_complaints: "[session_type: discovery_consultation] Bloating after every meal",
      });
      expect(discovery.tags).toEqual(["discovery_consultation"]);
      expect(parseSessionType(discovery.presenting)).toBe("discovery");
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "yields exactly one tag for every v2 form's payload shape",
    () => {
      const forms: Array<{ session_type: string; presenting_complaints: string; expect: string }> = [
        // analyse/intake/intake-form.tsx
        { session_type: "intake", presenting_complaints: "[session_type: intake] Fatigue since March", expect: "intake" },
        // analyse/checkin/checkin-form.tsx
        { session_type: "check_in", presenting_complaints: "[session_type: check_in] adherence 4/5", expect: "check_in" },
        // client-widgets/message-capture-panel.tsx (tag on its own line)
        { session_type: "quick_note", presenting_complaints: "[session_type: quick_note]\n\nClient says the bloating is better.", expect: "quick_note" },
        // client-widgets/discovery-form.tsx
        { session_type: "discovery", presenting_complaints: "[session_type: discovery]\n🔍 Discovery session\n\nChief complaints:\nlow energy", expect: "discovery" },
      ];
      for (const f of forms) {
        const { presenting, tags } = save({ session_type: f.session_type, presenting_complaints: f.presenting_complaints });
        expect(tags, f.presenting_complaints).toHaveLength(1);
        expect(presenting).toBe(f.presenting_complaints);
        expect(parseSessionType(presenting)).toBe(f.expect);
      }
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "tags the WhatsApp rollup once even though the marker leads (create + append)",
    () => {
      // The webhook leads with [plan: …] [window: …], so the session_type tag
      // is not first in the run — the shim still writes exactly one, and the
      // appended segment must NOT repeat it (the thread loader splits on ---
      // and parses direction per segment).
      const marker = "[plan: cl-900-plan-1] [window: 2026-08-01]";
      const first = save({
        session_type: "quick_note",
        presenting_complaints: `${marker} [source: whatsapp_webhook]\n\nfeeling better this week`,
        append_if_today_match: marker,
        match_anywhere: true,
      });
      expect(first.tags).toEqual(["quick_note"]);
      expect(parseSessionType(first.presenting)).toBe("quick_note");

      const second = save({
        session_type: "quick_note",
        presenting_complaints: `${marker} [source: whatsapp_outbound] [type: text]\n\nglad to hear it`,
        append_if_today_match: marker,
        match_anywhere: true,
      });
      // Same file, both segments — still ONE session_type tag overall.
      expect(second.tags).toEqual(["quick_note"]);
      expect(second.presenting).toContain("\n\n---\n\n");
      expect(second.presenting).toContain("[source: whatsapp_webhook]");
      expect(second.presenting).toContain("[source: whatsapp_outbound]");
      expect(parseSessionType(second.presenting)).toBe("quick_note");
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "strips only the appended segment's own head tag, never text from the body",
    () => {
      const marker = "[plan: cl-900-plan-1] [window: 2026-08-01]";
      save({
        session_type: "quick_note",
        presenting_complaints: `${marker} [source: whatsapp_webhook]\n\nfirst`,
        append_if_today_match: marker,
        match_anywhere: true,
      });
      const { presenting } = save({
        session_type: "quick_note",
        // A client quoting the literal tag mid-message. The pre-fix strip was
        // an unbounded .replace and would have eaten it out of their words.
        presenting_complaints: `${marker} [source: whatsapp_webhook]\n\nwhy does it say [session_type: check_in] on my note?`,
        append_if_today_match: marker,
        match_anywhere: true,
      });
      expect(presenting).toContain("why does it say [session_type: check_in] on my note?");
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "does not treat a tag buried in the body as the session's tag",
    () => {
      // Only a LEADING tag counts — a client quoting the literal text
      // mid-message must not suppress the real one.
      const { presenting, tags } = save({
        session_type: "quick_note",
        presenting_complaints: "[source: whatsapp_webhook]\n\nwhy does my note say [session_type: check_in]?",
      });
      expect(presenting.startsWith("[session_type: quick_note] [source: whatsapp_webhook]")).toBe(true);
      expect(tags[0]).toBe("quick_note");
      expect(parseSessionType(presenting)).toBe("quick_note");
    },
    PY_TEST_TIMEOUT_MS,
  );
});
