/**
 * /m/clients/[id]/app — the client's own companion app, framed inside the
 * coach app.
 *
 * WHY A FRAME AND NOT A NEW TAB: a new tab loses the coach's place, and on a
 * phone it means juggling two apps. Framing keeps a way back and makes the
 * borrowed-view relationship legible — this is THEIR screen being looked at,
 * not another page of the coach's tool.
 *
 * The src is the absolute production URL (see clientAppUrl), never a local
 * render: the point is to see the thing they actually have in front of them,
 * including anything that happens to be broken for them.
 *
 * Framing is possible because the client app sets neither X-Frame-Options nor
 * a frame-ancestors policy — verified against production. On Fly the frame is
 * same-origin (both live on intake.theochretree.com); from the Mac it is
 * cross-origin, which is fine, since nothing here reads into the document.
 */
import { notFound } from "next/navigation";
import { clientAppUrl, loadCoachCard } from "@/lib/fmdb/coach-mobile";
import { BackLink, Icon } from "../../../../ui";

export const dynamic = "force-dynamic";

export default async function ClientAppView({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const card = loadCoachCard(id);
  if (!card) notFound();

  const g = card.glance as Record<string, unknown>;
  const name = String(g.display_name ?? card.id);
  const url = clientAppUrl(
    (g.app_token as string | undefined) ?? card.plan?.letter_token,
  );
  // No app to show is a 404, not an empty frame pretending to be one.
  if (!url) notFound();

  const first = name.split(" ")[0];

  return (
    <main className="m-page" style={{ paddingBottom: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <BackLink href={`/m/clients/${card.id}`} label={first} />
        <a
          className="m-subtle"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          Full screen
          <Icon name="external" size="sm" />
        </a>
      </div>

      <p className="m-eyebrow" style={{ margin: "0 2px 10px" }}>
        {first}&apos;s app — live
      </p>

      {/* A device, not a panel: the frame is what signals the content belongs
          to someone else. Generous on a laptop where there is room to draw a
          phone; nearly full-bleed on an actual phone, where a thick bezel
          would only steal width from the thing being inspected. */}
      <div className="m-device">
        <div className="m-device-bar" aria-hidden="true"></div>
        <iframe
          className="m-device-screen"
          src={url}
          title={`${name}'s companion app`}
        ></iframe>
      </div>

      <p className="m-subtle" style={{ margin: "10px 2px 0" }}>
        The live app at their own address — not a preview. What loads here is
        what is on their phone.
      </p>
    </main>
  );
}
