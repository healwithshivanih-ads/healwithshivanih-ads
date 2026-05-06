"use client";

import { useState, useTransition } from "react";
import { saveCoachNotesAction } from "./actions";

interface CoachNotesEditorProps {
  kind: string;
  slug: string;
  initialNotes: string;
}

export function CoachNotesEditor({ kind, slug, initialNotes }: CoachNotesEditorProps) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(initialNotes);
  const [draft, setDraft] = useState(initialNotes);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleEdit() {
    setDraft(notes);
    setEditing(true);
    setStatus("idle");
  }

  function handleCancel() {
    setEditing(false);
    setDraft(notes);
    setStatus("idle");
  }

  function handleSave() {
    setStatus("saving");
    startTransition(async () => {
      const result = await saveCoachNotesAction(kind, slug, draft);
      if (result.ok) {
        setNotes(draft);
        setEditing(false);
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 3000);
      } else {
        setStatus("error");
        setErrorMsg(result.error ?? "Unknown error");
      }
    });
  }

  if (!editing) {
    return (
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <span>📝</span>
            <span>Coach Notes</span>
            <span className="text-xs font-normal text-amber-600">(source: coach-shivani)</span>
          </div>
          <button
            onClick={handleEdit}
            className="text-xs text-amber-700 hover:text-amber-900 border border-amber-300 rounded px-2 py-0.5 hover:bg-amber-100 transition-colors"
          >
            {notes ? "Edit" : "+ Add notes"}
          </button>
        </div>

        {notes ? (
          <p className="mt-2 text-sm text-amber-900 whitespace-pre-wrap leading-relaxed">{notes}</p>
        ) : (
          <p className="mt-2 text-sm text-amber-600 italic">
            No coach notes yet. Click &quot;+ Add notes&quot; to capture clinical wisdom,
            protocol tips, or real-world observations for this entry.
          </p>
        )}

        {status === "saved" && (
          <p className="mt-2 text-xs text-green-700">✓ Saved</p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 mb-2">
        <span>📝</span>
        <span>Coach Notes</span>
        <span className="text-xs font-normal text-amber-600">(source: coach-shivani · saved to YAML)</span>
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={5}
        className="w-full rounded border border-amber-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-y"
        placeholder={`e.g. Soak 1 tsp fenugreek seeds overnight and drink the water first thing in the morning.\nWorks well alongside magnesium glycinate at bedtime for blood sugar stabilisation.`}
        autoFocus
      />

      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="text-sm px-3 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 transition-colors"
        >
          {isPending ? "Saving…" : "💾 Save to catalogue"}
        </button>
        <button
          onClick={handleCancel}
          className="text-sm px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-100 transition-colors"
        >
          Cancel
        </button>
        <span className="text-xs text-gray-500 ml-1">
          Tagged as <strong>coach-shivani</strong> in YAML
        </span>
      </div>

      {status === "error" && (
        <p className="mt-2 text-xs text-red-600">Error: {errorMsg}</p>
      )}
    </div>
  );
}
