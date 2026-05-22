"use client";

/**
 * PromoteDraftButton — one-click recovery for a stranded intake draft.
 *
 * Rendered inside <IntakeProgressCard> when the card detects an orphaned
 * draft: the client filled substantial content into client.intake_form_draft
 * (auto-saved) but never tapped Submit, so none of it reached the real
 * top-level fields. The coach clicks here to run the same merge a client
 * submit would, by client_id (no token needed — see promoteIntakeDraft /
 * action_promote_draft).
 *
 * After a successful promote, intake_form_draft is cleared server-side and
 * the page refreshes — the card flips to "Submitted", the intake session
 * appears, and panels that read promoted fields (TierOneSuspicionsPanel,
 * intake insights) start working.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface Props {
  clientId: string;
  /** Count of non-empty fields in the draft — shown so the coach knows the size. */
  fieldCount: number;
}

export function PromoteDraftButton({ clientId, fieldCount }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onPromote = () => {
    startTransition(async () => {
      const { promoteIntakeDraft } = await import("@/lib/server-actions/intake");
      const res = await promoteIntakeDraft(clientId);
      if (res.ok) {
        toast.success(
          `Intake draft promoted — ${res.fields_updated.length} field${
            res.fields_updated.length === 1 ? "" : "s"
          } merged into the client record.`,
        );
        router.refresh();
      } else {
        toast.error(
          res.error === "no_draft_to_promote"
            ? "No draft to promote — it may already have been submitted."
            : res.error === "intake_locked_by_coach"
              ? "Intake is finalised (locked) — unlock it first to promote a draft."
              : `Couldn't promote the draft — ${res.error}`,
          { duration: 9000 },
        );
      }
    });
  };

  return (
    <button
      type="button"
      onClick={onPromote}
      disabled={pending}
      style={{
        padding: "7px 13px",
        fontSize: 12,
        fontWeight: 700,
        background: pending ? "#94a3b8" : "#b45309",
        color: "#fff",
        border: "none",
        borderRadius: "var(--fm-radius-sm)",
        cursor: pending ? "wait" : "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      {pending
        ? "Promoting…"
        : `📥 Promote draft → submit (${fieldCount} field${fieldCount === 1 ? "" : "s"})`}
    </button>
  );
}
