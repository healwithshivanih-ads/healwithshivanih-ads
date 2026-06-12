"use client";

/**
 * Shared context + icon set for the Ochre Tree client app.
 * Ported from the design handoff (icons.jsx); stroke = currentColor.
 */

import { createContext, useContext } from "react";
import type { ClientAppData } from "@/lib/fmdb/client-app";

export const OchreContext = createContext<ClientAppData | null>(null);

export function useOchre(): ClientAppData {
  const data = useContext(OchreContext);
  if (!data) throw new Error("OchreContext missing");
  return data;
}

export const REMEDY_CAT: Record<string, { label: string; icon: string; tradition: string }> = {
  kitchen_remedy: { label: "Kitchen remedy", icon: "bowl", tradition: "Traditional remedy" },
  infused_water: { label: "Infused water", icon: "water", tradition: "Ayurvedic remedy" },
  ayurvedic_churan: { label: "Ayurvedic churan", icon: "leaf", tradition: "Ayurvedic remedy" },
  herbal_tea: { label: "Herbal tea", icon: "leaf", tradition: "Traditional remedy" },
  vegetable_juice: { label: "Fresh juice", icon: "droplet", tradition: "Traditional remedy" },
  kashayam: { label: "Kashayam", icon: "droplet", tradition: "Ayurvedic remedy" },
  spice_blend: { label: "Spice blend", icon: "sparkle", tradition: "Traditional remedy" },
  other: { label: "Remedy", icon: "leaf", tradition: "Traditional remedy" },
};

export const DOSHA_LABEL: Record<string, string> = { vata: "Vata", pitta: "Pitta", kapha: "Kapha" };

// ── icon set (thin organic line icons) ──────────────────────────────────────

type IconPart = { tag: "path"; d: string; bold?: boolean; fill?: boolean } | { tag: "circle"; cx: number; cy: number; r: number; fill?: boolean };

const P = (d: string): IconPart => ({ tag: "path", d });
const C = (cx: number, cy: number, r: number, fill = false): IconPart => ({ tag: "circle", cx, cy, r, fill });

const PATHS: Record<string, IconPart[]> = {
  today: [P("M4 11.5 12 5l8 6.5"), P("M6 10.5V19h12v-8.5"), P("M10 19v-4.5h4V19")],
  plan: [P("M7 4h7l4 4v12H7z"), P("M14 4v4h4"), P("M9.5 13h5"), P("M9.5 16h5")],
  checkin: [
    P("M5 6.5C5 5.7 5.7 5 6.5 5H16l3 3v9.5c0 .8-.7 1.5-1.5 1.5h-11C5.7 19 5 18.3 5 17.5z"),
    P("M9 12l1.8 1.8L14.5 10"),
  ],
  coach: [C(12, 8.5, 3.2), P("M5.5 19a6.5 6.5 0 0 1 13 0")],
  sun: [
    C(12, 12, 3.4),
    P("M12 4v1.5M12 18.5V20M4 12h1.5M18.5 12H20M6.3 6.3l1 1M16.7 16.7l1 1M17.7 6.3l-1 1M7.3 16.7l-1 1"),
  ],
  moon: [P("M19 14.5A7.5 7.5 0 0 1 9.5 5a7 7 0 1 0 9.5 9.5z")],
  bowl: [P("M4 11h16"), P("M5 11a7 7 0 0 0 14 0"), P("M9 7c0-1 .6-1.6 1.2-2M13 7c0-1 .6-1.6 1.2-2")],
  leaf: [P("M5 19c0-7 5-12 14-12 0 9-5 13-12 13"), P("M8 16c2.5-2.5 5-4 9-5")],
  chev: [P("M9 6l6 6-6 6")],
  check: [P("M5 12.5l4.2 4.2L19 7")],
  checkBold: [{ tag: "path", d: "M5 12.5l4.2 4.2L19 7", bold: true }],
  message: [
    P("M5 6.5C5 5.7 5.7 5 6.5 5h11c.8 0 1.5.7 1.5 1.5v7c0 .8-.7 1.5-1.5 1.5H10l-4 3v-3H6.5C5.7 16 5 15.3 5 14.5z"),
  ],
  calendar: [P("M5.5 7h13v11.5h-13z"), P("M5.5 10h13"), P("M9 5v3M15 5v3")],
  whatsapp: [
    P("M5 19l1.1-3.2A6.6 6.6 0 1 1 9 18.4z"),
    P("M9 9.5c0 3 2.5 5 5 5 .8 0 1.3-.6 1.3-1.1 0-.3-1.4-1-1.7-1-.3 0-.5.4-.7.6-.8-.3-1.6-1.1-1.9-1.9.2-.2.6-.4.6-.7 0-.3-.7-1.7-1-1.7-.5 0-1.1.5-1.1 1.3z"),
  ],
  breath: [C(12, 12, 7), C(12, 12, 3), P("M12 5v2M12 17v2M5 12h2M17 12h2")],
  walk: [C(13, 5.5, 1.4), P("M13 8l-2 4 2 2v5"), P("M11 12l-3 1"), P("M13 14l3 1.5"), P("M11 16l-2 3")],
  water: [P("M12 4s5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 5-9 5-9z")],
  star: [P("M12 5l2 4.2 4.6.6-3.3 3.2.8 4.5L12 15.3 7.9 17.5l.8-4.5L5.4 9.8l4.6-.6z")],
  arrowRight: [P("M5 12h13M13 6l6 6-6 6")],
  sparkle: [P("M12 5v14M5 12h14M8 8l8 8M16 8l-8 8")],
  flag: [P("M7 4v16"), P("M7 5h9l-1.5 3L16 11H7")],
  pen: [P("M14.5 6.5l3 3M5 19l1-3.6 8.5-8.5 3 3L9 18z")],
  dot: [C(12, 12, 3, true)],
  droplet: [P("M12 5s4.5 5 4.5 8.2A4.5 4.5 0 0 1 7.5 13.2C7.5 10 12 5 12 5z")],
  clock: [C(12, 12, 7.2), P("M12 8v4.2l2.8 1.8")],
  pill: [P("M7.5 13.5l6-6a3.5 3.5 0 0 1 5 5l-6 6a3.5 3.5 0 0 1-5-5z"), P("M10.5 10.5l3 3")],
  progress: [P("M4 19V5"), P("M4 19h16"), P("M7.5 15l3.2-4 3 2.4L19 7.5")],
  bag: [P("M6.5 8h11l-.8 11.2a1 1 0 0 1-1 .8H8.3a1 1 0 0 1-1-.8z"), P("M9 8a3 3 0 0 1 6 0")],
  bell: [
    P("M12 4a5 5 0 0 0-5 5c0 4-1.5 5.5-2 6.2h14c-.5-.7-2-2.2-2-6.2a5 5 0 0 0-5-5z"),
    P("M10 19a2 2 0 0 0 4 0"),
  ],
  bellOff: [
    P("M12 4a5 5 0 0 0-5 5c0 4-1.5 5.5-2 6.2h14c-.5-.7-2-2.2-2-6.2a5 5 0 0 0-5-5z"),
    P("M10 19a2 2 0 0 0 4 0"),
    P("M4.5 4.5l15 15"),
  ],
  gear: [
    C(12, 12, 3),
    P("M12 4.5v2M12 17.5v2M4.5 12h2M17.5 12h2M6.5 6.5l1.4 1.4M16.1 16.1l1.4 1.4M17.5 6.5l-1.4 1.4M7.9 16.1l-1.4 1.4"),
  ],
  arrowLeft: [P("M19 12H6M11 6l-6 6 6 6")],
  plus: [P("M12 5v14M5 12h14")],
  swap: [P("M7 8h11l-2.5-2.5M17 16H6l2.5 2.5")],
  heart: [P("M12 19s-6.5-4.2-6.5-8.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 6.5 2.5C18.5 14.8 12 19 12 19z")],
  send: [P("M5 12l14-6-6 14-2.5-5.5z"), P("M10.5 13.5L19 6")],
  link: [
    P("M9.5 14.5l5-5"),
    P("M11 7l1-1a3 3 0 0 1 4.2 4.2l-1 1"),
    P("M13 17l-1 1A3 3 0 0 1 7.8 13.8l1-1"),
  ],
  chevDown: [P("M6 9l6 6 6-6")],
  external: [P("M14 5h5v5"), P("M19 5l-7 7"), P("M18 13v5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5")],
  bolt: [P("M13 4L6 13h5l-1 7 7-9h-5z")],
  search: [C(11, 11, 6.4), P("M20 20l-4.5-4.5")],
  book: [
    P("M5 5.5A1.5 1.5 0 0 1 6.5 4H18v14H6.5A1.5 1.5 0 0 0 5 19.5z"),
    P("M5 19.5A1.5 1.5 0 0 1 6.5 18H18v2H6.5A1.5 1.5 0 0 1 5 19.5z"),
  ],
  doc: [P("M7 4h7l4 4v12H7z"), P("M14 4v4h4"), P("M9.5 12h5M9.5 15h5")],
  play: [P("M9 7.5v9l7-4.5z")],
  sprout: [P("M12 20v-7"), P("M12 13c0-3-2.2-5-5-5 0 3 2 5 5 5z"), P("M12 11c0-2.6 2-4.5 4.5-4.5 0 2.6-1.9 4.5-4.5 4.5z")],
  forkKnife: [P("M7 4v6a2 2 0 0 0 2 2v8"), P("M7 4v4M9 4v4"), P("M16 4c-1.5 0-2.5 1.5-2.5 4s1 3.5 2.5 3.5V20")],
  hand: [
    P("M8 11V6.5a1.3 1.3 0 0 1 2.6 0V11"),
    P("M10.6 10.5V5.5a1.3 1.3 0 0 1 2.6 0V11"),
    P("M13.2 6.5a1.3 1.3 0 0 1 2.6 0V13"),
    P("M15.8 9.5a1.3 1.3 0 0 1 2.4.6c0 4-1.8 9.4-6.2 9.4-3 0-4.4-1.6-6-4.4l-1.4-2.5a1.3 1.3 0 0 1 2.2-1.4L8 11"),
  ],
  steam: [
    P("M8 13c0-2 2.5-2.5 2.5-5a3 3 0 0 0-1-2.2"),
    P("M13.5 13c0-2 2.5-2.5 2.5-5a3 3 0 0 0-1-2.2"),
    P("M6.5 16.5c1.5 1.2 9.5 1.2 11 0"),
    P("M8 19.5c1 .8 7 .8 8 0"),
  ],
};

export function Icon({
  name,
  size = 24,
  style,
  className,
}: {
  name: string;
  size?: number;
  style?: React.CSSProperties;
  className?: string;
}) {
  const parts = PATHS[name] ?? [];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} className={className} aria-hidden>
      {parts.map((p, i) =>
        p.tag === "circle" ? (
          <circle
            key={i}
            cx={p.cx}
            cy={p.cy}
            r={p.r}
            fill={p.fill ? "currentColor" : "none"}
            stroke={p.fill ? "none" : "currentColor"}
            strokeWidth={1.7}
          />
        ) : (
          <path
            key={i}
            d={p.d}
            fill="none"
            stroke="currentColor"
            strokeWidth={p.bold ? 2.4 : 1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
    </svg>
  );
}

/** Brand mark: navy horizontal bar + rose circle. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden>
      <rect x="2" y="11" width="14" height="4" rx="2" fill="#2D3047" />
      <circle cx="21" cy="13" r="4" fill="#C08080" />
    </svg>
  );
}
