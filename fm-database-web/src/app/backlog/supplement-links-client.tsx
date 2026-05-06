"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  upsertSupplementLink,
  deleteSupplementLink,
  type SupplementLink,
} from "./supplement-links-actions";

const SOURCE_OPTIONS: { value: SupplementLink["source"]; label: string }[] = [
  { value: "amazon", label: "Amazon" },
  { value: "iherb", label: "iHerb" },
  { value: "other", label: "Other" },
];

const SOURCE_BADGE: Record<SupplementLink["source"], string> = {
  amazon: "bg-amber-100 text-amber-800",
  iherb:  "bg-blue-100 text-blue-800",
  other:  "bg-gray-100 text-gray-700",
};

function LinkRow({
  link,
  onDeleted,
}: {
  link: SupplementLink;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(link);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");

  function save() {
    startTransition(async () => {
      const res = await upsertSupplementLink(form);
      if (res.ok) {
        setEditing(false);
        setMsg("Saved ✓");
        setTimeout(() => setMsg(""), 2000);
      } else {
        setMsg(res.error ?? "Error");
      }
    });
  }

  function del() {
    startTransition(async () => {
      await deleteSupplementLink(link.key);
      onDeleted();
    });
  }

  if (editing) {
    return (
      <tr className="border-b">
        <td className="px-3 py-2">
          <Input
            value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            className="h-7 text-sm"
            placeholder="Display name"
          />
        </td>
        <td className="px-3 py-2">
          <Input
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            className="h-7 text-sm font-mono"
            placeholder="https://amzn.to/..."
          />
        </td>
        <td className="px-3 py-2">
          <select
            value={form.source}
            onChange={(e) =>
              setForm({ ...form, source: e.target.value as SupplementLink["source"] })
            }
            className="text-sm border rounded px-2 py-1 bg-background"
          >
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </td>
        <td className="px-3 py-2">
          <Input
            value={form.notes ?? ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="h-7 text-sm"
            placeholder="Optional note"
          />
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <div className="flex gap-1">
            <Button size="sm" onClick={save} disabled={pending} className="h-7 text-xs">
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="h-7 text-xs">
              Cancel
            </Button>
            {msg && <span className="text-xs text-muted-foreground self-center ml-1">{msg}</span>}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b hover:bg-muted/30 group">
      <td className="px-3 py-2 font-medium text-sm">{link.display_name}</td>
      <td className="px-3 py-2">
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline font-mono truncate max-w-xs block"
        >
          {link.url}
        </a>
      </td>
      <td className="px-3 py-2">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SOURCE_BADGE[link.source]}`}>
          {link.source}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{link.notes ?? "—"}</td>
      <td className="px-3 py-2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="h-7 text-xs">
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={del}
            disabled={pending}
            className="h-7 text-xs text-destructive hover:text-destructive"
          >
            {pending ? "…" : "Delete"}
          </Button>
          {msg && <span className="text-xs text-muted-foreground self-center">{msg}</span>}
        </div>
      </td>
    </tr>
  );
}

function AddLinkForm({ onAdded }: { onAdded: () => void }) {
  const blank = (): Omit<SupplementLink, "key"> & { key: string } => ({
    key: "",
    display_name: "",
    url: "",
    source: "amazon",
    notes: "",
  });
  const [form, setForm] = useState(blank());
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");

  function submit() {
    if (!form.display_name || !form.url) {
      setMsg("Name and URL are required");
      return;
    }
    startTransition(async () => {
      // Auto-generate key from display_name if blank
      const key = (form.key || form.display_name)
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
      const res = await upsertSupplementLink({ ...form, key });
      if (res.ok) {
        setForm(blank());
        setOpen(false);
        onAdded();
      } else {
        setMsg(res.error ?? "Error saving");
      }
    });
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="text-xs">
        + Add link
      </Button>
    );
  }

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm">Add affiliate link</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Supplement name *</label>
            <Input
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              placeholder="Slippery Elm"
              className="text-sm h-8"
            />
            <p className="text-[11px] text-muted-foreground">
              Used as the link label in the plan. Also used for matching — make it match how you write the supplement in the plan editor.
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Affiliate / referral URL *</label>
            <Input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://amzn.to/xxxx"
              className="text-sm h-8 font-mono"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Source</label>
            <select
              value={form.source}
              onChange={(e) =>
                setForm({ ...form, source: e.target.value as SupplementLink["source"] })
              }
              className="w-full text-sm border rounded px-2 py-1.5 bg-background"
            >
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Notes (optional)</label>
            <Input
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="e.g. 400mg caps, Himalaya brand"
              className="text-sm h-8"
            />
          </div>
        </div>
        {msg && <p className="text-xs text-destructive">{msg}</p>}
        <div className="flex gap-2">
          <Button size="sm" onClick={submit} disabled={pending} className="text-xs">
            {pending ? "Saving…" : "Save link"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setMsg(""); }} className="text-xs">
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function SupplementLinksClient({
  initialLinks,
}: {
  initialLinks: SupplementLink[];
}) {
  const [links, setLinks] = useState(initialLinks);

  function reload() {
    // Refresh happens via revalidatePath + router refresh; for instant feedback
    // we just trigger a page reload
    window.location.reload();
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          Affiliate or referral links for supplements that aren&apos;t on VitaOne.
          These are used automatically when generating client plan letters — the supplement name
          just needs to contain the keyword you save here.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          <strong>VitaOne</strong> links are already built in — only add supplements here that need a different source (Amazon, iHerb, brand website, etc.).
        </p>
      </div>

      {links.length === 0 ? (
        <div className="text-sm text-muted-foreground border rounded-md p-6 text-center">
          No custom links yet. Add one below — for example, Slippery Elm, Selenium, CoQ10, or any protein powder with an affiliate link.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Supplement</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">URL</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Source</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Notes</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <LinkRow key={l.key} link={l} onDeleted={reload} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddLinkForm onAdded={reload} />
    </div>
  );
}
