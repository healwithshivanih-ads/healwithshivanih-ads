import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CatalogueTable } from "@/components/catalogue-table";
import { loadAllOfKind } from "@/lib/fmdb/loader";
import type {
  BaseEntity,
  Topic,
  Mechanism,
  Symptom,
  Supplement,
  Claim,
  Source,
} from "@/lib/fmdb/types";

export const dynamic = "force-dynamic";

export default async function CataloguePage() {
  const [topics, mechanisms, symptoms, supplements, claims, sources] =
    await Promise.all([
      loadAllOfKind<Topic>("topics"),
      loadAllOfKind<Mechanism>("mechanisms"),
      loadAllOfKind<Symptom>("symptoms"),
      loadAllOfKind<Supplement>("supplements"),
      loadAllOfKind<Claim>("claims"),
      loadAllOfKind<Source>("sources"),
    ]);

  // Source records use `id` (not `slug`) and `title` (not `display_name`) on disk.
  // Normalize both for the table + link routing.
  const sourcesNormalized: BaseEntity[] = sources.map((s) => ({
    ...s,
    slug: (s.slug ?? s.id) as string,
    display_name: s.display_name ?? s.title,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Catalogue</h1>
        <p className="text-muted-foreground mt-1">
          Read-only browser. Click a topic or supplement row for detail.
        </p>
      </div>

      <Tabs defaultValue="topics" className="w-full">
        <TabsList>
          <TabsTrigger value="topics">Topics ({topics.length})</TabsTrigger>
          <TabsTrigger value="mechanisms">
            Mechanisms ({mechanisms.length})
          </TabsTrigger>
          <TabsTrigger value="symptoms">
            Symptoms ({symptoms.length})
          </TabsTrigger>
          <TabsTrigger value="supplements">
            Supplements ({supplements.length})
          </TabsTrigger>
          <TabsTrigger value="claims">Claims ({claims.length})</TabsTrigger>
          <TabsTrigger value="sources">Sources ({sources.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="topics">
          <CatalogueTable kind="topics" rows={topics} />
        </TabsContent>
        <TabsContent value="mechanisms">
          <CatalogueTable kind="mechanisms" rows={mechanisms} />
        </TabsContent>
        <TabsContent value="symptoms">
          <CatalogueTable kind="symptoms" rows={symptoms} />
        </TabsContent>
        <TabsContent value="supplements">
          <CatalogueTable kind="supplements" rows={supplements} />
        </TabsContent>
        <TabsContent value="claims">
          <CatalogueTable kind="claims" rows={claims} />
        </TabsContent>
        <TabsContent value="sources">
          <CatalogueTable kind="sources" rows={sourcesNormalized} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
