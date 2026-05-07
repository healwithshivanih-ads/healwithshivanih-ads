"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { parseClientMessageAction, type ParsedClientMessage } from "@/app/clients/actions";
import { saveSessionAction } from "@/app/assess/actions";

interface Props {
  clientId: string;
  onNoteSaved?: (sessionId: string) => void;
}

// ── Parsed message preview ─────────────────────────────────────────────────────

function ParsedPreview({ data }: { data: ParsedClientMessage }) {
  const sections: Array<{ emoji: string; label: string; items: string[] | null; text?: string | null; color: string }> = [
    { emoji: "✅", label: "Improving",  items: data.symptoms_improved,   color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
    { emoji: "→",  label: "Persisting", items: data.symptoms_persisting, color: "text-amber-700 bg-amber-50 border-amber-200" },
    { emoji: "⚠️", label: "New / worse", items: data.symptoms_new,       color: "text-red-700 bg-red-50 border-red-200" },
    { emoji: "📋", label: "Adherence",  items: null, text: data.adherence_notes, color: "text-slate-700 bg-slate-50 border-slate-200" },
    { emoji: "😊", label: "Mood",       items: null, text: data.mood_note,       color: "text-purple-700 bg-purple-50 border-purple-200" },
    { emoji: "❓", label: "Questions",  items: data.questions,           color: "text-blue-700 bg-blue-50 border-blue-200" },
    { emoji: "🚩", label: "Flag",       items: null, text: data.protocol_flag,   color: "text-rose-700 bg-rose-50 border-rose-200" },
  ];

  return (
    <div className="space-y-2">
      {sections.map(({ emoji, label, items, text, color }) => {
        const hasItems = items && items.length > 0;
        const hasText = text && text.trim();
        if (!hasItems && !hasText) return null;
        return (
          <div key={label} className={`rounded-lg border px-3 py-2 text-xs ${color}`}>
            <span className="font-semibold">{emoji} {label}: </span>
            {hasItems
              ? items!.join(" · ")
              : text}
          </div>
        );
      })}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export function MessageCapturePanel({ clientId, onNoteSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [isParsing, startParse] = useTransition();
  const [isSaving, startSave] = useTransition();
  const [parsed, setParsed] = useState<ParsedClientMessage | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editedNote, setEditedNote] = useState("");
  const [editingNote, setEditingNote] = useState(false);

  const reset = () => {
    setMessageText("");
    setParsed(null);
    setParseError(null);
    setSaved(false);
    setEditedNote("");
    setEditingNote(false);
  };

  const onParse = () => {
    if (!messageText.trim()) { toast.error("Paste a message first"); return; }
    setParseError(null);
    setParsed(null);
    setSaved(false);
    startParse(async () => {
      const res = await parseClientMessageAction(messageText.trim(), clientId);
      if (!res.ok || !res.data) {
        setParseError(res.error ?? "Parse failed");
        toast.error("Extraction failed");
        return;
      }
      setParsed(res.data);
      setEditedNote(res.data.quick_note_text);
      toast.success("Message parsed ✓");
    });
  };

  const onSave = () => {
    if (!parsed) return;
    startSave(async () => {
      const noteText = editedNote || parsed.quick_note_text;
      // Build presenting_complaints string — save as quick_note session
      const complaints = [
        "[session_type: quick_note]",
        "",
        noteText,
        parsed.protocol_flag ? `\n⚑ Protocol flag: ${parsed.protocol_flag}` : "",
      ].filter(Boolean).join("\n");

      const res = await saveSessionAction({
        client_id: clientId,
        session_type: "quick_note",
        presenting_complaints: complaints,
      });

      if (!res.ok) {
        toast.error(`Save failed: ${res.error}`);
        return;
      }
      setSaved(true);
      toast.success("✓ Quick note saved from client message");
      if (res.session_id && onNoteSaved) onNoteSaved(res.session_id);
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
      >
        💬 Capture message
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-sm flex items-center gap-1.5">💬 Capture client message</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Paste a WhatsApp / AiSensy / email message. AI extracts clinical content and creates a quick note.
          </p>
        </div>
        <button
          onClick={() => { setOpen(false); reset(); }}
          className="text-muted-foreground hover:text-foreground text-xs shrink-0"
        >
          ✕ close
        </button>
      </div>

      {!parsed && (
        <div className="space-y-3">
          <textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder={"Paste the client's message here…\n\ne.g. \"Hi Shivani! The bloating is so much better 😊 Still a bit constipated though. Energy is improving. I've been forgetting the evening walk. Also quick question — can I take magnesium at dinner instead?\""}
            rows={6}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
          {parseError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{parseError}</p>
          )}
          <Button
            type="button"
            onClick={onParse}
            disabled={isParsing || !messageText.trim()}
            variant="outline"
            className="border-violet-300 text-violet-800 hover:bg-violet-100 text-sm"
          >
            {isParsing ? "Parsing…" : "✨ Extract clinical content"}
          </Button>
        </div>
      )}

      {parsed && !saved && (
        <div className="space-y-4">
          <ParsedPreview data={parsed} />

          {/* Editable quick note */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">Quick note text</p>
              <button
                type="button"
                onClick={() => setEditingNote((v) => !v)}
                className="text-[10px] text-muted-foreground underline"
              >
                {editingNote ? "done editing" : "✏ edit"}
              </button>
            </div>
            {editingNote ? (
              <textarea
                value={editedNote}
                onChange={(e) => setEditedNote(e.target.value)}
                rows={6}
                className="w-full rounded-md border bg-background px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
            ) : (
              <pre className="text-xs bg-white border rounded-lg px-3 py-2 whitespace-pre-wrap leading-relaxed font-sans">
                {editedNote || parsed.quick_note_text}
              </pre>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button type="button" onClick={onSave} disabled={isSaving} className="text-sm">
              {isSaving ? "Saving…" : "📌 Save as quick note"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={reset}
              className="text-sm"
            >
              ↩ Different message
            </Button>
          </div>
        </div>
      )}

      {saved && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
          ✓ Quick note saved to session history.
          <button onClick={() => { reset(); setOpen(false); }} className="ml-2 underline">Close</button>
          <button onClick={reset} className="ml-2 underline">Capture another</button>
        </div>
      )}
    </div>
  );
}
