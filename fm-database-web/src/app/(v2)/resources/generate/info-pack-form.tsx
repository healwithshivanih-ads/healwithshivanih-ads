"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { generateInfoPack } from "./actions";

// Pre-built topic templates to make it quick to start
const TEMPLATES = [
  {
    label: "HRT Menopause",
    topic: "Hormone replacement therapy benefits and risks in menopause",
    keywords: ["hormone replacement therapy", "menopause", "cardiovascular risk", "breast cancer"],
    slug: "hrt-menopause-evidence-brief",
  },
  {
    label: "Thyroid & Hashimoto's",
    topic: "Functional medicine approach to Hashimoto's thyroiditis and hypothyroidism",
    keywords: ["Hashimoto thyroiditis", "hypothyroidism", "selenium", "gluten", "gut microbiome thyroid"],
    slug: "hashimotos-evidence-brief",
  },
  {
    label: "Gut Microbiome",
    topic: "Gut microbiome, leaky gut and systemic inflammation",
    keywords: ["gut microbiome", "intestinal permeability", "dysbiosis", "probiotics", "inflammation"],
    slug: "gut-microbiome-evidence-brief",
  },
  {
    label: "Insulin Resistance",
    topic: "Insulin resistance, metabolic syndrome and lifestyle interventions",
    keywords: ["insulin resistance", "metabolic syndrome", "intermittent fasting", "exercise insulin sensitivity"],
    slug: "insulin-resistance-evidence-brief",
  },
  {
    label: "Perimenopause & Sleep",
    topic: "Sleep disruption in perimenopause and non-hormonal interventions",
    keywords: ["perimenopause sleep", "insomnia menopause", "progesterone sleep", "magnesium sleep"],
    slug: "perimenopause-sleep-evidence-brief",
  },
  {
    label: "Vitamin D & Immunity",
    topic: "Vitamin D deficiency, immune regulation and autoimmune disease",
    keywords: ["vitamin D deficiency", "immune function", "autoimmune", "supplementation"],
    slug: "vitamin-d-immunity-evidence-brief",
  },
];

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export function InfoPackGeneratorForm() {
  const router = useRouter();
  const [submitted, setSubmitted] = useState(false);

  const [topic, setTopic] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [audience, setAudience] = useState<"patient" | "coach">("patient");
  const [maxPapers, setMaxPapers] = useState(12);
  const [slug, setSlug] = useState("");
  const [preview, setPreview] = useState<null | { papers_used: number; pmids: string[] }>(null);

  const applyTemplate = (t: (typeof TEMPLATES)[0]) => {
    setTopic(t.topic);
    setKeywords(t.keywords);
    setKeywordInput("");
    setSlug(t.slug);
    setPreview(null);
  };

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (kw && !keywords.includes(kw)) setKeywords((p) => [...p, kw]);
    setKeywordInput("");
  };

  const onTopicChange = (v: string) => {
    setTopic(v);
    if (!slug || slug === slugify(topic)) setSlug(slugify(v));
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || !slug.trim()) {
      toast.error("Topic and slug are required");
      return;
    }
    setSubmitted(true);
    // Fire-and-forget: Node keeps the python child process alive
    // independent of this request's lifecycle, so the brief still saves
    // even after the coach navigates away. The .then handlers below will
    // surface success / error toasts whenever the work finishes — sonner
    // queues them so they appear even if she's now on a different page.
    void generateInfoPack({
      topic: topic.trim(),
      keywords,
      audience,
      max_papers: maxPapers,
      save_slug: slug.trim(),
    }).then(
      (res) => {
        if (res.ok) {
          toast.success(
            `✓ Evidence brief "${res.title}" saved — ${res.papers_used} papers, ~${res.word_count} words.`,
            { duration: 10000 },
          );
        } else {
          toast.error(`Brief failed: ${res.error}`, { duration: 20000 });
        }
      },
      (err) => {
        toast.error(`Brief failed: ${err instanceof Error ? err.message : String(err)}`, { duration: 20000 });
      },
    );
    toast.message(
      `🔬 Generating evidence brief — searching PubMed + Haiku synthesis. Takes 1–3 min; carry on with other work.`,
      { duration: 8000 },
    );
    // Send the coach back to the Resources list immediately. The brief
    // will appear there once the script finishes (resources/page revalidates
    // automatically on save via revalidatePath in actions.ts).
    router.push("/resources");
  };

  return (
    <div className="space-y-6">
      {/* Quick-start templates */}
      <div>
        <p className="text-sm font-medium mb-2">Quick-start templates</p>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.slug}
              type="button"
              onClick={() => applyTemplate(t)}
              className="text-xs px-3 py-1.5 rounded-full border bg-background hover:bg-accent transition-colors"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="pt-5">
          <form onSubmit={onSubmit} className="space-y-5">
            {/* Topic */}
            <label className="block space-y-1">
              <div className="text-sm font-medium">Topic *</div>
              <div className="text-xs text-muted-foreground">
                Describe what you want evidence on — be specific.
              </div>
              <Input
                value={topic}
                onChange={(e) => onTopicChange(e.target.value)}
                placeholder="e.g. Benefits and risks of HRT in perimenopause"
                required
              />
            </label>

            {/* Keywords */}
            <div className="space-y-1">
              <div className="text-sm font-medium">PubMed search keywords</div>
              <div className="text-xs text-muted-foreground">
                These go into the PubMed search query. Press Enter or click Add.
              </div>
              <div className="flex gap-2">
                <Input
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); addKeyword(); }
                  }}
                  placeholder='e.g. "hormone replacement therapy"'
                />
                <Button type="button" variant="outline" onClick={addKeyword}>
                  Add
                </Button>
              </div>
              {keywords.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {keywords.map((kw) => (
                    <Badge key={kw} variant="secondary" className="gap-1 text-xs pr-1">
                      {kw}
                      <button
                        type="button"
                        onClick={() => setKeywords((p) => p.filter((k) => k !== kw))}
                        className="ml-0.5 hover:text-destructive"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Audience */}
              <label className="block space-y-1">
                <div className="text-sm font-medium">Written for</div>
                <select
                  value={audience}
                  onChange={(e) => setAudience(e.target.value as "patient" | "coach")}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
                >
                  <option value="patient">Patient / lay person</option>
                  <option value="coach">Coach / clinician</option>
                </select>
              </label>

              {/* Max papers */}
              <label className="block space-y-1">
                <div className="text-sm font-medium">Max papers to include</div>
                <Input
                  type="number"
                  min={5}
                  max={20}
                  value={maxPapers}
                  onChange={(e) => setMaxPapers(Number(e.target.value))}
                />
              </label>
            </div>

            {/* Slug */}
            <label className="block space-y-1">
              <div className="text-sm font-medium">Resource slug *</div>
              <div className="text-xs text-muted-foreground">
                Lowercase letters + hyphens. Auto-generated from topic, you can edit it.
              </div>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="hrt-menopause-evidence-brief"
                pattern="[a-z0-9-]+"
                required
              />
            </label>

            <div className="flex gap-3 items-center pt-1">
              <Button type="submit" disabled={submitted || !topic.trim() || !slug.trim()}>
                {submitted ? "🔬 Generating in background…" : "🔬 Generate evidence brief"}
              </Button>
              <p className="text-xs text-muted-foreground">
                ~1–3 min · PubMed + Haiku · runs in background, navigate anywhere
              </p>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground space-y-1 border rounded-md p-3 bg-muted/20">
        <p className="font-medium">About this tool</p>
        <p>
          Searches PubMed (free NCBI API) for systematic reviews, meta-analyses, RCTs and cohort
          studies. Prioritises recent evidence (last 10 years). Abstracts are synthesised by Claude
          into a balanced, lay-person-readable brief with citation links.
        </p>
        <p>
          The brief is saved as a Resource and can be attached to client plans via the Education
          tab. Run periodically to refresh evidence as new papers are published.
        </p>
      </div>
    </div>
  );
}
