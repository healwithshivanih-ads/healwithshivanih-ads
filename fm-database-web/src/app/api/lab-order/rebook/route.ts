/**
 * POST /api/lab-order/rebook
 *
 * Client taps "Rebook" on their last lab package — self-service, no coach
 * recommendation needed first. Finds the client's most recent non-cancelled
 * order, re-derives its profile/add-on selection ENTIRELY from the current
 * catalogue (never the old order's stored amounts — pricing may have moved
 * since), and creates a fresh `recommended` order via the same buildOrder()
 * path a coach recommendation uses. The client then books + pays it through
 * the existing /api/lab-order/[orderId]/pay pipeline — no separate flow.
 *
 * A profile or add-on that's no longer in the catalogue is dropped, never
 * substituted — if nothing survives, refuse rather than silently charge for
 * a different package than the one the client actually asked to repeat.
 */
import { NextResponse } from "next/server";
import { loadLabProvider } from "@/lib/fmdb/lab-providers";
import { loadClientOrders, createRecommendedOrder, type RecommendAddon } from "@/lib/fmdb/lab-orders";
import { verifyAppClient } from "@/lib/fmdb/app-auth";
import { allowDaily } from "@/lib/fmdb/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { token?: string } | null;

  // AUTHORIZE: derive the client from the app token — never trust a body-supplied id.
  const auth = await verifyAppClient(body?.token);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const clientId = auth.clientId;

  // Stricter than the pay bucket — this MINTS a new price-bearing record, not
  // just pays for one the coach already approved.
  if (!(await allowDaily("lab-rebook", clientId, 5)).ok) {
    return NextResponse.json({ ok: false, error: "too many attempts today" }, { status: 429 });
  }

  const orders = await loadClientOrders(clientId);
  const last = orders.find((o) => o.status !== "cancelled");
  if (!last) {
    return NextResponse.json({ ok: false, error: "no previous lab order on file to rebook" }, { status: 404 });
  }
  // A payable order is already sitting there — don't mint a duplicate.
  if (last.status === "recommended") {
    return NextResponse.json({ ok: false, error: "you already have an order ready to book" }, { status: 409 });
  }

  const provider = await loadLabProvider();
  if (!provider) return NextResponse.json({ ok: false, error: "lab catalogue unavailable" }, { status: 503 });

  const profileId =
    last.profile_id != null && provider.profiles.some((p) => p.id === last.profile_id) ? last.profile_id : null;
  const addons: RecommendAddon[] = [];
  for (const slug of last.addon_slugs ?? []) {
    const a = provider.addons.find((x) => x.slug === slug);
    if (a && a.clientInr != null) addons.push({ slug, inr: a.clientInr });
  }
  if (profileId == null && addons.length === 0) {
    return NextResponse.json(
      { ok: false, error: "that package isn't available to rebook right now — message your coach" },
      { status: 409 },
    );
  }

  const res = await createRecommendedOrder(provider, {
    clientId,
    profileId,
    addons,
    coachNote: "Rebooked — same tests as your last order.",
    recommendedBy: "client_rebook",
  });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 409 });

  return NextResponse.json({ ok: true, order: res.order });
}
