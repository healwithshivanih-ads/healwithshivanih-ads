/**
 * /letter/<token> — public client-facing plan letter.
 *
 * Token-based auth (same shape as /intake/<token>): the published plan
 * stores letter_token; visiting /letter/<that-token> serves the
 * consolidated HTML letter from disk. Revoking the plan clears the
 * token → the URL 404s.
 *
 * Anti-injection: middleware allowlists /letter/. The HTML body comes
 * straight from disk as already-rendered output from
 * render-client-letter.py + brand_html.py — it's the same HTML the
 * coach saw before sending. We dangerouslySetInnerHTML it into a
 * full-bleed div; no client JS executes from this page itself.
 */
import { lookupLetterToken } from "@/lib/server-actions/letter-token";
import { loadMealPlan } from "@/lib/server-actions/plan-lifecycle";
import { AutoSizedLetterIframe } from "./auto-sized-letter-iframe";

export const dynamic = "force-dynamic";

export default async function LetterTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const res = await lookupLetterToken(token);

  if (!res.ok) {
    const title =
      res.error === "invalid_token"
        ? "This link can't be opened"
        : "We couldn't find this letter";
    const body =
      res.error === "invalid_token"
        ? "The link looks malformed. Please open the most recent link your coach sent."
        : "Your coach may have replaced this letter with a newer version. Ask her for a fresh link.";
    return (
      <div
        style={{
          maxWidth: 520,
          margin: "10vh auto",
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          color: "#1f2937",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{title}</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "#6b7280" }}>{body}</p>
      </div>
    );
  }

  const letter = await loadMealPlan(res.plan_slug, res.client_id, "consolidated").catch(
    () => null,
  );
  if (!letter?.html) {
    return (
      <div
        style={{
          maxWidth: 520,
          margin: "10vh auto",
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          color: "#1f2937",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
          Letter not ready yet
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "#6b7280" }}>
          Your coach hasn&apos;t finished generating the letter for this plan
          yet. Please check back in a few minutes, or message her if it
          stays missing.
        </p>
      </div>
    );
  }

  // The HTML from disk is a full standalone document (brand_html wraps
  // it with <!doctype html> + CSS + body). Serve it via a srcDoc iframe
  // — keeps brand CSS isolated from Next's ambient global styles. The
  // AutoSizedLetterIframe wrapper resizes the iframe to its content so
  // the OUTER page scrolls (native mobile momentum + URL-bar auto-hide).
  // Fix F22 2026-05-23.
  return <AutoSizedLetterIframe srcDoc={letter.html} />;
}
