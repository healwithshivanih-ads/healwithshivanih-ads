/**
 * /app/<token> — the client companion app ("The Ochre Tree").
 *
 * Token = the plan's letter_token (same public-token posture as
 * /letter/<token>): issued at publish, cleared on revoke, non-guessable.
 * Everything renders from the real published plan + client record.
 */

import { cache } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { loadClientAppData } from "@/lib/fmdb/client-app";
import { pickAppShell } from "@/lib/fmdb/app-shell";
import { logAppOpen } from "@/lib/fmdb/app-opens";
import OchreApp, { OchreAppError } from "./ochre-app";
import {
  COURSE_DEVICE_COOKIE,
  courseDeviceLimitActive,
  courseDeviceStatus,
  maskEmail,
  maxCourseDevices,
  touchCourseDevice,
} from "@/lib/fmdb/course-devices";
import { CourseDeviceGate } from "./course-device-gate";
import { CourseEndedScreen } from "./course-ended";
import { resolveGuidedSubscriberByToken } from "@/lib/fmdb/guided-tier";

export const dynamic = "force-dynamic";

/** One load per request: the page and its metadata both need the data. */
const loadOnce = cache(async (token: string) => {
  try {
    // Device timezone pinned by the app shell on first open — all "today" math
    // (menu day, week counter) renders in the client's local day, not IST.
    const deviceTz = (await cookies()).get("ochre_tz")?.value ?? null;
    return await loadClientAppData(token, { deviceTz });
  } catch (err) {
    console.error("[client-app] failed to assemble app data:", err);
    return null;
  }
});

/**
 * A client on the new front sees the Sequoya name and ring mark in the
 * browser tab and on the home screen. Everyone else keeps The Ochre Tree
 * (the layout's metadata). Same rule as the front itself, so the name is
 * under the same embargo: only a switched-on client in programme gets it.
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const data = await loadOnce(token);
  if (data?.course?.only) {
    // Course buyers install "Calm Gut" with the tree-ring icon (no lettering).
    return {
      title: "Calm Gut — The Ochre Tree",
      description: "Your Calm Gut course.",
      manifest: "/ochre-app/calm-gut.webmanifest",
      icons: { icon: "/sq-app/icon-192.png", apple: "/sq-app/apple-touch-icon.png" },
      appleWebApp: { capable: true, statusBarStyle: "default", title: "Calm Gut" },
    };
  }
  if (!data || pickAppShell(data) !== "sq") return {};
  return {
    title: "Sequoya — your plan",
    description: "Your plan, day by day.",
    manifest: "/sq-app/manifest.webmanifest",
    icons: { icon: "/sq-app/icon-192.png", apple: "/sq-app/apple-touch-icon.png" },
    appleWebApp: { capable: true, statusBarStyle: "default", title: "Sequoya" },
  };
}

export default async function ClientAppPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await loadOnce(token);
  if (!data) {
    // A course switched off after a refund: say so plainly, not "link broken".
    const sub = await resolveGuidedSubscriberByToken(token).catch(() => null);
    if (sub && sub.product === "course" && sub.status === "refunded") return <CourseEndedScreen />;
    return <OchreAppError />;
  }
  // A course buyer's link works on two phones (course-devices.ts). Any other
  // device gets the gate: register while a slot is free, else a code emailed
  // to the buyer. Programme clients never reach this.
  if (data.course?.only && courseDeviceLimitActive()) {
    const raw = (await cookies()).get(COURSE_DEVICE_COOKIE)?.value ?? null;
    const status = await courseDeviceStatus(data.clientId, raw);
    if (status !== "known") {
      const contact = data.account.contact;
      return (
        <CourseDeviceGate
          token={data.token}
          mode={status}
          title={data.course.ownerFirstName ? `${data.course.ownerFirstName}'s ${data.course.title}` : data.course.title}
          maskedEmail={contact.includes("@") ? maskEmail(contact) : ""}
          maxDevices={maxCourseDevices()}
        />
      );
    }
    void touchCourseDevice(data.clientId, raw!).catch(() => {});
  }
  // adoption signal — Fly-only (coach previews on localhost are excluded)
  void logAppOpen(data.clientId);
  return <OchreApp data={data} />;
}
