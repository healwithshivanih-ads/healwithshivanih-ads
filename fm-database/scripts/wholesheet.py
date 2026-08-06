"""Trace a whole pose sheet once and split it by PATH, never by pixel.

The earlier splitter cropped each figure to its own box before tracing. That
works only while the figures are cleanly separated — and they often are not. A
standing hip abduction reaches its leg into the neighbouring figure's column, and
a seated knee extension puts a whole shin there. With no empty column to cut at,
the crop went straight through the body: nine of twelve sheets had at least one
frame with a limb sliced off at the frame edge.

So nothing is cropped now. The sheet is traced once, in one coordinate space, and
each traced path is assigned WHOLE to a figure by where its centroid falls. A limb
crossing into the next band travels with its own body and stays intact, because a
path is either in a frame or it is not — it is never cut in half.

Frames are then registered on the base of support, exactly as before, so the
figures sit on a common floor line instead of drifting.
"""
import sys
import importlib.util
import pathlib

import numpy as np
from PIL import Image

# Resolved against THIS FILE, not the working directory. It used to be the literal
# "../trace.py", which was right only while this script lived one directory below
# the tracer in a scratchpad — from its committed home beside trace.py it points at
# fm-database/trace.py, which does not exist, so importing it failed outright.
_TRACE = pathlib.Path(__file__).resolve().parent / "trace.py"
_sp = importlib.util.spec_from_file_location("tr", _TRACE)
tr = importlib.util.module_from_spec(_sp); _sp.loader.exec_module(tr)
tr.SCALE = 1
_orig = tr.components
tr.components = lambda m, min_area, _o=_orig: _o(m, max(30, min_area // 5))

GROUND_SPAN = 0.55   # a path wider than this fraction of the sheet is the ground line


def _ink(a):
    return (a.mean(axis=2) < 238) | (np.abs(a[..., 0] - a[..., 2]) > 6)


def bands(src, n, floor_frac=0.045, search=0.11):
    """Return the n-1 x-positions that separate the figures."""
    a = np.asarray(Image.open(src).convert("RGB")).astype(np.int16)
    ink = _ink(a)
    col = ink[:int(ink.shape[0] * (1 - floor_frac))].sum(axis=0).astype(float)
    nz = np.nonzero(col)[0]
    lo, hi = int(nz[0]), int(nz[-1])
    span = hi - lo

    # If the sheet has n-1 genuinely empty column bands, those ARE the boundaries —
    # far more reliable than guessing at profile minima. Only fall back to the
    # minima sweep when the figures touch (a chair bridging two poses, a limb
    # reaching across) and no clean gap exists.
    gaps, start = [], None
    for x in range(lo, hi + 1):
        if col[x] == 0:
            if start is None: start = x
        else:
            if start is not None and x - start >= 8: gaps.append((start, x))
            start = None
    if len(gaps) == n - 1:
        return lo, hi, [(g0 + g1) // 2 for g0, g1 in gaps]

    cuts = []
    for i in range(1, n):
        guess = lo + span * i / n
        w = max(6, int(span * search))
        a0, a1 = int(max(lo + 1, guess - w)), int(min(hi - 1, guess + w))
        cuts.append(a0 + int(np.argmin(col[a0:a1 + 1])))
    return lo, hi, cuts


def _labels(src, n, floor_frac=0.05, min_area=400):
    """Label each figure as a connected blob of ink.

    Assigning paths to figures by x-band fails on the wide poses — a lying figure
    is longer than its share of the sheet, so bands overlap and paths land on the
    wrong body (one floor-bridge frame took 91 paths while its neighbour took 1).
    A figure is a single connected region of ink, so labelling components and
    looking up the label under each path's centroid is exact even when the
    bounding boxes overlap. The ground line is excluded first, or it would weld
    every figure into one component.
    """
    from collections import deque
    a = np.asarray(Image.open(src).convert("RGB")).astype(np.int16)
    ink = _ink(a)
    ink[int(ink.shape[0] * (1 - floor_frac)):] = False       # drop the ground line
    h, w = ink.shape
    lab = np.zeros((h, w), np.int32)
    cur = 0; blobs = []
    for y0 in range(h):
        for x0 in range(w):
            if not ink[y0, x0] or lab[y0, x0]:
                continue
            cur += 1; q = deque([(y0, x0)]); lab[y0, x0] = cur; px = 0; sx = 0
            while q:
                y, x = q.popleft(); px += 1; sx += x
                for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                    ny, nx = y+dy, x+dx
                    if 0 <= ny < h and 0 <= nx < w and ink[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = cur; q.append((ny, nx))
            blobs.append((cur, px, sx / max(px, 1)))
    big = [b for b in blobs if b[1] >= min_area]
    keep = sorted(big, key=lambda b: -b[1])[:n]     # the n LARGEST blobs are the figures
    keep = sorted(keep, key=lambda b: b[2])         # then ordered left to right
    order = {b[0]: i for i, b in enumerate(keep)}
    centres = [b[2] for b in keep]
    return lab, order, centres


def build(src, name, meta, n, scale_h=1000.0, search=0.11):
    im = Image.open(src).convert("RGB")
    W0, H0 = im.size
    lo, hi, cuts = bands(src, n, search=search)

    # one trace of the entire sheet, in one coordinate space
    k = scale_h / H0
    paths = tr.trace(src, name, vb_w=W0 * k, vb_h=H0 * k)

    edges = [lo * k] + [c * k for c in cuts] + [(hi + 1) * k]
    groups = [[] for _ in range(n)]
    ground = []
    for p in paths:
        x0, _, x1, _ = p["bbox"]
        if (x1 - x0) > GROUND_SPAN * W0 * k:      # the ground line spans every figure
            ground.append(p)
            continue
        # assigned WHOLE by centroid — a limb reaching into the next band travels
        # with its own body instead of being sliced at the boundary
        i = min(range(n), key=lambda j: 0 if edges[j] <= p["cx"] < edges[j+1]
                                        else min(abs(p["cx"]-edges[j]), abs(p["cx"]-edges[j+1])))
        groups[i].append(p)

    frames = []
    for g in groups:
        if not g:
            frames.append(None); continue
        xs = [b for p in g for b in (p["bbox"][0], p["bbox"][2])]
        ys = [b for p in g for b in (p["bbox"][1], p["bbox"][3])]
        y1 = max(ys)
        # base of support: mean x of the paths sitting lowest in this figure
        foot = [p for p in g if p["bbox"][3] >= y1 - 0.03 * scale_h]
        ax = float(np.mean([p["cx"] for p in foot])) if foot else (min(xs) + max(xs)) / 2
        frames.append({"paths": g, "ax": ax, "ay": y1,
                       "x0": min(xs), "x1": max(xs), "y0": min(ys), "y1": y1})
    frames = [f for f in frames if f]
    return {"name": meta[0], "muscle": meta[1], "cue": meta[2],
            "frames": frames, "ground": ground, "scale": k}


if __name__ == "__main__":
    print("wholesheet.py — paths assigned whole, nothing cropped")
