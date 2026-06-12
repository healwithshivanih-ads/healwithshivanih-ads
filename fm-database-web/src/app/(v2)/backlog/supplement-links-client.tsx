"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  upsertSupplementLink,
  deleteSupplementLink,
  type SupplementLink,
  type ProductCategory,
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

const CATEGORY_OPTIONS: { value: ProductCategory; label: string; hint: string }[] = [
  { value: "supplement", label: "💊 Supplement", hint: "vitamins, herbs, minerals" },
  { value: "food",       label: "🥗 Food / pantry", hint: "protein powder, ghee, organic grains, kombucha cultures" },
  { value: "device",     label: "🔦 Device", hint: "infrared red-light, PEMF mat, blue-blockers, Oura ring" },
  { value: "other",      label: "📦 Other",  hint: "anything else" },
];

const CATEGORY_BADGE: Record<ProductCategory, string> = {
  supplement: "bg-emerald-50 text-emerald-800 border-emerald-200",
  food:       "bg-rose-50 text-rose-800 border-rose-200",
  device:     "bg-indigo-50 text-indigo-800 border-indigo-200",
  other:      "bg-slate-50 text-slate-700 border-slate-200",
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
          <select
            value={form.category}
            onChange={(e) =>
              setForm({ ...form, category: e.target.value as ProductCategory })
            }
            className="text-sm border rounded px-2 py-1 bg-background"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
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
      <td className="px-3 py-2">
        <div className="font-medium text-sm">{link.display_name}</div>
        {link.aliases && link.aliases.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {link.aliases.map((a) => (
              <span key={a} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">{a}</span>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${CATEGORY_BADGE[link.category]}`}>
          {CATEGORY_OPTIONS.find((c) => c.value === link.category)?.label ?? link.category}
        </span>
      </td>
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
    category: "supplement",
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
        <CardTitle className="text-sm">Add product link</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Product name *</label>
            <Input
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              placeholder="Slippery Elm / WPI Protein / Hooga red light…"
              className="text-sm h-8"
            />
            <p className="text-[11px] text-muted-foreground">
              Used as the link label in plans + the matching key — keep it close to how you write the product in protocols.
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Category *</label>
            <select
              value={form.category}
              onChange={(e) =>
                setForm({ ...form, category: e.target.value as ProductCategory })
              }
              className="w-full text-sm border rounded px-2 py-1.5 bg-background"
            >
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              {CATEGORY_OPTIONS.find((c) => c.value === form.category)?.hint}
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
  const [query, setQuery] = useState("");
  const [filterCat, setFilterCat] = useState<ProductCategory | "">("");
  const [filterSource, setFilterSource] = useState<SupplementLink["source"] | "">("");

  function reload() {
    window.location.reload();
  }

  const q = query.toLowerCase().trim();
  const visible = links.filter((l) => {
    if (filterCat && l.category !== filterCat) return false;
    if (filterSource && l.source !== filterSource) return false;
    if (!q) return true;
    return (
      l.display_name.toLowerCase().includes(q) ||
      l.key.toLowerCase().includes(q) ||
      (l.aliases ?? []).some((a) => a.toLowerCase().includes(q)) ||
      (l.notes ?? "").toLowerCase().includes(q) ||
      l.url.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          Affiliate / referral links for any <strong>supplement, food, device, or product</strong>{" "}
          you reference in client plans. Auto-substituted into the letter
          when the matched name appears — protein powders, organic grains,
          red-light panels, ghee, anything.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          <strong>VitaOne</strong> and <strong>FM Nutrition</strong> products are already built in — only add products here that need a different source.
        </p>
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            width={14} height={14} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${links.length} products…`}
            className="w-full pl-8 pr-3 h-8 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
            >
              ✕
            </button>
          )}
        </div>
        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value as ProductCategory | "")}
          className="text-sm border rounded-md px-2 h-8 bg-background"
        >
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value as SupplementLink["source"] | "")}
          className="text-sm border rounded-md px-2 h-8 bg-background"
        >
          <option value="">All sources</option>
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {(query || filterCat || filterSource) && (
          <span className="text-xs text-muted-foreground">
            {visible.length} of {links.length}
          </span>
        )}
      </div>

      {links.length === 0 ? (
        <div className="text-sm text-muted-foreground border rounded-md p-6 text-center">
          No custom links yet. Add one below — supplements, foods (protein powder / organic grains), devices (infrared, Oura, blue blockers), or anything else with an affiliate URL.
        </div>
      ) : visible.length === 0 ? (
        <div className="text-sm text-muted-foreground border rounded-md p-6 text-center">
          No products match <strong>{query}</strong>
          {filterCat && <> in <strong>{filterCat}</strong></>}
          {filterSource && <> from <strong>{filterSource}</strong></>}.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Product</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Category</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">URL</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Source</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Notes</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => (
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
