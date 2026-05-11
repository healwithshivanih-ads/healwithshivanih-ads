import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CatalogueTable } from "@/components/catalogue-table";
import { loadAllOfKind } from "@/lib/fmdb/loader";
import { KIND_LABELS, type CatalogueKind } from "@/lib/fmdb/kinds";
import type {
  BaseEntity,
  Topic,
  Mechanism,
  Symptom,
  Supplement,
  Claim,
  Source,
  Protocol,
  TitrationProtocol,
  LabPanel,
  LabTest,
} from "@/lib/fmdb/types";

export const dynamic = "force-dynamic";

export default async function CataloguePage() {
  const [topics, mechanisms, symptoms, supplements, claims, sources, protocols, titrations, labPanels, labTests] =
    await Promise.all([
      loadAllOfKind<Topic>("topics"),
      loadAllOfKind<Mechanism>("mechanisms"),
      loadAllOfKind<Symptom>("symptoms"),
      loadAllOfKind<Supplement>("supplements"),
      loadAllOfKind<Claim>("claims"),
      loadAllOfKind<Source>("sources"),
      loadAllOfKind<Protocol>("protocols"),
      loadAllOfKind<TitrationProtocol>("titration_protocols"),
      loadAllOfKind<LabPanel>("lab_panels"),
      loadAllOfKind<LabTest>("lab_tests"),
    ]);

  // Source records use `id` (not `slug`) and `title` (not `display_name`) on disk.
  // Normalize both for the table + link routing.
  const sourcesNormalized: BaseEntity[] = sources.map((s) => ({
    ...s,
    slug: (s.slug ?? s.id) as string,
    display_name: s.display_name ?? s.title,
  }));

  const counts: Record<CatalogueKind, number> = {
    topics: topics.length,
    mechanisms: mechanisms.length,
    symptoms: symptoms.length,
    supplements: supplements.length,
    protocols: protocols.length,
    titration_protocols: titrations.length,
    lab_panels: labPanels.length,
    lab_tests: labTests.length,
    claims: claims.length,
    sources: sources.length,
    cooking_adjustments: 0,
    home_remedies: 0,
    mindmaps: 0,
    drug_depletions: 0,
  };

  const tabOrder: CatalogueKind[] = [
    "topics",
    "mechanisms",
    "symptoms",
    "supplements",
    "protocols",
    "titration_protocols",
    "lab_panels",
    "lab_tests",
    "claims",
    "sources",
  ];

  const tabContent: Record<string, BaseEntity[]> = {
    topics,
    mechanisms,
    symptoms,
    supplements,
    protocols: protocols as unknown as BaseEntity[],
    titration_protocols: titrations as unknown as BaseEntity[],
    lab_panels: labPanels as unknown as BaseEntity[],
    lab_tests: labTests as unknown as BaseEntity[],
    claims,
    sources: sourcesNormalized,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Catalogue</h1>
        <p className="text-muted-foreground mt-1">
          Browse the knowledge base. Click any row for full detail.
        </p>
      </div>

      <Tabs defaultValue="topics" className="w-full">
        <TabsList>
          {tabOrder.map((kind) => {
            const meta = KIND_LABELS[kind];
            return (
              <TabsTrigger key={kind} value={kind} title={meta.description}>
                <span className="mr-1">{meta.emoji}</span>
                {meta.plural} ({counts[kind]})
              </TabsTrigger>
            );
          })}
        </TabsList>

        {tabOrder.map((kind) => {
          const meta = KIND_LABELS[kind];
          return (
            <TabsContent key={kind} value={kind} className="space-y-3">
              <p className="text-xs text-muted-foreground italic">{meta.description}</p>
              <CatalogueTable kind={kind} rows={tabContent[kind]} />
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
