"""Lock the six drawn figures onto each other so the body stays on the spot.

Anchoring on the feet is not enough. Each of the six figures is drawn separately,
so no two bodies are quite identical — the torso sits a few pixels left, the head
is a touch higher. Cross-fading those reads as the WHOLE FIGURE jittering, which
buries the actual movement: on the neck side-bend the head tilt is lost inside a
body that appears to slide about.

So each frame is registered to the first by finding the translation that maximises
the overlap of their ink. That locks whatever is common between them — the trunk,
the standing leg — and lets only the part that genuinely moves differ. It is the
registration a radiographer does before comparing two films.

Coarse-to-fine: an 8x downsampled sweep to find the neighbourhood, then a full-res
refinement, because a pure full-res sweep over the search window is ~40x slower for
the same answer.
"""
import numpy as np
from PIL import Image


def _ink(a):
    return (a.mean(axis=2) < 238) | (np.abs(a[..., 0] - a[..., 2]) > 6)


def masks(src, edges, floor_frac=0.05):
    """One binary mask per figure, all in the sheet's own coordinate frame."""
    a = np.asarray(Image.open(src).convert("RGB")).astype(np.int16)
    ink = _ink(a)
    ink[int(ink.shape[0] * (1 - floor_frac)):] = False      # ground line is not the body
    out = []
    for x0, x1 in zip(edges, edges[1:]):
        m = np.zeros_like(ink)
        m[:, int(x0):int(x1)] = ink[:, int(x0):int(x1)]
        out.append(m)
    return out


def _iou(a, b):
    u = (a | b).sum()
    return (a & b).sum() / u if u else 0.0


def _shift(m, dx, dy):
    out = np.zeros_like(m)
    h, w = m.shape
    sy0, sy1 = max(0, -dy), min(h, h - dy)
    dy0, dy1 = max(0, dy), min(h, h + dy)
    sx0, sx1 = max(0, -dx), min(w, w - dx)
    dx0, dx1 = max(0, dx), min(w, w + dx)
    if sy1 <= sy0 or sx1 <= sx0:
        return out
    out[dy0:dy1, dx0:dx1] = m[sy0:sy1, sx0:sx1]
    return out


def offsets(ms, span=70, coarse=8):
    """Translation, in source pixels, that puts each frame onto the first."""
    ref = ms[0]
    # bring every figure roughly onto the reference first, by its own bbox centre,
    # otherwise the sweep would have to cover the whole band width
    def centre(m):
        ys, xs = np.nonzero(m)
        return (xs.mean(), ys.mean()) if len(xs) else (0, 0)
    rcx, rcy = centre(ref)
    res = [(0, 0)]
    for m in ms[1:]:
        cx, cy = centre(m)
        bx, by = int(round(rcx - cx)), int(round(rcy - cy))
        m0 = _shift(m, bx, by)
        rs, ms_ = ref[::coarse, ::coarse], m0[::coarse, ::coarse]
        best, bd = -1, (0, 0)
        r = max(2, span // coarse)
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                s = _iou(rs, _shift(ms_, dx, dy))
                if s > best: best, bd = s, (dx * coarse, dy * coarse)
        best, fine = -1, bd
        for dy in range(bd[1] - coarse, bd[1] + coarse + 1, 2):
            for dx in range(bd[0] - coarse, bd[0] + coarse + 1, 2):
                s = _iou(ref, _shift(m0, dx, dy))
                if s > best: best, fine = s, (dx, dy)
        res.append((bx + fine[0], by + fine[1]))
    return res
