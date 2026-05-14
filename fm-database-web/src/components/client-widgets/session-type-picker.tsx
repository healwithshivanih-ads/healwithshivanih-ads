"use client";

/**
 * SessionTypePicker — branded 3-card selector shown at the top of the Assess tab.
 * Coach picks what kind of session this is before any inputs appear.
 */

export type SessionType = "discovery" | "intake" | "check_in" | "quick_note";

interface SessionOption {
  key: SessionType;
  icon: string;
  label: string;
  subtitle: string;
  description: string;
  tag: string;
  tagColor: string;
  accentBorder: string;
  accentBg: string;
  selectedBg: string;
  selectedBorder: string;
}

const OPTIONS: SessionOption[] = [
  {
    key: "discovery",
    icon: "🔍",
    label: "Discovery",
    subtitle: "First contact, before labs",
    description:
      "Short call to record chief complaints, recommend targeted labs, and request a food journal. Client comes back for an intake once labs are done.",
    tag: "First call",
    tagColor: "bg-[#A8C5A0]/20 text-[#3D6B35]",
    accentBorder: "border-[#A8C5A0]",
    accentBg: "bg-[#A8C5A0]/5",
    selectedBg: "bg-[#A8C5A0]/10",
    selectedBorder: "border-[#A8C5A0]",
  },
  {
    key: "intake",
    icon: "📋",
    label: "Intake",
    subtitle: "Detailed session with labs",
    description:
      "Client returns with labs and food journal. Capture the full FM timeline, lab data, symptoms, and Five Pillars. Run AI assessment afterwards.",
    tag: "Full intake",
    tagColor: "bg-[#2B2D42]/10 text-[#2B2D42]",
    accentBorder: "border-[#2B2D42]",
    accentBg: "bg-[#2B2D42]/5",
    selectedBg: "bg-[#2B2D42]/8",
    selectedBorder: "border-[#2B2D42]",
  },
  {
    key: "check_in",
    icon: "💬",
    label: "Check-in",
    subtitle: "Progress review",
    description:
      "Record how the client is responding to the current plan, update measurements, and note any adjustments needed.",
    tag: "Follow-up",
    tagColor: "bg-[#8D99AE]/20 text-[#3D4A5C]",
    accentBorder: "border-[#8D99AE]",
    accentBg: "bg-[#8D99AE]/5",
    selectedBg: "bg-[#8D99AE]/10",
    selectedBorder: "border-[#8D99AE]",
  },
  {
    key: "quick_note",
    icon: "📌",
    label: "Quick Note",
    subtitle: "Between sessions",
    description:
      "Log a brief between-session update — e.g. a client message, ingredient swap, or small plan tweak. No AI analysis.",
    tag: "Ad-hoc",
    tagColor: "bg-[#E8A87C]/20 text-[#7A4A2A]",
    accentBorder: "border-[#E8A87C]",
    accentBg: "bg-[#E8A87C]/5",
    selectedBg: "bg-[#E8A87C]/10",
    selectedBorder: "border-[#E8A87C]",
  },
];

interface SessionTypePickerProps {
  value: SessionType;
  onChange: (v: SessionType) => void;
}

export function SessionTypePicker({ value, onChange }: SessionTypePickerProps) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-brand text-lg font-bold" style={{ color: "var(--brand-indigo)" }}>
          What kind of session is this?
        </h3>
        <p className="text-xs mt-0.5" style={{ color: "var(--brand-lavender)" }}>
          Choose a session type to see the right inputs for this appointment.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {OPTIONS.map((opt) => {
          const isSelected = value === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => onChange(opt.key)}
              className={[
                "relative text-left rounded-xl border-2 p-4 transition-all duration-150 group",
                "hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
                isSelected
                  ? `${opt.selectedBorder} ${opt.selectedBg} shadow-sm`
                  : "border-border bg-card hover:border-[var(--brand-lavender)]",
              ].join(" ")}
            >
              {/* Selected indicator dot */}
              <span
                className={[
                  "absolute top-3 right-3 w-2.5 h-2.5 rounded-full border-2 transition-all",
                  isSelected ? `${opt.accentBorder} ${opt.accentBg}` : "border-border bg-transparent",
                ].join(" ")}
              />

              {/* Icon + label row */}
              <div className="flex items-start gap-3 mb-2">
                <span className="text-2xl leading-none mt-0.5">{opt.icon}</span>
                <div className="min-w-0">
                  <div
                    className="font-brand font-bold text-base leading-tight"
                    style={{ color: isSelected ? "var(--brand-indigo)" : "var(--brand-ink)" }}
                  >
                    {opt.label}
                  </div>
                  <div className="text-[11px] font-medium mt-0.5" style={{ color: "var(--brand-lavender)" }}>
                    {opt.subtitle}
                  </div>
                </div>
              </div>

              {/* Description */}
              <p className="text-xs leading-relaxed text-muted-foreground">
                {opt.description}
              </p>

              {/* Tag */}
              <div className={`mt-3 inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${opt.tagColor}`}>
                {opt.tag}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
