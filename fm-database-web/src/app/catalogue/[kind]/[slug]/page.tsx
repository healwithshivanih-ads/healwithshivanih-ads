import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EvidenceTierBadge } from "@/components/evidence-tier-badge";
import { loadOne } from "@/lib/fmdb/loader";
import type {
  CatalogueKind,
  Topic,
  Supplement,
  Mechanism,
  Symptom,
  Claim,
  Source,
  CookingAdjustment,
  HomeRemedy,
  Protocol,
  TitrationProtocol,
} from "@/lib/fmdb/types";

const SUPPORTED: ReadonlySet<string> = new Set([
  "topics",
  "supplements",
  "mechanisms",
  "symptoms",
  "claims",
  "sources",
  "cooking_adjustments",
  "home_remedies",
  "protocols",
  "titration_protocols",
]);

// Map a slug-like reference to its canonical detail URL.
// Use this for chips that should link back into the catalogue.
function chipHref(kind: CatalogueKind, slug: string): string {
  return `/catalogue/${kind}/${slug}`;
}

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

// ChipList variant whose chips are clickable links into the catalogue.
function LinkedChipList({
  items,
  kind,
}: {
  items?: string[];
  kind: CatalogueKind;
}) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-muted-foreground italic">None</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <Link key={it} href={chipHref(kind, it)}>
          <Badge
            variant="secondary"
            className="font-mono text-xs hover:bg-primary/10 transition-colors"
          >
            {it}
          </Badge>
        </Link>
      ))}
    </div>
  );
}

function PlainList({ items }: { items?: string[] }) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-muted-foreground italic">None</p>;
  }
  return (
    <ul className="list-disc pl-5 text-sm space-y-1">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

function SourceCitations({ sources }: { sources?: Topic["sources"] }) {
  if (!sources || sources.length === 0) {
    return <p className="text-sm text-muted-foreground italic">None</p>;
  }
  return (
    <ul className="list-disc pl-5 text-sm space-y-1">
      {sources.map((s, i) => (
        <li key={i}>
          <Link
            href={chipHref("sources", s.id)}
            className="font-mono hover:underline"
          >
            {s.id}
          </Link>
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
  );
}

function Header({
  title,
  slug,
  tier,
  category,
  extraBadges,
}: {
  title: string;
  slug: string;
  tier?: Topic["evidence_tier"];
  category?: string;
  extraBadges?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-3xl font-bold">{title}</h1>
        {tier && <EvidenceTierBadge tier={tier} />}
        {category && <Badge variant="outline">{category}</Badge>}
        {extraBadges}
      </div>
      <p className="font-mono text-xs text-muted-foreground mt-1">{slug}</p>
    </div>
  );
}

// ---- Per-kind renderers ---------------------------------------------------

function TopicDetail({ topic }: { topic: Topic }) {
  return (
    <div className="space-y-6">
      <Header
        title={topic.display_name ?? topic.slug}
        slug={topic.slug}
        tier={topic.evidence_tier}
      />

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
          <LinkedChipList items={topic.related_topics} kind="topics" />
        </Section>
        <Section title="Key mechanisms">
          <LinkedChipList items={topic.key_mechanisms} kind="mechanisms" />
        </Section>
      </div>

      {topic.red_flags && topic.red_flags.length > 0 && (
        <Section title="Red flags">
          <PlainList items={topic.red_flags} />
        </Section>
      )}

      {topic.coaching_scope_notes && (
        <Section title="Coaching scope notes">
          <p className="text-sm leading-relaxed">{topic.coaching_scope_notes}</p>
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
          <SourceCitations sources={topic.sources} />
        </Section>
      )}
    </div>
  );
}

function SupplementDetail({ supp }: { supp: Supplement }) {
  return (
    <div className="space-y-6">
      <Header
        title={supp.display_name ?? supp.slug}
        slug={supp.slug}
        tier={supp.evidence_tier}
        category={supp.category}
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Forms available">
          <ChipList items={supp.forms_available} />
        </Section>
        <Section title="Timing">
          <ChipList items={supp.timing_options} />
        </Section>
      </div>

      {supp.typical_dose_range &&
        Object.keys(supp.typical_dose_range).length > 0 && (
          <Section title="Typical dose range">
            <div className="border rounded-md p-4 space-y-1 text-sm">
              {Object.entries(supp.typical_dose_range).map(([form, range]) => (
                <div key={form}>
                  <span className="font-medium">{form}:</span> {range.min}–
                  {range.max} {range.unit}
                </div>
              ))}
            </div>
          </Section>
        )}

      {supp.contraindications && (
        <Section title="Contraindications">
          <div className="grid gap-3 md:grid-cols-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Conditions</div>
              <ChipList items={supp.contraindications.conditions} />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Medications</div>
              <ChipList items={supp.contraindications.medications} />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Life stages</div>
              <ChipList items={supp.contraindications.life_stages} />
            </div>
          </div>
        </Section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Linked topics">
          <LinkedChipList items={supp.linked_to_topics} kind="topics" />
        </Section>
        <Section title="Linked mechanisms">
          <LinkedChipList
            items={supp.linked_to_mechanisms}
            kind="mechanisms"
          />
        </Section>
      </div>

      {supp.notes && (
        <Section title="Notes">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {supp.notes}
          </p>
        </Section>
      )}

      {supp.sources && supp.sources.length > 0 && (
        <Section title="Sources">
          <SourceCitations sources={supp.sources} />
        </Section>
      )}
    </div>
  );
}

function MechanismDetail({ mech }: { mech: Mechanism }) {
  return (
    <div className="space-y-6">
      <Header
        title={mech.display_name ?? mech.slug}
        slug={mech.slug}
        tier={mech.evidence_tier}
        category={mech.category}
      />

      {mech.summary && (
        <Card>
          <CardContent className="pt-6 text-sm leading-relaxed">
            {mech.summary}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {mech.aliases && mech.aliases.length > 0 && (
          <Section title="Aliases">
            <ChipList items={mech.aliases} />
          </Section>
        )}
        <Section title="Linked topics">
          <LinkedChipList items={mech.linked_to_topics} kind="topics" />
        </Section>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Upstream drivers">
          <PlainList items={mech.upstream_drivers} />
        </Section>
        <Section title="Downstream effects">
          <PlainList items={mech.downstream_effects} />
        </Section>
      </div>

      {mech.related_mechanisms && mech.related_mechanisms.length > 0 && (
        <Section title="Related mechanisms">
          <LinkedChipList
            items={mech.related_mechanisms}
            kind="mechanisms"
          />
        </Section>
      )}

      {mech.sources && mech.sources.length > 0 && (
        <Section title="Sources">
          <SourceCitations sources={mech.sources} />
        </Section>
      )}
    </div>
  );
}

function SymptomDetail({ sym }: { sym: Symptom }) {
  const sevColor =
    sym.severity === "red_flag"
      ? "destructive"
      : sym.severity === "concerning"
        ? "default"
        : "outline";
  return (
    <div className="space-y-6">
      <Header
        title={sym.display_name ?? sym.slug}
        slug={sym.slug}
        category={sym.category}
        extraBadges={
          sym.severity && (
            <Badge variant={sevColor as "destructive" | "default" | "outline"}>
              {sym.severity}
            </Badge>
          )
        }
      />

      {sym.description && (
        <Card>
          <CardContent className="pt-6 text-sm leading-relaxed">
            {sym.description}
          </CardContent>
        </Card>
      )}

      {sym.aliases && sym.aliases.length > 0 && (
        <Section title="Aliases">
          <ChipList items={sym.aliases} />
        </Section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Linked topics">
          <LinkedChipList items={sym.linked_to_topics} kind="topics" />
        </Section>
        <Section title="Linked mechanisms">
          <LinkedChipList
            items={sym.linked_to_mechanisms}
            kind="mechanisms"
          />
        </Section>
      </div>

      {sym.when_to_refer && (
        <Section title="When to refer out">
          <Card>
            <CardContent className="pt-6 text-sm leading-relaxed bg-destructive/5 border-l-4 border-destructive">
              {sym.when_to_refer}
            </CardContent>
          </Card>
        </Section>
      )}

      {sym.sources && sym.sources.length > 0 && (
        <Section title="Sources">
          <SourceCitations sources={sym.sources} />
        </Section>
      )}
    </div>
  );
}

function ClaimDetail({ claim }: { claim: Claim }) {
  return (
    <div className="space-y-6">
      <Header
        title={claim.display_name ?? claim.slug}
        slug={claim.slug}
        tier={claim.evidence_tier}
      />

      {claim.statement && (
        <Card>
          <CardContent className="pt-6 text-sm leading-relaxed font-medium">
            {claim.statement}
          </CardContent>
        </Card>
      )}

      {claim.coaching_translation && (
        <Section title="Coaching translation">
          <Card>
            <CardContent className="pt-6 text-sm leading-relaxed">
              {claim.coaching_translation}
            </CardContent>
          </Card>
        </Section>
      )}

      {claim.rationale && (
        <Section title="Rationale">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {claim.rationale}
          </p>
        </Section>
      )}

      {claim.caveats && claim.caveats.length > 0 && (
        <Section title="Caveats">
          <PlainList items={claim.caveats} />
        </Section>
      )}

      {claim.out_of_scope_notes && (
        <Section title="Out of scope">
          <p className="text-sm leading-relaxed">{claim.out_of_scope_notes}</p>
        </Section>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <Section title="Linked topics">
          <LinkedChipList items={claim.linked_to_topics} kind="topics" />
        </Section>
        <Section title="Linked mechanisms">
          <LinkedChipList
            items={claim.linked_to_mechanisms}
            kind="mechanisms"
          />
        </Section>
        <Section title="Linked supplements">
          <LinkedChipList
            items={claim.linked_to_supplements}
            kind="supplements"
          />
        </Section>
      </div>

      {claim.sources && claim.sources.length > 0 && (
        <Section title="Sources">
          <SourceCitations sources={claim.sources} />
        </Section>
      )}
    </div>
  );
}

function SourceDetail({ src }: { src: Source }) {
  const id = src.id ?? src.slug;
  const qualityColor =
    src.quality === "high"
      ? "default"
      : src.quality === "low"
        ? "destructive"
        : "secondary";
  return (
    <div className="space-y-6">
      <Header
        title={src.title ?? id}
        slug={id}
        category={src.source_type}
        extraBadges={
          src.quality && (
            <Badge
              variant={qualityColor as "default" | "destructive" | "secondary"}
            >
              quality: {src.quality}
            </Badge>
          )
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        {src.authors && src.authors.length > 0 && (
          <Section title="Authors">
            <ChipList items={src.authors} />
          </Section>
        )}
        {src.year && (
          <Section title="Year">
            <p className="text-sm">{src.year}</p>
          </Section>
        )}
        {src.publisher && (
          <Section title="Publisher">
            <p className="text-sm">{src.publisher}</p>
          </Section>
        )}
        {src.doi && (
          <Section title="DOI">
            <p className="text-sm font-mono">{src.doi}</p>
          </Section>
        )}
      </div>

      {src.url && (
        <Section title="URL">
          <a
            href={src.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm text-primary hover:underline break-all"
          >
            {src.url}
          </a>
        </Section>
      )}

      {src.internal_path && (
        <Section title="Internal path">
          <p className="text-sm font-mono break-all">{src.internal_path}</p>
        </Section>
      )}

      {src.notes && (
        <Section title="Notes">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {src.notes}
          </p>
        </Section>
      )}
    </div>
  );
}

function CookingDetail({ ca }: { ca: CookingAdjustment }) {
  return (
    <div className="space-y-6">
      <Header
        title={ca.display_name ?? ca.slug}
        slug={ca.slug}
        tier={ca.evidence_tier}
        category={ca.category}
      />

      {ca.summary && (
        <Card>
          <CardContent className="pt-6 text-sm leading-relaxed">
            {ca.summary}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {ca.swap_from && (
          <Section title="Swap from">
            <p className="text-sm">{ca.swap_from}</p>
          </Section>
        )}
        <Section title="Benefits">
          <PlainList items={ca.benefits} />
        </Section>
      </div>

      {ca.how_to_use && (
        <Section title="How to use">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {ca.how_to_use}
          </p>
        </Section>
      )}

      {ca.cautions && ca.cautions.length > 0 && (
        <Section title="Cautions">
          <PlainList items={ca.cautions} />
        </Section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Linked topics">
          <LinkedChipList items={ca.linked_to_topics} kind="topics" />
        </Section>
        <Section title="Linked mechanisms">
          <LinkedChipList items={ca.linked_to_mechanisms} kind="mechanisms" />
        </Section>
      </div>

      {ca.sources && ca.sources.length > 0 && (
        <Section title="Sources">
          <SourceCitations sources={ca.sources} />
        </Section>
      )}
    </div>
  );
}

function HomeRemedyDetail({ hr }: { hr: HomeRemedy }) {
  return (
    <div className="space-y-6">
      <Header
        title={hr.display_name ?? hr.slug}
        slug={hr.slug}
        tier={hr.evidence_tier}
        category={hr.category}
      />

      {hr.summary && (
        <Card>
          <CardContent className="pt-6 text-sm leading-relaxed">
            {hr.summary}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Indications">
          <PlainList items={hr.indications} />
        </Section>
        <Section title="Contraindications">
          <PlainList items={hr.contraindications} />
        </Section>
      </div>

      {hr.preparation && (
        <Section title="Preparation">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {hr.preparation}
          </p>
        </Section>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {hr.typical_dose && (
          <Section title="Typical dose">
            <p className="text-sm">{hr.typical_dose}</p>
          </Section>
        )}
        {hr.duration && (
          <Section title="Duration">
            <p className="text-sm">{hr.duration}</p>
          </Section>
        )}
        {hr.timing_notes && (
          <Section title="Timing">
            <p className="text-sm">{hr.timing_notes}</p>
          </Section>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Linked topics">
          <LinkedChipList items={hr.linked_to_topics} kind="topics" />
        </Section>
        <Section title="Linked mechanisms">
          <LinkedChipList items={hr.linked_to_mechanisms} kind="mechanisms" />
        </Section>
      </div>

      {hr.sources && hr.sources.length > 0 && (
        <Section title="Sources">
          <SourceCitations sources={hr.sources} />
        </Section>
      )}
    </div>
  );
}

function ProtocolDetail({ pr }: { pr: Protocol }) {
  return (
    <div className="space-y-6">
      <Header
        title={pr.display_name ?? pr.slug}
        slug={pr.slug}
        tier={pr.evidence_tier}
        category={pr.category}
      />

      {pr.summary && (
        <Card>
          <CardContent className="pt-6 text-sm leading-relaxed whitespace-pre-wrap">
            {pr.summary}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {pr.typical_duration_weeks != null && (
          <div className="rounded-lg border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Typical duration</div>
            <div className="text-base font-semibold mt-1">{pr.typical_duration_weeks} weeks</div>
          </div>
        )}
        {pr.category && (
          <div className="rounded-lg border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Category</div>
            <div className="text-base font-medium mt-1">{pr.category.replace(/_/g, " ")}</div>
          </div>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Indications (when to use)">
          <PlainList items={pr.indications} />
        </Section>
        <Section title="Contraindications (when NOT to use)">
          <PlainList items={pr.contraindications} />
        </Section>
      </div>

      {pr.phases && pr.phases.length > 0 && (
        <Section title="Phases">
          <ol className="space-y-3">
            {pr.phases.map((ph, i) => (
              <li key={i} className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <span className="font-semibold text-sm">{ph.name}</span>
                  {ph.weeks != null && (
                    <span className="text-xs text-muted-foreground tabular-nums">{ph.weeks}w</span>
                  )}
                </div>
                {ph.summary && (
                  <p className="text-sm text-muted-foreground leading-relaxed mb-2">{ph.summary}</p>
                )}
                {ph.key_actions && ph.key_actions.length > 0 && (
                  <ul className="list-disc list-inside text-sm space-y-0.5">
                    {ph.key_actions.map((a, j) => <li key={j}>{a}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {pr.key_steps && pr.key_steps.length > 0 && (
        <Section title="Key steps">
          <PlainList items={pr.key_steps} />
        </Section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Foods to emphasise">
          <PlainList items={pr.foods_to_emphasise} />
        </Section>
        <Section title="Foods to remove">
          <PlainList items={pr.foods_to_remove} />
        </Section>
      </div>

      {pr.supplements_typically_used && pr.supplements_typically_used.length > 0 && (
        <Section title="Supplements typically used">
          <LinkedChipList items={pr.supplements_typically_used} kind="supplements" />
        </Section>
      )}

      {pr.expected_outcomes && pr.expected_outcomes.length > 0 && (
        <Section title="Expected outcomes">
          <PlainList items={pr.expected_outcomes} />
        </Section>
      )}

      {pr.cautions && pr.cautions.length > 0 && (
        <Section title="Cautions">
          <PlainList items={pr.cautions} />
        </Section>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <Section title="Linked topics">
          <LinkedChipList items={pr.linked_to_topics} kind="topics" />
        </Section>
        <Section title="Linked mechanisms">
          <LinkedChipList items={pr.linked_to_mechanisms} kind="mechanisms" />
        </Section>
        <Section title="Linked symptoms">
          <LinkedChipList items={pr.linked_to_symptoms} kind="symptoms" />
        </Section>
      </div>

      {((pr.prerequisites && pr.prerequisites.length > 0) ||
        (pr.recommended_followup && pr.recommended_followup.length > 0) ||
        (pr.incompatible_with && pr.incompatible_with.length > 0)) && (
        <div className="grid gap-6 md:grid-cols-3">
          <Section title="Prerequisites (do these first)">
            {pr.prerequisites && pr.prerequisites.length > 0 ? (
              <LinkedChipList items={pr.prerequisites} kind="protocols" />
            ) : (
              <p className="text-xs italic text-muted-foreground">None — can start as a foundation protocol.</p>
            )}
          </Section>
          <Section title="Recommended follow-up">
            {pr.recommended_followup && pr.recommended_followup.length > 0 ? (
              <LinkedChipList items={pr.recommended_followup} kind="protocols" />
            ) : (
              <p className="text-xs italic text-muted-foreground">None.</p>
            )}
          </Section>
          <Section title="Do NOT combine with">
            {pr.incompatible_with && pr.incompatible_with.length > 0 ? (
              <LinkedChipList items={pr.incompatible_with} kind="protocols" />
            ) : (
              <p className="text-xs italic text-muted-foreground">None — compatible with all other protocols.</p>
            )}
          </Section>
        </div>
      )}

      {pr.notes_for_coach && (
        <Section title="Notes for coach">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{pr.notes_for_coach}</p>
        </Section>
      )}

      {pr.sources && pr.sources.length > 0 && (
        <Section title="Sources">
          <SourceCitations sources={pr.sources} />
        </Section>
      )}
    </div>
  );
}

function TitrationDetail({ tp }: { tp: TitrationProtocol }) {
  const schedule = tp.schedule ?? [];
  const totalUnitsByStep = schedule.map(
    (s) => (s.morning ?? 0) + (s.midday ?? 0) + (s.evening ?? 0) + (s.bedtime ?? 0),
  );
  return (
    <div className="space-y-6">
      <Header
        title={tp.display_name ?? tp.slug}
        slug={tp.slug}
        tier={tp.evidence_tier}
      />

      {tp.purpose && (
        <Card>
          <CardContent className="pt-6 text-sm leading-relaxed whitespace-pre-wrap">
            {tp.purpose}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Supplement
          </div>
          <div className="mt-1">
            <a
              href={`/catalogue/supplements/${tp.supplement_slug}`}
              className="text-base font-semibold hover:underline"
            >
              {tp.supplement_slug}
            </a>
          </div>
        </div>
        {tp.product_strength && (
          <div className="rounded-lg border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              Product
            </div>
            <div className="text-sm font-medium mt-1">{tp.product_strength}</div>
          </div>
        )}
        {tp.target_dose_label && (
          <div className="rounded-lg border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              Target dose
            </div>
            <div className="text-sm font-medium mt-1">{tp.target_dose_label}</div>
          </div>
        )}
      </div>

      {tp.available_at && tp.available_at.length > 0 && (
        <Section title="Available at">
          <div className="flex flex-wrap gap-1.5">
            {tp.available_at.map((src) => (
              <span
                key={src}
                className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200"
              >
                {src}
              </span>
            ))}
          </div>
        </Section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Indications">
          <PlainList items={tp.indications} />
        </Section>
        <Section title="Contraindications">
          <PlainList items={tp.contraindications} />
        </Section>
      </div>

      {schedule.length > 0 && (
        <Section title="Titration schedule">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Week</th>
                  <th className="px-3 py-2 text-center">AM</th>
                  <th className="px-3 py-2 text-center">Midday</th>
                  <th className="px-3 py-2 text-center">PM</th>
                  <th className="px-3 py-2 text-center">Bedtime</th>
                  <th className="px-3 py-2 text-center">Total/day</th>
                  <th className="px-3 py-2 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((s, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2 font-semibold tabular-nums">{s.week}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{(s.morning ?? 0) || "—"}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{(s.midday ?? 0) || "—"}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{(s.evening ?? 0) || "—"}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{(s.bedtime ?? 0) || "—"}</td>
                    <td className="px-3 py-2 text-center tabular-nums font-semibold">{totalUnitsByStep[i]}</td>
                    <td className="px-3 py-2 text-xs leading-snug">{s.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Doses are integer counts of the product unit ({tp.product_strength ?? "—"}).
            {tp.splittable ? " Capsule is splittable — half-doses possible." : " Capsule is NOT splittable — whole units only."}
          </p>
        </Section>
      )}

      {tp.cautions && tp.cautions.length > 0 && (
        <Section title="Cautions">
          <PlainList items={tp.cautions} />
        </Section>
      )}

      {tp.monitoring && tp.monitoring.length > 0 && (
        <Section title="Monitoring">
          <PlainList items={tp.monitoring} />
        </Section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Linked topics">
          <LinkedChipList items={tp.linked_to_topics} kind="topics" />
        </Section>
        <Section title="Linked mechanisms">
          <LinkedChipList items={tp.linked_to_mechanisms} kind="mechanisms" />
        </Section>
      </div>

      {tp.notes_for_coach && (
        <Section title="Notes for coach">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{tp.notes_for_coach}</p>
        </Section>
      )}

      {tp.sources && tp.sources.length > 0 && (
        <Section title="Sources">
          <SourceCitations sources={tp.sources} />
        </Section>
      )}
    </div>
  );
}

// ---- Page entry -----------------------------------------------------------

export default async function CatalogueDetailPage({
  params,
}: {
  params: Promise<{ kind: string; slug: string }>;
}) {
  const { kind, slug } = await params;
  if (!SUPPORTED.has(kind)) notFound();

  let body: React.ReactNode;

  switch (kind) {
    case "topics": {
      const t = await loadOne<Topic>("topics", slug);
      if (!t) notFound();
      body = <TopicDetail topic={t} />;
      break;
    }
    case "supplements": {
      const s = await loadOne<Supplement>("supplements", slug);
      if (!s) notFound();
      body = <SupplementDetail supp={s} />;
      break;
    }
    case "mechanisms": {
      const m = await loadOne<Mechanism>("mechanisms", slug);
      if (!m) notFound();
      body = <MechanismDetail mech={m} />;
      break;
    }
    case "symptoms": {
      const sy = await loadOne<Symptom>("symptoms", slug);
      if (!sy) notFound();
      body = <SymptomDetail sym={sy} />;
      break;
    }
    case "claims": {
      const c = await loadOne<Claim>("claims", slug);
      if (!c) notFound();
      body = <ClaimDetail claim={c} />;
      break;
    }
    case "sources": {
      const src = await loadOne<Source>("sources", slug);
      if (!src) notFound();
      body = <SourceDetail src={src} />;
      break;
    }
    case "cooking_adjustments": {
      const ca = await loadOne<CookingAdjustment>("cooking_adjustments", slug);
      if (!ca) notFound();
      body = <CookingDetail ca={ca} />;
      break;
    }
    case "home_remedies": {
      const hr = await loadOne<HomeRemedy>("home_remedies", slug);
      if (!hr) notFound();
      body = <HomeRemedyDetail hr={hr} />;
      break;
    }
    case "protocols": {
      const pr = await loadOne<Protocol>("protocols", slug);
      if (!pr) notFound();
      body = <ProtocolDetail pr={pr} />;
      break;
    }
    case "titration_protocols": {
      const tp = await loadOne<TitrationProtocol>("titration_protocols", slug);
      if (!tp) notFound();
      body = <TitrationDetail tp={tp} />;
      break;
    }
    default:
      notFound();
  }

  return (
    <div>
      <Link
        href="/catalogue"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Back to catalogue
      </Link>
      <div className="mt-4">{body}</div>
    </div>
  );
}
