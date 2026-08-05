"""Detect which way a side-on figure faces, and mirror it to match its partner.

Generating each pose as its own image removed the splitting problem but introduced a
consistency one: nothing ties two independent generations together, so the model
draws one pose facing left and its partner facing right. Cross-fading those flips the
body mid-movement.

Direction is read from the head: on a profile figure the face and nose project to the
facing side, so the head's horizontal centroid sits forward of the body's. Comparing
the two is enough, and it costs nothing — a mirror is a transform, not a generation.
"""
import numpy as np
from PIL import Image


def _ink(a):
    return (a.mean(axis=2) < 238) | (np.abs(a[..., 0] - a[..., 2]) > 6)


def faces_right(path, head_frac=0.16, floor_frac=0.05):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    ink = _ink(a)
    ink[int(ink.shape[0] * (1 - floor_frac)):] = False      # ignore the ground line
    ys, xs = np.nonzero(ink)
    if len(ys) == 0:
        return True, 0.0
    y0, y1 = ys.min(), ys.max()
    head = ink[y0:y0 + max(2, int((y1 - y0) * head_frac))]
    hy, hx = np.nonzero(head)
    if len(hx) == 0:
        return True, 0.0
    lead = hx.mean() - xs.mean()          # head forward of body centre => facing that way
    return lead > 0, float(lead)


def align(paths):
    """Mirror whichever poses disagree with the first. Returns [(path, flipped)]."""
    ref, _ = faces_right(paths[0])
    out = []
    for p in paths:
        r, lead = faces_right(p)
        out.append((p, r != ref, lead))
    return ref, out


def mirrored(path, dst):
    Image.open(path).convert("RGB").transpose(Image.FLIP_LEFT_RIGHT).save(dst)
    return dst
