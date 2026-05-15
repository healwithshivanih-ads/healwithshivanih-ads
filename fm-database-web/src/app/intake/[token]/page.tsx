import { lookupIntakeToken } from "@/lib/server-actions/intake";
import { IntakeForm } from "./intake-form";

export const dynamic = "force-dynamic";

export default async function IntakeTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
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

  return (
    <IntakeForm
      token={token}
      clientId={res.client_id}
      displayName={res.display_name}
      prefill={res.prefill}
      draft={res.intake_form_draft}
    />
  );
}
