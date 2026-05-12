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
import { PlanChatPanel } from "@/app/plans/[slug]/plan-chat-panel";
import { renderPlan, type RenderResult } from "@/app/plans/[slug]/lifecycle-actions";

export interface PlanChatAndPreviewProps {
  clientId: string;
  planSlug: string;
  /** Locked when status is published / superseded / revoked. Chat still
   *  works but the apply-action skips writes. */
  isLocked: boolean;
}

export function PlanChatAndPreview({
  clientId,
  planSlug,
  isLocked,
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

  return (
    <div style={{ display: "grid", gap: 12 }}>
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
              fontSize: 12.5,
              fontWeight: 700,
              color: "var(--fm-text-primary)",
            }}
          >
            AI assistant
          </span>
          <span
            style={{
              fontSize: 10.5,
              color: "var(--fm-text-tertiary)",
              marginLeft: 6,
            }}
          >
            Ask &quot;swap NAC for selenium&quot;, &quot;add ferritin recheck week
            12&quot;, &quot;rewrite the lifestyle section warmer&quot;
          </span>
          {isLocked && (
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
              read-only
            </span>
          )}
          <span
            style={{
              marginLeft: "auto",
              fontSize: 10.5,
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
              isLocked={isLocked}
            />
          </div>
        )}
      </details>

      {/* Plan preview */}
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
              fontSize: 12.5,
              fontWeight: 700,
              color: "var(--fm-text-primary)",
            }}
          >
            Preview as client letter
          </span>
          <span
            style={{
              fontSize: 10.5,
              color: "var(--fm-text-tertiary)",
              marginLeft: 6,
            }}
          >
            What the client sees — slugs translated, mechanisms hidden
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 10.5,
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
                  fontSize: 11.5,
                  color: "var(--fm-text-tertiary)",
                  fontStyle: "italic",
                  padding: "8px 0",
                }}
              >
                Rendering plan as client letter…
              </div>
            )}
            {previewError && (
              <div
                style={{
                  padding: "8px 12px",
                  background: "rgba(231, 76, 60, 0.06)",
                  border: "1px solid rgba(231, 76, 60, 0.25)",
                  borderRadius: "var(--fm-radius-sm)",
                  fontSize: 11.5,
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
                      href={`/plans/${planSlug}?tab=lifecycle`}
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
                    fontSize: 11.5,
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
    </div>
  );
}
