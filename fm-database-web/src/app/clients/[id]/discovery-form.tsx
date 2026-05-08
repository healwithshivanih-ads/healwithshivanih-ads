"use client";

/**
 * DiscoveryForm — first-contact session.
 *
 * Records chief complaints, selects recommended labs, requests food journal.
 * Saves as [session_type: discovery_consultation] quick_note.
 * Shows a shareable lab request + food journal note after saving.
 */

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { saveSessionAction } from "@/app/assess/actions";

// ── Curated FM lab panel list ─────────────────────────────────────────────────

type Cost = "₹" | "₹₹" | "₹₹₹";
type Sex = "M" | "F";

interface Lab {
  name: string;
  cost: Cost;
  specialty?: boolean;
  sex?: Sex;
}

interface LabPanel {
  group: string;
  icon: string;
  sex?: Sex;
  labs: Lab[];
}

const LAB_PANELS: LabPanel[] = [
  {
    group: "Thyroid Function",
    icon: "🦋",
    labs: [
      { name: "TSH", cost: "₹" },
      { name: "Free T3", cost: "₹" },
      { name: "Free T4", cost: "₹" },
      { name: "Reverse T3", cost: "₹₹", specialty: true },
      { name: "TPO Antibodies", cost: "₹₹" },
      { name: "Thyroglobulin Antibodies", cost: "₹₹" },
      { name: "TSI (Thyroid Stimulating Immunoglobulin)", cost: "₹₹₹", specialty: true },
    ],
  },
  {
    group: "Blood Sugar & Insulin",
    icon: "🍬",
    labs: [
      { name: "Fasting Glucose", cost: "₹" },
      { name: "Fasting Insulin", cost: "₹₹" },
      { name: "HbA1c", cost: "₹" },
      { name: "C-Peptide", cost: "₹₹" },
      { name: "Post-prandial Glucose + Insulin (2-hr)", cost: "₹₹" },
      { name: "Glucose Tolerance Test with Insulin Response (GTT-IR)", cost: "₹₹₹", specialty: true },
    ],
  },
  {
    group: "Inflammation",
    icon: "🔥",
    labs: [
      { name: "hsCRP (high-sensitivity CRP)", cost: "₹" },
      { name: "Homocysteine", cost: "₹₹" },
      { name: "ESR", cost: "₹" },
      { name: "Fibrinogen", cost: "₹₹" },
      { name: "GGT", cost: "₹" },
      { name: "Uric Acid", cost: "₹" },
      { name: "Mycotoxin Panel", cost: "₹₹₹", specialty: true },
    ],
  },
  {
    group: "Lipid Panel",
    icon: "💧",
    labs: [
      { name: "Total Cholesterol", cost: "₹" },
      { name: "LDL Cholesterol", cost: "₹" },
      { name: "HDL Cholesterol", cost: "₹" },
      { name: "Triglycerides", cost: "₹" },
      { name: "VLDL", cost: "₹" },
    ],
  },
  {
    group: "Complete Blood Count",
    icon: "🩸",
    labs: [
      { name: "CBC with Differential", cost: "₹" },
      { name: "Reticulocyte Count", cost: "₹" },
    ],
  },
  {
    group: "Metabolic Panel",
    icon: "⚗️",
    labs: [
      { name: "Comprehensive Metabolic Panel (CMP)", cost: "₹" },
      { name: "Liver Function Tests (LFT)", cost: "₹" },
      { name: "Cystatin C", cost: "₹₹" },
    ],
  },
  {
    group: "Nutrients",
    icon: "🌱",
    labs: [
      { name: "Vitamin D (25-OH)", cost: "₹₹" },
      { name: "Vitamin B12", cost: "₹" },
      { name: "MMA (Methylmalonic Acid)", cost: "₹₹₹", specialty: true },
      { name: "Active B12 (Holotranscobalamin)", cost: "₹₹₹", specialty: true },
      { name: "RBC Folate", cost: "₹₹" },
      { name: "Ferritin", cost: "₹" },
      { name: "Serum Iron", cost: "₹" },
      { name: "TIBC / Transferrin Saturation", cost: "₹" },
      { name: "RBC Magnesium", cost: "₹₹", specialty: true },
      { name: "Zinc (Plasma)", cost: "₹₹" },
      { name: "Copper / Cu:Zn Ratio", cost: "₹₹", specialty: true },
      { name: "Selenium", cost: "₹₹", specialty: true },
      { name: "Iodine (Urinary)", cost: "₹₹", specialty: true },
      { name: "Omega-3 Index", cost: "₹₹₹", specialty: true },
      { name: "Heavy Metals Panel", cost: "₹₹₹", specialty: true },
    ],
  },
  {
    group: "Sex Hormones — Female",
    icon: "🌸",
    sex: "F",
    labs: [
      { name: "Estradiol (E2)", cost: "₹₹" },
      { name: "Progesterone", cost: "₹₹" },
      { name: "FSH", cost: "₹₹" },
      { name: "LH", cost: "₹₹" },
      { name: "AMH (Anti-Müllerian Hormone)", cost: "₹₹" },
      { name: "17-OH Progesterone", cost: "₹₹" },
    ],
  },
  {
    group: "Sex Hormones — Common",
    icon: "⚥",
    labs: [
      { name: "Total Testosterone", cost: "₹₹" },
      { name: "Free Testosterone", cost: "₹₹" },
      { name: "SHBG", cost: "₹₹" },
      { name: "DHEA-S", cost: "₹₹" },
      { name: "Prolactin", cost: "₹₹" },
      { name: "Estradiol (E2) — for men", cost: "₹₹", sex: "M" },
    ],
  },
  {
    group: "Adrenal & Stress",
    icon: "⚡",
    labs: [
      { name: "Morning Cortisol (8am, fasting)", cost: "₹" },
      { name: "PM Cortisol (4–6pm)", cost: "₹" },
      { name: "DUTCH Test (Dried Urine)", cost: "₹₹₹", specialty: true },
      { name: "Salivary Cortisol 4-point", cost: "₹₹₹", specialty: true },
      { name: "Aldosterone + Renin", cost: "₹₹₹", specialty: true },
      { name: "Pregnenolone", cost: "₹₹₹", specialty: true },
    ],
  },
  {
    group: "Cardiovascular Risk",
    icon: "❤️",
    labs: [
      { name: "ApoB", cost: "₹₹" },
      { name: "ApoA1", cost: "₹₹" },
      { name: "Lp(a) — Lipoprotein(a)", cost: "₹₹" },
      { name: "NMR LipoProfile", cost: "₹₹₹", specialty: true },
    ],
  },
  {
    group: "Methylation & Genetics",
    icon: "🧬",
    labs: [
      { name: "MTHFR Gene Variants", cost: "₹₹₹", specialty: true },
      { name: "COMT Gene Variants", cost: "₹₹₹", specialty: true },
      { name: "MTR / MTRR Gene Variants", cost: "₹₹₹", specialty: true },
      { name: "Organic Acid Test (OAT)", cost: "₹₹₹", specialty: true },
    ],
  },
  {
    group: "Autoimmune Screening",
    icon: "🛡️",
    labs: [
      { name: "ANA (Anti-Nuclear Antibodies)", cost: "₹₹" },
      { name: "ENA Panel", cost: "₹₹" },
      { name: "Anti-CCP", cost: "₹₹" },
      { name: "tTG-IgA (Tissue Transglutaminase)", cost: "₹₹" },
      { name: "Total IgA", cost: "₹" },
      { name: "Anti-Gliadin Antibodies", cost: "₹₹" },
    ],
  },
  {
    group: "Cancer Screening",
    icon: "🎗️",
    labs: [
      { name: "CEA", cost: "₹₹" },
      { name: "AFP", cost: "₹₹" },
      { name: "CA 19-9", cost: "₹₹" },
      { name: "LDH", cost: "₹" },
      { name: "β2-Microglobulin", cost: "₹₹" },
      { name: "CA-125", cost: "₹₹", sex: "F" },
      { name: "CA 15-3", cost: "₹₹", sex: "F" },
      { name: "HE4", cost: "₹₹₹", specialty: true, sex: "F" },
      { name: "PSA — Total", cost: "₹₹", sex: "M" },
      { name: "PSA — Free", cost: "₹₹", sex: "M" },
      { name: "β-hCG", cost: "₹₹", sex: "M" },
    ],
  },
  {
    group: "Gut Health",
    icon: "🦠",
    labs: [
      { name: "H. pylori (Stool Antigen)", cost: "₹₹" },
      { name: "Calprotectin (Stool)", cost: "₹₹" },
      { name: "Zonulin", cost: "₹₹₹", specialty: true },
      { name: "Pancreatic Elastase", cost: "₹₹₹", specialty: true },
      { name: "Secretory IgA (sIgA)", cost: "₹₹₹", specialty: true },
      { name: "SIBO Breath Test", cost: "₹₹₹", specialty: true },
      { name: "GI-MAP / GI-Effects", cost: "₹₹₹", specialty: true },
      { name: "Food Sensitivity IgG Panel", cost: "₹₹₹", specialty: true },
    ],
  },
  {
    group: "Routine",
    icon: "🧪",
    labs: [
      { name: "Stool Routine & Culture", cost: "₹" },
      { name: "Urine Routine", cost: "₹" },
    ],
  },
];

const normalizeSex = (s: string | null | undefined): Sex | null => {
  if (!s) return null;
  const ch = s.trim().charAt(0).toUpperCase();
  if (ch === "F") return "F";
  if (ch === "M") return "M";
  return null;
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  clientId: string;
  clientName?: string;
  clientSex?: string | null;
  onSaved?: (sessionId: string) => void;
}

export function DiscoveryForm({ clientId, clientName, clientSex, onSaved }: Props) {
  const router = useRouter();
  const outputRef = useRef<HTMLDivElement>(null);

  const [complaints, setComplaints] = useState("");
  const [selectedLabs, setSelectedLabs] = useState<Set<string>>(new Set());
  const [customLabs, setCustomLabs] = useState("");
  const [foodJournalDays, setFoodJournalDays] = useState<3 | 5 | 7>(5);
  const [foodJournalEnabled, setFoodJournalEnabled] = useState(true);
  const [coachNotes, setCoachNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedSession, setSavedSession] = useState<{ id: string; labText: string; journalText: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const sex = normalizeSex(clientSex);

  const visiblePanels: LabPanel[] = LAB_PANELS
    .filter((p) => !p.sex || !sex || p.sex === sex)
    .map((p) => ({
      ...p,
      labs: p.labs.filter((l) => !l.sex || !sex || l.sex === sex),
    }))
    .filter((p) => p.labs.length > 0);

  const toggleLab = (name: string) => {
    setSelectedLabs((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleGroup = (labs: Lab[]) => {
    const names = labs.map((l) => l.name);
    const allSelected = names.every((n) => selectedLabs.has(n));
    setSelectedLabs((prev) => {
      const next = new Set(prev);
      for (const n of names) {
        if (allSelected) next.delete(n);
        else next.add(n);
      }
      return next;
    });
  };

  const selectedCount = selectedLabs.size + (customLabs.trim() ? customLabs.split(",").filter(Boolean).length : 0);

  const buildComplaintsText = () => {
    const lines: string[] = ["[session_type: discovery_consultation]", "📋 Discovery consultation", ""];

    if (complaints.trim()) {
      lines.push("Chief complaints:", complaints.trim(), "");
    }

    if (selectedLabs.size > 0 || customLabs.trim()) {
      lines.push("Recommended lab panel:");
      for (const panel of visiblePanels) {
        const panelLabs = panel.labs.filter((l) => selectedLabs.has(l.name));
        if (panelLabs.length > 0) {
          lines.push(`[${panel.group.toUpperCase()}]`);
          for (const l of panelLabs) lines.push(`• ${l.name}`);
          lines.push("");
        }
      }
      if (customLabs.trim()) {
        lines.push("[ADDITIONAL TESTS]");
        for (const l of customLabs.split(",").map((s) => s.trim()).filter(Boolean)) {
          lines.push(`• ${l}`);
        }
        lines.push("");
      }
    }

    if (foodJournalEnabled) {
      lines.push(`📓 Food journal: ${foodJournalDays}-day food journal requested`, "");
    }

    if (coachNotes.trim()) {
      lines.push("Coach notes:", coachNotes.trim());
    }

    return lines.join("\n");
  };

  const buildLabText = () => {
    const lines: string[] = [
      `📋 Recommended Labs for ${clientName ?? "client"}`,
      `Please get the following tests done at a pathology lab near you.`,
      `Bring the reports to your next session or share a photo via WhatsApp.`,
      "",
    ];
    for (const panel of visiblePanels) {
      const panelLabs = panel.labs.filter((l) => selectedLabs.has(l.name));
      if (panelLabs.length > 0) {
        lines.push(`${panel.icon} ${panel.group}`);
        for (const l of panelLabs) lines.push(`  • ${l.name}`);
        lines.push("");
      }
    }
    if (customLabs.trim()) {
      lines.push("Additional tests:");
      for (const l of customLabs.split(",").map((s) => s.trim()).filter(Boolean)) {
        lines.push(`  • ${l}`);
      }
      lines.push("");
    }
    lines.push("📌 Important: Please do these tests fasting (8–10 hours, water only).");
    lines.push("   Cortisol should be drawn at 8am. Mention to the lab if any timing matters.");
    return lines.join("\n");
  };

  const buildJournalText = () => {
    const lines: string[] = [
      `📓 ${foodJournalDays}-Day Food Journal`,
      "",
      "Please note down everything you eat and drink for the next " +
        `${foodJournalDays} days — including meals, snacks, and drinks.`,
      "",
      "For each entry note:",
      "  • Time of eating",
      "  • What you ate (approximate quantities fine)",
      "  • Hunger level before (1–5)",
      "  • Energy/mood after (1 hr later)",
      "  • Any symptoms noticed (bloating, fatigue, etc.)",
      "",
      "A simple WhatsApp message or photo of a diary page works perfectly.",
    ];
    return lines.join("\n");
  };

  const handleSave = async () => {
    if (!complaints.trim() && selectedLabs.size === 0) {
      setError("Please enter chief complaints or select at least one lab.");
      return;
    }
    setSaving(true);
    setError(null);
    const complaintsText = buildComplaintsText();
    const labText = buildLabText();
    const journalText = buildJournalText();

    const res = await saveSessionAction({
      client_id: clientId,
      session_type: "discovery_consultation",
      presenting_complaints: complaintsText,
      session_date: new Date().toISOString().slice(0, 10),
    });

    setSaving(false);
    if (!res.ok) {
      setError((res as { error?: string }).error ?? "Failed to save session");
      return;
    }

    const id = (res as { session_id?: string }).session_id ?? "";
    setSavedSession({ id, labText, journalText });
    onSaved?.(id);
    setTimeout(() => {
      outputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    router.refresh();
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  if (savedSession) {
    return (
      <div ref={outputRef} className="space-y-4">
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-center gap-2 text-sm">
          <span>✅</span>
          <span className="font-semibold text-emerald-800">Discovery session saved</span>
          <span className="font-mono text-xs text-emerald-600">{savedSession.id}</span>
        </div>

        {/* Lab request output */}
        {selectedCount > 0 && (
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-violet-800">📋 Lab request — share with client</h4>
              <div className="flex gap-2">
                <button
                  onClick={() => copyToClipboard(savedSession.labText)}
                  className="text-xs px-3 py-1 rounded-lg border border-violet-300 bg-white text-violet-700 hover:bg-violet-100 transition-colors"
                >
                  {copied ? "✅ Copied" : "📋 Copy"}
                </button>
                <button
                  onClick={() => window.print()}
                  className="text-xs px-3 py-1 rounded-lg border border-violet-300 bg-white text-violet-700 hover:bg-violet-100 transition-colors"
                >
                  🖨 Print
                </button>
              </div>
            </div>
            <pre className="text-xs text-violet-900 whitespace-pre-wrap font-sans leading-relaxed">
              {savedSession.labText}
            </pre>
          </div>
        )}

        {/* Food journal output */}
        {foodJournalEnabled && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-amber-800">📓 Food journal request — share with client</h4>
              <button
                onClick={() => copyToClipboard(savedSession.journalText)}
                className="text-xs px-3 py-1 rounded-lg border border-amber-300 bg-white text-amber-700 hover:bg-amber-100 transition-colors"
              >
                {copied ? "✅ Copied" : "📋 Copy"}
              </button>
            </div>
            <pre className="text-xs text-amber-900 whitespace-pre-wrap font-sans leading-relaxed">
              {savedSession.journalText}
            </pre>
          </div>
        )}

        <button
          onClick={() => setSavedSession(null)}
          className="text-xs text-muted-foreground underline"
        >
          Record another discovery session
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Chief complaints */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">
          Chief complaints <span className="text-muted-foreground font-normal">(what is the client struggling with?)</span>
        </label>
        <textarea
          rows={3}
          value={complaints}
          onChange={(e) => setComplaints(e.target.value)}
          placeholder="e.g. Chronic fatigue, weight gain, bloating after meals, irregular periods, brain fog since 2 years..."
          className="w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
      </div>

      {/* Lab panel selection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground">
            Recommended labs
            {selectedCount > 0 && (
              <span className="ml-2 text-xs font-normal text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded-full">
                {selectedCount} selected
              </span>
            )}
          </label>
          {selectedLabs.size > 0 && (
            <button
              onClick={() => setSelectedLabs(new Set())}
              className="text-[11px] text-muted-foreground underline"
            >
              Clear all
            </button>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Legend: <span className="font-mono">₹</span> &lt;₹500 · <span className="font-mono">₹₹</span> ₹500–2k ·{" "}
          <span className="font-mono">₹₹₹</span> ₹2k+ · 🏷 specialty lab (may need a partner pathology)
        </p>

        <div className="space-y-3">
          {visiblePanels.map((panel) => {
            const allSelected = panel.labs.every((l) => selectedLabs.has(l.name));
            const someSelected = panel.labs.some((l) => selectedLabs.has(l.name));
            return (
              <div key={panel.group} className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => toggleGroup(panel.labs)}
                    className={`flex items-center gap-1.5 text-xs font-semibold transition-colors ${
                      someSelected ? "text-violet-700" : "text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] ${
                        allSelected
                          ? "bg-violet-500 border-violet-500 text-white"
                          : someSelected
                          ? "bg-violet-200 border-violet-400 text-violet-600"
                          : "border-muted-foreground/30"
                      }`}
                    >
                      {allSelected ? "✓" : someSelected ? "–" : ""}
                    </span>
                    <span>{panel.icon} {panel.group}</span>
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {panel.labs.map((lab) => {
                    const isSelected = selectedLabs.has(lab.name);
                    return (
                      <button
                        key={lab.name}
                        onClick={() => toggleLab(lab.name)}
                        title={lab.specialty ? "Specialty lab — may need a partner pathology" : undefined}
                        className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors inline-flex items-center gap-1 ${
                          isSelected
                            ? "bg-violet-100 border-violet-400 text-violet-800"
                            : "bg-muted/30 border-border text-muted-foreground hover:border-violet-300"
                        }`}
                      >
                        {isSelected && <span>✓</span>}
                        <span>{lab.name}</span>
                        <span className="font-mono opacity-70">{lab.cost}</span>
                        {lab.specialty && <span title="Specialty lab">🏷</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Custom labs */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Additional tests (comma-separated)</label>
          <input
            type="text"
            value={customLabs}
            onChange={(e) => setCustomLabs(e.target.value)}
            placeholder="e.g. Anti-nuclear antibodies, Uric acid, Stool calprotectin"
            className="w-full rounded-lg border px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
        </div>
      </div>

      {/* Food journal */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-foreground flex items-center gap-2">
          <input
            type="checkbox"
            checked={foodJournalEnabled}
            onChange={(e) => setFoodJournalEnabled(e.target.checked)}
            className="rounded"
          />
          Request a food journal
        </label>
        {foodJournalEnabled && (
          <div className="flex items-center gap-2 pl-5">
            <span className="text-xs text-muted-foreground">Duration:</span>
            {([3, 5, 7] as const).map((d) => (
              <button
                key={d}
                onClick={() => setFoodJournalDays(d)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  foodJournalDays === d
                    ? "bg-amber-100 border-amber-400 text-amber-800 font-semibold"
                    : "border-border text-muted-foreground hover:border-amber-300"
                }`}
              >
                {d} days
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Coach notes */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">
          Coach notes <span className="text-muted-foreground font-normal">(internal, not shared)</span>
        </label>
        <textarea
          rows={2}
          value={coachNotes}
          onChange={(e) => setCoachNotes(e.target.value)}
          placeholder="e.g. Client mentioned family history of thyroid issues. Seemed anxious about costs — suggest starting with core panel."
          className="w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg border border-red-200">{error}</p>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-60"
        style={{ background: "var(--brand-indigo)", color: "#fff" }}
      >
        {saving ? "Saving…" : "💾 Save discovery session + generate lab request"}
      </button>

      <p className="text-[11px] text-muted-foreground text-center">
        Saves the session and generates a shareable lab request + food journal note for the client.
      </p>
    </div>
  );
}
