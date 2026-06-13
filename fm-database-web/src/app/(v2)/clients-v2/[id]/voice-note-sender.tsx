"use client";

/**
 * VoiceNoteSender — coach-side widget to send a WhatsApp voice note / audio
 * message to a client from the brand (Cloud-API) number.
 *
 * The brand number runs on the WhatsApp Cloud API, so the coach can't open it
 * in the regular WhatsApp app to record a voice note. Instead: record on a
 * phone (or any device), get the file onto this machine, pick it here, and it's
 * uploaded inline (base64) to the WA server's /api/send `type:audio` path,
 * which registers a Meta media id and sends it.
 *
 * Constraints (surfaced to the coach, not hidden):
 *   • Free-text → only delivers inside the 24h service window (the client must
 *     have messaged you in the last 24h). Closed window → clear error.
 *   • Only OGG/Opus renders as a true push-to-talk voice-note bubble; other
 *     formats play as an audio-file attachment.
 */

import { useRef, useState } from "react";
import { FmPanel } from "@/components/fm";
import { sendVoiceNoteAction } from "@/app/api/whatsapp/actions";

interface Props {
  clientId: string;
  displayName?: string | null;
}

// 16 MB raw guard — WA server's JSON body limit is 5 MB and base64 inflates
// ~33%, so cap the raw file well under that (a 60s voice note is ~0.5 MB).
const MAX_BYTES = 3.5 * 1024 * 1024;

const OGG_HINT = "audio/ogg";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function VoiceNoteSender({ clientId, displayName }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const isOgg = file?.type === "audio/ogg" || /\.(ogg|oga|opus)$/i.test(file?.name ?? "");

  const onPick = (f: File | null) => {
    setError("");
    setSent(false);
    if (f && f.size > MAX_BYTES) {
      setError(`That file is ${(f.size / 1024 / 1024).toFixed(1)} MB — too large. Keep voice notes under ~3 MB.`);
      setFile(null);
      return;
    }
    setFile(f);
  };

  const send = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const audioBase64 = await fileToBase64(file);
      const res = await sendVoiceNoteAction({
        clientId,
        audioBase64,
        audioMimeType: file.type || OGG_HINT,
      });
      if (res.ok) {
        setSent(true);
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
      } else {
        setError(res.error ?? "Send failed");
      }
    } catch (e) {
      setError((e as Error).message ?? "Send failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FmPanel
      title="🎙 Send a voice note"
      subtitle={`A personal audio message to ${displayName || "this client"} — sent from your WhatsApp number`}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.ogg,.oga,.opus,.m4a,.mp3,.aac,.amr"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          style={{ fontSize: 14 }}
        />

        {file && (
          <div style={{ fontSize: 13, color: "var(--fm-muted, #6b7280)" }}>
            Selected: <strong>{file.name}</strong> ({(file.size / 1024).toFixed(0)} KB)
            {!isOgg && (
              <span style={{ display: "block", marginTop: 4, color: "#9a6a00" }}>
                ⚠ Not OGG/Opus — this will play as an audio file, not a voice-note bubble. For the
                voice-note look, convert first:{" "}
                <code style={{ fontSize: 12 }}>ffmpeg -i in.m4a -c:a libopus -b:a 32k out.ogg</code>
              </span>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={send}
            disabled={!file || busy}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: !file || busy ? "#c7cdd6" : "#2B2D42",
              color: "#fff",
              fontWeight: 600,
              cursor: !file || busy ? "default" : "pointer",
            }}
          >
            {busy ? "Sending…" : "Send voice note"}
          </button>
          {sent && <span style={{ color: "#2f7a3f", fontWeight: 600 }}>✓ Sent</span>}
        </div>

        {error && (
          <div style={{ color: "#b3261e", fontSize: 13, lineHeight: 1.5 }}>{error}</div>
        )}

        <p style={{ fontSize: 12, color: "var(--fm-muted, #6b7280)", lineHeight: 1.5, margin: 0 }}>
          Voice notes only deliver inside the <strong>24-hour window</strong> — the client must have
          messaged you in the last 24h. If the window is closed you&apos;ll see a note here; send the
          app-invite template first and reply once they engage.
        </p>
      </div>
    </FmPanel>
  );
}
