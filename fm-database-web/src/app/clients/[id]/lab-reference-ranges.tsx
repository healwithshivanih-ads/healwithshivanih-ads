"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  saveLabReferenceRangesAction,
  loadLabReferenceRangesAction,
  type LabReferenceRanges,
  type LabReferenceRange,
} from "@/app/clients/actions";

// ─── FM default optimal ranges ────────────────────────────────────────────────

export const DEFAULT_FM_RANGES: LabReferenceRanges = {
  TSH:               { optimal_low: 1.0,  optimal_high: 2.0,  unit: "mIU/L" },
  "Free T4":         { optimal_low: 1.1,  optimal_high: 1.8,  unit: "ng/dL" },
  "Free T3":         { optimal_low: 3.2,  optimal_high: 4.4,  unit: "pg/mL" },
  "Vitamin D":       { optimal_low: 60,   optimal_high: 80,   unit: "ng/mL" },
  Ferritin:          { optimal_low: 70,   optimal_high: 150,  unit: "ng/mL" },
  "HOMA-IR":         { optimal_low: 0,    optimal_high: 1.5,  unit: "" },
  hsCRP:             { optimal_low: 0,    optimal_high: 0.5,  unit: "mg/L" },
  "Fasting Glucose": { optimal_low: 75,   optimal_high: 86,   unit: "mg/dL" },
  HbA1c:             { optimal_low: 4.8,  optimal_high: 5.4,  unit: "%" },
  "Total Cholesterol":{ optimal_low: 160, optimal_high: 200,  unit: "mg/dL" },
  Triglycerides:     { optimal_low: 0,    optimal_high: 80,   unit: "mg/dL" },
  HDL:               { optimal_low: 60,   optimal_high: 80,   unit: "mg/dL" },
  Homocysteine:      { optimal_low: 6,    optimal_high: 9,    unit: "µmol/L" },
  B12:               { optimal_low: 600,  optimal_high: 900,  unit: "pg/mL" },
};

// ─── Row component ─────────────────────────────────────────────────────────────

function RangeRow({
  marker,
  range,
  onChange,
  onRemove,
}: {
  marker: string;
  range: LabReferenceRange;
  onChange: (range: LabReferenceRange) => void;
  onRemove: () => void;
}) {
  return (
    <tr className="border-t border-muted/50 group">
      <td className="py-1.5 pr-2 text-xs font-medium whitespace-nowrap">{marker}</td>
      <td className="py-1.5 pr-2">
        <Input
          type="number"
          className="h-7 text-xs w-20"
          value={range.optimal_low ?? ""}
          step="any"
          onChange={(e) => onChange({ ...range, optimal_low: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
        />
      </td>
      <td className="py-1.5 pr-2">
        <Input
          type="number"
          className="h-7 text-xs w-20"
          value={range.optimal_high ?? ""}
          step="any"
          onChange={(e) => onChange({ ...range, optimal_high: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
        />
      </td>
      <td className="py-1.5 pr-2">
        <Input
          className="h-7 text-xs w-20"
          value={range.unit ?? ""}
          onChange={(e) => onChange({ ...range, unit: e.target.value })}
        />
      </td>
      <td className="py-1.5">
        <button
          type="button"
          onClick={onRemove}
          className="text-[10px] text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function LabReferenceRangesEditor({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [ranges, setRanges] = useState<LabReferenceRanges>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // New marker form state
  const [newMarker, setNewMarker] = useState("");
  const [newLow, setNewLow] = useState("");
  const [newHigh, setNewHigh] = useState("");
  const [newUnit, setNewUnit] = useState("");

  useEffect(() => {
    if (open && !loaded) {
      loadLabReferenceRangesAction(clientId).then((r) => {
        setRanges(r);
        setLoaded(true);
      });
    }
  }, [open, loaded, clientId]);

  const handleChange = (marker: string, range: LabReferenceRange) => {
    setRanges((prev) => ({ ...prev, [marker]: range }));
  };

  const handleRemove = (marker: string) => {
    setRanges((prev) => {
      const next = { ...prev };
      delete next[marker];
      return next;
    });
  };

  const handleAdd = () => {
    if (!newMarker.trim()) return;
    setRanges((prev) => ({
      ...prev,
      [newMarker.trim()]: {
        optimal_low: newLow !== "" ? parseFloat(newLow) : undefined,
        optimal_high: newHigh !== "" ? parseFloat(newHigh) : undefined,
        unit: newUnit.trim() || undefined,
      },
    }));
    setNewMarker("");
    setNewLow("");
    setNewHigh("");
    setNewUnit("");
  };

  const handleLoadDefaults = () => {
    setRanges((prev) => {
      const next = { ...prev };
      for (const [marker, range] of Object.entries(DEFAULT_FM_RANGES)) {
        if (!(marker in next)) {
          next[marker] = { ...range };
        }
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    const res = await saveLabReferenceRangesAction(clientId, ranges);
    setSaving(false);
    if (res.ok) {
      toast.success("Reference ranges saved");
    } else {
      toast.error(res.error ?? "Failed to save");
    }
  };

  const markerList = Object.keys(ranges);

  return (
    <Card>
      <CardHeader className="pb-2 cursor-pointer select-none" onClick={() => setOpen((v) => !v)}>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>🎯 FM Reference Ranges</span>
          <span className="text-muted-foreground text-xs font-normal">
            {markerList.length > 0 ? `${markerList.length} marker${markerList.length !== 1 ? "s" : ""}` : ""}
            <span className="ml-2">{open ? "▲" : "▼"}</span>
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          FM-optimal ranges — tighter than standard lab normals. Used to flag values in Health Trends.
        </p>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4 pt-0">
          {!loaded ? (
            <p className="text-xs text-muted-foreground italic">Loading…</p>
          ) : (
            <>
              {markerList.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No ranges set. Click "Load FM defaults" to pre-fill common markers.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-[10px] text-muted-foreground text-left">
                        <th className="pr-2 pb-1 font-medium">Marker</th>
                        <th className="pr-2 pb-1 font-medium">Optimal Low</th>
                        <th className="pr-2 pb-1 font-medium">Optimal High</th>
                        <th className="pr-2 pb-1 font-medium">Unit</th>
                        <th className="pb-1" />
                      </tr>
                    </thead>
                    <tbody>
                      {markerList.map((marker) => (
                        <RangeRow
                          key={marker}
                          marker={marker}
                          range={ranges[marker]}
                          onChange={(r) => handleChange(marker, r)}
                          onRemove={() => handleRemove(marker)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Add marker row */}
              <div className="flex flex-wrap gap-2 items-end border-t border-muted/50 pt-3">
                <div className="space-y-0.5">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Marker name</label>
                  <Input
                    className="h-7 text-xs w-36"
                    placeholder="e.g. Insulin"
                    value={newMarker}
                    onChange={(e) => setNewMarker(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                  />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Low</label>
                  <Input
                    type="number"
                    className="h-7 text-xs w-20"
                    placeholder="0"
                    value={newLow}
                    step="any"
                    onChange={(e) => setNewLow(e.target.value)}
                  />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide">High</label>
                  <Input
                    type="number"
                    className="h-7 text-xs w-20"
                    placeholder="0"
                    value={newHigh}
                    step="any"
                    onChange={(e) => setNewHigh(e.target.value)}
                  />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Unit</label>
                  <Input
                    className="h-7 text-xs w-20"
                    placeholder="mg/dL"
                    value={newUnit}
                    onChange={(e) => setNewUnit(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAdd}
                  disabled={!newMarker.trim()}
                  className="h-7 text-xs"
                >
                  ＋ Add
                </Button>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleLoadDefaults}
                  className="text-xs"
                >
                  📋 Load FM defaults
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving}
                  className="text-xs"
                >
                  {saving ? "Saving…" : "💾 Save ranges"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
