"use client";

/**
 * FollowUpDraftPanel — shown after any session is saved.
 * Calls Claude Haiku to draft a warm WhatsApp follow-up message,
 * then shows it with a one-click copy button.
 */

import { useState } from "react";
import { toast } from "sonner";
import { draftFollowUpMessageAction } from "@/lib/server-actions/clients";

interface Props {
  clientId: string;
  sessionId: string;
  sessionType: "discovery" | "intake" | "check_in" | "quick_note";
}

export function FollowUpDraftPanel({ clientId, sessionId, sessionType }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const handleDraft = async () => {
    setState("loading");
    setError("");
    try {
      const res = await draftFollowUpMessageAction(clientId, sessionId, sessionType);
      if (res.ok && res.message) {
        setMessage(res.message);
        setState("done");
      } else {
        setError(res.error ?? "Draft generation failed");
        setState("error");
      }
    } catch (e) {
      setError(String(e));
      setState("error");
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      toast.success("Message copied — paste into WhatsApp");
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast.error("Copy failed — select the text manually");
    }
  };

  if (state === "idle") {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
        <span className="text-sm">💬</span>
        <p className="text-xs text-emerald-800 flex-1">
          Draft a WhatsApp follow-up message for this session
        </p>
        <button
          onClick={handleDraft}
          className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
        >
          Draft message
        </button>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
        <span className="animate-spin text-sm">⏳</span>
        <p className="text-xs text-emerald-700">Drafting WhatsApp message…</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
        <p className="text-xs text-red-700 flex-1">Draft failed: {error}</p>
        <button
          onClick={handleDraft}
          className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md border hover:bg-muted transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // done
  return (
    <div className="space-y-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-emerald-900">💬 WhatsApp draft</span>
        <div className="flex gap-2">
          <button
            onClick={handleDraft}
            className="text-[11px] text-muted-foreground hover:text-foreground underline"
          >
            Regenerate
          </button>
          <button
            onClick={handleCopy}
            className={`text-xs font-semibold px-3 py-1 rounded-md transition-colors ${
              copied
                ? "bg-emerald-700 text-white"
                : "bg-emerald-100 text-emerald-900 hover:bg-emerald-200 border border-emerald-300"
            }`}
          >
            {copied ? "✓ Copied!" : "📋 Copy"}
          </button>
        </div>
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        className="w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-emerald-400 leading-relaxed"
      />
      <p className="text-[10px] text-emerald-700">
        Edit freely before copying — AI draft, you send it.
      </p>
    </div>
  );
}
