/**
 * /m/login — the only door into the coach mobile app.
 *
 * A plain <form> POST, deliberately: it works with no JavaScript, and iOS
 * offers to save the password to Keychain / autofill it with Face ID next
 * time, which is what makes a 30-day cookie plus a long random password
 * practical on a phone.
 *
 * The page never reveals whether /m is configured — if COACH_MOBILE_PASSWORD
 * is unset the proxy 404s this route before it renders.
 */
import { safeMobileNext } from "@/lib/fmdb/middleware-policy";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "1": "That password didn't match. Try again.",
  throttled: "Too many attempts. Wait a few minutes and try again.",
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
      style={{
        minHeight: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 360 }}>
        <h1
          style={{
            fontFamily: "var(--font-libre-baskerville), Georgia, serif",
            fontSize: 26,
            margin: "0 0 4px",
            color: "#2B2D42",
          }}
        >
          The Ochre Tree
        </h1>
        <p style={{ margin: "0 0 28px", color: "#6B6560", fontSize: 15 }}>
          Coach companion
        </p>

        {message ? (
          <div
            role="alert"
            style={{
              background: "#FDECEC",
              border: "1px solid #E9B8B8",
              color: "#8A2F2F",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 14,
              marginBottom: 16,
            }}
          >
            {message}
          </div>
        ) : null}

        <form method="POST" action="/api/m/login">
          <input type="hidden" name="next" value={next} />
          <label
            htmlFor="password"
            style={{
              display: "block",
              fontSize: 14,
              color: "#4A4540",
              marginBottom: 6,
            }}
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            // Tells iOS this is a sign-in field worth offering Keychain for.
            // 16px minimum or Safari zooms the whole page on focus.
            style={{
              width: "100%",
              fontSize: 16,
              padding: "12px 14px",
              borderRadius: 10,
              border: "1px solid #D8D2C8",
              background: "#fff",
              marginBottom: 16,
            }}
          />
          <button
            type="submit"
            style={{
              width: "100%",
              fontSize: 16,
              fontWeight: 600,
              padding: "13px 16px",
              borderRadius: 10,
              border: "none",
              background: "#2B2D42",
              color: "#fff",
            }}
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
