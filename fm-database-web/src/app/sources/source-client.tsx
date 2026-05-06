"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveSourceAction } from "./actions";

const SOURCE_TYPES = [
  "internal_skill",
  "peer_reviewed_paper",
  "textbook",
  "clinical_guideline",
  "expert_consensus",
  "book",
  "website",
  "llm_synthesis",
  "other",
] as const;

const SOURCE_QUALITIES = ["high", "moderate", "low"] as const;

export function SourceClient() {
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [quality, setQuality] = useState("");
  const [authors, setAuthors] = useState("");
  const [year, setYear] = useState("");
  const [publisher, setPublisher] = useState("");
  const [url, setUrl] = useState("");
  const [doi, setDoi] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  async function handleSave() {
    if (!id || !title || !sourceType || !quality) {
      toast.error("ID, title, type, and quality are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await saveSourceAction({
        id,
        title,
        source_type: sourceType,
        quality,
        authors: authors ? authors.split(",").map((s) => s.trim()).filter(Boolean) : [],
        year: year ? parseInt(year, 10) : null,
        publisher: publisher || undefined,
        url: url || undefined,
        doi: doi || undefined,
        notes: notes || undefined,
      });
      if (res.ok) {
        setSaved(res.id ?? id);
        toast.success(`Source "${res.id}" saved to catalogue`);
      } else {
        toast.error(res.error ?? "Save failed");
      }
    } catch (err) {
      toast.error(`Error: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <Card className="border-green-500/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">✅ Source saved</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Badge variant="outline" className="font-mono text-xs">sources/{saved}</Badge>
          <p className="text-xs text-muted-foreground">
            View at{" "}
            <a href={`/catalogue/sources/${saved}`} className="underline text-primary">
              /catalogue/sources/{saved}
            </a>
          </p>
          <Button variant="outline" size="sm" onClick={() => {
            setSaved(null); setId(""); setTitle(""); setSourceType(""); setQuality("");
            setAuthors(""); setYear(""); setPublisher(""); setUrl(""); setDoi(""); setNotes("");
          }}>
            Add another source
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">New source entity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Register a book, paper, website, or other reference so claims can cite it.
          The ID must be unique — use a short slug like <code className="font-mono bg-muted px-1 rounded">dr-smith-fm-book-2023</code>.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Source ID *</label>
            <Input
              value={id}
              onChange={(e) => setId(e.target.value.replace(/\s+/g, "-").toLowerCase())}
              placeholder="e.g. thyroid-reset-diet-2023"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Title *</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. The Thyroid Reset Diet"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Type *</label>
            <Select value={sourceType} onValueChange={(v) => v && setSourceType(v)}>
              <SelectTrigger><SelectValue placeholder="Select type…" /></SelectTrigger>
              <SelectContent>
                {SOURCE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Quality *</label>
            <Select value={quality} onValueChange={(v) => v && setQuality(v)}>
              <SelectTrigger><SelectValue placeholder="Select quality…" /></SelectTrigger>
              <SelectContent>
                {SOURCE_QUALITIES.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Author(s) (comma-separated)</label>
            <Input
              value={authors}
              onChange={(e) => setAuthors(e.target.value)}
              placeholder="e.g. Alan Christianson"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Year</label>
            <Input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="2023"
              min={1900}
              max={2099}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Publisher</label>
            <Input
              value={publisher}
              onChange={(e) => setPublisher(e.target.value)}
              placeholder="e.g. Rodale Books"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">URL</label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              type="url"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">DOI</label>
          <Input
            value={doi}
            onChange={(e) => setDoi(e.target.value)}
            placeholder="10.xxxx/…"
            className="font-mono text-sm"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">Notes</label>
          <textarea
            className="w-full min-h-[60px] text-sm border rounded-md p-2 bg-background resize-y"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any coaching notes about this source…"
          />
        </div>

        <Button
          onClick={handleSave}
          disabled={saving || !id || !title || !sourceType || !quality}
          className="w-full"
        >
          {saving ? "Saving…" : "💾 Save source to catalogue"}
        </Button>
      </CardContent>
    </Card>
  );
}
