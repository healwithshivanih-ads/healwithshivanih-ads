/* ======================================================================
   Position figures for the somatic intro screen.

   "Lie on your back with your knees bent" is one glance as a picture and
   three readings as a sentence. The EFT session set the precedent — a figure
   with the live point on it — and these follow it in the overlay's own
   warm-line language: hand-authored strokes, no assets, nothing to load.

   A figure appears ONLY for a practice whose posture is verified against its
   catalogue steps (grep before mapping, always). A wrong posture drawing is
   worse than none — the client will trust the picture over the words.
   The warm dot marks where the hands go, when the practice says so.
   ====================================================================== */

const LINE = "rgba(242,237,226,0.85)";   // body — the overlay's text colour
const FAINT = "rgba(242,237,226,0.28)";  // floor / wall / chair
const DOT = "#f0c98a";                    // where the hands rest

const strokes = { stroke: LINE, strokeWidth: 3.5, strokeLinecap: "round" as const, fill: "none" };
const faint = { stroke: FAINT, strokeWidth: 2.5, strokeLinecap: "round" as const, fill: "none" };

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg
      viewBox="0 0 200 130"
      width="100%"
      style={{ maxWidth: 210, display: "block", margin: "0 auto 6px" }}
      role="img"
      aria-label={label}
    >
      {children}
    </svg>
  );
}

/** Sitting, one hand resting on the belly (gastrocolic-rhythm). */
function SeatedBelly() {
  return (
    <Frame label="Sitting upright with a hand resting on the belly">
      <path d="M30 118 H170" {...faint} />
      <path d="M88 84 H124 M124 84 V118 M92 84 V118" {...faint} />
      <circle cx="97" cy="34" r="11" {...strokes} />
      <path d="M99 45 C97 58 95 72 93 84" {...strokes} />
      <path d="M93 84 L126 86 L124 116 M124 116 L136 116" {...strokes} />
      <path d="M98 54 C108 60 110 66 106 74" {...strokes} />
      <circle cx="107" cy="76" r="4.5" fill={DOT} stroke="none" />
    </Frame>
  );
}

/** On the back, knees bent, hands on the belly (constructive-rest family). */
function LyingKneesBent() {
  return (
    <Frame label="Lying on the back, knees bent, feet flat, hands on the belly">
      <path d="M18 112 H182" {...faint} />
      <circle cx="42" cy="98" r="11" {...strokes} />
      <path d="M54 102 L118 102" {...strokes} />
      <path d="M118 102 L140 64 L152 108 M148 108 L160 108" {...strokes} />
      <path d="M60 100 C72 88 86 88 94 92" {...strokes} />
      <circle cx="97" cy="94" r="4.5" fill={DOT} stroke="none" />
    </Frame>
  );
}

/** On the back, legs resting up a wall. */
function LegsUpWall() {
  return (
    <Frame label="Lying on the back with the legs resting up a wall">
      <path d="M18 112 H182" {...faint} />
      <path d="M140 18 V112" {...faint} />
      <circle cx="46" cy="98" r="11" {...strokes} />
      <path d="M58 102 L112 104" {...strokes} />
      <path d="M112 104 L134 40 M134 40 L126 36" {...strokes} />
      <path d="M64 102 C74 110 86 112 96 110" {...strokes} />
    </Frame>
  );
}

/** Standing, palms flat against a wall, leaning in (boundary-push). */
function WallPush() {
  return (
    <Frame label="Standing, palms flat on a wall, leaning in">
      <path d="M24 118 H176" {...faint} />
      <path d="M148 16 V118" {...faint} />
      <circle cx="74" cy="30" r="11" {...strokes} />
      <path d="M80 41 L100 82" {...strokes} />
      <path d="M84 50 L146 58 M88 58 L146 74" {...strokes} />
      <circle cx="146" cy="58" r="4" fill={DOT} stroke="none" />
      <circle cx="146" cy="74" r="4" fill={DOT} stroke="none" />
      <path d="M100 82 L82 118 M100 82 L112 118" {...strokes} />
    </Frame>
  );
}

/** slug → figure. Add ONLY after verifying the posture in the practice YAML. */
const FIGURES: Record<string, () => React.ReactElement> = {
  "gastrocolic-rhythm": SeatedBelly,
  "belly-drop": LyingKneesBent,
  "constructive-rest": LyingKneesBent,
  "womb-cradling": LyingKneesBent,
  "safe-body-scan": LyingKneesBent,
  "weighted-grounding": LyingKneesBent,
  "legs-up-the-wall": LegsUpWall,
  "boundary-push": WallPush,
};

export function SomaticFigure({ slug }: { slug: string }) {
  const F = FIGURES[slug];
  return F ? <F /> : null;
}
