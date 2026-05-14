/**
 * /clients-v2/[id]/letter-editor — dual-palette letter editor.
 *
 * Design reference: FM Backlog Explorations Group D7e
 * (locked design, dual-palette modal).
 *
 * Implemented here as a full page rather than a modal so it deep-links
 * cleanly and survives back-button. Server-renders the saved letter
 * + validation report; the client component handles edits / save /
 * send.
 *
 * Layout:
 *   - Top chrome (orange/slate app palette) — close, title, action
 *     buttons (Preview, Save draft, Send to client)
 *   - 3-column body (200px | flex | 360px):
 *       LEFT  · section nav (auto-detected from markdown ## headings)
 *       MID   · DEEP MIND palette letter canvas — bone bg, indigo type,
 *               rose accent, Libre Baskerville serif
 *       RIGHT · AI checks — validation report from the Haiku QA pass
 *               (score / reason / rewrite per finding)
 *
 * URL params:
 *   ?plan=<slug>          (required)  which plan to edit
 *   ?type=<letter_type>   (optional)  consolidated | meal_plan |
 *                                     supplement_plan | lifestyle_guide |
 *                                     exercise_plan
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import {
  loadMealPlan,
  type LetterType,
} from "@/lib/server-actions/plan-lifecycle";
import { LetterEditor } from "./letter-editor";

export const dynamic = "force-dynamic";

const LETTER_TYPES: LetterType[] = [
  "consolidated",
  "meal_plan",
  "supplement_plan",
  "lifestyle_guide",
  "exercise_plan",
];

function isLetterType(s: string | undefined): s is LetterType {
  return !!s && (LETTER_TYPES as string[]).includes(s);
}

const TYPE_META: Record<
  LetterType,
  { label: string; icon: string }
> = {
  consolidated: { label: "Full wellness letter", icon: "💌" },
  meal_plan: { label: "Meal plan", icon: "🍽" },
  meal_plan_phase: { label: "Meal plan — continuation", icon: "🍽" },
  supplement_plan: { label: "Supplement guide", icon: "💊" },
  lifestyle_guide: { label: "Lifestyle guide", icon: "🌿" },
  exercise_plan: { label: "Exercise plan", icon: "🏃" },
};

export default async function LetterEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ plan?: string; type?: string }>;
}) {
  const { id } = await params;
  const { plan: planSlug, type: rawType } = await searchParams;
  const letterType: LetterType = isLetterType(rawType) ? rawType : "consolidated";

  if (!planSlug) {
    return (
      <NoPlanFallback clientId={id} reason="no_plan_param" />
    );
  }

  const client = await loadClientById(id);
  if (!client) notFound();

  const data = await loadMealPlan(planSlug, id, letterType);
  if (!data.ok || !data.markdown) {
    return (
      <NoPlanFallback
        clientId={id}
        reason="not_generated"
        planSlug={planSlug}
        letterType={letterType}
      />
    );
  }

  const meta = TYPE_META[letterType];
  const displayName = client.display_name ?? client.client_id;
  const clientEmail = (client as { email?: string }).email;

  return (
    <LetterEditor
      clientId={id}
      clientName={displayName}
      clientEmail={clientEmail}
      planSlug={planSlug}
      letterType={letterType}
      letterIcon={meta.icon}
      letterLabel={meta.label}
      initialMarkdown={data.markdown}
      initialHtml={data.html ?? null}
      initialValidation={data.validationReport ?? []}
    />
  );
}

function NoPlanFallback({
  clientId,
  reason,
  planSlug,
  letterType,
}: {
  clientId: string;
  reason: "no_plan_param" | "not_generated";
  planSlug?: string;
  letterType?: LetterType;
}) {
  return (
    <div
      className="fm-v2"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 15, 20, 0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999,
        padding: 32,
      }}
    >
      <div
        style={{
          maxWidth: 520,
          background: "var(--fm-surface)",
          padding: "30px 32px",
          borderRadius: "var(--fm-radius-md)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 10 }}>✉</div>
        <h1
          style={{
            fontFamily: "var(--fm-font-display)",
            fontSize: 22,
            fontWeight: 400,
            margin: "0 0 6px",
            letterSpacing: "-0.3px",
          }}
        >
          {reason === "no_plan_param"
            ? "Pick a plan first"
            : "Letter not generated yet"}
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "var(--fm-text-secondary)",
            margin: "0 0 18px",
            lineHeight: 1.55,
          }}
        >
          {reason === "no_plan_param" ? (
            <>
              Open the letter editor from a specific plan’s Communicate
              tab — the page needs a <code>?plan=&lt;slug&gt;</code>{" "}
              parameter to know which letter to load.
            </>
          ) : (
            <>
              No saved <strong>{letterType?.replace(/_/g, " ")}</strong>{" "}
              letter for plan <code>{planSlug}</code>. Generate it from
              Communicate → Client letters → 📤 Send package.
            </>
          )}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <Link
            href={`/clients-v2/${clientId}/communicate`}
            style={{
              background: "var(--fm-primary)",
              color: "#fff",
              padding: "9px 16px",
              fontSize: 12.5,
              fontWeight: 700,
              borderRadius: "var(--fm-radius-sm)",
              textDecoration: "none",
            }}
          >
            Open Communicate →
          </Link>
          <Link
            href={`/clients-v2/${clientId}`}
            style={{
              background: "var(--fm-surface)",
              border: "1px solid var(--fm-border)",
              padding: "9px 16px",
              fontSize: 12.5,
              fontWeight: 700,
              borderRadius: "var(--fm-radius-sm)",
              textDecoration: "none",
              color: "var(--fm-text-primary)",
            }}
          >
            ← Client overview
          </Link>
        </div>
      </div>
    </div>
  );
}
