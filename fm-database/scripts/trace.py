"""Trace the flat anatomy plate into real SVG paths.

The illustration is the ideal case for this: flat fills, a closed dark outline
network, no gradients, no antialiasing to speak of. So the muscle regions are
simply the connected components of "inside the body, not on a line", and each
one traced becomes a path that follows the muscle's ACTUAL boundary — which is
the whole point. An ellipse sits over a muscle; a traced path IS the muscle.

No potrace, no scipy on this machine, so: numpy for the masks, a BFS for the
components, Moore-neighbour following for the boundary, Douglas-Peucker to
simplify.
"""
import json
import sys
from collections import deque

import numpy as np
from PIL import Image

SCALE = 2  # downsample factor — 1120x1420 traced at half size is plenty


def load(path):
    im = Image.open(path).convert("RGB")
    im = im.resize((im.width // SCALE, im.height // SCALE), Image.LANCZOS)
    return np.asarray(im).astype(np.int16)


def masks(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lum = (r + g + b) / 3.0
    # the page is near-white; the body is everything appreciably darker OR the
    # cream tendons, which are light but tinted
    tinted = (np.abs(r - b) > 6) | (np.abs(g - b) > 6)
    body = (lum < 232) | tinted
    line = lum < 150            # the dark outline network
    return body, line


def components(mask, min_area):
    """BFS connected components (4-connected). Returns list of (label_mask, area, centroid)."""
    h, w = mask.shape
    seen = np.zeros((h, w), dtype=bool)
    out = []
    for y0 in range(h):
        row = mask[y0]
        for x0 in range(w):
            if not row[x0] or seen[y0, x0]:
                continue
            q = deque([(y0, x0)])
            seen[y0, x0] = True
            pix = []
            while q:
                y, x = q.popleft()
                pix.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            if len(pix) < min_area:
                continue
            ys = np.fromiter((p[0] for p in pix), int, len(pix))
            xs = np.fromiter((p[1] for p in pix), int, len(pix))
            m = np.zeros((h, w), dtype=bool)
            m[ys, xs] = True
            out.append((m, len(pix), (float(xs.mean()), float(ys.mean())),
                        (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))))
    return out


# Moore-neighbour boundary following, clockwise from the first set pixel.
_N8 = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]


def boundary(mask):
    h, w = mask.shape
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        return []
    start = (int(ys[0]), int(xs[0]))
    contour = [start]
    cur = start
    back = 6  # came from the left
    for _ in range(200000):
        found = False
        for k in range(8):
            i = (back + 1 + k) % 8
            dy, dx = _N8[i]
            ny, nx = cur[0] + dy, cur[1] + dx
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx]:
                back = (i + 4 + 1) % 8
                cur = (ny, nx)
                contour.append(cur)
                found = True
                break
        if not found:
            break
        if cur == start and len(contour) > 3:
            break
    return contour


def rdp(pts, eps):
    """Douglas-Peucker."""
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0], float), np.array(pts[-1], float)
    ab = b - a
    n = np.hypot(*ab)
    P = np.array(pts, float)
    if n == 0:
        d = np.hypot(*(P - a).T)
    else:
        d = np.abs(np.cross(np.tile(ab, (len(P), 1)), P - a)) / n
    i = int(np.argmax(d))
    if d[i] > eps:
        return rdp(pts[:i + 1], eps)[:-1] + rdp(pts[i:], eps)
    return [pts[0], pts[-1]]


def to_path(contour, sx, sy, eps=1.1):
    pts = [(x, y) for y, x in contour]
    pts = rdp(pts, eps)
    if len(pts) < 3:
        return None
    d = f"M{pts[0][0]*sx:.2f},{pts[0][1]*sy:.2f}"
    for x, y in pts[1:]:
        d += f"L{x*sx:.2f},{y*sy:.2f}"
    return d + "Z"


def trace(path, view, vb_w=100.0, vb_h=133.0):
    a = load(path)
    body, line = masks(a)
    h, w = body.shape
    regions_mask = body & ~line
    sys.stderr.write(f"[{view}] {w}x{h}  body {body.mean()*100:.1f}%  line {line.mean()*100:.1f}%\n")
    comps = components(regions_mask, min_area=max(60, (h * w) // 4000))
    sys.stderr.write(f"[{view}] {len(comps)} regions\n")
    sx, sy = vb_w / w, vb_h / h
    out = []
    for i, (m, area, (cx, cy), bbox) in enumerate(comps):
        d = to_path(boundary(m), sx, sy)
        if not d:
            continue
        out.append({
            "i": i, "d": d, "area": area,
            "cx": round(cx * sx, 2), "cy": round(cy * sy, 2),
            "bbox": [round(bbox[0]*sx,1), round(bbox[1]*sy,1), round(bbox[2]*sx,1), round(bbox[3]*sy,1)],
        })
    out.sort(key=lambda r: -r["area"])
    return out


if __name__ == "__main__":
    res = {}
    for view, src in (("front", "gfA.png"), ("back", "gbA.png")):
        res[view] = trace(src, view)
    with open("traced.json", "w") as fh:
        json.dump(res, fh)
    for view, rs in res.items():
        print(f"\n{view}: {len(rs)} paths")
        for r in rs[:14]:
            print(f"   #{r['i']:<3} area={r['area']:<6} centroid=({r['cx']:5.1f},{r['cy']:5.1f})  bbox={r['bbox']}")
