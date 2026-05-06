"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateTopicBrief } from "@/app/clients/actions";

interface Topic {
  slug: string;
  display_name: string;
}

interface Props {
  clientId: string;
  topics: Topic[];
}

interface BriefResult {
  markdown: string;
  html: string | null;
}

function downloadAs(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function TopicBriefButton({ clientId, topics }: Props) {
  const [pending, startTransition] = useTransition();
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [result, setResult] = useState<BriefResult | null>(null);

  const sorted = [...topics].sort((a, b) =>
    a.display_name.localeCompare(b.display_name)
  );

  const selectedTopic = sorted.find((t) => t.slug === selectedSlug);

  const generate = () => {
    if (!selectedSlug) {
      toast.error("Please select a topic first");
      return;
    }
    startTransition(async () => {
      setResult(null);
      toast.info("Generating educational brief… this takes ~30–60s");
      const res = await generateTopicBrief(clientId, selectedSlug);
      if (res.ok && res.markdown) {
        setResult({ markdown: res.markdown, html: res.html ?? null });
        toast.success("Brief ready — download the branded HTML to share");
      } else {
        toast.error(res.error ?? "Failed to generate brief");
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Topic picker */}
        <select
          value={selectedSlug}
          onChange={(e) => {
            setSelectedSlug(e.target.value);
            setResult(null);
          }}
          disabled={pending}
          className="text-xs border rounded px-2 py-1.5 bg-white min-w-[220px] max-w-xs"
        >
          <option value="">— pick a topic —</option>
          {sorted.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.display_name}
            </option>
          ))}
        </select>

        <Button
          size="sm"
          variant="outline"
          className="border-sky-500 text-sky-700 hover:bg-sky-50 text-xs"
          disabled={pending || !selectedSlug}
          onClick={generate}
        >
          {pending ? "✍️ Writing…" : "📚 Generate client brief"}
        </Button>

        {result && (
          <>
            {result.html && (
              <Button
                size="sm"
                variant="outline"
                className="border-indigo-400 text-indigo-700 hover:bg-indigo-50 text-xs font-medium"
                onClick={() =>
                  downloadAs(
                    `${selectedSlug}-brief.html`,
                    result.html!,
                    "text/html"
                  )
                }
              >
                ⬇ Download branded HTML
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={() =>
                downloadAs(
                  `${selectedSlug}-brief.md`,
                  result.markdown,
                  "text/markdown"
                )
              }
            >
              ⬇ Markdown
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-xs"
              onClick={() => setResult(null)}
            >
              Dismiss
            </Button>
          </>
        )}
      </div>

      {selectedSlug && !result && !pending && (
        <p className="text-xs text-muted-foreground">
          Will generate a trusted, evidence-based brief on{" "}
          <strong>{selectedTopic?.display_name}</strong> citing NHS, NIH, WHO,
          ICMR and other government sources — personalised to this client.
        </p>
      )}

      {result && (
        <div className="space-y-1">
          {result.html && (
            <p className="text-xs text-indigo-600">
              ✓ Branded HTML ready — open in Chrome and use{" "}
              <kbd className="bg-muted px-1 rounded text-[10px]">
                Cmd+P → Save as PDF
              </kbd>{" "}
              to share with client.
            </p>
          )}
          <pre className="overflow-auto bg-white border rounded p-3 text-[11px] max-h-[40rem] whitespace-pre-wrap">
            {result.markdown}
          </pre>
        </div>
      )}
    </div>
  );
}
