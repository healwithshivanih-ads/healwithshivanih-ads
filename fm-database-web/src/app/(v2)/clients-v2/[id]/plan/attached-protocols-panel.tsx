"use client";

/**
 * AttachedProtocolsPanel — surfaces the FM Protocol(s) (5R gut, AIP,
 * Whole30, low-FODMAP, weight-loss-metabolic-reset, etc.) attached to
 * the active plan, and lets the coach edit them inline when the plan
 * is still a draft.
 *
 * When status !== "draft" the panel is read-only — published plans are
 * frozen; to change attached_protocols the coach revokes + supersedes.
 *
 * Persists via `updatePlan(slug, { attached_protocols })`.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { FmPanel } from "@/components/fm";
import { updatePlan } from "@/lib/server-actions/plans";

interface ProtocolMeta {
  slug: string;
  display_name?: string;
  category?: string;
  summary?: string;
}

interface Props {
  planSlug: string;
  attached: string[];
  allProtocols: ProtocolMeta[];
  locked: boolean;
}

const CATEGORY_LABEL: Record<string, string> = {
  gut_healing: "Gut healing",
  elimination_diet: "Elimination diet",
  hormone_balance: "Hormone balance",
  metabolic_reset: "Metabolic reset",
  adrenal_recovery: "Adrenal recovery",
  detox_liver_support: "Liver / detox",
  anti_inflammatory: "Anti-inflammatory",
  mitochondrial_support: "Mitochondrial",
  thyroid_optimization: "Thyroid",
  blood_sugar_regulation: "Blood sugar",
};

function pretty(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AttachedProtocolsPanel({
  planSlug,
  attached,
  allProtocols,
  locked,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(attached);

  const byCategory = allProtocols.reduce<Record<string, ProtocolMeta[]>>(
    (acc, p) => {
      const cat = p.category ?? "other";
      (acc[cat] ??= []).push(p);
      return acc;
    },
    {},
  );

  const toggle = (slug: string) => {
    setDraft((d) =>
      d.includes(slug) ? d.filter((s) => s !== slug) : [...d, slug],
    );
  };

  const save = () => {
    start(async () => {
      const r = await updatePlan(planSlug, {
        attached_protocols: draft,
      } as unknown as Parameters<typeof updatePlan>[1]);
      if (r.ok) {
        toast.success(
          draft.length === 0
            ? "Protocols detached"
            : `Attached ${draft.length} protocol${draft.length === 1 ? "" : "s"}`,
        );
        setEditing(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Save failed");
      }
    });
  };

  const cancel = () => {
    setDraft(attached);
    setEditing(false);
  };

  const attachedMeta = attached
    .map((slug) => allProtocols.find((p) => p.slug === slug) ?? { slug })
    .filter(Boolean) as ProtocolMeta[];

  return (
    <FmPanel
      title={
        attached.length > 0
          ? `🧭 Healing programs (${attached.length})`
          : "🧭 Healing programs"
      }
      subtitle={
        attached.length > 0
          ? "The FM protocol(s) this plan is anchored to. Letter generation references these as the spine."
          : "Attach a structured FM healing program (5R Gut, AIP, Whole30, etc.) to anchor the plan and letters."
      }
      rightSlot={
        !locked && !editing ? (
          <button
            onClick={() => setEditing(true)}
            style={{
              fontSize: 11,
              color: "var(--fm-primary)",
              textDecoration: "underline",
              cursor: "pointer",
              background: "transparent",
              border: 0,
              fontFamily: "inherit",
            }}
          >
            ✏️ {attached.length > 0 ? "Edit" : "Attach"}
          </button>
        ) : locked && attached.length === 0 ? (
          <span
            style={{
              fontSize: 11,
              color: "var(--fm-text-tertiary)",
              fontStyle: "italic",
            }}
          >
            Plan is {locked ? "locked" : "editable"}
          </span>
        ) : undefined
      }
    >
      {/* ── Read-only display ─────────────────────────────────────── */}
      {!editing && attached.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          {attachedMeta.map((p) => (
            <Link
              key={p.slug}
              href={`/catalogue/protocols/${p.slug}`}
              style={{
                display: "block",
                padding: "10px 12px",
                background: "var(--fm-bg-cool)",
                border: "1px solid var(--fm-border)",
                borderRadius: "var(--fm-radius-sm)",
                textDecoration: "none",
                color: "var(--fm-text-primary)",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>
                  {p.display_name ?? pretty(p.slug)}
                </span>
                {p.category && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 6px",
                      background: "var(--fm-surface)",
                      border: "1px solid var(--fm-border-light)",
                      borderRadius: "var(--fm-radius-pill)",
                      color: "var(--fm-text-secondary)",
                    }}
                  >
                    {CATEGORY_LABEL[p.category] ?? p.category}
                  </span>
                )}
              </div>
              {p.summary && (
                <p
                  style={{
                    fontSize: 11.5,
                    color: "var(--fm-text-secondary)",
                    margin: "4px 0 0",
                    lineHeight: 1.4,
                  }}
                >
                  {p.summary}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* ── Empty state, read-only ────────────────────────────────── */}
      {!editing && attached.length === 0 && (
        <p
          style={{
            fontSize: 12,
            color: "var(--fm-text-tertiary)",
            fontStyle: "italic",
            margin: 0,
          }}
        >
          No protocol attached yet.
          {locked
            ? " To attach one, create a successor draft."
            : " Click Attach above to pick one."}
        </p>
      )}

      {/* ── Edit mode ─────────────────────────────────────────────── */}
      {editing && (
        <div style={{ display: "grid", gap: 12 }}>
          {Object.keys(byCategory)
            .sort()
            .map((cat) => (
              <div key={cat}>
                <div
                  style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    fontWeight: 700,
                    color: "var(--fm-text-tertiary)",
                    marginBottom: 6,
                  }}
                >
                  {CATEGORY_LABEL[cat] ?? cat.replace(/_/g, " ")}
                </div>
                <div style={{ display: "grid", gap: 4 }}>
                  {byCategory[cat].map((p) => {
                    const isOn = draft.includes(p.slug);
                    return (
                      <label
                        key={p.slug}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                          padding: "8px 10px",
                          background: isOn
                            ? "rgba(20, 83, 45, 0.06)"
                            : "var(--fm-surface)",
                          border: `1px solid ${
                            isOn ? "var(--fm-primary)" : "var(--fm-border)"
                          }`,
                          borderRadius: "var(--fm-radius-sm)",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isOn}
                          onChange={() => toggle(p.slug)}
                          disabled={pending}
                          style={{ marginTop: 2 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                            {p.display_name ?? pretty(p.slug)}
                          </div>
                          {p.summary && (
                            <p
                              style={{
                                fontSize: 11,
                                color: "var(--fm-text-secondary)",
                                margin: "2px 0 0",
                                lineHeight: 1.4,
                              }}
                            >
                              {p.summary}
                            </p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={cancel}
              disabled={pending}
              style={{
                fontSize: 12,
                padding: "6px 12px",
                background: "transparent",
                border: "1px solid var(--fm-border)",
                borderRadius: "var(--fm-radius-sm)",
                cursor: pending ? "wait" : "pointer",
                fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={pending}
              style={{
                fontSize: 12,
                padding: "6px 12px",
                background: "var(--fm-primary)",
                color: "#fff",
                border: 0,
                borderRadius: "var(--fm-radius-sm)",
                cursor: pending ? "wait" : "pointer",
                fontWeight: 700,
                fontFamily: "inherit",
              }}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </FmPanel>
  );
}
