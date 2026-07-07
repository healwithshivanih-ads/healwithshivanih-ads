"use client";
import { useState, useTransition } from "react";
import {
  RecipeCandidate,
  ParsedRecipeDraft,
  RecipeIngredient,
  createRecipeCandidateAction,
  parseRecipeCandidateAction,
  approveRecipeCandidateAction,
  rejectRecipeCandidateAction,
} from "@/lib/server-actions/recipe-inbox";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack", "side", "drink", "salad", "soup", "condiment"];
const DIETS = ["vegetarian", "vegan", "jain", "eggetarian", "non_vegetarian", "gluten_free", "dairy_free", "nut_free"];

// Tool-use occasionally serialises an array field as a STRING (a JSON array,
// or newline text). Coerce so the editor never calls .join/.map on a string
// and takes down the whole review page. Belt-and-braces with the shim-side
// normalisation — a legacy candidate saved before that fix still opens.
function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") {
    const s = v.trim().replace(/,\s*$/, "").trim(); // models sometimes append a trailing comma
    if (s.startsWith("[")) {
      const cleaned = s.replace(/,(\s*[\]}])/g, "$1");
      if (cleaned.endsWith("]")) {
        try {
          const p = JSON.parse(cleaned);
          if (Array.isArray(p)) return p.map((x) => String(x));
        } catch {
          /* fall through */
        }
      }
      const quoted = s.match(/"((?:[^"\\]|\\.)*)"/g);
      if (quoted) return quoted.map((q) => q.slice(1, -1).replace(/\\"/g, '"'));
    }
    return s
      .split("\n")
      .map((ln) => ln.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeDraft(raw: Record<string, unknown>): ParsedRecipeDraft {
  const d = { ...raw } as Record<string, unknown>;
  for (const f of ["meal_type", "diet", "seasons", "balances_dosha", "aggravates_dosha", "rasa", "main_ingredients", "contains_allergens", "steps"]) {
    if (f in d) d[f] = toStringArray(d[f]);
  }
  const ings = d.ingredients;
  d.ingredients = (Array.isArray(ings) ? ings : []).map((i) =>
    i && typeof i === "object"
      ? { item: String((i as RecipeIngredient).item ?? ""), qty: String((i as RecipeIngredient).qty ?? ""), unit: String((i as RecipeIngredient).unit ?? "") }
      : { item: String(i), qty: "", unit: "" },
  );
  return d as unknown as ParsedRecipeDraft;
}

function ChipToggle({
  value,
  options,
  onChange,
}: {
  value: string[];
  options: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => {
        const on = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v !== opt) : [...value, opt])}
            className={`text-xs rounded-full px-2 py-0.5 border ${
              on ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {opt.replace(/_/g, " ")}
          </button>
        );
      })}
    </div>
  );
}

function DraftEditor({
  candidate,
  onApproved,
}: {
  candidate: RecipeCandidate;
  onApproved: (slug: string) => void;
}) {
  const [draft, setDraft] = useState<ParsedRecipeDraft>(
    () => normalizeDraft(JSON.parse(JSON.stringify(candidate.parsed))),
  );
  const [warnings, setWarnings] = useState<string[]>([]);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [, startTransition] = useTransition();

  function set<K extends keyof ParsedRecipeDraft>(key: K, val: ParsedRecipeDraft[K]) {
    setDraft((d) => ({ ...d, [key]: val }));
  }

  function setIng(i: number, field: keyof RecipeIngredient, val: string) {
    setDraft((d) => {
      const ings = d.ingredients.map((ing, j) => (j === i ? { ...ing, [field]: val } : ing));
      return { ...d, ingredients: ings };
    });
  }

  function approve(force: boolean) {
    setBusy(true);
    setErr("");
    startTransition(async () => {
      const res = await approveRecipeCandidateAction(candidate.id, draft, force);
      setBusy(false);
      if (res.ok && res.slug) {
        onApproved(res.slug);
      } else if (res.needs_confirm) {
        setWarnings(res.warnings ?? []);
        setNeedsConfirm(true);
      } else {
        setErr(res.error ?? "approve failed");
      }
    });
  }

  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <div className="flex gap-2 items-center">
        <input
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          className="flex-1 text-sm font-semibold border rounded px-2 py-1.5 bg-background"
          placeholder="Recipe name"
        />
        <input
          value={draft.servings}
          onChange={(e) => set("servings", e.target.value)}
          className="w-20 text-xs border rounded px-2 py-1.5 bg-background"
          placeholder="Serves"
          title="Servings"
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Meal type</p>
          <ChipToggle value={draft.meal_type} options={MEAL_TYPES} onChange={(v) => set("meal_type", v)} />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Diet</p>
          <ChipToggle value={draft.diet} options={DIETS} onChange={(v) => set("diet", v)} />
        </div>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
          Ingredients ({draft.ingredients.length})
        </p>
        <div className="space-y-1">
          {draft.ingredients.map((ing, i) => (
            <div key={i} className="flex gap-1 items-center">
              <input
                value={ing.item}
                onChange={(e) => setIng(i, "item", e.target.value)}
                className="flex-1 text-xs border rounded px-2 py-1 bg-background min-w-0"
              />
              <input
                value={ing.qty}
                onChange={(e) => setIng(i, "qty", e.target.value)}
                className="w-14 text-xs border rounded px-2 py-1 bg-background"
                placeholder="qty"
              />
              <input
                value={ing.unit}
                onChange={(e) => setIng(i, "unit", e.target.value)}
                className="w-16 text-xs border rounded px-2 py-1 bg-background"
                placeholder="unit"
              />
              <button
                type="button"
                onClick={() => set("ingredients", draft.ingredients.filter((_, j) => j !== i))}
                className="text-xs text-muted-foreground hover:text-red-600 px-1"
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => set("ingredients", [...draft.ingredients, { item: "", qty: "", unit: "" }])}
          className="text-xs text-muted-foreground hover:text-foreground mt-1"
        >
          + add ingredient
        </button>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
          Steps (one per line, in our own words)
        </p>
        <textarea
          value={draft.steps.join("\n")}
          onChange={(e) => set("steps", e.target.value.split("\n").filter((s) => s.trim()))}
          rows={Math.min(8, Math.max(3, draft.steps.length + 1))}
          className="w-full text-xs border rounded px-2 py-1.5 bg-background font-mono"
        />
      </div>

      <input
        value={draft.one_line}
        onChange={(e) => set("one_line", e.target.value)}
        className="w-full text-xs border rounded px-2 py-1.5 bg-background"
        placeholder="One-line description"
      />

      {(draft.parse_notes || draft.attribution_author) && (
        <p className="text-[11px] text-muted-foreground">
          {draft.attribution_author && <>credit: {draft.attribution_author} · </>}
          {draft.parse_notes}
        </p>
      )}

      {warnings.length > 0 && (
        <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2 space-y-0.5">
          {warnings.map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
        </div>
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => approve(needsConfirm)}
          disabled={busy || !draft.name.trim()}
          className={`text-xs rounded px-3 py-1.5 disabled:opacity-50 ${
            needsConfirm
              ? "bg-amber-600 text-white"
              : "bg-primary text-primary-foreground"
          }`}
        >
          {busy ? "Adding…" : needsConfirm ? "⚠ Approve anyway" : "✅ Add to library"}
        </button>
        {needsConfirm && (
          <span className="text-xs text-muted-foreground self-center">
            review the warnings above, then confirm
          </span>
        )}
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  onGone,
}: {
  candidate: RecipeCandidate;
  onGone: (id: string) => void;
}) {
  const [cand, setCand] = useState(candidate);
  const [parsing, setParsing] = useState(false);
  const [err, setErr] = useState("");
  const [approvedSlug, setApprovedSlug] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [, startTransition] = useTransition();

  function parse() {
    setParsing(true);
    setErr("");
    startTransition(async () => {
      const res = await parseRecipeCandidateAction(cand.id);
      setParsing(false);
      if (res.ok && res.candidate) setCand(res.candidate);
      else setErr(res.error ?? "parse failed");
    });
  }

  function reject() {
    if (!rejecting) {
      setRejecting(true);
      return;
    }
    startTransition(async () => {
      await rejectRecipeCandidateAction(cand.id);
      onGone(cand.id);
    });
  }

  const received = cand.received_at
    ? new Date(cand.received_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
    : "";

  if (approvedSlug) {
    return (
      <div className="border rounded-lg p-3 bg-green-50 border-green-200 text-sm">
        ✅ Added to library as <span className="font-mono text-xs">{approvedSlug}</span> — it now has
        computed nutrients and will appear in the dish picker. Add a photo below if it needs one.
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
        <span>
          {cand.source === "whatsapp" ? "💬 WhatsApp" : cand.source === "ai_batch" ? "🤖 AI draft" : "✍️ Manual"}
        </span>
        <span>· {received}</span>
        {cand.from_name && <span>· from {cand.from_name}</span>}
        {cand.media_file && <span className="bg-muted rounded px-1.5 py-0.5">📎 {cand.media_mime}</span>}
        {cand.source_url && (
          <a href={cand.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
            🔗 source ↗
          </a>
        )}
        <button onClick={reject} className="ml-auto text-muted-foreground hover:text-red-600">
          {rejecting ? "Confirm reject?" : "Reject"}
        </button>
      </div>

      {cand.text && (
        <p className="text-xs mt-2 whitespace-pre-wrap max-h-24 overflow-y-auto text-muted-foreground">
          {cand.text.slice(0, 600)}
          {cand.text.length > 600 ? "…" : ""}
        </p>
      )}

      {cand.image_url && (
        <div className="mt-2 flex items-start gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cand.image_url}
            alt="source photo"
            className="w-28 h-20 object-cover rounded border"
          />
          <span className="text-[11px] text-muted-foreground">
            📷 Source photo — will be attached to the recipe on approve
            {cand.image_credit ? <>, credited “{cand.image_credit}”</> : null}.
          </span>
        </div>
      )}

      {cand.status === "new" && (
        <div className="mt-2">
          <button
            onClick={parse}
            disabled={parsing}
            className="text-xs bg-primary text-primary-foreground rounded px-3 py-1.5 disabled:opacity-50"
          >
            {parsing ? "Parsing… (~20s)" : "✨ Parse into recipe"}
          </button>
        </div>
      )}
      {cand.status === "parsed" && cand.parsed && (
        <DraftEditor candidate={cand} onApproved={setApprovedSlug} />
      )}
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
    </div>
  );
}

function AddCandidateCard({ onCreated }: { onCreated: (c: RecipeCandidate) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [, startTransition] = useTransition();

  async function submit() {
    setBusy(true);
    setErr("");
    let fileBase64: string | undefined;
    let fileMime: string | undefined;
    if (file) {
      const buf = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      fileBase64 = btoa(binary);
      fileMime = file.type;
    }
    startTransition(async () => {
      const res = await createRecipeCandidateAction({ text, sourceUrl: url, fileBase64, fileMime });
      if (!res.ok || !res.id) {
        setBusy(false);
        setErr(res.error ?? "failed");
        return;
      }
      // auto-parse right away — the coach came here to review, not to click twice
      const parsed = await parseRecipeCandidateAction(res.id);
      setBusy(false);
      if (parsed.ok && parsed.candidate) {
        onCreated(parsed.candidate);
        setText("");
        setUrl("");
        setFile(null);
        setOpen(false);
      } else {
        setErr(parsed.error ?? "saved, but parsing failed — find it in the list below");
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full border-2 border-dashed rounded-lg p-4 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 text-left"
      >
        ➕ Add a recipe — paste a reel caption / recipe text, a link, or upload a cookbook photo or PDF
      </button>
    );
  }

  return (
    <div className="border rounded-lg p-4 space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Paste the reel caption or any recipe text here…"
        className="w-full text-xs border rounded px-2 py-1.5 bg-background"
      />
      <div className="flex gap-2 flex-wrap items-center">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.instagram.com/reel/… (optional)"
          className="flex-1 min-w-48 text-xs border rounded px-2 py-1.5 bg-background"
        />
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-xs"
        />
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy || (!text.trim() && !url.trim() && !file)}
          className="text-xs bg-primary text-primary-foreground rounded px-3 py-1.5 disabled:opacity-50"
        >
          {busy ? "Saving + parsing… (~20s)" : "✨ Save & parse"}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground">
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function RecipeInboxClient({ initial }: { initial: RecipeCandidate[] }) {
  const [candidates, setCandidates] = useState(
    initial.filter((c) => c.status === "new" || c.status === "parsed"),
  );

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold flex items-center gap-2">
        📥 Recipe inbox
        {candidates.length > 0 && (
          <span className="text-xs font-normal bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">
            {candidates.length} to review
          </span>
        )}
      </h2>
      <p className="text-xs text-muted-foreground">
        Forward reels, cookbook photos or recipe PDFs to your coach WhatsApp number from an
        allowlisted phone (RECIPE_INBOX_NUMBERS) and they land here — or add one manually below.
        Nothing enters the library without your review.
      </p>
      <AddCandidateCard onCreated={(c) => setCandidates((l) => [c, ...l])} />
      {candidates.map((c) => (
        <CandidateCard
          key={c.id}
          candidate={c}
          onGone={(id) => setCandidates((l) => l.filter((x) => x.id !== id))}
        />
      ))}
    </section>
  );
}
