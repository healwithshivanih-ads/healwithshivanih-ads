"""Register two traced poses by maximum overlap, not by an anchor point.

Anchoring on the base of support fails whenever WHAT IS LOWEST CHANGES between the
two poses. On the seated ankle exercise the lowest paths are the floor-foot and the
chair legs, and the raised foot moves between them — so the anchor set differs, the
anchor jumps, and the whole figure appears to slide while the ankle barely moves.

Maximum overlap has no such assumption. Whatever the two poses have in common — the
torso, the chair, the standing leg — dominates the intersection and pins them, and
the part that genuinely moves is free to differ. It is the same registration used on
the multi-pose sheets, applied to a pair.

⚠ REGISTRATION IS A CORRECTION FOR FRAMES IN DIFFERENT COORDINATE SPACES. Check that
they ARE in different spaces before applying it. Poses generated one-per-call onto a
canvas of fixed size, with the ground line drawn at the same row every time, arrive
already registered — and running the search on those is not a no-op, it is damage,
and silent damage: the output is a valid animation of the wrong movement. Measured on
the conditioning batch, where every source was 1200x896 with its ground line within
one pixel of row 868: a standing-to-plank pair (IoU 0.22 — they barely overlap, so
"best overlap" means nothing) was shifted 302px sideways, and three jump pairs were
slid 144-218px DOWN off ground lines they were already standing on.

Use `iou_at(a, b, 0, 0)` to ask how well two frames already agree. A high value means
they are in a common space and the identity is the right answer.
"""
import numpy as np

GRID = 260


def _raster(frame, box, n=GRID):
    x0, y0, x1, y1 = box
    sx = (n - 1) / max(x1 - x0, 1e-6)
    sy = (n - 1) / max(y1 - y0, 1e-6)
    m = np.zeros((n, n), bool)
    for p in frame["paths"]:
        a, b, c, d = p["bbox"]
        m[max(0, int((b - y0) * sy)):int((d - y0) * sy) + 1,
          max(0, int((a - x0) * sx)):int((c - x0) * sx) + 1] = True
    return m, sx, sy


def iou_at(a, b, dx=0.0, dy=0.0):
    """How well A and B agree at a GIVEN offset — the question `offset` never asks.

    `offset` returns the best it can find, which is a number even when the two poses
    have nothing meaningful in common. This asks the prior question: do these already
    line up? Call it at (0, 0) before registering anything.
    """
    xs = [q for f in (a, b) for p in f["paths"] for q in (p["bbox"][0], p["bbox"][2])]
    ys = [q for f in (a, b) for p in f["paths"] for q in (p["bbox"][1], p["bbox"][3])]
    box = (min(xs), min(ys), max(xs), max(ys))
    ma, sx, sy = _raster(a, box)
    mb, _, _ = _raster(b, box)
    ix, iy = int(round(dx * sx)), int(round(dy * sy))
    s = np.zeros_like(mb)
    ys0, ys1 = max(0, -iy), min(GRID, GRID - iy)
    xs0, xs1 = max(0, -ix), min(GRID, GRID - ix)
    if ys1 > ys0 and xs1 > xs0:
        s[max(0, iy):min(GRID, GRID + iy), max(0, ix):min(GRID, GRID + ix)] = mb[ys0:ys1, xs0:xs1]
    u = (ma | s).sum()
    return float((ma & s).sum() / u) if u else 0.0


def offset(a, b, span=0.28):
    """Translation to apply to B so it sits on A, in path units."""
    xs = [q for f in (a, b) for p in f["paths"] for q in (p["bbox"][0], p["bbox"][2])]
    ys = [q for f in (a, b) for p in f["paths"] for q in (p["bbox"][1], p["bbox"][3])]
    box = (min(xs), min(ys), max(xs), max(ys))
    ma, sx, sy = _raster(a, box)
    mb, _, _ = _raster(b, box)
    r = max(3, int(GRID * span))
    best, bd = -1.0, (0, 0)
    for dy in range(-r, r + 1, 2):
        for dx in range(-r, r + 1, 2):
            s = np.zeros_like(mb)
            ys0, ys1 = max(0, -dy), min(GRID, GRID - dy)
            xs0, xs1 = max(0, -dx), min(GRID, GRID - dx)
            if ys1 <= ys0 or xs1 <= xs0:
                continue
            s[max(0, dy):min(GRID, GRID + dy), max(0, dx):min(GRID, GRID + dx)] = mb[ys0:ys1, xs0:xs1]
            u = (ma | s).sum()
            iou = (ma & s).sum() / u if u else 0.0
            if iou > best:
                best, bd = iou, (dx, dy)
    return (bd[0] / sx, bd[1] / sy), best
