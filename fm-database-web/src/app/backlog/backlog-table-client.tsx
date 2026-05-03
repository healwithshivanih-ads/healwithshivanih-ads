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
} from "./actions";

const KIND_OPTIONS = [
  "topic",
  "mechanism",
  "symptom",
  "supplement",
  "claim",
  "cooking_adjustment",
  "home_remedy",
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

export function BacklogTableClient({ items }: { items: BacklogItem[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNote, setBulkNote] = useState("");
  const [pending, startTransition] = useTransition();

  // Only "open" rows are selectable — bulk actions are no-ops on
  // already-handled items, and we surface that by hiding their checkbox.
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
      {/* Bulk action toolbar — only renders when at least one row is selected. */}
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
            {pending ? "Working…" : `✓ Mark ${selected.size} as added without stub`}
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
            {items.map((it) => {
              const isOpen = it.status === "open";
              const isSelected = selected.has(it.id);
              return (
                <TableRow
                  key={it.id}
                  className={isSelected ? "bg-primary/5" : undefined}
                >
                  <TableCell>
                    {isOpen ? (
                      <input
                        type="checkbox"
                        aria-label={`Select ${it.name}`}
                        checked={isSelected}
                        onChange={(e) => toggleOne(it.id, e.target.checked)}
                      />
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{it.kind}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{it.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md">
                    <span className="line-clamp-2">{it.why ?? "—"}</span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {it.seen_count ?? 1}
                  </TableCell>
                  <TableCell className="text-xs">
                    {it.suggested_by ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {(it.created_at ?? "").slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    {isOpen ? (
                      <div className="flex flex-col gap-1.5">
                        <PromoteForm item={it} />
                        <RejectForm item={it} />
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">
                        {it.status}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
