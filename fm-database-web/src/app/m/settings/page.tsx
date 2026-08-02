/**
 * /m/settings — change the coach mobile password.
 *
 * Behind the session gate (not in MOBILE_AUTH_PATHS), so only an already
 * signed-in device can open it. Plain <form> POST like the login page, so iOS
 * offers to update the saved Keychain entry after a change.
 */
import Link from "next/link";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  current: "That current password isn't right.",
  short: "Pick something at least 8 characters long.",
  same: "That's the same as your current password.",
  mismatch: "The two new passwords don't match.",
  write: "Couldn't save — the password file wasn't writable.",
  config: "Mobile access isn't configured on this host.",
  unknown: "Something went wrong. Try again.",
};

const label: React.CSSProperties = {
  display: "block",
  fontSize: 14,
  color: "#4A4540",
  marginBottom: 6,
};

// 16px minimum, or Safari zooms the page when the field is focused.
const input: React.CSSProperties = {
  width: "100%",
  fontSize: 16,
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid #D8D2C8",
  background: "#fff",
  marginBottom: 16,
};

export default async function CoachMobileSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; changed?: string }>;
}) {
  const sp = await searchParams;
  const error = sp.error ? (ERRORS[sp.error] ?? ERRORS.unknown) : null;

  return (
    <main style={{ padding: 24, maxWidth: 420, margin: "0 auto" }}>
      <Link href="/m" style={{ fontSize: 15, color: "#6B6560" }}>
        ← Back
      </Link>

      <h1
        style={{
          fontFamily: "var(--font-libre-baskerville), Georgia, serif",
          fontSize: 24,
          margin: "16px 0 20px",
          color: "#2B2D42",
        }}
      >
        Change password
      </h1>

      {sp.changed ? (
        <div
          role="status"
          style={{
            background: "#E8F3EC",
            border: "1px solid #B4D6C1",
            color: "#2E6B45",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 14,
            marginBottom: 16,
          }}
        >
          Password changed. Any other signed-in device has been logged out.
        </div>
      ) : null}

      {error ? (
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
          {error}
        </div>
      ) : null}

      <form method="POST" action="/api/m/password">
        <label htmlFor="current_password" style={label}>
          Current password
        </label>
        <input
          id="current_password"
          name="current_password"
          type="password"
          required
          autoComplete="current-password"
          style={input}
        />

        <label htmlFor="new_password" style={label}>
          New password
        </label>
        <input
          id="new_password"
          name="new_password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          style={input}
        />

        <label htmlFor="confirm_password" style={label}>
          Confirm new password
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          style={input}
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
          Change password
        </button>
      </form>

      <p style={{ marginTop: 24, fontSize: 13, color: "#8A857F", lineHeight: 1.5 }}>
        There is no emailed reset link on purpose — it would be a second way
        into your client records. If you ever get locked out, reset it on the
        server instead.
      </p>
    </main>
  );
}
