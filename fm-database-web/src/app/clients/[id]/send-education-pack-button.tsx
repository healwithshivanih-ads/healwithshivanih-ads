"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { sendEducationPackAction } from "@/app/api/email/actions";

interface Props {
  clientId: string;
  clientEmail?: string;
  clientName?: string;
  /** Topics from the client's assessment sessions — slug + display name */
  assessmentTopics: Array<{ slug: string; label: string }>;
  /** All catalogue topics for manual add */
  allTopics: Array<{ slug: string; display_name: string }>;
}

export function SendEducationPackButton({
  clientId,
  clientEmail,
  clientName,
  assessmentTopics,
  allTopics,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg border hover:bg-muted/50 transition-all flex items-center gap-1.5"
      >
        📚 Send education pack
      </button>
      {open && (
        <EducationPackModal
          clientId={clientId}
          clientEmail={clientEmail}
          clientName={clientName}
          assessmentTopics={assessmentTopics}
          allTopics={allTopics}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function EducationPackModal({
  clientId,
  clientEmail,
  clientName,
  assessmentTopics,
  allTopics,
  onClose,
}: Props & { onClose: () => void }) {
  const [step, setStep] = useState<"select" | "sending" | "done">("select");
  const [selected, setSelected] = useState<Set<string>>(
    new Set(assessmentTopics.map((t) => t.slug))
  );
  const [to, setTo] = useState(clientEmail ?? "");
  const [search, setSearch] = useState("");
  const [sentTopics, setSentTopics] = useState<string[]>([]);

  const toggle = (slug: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  // Topics shown: always show assessment topics first, then filtered catalogue topics
  const extraTopics = allTopics.filter(
    (t) =>
      !assessmentTopics.some((a) => a.slug === t.slug) &&
      (search.length < 2 ||
        t.display_name.toLowerCase().includes(search.toLowerCase()) ||
        t.slug.includes(search.toLowerCase()))
  );

  const handleSend = useCallback(async () => {
    if (!to.trim()) { toast.error("Enter the client's email address"); return; }
    if (selected.size === 0) { toast.error("Select at least one topic"); return; }

    setStep("sending");
    const res = await sendEducationPackAction({
      clientId,
      clientEmail: to.trim(),
      clientName,
      topicSlugs: Array.from(selected),
    });

    if (res.ok) {
      setSentTopics(res.sentTopics ?? []);
      setStep("done");
      toast.success(`Education pack sent to ${to}`);
    } else {
      toast.error(res.error ?? "Failed to send");
      setStep("select");
    }
  }, [to, selected, clientId, clientName]);

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div className="bg-background rounded-2xl shadow-2xl border w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="font-semibold text-sm flex items-center gap-2">
            <span>📚</span>
            <span>Send education pack</span>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Done state */}
        {step === "done" && (
          <div className="flex flex-col items-center justify-center gap-4 p-10 text-center">
            <div className="text-4xl">✅</div>
            <div className="font-semibold">Education pack sent!</div>
            <div className="text-sm text-muted-foreground">Sent to {to}</div>
            <div className="text-xs text-muted-foreground">
              {sentTopics.length} brief{sentTopics.length !== 1 ? "s" : ""}:{" "}
              {sentTopics.map((s) => s.replace(/-/g, " ")).join(", ")}
            </div>
            <button
              onClick={onClose}
              className="mt-2 text-sm px-4 py-2 rounded-lg border hover:bg-muted/50"
            >
              Close
            </button>
          </div>
        )}

        {/* Sending state */}
        {step === "sending" && (
          <div className="flex flex-col items-center justify-center gap-4 p-10 text-center">
            <div className="text-3xl animate-spin">⏳</div>
            <div className="font-semibold text-sm">Generating briefs…</div>
            <div className="text-xs text-muted-foreground max-w-xs">
              Writing {selected.size} topic brief{selected.size !== 1 ? "s" : ""} using trusted medical sources.
              This takes about {selected.size * 30}–{selected.size * 60} seconds.
            </div>
          </div>
        )}

        {/* Select state */}
        {step === "select" && (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Email field */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Send to
                </label>
                <input
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="client@example.com"
                  className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                {!clientEmail && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    No email saved for this client — save one on the client page to pre-fill.
                  </p>
                )}
              </div>

              {/* Assessment topics */}
              {assessmentTopics.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                    <span>🧠</span> From this client&apos;s assessments
                    <span className="ml-auto text-[10px] font-normal normal-case text-muted-foreground">
                      {Array.from(selected).filter((s) => assessmentTopics.some((a) => a.slug === s)).length} selected
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {assessmentTopics.map((t) => (
                      <label
                        key={t.slug}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer hover:bg-muted/30 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(t.slug)}
                          onChange={() => toggle(t.slug)}
                          className="rounded"
                        />
                        <span className="text-sm font-medium flex-1">{t.label}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{t.slug}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Additional topics from catalogue */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                  <span>📖</span> Add more topics
                </div>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search catalogue topics…"
                  className="w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 mb-2"
                />
                {search.length >= 2 && (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {extraTopics.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-2">No matches for &ldquo;{search}&rdquo;</p>
                    ) : (
                      extraTopics.slice(0, 20).map((t) => (
                        <label
                          key={t.slug}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer hover:bg-muted/30 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(t.slug)}
                            onChange={() => toggle(t.slug)}
                            className="rounded"
                          />
                          <span className="text-sm flex-1">{t.display_name}</span>
                        </label>
                      ))
                    )}
                  </div>
                )}
                {search.length < 2 && (
                  <p className="text-xs text-muted-foreground px-1">
                    Type 2+ characters to search all {allTopics.length} catalogue topics.
                  </p>
                )}
              </div>

              {/* Selected summary */}
              {selected.size > 0 && (
                <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
                  <div className="text-xs font-semibold text-muted-foreground mb-1.5">
                    {selected.size} topic{selected.size !== 1 ? "s" : ""} selected
                    <span className="font-normal ml-1">· est. {Math.round(selected.size * 0.5 * 10) / 10}–{selected.size} min to generate</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(selected).map((slug) => {
                      const label =
                        assessmentTopics.find((t) => t.slug === slug)?.label ??
                        allTopics.find((t) => t.slug === slug)?.display_name ??
                        slug;
                      return (
                        <span
                          key={slug}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border bg-white"
                        >
                          {label}
                          <button
                            onClick={() => toggle(slug)}
                            className="text-muted-foreground hover:text-destructive leading-none"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 px-5 py-4 border-t shrink-0">
              <button
                onClick={onClose}
                className="text-sm px-3 py-1.5 rounded-lg border hover:bg-muted/50"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={selected.size === 0 || !to.trim()}
                className="text-sm font-semibold px-4 py-1.5 rounded-lg text-white transition-all hover:opacity-90 disabled:opacity-40"
                style={{ background: "var(--brand-indigo)" }}
              >
                📤 Generate &amp; send {selected.size > 0 ? `(${selected.size} topic${selected.size !== 1 ? "s" : ""})` : ""}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
