/**
 * Two phones per course link (course-devices.ts), end to end through
 * /api/app-course on a temp plans folder, with the code email captured.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: async (m: { to: string; subject: string; text: string }) => void sent.push(m) }) },
}));
vi.mock("@/lib/fmdb/rate-limit", () => ({ allowDaily: async () => ({ ok: true }) }));
vi.mock("server-only", () => ({}));

let tmp: string;
const OLD = { ...process.env };
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "course-dev-"));
  process.env.FMDB_PLANS_DIR = tmp;
  process.env.GUIDED_ENROLL_SECRET = "s";
  process.env.GMAIL_USER = "ops@example.test";
  process.env.GMAIL_APP_PASSWORD = "x";
  process.env.COURSE_DEVICE_LIMIT = "1";
  delete process.env.FLY_INTAKE_ONLY;
  delete process.env.COURSE_MAX_DEVICES;
});
afterAll(async () => {
  process.env = OLD;
  await fs.rm(tmp, { recursive: true, force: true });
});

const tier = await import("./guided-tier");
const dev = await import("./course-devices");
const { POST } = await import("@/app/api/app-course/route");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the route reads headers + json only
type AnyReq = any;
async function call(token: string, action: string, cookie: string | null, extra: Record<string, unknown> = {}) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = `${dev.COURSE_DEVICE_COOKIE}=${cookie}`;
  const res = await POST(new Request("http://x/api/app-course", { method: "POST", headers, body: JSON.stringify({ token, action, ...extra }) }) as AnyReq);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = new RegExp(`${dev.COURSE_DEVICE_COOKIE}=([a-f0-9]{32})`).exec(setCookie);
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cookie: m?.[1] ?? null, setCookie };
}

let token = "";
let subId = "";
beforeEach(async () => {
  sent.length = 0;
  const { subscriber } = await tier.createGuidedSubscriber({
    product: "course",
    course: "calm-gut",
    display_name: "Priya Rao",
    email: "priya.rao@example.com",
    phone: "",
    protocol_slug: "",
    payment_id: `pay_${Math.random().toString(36).slice(2)}`,
    amount_paisa: 249900,
    source: "web",
  });
  token = subscriber.app_token;
  subId = subscriber.subscriber_id;
});

describe("two phones per course link", () => {
  it("the first two phones register; a third is refused everything", async () => {
    const a = await call(token, "device-claim", null);
    const b = await call(token, "device-claim", null);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.cookie).not.toBe(b.cookie);
    expect(a.setCookie.toLowerCase()).toContain("httponly");
    expect((await call(token, "history", a.cookie!)).status).toBe(200);
    expect((await call(token, "history", b.cookie!)).status).toBe(200);
    // A forwarded link on a friend's phone:
    expect((await call(token, "device-claim", null)).status).toBe(409);
    expect((await call(token, "history", null)).status).toBe(403);
    expect((await call(token, "audio", "f".repeat(32), { track: "s1" })).status).toBe(403);
    // Only hashes are stored.
    const raw = await fs.readFile(path.join(tmp, "guided", subId, "_course_devices.json"), "utf8");
    expect(raw).not.toContain(a.cookie!);
  });

  it("a registered phone re-claiming keeps its slot (no third slot used)", async () => {
    const a = await call(token, "device-claim", null);
    expect((await call(token, "device-claim", a.cookie)).cookie).toBe(a.cookie);
    expect((await dev.courseDeviceStatus(subId, null)).toString()).toBe("claimable");
  });

  it("the code goes only to the buyer's email, and moves the course to the new phone", async () => {
    const a = await call(token, "device-claim", null);
    await new Promise((r) => setTimeout(r, 5));
    const b = await call(token, "device-claim", null);
    await dev.touchCourseDevice(subId, b.cookie!, new Date(Date.now() + 2 * 3_600_000)); // b used more recently
    const r = await call(token, "device-code", null, { email: "friend@evil.test" });
    expect(r.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("priya.rao@example.com");
    const code = /(\d{6})/.exec(sent[0].subject)![1];
    expect(sent[0].text).toContain(code);
    // Wrong tries count down.
    const wrong = await call(token, "device-verify", null, { code: code === "000000" ? "111111" : "000000" });
    expect(wrong.body).toMatchObject({ ok: false, error: "wrong", triesLeft: 4 });
    const ok = await call(token, "device-verify", null, { code });
    expect(ok.status).toBe(200);
    expect(ok.cookie).toMatch(/^[a-f0-9]{32}$/);
    // New phone in, least-recently-used (a) out, b kept.
    expect((await call(token, "history", ok.cookie)).status).toBe(200);
    expect((await call(token, "history", b.cookie)).status).toBe(200);
    expect((await call(token, "history", a.cookie)).status).toBe(403);
    // The code is spent.
    expect((await call(token, "device-verify", null, { code })).body.error).toBe("none");
  });

  it("codes expire after 15 minutes and die after 5 wrong tries", async () => {
    const t0 = new Date("2026-12-08T10:00:00Z");
    const issued = await dev.issueCourseCode(subId, t0);
    expect(issued.ok).toBe(true);
    const code = (issued as { code: string }).code;
    expect((await dev.verifyCourseCode(subId, code, null, new Date(t0.getTime() + 16 * 60_000))).ok).toBe(false);
    const again = (await dev.issueCourseCode(subId, new Date(t0.getTime() + 20 * 60_000))) as { code: string };
    const bad = again.code === "123456" ? "654321" : "123456";
    for (let i = 0; i < 4; i++) await dev.verifyCourseCode(subId, bad, null, new Date(t0.getTime() + 21 * 60_000));
    expect(await dev.verifyCourseCode(subId, bad, null, new Date(t0.getTime() + 21 * 60_000))).toMatchObject({ ok: false, reason: "used_up" });
    expect(await dev.verifyCourseCode(subId, again.code, null, new Date(t0.getTime() + 21 * 60_000))).toMatchObject({ ok: false, reason: "none" });
  });

  it("sends are limited: one a minute, five a day", async () => {
    const t0 = new Date("2026-12-08T10:00:00Z");
    expect((await dev.issueCourseCode(subId, t0)).ok).toBe(true);
    expect(await dev.issueCourseCode(subId, new Date(t0.getTime() + 30_000))).toEqual({ ok: false, reason: "wait" });
    for (let i = 1; i <= 4; i++) expect((await dev.issueCourseCode(subId, new Date(t0.getTime() + i * 61_000))).ok).toBe(true);
    expect(await dev.issueCourseCode(subId, new Date(t0.getTime() + 6 * 61_000))).toEqual({ ok: false, reason: "limit" });
    expect((await dev.issueCourseCode(subId, new Date(t0.getTime() + 86_400_000 + 1))).ok).toBe(true);
  });

  it("is off on the Mac (coach previews use no slot) unless switched on for testing", () => {
    expect(dev.courseDeviceLimitActive({})).toBe(false);
    expect(dev.courseDeviceLimitActive({ FLY_INTAKE_ONLY: "1" })).toBe(true);
    expect(dev.courseDeviceLimitActive({ COURSE_DEVICE_LIMIT: "1" })).toBe(true);
    expect(dev.maxCourseDevices({})).toBe(2);
    expect(dev.maxCourseDevices({ COURSE_MAX_DEVICES: "3" })).toBe(3);
    expect(dev.maxCourseDevices({ COURSE_MAX_DEVICES: "99" })).toBe(2);
  });

  it("masks the email it shows", () => {
    expect(dev.maskEmail("priya.rao@example.com")).toBe("p•••o@example.com");
    expect(dev.maskEmail("ab@x.in")).toBe("a•••@x.in");
    expect(dev.maskEmail("nope")).toBe("");
  });
});
