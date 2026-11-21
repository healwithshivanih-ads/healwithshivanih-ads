/**
 * The weekly check-in note is screened like every other typed message.
 *
 * The form invites "new symptoms", but the note used to be stored with no
 * check while the ask box and the Coach tab both run ask-safety.ts. Pinned
 * here: the screen runs on the server, it never stops the save, the coach is
 * pushed, the session is marked, and the phone is told what to show.
 */
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PY_TEST_TIMEOUT_MS, TEST_PYTHON } from "@/lib/fmdb/test-python";

const shimCalls: Record<string, unknown>[] = [];
const notifyCalls: { clientId: string; preview?: string }[] = [];
let shimResult: Record<string, unknown> = { ok: true, session_id: "2026-11-21-001-app-checkin" };

vi.mock("@/lib/server-actions/letter-token", () => ({
  resolveAppToken: async () => ({ ok: true, client_id: "cl-910" }),
}));
vi.mock("@/lib/fmdb/rate-limit", () => ({ allowDaily: async () => ({ ok: true }) }));
vi.mock("@/lib/fmdb/shim", () => ({
  runShim: async (_script: string, payload: Record<string, unknown>) => {
    shimCalls.push(payload);
    return shimResult;
  },
}));
vi.mock("@/lib/fmdb/chat-notify", () => ({
  notifyCoachOfClientMessage: async (clientId: string, opts: { preview?: string }) => {
    notifyCalls.push({ clientId, preview: opts.preview });
    return { channel: "push", ok: true };
  },
}));

const { POST } = await import("./route");

const send = async (feel: string) => {
  const req = new Request("http://x/api/app-checkin", {
    method: "POST",
    body: JSON.stringify({ token: "t".repeat(24), week: 3, rating: 2, feel }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the route only reads .json()
  const res = await POST(req as any);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  shimCalls.length = 0;
  notifyCalls.length = 0;
  shimResult = { ok: true, session_id: "2026-11-21-001-app-checkin" };
});

describe("POST /api/app-checkin — the safety screen", () => {
  it("saves an emergency note, marks it, pushes the coach and returns the card", async () => {
    const { status, body } = await send("Good week mostly but my chest feels tight since yesterday");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.note).toEqual({ urgent: "emergency" });
    expect(shimCalls).toHaveLength(1);
    expect(shimCalls[0].safety_flag).toBe("emergency");
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0].clientId).toBe("cl-910");
    expect(notifyCalls[0].preview).toMatch(/^⚠ Check-in: .*chest feels tight/);
  });

  it("catches self-harm words", async () => {
    const { body } = await send("tired of everything, i want to die");
    expect(body.note).toEqual({ urgent: "selfharm" });
    expect(shimCalls[0].safety_flag).toBe("selfharm");
  });

  it("returns the see-a-doctor line for a new symptom", async () => {
    const { body } = await send("new rash on my arms this week");
    expect(body.note).toEqual({ doctor: "If it feels severe or sudden, see a doctor today." });
    expect(shimCalls[0].safety_flag).toBe("see_doctor");
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0].preview).toMatch(/^Check-in: /);
  });

  it("leaves an ordinary note alone", async () => {
    const { body } = await send("Felt lighter, slept well, loved the millet dosa");
    expect(body.note).toBeNull();
    expect(shimCalls[0]).not.toHaveProperty("safety_flag");
    expect(notifyCalls).toHaveLength(0);
  });

  it("still pushes the coach when the save fails", async () => {
    shimResult = { ok: false, error: "disk full" };
    const { status } = await send("saans nahi aa rahi");
    expect(status).toBe(500);
    expect(notifyCalls).toHaveLength(1);
  });
});

describe("save-app-checkin.py — the flag on the session", () => {
  const SCRIPT = path.resolve(__dirname, "../../../../scripts/save-app-checkin.py");
  const run = (payload: Record<string, unknown>) => {
    const root = mkdtempSync(path.join(tmpdir(), "app-checkin-"));
    const dir = path.join(root, "clients", "cl-910");
    mkdirSync(path.join(dir, "sessions"), { recursive: true });
    writeFileSync(path.join(dir, "client.yaml"), "client_id: cl-910\n");
    const r = spawnSync(TEST_PYTHON, [SCRIPT], {
      input: JSON.stringify({ client_id: "cl-910", week: 3, rating: 2, ...payload }),
      encoding: "utf8",
      env: { ...process.env, FMDB_PLANS_DIR: root },
    });
    const out = JSON.parse(r.stdout) as { ok: boolean };
    const file = readdirSync(path.join(dir, "sessions"))[0];
    const session = yaml.load(readFileSync(path.join(dir, "sessions", file), "utf8")) as Record<string, unknown>;
    return { out, session };
  };

  it(
    "puts the screen's finding at the top for the coach",
    () => {
      const { out, session } = run({ feel: "my chest feels tight", safety_flag: "emergency" });
      expect(out.ok).toBe(true);
      const text = String(session.presenting_complaints);
      const body = text.split("\n\n").slice(1).join("\n\n");
      expect(body.startsWith("## ⚠ Safety screen: possible emergency.")).toBe(true);
      expect((session.checkin_response as Record<string, unknown>).safety_flag).toBe("emergency");
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "writes nothing extra when the screen found nothing, or sent an unknown flag",
    () => {
      for (const flag of [undefined, "whatever"]) {
        const { session } = run({ feel: "good week", ...(flag ? { safety_flag: flag } : {}) });
        expect(String(session.presenting_complaints)).not.toContain("Safety screen");
        expect(session.checkin_response as Record<string, unknown>).not.toHaveProperty("safety_flag");
      }
    },
    PY_TEST_TIMEOUT_MS,
  );
});
