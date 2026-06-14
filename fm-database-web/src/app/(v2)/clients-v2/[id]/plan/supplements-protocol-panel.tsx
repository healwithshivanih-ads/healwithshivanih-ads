"use client";

/**
 * SupplementsProtocolPanel — the single supplements surface on the Plan tab.
 *
 * Shows the rich read display (FmSupplementGrid — timing bubbles + click-to-
 * read rationale) by default, with an "✏️ Edit" toggle that swaps to the
 * in-place quick editor (dose / timing / remove) for a PUBLISHED plan. This
 * replaces the old split where supplements were read-only in the protocol
 * column AND separately editable inside the App-preview studio — one surface
 * now, in the protocol column.
 */

import { useState } from "react";
import { FmPanel, FmSupplementGrid } from "@/components/fm";
import {
  QuickEditSupplementsPanel,
  type QuickEditSupplementRow,
} from "./quick-edit-supplements-panel";

interface Props {
  planSlug: string;
  gridItems: React.ComponentProps<typeof FmSupplementGrid>["items"];
  editRows: QuickEditSupplementRow[];
  /** false on draft/ready plans (drafts edit in the full plan editor). */
  editable?: boolean;
}

export function SupplementsProtocolPanel({
  planSlug,
  gridItems,
  editRows,
  editable = true,
}: Props) {
  const [editing, setEditing] = useState(false);
  const count = Array.isArray(gridItems) ? gridItems.length : 0;

  return (
    <FmPanel
      title={`💊 Supplements (${count})`}
      subtitle="Daily timing bubbles + the same data the client letter ships. Click a slot to filter; click a row to read the coach rationale."
      rightSlot={
        editable ? (
          <button
            onClick={() => setEditing((v) => !v)}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: editing ? "var(--fm-text-secondary)" : "var(--fm-primary)",
              cursor: "pointer",
              background: "transparent",
              border: 0,
              fontFamily: "inherit",
            }}
          >
            {editing ? "✓ Done" : "✏️ Edit"}
          </button>
        ) : undefined
      }
    >
      {editing && editable ? (
        <QuickEditSupplementsPanel planSlug={planSlug} supplements={editRows} embedded />
      ) : (
        <FmSupplementGrid items={gridItems} />
      )}
    </FmPanel>
  );
}
