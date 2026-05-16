"use client";

/**
 * CatalogueIngestPanel — paste-the-AI-reply receiver, dashboard surface.
 *
 * Coach uses a separate Claude.ai / ChatGPT subscription chat to author
 * catalogue YAML batches (cheap, no API spend). She copies the AI's
 * reply, pastes here, hits "Run ingest" — the receiver writes every
 * `# path: data/…` YAML block to disk and runs fmdb validate +
 * pending-refs server-side.
 *
 * Surfaces the structured result inline: files written, forward refs
 * the AI flagged, validate verdict, pending-refs backlog (informational
 * so the coach doesn't think the existing catalogue noise is "her"
 * problem).
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ingestFromPasteAction,
  type IngestFromPasteResult,
} from "@/lib/server-actions/catalogue-ingest";
import { FmPanel } from "@/components/fm";
import { CATALOGUE_INGEST_BRIEFING } from "@/lib/catalogue-ingest-briefing";

export function CatalogueIngestPanel() {
  const [pasteText, setPasteText] = useState("");
  const [stagingBatch, setStagingBatch] = useState("");
  const [useStaging, setUseStaging] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<IngestFromPasteResult | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [setupCopied, setSetupCopied] = useState(false);

  const onCopySetup = async () => {
    try {
      await navigator.clipboard.writeText(CATALOGUE_INGEST_BRIEFING);
      setSetupCopied(true);
      toast.success("Setup prompt copied — paste it as the first message in your AI chat");
      window.setTimeout(() => setSetupCopied(false), 4000);
    } catch {
      toast.error("Clipboard blocked — open the prompt below and copy manually");
      setShowSetup(true);
    }
  };

  const onRun = () => {
    if (!pasteText.trim()) {
      toast.error("Paste the AI's reply first");
      return;
    }
    setResult(null);
    startTransition(async () => {
      const r = await ingestFromPasteAction(
        pasteText,
        useStaging ? stagingBatch : undefined,
      );
      setResult(r);
      if (r.ok) {
        toast.success(`✓ ${r.filesWritten.length} file${r.filesWritten.length === 1 ? "" : "s"} written + validated`);
      } else {
        toast.error(r.error ?? "Ingest failed — see panel for details");
      }
    });
  };

  const onReset = () => {
    setPasteText("");
    setResult(null);
  };

  return (
    <FmPanel
      title="📚 Catalogue paste-ingest"
      subtitle="Drop the AI chat's YAML output here — no terminal needed"
    >
      <div style={{ display: "grid", gap: 10 }}>
        <p style={{ fontSize: 11.5, color: "var(--fm-text-secondary)", margin: 0 }}>
          Paste the full reply from your Claude.ai / ChatGPT subscription chat —
          every fenced <code>```yaml</code> block with a <code># path: data/…</code>
          header gets written to disk, then validated.
        </p>

        {/* Setup-prompt helper. New ingest chats need the briefing as
            their first message so the AI knows the catalogue schema +
            output format. One-click copy avoids hunting through past
            conversations to find it. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            padding: "8px 10px",
            background: "var(--fm-bg-warm, rgba(0,0,0,0.03))",
            border: "1px dashed var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 11.5,
          }}
        >
          <span style={{ color: "var(--fm-text-secondary)" }}>
            <strong>First time with a new chat?</strong> Paste the setup
            briefing as the chat&apos;s first message, then send your document.
          </span>
          <button
            type="button"
            onClick={onCopySetup}
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "5px 10px",
              background: setupCopied ? "var(--fm-success, #1E8449)" : "var(--fm-text-primary, #1a1a1a)",
              color: "white",
              border: 0,
              borderRadius: "var(--fm-radius-sm)",
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            {setupCopied ? "✓ Copied" : "📋 Copy setup prompt"}
          </button>
          <button
            type="button"
            onClick={() => setShowSetup((v) => !v)}
            style={{
              fontSize: 11,
              background: "none",
              border: 0,
              color: "var(--fm-text-tertiary)",
              cursor: "pointer",
              textDecoration: "underline",
              padding: 0,
            }}
          >
            {showSetup ? "hide" : "preview"}
          </button>
        </div>
        {showSetup && (
          <textarea
            readOnly
            value={CATALOGUE_INGEST_BRIEFING}
            spellCheck={false}
            rows={10}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              width: "100%",
              fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
              fontSize: 11,
              padding: 10,
              border: "1px solid var(--fm-border-light)",
              borderRadius: "var(--fm-radius-sm)",
              background: "var(--fm-surface)",
              color: "var(--fm-text-secondary)",
              resize: "vertical",
              maxHeight: 360,
            }}
          />
        )}

        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={`Paste the AI's reply. Each YAML block should start with:\n\`\`\`yaml\n# path: data/topics/<slug>.yaml\nslug: …\n\`\`\``}
          rows={8}
          spellCheck={false}
          disabled={pending}
          style={{
            width: "100%",
            fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
            fontSize: 11.5,
            padding: 10,
            border: "1px solid var(--fm-border-light)",
            borderRadius: "var(--fm-radius-sm)",
            resize: "vertical",
            minHeight: 120,
            background: "var(--fm-surface)",
          }}
        />

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={useStaging}
              onChange={(e) => setUseStaging(e.target.checked)}
              disabled={pending}
            />
            <span>Stage first (safer for big batches)</span>
          </label>
          {useStaging && (
            <input
              type="text"
              value={stagingBatch}
              onChange={(e) => setStagingBatch(e.target.value)}
              placeholder="batch-id e.g. vitaone-thyroid-ch3"
              disabled={pending}
              style={{
                flex: 1,
                minWidth: 200,
                fontSize: 12,
                padding: "5px 8px",
                border: "1px solid var(--fm-border-light)",
                borderRadius: 4,
                fontFamily: "ui-monospace, monospace",
              }}
            />
          )}
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button
              type="button"
              onClick={onReset}
              disabled={pending || !pasteText}
              style={{
                fontSize: 12,
                padding: "6px 12px",
                background: "transparent",
                color: "var(--fm-text-secondary)",
                border: "1px solid var(--fm-border)",
                borderRadius: "var(--fm-radius-sm)",
                cursor: pending ? "wait" : "pointer",
                fontFamily: "inherit",
              }}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={onRun}
              disabled={pending || !pasteText.trim() || (useStaging && !stagingBatch.trim())}
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: "6px 14px",
                background: pending ? "var(--fm-border)" : "var(--fm-primary, #1E8449)",
                color: "white",
                border: 0,
                borderRadius: "var(--fm-radius-sm)",
                cursor: pending ? "wait" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {pending ? "⏳ Running…" : "▶ Run ingest"}
            </button>
          </div>
        </div>

        {result && (
          <ResultPanel
            result={result}
            // Auto-expand the raw log on failure when there's no extracted
            // error to surface — coach was seeing "✗ failed" with nothing
            // to act on. Show the log so she can read what fmdb validate
            // actually said.
            showRaw={
              showRaw ||
              (!result.ok && !result.validateOk && !result.validateError && !result.error)
            }
            onToggleRaw={() => setShowRaw((v) => !v)}
          />
        )}
      </div>
    </FmPanel>
  );
}

function ResultPanel({
  result,
  showRaw,
  onToggleRaw,
}: {
  result: IngestFromPasteResult;
  showRaw: boolean;
  onToggleRaw: () => void;
}) {
  const verdict = result.ok
    ? { label: "✓ Ingest complete", bg: "rgba(30,132,73,0.08)", border: "rgba(30,132,73,0.35)", color: "#14532d" }
    : { label: "✗ Ingest had issues", bg: "rgba(176,70,70,0.08)", border: "rgba(176,70,70,0.35)", color: "#7f1d1d" };

  return (
    <div
      style={{
        marginTop: 4,
        padding: "10px 12px",
        background: verdict.bg,
        border: `1px solid ${verdict.border}`,
        borderRadius: "var(--fm-radius-sm)",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
        <strong style={{ fontSize: 13, color: verdict.color }}>{verdict.label}</strong>
        <button
          type="button"
          onClick={onToggleRaw}
          style={{
            fontSize: 11,
            background: "none",
            border: 0,
            color: "var(--fm-text-tertiary)",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {showRaw ? "hide raw log" : "show raw log"}
        </button>
      </div>

      {result.error && (
        <div style={{ fontSize: 12, color: "#7f1d1d" }}>{result.error}</div>
      )}

      {result.filesWritten.length > 0 && (
        <section>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--fm-text-tertiary)", marginBottom: 4 }}>
            Files written ({result.filesWritten.length})
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, fontFamily: "ui-monospace, monospace", color: "var(--fm-text-secondary)" }}>
            {result.filesWritten.slice(0, 25).map((f) => (
              <li key={f.path}>{f.path}</li>
            ))}
            {result.filesWritten.length > 25 && (
              <li style={{ fontStyle: "italic", listStyle: "none" }}>… +{result.filesWritten.length - 25} more</li>
            )}
          </ul>
        </section>
      )}

      {Object.keys(result.missingDependencies).length > 0 && (
        <section>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#8a5a08", marginBottom: 4 }}>
            ⚠ Forward references — stub these before approving
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5 }}>
            {Object.entries(result.missingDependencies).map(([kind, items]) => (
              <li key={kind}>
                <strong>{kind}:</strong> {items.join(", ")}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11.5 }}>
        <span>
          <strong>Validate:</strong>{" "}
          {result.validateOk ? (
            <span style={{ color: "#1E8449" }}>
              ✓ valid
              {result.validateWarnings != null && ` (${result.validateWarnings} warnings, non-blocking)`}
            </span>
          ) : (
            <span style={{ color: "#a32c1c" }}>✗ failed</span>
          )}
        </span>
        {result.pendingRefsBacklog != null && (
          <span title="Catalogue-wide backlog of unresolved cross-references. Not from this ingest.">
            <strong>Catalogue backlog:</strong>{" "}
            <span style={{ color: "var(--fm-text-secondary)" }}>
              ~{result.pendingRefsBacklog} pending refs (informational)
            </span>
          </span>
        )}
      </section>

      {result.validateError && (
        <section>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#7f1d1d", marginBottom: 4 }}>
            Validation error
          </div>
          <pre style={{ margin: 0, fontSize: 11, fontFamily: "ui-monospace, monospace", color: "#7f1d1d", whiteSpace: "pre-wrap" }}>
            {result.validateError}
          </pre>
        </section>
      )}

      {result.ok && (
        <p style={{ fontSize: 11.5, color: "var(--fm-text-secondary)", margin: 0 }}>
          Next: open Terminal in <code>~/code/healwithshivanih-ads/fm-database</code>{" "}
          → <code>git diff data/</code> to inspect → <code>git add</code> + commit.
        </p>
      )}

      {showRaw && (
        <pre
          style={{
            margin: 0,
            fontSize: 10.5,
            fontFamily: "ui-monospace, monospace",
            background: "var(--fm-surface)",
            border: "1px solid var(--fm-border-light)",
            borderRadius: 4,
            padding: 8,
            maxHeight: 240,
            overflow: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {result.rawOutput || "(no log)"}
        </pre>
      )}
    </div>
  );
}
