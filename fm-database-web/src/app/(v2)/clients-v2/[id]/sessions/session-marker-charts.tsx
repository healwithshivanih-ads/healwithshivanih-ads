/**
 * SessionMarkerCharts — server wrapper for the Sessions-tab trend tiles.
 *
 * Pulls `client.health_snapshots`, builds time-series per marker, computes
 * a default selection from `client.goals`, loads the catalogue + per-client
 * lab reference ranges + any previously-saved coach picks, then renders
 * the client component.
 *
 * Server component — async. Renders nothing if the client has no markers
 * with at least one data point.
 */
import type { Client } from "@/lib/fmdb/types";
import {
  loadLabReferenceRangesAction,
  loadLabTestsCatalogueAction,
  loadSessionChartMarkersAction,
} from "@/lib/server-actions/clients";
import {
  SessionMarkerChartsClient,
  type MarkerWithData,
  type MarkerGroup,
} from "./session-marker-charts-client";
// pickDefaultMarkers lives in a non-"use client" sibling module because
// Next 16 forbids server components from invoking functions exported by
// a "use client" file (the function becomes a client-reference proxy).
import { pickDefaultMarkers } from "./marker-defaults";
import { collectMeasurementSnapshots } from "@/lib/fmdb/measurements";

const DEFAULT_CAP = 6;

interface MeasurementConfig {
  field: keyof NonNullable<NonNullable<Client["health_snapshots"]>[number]["measurements"]>;
  label: string;
  unit: string;
  group: MarkerGroup;
  desired?: "down" | "up" | "neutral";
}

const MEASUREMENT_CONFIG: MeasurementConfig[] = [
  { field: "weight_kg", label: "Weight", unit: "kg", group: "Body comp", desired: "down" },
  { field: "waist_cm", label: "Waist", unit: "cm", group: "Body comp", desired: "down" },
  { field: "hip_cm", label: "Hip", unit: "cm", group: "Body comp", desired: "neutral" },
  { field: "height_cm", label: "Height", unit: "cm", group: "Body comp", desired: "neutral" },
  { field: "bp_systolic", label: "BP Systolic", unit: "mmHg", group: "Vitals", desired: "down" },
  { field: "bp_diastolic", label: "BP Diastolic", unit: "mmHg", group: "Vitals", desired: "down" },
  { field: "hr_bpm", label: "Heart Rate", unit: "bpm", group: "Vitals", desired: "neutral" },
];

/** Markers we know are "lower is better" for trend colouring even without ranges. */
const DOWN_DESIRED_LAB_PATTERNS = [
  /hba1c/i,
  /fasting\s*glucose/i,
  /fasting\s*insulin/i,
  /homa[-\s]?ir/i,
  /tg\s*\/?\s*hdl/i,
  /triglyceride/i,
  /ldl/i,
  /hscrp/i,
  /\bcrp\b/i,
  /esr/i,
  /fibrinogen/i,
  /homocysteine/i,
  /anti[-\s]?tpo/i,
  /antibod/i,
  /\btsh\b/i,
];

const UP_DESIRED_LAB_PATTERNS = [
  /hdl(?!.*ldl)/i,
  /vitamin\s*d/i,
  /\bb12\b/i,
  /ferritin/i,
  /free\s*t3/i,
  /\bft3\b/i,
];

function desiredForLab(label: string): "down" | "up" | "neutral" {
  if (DOWN_DESIRED_LAB_PATTERNS.some((r) => r.test(label))) return "down";
  if (UP_DESIRED_LAB_PATTERNS.some((r) => r.test(label))) return "up";
  return "neutral";
}

function groupForLab(label: string): MarkerGroup {
  // Most things from `lab_values` are blood markers; "Body Fat %" / etc fall
  // through. Heuristic only — picker still lets the coach see all.
  if (/body\s*fat/i.test(label) || /\bbmi\b/i.test(label) || /lean\s*mass/i.test(label)) {
    return "Body comp";
  }
  return "Blood markers";
}

export interface SessionMarkerChartsProps {
  clientId: string;
  client: Client;
  cap?: number;
}

export async function SessionMarkerCharts({
  clientId,
  client,
  cap = DEFAULT_CAP,
}: SessionMarkerChartsProps) {
  // Union of all three measurement stores (incl. coach weight-log) — see
  // src/lib/fmdb/measurements.ts. Already ascending by date.
  const snapshots = collectMeasurementSnapshots(client);

  // Build series map: key → list of points
  const series = new Map<string, { date: string; value: number }[]>();
  const meta = new Map<
    string,
    { label: string; unit: string; group: MarkerGroup; desired: "down" | "up" | "neutral" }
  >();

  function push(
    key: string,
    label: string,
    unit: string,
    group: MarkerGroup,
    desired: "down" | "up" | "neutral",
    date: string,
    value: number | null | undefined,
  ) {
    if (value == null) return;
    const num = typeof value === "number" ? value : Number(value);
    if (Number.isNaN(num)) return;
    const arr = series.get(key) ?? [];
    arr.push({ date, value: num });
    series.set(key, arr);
    if (!meta.has(key)) meta.set(key, { label, unit, group, desired });
  }

  for (const snap of snapshots) {
    // Measurements
    const m = snap.measurements ?? {};
    for (const cfg of MEASUREMENT_CONFIG) {
      const v = (m as Record<string, unknown>)[cfg.field];
      push(
        `measurement:${cfg.field}`,
        cfg.label,
        cfg.unit,
        cfg.group,
        cfg.desired ?? "neutral",
        snap.date,
        typeof v === "number" ? v : null,
      );
    }
    // Derived BMI when both height + weight present
    if (
      typeof m.weight_kg === "number" &&
      typeof m.height_cm === "number" &&
      m.height_cm > 0
    ) {
      const h = m.height_cm / 100;
      const bmi = m.weight_kg / (h * h);
      push("measurement:bmi", "BMI", "", "Body comp", "down", snap.date, Math.round(bmi * 10) / 10);
    }
    // Waist-to-hip
    if (typeof m.waist_cm === "number" && typeof m.hip_cm === "number" && m.hip_cm > 0) {
      const whr = m.waist_cm / m.hip_cm;
      push(
        "measurement:whr",
        "Waist:Hip Ratio",
        "",
        "Body comp",
        "down",
        snap.date,
        Math.round(whr * 100) / 100,
      );
    }
    // Lab values
    for (const lv of snap.lab_values ?? []) {
      const num = parseFloat(lv.value);
      if (Number.isNaN(num)) continue;
      const key = `lab:${lv.test_name}`;
      push(
        key,
        lv.test_name,
        lv.unit || "",
        groupForLab(lv.test_name),
        desiredForLab(lv.test_name),
        snap.date,
        num,
      );
    }
  }

  // Build MarkerWithData list, sorted alphabetically within each group.
  const allMarkers: MarkerWithData[] = [];
  for (const [key, points] of series) {
    const md = meta.get(key);
    if (!md) continue;
    // Sort points ascending by date
    const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
    allMarkers.push({
      key,
      label: md.label,
      unit: md.unit,
      group: md.group,
      desired: md.desired,
      series: sorted,
    });
  }

  if (allMarkers.length === 0) {
    return null;
  }

  // Load reference ranges, catalogue, saved picks in parallel.
  const [refRanges, catalogue, savedPicksRaw] = await Promise.all([
    loadLabReferenceRangesAction(clientId),
    loadLabTestsCatalogueAction(),
    loadSessionChartMarkersAction(clientId),
  ]);

  // Validate saved picks against currently-available markers.
  const availableKeys = new Set(allMarkers.map((m) => m.key));
  const validSaved = savedPicksRaw.filter((k) => availableKeys.has(k));

  let initialKeys: string[];
  if (validSaved.length > 0) {
    initialKeys = validSaved.slice(0, cap);
    // Pad with defaults if we have headroom
    if (initialKeys.length < cap) {
      const defaults = pickDefaultMarkers(allMarkers, client.goals ?? [], cap);
      for (const d of defaults) {
        if (!initialKeys.includes(d)) initialKeys.push(d);
        if (initialKeys.length >= cap) break;
      }
    }
  } else {
    initialKeys = pickDefaultMarkers(allMarkers, client.goals ?? [], cap);
  }

  return (
    <SessionMarkerChartsClient
      clientId={clientId}
      allMarkers={allMarkers}
      initialKeys={initialKeys}
      refRanges={refRanges}
      catalogue={catalogue}
      cap={cap}
    />
  );
}
