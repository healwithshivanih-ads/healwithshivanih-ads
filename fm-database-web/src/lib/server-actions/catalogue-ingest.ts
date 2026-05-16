"use server";

/**
 * Catalogue paste-ingest server action.
 *
 * Bridges the dashboard textarea to scripts/ingest-from-paste.py in the
 * Python repo. The script reads the AI's reply from stdin, writes every
 * fenced YAML block to its declared path, runs `fmdb validate` and
 * `fmdb pending-refs`, and prints a structured summary back to stdout.
 *
 * We re-implement just enough of that script's output parsing here to
 * turn the human-readable text into a clean JSON envelope the UI can
 * render — without forcing the script itself to emit JSON (it stays
 * usable from the terminal as a debugging fallback).
 */

import { execFile } from "node:child_process";
import path from "node:path";

const FMDB_REPO = path.resolve(process.cwd(), "..", "fm-database");
const PYTHON = path.join(FMDB_REPO, ".venv/bin/python");
const SCRIPT = path.join(FMDB_REPO, "scripts/ingest-from-paste.py");

export interface IngestFromPasteResult {
  ok: boolean;
  filesWritten: Array<{ path: string }>;
  missingDependencies: Record<string, string[]>;
  validateOk: boolean;
  validateWarnings: number | null;
  validateError?: string;
  pendingRefsBacklog: number | null;
  pendingRefsPreview: string[];
  rawOutput: string;
  error?: string;
}

export async function ingestFromPasteAction(
  pasteText: string,
  stagingBatch?: string,
): Promise<IngestFromPasteResult> {
  const trimmed = (pasteText ?? "").trim();
  if (!trimmed) {
    return _empty({
      ok: false,
      error: "Nothing to ingest — paste the AI's reply into the textarea first.",
    });
  }

  const args: string[] = [SCRIPT];
  if (stagingBatch && stagingBatch.trim()) {
    args.push("--staging", stagingBatch.trim());
  }

  // execFile + write stdin manually so we can stream a multi-MB paste in.
  // 5-minute timeout — validate over 408 mechanisms + 1500 claims runs
  // well under 30s, so this is just a safety net.
  return new Promise<IngestFromPasteResult>((resolve) => {
    const child = execFile(
      PYTHON,
      args,
      { cwd: FMDB_REPO, timeout: 5 * 60_000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const raw = (stdout || "") + (stderr || "");
        if (err && raw.trim().length === 0) {
          resolve(_empty({
            ok: false,
            error: `Receiver crashed: ${err.message}`,
          }));
          return;
        }
        resolve(_parse(raw, !err));
      },
    );
    child.stdin?.end(pasteText);
  });
}

function _empty(over: Partial<IngestFromPasteResult>): IngestFromPasteResult {
  return {
    ok: false,
    filesWritten: [],
    missingDependencies: {},
    validateOk: false,
    validateWarnings: null,
    pendingRefsBacklog: null,
    pendingRefsPreview: [],
    rawOutput: "",
    ...over,
  };
}

// ─── Parser ──────────────────────────────────────────────────────────────
// The script prints human-readable sections. We strip ANSI, then grep
// each section for the bits the UI cares about. Keeps the script
// debuggable from the terminal AND machine-readable here.
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function _parse(raw: string, processOk: boolean): IngestFromPasteResult {
  const clean = raw.replace(ANSI_RE, "");
  const result = _empty({ ok: false, rawOutput: clean });

  // Files written — lines like "  ✓ data/topics/foo.yaml  (declared: …)"
  for (const m of clean.matchAll(/^\s*✓\s+(data\/[^\s(]+\.yaml)/gm)) {
    result.filesWritten.push({ path: m[1] });
  }
  // Failed writes — "  ✗ <path>"
  for (const m of clean.matchAll(/^\s*✗\s+(data\/[^\s(]+\.yaml)/gm)) {
    result.filesWritten.push({ path: m[1] + "  (FAILED)" });
  }

  // Forward-reference (missing_dependencies) block — "  ⚠ topics: a, b, c"
  // This is in the "Forward references the AI flagged" section.
  const fwdBlock = clean.match(
    /Forward references the AI flagged[^\n]*\n([\s\S]+?)\n→ Running fmdb validate/,
  );
  if (fwdBlock) {
    for (const m of fwdBlock[1].matchAll(/^\s*⚠\s+(\w+):\s+(.+)$/gm)) {
      const kind = m[1].trim();
      const items = m[2].split(",").map((s) => s.trim()).filter(Boolean);
      if (items.length) result.missingDependencies[kind] = items;
    }
  }

  // Validate status — "✓ catalogue valid (N warnings — non-blocking)"
  const valOk = clean.match(/✓ catalogue valid\s*\((\d+)\s*warnings?/);
  if (valOk) {
    result.validateOk = true;
    result.validateWarnings = Number(valOk[1]);
  } else {
    // Script emits the validation block as:
    //
    //   → Running fmdb validate
    //     ✗ validation failed (exit N):
    //       <line 1 of fmdb validate output>
    //       <line 2 of fmdb validate output>
    //       …
    //   <blank>
    //   → Running fmdb pending-refs
    //
    // Capture everything from "✗ validation failed" until either the
    // next "→ Running…" section header OR the final "✓/✗ Ingest" verdict
    // line. Older regex stopped at the first blank line (or `\n→`), which
    // missed indented multi-line errors with embedded blank lines.
    const valErr = clean.match(
      /✗\s*validation failed[^\n]*\n([\s\S]*?)(?=\n\s*→\s*Running|\n\s*✓\s*Ingest|\n\s*✗\s*Ingest|$)/i,
    );
    if (valErr) {
      // Trim leading indentation per line so the panel preformatted
      // block doesn't get a wall of left-padding from the script's
      // formatter.
      const trimmed = valErr[1]
        .split("\n")
        .map((l) => l.replace(/^ {2,6}/, ""))
        .join("\n")
        .trim();
      result.validateError = trimmed || "(validation failed but no detail captured — see raw log)";
    }
  }

  // Pending refs backlog count — "(catalogue-wide backlog: ~N pending refs — informational, …)"
  const back = clean.match(/catalogue-wide backlog:\s*~(\d+)\s*pending refs/);
  if (back) {
    result.pendingRefsBacklog = Number(back[1]);
  } else if (/✓ no unresolved cross-references/.test(clean)) {
    result.pendingRefsBacklog = 0;
  }
  // First few preview lines from the pending-refs section.
  const pendBlock = clean.match(
    /→ Running fmdb pending-refs[\s\S]*?(?:\n→|\n\n✓|\n\n✗|$)/,
  );
  if (pendBlock) {
    const previewMatches = [...pendBlock[0].matchAll(/^\s*⚠\s+(.+)$/gm)];
    result.pendingRefsPreview = previewMatches.slice(0, 8).map((m) => m[1].trim());
  }

  // Final verdict — the script prints "✓ Ingest complete." or "✗ Ingest had errors —".
  if (/✓ Ingest complete\./.test(clean) && processOk) {
    result.ok = true;
  }

  return result;
}
