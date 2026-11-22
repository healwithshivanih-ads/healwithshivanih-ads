/**
 * Calm Gut inside a programme client's own app (client.yaml#courses):
 * the switch's rules, the course API on a client's app link, and where the
 * client's listening data is saved.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@/lib/fmdb/rate-limit", () => ({ allowDaily: async () => ({ ok: true }) }));
vi.mock("server-only", () => ({}));

let tmp: string;
let audioDir: string;
const OLD = { ...process.env };
const TOKEN_ON = "a".repeat(32);
const TOKEN_OFF = "b".repeat(32);

function ymdDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "client-course-"));
  audioDir = await fs.mkdtemp(path.join(os.tmpdir(), "client-course-audio-"));
  process.env.FMDB_PLANS_DIR = tmp;
  process.env.COURSE_AUDIO_DIR = audioDir;
  process.env.COURSE_AUDIO_SECRET = "audio-secret";
  delete process.env.COURSE_AUDIO_S3_BUCKET;
  delete process.env.FLY_INTAKE_ONLY;
  process.env.COURSE_DEVICE_LIMIT = "1"; // a client must not need a registered phone
  await fs.mkdir(path.join(audioDir, "calm-gut", "d2"), { recursive: true });
  await fs.writeFile(path.join(audioDir, "calm-gut", "d2", "s1-music.m4a"), Buffer.from("0123456789abcdef"));
  await fs.mkdir(path.join(tmp, "guided"), { recursive: true });
  for (const [id, token, courses] of [
    ["cl-on", TOKEN_ON, `courses:\n- slug: calm-gut\n  started_on: '${ymdDaysAgo(2)}'\n`],
    ["cl-off", TOKEN_OFF, ""],
  ] as const) {
    await fs.mkdir(path.join(tmp, "clients", id), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "clients", id, "client.yaml"),
      `client_id: ${id}\napp_token: ${token}\napp_shell: v2\ntimezone: Asia/Kolkata\n${courses}`,
    );
  }
});
afterAll(async () => {
  process.env = OLD;
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.rm(audioDir, { recursive: true, force: true });
});

const lib = await import("./client-courses");
const store = await import("./course-store");
const { POST: course } = await import("@/app/api/app-course/route");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the route only reads headers/json
type AnyReq = any;
async function call(body: Record<string, unknown>) {
  const res = await course(new Request("http://x/api/app-course", { method: "POST", body: JSON.stringify(body) }) as AnyReq);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("client.yaml#courses", () => {
  it("keeps known courses with a real date, once each", () => {
    expect(
      lib.clientCourses({
        courses: [
          { slug: "calm-gut", started_on: "2026-11-22" },
          { slug: "calm-gut", started_on: "2026-12-01" },
          { slug: "no-such-course", started_on: "2026-11-22" },
          { slug: "calm-gut" },
          "junk",
        ],
      }),
    ).toEqual([{ slug: "calm-gut", started_on: "2026-11-22" }]);
    expect(lib.clientCourses({})).toEqual([]);
    expect(lib.clientCourses(null)).toEqual([]);
  });

  it("turning on starts today, pressing it again never restarts week 1, off removes it", () => {
    const on = lib.withClientCourse({}, "calm-gut", true, "2026-11-22");
    expect(on).toEqual([{ slug: "calm-gut", started_on: "2026-11-22" }]);
    expect(lib.withClientCourse({ courses: on }, "calm-gut", true, "2026-12-09")).toEqual(on);
    expect(lib.withClientCourse({ courses: on }, "calm-gut", false, "2026-12-09")).toEqual([]);
  });
});

describe("the course API on a client's own app link", () => {
  it("works for a client with the course on, and refuses one without it", async () => {
    const ok = await call({ token: TOKEN_ON, action: "audio", track: "s1", version: "music" });
    expect(ok.status).toBe(200);
    expect(String(ok.body.url)).toContain("/api/app-course/stream/");
    const off = await call({ token: TOKEN_OFF, action: "audio", track: "s1", version: "music" });
    expect(off.status).toBe(401);
  });

  it("week 2 is still locked two days in", async () => {
    const r = await call({ token: TOKEN_ON, action: "audio", track: "s2", version: "music" });
    expect(r.status).toBe(403);
  });

  it("saves the client's listening under clients/<id>/, never under guided/", async () => {
    const today = ymdDaysAgo(0);
    const r = await call({ token: TOKEN_ON, action: "listen", track: "s1", version: "music", date: today });
    expect(r.status).toBe(200);
    const saved = JSON.parse(await fs.readFile(path.join(tmp, "clients", "cl-on", "course-calm-gut.json"), "utf-8"));
    expect(saved.days[today].listened).toBe(true);
    expect(await fs.readdir(path.join(tmp, "guided"))).toEqual([]);
    const score = await call({ token: TOKEN_ON, action: "score", answers: { bloating: 5, pain: 4, bowel: 3, worry: 6, life: 2 } });
    expect(score.status).toBe(200);
    const h = await call({ token: TOKEN_ON, action: "history" });
    expect((h.body.scores as unknown[]).length).toBe(1);
  });

  it("phones, reminders, push and refunds belong to a buyer's link only", async () => {
    for (const action of ["device-claim", "device-code", "device-verify", "reminders", "push", "refund"]) {
      const r = await call({ token: TOKEN_ON, action });
      expect(r.status, action).toBe(403);
    }
  });

  it("an owner id can never point outside its folder", () => {
    expect(() => store.ownerDir("client:../x")).toThrow();
    expect(() => store.ownerDir("../gd-x")).toThrow();
    expect(store.ownerDir("client:cl-on")).toBe(path.join(tmp, "clients", "cl-on"));
  });
});
