"use client";

/**
 * Thin client-side wrapper around FmMarkerPanel that wires the
 * "🔄 Re-run markers" button to the recomputeLabMarkersAction
 * server action. RSCs can pass server actions to client components,
 * but FmMarkerPanel's onRecompute callback expects a specific
 * { ok, markersCount, error } return shape — we adapt the server
 * action's snake_case response here.
 */
import { FmMarkerPanel, type FmMarkerGroup } from "@/components/fm";
import { recomputeLabMarkersAction } from "@/app/clients/actions";

export function MarkerPanelWithRecompute({
  clientId,
  groups,
  subtitle,
}: {
  clientId: string;
  groups: FmMarkerGroup[];
  subtitle?: React.ReactNode;
}) {
  return (
    <FmMarkerPanel
      groups={groups}
      subtitle={subtitle}
      onRecompute={async () => {
        const res = await recomputeLabMarkersAction(clientId);
        return {
          ok: res.ok,
          markersCount: res.markers_count,
          error: res.error,
        };
      }}
    />
  );
}
