"use server";

/**
 * Zoom recording-event processor — invoked async from /api/zoom-webhook
 * after the response is sent. Walks: match → download → save → extract.
 *
 * Each phase is best-effort + logs to stdout (pm2 stream). Failures
 * don't surface as 5xx because Zoom is already done with us.
 *
 * Phases:
 *   1. matchClientFromMeeting(meeting) — host_email + attendee_email +
 *      topic-fuzzy match against scheduled cal.com bookings
 *   2. downloadTranscript(meeting, downloadToken) — fetches .vtt from
 *      Zoom's transient `download_url` (the token is short-lived and
 *      comes WITH the webhook payload — no OAuth call needed for the
 *      download itself)
 *   3. saveSessionFromTranscript(clientId, meeting, transcriptText) —
 *      creates a quick_note session YAML with `[source: zoom_transcript]`
 *      and the cleaned plain-text transcript
 *   4. runExtractionPipeline(clientId, sessionId, transcriptText) —
 *      runs the existing extract-symptoms.py + parse-health-text.py
 *      shims on the transcript and merges results into client.yaml
 *      with `requires_review: true` flag
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { loadAllClients } from "@/lib/fmdb/loader";

interface ZoomMeetingObject {
  uuid?: string;
  id?: number | string;
  host_id?: string;
  host_email?: string;
  topic?: string;
  start_time?: string;
  duration?: number;
  recording_files?: Array<{
    id?: string;
    file_type?: string;
    file_extension?: string;
    download_url?: string;
    recording_type?: string;
    recording_start?: string;
    status?: string;
  }>;
}

export interface ProcessZoomRecordingInput {
  event: "recording.completed" | "recording.transcript_completed";
  meeting: ZoomMeetingObject;
  download_token?: string;
}

export async function processZoomRecording(
  input: ProcessZoomRecordingInput,
): Promise<void> {
  const { event, meeting, download_token } = input;
  const uuid = meeting.uuid;
  if (!uuid) {
    console.warn("[zoom-recording] event missing meeting.uuid — skipping");
    return;
  }

  // ── 1. Match meeting → client ──────────────────────────────────────────
  const clientId = await matchClient(meeting);
  if (!clientId) {
    await appendUnmatched(input);
    console.warn("[zoom-recording] unmatched meeting", {
      uuid,
      topic: meeting.topic,
      host_email: meeting.host_email,
    });
    return;
  }

  // ── 2. Find the transcript file in the recording_files array ──────────
  // recording.completed sometimes fires before transcript is ready; the
  // separate recording.transcript_completed event fires when transcription
  // is done. Either event can contain TRANSCRIPT entries — we just look
  // for one and skip if absent (the next event will retry).
  const transcriptFile = meeting.recording_files?.find(
    (f) => f.file_type === "TRANSCRIPT" || f.file_extension?.toLowerCase() === "vtt",
  );
  const audioFile = meeting.recording_files?.find(
    (f) => f.file_type === "M4A" || f.file_extension?.toLowerCase() === "m4a",
  );

  if (!transcriptFile?.download_url) {
    console.log("[zoom-recording] no transcript yet for", uuid, "— waiting for next event");
    return;
  }

  // ── 3. Download transcript + audio ───────────────────────────────────
  const recordingDir = path.join(
    getPlansRoot(),
    "clients",
    clientId,
    "recordings",
    uuid.replace(/[^A-Za-z0-9_-]/g, "_"),
  );
  await fs.mkdir(recordingDir, { recursive: true });

  const transcriptText = await downloadAndSave({
    url: transcriptFile.download_url,
    downloadToken: download_token,
    destPath: path.join(recordingDir, "transcript.vtt"),
  });

  if (audioFile?.download_url) {
    await downloadAndSave({
      url: audioFile.download_url,
      downloadToken: download_token,
      destPath: path.join(recordingDir, "audio.m4a"),
    }).catch((err) => {
      console.warn("[zoom-recording] audio download failed (non-fatal)", err);
    });
  }

  if (!transcriptText) {
    console.warn("[zoom-recording] transcript download returned empty", uuid);
    return;
  }

  // Strip WebVTT cue headers + timestamps → plain text for AI extraction
  const plainText = vttToPlainText(transcriptText);
  await fs.writeFile(path.join(recordingDir, "transcript.txt"), plainText, "utf-8");

  // ── 4. Create the session record ─────────────────────────────────────
  const sessionId = await createSessionFromTranscript({
    clientId,
    meeting,
    plainText,
    recordingDir,
  });

  // ── 5. AI extraction pipeline ────────────────────────────────────────
  if (process.env.ANTHROPIC_API_KEY) {
    void runExtractionPipeline(clientId, sessionId, plainText).catch((err) => {
      console.warn("[zoom-recording] extraction failed (non-fatal)", err);
    });
  } else {
    console.log("[zoom-recording] ANTHROPIC_API_KEY not set — skipping extraction");
  }
}

async function matchClient(meeting: ZoomMeetingObject): Promise<string | null> {
  const clients = (await loadAllClients()) as Array<Record<string, unknown>>;
  const normaliseEmail = (e: string | undefined | null) =>
    (e ?? "").trim().toLowerCase();
  const topicLower = (meeting.topic ?? "").toLowerCase();

  // 1. Match by host_email — if coach scheduled meeting personally + host
  //    email is in the client record, that's a strong signal.
  const hostEmail = normaliseEmail(meeting.host_email);
  if (hostEmail) {
    for (const c of clients) {
      const cEmail = normaliseEmail(c.email as string | undefined);
      if (cEmail && cEmail === hostEmail) return c.client_id as string;
    }
  }

  // 2. Topic fuzzy-match — cal.com sets the topic to e.g.
  //    "Coaching Session between Shivani and Dhanishta Shah".
  //    Look for any client display_name appearing as a substring.
  if (topicLower) {
    for (const c of clients) {
      const name = ((c.display_name as string) ?? "").trim().toLowerCase();
      if (!name) continue;
      if (topicLower.includes(name)) return c.client_id as string;
      // Try first-name match as fallback (still requires unique first name)
      const first = name.split(/\s+/)[0];
      if (first && first.length > 2 && topicLower.includes(first)) {
        // Defensive: ensure no OTHER client also matches that first name
        const ambiguous = clients.filter((c2) => {
          const n2 = ((c2.display_name as string) ?? "").toLowerCase().split(/\s+/)[0];
          return n2 === first;
        });
        if (ambiguous.length === 1) return c.client_id as string;
      }
    }
  }

  return null;
}

async function downloadAndSave(opts: {
  url: string;
  downloadToken?: string;
  destPath: string;
}): Promise<string> {
  const headers: Record<string, string> = {};
  if (opts.downloadToken) headers["authorization"] = `Bearer ${opts.downloadToken}`;
  const res = await fetch(opts.url, { headers });
  if (!res.ok) {
    throw new Error(`zoom download failed ${res.status}: ${opts.url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(opts.destPath, buf);
  return buf.toString("utf-8"); // useful for .vtt; binary files just get a weird string but that's discarded
}

/**
 * Convert WebVTT cue text → plain transcript.
 * Drops cue numbers, `WEBVTT` header, `-->` timestamp lines, blank
 * lines, and speaker tag prefixes like `<v Shivani>`.
 */
function vttToPlainText(vtt: string): string {
  return vtt
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (t === "WEBVTT") return false;
      if (/^\d+$/.test(t)) return false; // cue number
      if (/-->/.test(t)) return false; // timestamp line
      return true;
    })
    .map((line) => line.replace(/<\/?v[^>]*>/g, "").trim())
    .filter(Boolean)
    .join("\n");
}

async function createSessionFromTranscript(opts: {
  clientId: string;
  meeting: ZoomMeetingObject;
  plainText: string;
  recordingDir: string;
}): Promise<string> {
  const root = getPlansRoot();
  const sessDir = path.join(root, "clients", opts.clientId, "sessions");
  await fs.mkdir(sessDir, { recursive: true });

  const date = (opts.meeting.start_time ?? new Date().toISOString()).slice(0, 10);
  // Pick a unique session_id within the day
  const existing = await fs.readdir(sessDir).catch(() => [] as string[]);
  const todayCount = existing.filter((n) => n.includes(date)).length;
  const seq = String(todayCount + 1).padStart(3, "0");
  const sessionId = `${opts.clientId}-${date}-${seq}-zoom`;

  const sessionFile = path.join(sessDir, `${sessionId}.yaml`);
  const sessionData = {
    session_id: sessionId,
    client_id: opts.clientId,
    date,
    session_type: "quick_note",
    presenting_complaints: `[session_type: quick_note] [source: zoom_transcript] [meeting_uuid: ${opts.meeting.uuid}]`,
    coach_notes: opts.plainText,
    selected_symptoms: [],
    selected_topics: [],
    measurements_snapshot: {},
    ai_analysis: {
      zoom_meeting: {
        uuid: opts.meeting.uuid,
        topic: opts.meeting.topic,
        host_email: opts.meeting.host_email,
        start_time: opts.meeting.start_time,
        duration: opts.meeting.duration,
        recording_dir: opts.recordingDir,
      },
    },
    chat_log: [],
    requires_review: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    updated_by: "zoom-webhook",
  };
  await fs.writeFile(sessionFile, yaml.dump(sessionData, { sortKeys: false }), "utf-8");
  console.log("[zoom-recording] saved session", sessionId);
  return sessionId;
}

async function runExtractionPipeline(
  clientId: string,
  sessionId: string,
  transcriptText: string,
): Promise<void> {
  // Reuse the existing extract-symptoms.py + parse-health-text.py shims.
  // Both already exist for the assess / health-input flows; we point them
  // at the transcript text and merge into client.yaml the same way.
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const exec = promisify(execFile);
  const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");
  const PYTHON = path.resolve(process.cwd(), "../fm-database/.venv/bin/python");

  // Save transcript to a temp file for shim consumption.
  const tmpDir = path.join(getPlansRoot(), "clients", clientId, "recordings", "_tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const transcriptPath = path.join(tmpDir, `${sessionId}.txt`);
  await fs.writeFile(transcriptPath, transcriptText, "utf-8");

  try {
    // Extraction call — symptom + health-data extraction in one pass.
    // The existing extract-symptoms.py accepts a payload like:
    //   {client_id, transcript_path, symptoms_catalogue_path?}
    // and emits {ok, symptoms:[], health_data:{...}}.
    const child = execFile(PYTHON, [path.join(SCRIPTS_DIR, "extract-symptoms.py")], {
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
      cwd: path.resolve(process.cwd(), "../fm-database"),
    });
    child.stdin?.end(
      JSON.stringify({
        client_id: clientId,
        transcript_path: transcriptPath,
        source_label: "zoom_transcript",
        session_id: sessionId,
      }),
    );
    let stdout = "";
    child.stdout?.on("data", (b) => (stdout += b));
    await new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", () => resolve());
    });
    if (stdout.trim()) {
      const parsed = JSON.parse(stdout) as Record<string, unknown>;
      console.log("[zoom-recording] extraction ok", {
        session: sessionId,
        symptoms: Array.isArray(parsed.symptoms) ? parsed.symptoms.length : 0,
        labs: Array.isArray((parsed.health_data as { lab_values?: unknown[] })?.lab_values)
          ? (parsed.health_data as { lab_values: unknown[] }).lab_values.length
          : 0,
      });
    }
  } catch (err) {
    console.warn("[zoom-recording] extract-symptoms.py failed", err);
  } finally {
    // Touch nothing else — extract-symptoms already merges into client.yaml
    // via the shared apply-transcript-data path used by the Assess flow.
  }
}

async function appendUnmatched(input: ProcessZoomRecordingInput): Promise<void> {
  const root = getPlansRoot();
  const file = path.join(root, "_zoom_unmatched.yaml");
  let arr: unknown[] = [];
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = yaml.load(raw);
    if (Array.isArray(parsed)) arr = parsed;
  } catch { /* missing */ }
  arr.unshift({
    received_at: new Date().toISOString(),
    event: input.event,
    meeting_uuid: input.meeting.uuid,
    topic: input.meeting.topic,
    host_email: input.meeting.host_email,
    start_time: input.meeting.start_time,
    duration: input.meeting.duration,
    note:
      "Zoom recording-completed event for a meeting we couldn't match to a fm-coach client_id. " +
      "Check whether the meeting host_email matches a client's email field, or whether the meeting " +
      "topic contains the client's display_name.",
  });
  arr = arr.slice(0, 100);
  await fs.writeFile(file, yaml.dump(arr, { sortKeys: false }), "utf-8");
}
