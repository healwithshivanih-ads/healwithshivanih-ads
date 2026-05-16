"use client";

/**
 * QuickNoteForm — client component for the Quick Note variant.
 *
 * Source chips (Client message · Phone call · Coach observation · WhatsApp ·
 * Email · Other) tag the note so it's discoverable later. Free-text body.
 * Save fires saveSessionAction (the same action the legacy QuickNoteForm
 * uses), then redirects back to the Analyse picker with a success toast.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveSessionAction } from "@/lib/server-actions/assess";
import {
  FmField,
  FmInput,
  FmTextarea,
  FmPillGroup,
  type FmPillOption,
} from "@/components/fm";

const SOURCES: FmPillOption[] = [
  { value: "client_message", label: "💬 Client message" },
  { value: "phone_call",     label: "📞 Phone call" },
  { value: "whatsapp",       label: "🟢 WhatsApp" },
  { value: "email",          label: "✉ Email" },
  { value: "coach",          label: "🧠 Coach observation" },
  { value: "other",          label: "📋 Other" },
];

export function QuickNoteForm({
  clientId,
  displayName,
}: {
  clientId: string;
  displayName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sessionDate, setSessionDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [body, setBody] = useState("");
  const [source, setSource] = useState<string>("coach");

  const onSave = () => {
    if (!body.trim()) {
      toast.error("Write something first");
      return;
    }
    start(async () => {
      const sourceLabel =
        SOURCES.find((s) => s.value === source)?.label ?? "coach";
      const result = await saveSessionAction({
        client_id: clientId,
        session_type: "quick_note",
        session_date: sessionDate,
        // The save-session.py shim reads coach_notes; we store the source
        // tag inline so the timeline view can render the icon back.
        coach_notes: body.trim(),
        presenting_complaints: `[session_type: quick_note] [source: ${source}] ${sourceLabel}`,
      });
      if (result.ok) {
        toast.success(`Quick note saved for ${displayName.split(" ")[0]}`);
        router.push(`/clients-v2/${clientId}/analyse`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Save failed");
      }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Mid-call lookup escape hatch — opens the reference card in a new
          tab so the coach can read off the active protocol while logging
          the note. */}
      <a
        href={`/clients-v2/${clientId}/reference`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          alignSelf: "flex-start",
          padding: "6px 12px",
          background: "rgba(255, 107, 53, 0.08)",
          border: "1px solid rgba(255, 107, 53, 0.35)",
          borderRadius: 6,
          fontSize: 11.5,
          fontWeight: 600,
          color: "var(--fm-primary, #ff6b35)",
          textDecoration: "none",
        }}
        title={`Open ${displayName.split(" ")[0]}'s active plan — supplements, timing, food guidance — in a new tab. Useful when they ask "what time should I take X?" mid-call.`}
      >
        📋 View {displayName.split(" ")[0]}&apos;s active plan reference ↗
      </a>

      <FmField
        label="Date of session"
        hint="Defaults to today — change if you're logging a past session. This date is what shows as 'Last contact'."
      >
        {({ id }) => (
          <FmInput
            id={id}
            type="date"
            value={sessionDate}
            onChange={(e) => setSessionDate(e.target.value)}
            style={{ maxWidth: 200 }}
          />
        )}
      </FmField>

      <FmField label="Source">
        {() => (
          <FmPillGroup
            options={SOURCES}
            value={source}
            onChange={(v) => setSource(v)}
          />
        )}
      </FmField>

      <FmField
        label="Note"
        hint="What just happened? Two lines or two pages — both fine."
      >
        {({ id }) => (
          <FmTextarea
            id={id}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={`e.g. ${displayName.split(" ")[0]} messaged that she's been sleeping 7.5 hrs the past three nights — first time in a year. Magnesium glycinate at 9 PM seems to be landing.`}
            minLength={1}
            rows={6}
          />
        )}
      </FmField>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          paddingTop: 6,
          borderTop: "1px dashed var(--fm-border-light)",
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
            flex: 1,
          }}
        >
          {body.length} characters
        </span>
        <button
          type="button"
          onClick={() => router.push(`/clients-v2/${clientId}/analyse`)}
          style={{
            padding: "8px 14px",
            background: "var(--fm-surface)",
            color: "var(--fm-text-primary)",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={pending || !body.trim()}
          style={{
            padding: "8px 16px",
            background: "var(--fm-primary)",
            color: "#fff",
            border: 0,
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 12,
            fontWeight: 700,
            cursor: pending || !body.trim() ? "not-allowed" : "pointer",
            opacity: pending || !body.trim() ? 0.5 : 1,
            fontFamily: "inherit",
          }}
        >
          {pending ? "Saving…" : "💾 Save quick note"}
        </button>
      </div>
    </div>
  );
}
