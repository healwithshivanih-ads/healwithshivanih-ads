"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { reclassifyEntityAction, type ReclassifyInput } from "./actions";
import { KIND_LABELS, type CatalogueKind } from "@/lib/fmdb/kinds";

interface Props {
  kind: string;
  slug: string;
  /** Optional list of slugs already present in each kind — used to populate
   *  the autocomplete for merge target. Kept small (slug + display only) so
   *  the page render cost stays manageable. */
  knownEntities?: Partial<Record<CatalogueKind, Array<{ slug: string; display_name?: string }>>>;
}

const MOVEABLE_KINDS: CatalogueKind[] = [
  "topics",
  "mechanisms",
  "symptoms",
  "supplements",
  "protocols",
  "cooking_adjustments",
  "home_remedies",
];

const MERGE_INTO_KINDS: CatalogueKind[] = [
  "topics",
  "mechanisms",
  "symptoms",
  "supplements",
  "protocols",
];

export function ReclassifyPanel({ kind, slug, knownEntities }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"move" | "merge" | "delete">("move");
  const [pending, start] = useTransition();

  // move state
  const [targetKind, setTargetKind] = useState<string>(MOVEABLE_KINDS.find((k) => k !== kind) ?? "topics");

  // merge state
  const [mergeKind, setMergeKind] = useState<string>(kind);
  const [mergeSearch, setMergeSearch] = useState<string>("");
  const [mergeSlug, setMergeSlug] = useState<string>("");

  // confirmation state for delete + irreversible move (no existing target)
  const [confirmText, setConfirmText] = useState("");

  const currentKindLabel = KIND_LABELS[kind as CatalogueKind]?.singular ?? kind;

  const handleRun = async (overrideCreateStub = false) => {
    let input: ReclassifyInput;
    if (mode === "move") {
      if (!targetKind) {
        toast.error("Pick a target kind");
        return;
      }
      input = {
        action: "move",
        source_kind: kind,
        source_slug: slug,
        target_kind: targetKind,
        create_stub: overrideCreateStub,
      };
    } else if (mode === "merge") {
      if (!mergeKind || !mergeSlug) {
        toast.error("Pick the canonical entity to merge into");
        return;
      }
      input = {
        action: "merge",
        source_kind: kind,
        source_slug: slug,
        merge_into_kind: mergeKind,
        merge_into_slug: mergeSlug,
      };
    } else {
      if (confirmText.trim() !== slug) {
        toast.error(`Type the slug "${slug}" to confirm deletion`);
        return;
      }
      input = {
        action: "delete",
        source_kind: kind,
        source_slug: slug,
      };
    }

    start(async () => {
      const res = await reclassifyEntityAction(input);
      if (res.ok) {
        const s = res.summary;
        toast.success(
          `✅ ${mode === "move" ? "Moved" : mode === "merge" ? "Merged" : "Deleted"} — ` +
            `${s?.aliases_added.length ?? 0} aliases added · ${s?.files_deleted.length ?? 0} files removed`,
        );
        if (mode === "move" && targetKind) {
          router.push(`/catalogue/${targetKind}/${slug}`);
        } else if (mode === "merge" && mergeKind && mergeSlug) {
          router.push(`/catalogue/${mergeKind}/${mergeSlug}`);
        } else {
          router.push("/catalogue");
        }
        router.refresh();
      } else if (res.needs_stub && res.target_kind && res.target_slug) {
        const proceed = window.confirm(
          `No ${res.target_kind}/${res.target_slug} exists yet.\n\n` +
            `Create a minimal stub from this entity's display name + summary and move?\n\n` +
            `(You can flesh out kind-specific fields later in the catalogue editor.)`,
        );
        if (proceed) {
          await handleRun(true);
        }
      } else {
        toast.error(res.error ?? "Reclassify failed");
      }
    });
  };

  const candidates = (knownEntities?.[mergeKind as CatalogueKind] ?? []).filter((e) => {
    if (e.slug === slug && mergeKind === kind) return false; // can't merge into self
    if (!mergeSearch.trim()) return true;
    const q = mergeSearch.toLowerCase();
    return (
      e.slug.toLowerCase().includes(q) ||
      (e.display_name ?? "").toLowerCase().includes(q)
    );
  }).slice(0, 50);

  if (!open) {
    return (
      <div className="mt-8 pt-4 border-t border-dashed border-amber-200">
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-amber-800 hover:text-amber-900 border border-amber-300 rounded px-3 py-1.5 bg-amber-50 hover:bg-amber-100"
        >
          🔧 Reclassify · merge · delete this {currentKindLabel.toLowerCase()}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-lg border-2 border-amber-200 bg-amber-50/40 p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-amber-900">
          🔧 Reclassify · merge · delete
        </h3>
        <button
          onClick={() => { setOpen(false); setConfirmText(""); }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>

      <p className="text-xs text-amber-800 leading-relaxed">
        <strong>Move</strong> changes this entry&apos;s kind (e.g. miscategorised condition → root cause).
        Aliases preserved; old refs still resolve. <strong>Merge</strong> folds this entry into another canonical
        entity. <strong>Delete</strong> removes it; cross-refs become non-blocking warnings.
      </p>

      <div className="flex gap-1.5 text-xs">
        {(["move", "merge", "delete"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1 rounded border ${
              mode === m
                ? "bg-amber-600 text-white border-amber-700"
                : "bg-white text-amber-800 border-amber-200 hover:bg-amber-100"
            }`}
          >
            {m === "move" ? "Move to kind" : m === "merge" ? "Merge into…" : "Delete"}
          </button>
        ))}
      </div>

      {mode === "move" && (
        <div className="space-y-2 text-xs">
          <label className="block">
            <span className="font-semibold text-amber-900">Move to:</span>
            <select
              value={targetKind}
              onChange={(e) => setTargetKind(e.target.value)}
              className="ml-2 px-2 py-1 rounded border bg-white"
            >
              {MOVEABLE_KINDS.filter((k) => k !== kind).map((k) => {
                const meta = KIND_LABELS[k];
                return (
                  <option key={k} value={k}>
                    {meta.emoji} {meta.singular}
                  </option>
                );
              })}
            </select>
          </label>
          <p className="text-[11px] text-muted-foreground italic">
            If <code className="font-mono">{targetKind}/{slug}</code> doesn&apos;t exist yet, you&apos;ll be asked to
            confirm creation of a minimal stub seeded from this entry&apos;s name + summary.
          </p>
        </div>
      )}

      {mode === "merge" && (
        <div className="space-y-2 text-xs">
          <label className="block">
            <span className="font-semibold text-amber-900">Merge into kind:</span>
            <select
              value={mergeKind}
              onChange={(e) => { setMergeKind(e.target.value); setMergeSlug(""); }}
              className="ml-2 px-2 py-1 rounded border bg-white"
            >
              {MERGE_INTO_KINDS.map((k) => {
                const meta = KIND_LABELS[k];
                return (
                  <option key={k} value={k}>{meta.emoji} {meta.plural}</option>
                );
              })}
            </select>
          </label>
          <label className="block">
            <span className="font-semibold text-amber-900">Search canonical:</span>
            <input
              value={mergeSearch}
              onChange={(e) => setMergeSearch(e.target.value)}
              placeholder="type slug or display name…"
              className="ml-2 px-2 py-1 rounded border bg-white w-64"
            />
          </label>
          <div className="max-h-40 overflow-y-auto rounded border bg-white">
            {candidates.length === 0 ? (
              <p className="px-2 py-3 text-muted-foreground italic">
                {mergeSearch ? "no matches" : "type to search"}
              </p>
            ) : (
              <ul>
                {candidates.map((e) => (
                  <li key={e.slug}>
                    <button
                      onClick={() => setMergeSlug(e.slug)}
                      className={`w-full text-left px-2 py-1 hover:bg-amber-50 ${
                        mergeSlug === e.slug ? "bg-amber-100 font-semibold" : ""
                      }`}
                    >
                      <code className="font-mono text-[10px]">{e.slug}</code>
                      {e.display_name && (
                        <span className="ml-2 text-muted-foreground">{e.display_name}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {mergeSlug && (
            <p className="text-[11px]">
              Will absorb this entry into <code className="font-mono">{mergeKind}/{mergeSlug}</code>;
              <span className="font-mono"> {slug}</span> becomes an alias on the canonical.
            </p>
          )}
        </div>
      )}

      {mode === "delete" && (
        <div className="space-y-2 text-xs">
          <p className="text-red-700">
            ⚠ Hard-delete <code className="font-mono">{kind}/{slug}</code>. References elsewhere
            become non-blocking <em>warnings</em>, not errors — but they won&apos;t auto-redirect.
          </p>
          <label className="block">
            <span className="font-semibold text-red-800">Type the slug to confirm:</span>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={slug}
              className="ml-2 px-2 py-1 rounded border bg-white font-mono w-72"
            />
          </label>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-amber-200">
        <button
          disabled={pending}
          onClick={() => handleRun(false)}
          className={`px-4 py-1.5 rounded text-xs text-white ${
            mode === "delete"
              ? "bg-red-600 hover:bg-red-700"
              : "bg-amber-600 hover:bg-amber-700"
          } disabled:opacity-50`}
        >
          {pending ? "⏳ Running…" : mode === "move" ? "✓ Move" : mode === "merge" ? "✓ Merge" : "🗑 Delete"}
        </button>
      </div>
    </div>
  );
}
