"""Trace a LINE-ART sheet as fill + linework, rather than as adjacent regions.

WHY THIS EXISTS ALONGSIDE wholesheet.py. trace.py models a figure as adjacent
FILLED REGIONS separated by a dark boundary, which is exactly what the Higgsfield
plate is: cream tendon shapes butted against grey muscle shapes, thin dark line
between. Cut along the dark and 35-60 clean regions fall out.

Other generators draw something structurally different — a SOLID body with dark
line work ON TOP. Run a region-finder over that and every interior line becomes a
cut, so the body falls into shards: measured on five Gamma sheets, 11 to 24
fragments each, none usable. No threshold fixes it. The lines are as dark as the
outline, so any cut that keeps the outline also keeps them, and any cut that
drops them fuses the body into a silhouette. The model was wrong, not the number.

So trace it the way it is actually drawn, in two layers:
  1. the SILHOUETTE — everything non-white, holes filled — as the body
  2. the DARK LINEWORK — thin filled shapes — drawn over it in the outline colour

A line IS a thin filled region, so this needs no skeletonising and no geometry
the tracer does not already have: the same region tracer runs twice over two
different masks.

Figures are separated by a VERTICAL CUT through the white space between them,
not by stripping the ground line. Stripping was the first attempt and does not
work: a ground line is wide and thin, but so is a plank, and where feet meet the
floor the two merge into one thick band that fails any thinness test.

STATUS — IN USE, WITH ONE KNOWN LIMIT. Two figures from it have shipped
(stretch-chest, forearm-plank); `lines` is carried through TracedFrame and drawn
in the outline colour, and twopose's gate counts both layers.

⚠ A PROP THAT TOUCHES THE BODY STILL DEFEATS IT, and the cause is not the hole
filler — it is that ONE FILLED PATH CANNOT EXPRESS A SHAPE WITH A HOLE IN IT.
Where a wall meets the hand and the floor, figure, wall and floor trace as a
single component, and the outer boundary of that component encloses the gap
between the body and the wall, so filling it fills the gap. Measured: the calf
stretch came out with a solid quadrant, and the side bend with a solid wedge
under the lean. Two of five sheets, both the ones with scenery.

The fix is not another threshold. It is to separate the prop from the body
before tracing and draw it back as its own path — the same answer the Higgsfield
wall props needed. Until then, ASK THE GENERATOR FOR FIGURES WITH NO SCENERY:
the three sheets without a prop came through clean first time.
"""
import importlib.util
import pathlib
from collections import deque

import numpy as np

_TRACE = pathlib.Path(__file__).resolve().parent / "trace.py"
_spec = importlib.util.spec_from_file_location("trace", _TRACE)
tr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tr)
tr.SCALE = 1



def _fill_holes(mask, max_frac=0.02):
    """Fill enclosed gaps — but only SMALL ones.

    Filling everything the background cannot reach is wrong as soon as the
    drawing contains an open frame. On the calf-stretch sheet the wall, the floor
    and the leaning figure enclose a large quadrant of white, and filling it
    turned the wall into a solid grey block covering a third of the picture.

    THE CAP IS SET FROM MEASUREMENT, not taste. Across the two sheets with props,
    every genuine anatomical hole came to 2 PIXELS or fewer, while the region
    enclosed by the wall, the floor and the leaning figure came to 58.6% and
    28.3% of the ink. There is no ambiguity to resolve between those, so a plain
    size cap does it.

    A shape test was tried first and is wrong: scenery is not reliably
    rectangular. That quadrant is bounded by a diagonal body, so it scores 0.70
    and 0.62 on boxiness — wedge-like, exactly what an armpit looks like — and a
    rule that filled wedges filled the wall.
    """
    h, w = mask.shape
    seen = np.zeros_like(mask)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not mask[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not mask[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not mask[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    # candidate holes are the background pixels the border flood never reached
    holes = ~seen & ~mask
    out = mask.copy()
    if holes.any():
        budget = max(1, int(max_frac * mask.sum()))
        for m, area, _c, _bbox in tr.components(holes, min_area=1):
            if area <= budget:
                out |= m
    return out


def _split_columns(mask, n):
    """Column indices that cut the sheet into `n` figures.

    NOT by removing the ground line, which was the first attempt and does not
    work: a ground line is wide and thin, but so is a plank, and where a figure's
    feet meet the floor the two run together into one thick band that fails the
    thinness test. Measured on the plank sheet, 392 rows were "wide" and none
    were strippable, so both figures stayed joined and the split never happened.

    Cut vertically instead. The generator is asked for clear white space between
    the figures, and the gap is unambiguous ABOVE the floor — so the column
    profile is measured over the upper part of the drawing only, where the ground
    line cannot fill every column equally.
    """
    ys = np.nonzero(mask.any(axis=1))[0]
    if len(ys) == 0:
        return []
    top, bottom = ys.min(), ys.max()
    upper = mask[top:top + int((bottom - top) * 0.85), :]
    col = upper.sum(axis=0)

    # SEARCH BETWEEN THE FIGURES, NOT ACROSS THE SHEET. Measured against the
    # sheet's full width, the emptiest column is the outer MARGIN — argmin
    # returns the first zero it meets, which on the knee-bend sheet was column
    # 770 in blank space at the left, so the cut sliced nothing and both figures
    # stayed joined. The drawing's own extent is the frame that matters.
    xs = np.nonzero(col)[0]
    if len(xs) == 0:
        return []
    left, right = int(xs.min()), int(xs.max())
    span = right - left

    cuts = []
    for i in range(1, n):
        lo = max(left + 1, left + int(span * (i / n - 0.22)))
        hi = min(right - 1, left + int(span * (i / n + 0.22)))
        if hi <= lo:
            continue
        window = col[lo:hi]
        # prefer the MIDDLE of the widest genuine gap; the centre of white space
        # is a safer cut than its first pixel, which may graze a limb
        runs, start = [], None
        for j, v in enumerate(window):
            if v == 0 and start is None:
                start = j
            elif v != 0 and start is not None:
                runs.append((start, j - 1))
                start = None
        if start is not None:
            runs.append((start, len(window) - 1))
        if runs:
            a, b = max(runs, key=lambda r: r[1] - r[0])
            cuts.append(lo + (a + b) // 2)
        else:
            cuts.append(lo + int(np.argmin(window)))
    return cuts


def trace_sheet(png, n, line_cut=150, min_line_area=40):
    """Trace one sheet of `n` figures. Returns a list of frame dicts.

    Each frame carries `paths` (the body) and `lines` (the linework over it), in
    a shared coordinate space scaled so the sheet is 1000 tall.
    """
    a = tr.load(png)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lum = (r + g + b) / 3.0
    tinted = (np.abs(r - b) > 6) | (np.abs(g - b) > 6)
    ink = (lum < 232) | tinted

    solid = _fill_holes(ink)
    # Cut the sheet apart so each figure — and the slice of floor beneath it —
    # is its own component. BOTH masks take the same cut: the dark outlines of
    # the two figures are joined by the dark ground line, so without it the
    # linework traces as ONE component spanning the whole drawing, gets assigned
    # to whichever figure holds its centroid, and drags that frame's bounds
    # across its neighbour.
    cuts = _split_columns(solid, n)
    bodies_mask = solid.copy()
    line_mask = (lum < line_cut) & solid
    for c in cuts:
        bodies_mask[:, max(0, c - 1):c + 2] = False
        line_mask[:, max(0, c - 1):c + 2] = False

    h, w = solid.shape
    k = 1000.0 / h
    sx = sy = k

    def paths_of(mask, min_area):
        out = []
        for m, area, (cx, cy), bbox in tr.components(mask, min_area=min_area):
            d = tr.to_path(tr.boundary(m), sx, sy)
            if d:
                out.append({
                    "d": d, "area": area,
                    "bbox": [bbox[0] * sx, bbox[1] * sy, bbox[2] * sx, bbox[3] * sy],
                    "cx": cx * sx, "cy": cy * sy,
                })
        return out

    figs = paths_of(bodies_mask, max(400, (h * w) // 2000))
    figs = sorted(figs, key=lambda p: -p["area"])[:n]
    if len(figs) < n:
        raise RuntimeError(f"{png}: found {len(figs)} figures, expected {n}")
    figs = sorted(figs, key=lambda p: p["bbox"][0])   # left to right = the order drawn

    # linework belongs to whichever figure encloses its centroid
    lines = paths_of(line_mask, min_line_area)

    # THE FLOOR IS DARK TOO, so it traces as linework — and being one long shape
    # spanning the whole sheet, its centroid lands inside whichever figure sits
    # near the middle. On the chest sheet that gave the right-hand figure a piece
    # of "detail" reaching back across the gap, so its frame claimed the entire
    # drawing and the two frames overlapped. The silhouette already carries the
    # floor; anything this wide and this flat is scenery, not anatomy.
    span = max(f["bbox"][2] for f in figs) - min(f["bbox"][0] for f in figs)
    lines = [
        p for p in lines
        if not ((p["bbox"][2] - p["bbox"][0]) > 0.40 * span
                and (p["bbox"][3] - p["bbox"][1]) < 0.03 * 1000.0)
    ]

    frames = []
    for i, fig in enumerate(figs):
        x0, y0, x1, y1 = fig["bbox"]
        mine = [p for p in lines if x0 <= p["cx"] <= x1 and y0 <= p["cy"] <= y1]
        body = [fig]
        xs = [c for p in body + mine for c in (p["bbox"][0], p["bbox"][2])]
        ys = [c for p in body + mine for c in (p["bbox"][1], p["bbox"][3])]
        frames.append({
            "paths": body, "lines": mine,
            "x0": min(xs), "x1": max(xs), "y0": min(ys), "y1": max(ys),
            # base of support: these poses share one drawn floor, so the only
            # correction needed between them is horizontal
            "ax": (x0 + x1) / 2, "ay": 0.0,
        })
    return frames
