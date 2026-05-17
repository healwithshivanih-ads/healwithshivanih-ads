/**
 * GET /api/letter/<clientId>/<planSlug>/<letterType>?format=html|md
 *
 * Serves the saved client-facing letter from disk so the coach can open
 * it inline on the plan tab (vs detouring to /communicate).
 *
 * Defaults to format=html. Falls back to markdown wrapped in minimal
 * styling if the HTML file isn't on disk (older letters).
 *
 * Routes:
 *   /api/letter/cl-006/geetika-plan-1-2026-05-09-cl-006/consolidated     → HTML
 *   /api/letter/cl-006/geetika-plan-1-2026-05-09-cl-006/meal_plan?format=md → markdown text
 *
 * Auth posture: lives behind the standard coach-UI auth gate (i.e. NOT
 * in middleware's public allowlist), so on Fly with FLY_INTAKE_ONLY=1
 * this route returns 404 — the public Fly machine doesn't expose
 * generated coach material. On localhost / non-intake-only deploys it
 * works as a normal authenticated coach route.
 */

import { NextResponse } from "next/server";
import { loadMealPlan, type LetterType } from "@/lib/server-actions/plan-lifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_TYPES: LetterType[] = [
  "consolidated",
  "meal_plan",
  "meal_plan_phase",
  "supplement_plan",
  "lifestyle_guide",
  "exercise_plan",
  "recipes",
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function markdownFallback(md: string, title: string): string {
  // Minimal wrapper for markdown-only letters (no branded HTML on disk).
  // We don't render markdown to HTML here — the coach is reading it for
  // reference, not for hand-off. A monospace block is fine.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 760px; margin: 32px auto; padding: 0 16px; color: #1d1d1f; line-height: 1.6; }
  h1 { font-size: 20px; color: #6b7280; margin-bottom: 8px; }
  pre { white-space: pre-wrap; word-wrap: break-word; font-family: "SF Mono", Menlo, monospace; font-size: 13px; background: #f5f5f7; padding: 16px; border-radius: 8px; }
  .note { background: #fef3c7; border-left: 3px solid #f59e0b; padding: 10px 14px; border-radius: 0 6px 6px 0; font-size: 13px; margin-bottom: 24px; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="note">⚠ This letter only has a markdown file on disk — no branded HTML was generated. Showing raw markdown for reference. Regenerate from <code>/communicate</code> to produce the styled HTML.</div>
  <pre>${escapeHtml(md)}</pre>
</body>
</html>`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ clientId: string; planSlug: string; letterType: string }> },
) {
  const { clientId, planSlug, letterType } = await params;

  if (!VALID_TYPES.includes(letterType as LetterType)) {
    return new NextResponse(`Unknown letter type: ${letterType}`, { status: 400 });
  }

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "html").toLowerCase();
  const download = url.searchParams.get("download") === "1";

  const data = await loadMealPlan(planSlug, clientId, letterType as LetterType);
  if (!data.ok || !data.markdown) {
    return new NextResponse(
      `No saved ${letterType} letter found for plan ${planSlug}. Generate from /communicate first.`,
      { status: 404 },
    );
  }

  if (format === "md") {
    return new NextResponse(data.markdown, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        ...(download
          ? {
              "Content-Disposition": `attachment; filename="${planSlug}-${letterType}.md"`,
            }
          : {}),
      },
    });
  }

  // Default: HTML view. Use the branded HTML if present, otherwise wrap markdown.
  const title = `${letterType.replace(/_/g, " ")} — ${planSlug}`;
  const body = data.html ?? markdownFallback(data.markdown, title);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...(download
        ? {
            "Content-Disposition": `attachment; filename="${planSlug}-${letterType}.html"`,
          }
        : {}),
    },
  });
}
