"""Three hand-drawn visuals for the deeper body age report, approved by Shivani on 19 Nov 2026.

body_svg       : an outline of a person, each organ tinted by how its section is doing.
reserves_svg   : vitamins and iron as jars filled to their level (low line, full line, overfull).
connections_svg: a map of which results connect, with this person's flagged results coloured.

Drawn like the ring figure: uneven ink lines, handwriting for notes, no gradients, no icons.
The drawing functions take plain values; `figures_for` at the bottom works those values out from a report,
so nothing in a drawing is set by hand.
"""
import math

INK, HOT, HOTTEXT, WARM, GOOD, MUTE, PAPER = "#2A292D", "#C94A77", "#A93860", "#8A5632", "#557A43", "#6F6A72", "#FFFDFA"
ZOK, ZOUT, SOK = "#CFE0C3", "#F3D0DB", "#7FA66B"
SERIF = '"Fraunces",Georgia,serif'
SANS = '"Instrument Sans",system-ui,sans-serif'
HAND = '"Caveat","Bradley Hand",cursive'


def _j(k, amp=1.6):
    """small repeatable wobble"""
    return amp * math.sin(k * 12.9898) * math.cos(k * 4.1414)


def _jar_path(ox, k):
    w = lambda n, a=1.6: _j(k * 7 + n, a)
    p = (f"M{ox+55+w(1)} {16+w(2)} L{ox+55+w(3)} {36+w(4)} "
         f"C{ox+50+w(5)} {50} {ox+24+w(6)} {46+w(7)} {ox+22+w(8)} {66+w(9)} "
         f"L{ox+21+w(10)} {203+w(11)} "
         f"C{ox+22} {214+w(12)} {ox+28+w(13)} {221} {ox+40+w(14)} {221+w(15)} "
         f"L{ox+132+w(16)} {220+w(17)} "
         f"C{ox+143+w(18)} {220} {ox+149} {214+w(19)} {ox+149+w(20)} {203+w(21)} "
         f"L{ox+148+w(22)} {66+w(23)} "
         f"C{ox+146+w(24)} {46+w(25)} {ox+120+w(26)} {50} {ox+115+w(27)} {36+w(28)} "
         f"L{ox+115+w(29)} {16+w(30)}")
    return p


def reserves_svg(items):
    """items: (name, value_text, unit, value, lo, hi, note, tone) ; tone in ok|over|low"""
    out, W = [], 240
    top, low_y, full_y, base = 16, 184, 84, 221          # jar inside: base 221, low line, full line, rim
    for n, (name, vtxt, unit, v, lo, hi, note, tone) in enumerate(items):
        ox = 36 + n * W
        frac = (v - lo) / (hi - lo)
        y = low_y - frac * (low_y - full_y)                # level in the jar
        y = max(22, min(212, y))
        cid = f"jar{n}"
        jar = _jar_path(ox, n + 1)
        out.append(f'<clipPath id="{cid}"><path d="{jar} Z"/></clipPath>')
        # liquid, with an uneven surface; anything above the full line is drawn in the "out of range" tint
        wave = " ".join(f"L{ox+20+i*13:.0f} {y+1.6*math.sin(i*1.9+n):.1f}" for i in range(11))
        out.append(f'<g clip-path="url(#{cid})"><path d="M{ox+10} 230 L{ox+10} {y:.1f} {wave} L{ox+160} 230 Z" fill="{ZOK}"/>')
        if y < full_y:
            out.append(f'<path d="M{ox+10} {full_y} L{ox+10} {y:.1f} {wave} L{ox+160} {full_y} Z" fill="{ZOUT}"/>')
        out.append("</g>")
        surf = HOT if y < full_y else SOK
        out.append(f'<path d="M{ox+26} {y:.1f} ' + " ".join(f"L{ox+26+i*12:.0f} {y+1.6*math.sin(i*1.9+n):.1f}" for i in range(1, 11))
                   + f'" fill="none" stroke="{surf}" stroke-width="2" stroke-linecap="round" clip-path="url(#{cid})"/>')
        out.append(f'<path d="{jar}" fill="none" stroke="{INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>')
        out.append(f'<path d="M{ox+47+_j(n+40)} {15+_j(n+41)} L{ox+60} {16+_j(n+42)} M{ox+110} {16+_j(n+43)} L{ox+123+_j(n+44)} {15+_j(n+45)}" '
                   f'stroke="{INK}" stroke-width="2.2" stroke-linecap="round" fill="none"/>')
        # the two lines of the range, marked beside the jar
        for yy, lab, word in ((full_y, hi, "full"), (low_y, lo, "low")):
            out.append(f'<path d="M{ox+152} {yy+_j(n+yy,0.8):.1f} L{ox+168} {yy+_j(n+yy+3,0.8):.1f}" stroke="{INK}" stroke-width="1.3" stroke-linecap="round"/>')
            out.append(f'<text x="{ox+173}" y="{yy+4}" font-family={SANS!r} font-size="11" fill="{MUTE}">{lab:g}</text>')
            if n == 0:
                out.append(f'<text x="{ox+173}" y="{yy+18}" font-family={HAND!r} font-size="15" fill="{MUTE}">{word}</text>')
        tone_ink = {"ok": GOOD, "over": HOTTEXT, "low": WARM}[tone]
        out.append(f'<text x="{ox+85}" y="250" text-anchor="middle" font-family={SERIF!r} font-size="19" font-weight="560" fill="{INK}">{name}</text>')
        out.append(f'<text x="{ox+85}" y="270" text-anchor="middle" font-family={SANS!r} font-size="14.5" font-weight="650" fill="{INK}">{vtxt} '
                   f'<tspan font-weight="400" fill="{MUTE}" font-size="12">{unit}</tspan></text>')
        out.append(f'<text x="{ox+85}" y="292" text-anchor="middle" font-family={HAND!r} font-size="20" font-weight="600" fill="{tone_ink}">{note}</text>')
    return (f'<svg viewBox="0 0 {36 + len(items) * W} 302" role="img" aria-label="Jars showing how full each reserve is: '
            + "; ".join(f"{i[0]} {i[6]}" for i in items) + '">' + "".join(out) + "</svg>")


def _blob(cx, cy, rx, ry, k):
    pts = []
    for i in range(36):
        t = 2 * math.pi * i / 36
        r = 1 + 0.035 * math.sin(3 * t + k) + 0.025 * math.sin(5 * t + 2 * k)
        pts.append(f"{cx + rx * r * math.cos(t):.1f} {cy + ry * r * math.sin(t):.1f}")
    return "M" + "L".join(pts) + "Z"


def connections_svg(nodes, links, aside=None):
    """nodes: {key: (label, status, tone, cx, cy)} ; links: (a, b, note_lines, (tx, ty), anchor)"""
    tone_ink = {"deep": HOTTEXT, "att": HOTTEXT, "watch": WARM, "steady": GOOD}
    out = []
    for n, (a, b, lines, (tx, ty), anchor) in enumerate(links):
        ax, ay = nodes[a][3], nodes[a][4]; bx, by = nodes[b][3], nodes[b][4]
        mx, my = (ax + bx) / 2 + _j(n + 3, 9), (ay + by) / 2 + _j(n + 9, 9)
        out.append(f'<path d="M{ax} {ay} Q{mx:.0f} {my:.0f} {bx} {by}" fill="none" stroke="{INK}" stroke-width="1.7" stroke-linecap="round" opacity=".85"/>')
        for i, ln in enumerate(lines):
            out.append(f'<text x="{tx}" y="{ty + i * 19}" text-anchor="{anchor}" font-family={HAND!r} font-size="18.5" fill="{INK}">{ln}</text>')
    for k, (key, (label, status, tone, cx, cy)) in enumerate(nodes.items()):
        ink = tone_ink[tone]
        out.append(f'<path d="{_blob(cx, cy, 84, 37, k * 1.7)}" fill="{PAPER}" stroke="{ink}" stroke-width="{2.4 if tone in ("deep", "att") else 1.8}" stroke-linejoin="round"/>')
        out.append(f'<text x="{cx}" y="{cy - 2}" text-anchor="middle" font-family={SERIF!r} font-size="19" font-weight="560" fill="{INK}">{label}</text>')
        out.append(f'<text x="{cx}" y="{cy + 18}" text-anchor="middle" font-family={HAND!r} font-size="17.5" font-weight="600" fill="{ink}">{status}</text>')
    if aside:
        out.append(f'<text x="{aside[1]}" y="{aside[2]}" font-family={HAND!r} font-size="17.5" fill="{GOOD}">{aside[0]}</text>')
    return ('<svg viewBox="0 0 760 392" role="img" aria-label="A map of which of your results connect to each other.">'
            + "".join(out) + "</svg>")


# ── body figure ──────────────────────────────────────────────────────────────
def _smooth(pts, closed=True):
    """Catmull-Rom through the points, written as cubic curves."""
    n = len(pts)
    get = (lambda i: pts[i % n]) if closed else (lambda i: pts[max(0, min(n - 1, i))])
    d = f"M{pts[0][0]:.1f} {pts[0][1]:.1f}"
    for i in range(n if closed else n - 1):
        p0, p1, p2, p3 = get(i - 1), get(i), get(i + 1), get(i + 2)
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f"C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}"
    return d + ("Z" if closed else "")


_HALF = [(9, 64), (10, 80), (30, 90), (53, 99), (61, 120), (63, 172), (66, 226), (70, 247), (64, 259), (56, 250),
         (54, 228), (49, 176), (45, 128), (41, 162), (37, 198), (43, 234), (47, 292), (41, 350), (41, 398),
         (31, 452), (39, 469), (21, 473), (12, 453), (14, 398), (11, 350), (5, 266), (0, 250)]


def body_svg(parts, extras=()):
    """parts: {key: (label, status, tone)} for thyroid, heart, liver, sugar, kidneys, blood ; extras: (label, status, tone)"""
    cx, top = 380, 6
    tone_ink = {"deep": HOTTEXT, "att": HOTTEXT, "watch": WARM, "steady": GOOD}
    tone_fill = {"deep": ZOUT, "att": ZOUT, "watch": "#EBD8C2", "steady": ZOK}
    P = lambda x, y, k=0: (cx + x + _j(k, 0.9), top + y + _j(k + 5, 0.9))
    right = [P(x, y, i) for i, (x, y) in enumerate(_HALF)]
    left = [P(-x, y, i + 60) for i, (x, y) in enumerate(_HALF[:-1])][::-1]
    out = [f'<path d="{_smooth(right + left)}" fill="{PAPER}" stroke="{INK}" stroke-width="2.2" stroke-linejoin="round"/>',
           f'<path d="{_blob(cx, top + 37, 24, 29, 2.3)}" fill="{PAPER}" stroke="{INK}" stroke-width="2.2" stroke-linejoin="round"/>']

    def organ(key, shape):
        if key not in parts: return
        tone = parts[key][2]
        out.append(shape.format(f=tone_fill[tone], s=tone_ink[tone]))

    X, Y = lambda x: cx + x, lambda y: top + y
    organ("thyroid", f'<path d="{_blob(X(-6), Y(80), 6, 5, 1)}{_blob(X(6), Y(80), 6, 5, 2)}" fill="{{f}}" stroke="{{s}}" stroke-width="1.8"/>')
    organ("heart", f'<path d="M{X(9)} {Y(124)} C{X(1)} {Y(112)} {X(-8)} {Y(124)} {X(2)} {Y(134)} L{X(10)} {Y(143)} L{X(18)} {Y(134)} C{X(27)} {Y(124)} {X(17)} {Y(112)} {X(9)} {Y(124)}Z" fill="{{f}}" stroke="{{s}}" stroke-width="1.8" stroke-linejoin="round"/>')
    organ("liver", f'<path d="M{X(-34)} {Y(160)} C{X(-30)} {Y(150)} {X(-8)} {Y(150)} {X(4)} {Y(156)} C{X(2)} {Y(166)} {X(-14)} {Y(176)} {X(-33)} {Y(174)} C{X(-36)} {Y(170)} {X(-36)} {Y(164)} {X(-34)} {Y(160)}Z" fill="{{f}}" stroke="{{s}}" stroke-width="1.8" stroke-linejoin="round"/>')
    organ("sugar", f'<path d="{_blob(X(14), Y(172), 15, 5.5, 3)}" fill="{{f}}" stroke="{{s}}" stroke-width="1.8" transform="rotate(-8 {X(14)} {Y(172)})"/>')
    organ("kidneys", f'<path d="{_blob(X(-16), Y(200), 6.5, 10, 4)}{_blob(X(16), Y(200), 6.5, 10, 5)}" fill="{{f}}" stroke="{{s}}" stroke-width="1.8"/>')
    organ("blood", f'<path d="M{X(-56)} {Y(170)} C{X(-64)} {Y(182)} {X(-63)} {Y(190)} {X(-56)} {Y(190)} C{X(-49)} {Y(190)} {X(-48)} {Y(182)} {X(-56)} {Y(170)}Z" fill="{{f}}" stroke="{{s}}" stroke-width="1.8" stroke-linejoin="round"/>')

    # labels: (key, anchor point on the body, label x, label y, side)
    spots = [("thyroid", (8, 80), 520, 70, "r"), ("heart", (22, 128), 520, 138, "r"), ("sugar", (30, 172), 520, 206, "r"),
             ("kidneys", (24, 202), 520, 274, "r"), ("liver", (-36, 164), 240, 120, "l"), ("blood", (-64, 182), 240, 208, "l")]
    for n, (key, (ax, ay), lx, ly, side) in enumerate(spots):
        if key not in parts: continue
        label, status, tone = parts[key]
        ex = lx - 8 if side == "r" else lx + 8
        mx, my = (X(ax) + ex) / 2, (Y(ay) + ly - 6) / 2 + _j(n + 20, 6)
        out.append(f'<path d="M{X(ax)} {Y(ay)} Q{mx:.0f} {my:.0f} {ex} {ly - 6}" fill="none" stroke="{INK}" stroke-width="1.2" stroke-linecap="round" opacity=".8"/>')
        anchor = "start" if side == "r" else "end"
        out.append(f'<text x="{lx}" y="{ly}" text-anchor="{anchor}" font-family={SERIF!r} font-size="19" font-weight="560" fill="{INK}">{label}</text>')
        out.append(f'<text x="{lx}" y="{ly + 20}" text-anchor="{anchor}" font-family={HAND!r} font-size="19" font-weight="600" fill="{tone_ink[tone]}">{status}</text>')
    if extras:
        out.append(f'<text x="240" y="318" text-anchor="end" font-family={HAND!r} font-size="17" fill="{MUTE}">also read in your blood</text>')
        for i, (label, status, tone) in enumerate(extras):
            y = 346 + i * 46
            out.append(f'<text x="240" y="{y}" text-anchor="end" font-family={SERIF!r} font-size="19" font-weight="560" fill="{INK}">{label}</text>')
            out.append(f'<text x="240" y="{y + 20}" text-anchor="end" font-family={HAND!r} font-size="19" font-weight="600" fill="{tone_ink[tone]}">{status}</text>')
    return ('<svg viewBox="0 0 760 492" role="img" aria-label="An outline of a body with each organ marked by how it is doing: '
            + "; ".join(f"{v[0]} {v[1]}" for v in parts.values()) + '">' + "".join(out) + "</svg>")


# ── from a report's data to the three drawings ───────────────────────────────
TONE = {"needs a deeper look": "deep", "needs attention": "att", "watch": "watch", "steady": "steady"}
BODY_PARTS = ["thyroid", "heart", "sugar", "kidneys", "liver", "blood"]      # sections with a place on the figure
BODY_EXTRAS = ["nutrients", "metals"]                                        # read in the blood, no organ to mark
STEADY_SHORT = {"heart": "heart", "sugar": "sugar", "liver": "liver", "thyroid": "thyroid", "kidneys": "kidneys",
                "blood": "blood count", "nutrients": "vitamins and iron", "metals": "metals"}
# every result that can appear on the map has one fixed place, so the same finding is always drawn in the same spot
MAP_NODES = [("thyroid", "Thyroid signal", "tsh", 130, 80), ("b12", "Vitamin B12", "b12", 630, 80),
             ("hcy", "Homocysteine", "hcy", 420, 186), ("art", "Arteries", "lipids", 205, 318),
             ("sugar", "Sugar average", "hba1c", 610, 330)]
MAP_ORDER = ["thyroid_arteries", "hcy_b12", "hcy_arteries", "sugar_fats"]    # the order links are drawn in


def jar_note(v, lo, hi):
    """(handwritten note, tone) for one reserve, from where the value sits between its low and full lines."""
    if v < lo:
        return "below the low line", "low"
    if v > hi:
        return "overfull", "over"
    return ("in range, lower third", "ok") if (v - lo) / (hi - lo) < 1 / 3 else ("comfortable", "ok")


def jars_for(rows, num):
    items = []
    for key, name in (("vitd", "Vitamin D"), ("b12", "Vitamin B12"), ("tsat", "Iron carriers")):
        r = rows.get(key)
        if r is None or r.lo is None or r.hi is None:
            continue                                     # not measured, or no range to draw against: no jar
        note, tone = jar_note(r.value, r.lo, r.hi)
        vtxt, unit = (num(r.value) + "%", "full") if key == "tsat" else (f"{r.value:,.0f}" if r.value >= 1000 else num(r.value), r.unit)
        items.append((name, vtxt, unit, r.value, r.lo, r.hi, note, tone))
    return items


def _node_status(key, row_or_level, nature):
    """(words, tone) for one map node from its result level."""
    level = row_or_level
    if key == "b12":
        return "overfull", "watch"
    if level in ("B", "C", "D"):
        return ("needs attention", "att") if nature == "work" else ("needs a deeper look", "deep")
    return "watch", "watch"


def map_for(sections, connections, rows, groups):
    """(nodes, links, aside) for connections_svg, or None when nothing in this report connects."""
    by_id = {c.id: c for c in connections}
    links_in = [by_id[i] for i in MAP_ORDER if i in by_id] + [c for c in connections if c.id not in MAP_ORDER]
    if not links_in:
        return None
    used = {k for c in links_in for k in (c.a, c.b)}
    glevel = {g.key: g for g in groups}
    nodes = {}
    for key, label, src, cx, cy in MAP_NODES:
        if key not in used:
            continue
        g = glevel.get(src) or glevel.get(rows[src].group if src in rows else "")
        status, tone = _node_status(key, g.level if g else "A", g.nature if g else "deep")
        nodes[key] = (label, status, tone, cx, cy)
    links = [(c.a, c.b, list(c.note), c.notepos, "start") for c in links_in if c.a in nodes and c.b in nodes]
    steady = [STEADY_SHORT[s.id] for s in sections if s.status == "steady"]
    aside = ("steady, and not on this map: " + ", ".join(steady), 20, 20) if steady else None
    return nodes, links, aside


def figures_for(sections, connections, rows, groups, num):
    """{section id: (small heading, svg)} for the deeper report."""
    by = {s.id: s for s in sections}
    figs = {}
    parts = {k: (by[k].name, by[k].status, TONE[by[k].status]) for k in BODY_PARTS if k in by}
    extras = [(by[k].name, by[k].status, TONE[by[k].status]) for k in BODY_EXTRAS if k in by]
    figs["glance"] = ("", body_svg(parts, extras=extras))
    jars = jars_for(rows, num)
    if jars and "nutrients" in by:
        figs["nutrients"] = ("Your reserves at a glance", reserves_svg(jars))
    m = map_for(sections, connections, rows, groups)
    if m:
        figs["onebody"] = ("", connections_svg(m[0], m[1], aside=m[2]))
    return figs


def overlaps(nodes, links):
    """Pairs of map labels whose boxes collide: the build fails rather than print a muddled map."""
    boxes = [(k, cx - 82, cy - 36, cx + 82, cy + 36) for k, (_l, _s, _t, cx, cy) in nodes.items()]
    for a, b, lines, (tx, ty), _anchor in links:
        w = max(len(x) for x in lines) * 5.8          # the handwriting face is narrow
        boxes.append((f"{a}-{b}", tx, ty - 13, tx + w, ty + 19 * (len(lines) - 1) + 5))
    bad = []
    for i, (n1, x0, y0, x1, y1) in enumerate(boxes):
        for n2, a0, b0, a1, b1 in boxes[i + 1:]:
            if x0 < a1 and a0 < x1 and y0 < b1 and b0 < y1:
                bad.append((n1, n2))
    return bad
