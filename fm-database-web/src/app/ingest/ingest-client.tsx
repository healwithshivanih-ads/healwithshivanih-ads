"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import {
  runIngestAction,
  reviewBatchAction,
  approveBatchAction,
  rejectBatchAction,
  listBatchesAction,
  approveAllPendingAction,
  countPendingBatchesAction,
  getBatchStatusAction,
  listStagedEntitiesAction,
  patchStagedEntityAction,
  saveSourceAction,
  checkCoachKnowledgeAction,
  runCoachKnowledgeAction,
} from "./actions";
import type { CatalogueRelated, StagedEntity } from "./actions";

const SOURCE_TYPES = [
  "internal_skill", "peer_reviewed_paper", "textbook", "clinical_guideline",
  "expert_consensus", "book", "website", "llm_synthesis", "other",
];
const QUALITY_OPTS = ["high", "moderate", "low"];

// ── Enrich staged entities (add cross-links before approving) ────────────────

const LINK_FIELDS: { key: keyof StagedEntity; label: string }[] = [
  { key: "linked_to_topics",      label: "Topics" },
  { key: "linked_to_mechanisms",  label: "Mechanisms" },
  { key: "linked_to_supplements", label: "Supplements" },
  { key: "linked_to_claims",      label: "Claims" },
];

function EnrichEntityRow({ batchId, entity, onSaved }: {
  batchId: string;
  entity: StagedEntity;
  onSaved: (slug: string) => void;
}) {
  const [open,    setOpen]    = useState(false);
  const [inputs,  setInputs]  = useState<Record<string, string>>({
    linked_to_topics:      (entity.linked_to_topics ?? []).join(", "),
    linked_to_mechanisms:  (entity.linked_to_mechanisms ?? []).join(", "),
    linked_to_supplements: (entity.linked_to_supplements ?? []).join(", "),
    linked_to_claims:      (entity.linked_to_claims ?? []).join(", "),
    notes_for_coach:       entity.notes_for_coach ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const patch: Record<string, string[] | string> = {};
    for (const { key } of LINK_FIELDS) {
      const val = inputs[key as string] ?? "";
      const slugs = val.split(",").map((s) => s.trim()).filter(Boolean);
      if (slugs.length) patch[key as string] = slugs;
    }
    if (inputs.notes_for_coach?.trim()) patch.notes_for_coach = inputs.notes_for_coach.trim();

    const r = await patchStagedEntityAction(batchId, entity.entity, entity.slug, patch as Parameters<typeof patchStagedEntityAction>[3]);
    setSaving(false);
    if (r.ok) {
      setSaved(true);
      toast.success(`Links saved for ${entity.slug}`);
      onSaved(entity.slug);
      setTimeout(() => setSaved(false), 3000);
    } else {
      toast.error(r.error ?? "Save failed");
    }
  }, [batchId, entity, inputs, onSaved]);

  return (
    <div className="rounded-lg border bg-background text-sm">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono text-muted-foreground">{entity.entity}</span>
        <span className="font-medium text-sm">{entity.display_name}</span>
        <span className="text-[10px] text-muted-foreground font-mono ml-0.5">({entity.slug})</span>
        {(entity.linked_to_topics.length + entity.linked_to_mechanisms.length) > 0 && (
          <span className="text-[10px] text-emerald-700 ml-auto">
            {entity.linked_to_topics.length + entity.linked_to_mechanisms.length} links
          </span>
        )}
        <span className="text-muted-foreground ml-auto">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t pt-2">
          {LINK_FIELDS.map(({ key, label }) => (
            <div key={key as string}>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground block mb-0.5">
                {label} <span className="normal-case font-normal">(comma-separated slugs)</span>
              </label>
              <input
                type="text"
                value={inputs[key as string] ?? ""}
                onChange={(e) => setInputs(p => ({ ...p, [key as string]: e.target.value }))}
                placeholder={`e.g. insulin-resistance, blood-sugar-dysregulation`}
                className="w-full rounded border px-2 py-1.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary/40 font-mono"
              />
            </div>
          ))}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground block mb-0.5">
              Notes for coach
            </label>
            <textarea
              value={inputs.notes_for_coach ?? ""}
              onChange={(e) => setInputs(p => ({ ...p, notes_for_coach: e.target.value }))}
              rows={2}
              placeholder="Any practical notes to attach to this entry…"
              className="w-full rounded border px-2 py-1.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs font-semibold px-3 py-1.5 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : saved ? "✓ Saved" : "💾 Save links"}
          </button>
        </div>
      )}
    </div>
  );
}

function EnrichPanel({ batchId }: { batchId: string }) {
  const [open,     setOpen]     = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [entities, setEntities] = useState<StagedEntity[] | null>(null);

  const handleOpen = useCallback(async () => {
    if (entities !== null) { setOpen(v => !v); return; }
    setOpen(true);
    setLoading(true);
    const r = await listStagedEntitiesAction(batchId);
    setLoading(false);
    if (r.ok) setEntities(r.entities);
    else toast.error(r.error ?? "Failed to load entities");
  }, [batchId, entities]);

  return (
    <div className="border-t pt-3 mt-1">
      <button
        onClick={handleOpen}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{open ? "▲" : "▼"}</span>
        <span>🔗 Enrich links before approving</span>
        {entities && <span className="text-muted-foreground">({entities.length} entries)</span>}
      </button>

      {open && (
        <div className="mt-2 space-y-1.5">
          {loading && <p className="text-xs text-muted-foreground animate-pulse">Loading staged entries…</p>}
          {entities?.length === 0 && (
            <p className="text-xs text-muted-foreground">No editable entries in this batch.</p>
          )}
          {entities?.map((e) => (
            <EnrichEntityRow
              key={`${e.entity}/${e.slug}`}
              batchId={batchId}
              entity={e}
              onSaved={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Source registration tab ───────────────────────────────────────────────────

const SOURCE_TYPES_LIST = [
  "peer_reviewed_paper", "textbook", "clinical_guideline", "expert_consensus",
  "book", "website", "internal_skill", "llm_synthesis", "other",
];
const SOURCE_QUALITIES_LIST = ["high", "moderate", "low"];

function AddSourceTab() {
  const [id,        setId]        = useState("");
  const [title,     setTitle]     = useState("");
  const [srcType,   setSrcType]   = useState("book");
  const [quality,   setQuality]   = useState("moderate");
  const [authors,   setAuthors]   = useState("");
  const [year,      setYear]      = useState("");
  const [publisher, setPublisher] = useState("");
  const [url,       setUrl]       = useState("");
  const [doi,       setDoi]       = useState("");
  const [notes,     setNotes]     = useState("");
  const [saving,    setSaving]    = useState(false);
  const [savedId,   setSavedId]   = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!id || !title || !srcType || !quality) { toast.error("ID, title, type and quality are required"); return; }
    setSaving(true);
    try {
      const res = await saveSourceAction({
        id: id.trim(),
        title: title.trim(),
        source_type: srcType,
        quality,
        authors: authors ? authors.split(",").map((s) => s.trim()).filter(Boolean) : [],
        year: year ? parseInt(year, 10) : null,
        publisher: publisher || undefined,
        url: url || undefined,
        doi: doi || undefined,
        notes: notes || undefined,
      });
      if (res.ok) {
        setSavedId(res.id ?? id);
        toast.success(`Source "${res.id}" saved`);
      } else {
        toast.error(res.error ?? "Save failed");
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  }, [id, title, srcType, quality, authors, year, publisher, url, doi, notes]);

  if (savedId) {
    return (
      <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-5 space-y-3">
        <p className="text-sm font-semibold text-emerald-800">✅ Source saved</p>
        <p className="text-xs text-muted-foreground">
          <code className="font-mono bg-white rounded px-1">{savedId}</code> is now in the catalogue.
          Catalogue items can cite it as <code className="font-mono bg-white rounded px-1">id: {savedId}</code>.
          To extract entries from it, switch to File upload or URL tab and ingest with this same ID.
        </p>
        <a href={`/catalogue/sources/${savedId}`} className="text-xs underline text-primary">
          View → /catalogue/sources/{savedId}
        </a>
        <div>
          <button
            onClick={() => { setSavedId(null); setId(""); setTitle(""); setAuthors(""); setYear(""); setPublisher(""); setUrl(""); setDoi(""); setNotes(""); }}
            className="text-xs px-3 py-1.5 rounded border hover:bg-muted/50"
          >
            Add another source
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Register a reference so catalogue entries can cite it. After saving, ingest the actual document
        using this same Source ID to extract Claims, Topics, and Supplements linked to it.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Source ID <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value.replace(/\s+/g, "-").toLowerCase())}
            placeholder="e.g. thyroid-reset-diet-2023"
            className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. The Thyroid Reset Diet"
            className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Type <span className="text-red-500">*</span>
          </label>
          <select value={srcType} onChange={(e) => setSrcType(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30">
            {SOURCE_TYPES_LIST.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Quality <span className="text-red-500">*</span>
          </label>
          <select value={quality} onChange={(e) => setQuality(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30">
            {SOURCE_QUALITIES_LIST.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Author(s) <span className="text-xs font-normal">(comma-separated)</span>
          </label>
          <input type="text" value={authors} onChange={(e) => setAuthors(e.target.value)}
            placeholder="e.g. Alan Christianson"
            className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Year</label>
          <input type="number" value={year} onChange={(e) => setYear(e.target.value)}
            placeholder="2024" min={1900} max={2099}
            className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Publisher</label>
          <input type="text" value={publisher} onChange={(e) => setPublisher(e.target.value)}
            placeholder="e.g. Rodale Books"
            className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">URL</label>
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">DOI</label>
        <input type="text" value={doi} onChange={(e) => setDoi(e.target.value)}
          placeholder="10.xxxx/…"
          className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono" />
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          placeholder="Any notes about this source…"
          className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
      </div>

      <button
        onClick={handleSave}
        disabled={saving || !id || !title}
        className="font-semibold px-5 py-2 rounded-lg text-sm text-white bg-primary hover:opacity-90 disabled:opacity-40 transition-colors"
      >
        {saving ? "Saving…" : "💾 Save source to catalogue"}
      </button>
    </div>
  );
}

// ── Batch history item (shown after successful ingest) ────────────────────

function BatchPanel({
  batchId,
  onDismiss,
}: {
  batchId: string;
  onDismiss: () => void;
}) {
  const [reviewing,     setReviewing]     = useState(false);
  const [reviewOut,     setReviewOut]     = useState<string | null>(null);
  const [approving,     setApproving]     = useState(false);
  const [rejecting,     setRejecting]     = useState(false);
  const [done,          setDone]          = useState(false);
  const [update,        setUpdate]        = useState(true);
  const [batchStatus,   setBatchStatus]   = useState<string | null | undefined>(undefined); // undefined=loading

  // Check if already approved/rejected on mount
  useEffect(() => {
    getBatchStatusAction(batchId).then((r) => {
      if (r.ok) setBatchStatus(r.status ?? null);
      else setBatchStatus(null);
    });
  }, [batchId]);

  const handleReview = useCallback(async () => {
    setReviewing(true);
    const r = await reviewBatchAction(batchId);
    setReviewing(false);
    if (r.ok) setReviewOut(r.stdout ?? "");
    else toast.error(r.error ?? "Review failed");
  }, [batchId]);

  const handleApprove = useCallback(async () => {
    setApproving(true);
    const r = await approveBatchAction(batchId, update);
    setApproving(false);
    if (r.ok) {
      toast.success("Batch approved and promoted to catalogue!");
      setDone(true);
    } else {
      toast.error(r.error ?? "Approve failed");
    }
  }, [batchId, update]);

  const handleReject = useCallback(async () => {
    setRejecting(true);
    const r = await rejectBatchAction(batchId);
    setRejecting(false);
    if (r.ok) {
      toast.success("Batch rejected");
      setDone(true);
    } else {
      toast.error(r.error ?? "Reject failed");
    }
  }, [batchId]);

  if (done) return null;

  // Already approved/rejected — show read-only banner
  if (batchStatus === "approved" || batchStatus === "rejected") {
    return (
      <div className={`rounded-xl border-2 p-4 space-y-2 ${
        batchStatus === "approved"
          ? "border-emerald-200 bg-emerald-50"
          : "border-gray-200 bg-gray-50"
      }`}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className={`text-sm font-semibold ${batchStatus === "approved" ? "text-emerald-800" : "text-gray-600"}`}>
              {batchStatus === "approved" ? "✓ Already approved" : "✗ Already rejected"}
              <span className="text-xs font-normal ml-2 opacity-70">— entries are in the catalogue</span>
            </div>
            <div className="text-xs font-mono text-muted-foreground mt-0.5">{batchId}</div>
          </div>
          <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleReview}
            disabled={reviewing}
            className="text-xs px-3 py-1.5 rounded-lg border bg-white hover:bg-muted/30 disabled:opacity-50"
          >
            {reviewing ? "Loading…" : "👁 Review YAML"}
          </button>
        </div>
        {reviewOut !== null && (
          <pre className="text-[10px] bg-white/70 rounded p-3 max-h-48 overflow-auto font-mono border border-emerald-200">
            {reviewOut || "(empty output)"}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-emerald-800">
            Batch staged ✓
            {batchStatus === undefined && (
              <span className="text-xs font-normal ml-2 text-emerald-600 animate-pulse">checking status…</span>
            )}
          </div>
          <div className="text-xs font-mono text-emerald-600 mt-0.5">{batchId}</div>
        </div>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
      </div>

      {/* Review output */}
      {reviewOut !== null && (
        <pre className="text-[10px] bg-white/70 rounded p-3 max-h-48 overflow-auto font-mono border border-emerald-200">
          {reviewOut || "(empty output)"}
        </pre>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleReview}
          disabled={reviewing}
          className="text-xs px-3 py-1.5 rounded-lg border bg-white hover:bg-muted/30 disabled:opacity-50"
        >
          {reviewing ? "Loading…" : "👁 Review"}
        </button>

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={update}
            onChange={(e) => setUpdate(e.target.checked)}
            className="rounded"
          />
          Smart-merge existing
        </label>

        <button
          onClick={handleApprove}
          disabled={approving || rejecting}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {approving ? "Approving…" : "✅ Approve"}
        </button>

        <button
          onClick={handleReject}
          disabled={approving || rejecting}
          className="text-xs px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          {rejecting ? "Rejecting…" : "✗ Reject"}
        </button>
      </div>

      {/* Enrich links before approving */}
      <EnrichPanel batchId={batchId} />
    </div>
  );
}

// ── Approve-all panel ─────────────────────────────────────────────────────

function ApproveAllPanel() {
  const [count,    setCount]   = useState<number | null>(null);
  const [loading,  setLoading] = useState(false);
  const [running,  setRunning] = useState(false);
  const [result,   setResult]  = useState<null | {
    approved: number; failed: number; total: number; log: string[]; errors: string[];
  }>(null);
  const [showLog,  setShowLog] = useState(false);

  const checkCount = useCallback(async () => {
    setLoading(true);
    const r = await countPendingBatchesAction();
    setCount(r.count);
    setLoading(false);
  }, []);

  const handleApproveAll = useCallback(async () => {
    setRunning(true);
    setResult(null);
    const r = await approveAllPendingAction();
    setResult(r);
    setCount(r.failed); // anything left is failed
    setRunning(false);
    if (r.approved > 0) toast.success(`Approved ${r.approved} batch${r.approved !== 1 ? "es" : ""} ✓`);
    if (r.failed > 0)   toast.error(`${r.failed} batch${r.failed !== 1 ? "es" : ""} failed — see log`);
  }, []);

  return (
    <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
            <span>⚡</span> Approve all pending batches
          </div>
          <div className="text-xs text-amber-700 mt-0.5">
            Smart-merges every unapproved staging batch into the catalogue in one shot.
            {count !== null && count > 0 && (
              <span className="ml-1 font-semibold">{count} pending.</span>
            )}
            {count === 0 && (
              <span className="ml-1 text-emerald-700 font-semibold">All clear — nothing pending.</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {count === null && (
            <button
              onClick={checkCount}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-800 hover:bg-amber-100 disabled:opacity-50 transition-colors"
            >
              {loading ? "Checking…" : "Check count"}
            </button>
          )}
          <button
            onClick={handleApproveAll}
            disabled={running || count === 0}
            className="text-xs font-semibold px-4 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 transition-colors"
          >
            {running
              ? "⏳ Approving… (may take a few minutes)"
              : count !== null
              ? `✅ Approve all ${count > 0 ? count : ""} pending`
              : "✅ Approve all pending"}
          </button>
        </div>
      </div>

      {running && (
        <div className="text-xs text-amber-700 animate-pulse">
          Approving batches one by one with smart-merge — please wait…
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="flex gap-4 text-xs">
            <span className="text-emerald-700 font-semibold">✓ {result.approved} approved</span>
            {result.failed > 0 && <span className="text-red-700 font-semibold">✗ {result.failed} failed</span>}
            <span className="text-muted-foreground">{result.total} total</span>
            <button onClick={() => setShowLog(v => !v)} className="underline text-muted-foreground hover:text-foreground">
              {showLog ? "hide log" : "show log"}
            </button>
          </div>
          {result.errors.length > 0 && (
            <div className="text-xs text-red-700 bg-red-50 rounded p-2 border border-red-200 space-y-0.5">
              {result.errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
          {showLog && (
            <pre className="text-[10px] bg-white/70 rounded p-3 max-h-48 overflow-auto font-mono border border-amber-200">
              {result.log.join("\n") || "(no log)"}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Existing batches panel ─────────────────────────────────────────────────

function ExistingBatchesPanel() {
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [output,  setOutput]  = useState<string | null>(null);
  const [batchId, setBatchId] = useState("");
  const [panelBatch, setPanelBatch] = useState<string | null>(null);

  const handleList = useCallback(async () => {
    setLoading(true);
    const r = await listBatchesAction();
    setLoading(false);
    setOutput(r.stdout ?? r.error ?? "");
    setOpen(true);
  }, []);

  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">📦 Existing staging batches</div>
        <button
          onClick={handleList}
          disabled={loading}
          className="text-xs px-3 py-1 rounded border hover:bg-muted/50 disabled:opacity-50"
        >
          {loading ? "Loading…" : "List batches"}
        </button>
      </div>

      {open && (
        <>
          <pre className="text-[10px] bg-muted/20 rounded p-3 max-h-48 overflow-auto font-mono border">
            {output || "(no staging batches found)"}
          </pre>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              placeholder="batch-id to approve/reject…"
              className="flex-1 rounded border px-2 py-1.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <button
              onClick={() => { if (batchId.trim()) setPanelBatch(batchId.trim()); }}
              className="text-xs px-3 py-1.5 rounded border hover:bg-muted/50"
            >
              Load →
            </button>
          </div>
          {panelBatch && (
            <BatchPanel batchId={panelBatch} onDismiss={() => setPanelBatch(null)} />
          )}
        </>
      )}
    </div>
  );
}

// ── Accepted file types ───────────────────────────────────────────────────

const ACCEPTED_EXTENSIONS = ".pdf,.md,.txt,.yaml,.yml,.png,.jpg,.jpeg,.webp";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function fileIcon(name: string) {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (ext === ".pdf") return "📄";
  if (IMAGE_EXTENSIONS.has(ext)) return "🖼";
  return "📝";
}

function slugify(s: string) {
  return s.replace(/\.[^.]+$/, "").replace(/\s+/g, "-").replace(/[^a-z0-9-]/gi, "").toLowerCase();
}

// ── Relation badge ────────────────────────────────────────────────────────

const RELATION_STYLE: Record<string, string> = {
  conflicts: "bg-red-100 text-red-800 border-red-300",
  supports:  "bg-emerald-100 text-emerald-800 border-emerald-300",
  overlaps:  "bg-blue-100 text-blue-800 border-blue-300",
  referenced:"bg-purple-100 text-purple-800 border-purple-300",
};
const RELATION_LABEL: Record<string, string> = {
  conflicts: "⚠ conflicts",
  supports:  "✓ supports",
  overlaps:  "~ overlaps",
  referenced:"→ referenced",
};

function RelatedEntryCard({ entry }: { entry: CatalogueRelated }) {
  const relStyle = RELATION_STYLE[entry.relation] ?? "bg-gray-100 text-gray-700 border-gray-300";
  const relLabel = RELATION_LABEL[entry.relation] ?? entry.relation;
  return (
    <div className={`rounded-lg border p-3 space-y-1.5 ${
      entry.relation === "conflicts" ? "border-red-200 bg-red-50/50" : "border-border bg-background"
    }`}>
      <div className="flex items-start gap-2 flex-wrap">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${relStyle}`}>
          {relLabel}
        </span>
        <span className="text-xs font-semibold">{entry.display_name}</span>
        <span className="text-[10px] text-muted-foreground font-mono">{entry.kind}/{entry.slug}</span>
        {entry.evidence_tier && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{entry.evidence_tier}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground italic">{entry.relation_note}</p>
      {entry.summary && (
        <p className="text-xs text-foreground/70 line-clamp-2">{entry.summary}</p>
      )}
      {entry.notes_for_coach && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
          📝 Existing note: {entry.notes_for_coach}
        </p>
      )}
    </div>
  );
}

// ── Coach knowledge tab ───────────────────────────────────────────────────

type CheckPhase = "idle" | "checking" | "checked" | "staging";

function CoachKnowledgeTab({
  onBatchStaged,
}: {
  onBatchStaged: (batchId: string) => void;
}) {
  const [text,         setText]        = useState("");
  const [phase,        setPhase]       = useState<CheckPhase>("idle");
  const [checkResult,  setCheckResult] = useState<{
    related: CatalogueRelated[];
    assessment: string;
    is_new_ground: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset check when text changes
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    if (phase === "checked") {
      setPhase("idle");
      setCheckResult(null);
      setError(null);
    }
  };

  const handleCheck = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) { toast.error("Enter an observation first"); return; }
    setPhase("checking");
    setError(null);
    try {
      const result = await checkCoachKnowledgeAction(trimmed);
      if (!result.ok) {
        setError(result.error ?? "Check failed");
        toast.error(result.error ?? "Catalogue check failed");
        setPhase("idle");
      } else {
        setCheckResult({
          related: result.related,
          assessment: result.assessment,
          is_new_ground: result.is_new_ground,
        });
        setPhase("checked");
      }
    } catch (err) {
      setError(String(err));
      toast.error(String(err));
      setPhase("idle");
    }
  }, [text]);

  const handleStage = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setPhase("staging");
    setError(null);
    try {
      const result = await runCoachKnowledgeAction(trimmed);
      if (!result.ok) {
        setError(result.error ?? "Staging failed");
        toast.error(result.error ?? "Staging failed");
        setPhase("checked"); // fall back so they can retry
      } else {
        toast.success("Observation staged — review and approve below");
        setText("");
        setPhase("idle");
        setCheckResult(null);
        const bid = result.batchId
          ?? result.stdout?.match(/([0-9T]+-[a-z0-9-]+-[a-f0-9]+)/)?.[1];
        if (bid) onBatchStaged(bid);
        else toast.info("Check review panel for the new batch ID");
      }
    } catch (err) {
      setError(String(err));
      toast.error(String(err));
      setPhase("checked");
    }
  }, [text, onBatchStaged]);

  const hasConflicts = checkResult?.related.some((r) => r.relation === "conflicts") ?? false;
  const conflictCount = checkResult?.related.filter((r) => r.relation === "conflicts").length ?? 0;

  return (
    <div className="space-y-4">
      {/* Description */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-1">
        <p className="font-semibold">💬 Drop a clinical observation — AI figures out the rest</p>
        <p className="text-xs text-amber-700">
          Type anything: a clinical tip, a protocol note, a connection you noticed.
          Claude checks the catalogue first, then extracts and stages the right entries.
          Source tagged as <strong>coach-shivani</strong>.
        </p>
        <ul className="text-xs text-amber-700 mt-1 list-disc pl-4 space-y-0.5">
          <li>"In cases of unexplained hair loss, always check for H. pylori"</li>
          <li>"Soak 1 tsp methi seeds overnight and drink the water first thing — helps blood sugar"</li>
          <li>"Low ferritin can drive hair loss even when haemoglobin is normal"</li>
        </ul>
      </div>

      {/* Textarea */}
      <textarea
        value={text}
        onChange={handleTextChange}
        rows={4}
        placeholder="Type your clinical observation here…"
        className="w-full rounded-lg border px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-y"
        autoFocus
        disabled={phase === "checking" || phase === "staging"}
      />

      {/* ── Phase: idle / checking ── */}
      {(phase === "idle" || phase === "checking") && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleCheck}
            disabled={phase === "checking" || !text.trim()}
            className="font-semibold px-5 py-2 rounded-lg text-sm border border-amber-400 text-amber-800 bg-amber-50 hover:bg-amber-100 disabled:opacity-40 transition-colors"
          >
            {phase === "checking" ? "🔍 Checking catalogue…" : "🔍 Check catalogue first"}
          </button>
          {phase === "checking" && (
            <span className="text-xs text-muted-foreground animate-pulse">
              Searching for related entries…
            </span>
          )}
        </div>
      )}

      {/* ── Phase: checked — show results ── */}
      {phase === "checked" && checkResult && (
        <div className="space-y-3">
          {/* Assessment banner */}
          <div className={`rounded-lg border px-4 py-3 text-sm space-y-1 ${
            hasConflicts
              ? "border-red-200 bg-red-50"
              : checkResult.is_new_ground
              ? "border-emerald-200 bg-emerald-50"
              : "border-blue-200 bg-blue-50"
          }`}>
            <p className={`font-semibold ${
              hasConflicts ? "text-red-800" : checkResult.is_new_ground ? "text-emerald-800" : "text-blue-800"
            }`}>
              {hasConflicts
                ? `⚠ ${conflictCount} conflict${conflictCount !== 1 ? "s" : ""} found — review before staging`
                : checkResult.is_new_ground
                ? "✓ New ground — no overlapping entries found"
                : `ℹ ${checkResult.related.length} related ${checkResult.related.length === 1 ? "entry" : "entries"} in catalogue`}
            </p>
            <p className={`text-xs ${
              hasConflicts ? "text-red-700" : checkResult.is_new_ground ? "text-emerald-700" : "text-blue-700"
            }`}>
              {checkResult.assessment}
            </p>
          </div>

          {/* Related entries */}
          {checkResult.related.length > 0 && (
            <div className="space-y-2">
              {checkResult.related.map((entry) => (
                <RelatedEntryCard key={`${entry.kind}/${entry.slug}`} entry={entry} />
              ))}
            </div>
          )}

          {/* Stage button */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleStage}
              className={`font-semibold px-5 py-2 rounded-lg text-sm text-white transition-colors disabled:opacity-40 ${
                hasConflicts
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-amber-600 hover:bg-amber-700"
              }`}
            >
              {hasConflicts
                ? "⚠ Stage anyway"
                : "🧠 Stage observation"}
            </button>
            <button
              onClick={() => { setPhase("idle"); setCheckResult(null); setError(null); }}
              className="text-sm text-muted-foreground hover:text-foreground px-3 py-2"
            >
              ← Edit
            </button>
            {hasConflicts && (
              <span className="text-xs text-red-600">
                Conflicts detected — staging will add new entries alongside existing ones
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Phase: staging ── */}
      {phase === "staging" && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground animate-pulse">
            ⏳ Staging… Claude is extracting catalogue entries
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-xs text-red-700 bg-red-50 rounded p-2 border border-red-200">
          {error}
        </div>
      )}
    </div>
  );
}

// ── Main ingest form ──────────────────────────────────────────────────────

type InputMode = "file" | "url" | "coach" | "source";

export function IngestClient() {
  const [mode,          setMode]          = useState<InputMode>("file");

  // File mode
  const [file,          setFile]          = useState<File | null>(null);
  const [dragging,      setDragging]      = useState(false);
  const [imagePreview,  setImagePreview]  = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // URL mode
  const [url,           setUrl]           = useState("");

  // Shared metadata
  const [sourceId,      setSourceId]      = useState("");
  const [sourceTitle,   setSourceTitle]   = useState("");
  const [sourceType,    setSourceType]    = useState("website");
  const [sourceQuality, setSourceQuality] = useState("moderate");
  const [instructions,  setInstructions]  = useState("");

  // State
  const [ingesting,     setIngesting]     = useState(false);
  const [stagedBatches, setStagedBatches] = useState<string[]>([]);

  // ── file helpers ──────────────────────────────────────────────────────

  const applyFile = useCallback((f: File) => {
    setFile(f);
    if (!sourceId) setSourceId(slugify(f.name));
    if (!sourceTitle) setSourceTitle(f.name.replace(/\.[^.]+$/, ""));
    // Image preview
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target?.result as string);
      reader.readAsDataURL(f);
    } else {
      setImagePreview(null);
    }
  }, [sourceId, sourceTitle]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) applyFile(dropped);
  }, [applyFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) applyFile(f);
  };

  // ── URL helper ────────────────────────────────────────────────────────

  const handleUrlBlur = () => {
    if (!url.trim()) return;
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.replace(/^www\./, "");
      const pathSlug = parsed.pathname.replace(/\/$/, "").split("/").filter(Boolean).slice(-1)[0] ?? "";
      const auto = slugify(`${hostname}-${pathSlug}`).slice(0, 60);
      if (!sourceId) setSourceId(auto);
      if (!sourceTitle) setSourceTitle(pathSlug.replace(/-/g, " ") || hostname);
    } catch { /* not a valid URL yet */ }
  };

  // ── ingest ────────────────────────────────────────────────────────────

  const handleIngest = useCallback(async () => {
    if (!sourceId.trim()) { toast.error("Source ID is required"); return; }

    if (mode === "file") {
      if (!file) { toast.error("Select a file first"); return; }
    } else {
      if (!url.trim()) { toast.error("Enter a URL"); return; }
      try { new URL(url); } catch { toast.error("Invalid URL"); return; }
    }

    setIngesting(true);
    try {
      let result;
      if (mode === "file") {
        const buf = await file!.arrayBuffer();
        const b64 = Buffer.from(buf).toString("base64");
        result = await runIngestAction({
          fileDataBase64: b64,
          fileName: file!.name,
          sourceId: sourceId.trim(),
          sourceTitle: sourceTitle.trim() || sourceId.trim(),
          sourceType,
          sourceQuality,
          instructions: instructions.trim(),
        });
      } else {
        result = await runIngestAction({
          url: url.trim(),
          sourceId: sourceId.trim(),
          sourceTitle: sourceTitle.trim() || sourceId.trim(),
          sourceType,
          sourceQuality,
          instructions: instructions.trim(),
        });
      }

      if (!result.ok) {
        toast.error(result.error ?? "Ingest failed");
      } else {
        toast.success("Ingest complete — batch staged");
        const bid = result.batchId
          ?? result.stdout?.match(/([0-9T]+-[a-z0-9-]+-[a-f0-9]+)/)?.[1];
        if (bid) setStagedBatches((prev) => [bid, ...prev]);
        else toast.info("Check the review panel for the new batch ID");
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setIngesting(false);
    }
  }, [mode, file, url, sourceId, sourceTitle, sourceType, sourceQuality, instructions]);

  const canSubmit = mode === "file" ? !!file : !!url.trim();

  return (
    <div className="space-y-6">
      {/* Staged batches (success panels) */}
      {stagedBatches.map((bid) => (
        <BatchPanel
          key={bid}
          batchId={bid}
          onDismiss={() => setStagedBatches((p) => p.filter((b) => b !== bid))}
        />
      ))}

      {/* Mode tabs */}
      <div className="flex gap-1 border-b">
        {([
          { id: "file"   as InputMode, label: "📁 File upload" },
          { id: "url"    as InputMode, label: "🔗 URL / link" },
          { id: "coach"  as InputMode, label: "💬 Coach Knowledge" },
          { id: "source" as InputMode, label: "📚 Add Source" },
        ] as const).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              mode === id
                ? "border-amber-500 text-amber-700"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* FILE MODE */}
      {mode === "file" && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`rounded-xl border-2 border-dashed px-8 py-10 text-center cursor-pointer transition-colors ${
            dragging
              ? "border-primary bg-primary/5"
              : file
              ? "border-emerald-300 bg-emerald-50"
              : "border-border hover:border-primary/40 hover:bg-muted/20"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            className="sr-only"
            onChange={handleFileChange}
          />
          {file ? (
            <div>
              {imagePreview ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={imagePreview}
                  alt={file.name}
                  className="max-h-40 mx-auto rounded-lg mb-3 object-contain"
                />
              ) : (
                <div className="text-3xl mb-2">{fileIcon(file.name)}</div>
              )}
              <div className="font-semibold text-sm">{file.name}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {(file.size / 1024).toFixed(0)} KB · click to change
              </div>
            </div>
          ) : (
            <div>
              <div className="text-3xl mb-2">⬆️</div>
              <div className="font-semibold text-sm">Drop a file here</div>
              <div className="text-xs text-muted-foreground mt-2">
                or click to browse
              </div>
              <div className="flex flex-wrap justify-center gap-1.5 mt-3">
                {[".pdf", ".md", ".txt", ".png", ".jpg", ".jpeg", ".webp"].map((ext) => (
                  <span key={ext} className="text-[10px] px-2 py-0.5 rounded-full bg-muted border text-muted-foreground font-mono">
                    {ext}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* URL MODE */}
      {mode === "url" && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              URL <span className="text-red-500">*</span>
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={handleUrlBlur}
              placeholder="https://example.com/article-about-gut-health"
              className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Works with articles, blog posts, research pages. For PDFs hosted online, the PDF will be downloaded and sent directly. HTML pages are converted to clean text before extraction.
            </p>
          </div>
        </div>
      )}

      {/* COACH KNOWLEDGE MODE — has its own self-contained form */}
      {mode === "coach" && (
        <CoachKnowledgeTab
          onBatchStaged={(bid) => setStagedBatches((prev) => [bid, ...prev])}
        />
      )}

      {/* ADD SOURCE MODE */}
      {mode === "source" && <AddSourceTab />}

      {/* Metadata form + submit — file and url modes only */}
      {mode !== "coach" && mode !== "source" && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Source ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                placeholder="e.g. examine-magnesium"
                className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">Lowercase, hyphens only — used as the citation key</p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Source title
              </label>
              <input
                type="text"
                value={sourceTitle}
                onChange={(e) => setSourceTitle(e.target.value)}
                placeholder="e.g. Examine.com — Magnesium"
                className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Source type
              </label>
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Quality
              </label>
              <select
                value={sourceQuality}
                onChange={(e) => setSourceQuality(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {QUALITY_OPTS.map((q) => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Extraction instructions (optional)
            </label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              placeholder='e.g. "Focus only on the supplement dosage section. Ignore the ads and sidebar content."'
              className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleIngest}
              disabled={ingesting || !canSubmit}
              className="font-semibold px-5 py-2 rounded-lg text-sm text-white transition-all hover:opacity-90 disabled:opacity-40"
              style={{ background: "var(--brand-indigo)" }}
            >
              {ingesting ? "⏳ Ingesting… (this may take a few minutes)" : "🚀 Run ingest"}
            </button>
            {ingesting && (
              <span className="text-xs text-muted-foreground animate-pulse">
                {mode === "url" ? "Fetching URL and calling Claude…" : "Calling Claude to extract catalogue entities…"}
              </span>
            )}
          </div>
        </>
      )}

      {/* Approve all + existing batches */}
      <ApproveAllPanel />
      <ExistingBatchesPanel />
    </div>
  );
}
