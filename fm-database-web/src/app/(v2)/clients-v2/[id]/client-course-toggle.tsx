"use client";

/**
 * ClientCourseToggle — the coach's switch for a course in the client's own
 * app (client.yaml#courses, src/lib/fmdb/client-courses.ts). Calm Gut shows
 * on the Practices tab of the new app. Free for a client in care.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setClientCourseAction } from "@/lib/server-actions/food-diary";

export function ClientCourseToggle({
  clientId,
  slug,
  title,
  startedOn,
}: {
  clientId: string;
  slug: string;
  title: string;
  /** YYYY-MM-DD when on, null when off. */
  startedOn: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const on = startedOn !== null;
  const flip = () =>
    start(async () => {
      const r = await setClientCourseAction(clientId, slug, !on);
      if (r.ok) {
        toast.success(!on ? `${title} is on in their app` : `${title} is off in their app`);
        router.refresh();
      } else {
        toast.error(`Couldn't change it — ${r.error}`);
      }
    });
  const since = startedOn
    ? new Date(`${startedOn}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" })
    : "";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
      <span style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
        {on ? `${title} course on in the app (Practices tab), week 1 began ${since}` : `${title} course not in the app`}
      </span>
      <button
        type="button"
        onClick={flip}
        disabled={pending}
        style={{
          padding: "4px 10px",
          fontSize: 11,
          fontWeight: 600,
          background: "transparent",
          color: "var(--fm-text-primary)",
          border: "1px solid var(--fm-border)",
          borderRadius: "var(--fm-radius-sm)",
          cursor: pending ? "wait" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {pending ? "Saving…" : on ? "Turn off" : "Turn on"}
      </button>
    </div>
  );
}
