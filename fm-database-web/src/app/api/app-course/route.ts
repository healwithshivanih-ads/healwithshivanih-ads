/**
 * POST /api/app-course — the course listener's write-backs and audio links.
 *
 * Auth: body.token must resolve to an ACTIVE guided subscriber who owns the
 * course (course-store.ts::resolveCourseToken). Deliberately NOT
 * resolveAppToken: that one hands out client ids for clients/<id>/ writes,
 * and must keep refusing guided tokens. Everything here writes only under
 * guided/<subscriberId>/.
 *
 * Actions (body.action):
 *   audio      { track, version }            → { url, expiresAt } short-lived link
 *   listen     { track, version, date }      → a track played ≥ 80%: listen + "I listened today"
 *   log        { date, bloating, meals, bowel, stress, sleep, listened?, note? } → merge that day
 *   score      { answers: {bloating,pain,bowel,worry,life} } → the 5-question check (0–50)
 *   reminders  { daily_time: "HH:MM"|null, unlock: boolean }
 *   push       { op: "subscribe", subscription } | { op: "unsubscribe", endpoint? } | { op: "status" }
 *   history    {}                            → the saved days + scores (a new phone's first open)
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
import { ymdInTz } from "@/lib/fmdb/guided-tier";

export const dynamic = "force-dynamic";

const LIMITS: Record<string, number> = {
  audio: 300,
  listen: 60,
  log: 120,
  score: 6,
  reminders: 30,
  push: 30,
  history: 60,
};

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
  const { sub, course } = listener;
  const today = ymdInTz(new Date(), sub.timezone);
  const day = courseDay(sub.start_date, today);

  try {
    if (action === "audio" || action === "listen") {
      const track = getCourseTrack(course, typeof body.track === "string" ? body.track : "");
      if (!track) return bad("unknown track");
      const version = body.version === "voice" ? "voice" : "music";
      // Locked sessions get no link, whatever the phone thinks the date is.
      if (!isTrackUnlocked(track, day)) return bad("not open yet", 403);
      if (action === "audio") {
        const link = audioLinkFor(courseAudioKey(course, track, version), sub.subscriber_id);
        if (!link) return bad("audio not available yet", 503);
        return NextResponse.json({ ok: true, url: link.url, expiresAt: link.expiresAt });
      }
      const date = acceptLogDate(body.date, today);
      const r = await saveListen(sub.subscriber_id, course.slug, date, track.id, version);
      return NextResponse.json({ ok: true, date, streak: listeningStreak(r.days, today) });
    }

    if (action === "log") {
      const date = acceptLogDate(body.date, today);
      const log = sanitizeDayLog(body);
      if (Object.keys(log).length === 0) return bad("nothing to save");
      const r = await saveDayLog(sub.subscriber_id, course.slug, date, log);
      return NextResponse.json({ ok: true, date, day: r.days[date] });
    }

    if (action === "score") {
      const answers = sanitizeScore(body.answers);
      if (!answers) return bad("all five answers (0–10) required");
      const week = scoreCheckpointFor(course, Math.max(0, day));
      const r = await saveScore(sub.subscriber_id, course.slug, today, week, answers);
      const saved = r.scores.find((s) => s.week === week);
      return NextResponse.json({ ok: true, week, total: saved?.total ?? 0, scores: r.scores });
    }

    if (action === "reminders") {
      const prefs = { daily_time: sanitizeTime(body.daily_time), unlock: body.unlock !== false };
      const r = await saveReminderPrefs(sub.subscriber_id, course.slug, prefs);
      return NextResponse.json({ ok: true, reminders: r.reminders });
    }

    if (action === "push") {
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

    // history
    const r = await readCourseRecord(sub.subscriber_id, course.slug);
    return NextResponse.json({ ok: true, days: r.days, scores: r.scores, streak: listeningStreak(r.days, today) });
  } catch (err) {
    console.error("[app-course] failed:", action, err);
    return bad("save failed", 500);
  }
}
