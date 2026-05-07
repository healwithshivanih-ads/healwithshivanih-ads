"use client";

/**
 * ProtocolAdherenceChart
 * Parses check_in sessions tagged [session_type: protocol_checkin] and renders
 * a colour-coded grid: rows = supplement/practice names, columns = dates.
 *
 * Status colours:
 *   ✅ still_taking / consistent  → emerald
 *   🔄 sometimes / mostly         → blue
 *   ⚠️ side_effects / struggling  → amber
 *   ❌ stopped / not_doing         → red
 */

import type { SessionSummary } from "@/app/assess/actions";

// ── Types ────────────────────────────────────────────────────────────────────

type Status = "still_taking" | "sometimes" | "side_effects" | "stopped" | "unknown";

interface AdherenceEntry {
  name: string;
  status: Status;
}

interface CheckInData {
  date: string;
  supplements: AdherenceEntry[];
  practices: AdherenceEntry[];
}

// ── Parser ───────────────────────────────────────────────────────────────────

const EMOJI_STATUS: Record<string, Status> = {
  "✅": "still_taking",
  "🔄": "sometimes",
  "⚠️": "side_effects",
  "❌": "stopped",
};

function parseAdherenceText(text: string): { supplements: AdherenceEntry[]; practices: AdherenceEntry[] } {
  const supplements: AdherenceEntry[] = [];
  const practices: AdherenceEntry[] = [];

  let inSupplements = false;
  let inPractices = false;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.includes("## 💊 Supplements")) { inSupplements = true; inPractices = false; continue; }
    if (line.includes("## 🌿 Lifestyle practices")) { inPractices = true; inSupplements = false; continue; }
    if (line.startsWith("## ") || line.startsWith("**Coach")) { inSupplements = false; inPractices = false; continue; }

    // Match lines like: ✅ magnesium glycinate (400mg, bedtime)
    const match = line.match(/^([✅🔄⚠️❌—])\s+(.+?)(?:\s*\(.*)?(?::\s*.+)?$/u);
    if (!match) continue;

    const emoji = match[1];
    const rawName = match[2].replace(/\s*\(.*$/, "").trim();
    const name = rawName.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    const status: Status = EMOJI_STATUS[emoji] ?? "unknown";

    if (inSupplements) supplements.push({ name, status });
    else if (inPractices) practices.push({ name, status });
  }

  return { supplements, practices };
}

function parseProtocolCheckins(sessions: SessionSummary[]): CheckInData[] {
  return sessions
    .filter(
      (s) =>
        s.session_type === "check_in" &&
        s.presenting_complaints?.includes("[session_type: protocol_checkin]"),
    )
    .map((s) => {
      const text = (s.presenting_complaints ?? "").replace(/^\[session_type:[^\]]+\]\s*/i, "").trim();
      const { supplements, practices } = parseAdherenceText(text);
      return {
        date: typeof s.date === "string" ? s.date : String(s.date ?? ""),
        supplements,
        practices,
      };
    })
    .filter((c) => c.supplements.length > 0 || c.practices.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Status chip ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<Status, { bg: string; text: string; emoji: string; label: string }> = {
  still_taking: { bg: "bg-emerald-100", text: "text-emerald-800", emoji: "✅", label: "Taking" },
  sometimes:    { bg: "bg-blue-100",    text: "text-blue-800",    emoji: "🔄", label: "Sometimes" },
  side_effects: { bg: "bg-amber-100",   text: "text-amber-800",   emoji: "⚠️", label: "Side effects" },
  stopped:      { bg: "bg-red-100",     text: "text-red-800",     emoji: "❌", label: "Stopped" },
  unknown:      { bg: "bg-muted",       text: "text-muted-foreground", emoji: "—", label: "No data" },
};

function StatusChip({ status }: { status: Status }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      title={s.label}
      className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-sm ${s.bg} ${s.text}`}
    >
      {s.emoji}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  sessions: SessionSummary[];
}

export function ProtocolAdherenceChart({ sessions }: Props) {
  const checkins = parseProtocolCheckins(sessions);

  if (checkins.length === 0) return null;

  // Collect all unique supplement + practice names in order of first appearance
  const supplNames: string[] = [];
  const practiceNames: string[] = [];
  for (const ci of checkins) {
    for (const e of ci.supplements) {
      if (!supplNames.includes(e.name)) supplNames.push(e.name);
    }
    for (const e of ci.practices) {
      if (!practiceNames.includes(e.name)) practiceNames.push(e.name);
    }
  }

  // Build lookup: name → date → status
  const supplMap: Record<string, Record<string, Status>> = {};
  const practiceMap: Record<string, Record<string, Status>> = {};
  for (const ci of checkins) {
    for (const e of ci.supplements) {
      supplMap[e.name] = supplMap[e.name] ?? {};
      supplMap[e.name][ci.date] = e.status;
    }
    for (const e of ci.practices) {
      practiceMap[e.name] = practiceMap[e.name] ?? {};
      practiceMap[e.name][ci.date] = e.status;
    }
  }

  const dates = checkins.map((c) => c.date);
  const fmtDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    } catch {
      return d;
    }
  };

  function Grid({
    title,
    names,
    lookup,
  }: {
    title: string;
    names: string[];
    lookup: Record<string, Record<string, Status>>;
  }) {
    if (names.length === 0) return null;
    return (
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2">{title}</p>
        <div className="overflow-x-auto">
          <table className="text-xs border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="text-left pr-3 pb-1 font-normal text-muted-foreground w-40 min-w-[10rem]">
                  Supplement
                </th>
                {dates.map((d) => (
                  <th key={d} className="text-center pb-1 font-normal text-muted-foreground px-0.5">
                    {fmtDate(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {names.map((name) => (
                <tr key={name}>
                  <td className="pr-3 py-0.5 text-foreground truncate max-w-[10rem]" title={name}>
                    {name}
                  </td>
                  {dates.map((d) => (
                    <td key={d} className="text-center py-0.5 px-0.5">
                      <StatusChip status={lookup[name]?.[d] ?? "unknown"} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-base">💊</span>
        <h3 className="text-sm font-semibold">Protocol adherence</h3>
        <span className="text-xs text-muted-foreground ml-auto">
          {checkins.length} check-in{checkins.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {(Object.entries(STATUS_STYLES) as [Status, typeof STATUS_STYLES[Status]][])
          .filter(([k]) => k !== "unknown")
          .map(([, s]) => (
            <span key={s.label} className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>{s.emoji}</span> {s.label}
            </span>
          ))}
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-muted text-muted-foreground text-xs">—</span>
          Not recorded
        </span>
      </div>

      <Grid title="💊 Supplements" names={supplNames} lookup={supplMap} />
      <Grid title="🌿 Lifestyle practices" names={practiceNames} lookup={practiceMap} />
    </div>
  );
}
