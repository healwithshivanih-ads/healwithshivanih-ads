import { lookupFoundationToken } from "@/lib/server-actions/foundation-session";
import { FoundationPayClient } from "./foundation-pay-client";

export const dynamic = "force-dynamic";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default async function FoundationTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const res = await lookupFoundationToken(token);

  if (!res.ok) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-semibold text-stone-800">We couldn&apos;t open this link</h2>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">
          Please check you opened the most recent link from Shivani, or message her for a fresh
          one.
        </p>
      </div>
    );
  }

  // ── PAID → next steps: intake form + book the call ──────────────────────────
  if (res.paid) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm sm:p-7">
          <div className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
            Payment received
          </div>
          <h2 className="mt-1 text-xl font-semibold text-emerald-900">
            Thank you, {res.firstName} — you&apos;re all set 🌿
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-emerald-800">
            Two quick things to get the most from our session:
          </p>
        </div>

        {/* Step 1 — intake form */}
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white">
              1
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-stone-800">
                Complete your health intake form
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-stone-600">
                This is where your story begins — it lets Shivani prepare properly before you talk.
              </p>
              {res.intakeSubmitted ? (
                <p className="mt-3 text-sm font-medium text-emerald-700">✓ Intake received — thank you!</p>
              ) : res.intakePath ? (
                <a
                  href={res.intakePath}
                  className="mt-3 inline-flex items-center justify-center rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
                >
                  Open my intake form →
                </a>
              ) : (
                <p className="mt-3 text-sm text-stone-500">
                  Your intake link is on its way — Shivani will send it shortly.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Step 2 — book the call */}
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white">
              2
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-stone-800">Book your foundation call</h3>
              <p className="mt-1 text-sm leading-relaxed text-stone-600">
                Pick a time that works for you. This is our proper sit-down together.
              </p>
              <a
                href={res.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center justify-center rounded-xl border border-emerald-700 bg-white px-5 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"
              >
                Choose a time →
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── UNPAID → pay for the foundation session ─────────────────────────────────
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
          Foundation Session
        </div>
        <h2 className="mt-1 text-2xl font-semibold text-stone-800">
          Hi {res.firstName} — let&apos;s begin your journey
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">
          Your foundation session is a deep first look at your health — where we map what&apos;s
          going on and the first steps that will make a difference. Once you book below,
          you&apos;ll be guided straight to your intake form and to choosing a time for our call.
        </p>
        <div className="mt-5 flex items-baseline gap-2">
          <span className="text-3xl font-semibold text-stone-900">{inr(res.amountInr)}</span>
          <span className="text-sm text-stone-500">one-time</span>
        </div>
      </div>

      <FoundationPayClient
        token={token}
        clientId={res.clientId}
        amountInr={res.amountInr}
      />

      <p className="px-1 text-center text-xs text-stone-400">
        Secure payment · You&apos;ll get your intake form &amp; booking link right after.
      </p>
    </div>
  );
}
