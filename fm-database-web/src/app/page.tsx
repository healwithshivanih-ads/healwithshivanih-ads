import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">FM Coach</h1>
        <p className="text-muted-foreground mt-1">
          Functional Medicine catalogue + plan editor (Path B — Next.js scaffold).
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/catalogue">
          <Card className="hover:bg-accent/40 transition-colors h-full">
            <CardHeader>
              <CardTitle>Catalogue</CardTitle>
              <CardDescription>
                Browse topics, mechanisms, symptoms, supplements, claims, and
                sources. Read-only.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/plans">
          <Card className="hover:bg-accent/40 transition-colors h-full">
            <CardHeader>
              <CardTitle>Plans</CardTitle>
              <CardDescription>
                Drafts, ready-to-publish, published, superseded, and revoked
                plans. Read-only.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What this is</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            This UI reads YAML directly from the sibling{" "}
            <code className="font-mono">fm-database/data/</code> catalogue and
            from <code className="font-mono">~/fm-plans/</code>. The Python
            engine still owns validation, ingest, and the AI suggester.
          </p>
          <p>
            The Streamlit app at{" "}
            <code className="font-mono">fm-database/fmdb_ui/app.py</code> stays
            alive as the production surface during this migration.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
