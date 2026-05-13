import Link from "next/link";
import { loadAllClients, loadAllPlans, loadAllOfKind } from "@/lib/fmdb/loader";
import type { Topic, Symptom, Supplement, Mechanism } from "@/lib/fmdb/types";
import { FmAppShell } from "@/components/fm";
import { SearchInput } from "./search-input";

export const dynamic = "force-dynamic";

// ── helpers ──────────────────────────────────────────────────────────────────

function hit(query: string, ...fields: (string | undefined | null | string[])[]) {
  const q = query.toLowerCase();
  return fields.some((f) => {
    if (!f) return false;
    if (Array.isArray(f)) return f.some((s) => s.toLowerCase().includes(q));
    return f.toLowerCase().includes(q);
  });
}

function Chip({ children, color = "default" }: { children: React.ReactNode; color?: "blue" | "emerald" | "amber" | "violet" | "rose" | "default" }) {
  const cls = {
    blue:    "bg-blue-50 text-blue-700 border-blue-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber:   "bg-amber-50 text-amber-700 border-amber-200",
    violet:  "bg-violet-50 text-violet-700 border-violet-200",
    rose:    "bg-rose-50 text-rose-700 border-rose-200",
    default: "bg-muted text-muted-foreground border-border",
  }[color];
  return (
    <span className={`inline-block text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${cls}`}>
      {children}
    </span>
  );
}

// ── sections ─────────────────────────────────────────────────────────────────

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-2">
        {title}
        <span className="px-1.5 rounded-full bg-muted text-muted-foreground text-[10px]">{count}</span>
      </h2>
      <div className="divide-y rounded-xl border overflow-hidden">
        {children}
      </div>
    </section>
  );
}

function Row({ href, label, sub, tag }: { href: string; label: string; sub?: string; tag?: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 px-4 py-2.5 bg-background hover:bg-muted/40 transition-colors"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{label}</div>
        {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
      </div>
      {tag && <div className="shrink-0">{tag}</div>}
    </Link>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  if (!query) {
    return (
      <FmAppShell activeNavId="search" crumbs={[{ label: "Search" }]}>
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold mb-1">🔍 Search</h1>
            <p className="text-sm text-muted-foreground">
              Clients · Plans · Catalogue · Sessions
            </p>
          </div>
          <SearchInput initialValue="" />
          <div className="text-center py-12 text-muted-foreground text-sm">
            Start typing to search across everything
            <div className="mt-2 text-xs opacity-60">⌘K from anywhere to open search</div>
          </div>
        </div>
      </FmAppShell>
    );
  }

  // Load all data in parallel
  const [clients, plans, topics, symptoms, supplements, mechanisms] = await Promise.all([
    loadAllClients(),
    loadAllPlans(),
    loadAllOfKind<Topic>("topics"),
    loadAllOfKind<Symptom>("symptoms"),
    loadAllOfKind<Supplement>("supplements"),
    loadAllOfKind<Mechanism>("mechanisms"),
  ]);

  const matchedClients    = clients.filter((c) => hit(query, c.client_id, c.display_name, c.active_conditions, c.notes, c.medications, c.current_medications));
  const matchedPlans      = plans.filter((p) => hit(query, p.slug, p.client_id, p.status, p.notes_for_coach as string | undefined));
  const matchedTopics     = topics.filter((t) => hit(query, t.slug, t.display_name, t.aliases, t.summary, t.common_symptoms));
  const matchedSymptoms   = symptoms.filter((s) => hit(query, s.slug, s.display_name, s.aliases, s.description));
  const matchedSupps      = supplements.filter((s) => hit(query, s.slug, s.display_name, s.aliases, s.notes as string | undefined));
  const matchedMechanisms = mechanisms.filter((m) => hit(query, m.slug, m.display_name, m.aliases, m.summary as string | undefined));

  const total = matchedClients.length + matchedPlans.length + matchedTopics.length +
    matchedSymptoms.length + matchedSupps.length + matchedMechanisms.length;

  return (
    <FmAppShell activeNavId="search" crumbs={[{ label: "Search" }, ...(query ? [{ label: query }] : [])]}>
      <div className="max-w-2xl mx-auto space-y-6">
      {/* Header + input */}
      <div>
        <h1 className="text-2xl font-bold mb-3">🔍 Search</h1>
        <SearchInput initialValue={query} />
        <p className="text-xs text-muted-foreground mt-2">
          {total} result{total !== 1 ? "s" : ""} for &quot;{query}&quot;
        </p>
      </div>

      {total === 0 && (
        <div className="text-center py-10 text-muted-foreground text-sm border-2 border-dashed rounded-xl">
          No matches found for &quot;{query}&quot;
        </div>
      )}

      {/* Clients */}
      <Section title="👥 Clients" count={matchedClients.length}>
        {matchedClients.map((c) => (
          <Row
            key={c.client_id}
            href={`/clients-v2/${c.client_id}`}
            label={c.display_name ?? c.client_id}
            sub={(c.active_conditions ?? []).slice(0, 3).join(" · ") || c.client_id}
            tag={<Chip color="blue">client</Chip>}
          />
        ))}
      </Section>

      {/* Plans */}
      <Section title="📋 Plans" count={matchedPlans.length}>
        {matchedPlans.map((p) => (
          <Row
            key={p.slug}
            href={p.client_id ? `/clients-v2/${p.client_id}/plan/edit/${p.slug}` : `/plans/${p.slug}`}
            label={p.slug}
            sub={`${p.client_id ?? "–"} · ${p._bucket ?? p.status ?? "draft"}`}
            tag={<Chip color={p._bucket === "published" ? "emerald" : p._bucket === "draft" ? "amber" : "default"}>{p._bucket ?? p.status ?? "draft"}</Chip>}
          />
        ))}
      </Section>

      {/* Conditions */}
      <Section title="🩺 Conditions" count={matchedTopics.length}>
        {matchedTopics.map((t) => (
          <Row
            key={t.slug}
            href={`/catalogue/topics/${t.slug}`}
            label={t.display_name ?? t.slug}
            sub={t.slug}
            tag={<Chip color="violet">condition</Chip>}
          />
        ))}
      </Section>

      {/* Symptoms */}
      <Section title="🤒 Symptoms" count={matchedSymptoms.length}>
        {matchedSymptoms.map((s) => (
          <Row
            key={s.slug}
            href={`/catalogue/symptoms/${s.slug}`}
            label={s.display_name ?? s.slug}
            sub={s.aliases?.slice(0, 3).join(", ")}
            tag={<Chip color="rose">symptom</Chip>}
          />
        ))}
      </Section>

      {/* Supplements */}
      <Section title="💊 Supplements" count={matchedSupps.length}>
        {matchedSupps.map((s) => (
          <Row
            key={s.slug}
            href={`/catalogue/supplements/${s.slug}`}
            label={s.display_name ?? s.slug}
            sub={s.aliases?.slice(0, 3).join(", ")}
            tag={<Chip color="amber">supplement</Chip>}
          />
        ))}
      </Section>

      {/* Root causes */}
      <Section title="🧬 Root causes" count={matchedMechanisms.length}>
        {matchedMechanisms.map((m) => (
          <Row
            key={m.slug}
            href={`/catalogue/mechanisms/${m.slug}`}
            label={m.display_name ?? m.slug}
            sub={m.slug}
            tag={<Chip color="default">root cause</Chip>}
          />
        ))}
      </Section>
      </div>
    </FmAppShell>
  );
}
