/**
 * /clients-v2/[id]/catalogue — client-scoped catalogue view.
 *
 * Replaces the old "Catalogue" tab that just hard-redirected to /catalogue
 * regardless of client context. Now shows ONLY the catalogue entries
 * this specific client is touching:
 *
 *  - Conditions (Topics) from client.active_conditions
 *  - Root causes (Mechanisms) from the active plan's likely_drivers
 *  - Symptoms from session presenting_complaints + check-ins
 *  - Supplements from the active plan's supplement_protocol
 *  - Healing programs (Protocols) attached to the active plan
 *  - Mind maps that index any of the client's conditions
 *
 * Each card links out to the global catalogue detail page for the
 * full reference. This page is the "what's relevant to *this* client"
 * lens; the sidebar Catalogue link is the global browser.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { loadAllPlans, loadAllOfKind } from "@/lib/fmdb/loader";
import { loadAllMindMaps } from "@/lib/fmdb/loader-extras";
import type {
  Topic,
  Mechanism,
  Symptom,
  Supplement,
  Protocol,
  MindMap,
} from "@/lib/fmdb/types";
import { kindLabel, kindEmoji } from "@/lib/fmdb/kinds";
import { FmPanel } from "@/components/fm";
import { CataloguePageShell } from "./catalogue-page-shell";

export const dynamic = "force-dynamic";

/** Lookup an entity by slug OR alias (case-insensitive). */
function bySlugOrAlias<T extends { slug: string; aliases?: string[] }>(
  rows: T[],
): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) {
    if (!r.slug) continue;
    m.set(r.slug.toLowerCase(), r);
    for (const a of r.aliases ?? []) {
      if (a) m.set(a.toLowerCase(), r);
    }
  }
  return m;
}

/** Resolve free-text "active_conditions" strings to Topic catalogue entries. */
function resolveTopics(
  freetext: string[],
  index: Map<string, Topic>,
): { matched: Topic[]; unmatched: string[] } {
  const matched: Topic[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();
  for (const raw of freetext) {
    const norm = raw.trim().toLowerCase();
    if (!norm) continue;
    // Try exact, then alias substring
    let hit = index.get(norm);
    if (!hit) {
      for (const [k, v] of index) {
        if (norm.includes(k) || k.includes(norm)) {
          hit = v;
          break;
        }
      }
    }
    if (hit && !seen.has(hit.slug)) {
      matched.push(hit);
      seen.add(hit.slug);
    } else if (!hit) {
      unmatched.push(raw);
    }
  }
  return { matched, unmatched };
}

export default async function ClientCataloguePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await loadClientById(id);
  if (!client) notFound();

  // Parallel load — every fetch is independent.
  const [topics, mechanisms, symptoms, supplements, protocols, mindmaps, allPlans] =
    await Promise.all([
      loadAllOfKind<Topic>("topics"),
      loadAllOfKind<Mechanism>("mechanisms"),
      loadAllOfKind<Symptom>("symptoms"),
      loadAllOfKind<Supplement>("supplements"),
      loadAllOfKind<Protocol>("protocols"),
      loadAllMindMaps(),
      loadAllPlans(),
    ]);

  const topicIdx = bySlugOrAlias(topics);
  const mechIdx = bySlugOrAlias(mechanisms);
  const symIdx = bySlugOrAlias(symptoms);
  const suppIdx = bySlugOrAlias(supplements);
  const protoIdx = bySlugOrAlias(protocols);

  // ── Pull the data we'll filter from ───────────────────────────────
  const c = client as unknown as Record<string, unknown>;
  const activeConditionStrings = ((c.active_conditions as string[]) ?? []).filter(
    (x): x is string => typeof x === "string",
  );
  const clientPlans = allPlans
    .filter((p) => (p as { client_id?: string }).client_id === id)
    .sort((a, b) =>
      ((b.updated_at ?? "") as string).localeCompare(
        (a.updated_at ?? "") as string,
      ),
    );
  const activePlan =
    clientPlans.find(
      (p) =>
        ((p as { status?: string; _bucket?: string }).status ??
          (p as { status?: string; _bucket?: string })._bucket) === "published",
    ) ?? clientPlans[0];

  // Conditions → Topic entries
  const { matched: conditionTopics, unmatched: conditionUnmatched } =
    resolveTopics(activeConditionStrings, topicIdx);

  // Active plan: extract supplement slugs + driver mechanisms + attached
  // protocols + topics-in-play.
  const planSupplementSlugs: string[] = [];
  const planMechanismSlugs: string[] = [];
  const planTopicSlugs: string[] = [];
  const planProtocolSlugs: string[] = [];
  if (activePlan) {
    const p = activePlan as unknown as Record<string, unknown>;
    const supps = (p.supplement_protocol as Array<{ slug?: string }>) ?? [];
    for (const s of supps) {
      if (typeof s?.slug === "string") planSupplementSlugs.push(s.slug);
    }
    const drivers = (p.likely_drivers as Array<{ mechanism?: string }>) ?? [];
    for (const d of drivers) {
      if (typeof d?.mechanism === "string") planMechanismSlugs.push(d.mechanism);
    }
    const topicsInPlay = (p.topics_in_play as string[]) ?? [];
    for (const t of topicsInPlay) {
      if (typeof t === "string") planTopicSlugs.push(t);
    }
    const primaryTopics = (p.primary_topics as string[]) ?? [];
    for (const t of primaryTopics) {
      if (typeof t === "string") planTopicSlugs.push(t);
    }
    const attached = (p.attached_protocols as string[]) ?? [];
    for (const a of attached) {
      if (typeof a === "string") planProtocolSlugs.push(a);
    }
  }

  // Dedupe + resolve to entities
  const planSupplements = Array.from(new Set(planSupplementSlugs))
    .map((s) => suppIdx.get(s.toLowerCase()))
    .filter((s): s is Supplement => !!s);
  const planMechanisms = Array.from(new Set(planMechanismSlugs))
    .map((s) => mechIdx.get(s.toLowerCase()))
    .filter((s): s is Mechanism => !!s);
  // Union of condition-derived topics + plan-derived topics
  const planTopicEntities = Array.from(new Set(planTopicSlugs))
    .map((s) => topicIdx.get(s.toLowerCase()))
    .filter((t): t is Topic => !!t);
  const allTopics = [...conditionTopics];
  const condSet = new Set(conditionTopics.map((t) => t.slug));
  for (const t of planTopicEntities) {
    if (!condSet.has(t.slug)) allTopics.push(t);
  }
  const planProtocols = Array.from(new Set(planProtocolSlugs))
    .map((s) => protoIdx.get(s.toLowerCase()))
    .filter((p): p is Protocol => !!p);

  // Mind maps that reference any of this client's conditions (by topic slug).
  const clientTopicSlugs = new Set(allTopics.map((t) => t.slug));
  function mindmapMentionsTopic(mm: MindMap): boolean {
    const related = (mm.related_topics ?? []) as string[];
    if (related.some((t) => clientTopicSlugs.has(t))) return true;
    // also scan tree leaves for linked_slug → catalogue topic
    const walk = (
      nodes:
        | Array<{ linked_kind?: string; linked_slug?: string; children?: unknown[] }>
        | undefined,
    ): boolean => {
      if (!nodes) return false;
      for (const n of nodes) {
        if (n.linked_kind === "topic" && n.linked_slug && clientTopicSlugs.has(n.linked_slug)) {
          return true;
        }
        if (n.children && walk(n.children as typeof nodes)) return true;
      }
      return false;
    };
    return walk((mm as unknown as { tree?: Parameters<typeof walk>[0] }).tree);
  }
  const relevantMindmaps = mindmaps.filter(mindmapMentionsTopic);

  // Symptoms — pull from active_conditions text + plan symptoms_to_monitor
  const planSymptomSlugs: string[] = [];
  if (activePlan) {
    const tracking = (activePlan as unknown as { tracking?: { monitor_symptoms?: string[]; symptoms_to_monitor?: string[] } }).tracking;
    const monitor =
      tracking?.monitor_symptoms ?? tracking?.symptoms_to_monitor ?? [];
    for (const s of monitor) {
      if (typeof s === "string") planSymptomSlugs.push(s);
    }
  }
  const planSymptoms = Array.from(new Set(planSymptomSlugs))
    .map((s) => symIdx.get(s.toLowerCase()))
    .filter((s): s is Symptom => !!s);

  // ── Render ────────────────────────────────────────────────────────
  const totalRelevant =
    allTopics.length +
    planMechanisms.length +
    planSymptoms.length +
    planSupplements.length +
    planProtocols.length +
    relevantMindmaps.length;

  return (
    <CataloguePageShell clientId={id}>
      <div style={{ display: "grid", gap: 14 }}>
        <FmPanel
          title={`📖 What's relevant to ${client.display_name ?? client.client_id}`}
          subtitle={
            totalRelevant > 0
              ? `${totalRelevant} catalogue entries linked to this client's conditions, plan, and sessions. Click any card to open the full reference.`
              : "No catalogue entries linked yet. Once an intake or assessment is run, this view will fill in."
          }
        >
          {totalRelevant === 0 && (
            <p
              style={{
                fontSize: 13,
                color: "var(--fm-text-tertiary)",
                fontStyle: "italic",
              }}
            >
              No active conditions or plan on file yet for this client.
            </p>
          )}
        </FmPanel>

        {allTopics.length > 0 && (
          <CatalogueSection
            label={kindLabel("topic", "plural")}
            emoji={kindEmoji("topic")}
            subtitle="Conditions linked from this client's intake or plan."
            items={allTopics.map((t) => ({
              slug: t.slug,
              label: t.display_name ?? t.slug,
              href: `/catalogue/topics/${t.slug}`,
              summary: (t as unknown as { summary?: string }).summary,
            }))}
          />
        )}

        {planMechanisms.length > 0 && (
          <CatalogueSection
            label={kindLabel("mechanism", "plural")}
            emoji={kindEmoji("mechanism")}
            subtitle="Root mechanisms flagged in the active plan's hypothesised drivers."
            items={planMechanisms.map((m) => ({
              slug: m.slug,
              label: m.display_name ?? m.slug,
              href: `/catalogue/mechanisms/${m.slug}`,
              summary: (m as unknown as { summary?: string }).summary,
            }))}
          />
        )}

        {planSymptoms.length > 0 && (
          <CatalogueSection
            label={kindLabel("symptom", "plural")}
            emoji={kindEmoji("symptom")}
            subtitle="Symptoms the active plan is tracking."
            items={planSymptoms.map((s) => ({
              slug: s.slug,
              label: s.display_name ?? s.slug,
              href: `/catalogue/symptoms/${s.slug}`,
              summary: (s as unknown as { description?: string }).description,
            }))}
          />
        )}

        {planSupplements.length > 0 && (
          <CatalogueSection
            label={kindLabel("supplement", "plural")}
            emoji={kindEmoji("supplement")}
            subtitle="In the active plan's supplement protocol."
            items={planSupplements.map((s) => ({
              slug: s.slug,
              label: s.display_name ?? s.slug,
              href: `/catalogue/supplements/${s.slug}`,
              summary: (s as unknown as { summary?: string }).summary,
            }))}
          />
        )}

        {planProtocols.length > 0 && (
          <CatalogueSection
            label={kindLabel("protocol", "plural")}
            emoji={kindEmoji("protocol")}
            subtitle="Healing programs attached to the active plan."
            items={planProtocols.map((p) => ({
              slug: p.slug,
              label: p.display_name ?? p.slug,
              href: `/catalogue/protocols/${p.slug}`,
              summary: (p as unknown as { summary?: string }).summary,
            }))}
          />
        )}

        {relevantMindmaps.length > 0 && (
          <CatalogueSection
            label="Mind maps"
            emoji="🧭"
            subtitle="FM-coaching mind maps that index this client's conditions."
            items={relevantMindmaps.map((m) => ({
              slug: m.slug,
              label: m.display_name ?? m.slug,
              href: `/mindmap/${m.slug}`,
              summary: m.description,
            }))}
          />
        )}

        {conditionUnmatched.length > 0 && (
          <FmPanel
            title="❓ Conditions not yet in catalogue"
            subtitle="These free-text conditions on this client's profile don't match a catalogue entry — they may be misspellings, novel terms, or items waiting for the Catalogue queue."
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {conditionUnmatched.map((cond) => (
                <span
                  key={cond}
                  style={{
                    fontSize: 11.5,
                    padding: "3px 9px",
                    background: "var(--fm-bg-warm, #fff5f0)",
                    border: "1px dashed var(--fm-border)",
                    borderRadius: 999,
                    color: "var(--fm-text-secondary)",
                  }}
                >
                  {cond}
                </span>
              ))}
            </div>
            <p
              style={{
                fontSize: 11,
                color: "var(--fm-text-tertiary)",
                marginTop: 10,
                fontStyle: "italic",
              }}
            >
              Open the global catalogue browser via the sidebar to search the
              ~1,800-entry knowledge base.
            </p>
          </FmPanel>
        )}
      </div>
    </CataloguePageShell>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Catalogue section — colored card grid, one section per entity kind.
 * ─────────────────────────────────────────────────────────────────────*/
function CatalogueSection({
  label,
  emoji,
  subtitle,
  items,
}: {
  label: string;
  emoji: string;
  subtitle: string;
  items: Array<{
    slug: string;
    label: string;
    href: string;
    summary?: string;
  }>;
}) {
  return (
    <FmPanel
      title={`${emoji} ${label}`}
      subtitle={`${items.length} · ${subtitle}`}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 10,
        }}
      >
        {items.map((it) => (
          <Link
            key={it.slug}
            href={it.href}
            style={{
              display: "block",
              padding: "10px 12px",
              background: "var(--fm-surface)",
              border: "1px solid var(--fm-border-light)",
              borderRadius: "var(--fm-radius-sm)",
              textDecoration: "none",
              transition: "border-color 150ms ease",
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--fm-text-primary)",
              }}
            >
              {it.label}
            </div>
            <div
              style={{
                fontSize: 10,
                fontFamily: "var(--fm-font-mono)",
                color: "var(--fm-text-tertiary)",
                marginTop: 2,
              }}
            >
              {it.slug}
            </div>
            {it.summary && (
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--fm-text-secondary)",
                  marginTop: 5,
                  lineHeight: 1.4,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {it.summary}
              </div>
            )}
            <div
              style={{
                fontSize: 10.5,
                color: "var(--fm-primary)",
                fontWeight: 600,
                marginTop: 7,
              }}
            >
              Open full reference →
            </div>
          </Link>
        ))}
      </div>
    </FmPanel>
  );
}
