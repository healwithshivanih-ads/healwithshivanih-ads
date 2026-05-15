import { IngestClient } from "./ingest-client";
import { CatalogueIngestPanel } from "@/components/catalogue-ingest-panel";
import { FmAppShell } from "@/components/fm";

export const dynamic = "force-dynamic";

export default function IngestPage() {
  return (
    <FmAppShell activeNavId="ingest" crumbs={[{ label: "Ingest" }]}>
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">⬆️ Ingest</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Upload a PDF or Markdown file to extract catalogue entities (topics, mechanisms,
          symptoms, supplements, claims) using Claude. Review the staging batch before
          promoting to canonical.
        </p>
      </div>

      {/* Cost + time notice */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 space-y-1">
        <div className="font-semibold">⏱ Ingest takes 1–5 minutes and costs ~$0.10–0.50 per PDF</div>
        <div>
          Claude extracts entities, stages them for review. <strong>Nothing is written to the
          catalogue</strong> until you click Approve. Use &ldquo;Smart-merge&rdquo; to update existing
          entries rather than overwrite them.
        </div>
      </div>

      <IngestClient />

      {/* 📚 Catalogue paste-ingest — moved from dashboard 2026-05-15.
          Drop YAML from a Claude.ai subscription chat into the textarea
          and run it through the same validator without spending API credit
          on synthesis. Better home than the dashboard since both flows
          (file upload above + paste below) belong to the same surface. */}
      <CatalogueIngestPanel />
    </div>
    </FmAppShell>
  );
}
