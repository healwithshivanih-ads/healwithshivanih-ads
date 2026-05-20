import { lookupIntakeToken } from "@/lib/server-actions/intake";
import { IntakeForm } from "./intake-form";
import { PreDiscoveryForm } from "./pre-discovery-form";

export const dynamic = "force-dynamic";

export default async function IntakeTokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { token } = await params;
  const { focus } = await searchParams;
  const focusTier1 = focus === "tier1";
  const res = await lookupIntakeToken(token);

  if (!res.ok) {
    let title = "This link can't be opened";
    let body =
      "Please ask your coach for a new link. Sometimes links expire after a couple of weeks or after they've already been used.";
    if (res.error === "already_submitted") {
      title = "You've already sent this in";
      body =
        "Your coach has received your answers. If you need to share something more, please message her directly.";
    } else if (res.error === "expired") {
      title = "This link has expired";
      body = "Please message your coach and she'll send you a fresh link.";
    } else if (res.error === "invalid_or_expired") {
      title = "We couldn't find this link";
      body = "Please check that you opened the most recent link from your coach.";
    }
    return (
      <div className="fm-thanks">
        <div className="fm-thanks__eyebrow">
          <span className="pulse" aria-hidden="true" />
          <span>Heal with Shivani</span>
        </div>
        <h1 className="fm-thanks__title">{title}</h1>
        <p className="fm-thanks__body">{body}</p>
      </div>
    );
  }

  // v0.75 — two-stage form gate. Same URL, server picks which form to
  // render based on whether the coach has unlocked the full intake.
  // - pre_discovery → short ~14-field form, before the discovery call
  // - full          → the full 3693-line intake, post-package-signup
  // The client never sees a different URL; the form just expands when
  // the coach flips the gate (typically after signup) and the client
  // returns to the same link.
  if (res.stage === "pre_discovery") {
    return (
      <PreDiscoveryForm
        token={token}
        clientId={res.client_id}
        displayName={res.display_name}
        prefill={res.prefill}
        draft={res.intake_form_draft}
      />
    );
  }

  return (
    <IntakeForm
      token={token}
      clientId={res.client_id}
      displayName={res.display_name}
      prefill={res.prefill}
      draft={res.intake_form_draft}
      previouslySubmitted={res.previously_submitted}
      focusTier1={focusTier1}
    />
  );
}
