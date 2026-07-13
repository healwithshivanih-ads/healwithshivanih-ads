"use client";

/**
 * Plan tab v2 — AI assistant + client-letter preview composite.
 *
 * Coach asked: "There is no chat option or preview to see the plan and
 * edit it by the coach." The legacy plan editor has both — chat under
 * a <details> on Protocol tab, preview via the "Render markdown" button
 * in Lifecycle. v2 didn't surface either.
 *
 * This client component wraps:
 *   - 💬 AI assistant — embeds the existing PlanChatPanel from the
 *     legacy editor. Same actions / same persistence — coach can ask
 *     "swap NAC for selenium" or "add ferritin recheck at week 12" and
 *     have the change land on the plan.
 *   - 👁 Preview — server-renders the plan as the client would see it
 *     (markdown) via renderPlan() and shows inline. Click to expand.
 *
 * Both panels render as collapsible <details> so they don't dominate
 * the page on first paint. State is local; coach opens / closes as
 * needed during the consult.
 */
import { useState, useTransition } from "react";
import { PlanChatPanel } from "@/components/plan-editor/plan-chat-panel";
import { renderPlan, type RenderResult } from "@/lib/server-actions/plan-lifecycle";

export interface PlanChatAndPreviewProps {
  clientId: string;
  planSlug: string;
  /** Locked when no editable plan exists. The summary becomes a static
   *  notice, the panel won't open, and the create-draft hint shows. */
  isLocked: boolean;
  /** Why the chat is locked. Drives copy:
   *  - "published": "Only drafts can be modified — create a follow-up
   *                  draft to make changes."
   *  - "archived":  "This plan is superseded / revoked — can't be edited."
   *  Ignored when isLocked=false. */
  lockReason?: "published" | "archived";
  /** When locked because the only plan is published — hash anchor or
   *  full URL the "↓ Create a draft" link points at. Typically
   *  "#follow-up-panel" (the in-page FollowUpPanel). */
  createDraftHref?: string;
  /** Optional banner shown ABOVE the chat summary when chat is targeting
   *  a draft sitting next to a published plan — e.g. "Editing draft
   *  geetika-plan-2-… (the published plan is left alone)." Helps the
   *  coach trust she's modifying the right plan. */
  draftTargetNote?: string;
}

export function PlanChatAndPreview({
  clientId,
  planSlug,
  isLocked,
  lockReason,
  createDraftHref,
  draftTargetNote,
}: PlanChatAndPreviewProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const loadPreview = () => {
    if (preview) return; // cache — re-toggle reuses
    startTransition(async () => {
      try {
        const res: RenderResult = await renderPlan(planSlug, "markdown");
        if (res.ok && res.content) {
          setPreview(res.content);
        } else {
          setPreviewError(res.error ?? "Could not render plan.");
        }
      } catch (e) {
        setPreviewError((e as Error).message);
      }
    });
  };

  // Preview block — shared between locked + unlocked branches.
  // Defined as a local fn so the JSX below stays readable.
  const renderPreviewBlock = () => (
    <details
      open={previewOpen}
      onToggle={(e) => {
        const open = (e.target as HTMLDetailsElement).open;
        setPreviewOpen(open);
        if (open) loadPreview();
      }}
      style={{
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-md)",
        padding: "12px 14px",
      }}
    >
      <summary
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          listStyle: "none",
          outline: "none",
        }}
      >
        <span style={{ fontSize: 16 }}>👁</span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--fm-text-primary)",
          }}
        >
          Preview plan
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
            marginLeft: 6,
          }}
        >
          What the client sees — slugs translated, mechanisms hidden
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
          }}
        >
          {previewOpen ? "▾ close" : "▸ open"}
        </span>
      </summary>
      {previewOpen && (
        <div style={{ marginTop: 12 }}>
          {pending && !preview && (
            <div
              style={{
                fontSize: 12,
                color: "var(--fm-text-tertiary)",
                fontStyle: "italic",
                padding: "8px 0",
              }}
            >
              Rendering plan preview…
            </div>
          )}
          {previewError && (
            <div
              style={{
                padding: "8px 12px",
                background: "rgba(231, 76, 60, 0.06)",
                border: "1px solid rgba(231, 76, 60, 0.25)",
                borderRadius: "var(--fm-radius-sm)",
                fontSize: 12,
                color: "#9b1c1c",
              }}
            >
              {previewError}
            </div>
          )}
          {preview && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                  fontSize: 11,
                  color: "var(--fm-text-tertiary)",
                }}
              >
                <span>
                  Markdown render. For full HTML / brand template +
                  print →{" "}
                  <a
                    href={`/clients-v2/${clientId}/plan/edit/${planSlug}`}
                    style={{
                      color: "var(--fm-primary)",
                      fontWeight: 700,
                      textDecoration: "none",
                    }}
                  >
                    Lifecycle tab →
                  </a>
                </span>
              </div>
              <pre
                style={{
                  background: "var(--fm-bg-cool)",
                  border: "1px solid var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-sm)",
                  padding: "12px 14px",
                  fontSize: 12,
                  lineHeight: 1.55,
                  fontFamily: 'ui-monospace, "SF Mono", monospace',
                  maxHeight: 440,
                  overflowY: "auto",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  color: "var(--fm-text-primary)",
                  margin: 0,
                }}
              >
                {preview}
              </pre>
            </>
          )}
        </div>
      )}
    </details>
  );

  // Locked branch — render a static disabled card instead of the
  // collapsible chat. The chat server-action would refuse the write
  // anyway ("only draft and ready-to-publish plans can be edited"),
  // so disabling upfront saves the coach a wasted toast.
  if (isLocked) {
    const isPublishedLock = lockReason === "published";
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div
          style={{
            background: "var(--fm-bg-cool)",
            border: "1px dashed var(--fm-border)",
            borderRadius: "var(--fm-radius-md)",
            padding: "14px 16px",
            opacity: 0.85,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <span style={{ fontSize: 16, opacity: 0.5 }}>💬</span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--fm-text-secondary)",
              }}
            >
              AI assistant
            </span>
            <span
              style={{
                marginLeft: 6,
                padding: "2px 8px",
                background: "rgba(43, 45, 66, 0.08)",
                color: "var(--fm-text-secondary)",
                fontSize: 10,
                fontWeight: 700,
                borderRadius: "var(--fm-radius-pill)",
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}
            >
              disabled · {isPublishedLock ? "published plan" : "archived plan"}
            </span>
          </div>
          <p
            style={{
              fontSize: 12,
              lineHeight: 1.55,
              color: "var(--fm-text-secondary)",
              margin: "0 0 8px",
            }}
          >
            {isPublishedLock
              ? "Only draft plans can be modified by the AI assistant. This plan is published — to make changes, create a draft from it (the assistant will be active on the draft)."
              : "This plan is archived (superseded or revoked) and can't be edited."}
          </p>
          {isPublishedLock && createDraftHref && (
            <a
              href={createDraftHref}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                background: "var(--fm-primary)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                borderRadius: "var(--fm-radius-sm)",
                textDecoration: "none",
              }}
            >
              ↓ Create a follow-up draft
            </a>
          )}
        </div>

        {/* Preview is still useful on a published plan — keep it
            available below the disabled chat card. */}
        {renderPreviewBlock()}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {draftTargetNote && (
        <div
          style={{
            fontSize: 11,
            padding: "6px 10px",
            background: "rgba(110, 76, 200, 0.06)",
            border: "1px solid rgba(110, 76, 200, 0.30)",
            borderRadius: "var(--fm-radius-sm)",
            color: "#5a3fb0",
          }}
        >
          ✎ {draftTargetNote}
        </div>
      )}

      {/* AI assistant */}
      <details
        open={chatOpen}
        onToggle={(e) => setChatOpen((e.target as HTMLDetailsElement).open)}
        style={{
          background: "var(--fm-surface)",
          border: "1px solid var(--fm-border-light)",
          borderRadius: "var(--fm-radius-md)",
          padding: "12px 14px",
        }}
      >
        <summary
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            listStyle: "none",
            outline: "none",
          }}
        >
          <span style={{ fontSize: 16 }}>💬</span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--fm-text-primary)",
            }}
          >
            AI assistant
          </span>
          <span
            style={{
              fontSize: 11,
              color: "var(--fm-text-tertiary)",
              marginLeft: 6,
            }}
          >
            Ask &quot;swap NAC for selenium&quot;, &quot;add ferritin recheck week
            12&quot;, &quot;rewrite the lifestyle section warmer&quot;
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              color: "var(--fm-text-tertiary)",
            }}
          >
            {chatOpen ? "▾ close" : "▸ open"}
          </span>
        </summary>
        {/* Mount the panel lazily so the chat fetch doesn't fire until
            the coach opens it. */}
        {chatOpen && (
          <div style={{ marginTop: 12 }}>
            <PlanChatPanel
              slug={planSlug}
              clientId={clientId}
              isLocked={false}
            />
          </div>
        )}
      </details>

      {/* Plan preview — same renderer used in the locked branch above. */}
      {renderPreviewBlock()}
    </div>
  );
}
