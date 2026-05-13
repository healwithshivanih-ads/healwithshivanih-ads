"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  analyzeCleanupAction,
  applyCleanupGroupAction,
  dismissCleanupGroupAction,
  type CleanupPlan,
  type CleanupGroup,
} from "./actions";

const KIND_META: Record<CleanupGroup["kind"], { label: string; emoji: string; color: string; explainer: string }> = {
  duplicate_topics: {
    label: "Duplicate conditions",
    emoji: "👯",
    color: "border-amber-300 bg-amber-50",
    explainer: "Multiple condition slugs for the same clinical concept. Merge into the canonical — the others become aliases on it so existing references still resolve.",
  },
  topic_is_protocol: {
    label: "Should be a Healing program",
    emoji: "🏥",
    color: "border-violet-300 bg-violet-50",
    explainer: "This is a structured 4–12 week healing path (5R, AIP, Whole30, etc.) — belongs under Healing programs, not Conditions.",
  },
  topic_is_mechanism: {
    label: "Should be a Root cause",
    emoji: "🧬",
    color: "border-blue-300 bg-blue-50",
    explainer: "This is a physiology pattern / driver of dysfunction (e.g. HPA axis dysregulation, leaky gut) — belongs under Root causes, not Conditions.",
  },
  topic_is_symptom: {
    label: "Should be a Symptom",
    emoji: "🤒",
    color: "border-rose-300 bg-rose-50",
    explainer: "This is a client-experienced complaint (bloating, fatigue) — belongs under Symptoms, not Conditions.",
  },
};

interface Props {
  initialPlan: CleanupPlan | null;
}

export function CleanupClient({ initialPlan }: Props) {
  const router = useRouter();
  const [plan, setPlan] = useState<CleanupPlan | null>(initialPlan);
  const [running, startRun] = useTransition();
  const [pending, startApply] = useTransition();
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [canonicalOverride, setCanonicalOverride] = useState<Record<string, string>>({});
  const [kindOverride, setKindOverride] = useState<Record<string, CleanupGroup["kind"]>>({});

  const runAnalyzer = () => {
    startRun(async () => {
      toast.info("Running Haiku across all topics — this takes ~1-2 min…");
      const res = await analyzeCleanupAction({});
      if (res.ok && res.plan) {
        setPlan(res.plan);
        toast.success(`✅ Cleanup plan ready — ${res.plan.groups.length} group${res.plan.groups.length === 1 ? "" : "s"} flagged from ${res.plan.topic_count} topics`);
      } else {
        toast.error(res.error ?? "Analysis failed");
      }
    });
  };

  const applyGroup = (g: CleanupGroup, createStub: boolean = false) => {
    const canonical = canonicalOverride[g.id] ?? g.canonical;
    const kind = kindOverride[g.id] ?? g.kind;
    if (!canonical && kind !== "duplicate_topics") {
      toast.error(`Set a target ${kind.replace("topic_is_", "")} slug first`);
      return;
    }
    startApply(async () => {
      const res = await applyCleanupGroupAction({ ...g, kind, canonical }, false, createStub);
      if (res.ok) {
        const summary = res.summary;
        toast.success(
          `✅ Applied — ${summary?.aliases_added.length ?? 0} aliases added · ${summary?.files_deleted.length ?? 0} files removed`,
        );
        // Remove from local state
        setPlan((p) => p ? { ...p, groups: p.groups.filter((x) => x.id !== g.id) } : p);
        router.refresh();
      } else if (res.needs_stub && res.target_kind && res.target_slug) {
        const proceed = window.confirm(
          `No ${res.target_kind} exists at "${res.target_slug}".\n\n` +
            `Create a minimal stub from the first topic's data and merge?\n\n` +
            `(You can flesh out the stub later in the catalogue editor.)`,
        );
        if (proceed) {
          const res2 = await applyCleanupGroupAction({ ...g, kind, canonical }, false, true);
          if (res2.ok) {
            const summary = res2.summary;
            toast.success(
              `✅ Stub created + merged — ${summary?.aliases_added.length ?? 0} aliases · ${summary?.files_deleted.length ?? 0} files removed`,
            );
            setPlan((p) => p ? { ...p, groups: p.groups.filter((x) => x.id !== g.id) } : p);
            router.refresh();
          } else {
            toast.error(res2.error ?? "Apply failed");
          }
        }
      } else {
        toast.error(res.error ?? "Apply failed");
      }
    });
  };

  const dismissGroup = (g: CleanupGroup) => {
    startApply(async () => {
      const res = await dismissCleanupGroupAction(g.id);
      if (res.ok) {
        toast.success("Dismissed — kept as-is");
        setPlan((p) => p ? { ...p, groups: p.groups.filter((x) => x.id !== g.id) } : p);
      } else {
        toast.error(res.error ?? "Dismiss failed");
      }
    });
  };

  const groupsByKind = (plan?.groups ?? []).reduce<Record<string, CleanupGroup[]>>((acc, g) => {
    (acc[g.kind] ||= []).push(g);
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">🧹 Catalogue cleanup</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Haiku scans all <strong>Conditions</strong> and flags <strong>duplicates</strong> (same concept, different slugs) and <strong>miscategorisations</strong> (entries that are really Healing programs, Root causes, or Symptoms). You review each group and apply with one click — non-canonical slugs become aliases on the canonical, so existing references still resolve.
        </p>
      </div>

      <div className="flex gap-2 items-center">
        <button
          onClick={runAnalyzer}
          disabled={running}
          className="rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          {running ? "⏳ Analysing…" : plan ? "🔄 Re-run analysis" : "▶ Run analysis"}
        </button>
        {plan && (
          <span className="text-xs text-muted-foreground">
            Plan generated {new Date(plan.generated_at).toLocaleString()} · {plan.topic_count} conditions scanned · {plan.groups.length} group{plan.groups.length === 1 ? "" : "s"} remaining
          </span>
        )}
      </div>

      {!plan && (
        <div className="rounded-lg border-2 border-dashed bg-muted/30 p-8 text-center space-y-2">
          <p className="text-sm font-medium">No cleanup plan yet</p>
          <p className="text-xs text-muted-foreground">Click <strong>Run analysis</strong> above to scan all Conditions.</p>
        </div>
      )}

      {plan && plan.groups.length === 0 && (
        <div className="rounded-lg border bg-emerald-50 border-emerald-200 p-6 text-center">
          <p className="text-sm font-medium text-emerald-800">🎉 Catalogue is clean — no duplicates or miscategorisations remaining.</p>
        </div>
      )}

      {/* Groups by kind */}
      {(["duplicate_topics", "topic_is_protocol", "topic_is_mechanism", "topic_is_symptom"] as const).map((kind) => {
        const groups = groupsByKind[kind];
        if (!groups || groups.length === 0) return null;
        const meta = KIND_META[kind];
        return (
          <section key={kind} className="space-y-3">
            <div className="flex items-baseline gap-2 border-b pb-1">
              <h2 className="text-lg font-semibold">
                <span className="mr-2">{meta.emoji}</span>{meta.label}
              </h2>
              <span className="text-xs px-2 py-0.5 rounded bg-muted">{groups.length}</span>
            </div>
            <p className="text-xs text-muted-foreground">{meta.explainer}</p>

            <ul className="space-y-2">
              {groups.map((g) => {
                const isEditing = editingGroup === g.id;
                const effCanonical = canonicalOverride[g.id] ?? g.canonical;
                const effKind = kindOverride[g.id] ?? g.kind;
                const memberSlugs = g.members.filter((m) => m !== effCanonical);
                return (
                  <li key={g.id} className={`rounded-lg border-2 p-3 space-y-2 ${meta.color}`}>
                    <p className="text-xs italic text-muted-foreground">{g.reason}</p>

                    {isEditing && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold">Group kind:</span>
                        <select
                          value={effKind}
                          onChange={(e) =>
                            setKindOverride((o) => ({ ...o, [g.id]: e.target.value as CleanupGroup["kind"] }))
                          }
                          className="px-2 py-0.5 rounded border text-xs bg-white"
                        >
                          <option value="duplicate_topics">Duplicate conditions</option>
                          <option value="topic_is_protocol">Should be a Healing program</option>
                          <option value="topic_is_mechanism">Should be a Root cause</option>
                          <option value="topic_is_symptom">Should be a Symptom</option>
                        </select>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold">
                        {effKind === "duplicate_topics" ? "Canonical:" : "Target slug:"}
                      </span>
                      {isEditing ? (
                        <input
                          value={effCanonical}
                          onChange={(e) =>
                            setCanonicalOverride((o) => ({ ...o, [g.id]: e.target.value }))
                          }
                          className="px-2 py-0.5 rounded border text-xs font-mono"
                          placeholder={kind === "duplicate_topics" ? "<topic-slug>" : `<${kind.replace("topic_is_", "")}-slug>`}
                        />
                      ) : (
                        <code className="px-2 py-0.5 rounded bg-white border font-mono">
                          {effCanonical || <span className="text-red-600 italic">(missing — click Edit)</span>}
                        </code>
                      )}
                      <button
                        onClick={() => setEditingGroup(isEditing ? null : g.id)}
                        className="text-[10px] underline text-muted-foreground hover:text-foreground"
                      >
                        {isEditing ? "Done" : "Edit"}
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-semibold mr-1">
                        {kind === "duplicate_topics" ? "Merge in:" : "Remove from topics:"}
                      </span>
                      {memberSlugs.length === 0 ? (
                        <span className="text-muted-foreground italic">(none — only canonical)</span>
                      ) : (
                        memberSlugs.map((m) => (
                          <Link
                            key={m}
                            href={`/catalogue/topics/${m}`}
                            target="_blank"
                            className="px-1.5 py-0.5 rounded bg-white border font-mono text-[11px] hover:underline"
                          >
                            {m} ↗
                          </Link>
                        ))
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        disabled={pending || (!effCanonical && kind !== "duplicate_topics")}
                        onClick={() => applyGroup(g)}
                        className="px-3 py-1.5 rounded text-xs bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        ✓ Apply
                      </button>
                      <button
                        disabled={pending}
                        onClick={() => dismissGroup(g)}
                        className="px-3 py-1.5 rounded text-xs border hover:bg-muted disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
