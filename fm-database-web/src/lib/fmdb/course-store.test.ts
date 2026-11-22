/**
 * Calm Gut end to end on a temp plans folder: enrolment (route) → the app
 * payload → the listener's writes (route) → what a new phone reads back.
 * Plus the boundary that matters most: resolveAppToken keeps refusing a
 * course token, so no package write route can ever take a gd- id.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@/lib/fmdb/rate-limit", () => ({ allowDaily: async () => ({ ok: true }) }));
vi.mock("server-only", () => ({}));

let tmp: string;
let audioDir: string;
const OLD = { ...process.env };

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "course-test-"));
  audioDir = await fs.mkdtemp(path.join(os.tmpdir(), "course-audio-"));
  process.env.FMDB_PLANS_DIR = tmp;
  process.env.GUIDED_ENROLL_SECRET = "enroll-secret";
  process.env.COURSE_AUDIO_DIR = audioDir;
  process.env.COURSE_AUDIO_SECRET = "audio-secret";
  delete process.env.COURSE_AUDIO_S3_BUCKET;
  delete process.env.GUIDED_APP_BASE_URL;
  await fs.mkdir(path.join(tmp, "clients"), { recursive: true });
  await fs.mkdir(path.join(tmp, "published"), { recursive: true });
  await fs.mkdir(path.join(audioDir, "calm-gut", "d1"), { recursive: true });
  await fs.writeFile(path.join(audioDir, "calm-gut", "d1", "s1-music.m4a"), Buffer.from("0123456789abcdef"));
});
afterAll(async () => {
  process.env = OLD;
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.rm(audioDir, { recursive: true, force: true });
});

const store = await import("./course-store");
const tier = await import("./guided-tier");
const { POST: enroll } = await import("@/app/api/guided-enroll/route");
const { POST: deactivate } = await import("@/app/api/guided-enroll/deactivate/route");
const { POST: course } = await import("@/app/api/app-course/route");
const { GET: stream } = await import("@/app/api/app-course/stream/[ticket]/route");
const { loadClientAppData } = await import("./client-app");
const { resolveAppToken } = await import("@/lib/server-actions/letter-token");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- routes only read headers/json/nextUrl
type AnyReq = any;

function enrollReq(body: Record<string, unknown>, secret = "enroll-secret") {
  const r = new Request("https://app.example.test/api/guided-enroll", {
    method: "POST",
    headers: { "x-guided-secret": secret, "x-forwarded-proto": "https", host: "app.example.test" },
    body: JSON.stringify(body),
  }) as AnyReq;
  r.nextUrl = new URL(r.url);
  return r;
}
async function call(body: Record<string, unknown>) {
  const res = await course(new Request("http://x/api/app-course", { method: "POST", body: JSON.stringify(body) }) as AnyReq);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function todayIst(): string {
  return tier.ymdInTz(new Date(), "Asia/Kolkata");
}

const CONTRACT = {
  product: "course",
  course: "calm-gut",
  name: "Asha Rao",
  email: "Asha@Example.com",
  phone: "+919800000000",
  payment_id: "pay_TEST123",
  amount_paise: 199900,
};

let token = "";
let subId = "";

describe("enrolment: POST /api/guided-enroll with product=course", () => {
  it("refuses without the shared secret", async () => {
    const res = await enroll(enrollReq({ ...CONTRACT, started_on: todayIst() }, "wrong"));
    expect(res.status).toBe(401);
  });

  it("refuses an unknown course", async () => {
    const res = await enroll(enrollReq({ ...CONTRACT, course: "calm-gut-course", started_on: todayIst() }));
    expect(res.status).toBe(400);
  });

  it("creates a course subscriber with no protocol, starting on the payment day", async () => {
    const res = await enroll(enrollReq({ ...CONTRACT, started_on: todayIst() }));
    const j = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.created).toBe(true);
    expect(j.product).toBe("course");
    expect(j.start_date).toBe(todayIst());
    expect(j.protocol_slug).toBe("");
    expect(j.courses).toEqual(["calm-gut"]);
    expect(typeof j.token).toBe("string");
    expect(j.token).toBe(j.app_token);
    // Absolute, so the welcome email link works.
    expect(j.app_url).toBe(`https://app.example.test/app/${j.token}`);
    token = j.token as string;
    subId = j.subscriber_id as string;
    const sub = await tier.resolveGuidedSubscriberByToken(token);
    expect(sub?.product).toBe("course");
    expect(sub?.amount_paisa).toBe(199900);
    expect(sub?.email).toBe("asha@example.com");
  });

  it("is idempotent on payment_id: a retry returns the same token", async () => {
    const res = await enroll(enrollReq({ ...CONTRACT, started_on: todayIst() }));
    const j = (await res.json()) as Record<string, unknown>;
    expect(j.created).toBe(false);
    expect(j.token).toBe(token);
    const dirs = await fs.readdir(path.join(tmp, "guided"));
    expect(dirs).toHaveLength(1);
  });

  it("ignores a started_on far from today (falls back to today)", () => {
    const now = new Date("2026-12-08T06:00:00Z");
    expect(tier.courseStartYmd("2026-12-08", now, "Asia/Kolkata")).toBe("2026-12-08");
    expect(tier.courseStartYmd("2026-12-06", now, "Asia/Kolkata")).toBe("2026-12-06");
    expect(tier.courseStartYmd("2025-01-01", now, "Asia/Kolkata")).toBe("2026-12-08");
    expect(tier.courseStartYmd("garbage", now, "Asia/Kolkata")).toBe("2026-12-08");
  });

  it("a free place (gift): no Razorpay id, amount 0, marked gift, starts today, idempotent on the key", async () => {
    const body = {
      product: "course",
      course: "calm-gut",
      name: "Beta Friend",
      email: "beta@example.com",
      phone: "",
      payment_id: "gift-6f1c2a9e-1111-4c3b-9d2e-0a1b2c3d4e5f",
      amount_paise: 0,
      reason: "gift",
    };
    const first = (await (await enroll(enrollReq(body))).json()) as Record<string, unknown>;
    expect(first.ok).toBe(true);
    expect(first.created).toBe(true);
    expect(first.reason).toBe("gift");
    expect(first.start_date).toBe(todayIst());
    const again = (await (await enroll(enrollReq(body))).json()) as Record<string, unknown>;
    expect(again.created).toBe(false);
    expect(again.token).toBe(first.token);
    const sub = await tier.resolveGuidedSubscriberByToken(first.token as string);
    expect(sub?.reason).toBe("gift");
    expect(sub?.amount_paisa).toBe(0);
    expect(sub?.payment_id).toBe(body.payment_id);
    // gift_key works as the field name too, and amount is forced to 0
    const viaKey = (await (
      await enroll(enrollReq({ ...body, payment_id: undefined, gift_key: "gift-aaaaaaaa-2222", amount_paise: 99900 }))
    ).json()) as Record<string, unknown>;
    expect(viaKey.ok).toBe(true);
    expect((await tier.resolveGuidedSubscriberByToken(viaKey.token as string))?.amount_paisa).toBe(0);
    // the app treats a gift buyer exactly like a paying one
    const data = await loadClientAppData(first.token as string);
    expect(data?.course?.only).toBe(true);
  });

  it("refuses a gift without a gift- key, a gift for the guided tier, and a paid call using a gift- key", async () => {
    const base = { product: "course", course: "calm-gut", email: "g@example.com", amount_paise: 0 };
    expect((await enroll(enrollReq({ ...base, reason: "gift", payment_id: "pay_X1" }))).status).toBe(400);
    expect((await enroll(enrollReq({ ...base, reason: "gift" }))).status).toBe(400);
    expect(
      (await enroll(enrollReq({ payment_id: "gift-bbbbbbbb-3333", reason: "gift", protocol_slug: "gut-reset", email: "g@example.com" }))).status,
    ).toBe(400);
    expect((await enroll(enrollReq({ ...base, payment_id: "gift-cccccccc-4444" }))).status).toBe(400);
  });

  it("the guided product still requires a known protocol", async () => {
    const res = await enroll(enrollReq({ payment_id: "pay_G1", email: "x@y.z", protocol_slug: "nope" }));
    expect(res.status).toBe(400);
  });
});

describe("a course buyer who later becomes a client keeps the course", () => {
  it("is not adopted by the guided→1:1 upgrade lookup", async () => {
    expect(await tier.findActiveGuidedByEmail("asha@example.com")).toBeNull();
  });
});

describe("the boundary: package write routes still refuse a course token", () => {
  it("resolveAppToken does not resolve it", async () => {
    const r = await resolveAppToken(token);
    expect(r.ok).toBe(false);
  });
});

describe("the app payload for a course-only buyer", () => {
  it("is the course: tier guided, course.only, week 1 open, the rest locked", async () => {
    const data = await loadClientAppData(token, { deviceTz: "Asia/Kolkata" });
    expect(data).not.toBeNull();
    expect(data!.tier).toBe("guided");
    expect(data!.course?.only).toBe(true);
    expect(data!.course?.day).toBe(0);
    expect(data!.course?.week).toBe(1);
    expect(data!.course?.currentSessionId).toBe("s1");
    const open = data!.course!.tracks.filter((t) => t.unlocked).map((t) => t.id);
    expect(open).toEqual(["s1", "daily", "daily-short", "night", "flare", "r1"]);
    expect(data!.course!.tracks.find((t) => t.id === "s2")!.unlocksLabel).toMatch(/^Opens /);
    expect(data!.course!.scoreDue).toBe(0);
    // No coach access, no plan surfaces.
    expect(data!.coach.whatsappNumber).toBe("");
    expect(data!.supplements).toEqual([]);
    expect(data!.guidedWeekly).toBeNull();
  });

  it("a refunded buyer's link stops working", async () => {
    const f = path.join(tmp, "guided", subId, "subscriber.yaml");
    const raw = await fs.readFile(f, "utf8");
    await fs.writeFile(f, raw.replace("status: active", "status: refunded"));
    expect(await loadClientAppData(token)).toBeNull();
    expect((await call({ token, action: "history" })).status).toBe(401);
    await fs.writeFile(f, raw);
  });
});

describe("POST /api/app-course", () => {
  beforeEach(() => {
    process.env.COURSE_AUDIO_DIR = audioDir;
  });

  it("refuses a bad token and unknown actions", async () => {
    expect((await call({ token: "x".repeat(32), action: "history" })).status).toBe(401);
    expect((await call({ token, action: "delete-everything" })).status).toBe(400);
  });

  it("gives a short-lived link for an open track, and none for a locked one", async () => {
    const ok = await call({ token, action: "audio", track: "s1", version: "music" });
    expect(ok.status).toBe(200);
    expect(String(ok.body.url)).toMatch(/^\/api\/app-course\/stream\//);
    const locked = await call({ token, action: "audio", track: "s2", version: "music" });
    expect(locked.status).toBe(403);
    expect((await call({ token, action: "audio", track: "nope" })).status).toBe(400);
  });

  it("an intro streams its voice file even if music is asked for, and never counts as a listen", async () => {
    const r1 = await call({ token, action: "audio", track: "r1", version: "music" });
    expect(r1.status).toBe(200);
    const ticket = String(r1.body.url).split("/").pop()!;
    const key = JSON.parse(Buffer.from(ticket.split(".")[0], "base64url").toString()).k;
    expect(key).toBe("calm-gut/d1/r1-voice.m4a");
    expect((await call({ token, action: "audio", track: "r2" })).status).toBe(403);
    const listen = await call({ token, action: "listen", track: "r1", version: "voice", date: todayIst() });
    expect(listen.body.counted).toBe(false);
    const rec = await store.readCourseRecord(subId, "calm-gut");
    expect(rec.listens.some((l) => l.track === "r1")).toBe(false);
  });

  it("the stream serves the file with Range, and refuses a forged ticket", async () => {
    const { body } = await call({ token, action: "audio", track: "s1", version: "music" });
    const ticket = String(body.url).split("/").pop()!;
    const full = await stream(new Request("http://x") as AnyReq, { params: Promise.resolve({ ticket }) });
    expect(full.status).toBe(200);
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(await full.text()).toBe("0123456789abcdef");
    const part = await stream(new Request("http://x", { headers: { range: "bytes=0-1" } }) as AnyReq, {
      params: Promise.resolve({ ticket }),
    });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 0-1/16");
    expect(await part.text()).toBe("01");
    const bad = await stream(new Request("http://x") as AnyReq, { params: Promise.resolve({ ticket: ticket.slice(0, -3) + "AAA" }) });
    expect(bad.status).toBe(403);
  });

  it("saves the daily log (cleaned) and reads it back", async () => {
    const today = todayIst();
    const r = await call({
      token,
      action: "log",
      date: today,
      bloating: 14,
      meals: "good",
      bowel: "explosive",
      stress: "3",
      sleep: "okay",
      note: "  dal at lunch\u0007  ",
      clientId: "cl-001",
    });
    expect(r.status).toBe(200);
    expect(r.body.day).toMatchObject({ bloating: 10, meals: "good", stress: 3, sleep: "okay", note: "dal at lunch" });
    expect((r.body.day as Record<string, unknown>).bowel).toBeUndefined();
    const file = JSON.parse(await fs.readFile(path.join(tmp, "guided", subId, "course-calm-gut.json"), "utf8"));
    expect(file.days[today].meals).toBe("good");
    // Nothing went under clients/.
    expect(await fs.readdir(path.join(tmp, "clients"))).toEqual([]);
  });

  it("a date far from today is filed under today", async () => {
    const r = await call({ token, action: "log", date: "2020-01-01", stress: 2 });
    expect(r.body.date).toBe(todayIst());
  });

  it("a listen ticks 'I listened today' and starts the streak", async () => {
    const r = await call({ token, action: "listen", track: "daily", version: "voice", date: todayIst() });
    expect(r.status).toBe(200);
    expect(r.body.streak).toBe(1);
    const data = await loadClientAppData(token);
    expect(data!.course!.history.days[todayIst()].listened).toBe(true);
    expect(data!.course!.tracks.find((t) => t.id === "daily")!.listened).toBe(true);
  });

  it("the symptom check needs all five answers, scores 0–50, one per checkpoint", async () => {
    expect((await call({ token, action: "score", answers: { bloating: 5 } })).status).toBe(400);
    const answers = { bloating: 7, pain: 5, bowel: 6, worry: 8, life: 4 };
    const r = await call({ token, action: "score", answers });
    expect(r.status).toBe(200);
    expect(r.body.week).toBe(0);
    expect(r.body.total).toBe(30);
    await call({ token, action: "score", answers: { ...answers, life: 0 } });
    const rec = await store.readCourseRecord(subId, "calm-gut");
    expect(rec.scores).toHaveLength(1);
    expect(rec.scores[0].total).toBe(26);
    const data = await loadClientAppData(token);
    expect(data!.course!.scoreDue).toBeNull();
  });

  it("saves the reminder choice", async () => {
    const r = await call({ token, action: "reminders", daily_time: "7:05", unlock: false });
    expect(r.body.reminders).toEqual({ daily_time: "07:05", unlock: false });
    const bad = await call({ token, action: "reminders", daily_time: "25:00" });
    expect(bad.body.reminders).toEqual({ daily_time: null, unlock: true });
  });

  it("history is what a new phone gets", async () => {
    const r = await call({ token, action: "history" });
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.days as object)).toContain(todayIst());
    expect((r.body.scores as unknown[]).length).toBe(1);
  });

  it("says audio isn't ready when no storage is configured", async () => {
    delete process.env.COURSE_AUDIO_DIR;
    const r = await call({ token, action: "audio", track: "s1", version: "music" });
    expect(r.status).toBe(503);
  });
});

describe("store helpers", () => {
  it("streak counts back from today, with yesterday as a grace day", () => {
    const days = { "2026-12-08": { listened: true }, "2026-12-09": { listened: true }, "2026-12-11": { listened: true } };
    expect(store.listeningStreak(days, "2026-12-11")).toBe(1);
    expect(store.listeningStreak(days, "2026-12-10")).toBe(2);
    expect(store.listeningStreak(days, "2026-12-13")).toBe(0);
  });
  it("acceptLogDate allows tomorrow (time zones) and the past week only", () => {
    expect(store.acceptLogDate("2026-12-09", "2026-12-08")).toBe("2026-12-09");
    expect(store.acceptLogDate("2026-12-02", "2026-12-08")).toBe("2026-12-02");
    expect(store.acceptLogDate("2026-12-01", "2026-12-08")).toBe("2026-12-08");
    expect(store.acceptLogDate("2026-12-10", "2026-12-08")).toBe("2026-12-08");
  });
});

describe("refund: POST /api/guided-enroll/deactivate", () => {
  function deReq(body: Record<string, unknown>, secret = "enroll-secret") {
    return new Request("https://app.example.test/api/guided-enroll/deactivate", {
      method: "POST",
      headers: { "x-guided-secret": secret },
      body: JSON.stringify(body),
    }) as AnyReq;
  }
  async function newBuyer(payment_id: string, email: string) {
    const r = await enroll(enrollReq({ ...CONTRACT, payment_id, email, started_on: todayIst() }));
    return ((await r.json()) as Record<string, unknown>).token as string;
  }

  it("refuses without the secret, and without a key", async () => {
    expect((await deactivate(deReq({ payment_id: "pay_X" }, "wrong"))).status).toBe(401);
    expect((await deactivate(deReq({}))).status).toBe(400);
    expect((await deactivate(deReq({ payment_id: "pay_nobody" }))).status).toBe(404);
  });

  it("switches a buyer off by payment id: the app closes, the course API refuses, a repeat is harmless", async () => {
    const t = await newBuyer("pay_REFUND1", "refund1@example.com");
    expect(await loadClientAppData(t)).not.toBeNull();
    const r = await deactivate(deReq({ payment_id: "pay_REFUND1", reason: "7-day refund" }));
    const j = (await r.json()) as Record<string, unknown>;
    expect(r.status).toBe(200);
    expect(j.turned_off).toBe(1);
    expect(await loadClientAppData(t)).toBeNull();
    expect((await tier.resolveGuidedSubscriberByToken(t))?.status).toBe("refunded");
    expect((await call({ token: t, action: "history" })).status).toBe(401);
    const again = (await (await deactivate(deReq({ payment_id: "pay_REFUND1" }))).json()) as Record<string, unknown>;
    expect(again.turned_off).toBe(0);
  });

  it("works with a gift key, and by email (active course records only)", async () => {
    const g = await enroll(enrollReq({ ...CONTRACT, payment_id: "gift-refund-0000-1111", email: "gift.r@example.com", amount_paise: 0, reason: "gift" }));
    const gt = ((await g.json()) as Record<string, unknown>).token as string;
    expect((await deactivate(deReq({ gift_key: "gift-refund-0000-1111" }))).status).toBe(200);
    expect(await loadClientAppData(gt)).toBeNull();
    const t = await newBuyer("pay_REFUND2", "Refund2@Example.com");
    const r = (await (await deactivate(deReq({ email: "refund2@example.com" }))).json()) as Record<string, unknown>;
    expect(r.turned_off).toBe(1);
    expect(await loadClientAppData(t)).toBeNull();
  });
});
