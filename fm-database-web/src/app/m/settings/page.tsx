/**
 * /m/settings — change the coach mobile password.
 *
 * Behind the session gate (not in MOBILE_AUTH_PATHS), so only an already
 * signed-in device can open it. Plain <form> POST like the login page, so iOS
 * offers to update the saved Keychain entry after a change.
 */
import { BackLink, Note } from "../ui";
import { NotificationSetting } from "./notifications";

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

export default async function CoachMobileSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; changed?: string }>;
}) {
  const sp = await searchParams;
  const error = sp.error ? (ERRORS[sp.error] ?? ERRORS.unknown) : null;

  return (
    <main className="m-page" style={{ maxWidth: 400, margin: "0 auto" }}>
      <BackLink href="/m/today" label="Back" />
      <h1 className="m-pagehead" style={{ fontSize: "var(--fm-text-xl)", marginTop: 16 }}>Change password</h1>

      {sp.changed ? (
        <div style={{ marginBottom: 20 }}>
          <Note tone="success">Password changed. Any other signed-in device has been logged out.</Note>
        </div>
      ) : null}
      {error ? (
        <div style={{ marginBottom: 20 }}>
          <Note tone="danger">{error}</Note>
        </div>
      ) : null}

      <form method="POST" action="/api/m/password">
        <label htmlFor="current_password" className="m-label">Current password</label>
        <input id="current_password" name="current_password" type="password" required
          autoComplete="current-password" className="m-field" style={{ marginBottom: 20 }} />

        <label htmlFor="new_password" className="m-label">New password</label>
        <input id="new_password" name="new_password" type="password" required minLength={8}
          autoComplete="new-password" className="m-field" style={{ marginBottom: 20 }} />

        <label htmlFor="confirm_password" className="m-label">Confirm new password</label>
        <input id="confirm_password" name="confirm_password" type="password" required minLength={8}
          autoComplete="new-password" className="m-field" style={{ marginBottom: 24 }} />

        <button type="submit" className="fm-btn primary block">Change password</button>
      </form>

      <NotificationSetting />

      <p className="m-subtle" style={{ marginTop: 24 }}>
        There is no emailed reset link on purpose — it would be a second way
        into your client records. If you ever get locked out, reset it on the
        server instead.
      </p>
    </main>
  );
}
