"""Reduce a multi-position sheet to its two extreme poses, and gate on quality.

WHY TWO AND NOT SIX. Six positions is where all the fragility lives. The generator
has no concept of sequence, so the frames come back out of order (floor bridge ran
low-high-mid-low-high-high); it has no concept of "keep this identical", so the body
changes between frames; and six figures across a sheet need boundary detection that
fails at twelve. None of that applies to two poses: there is no order to get wrong,
and the start and end of a movement are exactly what a printed exercise sheet shows.

HOW THE TWO ARE CHOSEN. Not frame 1 and frame N — that assumes an order the sheet
may not have. The two frames with the greatest symmetric difference ARE the extremes
of the movement, whatever order they were drawn in. This is exercise-agnostic: it
needs no per-exercise metric and cannot be fooled by a routine that returns to its
start.

THE GATE. Eyeballing contact sheets got this wrong in both directions — five sheets
called failed that were fine, and a warm-up called failed by a metric comparing the
wrong pair. So acceptance is automatic and must pass before anything ships.
"""
import numpy as np


def _masks(frames, w=180, h=360):
    """Rasterise every frame into ONE shared coordinate space.

    Normalising each frame to its own bounding box is wrong and it fooled me twice:
    a bent knee makes the silhouette wider, so self-normalising stretches it and the
    frame reads as "a different body" at 82% difference. Frames must be compared where
    they actually sit — registered, in a common box — or the metric measures the
    bounding box rather than the movement.
    """
    off = [(f.get("rx", 0.0), f.get("ry", 0.0)) for f in frames]
    off = [(o[0] - off[0][0], o[1] - off[0][1]) for o in off]

    # BOTH LAYERS FEED THE SILHOUETTE. This rasterises from path bounding boxes,
    # which approximates a figure well when it is 40 small regions and terribly
    # when it is one. A two-layer trace has a single body path, so on its own it
    # rasterises to a filled RECTANGLE — and two rectangles differ by almost
    # nothing however different the poses are. Measured: a knee bend that plainly
    # moves scored 10%. The linework restores the internal shape the measure
    # needs.
    def _all(f):
        return list(f["paths"]) + list(f.get("lines", ()))

    xs, ys = [], []
    for f, (ox, oy) in zip(frames, off):
        for p in _all(f):
            a, b, c, d = p["bbox"]
            xs += [a + ox, c + ox]; ys += [b + oy, d + oy]
    if not xs:
        return [np.zeros((h, w), bool) for _ in frames]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    sx = (w - 1) / max(x1 - x0, 1e-6)
    sy = (h - 1) / max(y1 - y0, 1e-6)
    out = []
    for f, (ox, oy) in zip(frames, off):
        m = np.zeros((h, w), bool)
        for p in _all(f):
            a, b, c, d = p["bbox"]
            a, c = a + ox, c + ox
            b, d = b + oy, d + oy
            m[max(0, int((b - y0) * sy)):int((d - y0) * sy) + 1,
              max(0, int((a - x0) * sx)):int((c - x0) * sx) + 1] = True
        out.append(m)
    return out


def extremes(frames):
    """The two frames furthest apart in silhouette, and how far apart they are."""
    ms = _masks(frames)
    best, pair = -1.0, (0, len(frames) - 1)
    for i in range(len(ms)):
        for j in range(i + 1, len(ms)):
            u = (ms[i] | ms[j]).sum()
            d = 1.0 - ((ms[i] & ms[j]).sum() / u if u else 1.0)
            if d > best:
                best, pair = d, (i, j)
    return pair, best


# --- acceptance gate ---------------------------------------------------------
MIN_CHANGE = 0.13      # below this the two poses are the same picture
MAX_CHANGE = 0.72      # above this they are probably not the same body
MIN_PATHS = 20         # a REGION-traced frame this thin has lost its anatomy
MIN_LINES = 6          # a LINE-ART frame with less detail than this has lost it


def accept(slug, frames, single_pose_source=False):
    """Return (ok, [reasons]). Every reason is a measurement, not an impression.

    `single_pose_source=True` when each frame came from its OWN generation rather
    than from splitting one sheet. Two of the checks below only mean anything for
    a sheet split, and firing them on separately-drawn poses is a false alarm:

      * "differ by more than MAX_CHANGE — likely not the same body" was written to
        catch a split that handed one frame someone else's limb. Drawn separately,
        standing versus a press-up plank differs by 84% because THAT IS THE
        MOVEMENT, and the artwork is fine.
      * the height-ratio check catches the same failure by a second route, and
        breaks for the same reason — a plank is genuinely half the height of a
        standing figure.

    Measured on the 2026-08-05 conditioning batch: burpee (standing → plank) and
    alternate-toe-taps (plank → pike) failed both checks with CORRECT artwork,
    while ankle-jumps failed MIN_CHANGE with genuinely wrong artwork (a standing
    figure where a hop was asked for). So the "too different" pair are the
    sheet-specific checks, and MIN_CHANGE is the one worth keeping either way —
    a pair that does not differ will not read, however it was made.
    """
    reasons = []
    if len(frames) < 2:
        return False, [f"only {len(frames)} frame(s) split out"]
    (i, j), change = extremes(frames)
    if change < MIN_CHANGE:
        reasons.append(f"poses differ by only {change:.0%} — movement not visible")
    if change > MAX_CHANGE and not single_pose_source:
        reasons.append(f"poses differ by {change:.0%} — likely not the same body")
    # THE THRESHOLD IS PER TRACE TYPE, because "too thin" means different things.
    #
    # A region trace spreads a figure across 35-60 filled paths, so dropping below
    # MIN_PATHS means anatomy was genuinely lost. A two-layer trace is ONE body
    # path plus its linework by construction — the body is never lost, and what
    # would be missing is the detail. Judging it against the region count rejects
    # perfectly good figures: measured, five line-art sheets scored 9 to 22 and
    # all five were fine. So each form is held to the count that is meaningful
    # for it, rather than the guard being loosened for everyone.
    def _detail(f):
        return len(f["paths"]) + len(f.get("lines", ()))

    def _too_thin(f):
        if f.get("lines"):
            return len(f["lines"]) < MIN_LINES
        return len(f["paths"]) < MIN_PATHS

    thin = [k + 1 for k, f in enumerate((frames[i], frames[j])) if _too_thin(f)]
    if thin:
        counts = [_detail(frames[i]), _detail(frames[j])]
        reasons.append(f"chosen frames traced too thin ({counts} paths)")
    # the two chosen frames should be a similar size; a big disparity means the
    # split gave one frame someone else's limb
    a, b = frames[i], frames[j]
    ha, hb = a["y1"] - a["y0"], b["y1"] - b["y0"]
    if not single_pose_source and max(ha, hb) > 1.35 * max(min(ha, hb), 1e-6):
        reasons.append(f"chosen frames differ in height by {max(ha,hb)/max(min(ha,hb),1e-6):.2f}x — bad split")
    return (not reasons), reasons
