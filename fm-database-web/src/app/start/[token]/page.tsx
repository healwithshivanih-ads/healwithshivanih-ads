import { lookupStartConfirmToken } from "@/lib/server-actions/plans";
import { StartConfirmForm } from "./start-confirm-form";

export const dynamic = "force-dynamic";

export default async function StartTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const res = await lookupStartConfirmToken(token);

  if (!res.ok) {
    let title = "This link can't be opened";
    let body =
      "Please tap your coach for a new link. Sometimes links expire after a couple of weeks or after they've already been used.";
    if (res.error === "already_used") {
      title = "Thanks — you've already confirmed";
      body =
        "Your start date is locked in. If you'd like to change it, just message Shivani and she'll send a fresh link.";
    } else if (res.error === "expired") {
      title = "This link has expired";
      body = "Please message Shivani and she'll send you a fresh one.";
    } else if (res.error === "invalid_or_expired") {
      title = "We couldn't find this link";
      body = "Please check that you opened the most recent link from Shivani.";
    }
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-semibold text-stone-800">{title}</h2>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">{body}</p>
      </div>
    );
  }

  return (
    <StartConfirmForm
      token={token}
      planSlug={res.plan_slug}
      displayName={res.display_name}
      defaultStart={res.default_meal_plan_start}
      currentMealPlanStartedOn={res.current_meal_plan_started_on}
      planPeriodStart={res.plan_period_start}
      planPeriodWeeks={res.plan_period_weeks}
    />
  );
}
