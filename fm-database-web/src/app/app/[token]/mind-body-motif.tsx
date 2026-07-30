/* ======================================================================
   The roots motif — the mind-body section's visual signature.

   The brand already contains the idea. The Ochre Tree renders a canopy AND
   a root system, and this section is literally the app's "what's underneath":
   the same condition the client sees on the surface, read from below. So the
   section gets roots rather than a new icon — the metaphor does the work of
   making it feel different, without a second visual language to maintain.

   SVG rather than an image on purpose: it stays crisp at any pixel density,
   takes its colour from the theme rather than baking one in, adds about a
   kilobyte, and works offline like everything else in this PWA. A raster
   header would be none of those things.

   The shape is deliberately asymmetric and hand-plotted. A mirrored, evenly
   spaced root system reads as a logo; real roots wander, and the wandering is
   what stops this looking like corporate decoration.
   ====================================================================== */

/**
 * Roots descending — sits under the section heading.
 *
 * Two failed attempts, same cause both times: every lateral left from the
 * CROWN, and a set of strands radiating from one point near the top is the
 * silhouette of an umbrella no matter how steeply they fall. Real roots branch
 * at different DEPTHS along the taproot, each fork thinner than the one above.
 * That single structural change is what makes it read as roots, so keep the
 * branch points spread down the main path if this is ever redrawn.
 */
export function RootsMotif() {
  return (
    <svg
      className="mbr-motif"
      viewBox="0 0 120 64"
      width="120"
      height="64"
      aria-hidden="true"
      focusable="false"
    >
      {/* a short surface line — just enough to say "below this" */}
      <path d="M44 5 H78" className="mbr-motif-soil" strokeLinecap="round" />

      {/* taproot, wandering, thickest at the crown and tapering down */}
      <path
        d="M61 5 C63 14 59 20 61 27 C63 34 59 41 61 48 C62 53 60 57 61 60"
        className="mbr-motif-root mbr-motif-root--main"
      />

      {/* fork 1 — high on the root, the longest reach */}
      <path d="M60 18 C50 22 42 27 36 36" className="mbr-motif-root" />
      <path d="M36 36 C32 41 30 45 28 51" className="mbr-motif-root mbr-motif-root--fine" />

      {/* fork 2 — mid, opposite side, shorter */}
      <path d="M62 28 C72 32 79 37 84 45" className="mbr-motif-root" />
      <path d="M84 45 C87 49 88 52 90 56" className="mbr-motif-root mbr-motif-root--fine" />

      {/* fork 3 — deep and fine, the newest growth */}
      <path d="M60 42 C54 46 50 51 47 58" className="mbr-motif-root mbr-motif-root--fine" />
      <path d="M62 47 C67 51 70 54 72 59" className="mbr-motif-root mbr-motif-root--fine" />

      {/* tips — where something is still reaching */}
      <circle cx="61" cy="60" r="1.7" className="mbr-motif-tip" />
      <circle cx="28" cy="51" r="1.3" className="mbr-motif-tip" />
      <circle cx="90" cy="56" r="1.3" className="mbr-motif-tip" />
    </svg>
  );
}
