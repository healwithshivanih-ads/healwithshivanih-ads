"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BacklogItem } from "@/lib/fmdb/loader-extras";
import {
  promoteBacklogItem,
  rejectBacklogItem,
  bulkRejectBacklogItems,
  bulkMarkAddedBacklogItems,
  attachBacklogItem,
  type AttachMode,
  type AttachTargetKind,
} from "./actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CatalogueOption {
  slug: string;
  label: string;
  aliases: string[];
}
export interface CatalogueOptions {
  topic: CatalogueOption[];
  mechanism: CatalogueOption[];
  symptom: CatalogueOption[];
  supplement: CatalogueOption[];
  claim: CatalogueOption[];
}

interface SuggestionResult {
  mode: AttachMode;
  targetKind: AttachTargetKind;
  targetSlug: string;
  targetLabel: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KIND_OPTIONS = [
  "topic",
  "mechanism",
  "symptom",
  "supplement",
  "claim",
  "cooking_adjustment",
  "home_remedy",
];

const KINDS_WITH_ALIASES = new Set<AttachTargetKind>([
  "topic",
  "mechanism",
  "symptom",
]);

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseParentLabel(why: string | undefined): string | null {
  // "Surfaced from MindMap '<mm>' under branch '<parent>' (depth N)."
  const m = why?.match(/under branch '([^']+)'/);
  return m?.[1] ?? null;
}

function suggestTarget(
  parentLabel: string | null,
  options: CatalogueOption[]
): string | null {
  if (!parentLabel) return null;
  const needle = parentLabel.toLowerCase().trim();
  // exact label / slug / alias match first
  const exact = options.find(
    (o) =>
      o.label.toLowerCase() === needle ||
      o.slug.toLowerCase() === needle ||
      o.aliases.some((a) => a.toLowerCase() === needle)
  );
  if (exact) return exact.slug;
  // partial — needle contained in label or an alias
  const partial = options.find(
    (o) =>
      o.label.toLowerCase().includes(needle) ||
      o.aliases.some((a) => a.toLowerCase().includes(needle))
  );
  return partial?.slug ?? null;
}

/**
 * Compute a best-guess attach suggestion for a backlog item.
 *
 * Target-kind heuristic  (in priority order):
 *   supplement → supplement, symptom → symptom, mechanism → mechanism, else → topic
 *
 * Mode heuristic:
 *   ≤ 3 words + aliases-capable kind + no verb pattern → alias
 *   everything else → claim
 *
 * Returns null when no matching target entity can be found in the catalogue.
 */
function computeSuggestion(
  item: BacklogItem,
  catalogue: CatalogueOptions
): SuggestionResult | null {
  const parentLabel = parseParentLabel(item.why);

  const targetKind: AttachTargetKind = (() => {
    if (item.kind === "supplement") return "supplement";
    if (item.kind === "symptom") return "symptom";
    if (item.kind === "mechanism") return "mechanism";
    return "topic";
  })();

  const opts = catalogue[targetKind] ?? [];
  const targetSlug = suggestTarget(parentLabel, opts);
  if (!targetSlug) return null;

  const targetLabel =
    opts.find((o) => o.slug === targetSlug)?.label ?? targetSlug;

  // Mode: alias when the name is short + no verb-like pattern + target supports aliases
  const wordCount = item.name.trim().split(/\s+/).length;
  const hasVerbPattern =
    /\b(lowers?|raises?|increases?|decreases?|reduces?|causes?|activates?|inhibits?|promotes?|suppresses?|drives?|triggers?|affects?|modulates?|regulates?|converts?|blocks?|impairs?|enhances?|supports?|stimulates?|depletes?)\b/i.test(
      item.name
    );
  const mode: AttachMode =
    wordCount <= 3 && KINDS_WITH_ALIASES.has(targetKind) && !hasVerbPattern
      ? "alias"
      : "claim";

  return { mode, targetKind, targetSlug, targetLabel };
}

// ---------------------------------------------------------------------------
// PromoteForm
// ---------------------------------------------------------------------------

function PromoteForm({ item }: { item: BacklogItem }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-blue-700 hover:underline">
        Promote
      </summary>
      <form
        action={promoteBacklogItem}
        className="flex flex-wrap gap-1.5 mt-2 items-end p-2 bg-muted/40 rounded"
      >
        <input type="hidden" name="id" value={item.id} />
        <div className="flex flex-col">
          <label className="text-[10px] uppercase text-muted-foreground">
            Kind
          </label>
          <select
            name="kind"
            defaultValue={item.kind}
            className="text-xs border rounded px-1.5 py-1 bg-background"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] uppercase text-muted-foreground">
            Slug
          </label>
          <input
            name="slug"
            defaultValue={slugify(item.name)}
            className="text-xs border rounded px-1.5 py-1 bg-background font-mono w-40"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] uppercase text-muted-foreground">
            Display name
          </label>
          <input
            name="display_name"
            defaultValue={item.name}
            className="text-xs border rounded px-1.5 py-1 bg-background w-48"
          />
        </div>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" name="force" />
          force
        </label>
        <button
          type="submit"
          className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground"
        >
          Confirm
        </button>
      </form>
    </details>
  );
}

// ---------------------------------------------------------------------------
// AttachForm
// Accepts optional override values so the suggestion chip can pre-fill it.
// The `key` prop on AttachForm in BacklogRow forces a remount when overrides
// change, so useState initialises from the new props each time.
// ---------------------------------------------------------------------------

function AttachForm({
  item,
  catalogue,
  initialOpen = false,
  overrideMode,
  overrideTargetKind,
  overrideTargetSlug,
}: {
  item: BacklogItem;
  catalogue: CatalogueOptions;
  initialOpen?: boolean;
  overrideMode?: AttachMode;
  overrideTargetKind?: AttachTargetKind;
  overrideTargetSlug?: string;
}) {
  const parentLabel = parseParentLabel(item.why);
  const [open, setOpen] = useState(initialOpen);
  const [pending, startTransition] = useTransition();

  // Resolve initial state: override props win over heuristic defaults
  const initKind: AttachTargetKind =
    overrideTargetKind ??
    (() => {
      if (item.kind === "supplement") return "supplement";
      if (item.kind === "symptom") return "symptom";
      if (item.kind === "mechanism") return "mechanism";
      return "topic";
    })();

  const initSlug: string =
    overrideTargetSlug ??
    (() => {
      const opts = catalogue[initKind] ?? [];
      return suggestTarget(parentLabel, opts) ?? opts[0]?.slug ?? "";
    })();

  const [mode, setMode] = useState<AttachMode>(overrideMode ?? "claim");
  const [targetKind, setTargetKind] = useState<AttachTargetKind>(initKind);
  const [targetSlug, setTargetSlug] = useState<string>(initSlug);
  const [search, setSearch] = useState<string>("");

  function changeTargetKind(k: AttachTargetKind) {
    setTargetKind(k);
    const opts = catalogue[k] ?? [];
    setTargetSlug(suggestTarget(parentLabel, opts) ?? opts[0]?.slug ?? "");
    setSearch("");
  }

  const options = catalogue[targetKind] ?? [];
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return options.slice(0, 50);
    return options
      .filter(
        (o) =>
          o.slug.toLowerCase().includes(q) ||
          o.label.toLowerCase().includes(q) ||
          o.aliases.some((a) => a.toLowerCase().includes(q))
      )
      .slice(0, 50);
  }, [options, search]);

  const modeIsValid =
    (mode === "alias" && KINDS_WITH_ALIASES.has(targetKind)) ||
    (mode === "notes" && targetKind === "supplement") ||
    (mode === "claim" && targetKind !== "symptom" && targetKind !== "claim");

  function handleAttach() {
    if (!targetSlug) {
      toast.error("pick a target entity first");
      return;
    }
    if (!modeIsValid) {
      toast.error(`mode '${mode}' isn't valid for target kind '${targetKind}'`);
      return;
    }
    startTransition(async () => {
      const r = await attachBacklogItem({
        id: item.id,
        mode,
        target_kind: targetKind,
        target_slug: targetSlug,
      });
      if (r.ok) {
        const verb =
          mode === "claim"
            ? "created claim linked to"
            : mode === "alias"
              ? "added as alias of"
              : "appended to notes of";
        toast.success(`${verb} ${targetKind}/${targetSlug}`);
        setOpen(false);
      } else {
        toast.error(r.error ?? r.stderr ?? "attach failed");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-emerald-700 hover:underline cursor-pointer text-left"
      >
        Attach
      </button>
    );
  }

  return (
    <div className="text-xs space-y-2 mt-2 p-2 bg-emerald-50 border border-emerald-200 rounded">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-emerald-900">Attach</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:underline"
        >
          cancel
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col">
          <label className="text-[10px] uppercase text-muted-foreground">
            Attach as
          </label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as AttachMode)}
            className="text-xs border rounded px-1.5 py-1 bg-background"
          >
            <option value="claim">Claim (statement linked to target)</option>
            <option value="alias">Alias (synonym of target)</option>
            <option value="notes">Notes (append to target)</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] uppercase text-muted-foreground">
            Target kind
          </label>
          <select
            value={targetKind}
            onChange={(e) =>
              changeTargetKind(e.target.value as AttachTargetKind)
            }
            className="text-xs border rounded px-1.5 py-1 bg-background"
          >
            <option value="topic">topic</option>
            <option value="mechanism">mechanism</option>
            <option value="symptom">symptom</option>
            <option value="supplement">supplement</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col">
        <label className="text-[10px] uppercase text-muted-foreground">
          Target entity
          {parentLabel && (
            <span className="ml-1 normal-case text-emerald-700">
              (parent: <em>{parentLabel}</em>)
            </span>
          )}
        </label>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search by name…"
          className="text-xs border rounded px-1.5 py-1 bg-background mb-1"
        />
        <select
          value={targetSlug}
          onChange={(e) => setTargetSlug(e.target.value)}
          size={Math.min(6, Math.max(3, filtered.length))}
          className="text-xs border rounded px-1 py-1 bg-background"
        >
          {filtered.length === 0 && <option value="">(no matches)</option>}
          {filtered.map((o) => (
            <option key={o.slug} value={o.slug}>
              {o.label} ({o.slug})
            </option>
          ))}
        </select>
      </div>

      {!modeIsValid && (
        <div className="text-[11px] text-rose-700">
          {mode === "alias"
            ? "alias mode requires target kind: topic / mechanism / symptom"
            : mode === "notes"
              ? "notes mode currently only supports supplement targets"
              : "claim mode can't link to symptom or claim targets"}
        </div>
      )}

      <button
        type="button"
        onClick={handleAttach}
        disabled={pending || !modeIsValid || !targetSlug}
        className="text-xs px-2 py-1 rounded bg-emerald-700 text-white disabled:opacity-50"
      >
        {pending ? "Attaching…" : "Attach"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RejectForm
// ---------------------------------------------------------------------------

function RejectForm({ item }: { item: BacklogItem }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-rose-700 hover:underline">
        Reject
      </summary>
      <form
        action={rejectBacklogItem}
        className="flex gap-1.5 mt-2 items-end p-2 bg-muted/40 rounded"
      >
        <input type="hidden" name="id" value={item.id} />
        <div className="flex flex-col">
          <label className="text-[10px] uppercase text-muted-foreground">
            Note (optional)
          </label>
          <input
            name="note"
            placeholder="why?"
            className="text-xs border rounded px-1.5 py-1 bg-background w-56"
          />
        </div>
        <button
          type="submit"
          className="text-xs px-2 py-1 rounded bg-destructive text-white"
        >
          Reject
        </button>
      </form>
    </details>
  );
}

// ---------------------------------------------------------------------------
// BacklogRow — isolated component so per-row useState is valid in a loop.
// Holds the "attach trigger" state: when the suggestion chip is clicked, we
// bump `attachKey` (forces AttachForm remount) and set `attachOverride` so
// the form opens pre-filled with the suggested values.
// ---------------------------------------------------------------------------

function BacklogRow({
  item,
  catalogue,
  isSelected,
  onToggle,
}: {
  item: BacklogItem;
  catalogue: CatalogueOptions;
  isSelected: boolean;
  onToggle: (on: boolean) => void;
}) {
  const isOpen = item.status === "open";

  // Precompute suggestion once per render (cheap — pure catalogue lookup)
  const suggestion = useMemo(
    () => computeSuggestion(item, catalogue),
    [item, catalogue]
  );

  // Incrementing the key forces AttachForm to remount with fresh initial state
  const [attachKey, setAttachKey] = useState(0);
  const [attachOverride, setAttachOverride] =
    useState<SuggestionResult | null>(null);

  function applyChip(s: SuggestionResult) {
    setAttachOverride(s);
    setAttachKey((k) => k + 1);
  }

  return (
    <TableRow className={isSelected ? "bg-primary/5" : undefined}>
      {/* Checkbox */}
      <TableCell>
        {isOpen ? (
          <input
            type="checkbox"
            aria-label={`Select ${item.name}`}
            checked={isSelected}
            onChange={(e) => onToggle(e.target.checked)}
          />
        ) : null}
      </TableCell>

      {/* Kind */}
      <TableCell>
        <Badge variant="outline">{item.kind}</Badge>
      </TableCell>

      {/* Name + suggestion chip */}
      <TableCell className="text-sm">
        <div>{item.name}</div>
        {isOpen && suggestion && (
          <button
            type="button"
            title={`Click to pre-fill Attach form: ${suggestion.mode} → ${suggestion.targetKind}/${suggestion.targetSlug}`}
            onClick={() => applyChip(suggestion)}
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:text-emerald-900 hover:underline cursor-pointer"
          >
            <span>💡</span>
            <span className="font-medium">{suggestion.mode}</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-medium">{suggestion.targetLabel}</span>
            <span className="text-muted-foreground">
              ({suggestion.targetKind})
            </span>
          </button>
        )}
      </TableCell>

      {/* Why */}
      <TableCell className="text-xs text-muted-foreground max-w-md">
        <span className="line-clamp-2">{item.why ?? "—"}</span>
      </TableCell>

      {/* Seen */}
      <TableCell className="text-sm">{item.seen_count ?? 1}</TableCell>

      {/* By */}
      <TableCell className="text-xs">{item.suggested_by ?? "—"}</TableCell>

      {/* Created */}
      <TableCell className="text-xs">
        {(item.created_at ?? "").slice(0, 10)}
      </TableCell>

      {/* Actions */}
      <TableCell>
        {isOpen ? (
          <div className="flex flex-col gap-1.5">
            <PromoteForm item={item} />
            <AttachForm
              key={attachKey}
              item={item}
              catalogue={catalogue}
              initialOpen={attachOverride != null}
              overrideMode={attachOverride?.mode}
              overrideTargetKind={attachOverride?.targetKind}
              overrideTargetSlug={attachOverride?.targetSlug}
            />
            <RejectForm item={item} />
          </div>
        ) : (
          <span className="text-xs text-muted-foreground italic">
            {item.status}
            {item.status === "attached" && item.attached_to && (
                <span className="ml-1 text-emerald-700">
                  → {item.attached_to}
                </span>
              )}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// BacklogTableClient — public export
// ---------------------------------------------------------------------------

export function BacklogTableClient({
  items,
  catalogue,
}: {
  items: BacklogItem[];
  catalogue: CatalogueOptions;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNote, setBulkNote] = useState("");
  const [pending, startTransition] = useTransition();

  const selectableIds = useMemo(
    () => items.filter((it) => it.status === "open").map((it) => it.id),
    [items]
  );

  const allVisibleSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selected.has(id));

  function toggleOne(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllVisible(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of selectableIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function handleBulkReject() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      const r = await bulkRejectBacklogItems(ids, bulkNote || null);
      if (r.ok) {
        toast.success(`Rejected ${r.successes.length} item(s)`);
      } else {
        toast.error(
          `Rejected ${r.successes.length}, failed ${r.failures.length}: ${r.failures
            .slice(0, 3)
            .map((f) => f.id)
            .join(", ")}${r.failures.length > 3 ? "…" : ""}`
        );
      }
      clearSelection();
      setBulkNote("");
    });
  }

  function handleBulkMarkAdded() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      const r = await bulkMarkAddedBacklogItems(ids);
      if (r.ok) {
        toast.success(`Marked ${r.successes.length} item(s) as added`);
      } else {
        toast.error(
          `Marked ${r.successes.length}, failed ${r.failures.length}: ${r.failures
            .slice(0, 3)
            .map((f) => f.id)
            .join(", ")}${r.failures.length > 3 ? "…" : ""}`
        );
      }
      clearSelection();
    });
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          No backlog items match.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div className="rounded-md border bg-muted/40 p-3 flex flex-wrap gap-2 items-end sticky top-0 z-10 backdrop-blur">
          <span className="text-sm font-medium self-center">
            {selected.size} selected
          </span>
          <div className="flex flex-col">
            <label className="text-[10px] uppercase text-muted-foreground">
              Reject reason (optional)
            </label>
            <Input
              value={bulkNote}
              onChange={(e) => setBulkNote(e.target.value)}
              placeholder="why?"
              className="text-xs h-8 w-64"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={handleBulkReject}
            disabled={pending}
          >
            {pending ? "Working…" : `🗑 Bulk reject (${selected.size})`}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleBulkMarkAdded}
            disabled={pending}
          >
            {pending
              ? "Working…"
              : `✓ Mark ${selected.size} as added without stub`}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={clearSelection}
            disabled={pending}
          >
            Clear
          </Button>
        </div>
      )}

      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  aria-label="Select all visible"
                  checked={allVisibleSelected}
                  onChange={(e) => toggleAllVisible(e.target.checked)}
                  disabled={selectableIds.length === 0}
                />
              </TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Why</TableHead>
              <TableHead>Seen</TableHead>
              <TableHead>By</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => (
              <BacklogRow
                key={it.id}
                item={it}
                catalogue={catalogue}
                isSelected={selected.has(it.id)}
                onToggle={(on) => toggleOne(it.id, on)}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
