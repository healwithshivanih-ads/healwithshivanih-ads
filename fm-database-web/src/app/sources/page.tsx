import { SourceClient } from "./source-client";

export default function SourcesPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">📚 Add Source</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Register a book, paper, website, or other reference as a citable source in the catalogue.
          Sources can then be linked to claims, supplements, and topics.
        </p>
      </div>
      <SourceClient />
    </div>
  );
}
