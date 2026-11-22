/**
 * POST /api/app-course — the course listener's write-backs and audio links.
 *
 * Auth: body.token must resolve to an ACTIVE guided subscriber who owns the
 * course, or to a programme client whose record has the course switched on
 * (client-courses.ts), via course-store.ts::resolveCourseToken. Deliberately NOT
 * resolveAppToken: that one hands out client ids for clients/<id>/ writes,
 * and must keep refusing guided tokens. Everything here writes only the
 * course files: guided/<subscriberId>/ for a buyer, and for a client only
 * clients/<id>/course-<slug>.json. A client never reaches the device, push,
 * reminder or refund actions (BUYER_ONLY).
 *
 * Actions (body.action):
 *   audio      { track, version }            → { url, expiresAt } short-lived link
 *   listen     { track, version, date }      → a track played ≥ 80%: listen + "I listened today"
 *   log        { date, bloating, meals, bowel, stress, sleep, listened?, note? } → merge that day
 *   score      { answers: {bloating,pain,bowel,worry,life} } → the 5-question check (0–50)
 *   reminders  { daily_time: "HH:MM"|null, unlock: boolean }
 *   push       { op: "subscribe", subscription } | { op: "unsubscribe", endpoint? } | { op: "status" }
 *   history    {}                            → the saved days + scores (a new phone's first open)
 *   refund     {}                            → paid buyer, first 7 days: ask ochre-funnel to refund;
 *                                               { status: "refunded" } (access ended) or "pending" (done by hand)
 *
 * Two phones per course (course-devices.ts): every action above needs this
 * device's cookie to be one of the listener's registered phones. These three
 * are how a phone gets registered, so they are the only ones without it:
 *   device-claim   {}        → registers this phone while a slot is free (sets the cookie)
 *   device-code    {}        → emails a 6-digit code to the BUYER's address on record
 *   device-verify  { code }  → right code: this phone in, least-recently-used phone out
 */
import { NextRequest, NextResponse } from "next/server";
import { allowDaily } from "@/lib/fmdb/rate-limit";
import { courseAudioKey, getCourseTrack, isTrackUnlocked, courseDay, scoreCheckpointFor } from "@/lib/fmdb/courses";
import {
  acceptLogDate,
  resolveCourseToken,
  sanitizeDayLog,
  sanitizeScore,
  sanitizeTime,
  saveDayLog,
  saveListen,
  saveReminderPrefs,
  saveScore,
  readCourseRecord,
  listeningStreak,
} from "@/lib/fmdb/course-store";
import { audioLinkFor } from "@/lib/fmdb/course-audio";
import {
  saveCourseSubscription,
  removeCourseSubscription,
  coursePushStatus,
  sendCoursePush,
} from "@/lib/fmdb/course-push";
import type { WebPushSubscription } from "@/lib/fmdb/push-server";
import { ymdInTz, markGuidedRefunded, markRefundRequested } from "@/lib/fmdb/guided-tier";
import { refundOffer, refundOutcome, requestFunnelRefund, tellCoachRefundPending } from "@/lib/fmdb/course-refund";
import {
  COURSE_DEVICE_COOKIE,
  claimCourseDevice,
  courseDeviceLimitActive,
  courseDeviceStatus,
  deviceCookieOptions,
  deviceIdFromCookieHeader,
  issueCourseCode,
  sendCourseCodeEmail,
  verifyCourseCode,
} from "@/lib/fmdb/course-devices";

export const dynamic = "force-dynamic";

/** Actions that exist only on a course buyer's own link. */
const BUYER_ONLY = new Set(["device-claim", "device-code", "device-verify", "reminders", "push", "refund"]);

const LIMITS: Record<string, number> = {
  audio: 300,
  listen: 60,
  log: 120,
  score: 6,
  reminders: 30,
  push: 30,
  history: 60,
  refund: 5,
  "device-claim": 20,
  "device-code": 10,
  "device-verify": 20,
};

function isHttps(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("invalid JSON");
  }
  const token = typeof body.token === "string" ? body.token : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!token || token.length < 16) return bad("invalid token", 401);
  if (!(action in LIMITS)) return bad("unknown action");
  if (!(await allowDaily(`app-course-${action}`, token, LIMITS[action])).ok) {
    return bad("too many requests today", 429);
  }
  const slug = typeof body.course === "string" && body.course ? body.course : "calm-gut";
  const listener = await resolveCourseToken(token, slug);
  if (!listener) return bad("invalid or expired link", 401);
  const { course, ownerId } = listener;
  const today = ymdInTz(new Date(), listener.tz);
  const day = courseDay(listener.startYmd, today);
  const deviceId = deviceIdFromCookieHeader(req.headers.get("cookie"));

  // A programme client has the course inside their own app: no phone limit,
  // no refund, and no course reminders (their app has its own). Those
  // actions belong to a buyer's course link only.
  if (listener.kind === "client") {
    if (BUYER_ONLY.has(action)) return bad("not available in this app", 403);
  }
  const sub = listener.kind === "buyer" ? listener.sub : null;

  // ── registering a phone ───────────────────────────────────────────────────
  if (sub && (action === "device-claim" || action === "device-verify")) {
    try {
      const setCookie = (res: NextResponse, raw: string) => {
        res.cookies.set(COURSE_DEVICE_COOKIE, raw, deviceCookieOptions(isHttps(req)));
        return res;
      };
      if (action === "device-claim") {
        const raw = await claimCourseDevice(sub.subscriber_id, deviceId);
        if (!raw) return bad("this course is already open on its phones", 409);
        return setCookie(NextResponse.json({ ok: true }), raw);
      }
      const r = await verifyCourseCode(sub.subscriber_id, typeof body.code === "string" ? body.code : "", deviceId);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.reason, triesLeft: r.triesLeft }, { status: 400 });
      return setCookie(NextResponse.json({ ok: true }), r.rawId);
    } catch (err) {
      console.error("[app-course] device failed:", err);
      return bad("save failed", 500);
    }
  }
  if (sub && action === "device-code") {
    // Always the address the course was bought with; nothing typed on the
    // phone can change where the code goes.
    if (!sub.email) return bad("no email on record", 409);
    const issued = await issueCourseCode(sub.subscriber_id);
    if (!issued.ok) return bad(issued.reason, 429);
    try {
      const sent = await sendCourseCodeEmail(sub.email, (sub.display_name || "").split(/\s+/)[0] ?? "", course.title, issued.code);
      if (!sent) return bad("email not configured", 503);
    } catch (err) {
      console.error("[app-course] code email failed:", err);
      return bad("email failed", 502);
    }
    return NextResponse.json({ ok: true });
  }

  // Everything else: only from one of the listener's registered phones.
  if (sub && courseDeviceLimitActive() && (await courseDeviceStatus(sub.subscriber_id, deviceId)) !== "known") {
    return bad("this phone isn't registered for the course", 403);
  }

  try {
    if (action === "audio" || action === "listen") {
      const track = getCourseTrack(course, typeof body.track === "string" ? body.track : "");
      if (!track) return bad("unknown track");
      const version = body.version === "voice" ? "voice" : "music";
      // Locked sessions get no link, whatever the phone thinks the date is.
      if (!isTrackUnlocked(track, day)) return bad("not open yet", 403);
      if (action === "audio") {
        const link = audioLinkFor(courseAudioKey(course, track, version), ownerId);
        if (!link) return bad("audio not available yet", 503);
        return NextResponse.json({ ok: true, url: link.url, expiresAt: link.expiresAt });
      }
      const date = acceptLogDate(body.date, today);
      // An intro is the reading read aloud: it never counts as listening
      // (the tick, the streak and "sessions heard" belong to the session).
      if (track.kind === "intro") return NextResponse.json({ ok: true, date, counted: false });
      const r = await saveListen(ownerId, course.slug, date, track.id, version);
      return NextResponse.json({ ok: true, date, streak: listeningStreak(r.days, today) });
    }

    if (action === "log") {
      const date = acceptLogDate(body.date, today);
      const log = sanitizeDayLog(body);
      if (Object.keys(log).length === 0) return bad("nothing to save");
      const r = await saveDayLog(ownerId, course.slug, date, log);
      return NextResponse.json({ ok: true, date, day: r.days[date] });
    }

    if (action === "score") {
      const answers = sanitizeScore(body.answers);
      if (!answers) return bad("all five answers (0–10) required");
      const week = scoreCheckpointFor(course, Math.max(0, day));
      const r = await saveScore(ownerId, course.slug, today, week, answers);
      const saved = r.scores.find((s) => s.week === week);
      return NextResponse.json({ ok: true, week, total: saved?.total ?? 0, scores: r.scores });
    }

    if (sub && action === "reminders") {
      const prefs = { daily_time: sanitizeTime(body.daily_time), unlock: body.unlock !== false };
      const r = await saveReminderPrefs(sub.subscriber_id, course.slug, prefs);
      return NextResponse.json({ ok: true, reminders: r.reminders });
    }

    if (sub && action === "push") {
      const op = typeof body.op === "string" ? body.op : "";
      if (op === "subscribe") {
        const s = body.subscription as WebPushSubscription | undefined;
        if (!s?.endpoint || !s.keys?.p256dh || !s.keys?.auth) return bad("invalid subscription");
        await saveCourseSubscription(sub.subscriber_id, {
          endpoint: String(s.endpoint).slice(0, 1000),
          keys: { p256dh: String(s.keys.p256dh).slice(0, 200), auth: String(s.keys.auth).slice(0, 100) },
        });
        // The app re-confirms the subscription on every open (`quiet`): no test
        // push then. Only a press of "turn on" proves it on this device.
        if (body.quiet === true) return NextResponse.json({ ok: true, ...(await coursePushStatus(sub.subscriber_id)) });
        const verified = await sendCoursePush(sub.subscriber_id, {
          title: "Calm Gut",
          body: "Reminders are on. This is how they will look.",
          url: `/app/${sub.app_token}`,
          tag: "push-check",
        });
        return NextResponse.json({ ok: true, verified, ...(await coursePushStatus(sub.subscriber_id)) });
      }
      if (op === "unsubscribe") {
        await removeCourseSubscription(sub.subscriber_id, typeof body.endpoint === "string" ? body.endpoint : undefined);
        return NextResponse.json({ ok: true, ...(await coursePushStatus(sub.subscriber_id)) });
      }
      if (op === "status") return NextResponse.json({ ok: true, ...(await coursePushStatus(sub.subscriber_id)) });
      return bad("unknown push op");
    }

    if (sub && action === "refund") {
      const offer = refundOffer(sub);
      if (!offer.eligible) return bad("a refund can be asked for in the first 7 days after buying", 403);
      const res = await requestFunnelRefund(sub);
      const outcome = refundOutcome(res);
      if (outcome === "refunded") {
        // The refund has started: end access now, once.
        await markGuidedRefunded(sub.subscriber_id);
        await removeCourseSubscription(sub.subscriber_id).catch(() => {});
        return NextResponse.json({ ok: true, status: "refunded" });
      }
      // The funnel said no for good: nothing pending, access unchanged.
      if (outcome === "too_late" || outcome === "not_refundable") return NextResponse.json({ ok: true, status: outcome });
      // Done by hand: note it and keep access. The funnel alerts Shivani when
      // it answered; the app emails her only when it could not be reached.
      const firstTime = !sub.refund_requested_at;
      await markRefundRequested(sub.subscriber_id);
      if (firstTime && !res.ok && !res.reached) {
        await tellCoachRefundPending(sub, res.why).catch((e) => console.error("[app-course] refund alert failed:", e));
      }
      if (!res.ok) console.error(`[app-course] refund for ${sub.subscriber_id} pending by hand: ${res.why}`);
      return NextResponse.json({ ok: true, status: "pending" });
    }

    // history
    const r = await readCourseRecord(ownerId, course.slug);
    return NextResponse.json({ ok: true, days: r.days, scores: r.scores, streak: listeningStreak(r.days, today) });
  } catch (err) {
    console.error("[app-course] failed:", action, err);
    return bad("save failed", 500);
  }
}
