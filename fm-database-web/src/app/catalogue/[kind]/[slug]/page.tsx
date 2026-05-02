import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EvidenceTierBadge } from "@/components/evidence-tier-badge";
import { loadOne } from "@/lib/fmdb/loader";
import type { CatalogueKind, Topic, Supplement } from "@/lib/fmdb/types";

const SUPPORTED: ReadonlySet<string> = new Set(["topics", "supplements"]);

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        {title}
      </h3>
      <div>{children}</div>
    </div>
  );
}

function ChipList({ items }: { items?: string[] }) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-muted-foreground italic">None</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <Badge key={it} variant="secondary" className="font-mono text-xs">
          {it}
        </Badge>
      ))}
    </div>
  );
}

function TopicDetail({ topic }: { topic: Topic }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-3xl font-bold">
          {topic.display_name ?? topic.slug}
        </h1>
        <EvidenceTierBadge tier={topic.evidence_tier} />
      </div>
      <p className="font-mono text-xs text-muted-foreground">{topic.slug}</p>

      {topic.summary && (
        <Card>
          <CardContent className="pt-6 text-sm leading-relaxed">
            {topic.summary}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {topic.aliases && topic.aliases.length > 0 && (
          <Section title="Aliases">
            <ChipList items={topic.aliases} />
          </Section>
        )}
        <Section title="Common symptoms">
          <ChipList items={topic.common_symptoms} />
        </Section>
        <Section title="Related topics">
          <ChipList items={topic.related_topics} />
        </Section>
        <Section title="Key mechanisms">
          <ChipList items={topic.key_mechanisms} />
        </Section>
      </div>

      {topic.red_flags && topic.red_flags.length > 0 && (
        <Section title="Red flags">
          <ul className="list-disc pl-5 text-sm space-y-1">
            {topic.red_flags.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Section>
      )}

      {topic.coaching_scope_notes && (
        <Section title="Coaching scope notes">
          <p className="text-sm leading-relaxed">
            {topic.coaching_scope_notes}
          </p>
        </Section>
      )}
      {topic.clinician_scope_notes && (
        <Section title="Clinician scope notes">
          <p className="text-sm leading-relaxed">
            {topic.clinician_scope_notes}
          </p>
        </Section>
      )}

      {topic.sources && topic.sources.length > 0 && (
        <Section title="Sources">
          <ul className="list-disc pl-5 text-sm space-y-1">
            {topic.sources.map((s, i) => (
              <li key={i}>
                <span className="font-mono">{s.id}</span>
                {s.location && (
                  <span className="text-muted-foreground"> — {s.location}</span>
                )}
                {s.quote && (
                  <blockquote className="border-l-2 pl-3 ml-2 mt-1 italic text-muted-foreground">
                    {s.quote}
                  </blockquote>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function SupplementDetail({ supp }: { supp: Supplement }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-3xl font-bold">
          {supp.display_name ?? supp.slug}
        </h1>
        <EvidenceTierBadge tier={supp.evidence_tier} />
        {supp.category && <Badge variant="outline">{supp.category}</Badge>}
      </div>
      <p className="font-mono text-xs text-muted-foreground">{supp.slug}</p>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Forms available">
          <ChipList items={supp.forms_available} />
        </Section>
        <Section title="Timing">
          <ChipList items={supp.timing_options} />
        </Section>
      </div>

      {supp.typical_dose_range && Object.keys(supp.typical_dose_range).length > 0 && (
        <Section title="Typical dose range">
          <div className="border rounded-md p-4 space-y-1 text-sm">
            {Object.entries(supp.typical_dose_range).map(([form, range]) => (
              <div key={form}>
                <span className="font-medium">{form}:</span>{" "}
                {range.min}–{range.max} {range.unit}
              </div>
            ))}
          </div>
        </Section>
      )}

      {supp.contraindications && (
        <Section title="Contraindications">
          <div className="grid gap-3 md:grid-cols-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground mb-1">
                Conditions
              </div>
              <ChipList items={supp.contraindications.conditions} />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">
                Medications
              </div>
              <ChipList items={supp.contraindications.medications} />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">
                Life stages
              </div>
              <ChipList items={supp.contraindications.life_stages} />
            </div>
          </div>
        </Section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Linked topics">
          <ChipList items={supp.linked_to_topics} />
        </Section>
        <Section title="Linked mechanisms">
          <ChipList items={supp.linked_to_mechanisms} />
        </Section>
      </div>

      {supp.notes && (
        <Section title="Notes">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {supp.notes}
          </p>
        </Section>
      )}
    </div>
  );
}

export default async function CatalogueDetailPage({
  params,
}: {
  params: Promise<{ kind: string; slug: string }>;
}) {
  const { kind, slug } = await params;
  if (!SUPPORTED.has(kind)) notFound();

  if (kind === "topics") {
    const topic = await loadOne<Topic>("topics", slug);
    if (!topic) notFound();
    return (
      <div>
        <Link
          href="/catalogue"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to catalogue
        </Link>
        <div className="mt-4">
          <TopicDetail topic={topic} />
        </div>
      </div>
    );
  }

  if (kind === "supplements") {
    const supp = await loadOne<Supplement>("supplements", slug);
    if (!supp) notFound();
    return (
      <div>
        <Link
          href="/catalogue"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to catalogue
        </Link>
        <div className="mt-4">
          <SupplementDetail supp={supp} />
        </div>
      </div>
    );
  }

  notFound();
}

// TODO(next-turn): mechanism / symptom / claim / source detail pages.
