/**
 * /m/login — the only door into the coach mobile app.
 *
 * A plain <form> POST, deliberately: it works with no JavaScript, and iOS
 * offers to save the password to Keychain and autofill it with Face ID next
 * time, which is what makes a 30-day cookie plus a long password practical
 * on a phone.
 *
 * The page never reveals whether /m is configured — if COACH_MOBILE_PASSWORD
 * is unset the proxy 404s this route before it renders.
 */
import { safeMobileNext } from "@/lib/fmdb/middleware-policy";
import { Note } from "../ui";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "1": "That password didn't match.",
  throttled: "Too many attempts. Wait a few minutes.",
};

export default async function CoachMobileLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;
  const message = sp.error ? (ERRORS[sp.error] ?? ERRORS["1"]) : null;
  // Same clamp the POST handler applies, so the hidden field can never carry
  // a hostile value into the form in the first place.
  const next = safeMobileNext(sp.next);

  return (
    <main
      className="m-page"
      style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", justifyContent: "center" }}
    >
      <div style={{ maxWidth: 340, width: "100%", margin: "0 auto" }}>
        <h1>The Ochre Tree</h1>
        <p className="m-subtle" style={{ margin: "6px 0 0" }}>
          Coach companion
        </p>
        <hr className="m-divider" />

        {message ? (
          <div style={{ marginBottom: 20 }}>
            <Note tone="rose">{message}</Note>
          </div>
        ) : null}

        <form method="POST" action="/api/m/login">
          <input type="hidden" name="next" value={next} />
          <label htmlFor="password" className="m-label">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            className="m-field"
            style={{ marginBottom: 24 }}
          />
          <button type="submit" className="m-btn m-btn--primary m-btn--block">
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
