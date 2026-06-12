#!/usr/bin/env python3
"""Generate the Thyroid Root-Cause Guide PDF for the ROOT comment-to-DM automation."""

import sys
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ── Brand Palette ────────────────────────────────────────────────────────────
SAGE       = colors.HexColor("#5C7A5C")   # deep sage green
SAGE_LIGHT = colors.HexColor("#8FAF8F")   # lighter sage
OCHRE      = colors.HexColor("#C4872A")   # ochre/amber accent
OCHRE_PALE = colors.HexColor("#F5EDD8")   # pale ochre background
CREAM      = colors.HexColor("#FDFAF4")   # page background feel
STONE      = colors.HexColor("#3D3530")   # near-black for body text
STONE_SOFT = colors.HexColor("#6B5E57")   # muted body text
TERRACOTTA = colors.HexColor("#B85C3E")   # warm terracotta for alerts
BORDER     = colors.HexColor("#D4C9B8")   # subtle border

W, H = A4
MARGIN_L = 18 * mm
MARGIN_R = 18 * mm
MARGIN_T = 16 * mm
MARGIN_B = 20 * mm

# ── Styles ───────────────────────────────────────────────────────────────────
def styles():
    base = dict(fontName="Helvetica", fontSize=10, leading=15,
                textColor=STONE, leftIndent=0, spaceAfter=0, spaceBefore=0)

    def s(name, **kwargs):
        d = dict(base)
        d.update(kwargs)
        return ParagraphStyle(name, **d)

    return {
        # Brand name line
        "brand": s("brand",
            fontName="Helvetica-BoldOblique", fontSize=9,
            textColor=SAGE, alignment=TA_RIGHT, spaceAfter=2),

        # Main title
        "title": s("title",
            fontName="Helvetica-Bold", fontSize=22,
            textColor=SAGE, leading=26, spaceAfter=4),

        # Title sub
        "subtitle": s("subtitle",
            fontName="Helvetica-Oblique", fontSize=12,
            textColor=STONE_SOFT, leading=16, spaceAfter=8),

        # Section header — driver boxes
        "section_head": s("section_head",
            fontName="Helvetica-Bold", fontSize=11,
            textColor=SAGE, leading=14, spaceAfter=3),

        # Body
        "body": s("body",
            fontName="Helvetica", fontSize=9.5,
            textColor=STONE, leading=14, spaceAfter=0),

        # Body small
        "body_sm": s("body_sm",
            fontName="Helvetica", fontSize=8.5,
            textColor=STONE_SOFT, leading=13, spaceAfter=0),

        # Bullet
        "bullet": s("bullet",
            fontName="Helvetica", fontSize=9.5,
            textColor=STONE, leading=14, leftIndent=10, spaceAfter=2),

        # Callout big quote
        "callout": s("callout",
            fontName="Helvetica-BoldOblique", fontSize=11,
            textColor=SAGE, leading=16, alignment=TA_CENTER),

        # CTA box
        "cta_head": s("cta_head",
            fontName="Helvetica-Bold", fontSize=11,
            textColor=colors.white, leading=15, alignment=TA_CENTER),
        "cta_body": s("cta_body",
            fontName="Helvetica", fontSize=9,
            textColor=colors.white, leading=14, alignment=TA_CENTER),

        # Footer
        "footer": s("footer",
            fontName="Helvetica-Oblique", fontSize=7.5,
            textColor=STONE_SOFT, alignment=TA_CENTER),

        # Label chip
        "chip": s("chip",
            fontName="Helvetica-Bold", fontSize=8,
            textColor=colors.white, leading=11, alignment=TA_CENTER),
    }

# ── Helper Builders ──────────────────────────────────────────────────────────
def hr(color=BORDER, thickness=0.5, space_before=4, space_after=4):
    return [
        Spacer(1, space_before * mm),
        HRFlowable(width="100%", thickness=thickness, color=color),
        Spacer(1, space_after * mm),
    ]

def driver_card(st, emoji, title, body_lines, signal_lines):
    """A tinted card for one root-cause driver."""
    col_w = (W - MARGIN_L - MARGIN_R)
    inner = col_w - 8 * mm

    title_p  = Paragraph(f"{emoji}  {title}", st["section_head"])
    body_ps  = [Paragraph(f"• {l}", st["bullet"]) for l in body_lines]
    signal_h = Paragraph("<b>Signs this may be you:</b>", st["body_sm"])
    signal_ps = [Paragraph(f"◦ {l}", st["body_sm"]) for l in signal_lines]

    content = [[title_p], *[[p] for p in body_ps],
               [Spacer(1, 2*mm)], [signal_h],
               *[[p] for p in signal_ps]]

    tbl = Table(content, colWidths=[inner])
    tbl.setStyle(TableStyle([
        ("BACKGROUND",  (0, 0), (-1, -1), OCHRE_PALE),
        ("ROUNDEDCORNERS", [6]),
        ("BOX",         (0, 0), (-1, -1), 0.5, BORDER),
        ("TOPPADDING",  (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",(0, 0), (-1, -1), 8),
    ]))
    return KeepTogether([tbl, Spacer(1, 3 * mm)])


def next_steps_table(st, steps):
    """Numbered next-steps table."""
    rows = []
    for i, (head, desc) in enumerate(steps, 1):
        num   = Paragraph(str(i), ParagraphStyle("num",
            fontName="Helvetica-Bold", fontSize=13,
            textColor=OCHRE, alignment=TA_CENTER, leading=16))
        head_p = Paragraph(f"<b>{head}</b>", st["body"])
        desc_p = Paragraph(desc, st["body_sm"])
        rows.append([num, [head_p, Spacer(1, 1*mm), desc_p]])

    col_w = W - MARGIN_L - MARGIN_R
    tbl = Table(rows, colWidths=[10 * mm, col_w - 10 * mm])
    tbl.setStyle(TableStyle([
        ("VALIGN",      (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING",  (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",(0, 0), (-1, -1), 0),
        ("LINEBELOW",   (0, 0), (-1, -2), 0.4, BORDER),
    ]))
    return tbl


def cta_box(st):
    """Sage-green coaching CTA."""
    col_w = W - MARGIN_L - MARGIN_R
    content = [
        [Paragraph("Ready to go deeper?", st["cta_head"])],
        [Spacer(1, 2 * mm)],
        [Paragraph(
            "This guide shows you the map. A personalised plan shows you <i>your</i> path.<br/>"
            "If you want to understand what's actually driving your thyroid symptoms —<br/>"
            "and build a protocol around your labs, your life, and your body — reply <b>COACH</b><br/>"
            "and I'll tell you how we can work together.",
            st["cta_body"])],
        [Spacer(1, 3 * mm)],
        [Paragraph("Reply COACH  →", st["cta_head"])],
    ]
    tbl = Table(content, colWidths=[col_w])
    tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), SAGE),
        ("ROUNDEDCORNERS", [8]),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING",   (0, 0), (-1, -1), 14),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 14),
    ]))
    return KeepTogether([tbl, Spacer(1, 4 * mm)])


# ── Build Story ───────────────────────────────────────────────────────────────
def build_story(st):
    story = []
    col_w = W - MARGIN_L - MARGIN_R

    # ── Header bar ──────────────────────────────────────────────────────────
    story.append(Paragraph("Shivani Hari · Functional Medicine Health Coach",
                            st["brand"]))
    story.append(Spacer(1, 1 * mm))
    story.append(HRFlowable(width="100%", thickness=1.5, color=SAGE))
    story.append(Spacer(1, 4 * mm))

    # ── Title block ─────────────────────────────────────────────────────────
    story.append(Paragraph("Thyroid Root-Cause Guide", st["title"]))
    story.append(Paragraph(
        "Why treating the leaves isn't enough — and where to actually look",
        st["subtitle"]))
    story.append(Spacer(1, 2 * mm))

    # ── Intro paragraph ─────────────────────────────────────────────────────
    story.append(Paragraph(
        "If you're on thyroid medication but still exhausted, foggy, and gaining weight, "
        "you're not imagining it. The medication replaces a hormone — it doesn't address "
        "<i>why</i> your thyroid is struggling in the first place. That's the root.",
        st["body"]))
    story.append(Spacer(1, 3 * mm))

    # ── Leaves vs Roots visual framing ──────────────────────────────────────
    leaves_rows = [
        [Paragraph("<b>🍃  The Leaves</b><br/>(symptoms you feel)", st["section_head"]),
         Paragraph("<b>🌳  The Roots</b><br/>(drivers worth exploring)", st["section_head"])],
        [Paragraph(
            "Fatigue · Brain fog · Hair thinning<br/>"
            "Weight gain · Cold hands &amp; feet<br/>"
            "Low mood · Constipation<br/>"
            "Dry skin · Slow metabolism",
            st["body_sm"]),
         Paragraph(
            "Gut permeability &amp; dysbiosis<br/>"
            "Chronic stress &amp; HPA dysregulation<br/>"
            "Nutrient depletions (Se, Zn, Fe, D, B12)<br/>"
            "Inflammation &amp; immune reactivity<br/>"
            "Blood sugar dysregulation",
            st["body_sm"])],
    ]
    leaves_tbl = Table(leaves_rows,
                       colWidths=[(col_w / 2) - 2 * mm, (col_w / 2) - 2 * mm],
                       spaceBefore=0, spaceAfter=0)
    leaves_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), SAGE),
        ("BACKGROUND",    (0, 1), (0, -1), colors.HexColor("#F0F5F0")),
        ("BACKGROUND",    (1, 1), (1, -1), OCHRE_PALE),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("ALIGN",         (0, 0), (-1, -1), "LEFT"),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
        ("GRID",          (0, 0), (-1, -1), 0.4, BORDER),
        ("ROUNDEDCORNERS", [5]),
    ]))
    story.append(KeepTogether([leaves_tbl, Spacer(1, 5 * mm)]))

    # ── Section header ───────────────────────────────────────────────────────
    story.append(Paragraph("The 4 Root Drivers Worth Exploring", st["title"]))
    story.append(Spacer(1, 2 * mm))

    # ── Driver 1: Gut ────────────────────────────────────────────────────────
    story.append(driver_card(st,
        "🦠", "Gut Health & Intestinal Permeability",
        [
            "Up to 20% of T4 → T3 conversion happens in the gut — a disrupted microbiome "
            "directly impairs your active thyroid hormone.",
            "Leaky gut allows undigested proteins into the bloodstream. The immune system "
            "mounts a response — and in Hashimoto's, that response can target thyroid tissue.",
            "Common culprits: antibiotics, PPIs, low-fibre diet, chronic stress, "
            "H. pylori infection.",
        ],
        [
            "Bloating, gas, or unpredictable digestion",
            "History of antibiotic use or gut infections",
            "Diagnosed with Hashimoto's or elevated TPO / anti-Tg antibodies",
            "Food sensitivities or reactions to gluten / dairy",
        ],
    ))

    # ── Driver 2: Stress ─────────────────────────────────────────────────────
    story.append(driver_card(st,
        "⚡", "Chronic Stress & HPA Axis Dysregulation",
        [
            "Cortisol suppresses TSH and blocks T4 → T3 conversion. A body in "
            "chronic stress mode effectively puts the brakes on thyroid function.",
            "Elevated cortisol also competes with thyroid hormone at the receptor level — "
            "so even with normal labs, you may feel the effects of low thyroid.",
            "Reverse T3 (rT3) rises under stress, acting as a 'handbrake' on metabolism.",
        ],
        [
            "Wired-but-tired — exhausted but can't wind down",
            "Sleep disruption, especially waking 2–4 am",
            "History of prolonged high stress or a major life event before symptoms worsened",
            "Afternoon energy crashes",
        ],
    ))

    # ── Driver 3: Nutrients ──────────────────────────────────────────────────
    story.append(driver_card(st,
        "🌿", "Key Nutrient Depletions",
        [
            "<b>Selenium:</b> essential for T4 → T3 conversion and for the antioxidant "
            "enzymes that protect thyroid tissue. India's soils are often selenium-poor.",
            "<b>Iron &amp; Ferritin:</b> the enzyme that makes thyroid hormone is iron-dependent. "
            "Ferritin below 70 ng/mL is a common hidden driver in women.",
            "<b>Zinc:</b> needed to make TSH and for thyroid hormone receptor sensitivity.",
            "<b>Vitamin D:</b> a hormone-like vitamin that modulates immune reactivity — "
            "low D correlates strongly with autoimmune thyroid disease.",
            "<b>B12 &amp; Iodine:</b> B12 deficiency overlaps heavily with hypothyroid symptoms; "
            "both excess and deficiency of iodine can worsen Hashimoto's.",
        ],
        [
            "Vegetarian or vegan (higher risk of B12, iron, zinc, selenium gaps)",
            "Heavy periods or postpartum (iron depletion)",
            "On medication long-term (PPIs deplete B12 and magnesium)",
            "Rarely in sunlight or avoiding dairy / eggs (Vitamin D, B12)",
        ],
    ))

    # ── Driver 4: Inflammation ───────────────────────────────────────────────
    story.append(driver_card(st,
        "🔥", "Inflammation & Immune Reactivity",
        [
            "Thyroid hormone conversion requires a calm immune environment. Chronic "
            "low-grade inflammation — from diet, dysbiosis, blood sugar swings, or "
            "infections — keeps the immune system activated and impairs conversion.",
            "In Hashimoto's, the immune system is already mistaking thyroid tissue for a "
            "threat. Reducing overall inflammatory load is one of the highest-leverage "
            "interventions available.",
            "Blood sugar dysregulation is a major, often overlooked driver: insulin spikes "
            "trigger inflammatory cytokines that worsen thyroid function.",
        ],
        [
            "Elevated hsCRP, fasting insulin, or antibodies on blood work",
            "Joint pain, skin issues, or recurrent infections",
            "Diet high in refined carbohydrates / ultra-processed foods",
            "Post-COVID symptoms or history of EBV / glandular fever",
        ],
    ))

    # ── Next steps ───────────────────────────────────────────────────────────
    story.extend(hr(space_before=2, space_after=3))
    story.append(Paragraph("3 Things You Can Do This Week", st["title"]))
    story.append(Spacer(1, 2 * mm))

    steps = [
        ("Get the right labs",
         "Standard TSH alone misses a lot. Ask for: fT3, fT4, anti-TPO, anti-Tg, "
         "ferritin, Vitamin D, B12, fasting insulin, hsCRP. "
         "These together tell a far fuller story."),
        ("Audit your gut",
         "Notice how you feel after meals. Bloating, reflux, loose stools, or "
         "constipation after eating are signals worth investigating. "
         "A 4-week low-inflammatory diet trial (removing gluten &amp; dairy) is a "
         "useful starting experiment."),
        ("Protect your sleep &amp; stress response",
         "Before any supplement protocol, consistent 10 pm–6 am sleep (or as close as "
         "your life allows) and a morning walk without your phone are two of the "
         "highest-return thyroid interventions. Free, and often underestimated."),
    ]
    story.append(next_steps_table(st, steps))
    story.append(Spacer(1, 5 * mm))

    # ── Important note ───────────────────────────────────────────────────────
    note_rows = [[
        Paragraph("⚠", ParagraphStyle("warn_icon",
            fontName="Helvetica-Bold", fontSize=12,
            textColor=TERRACOTTA, alignment=TA_CENTER, leading=14)),
        Paragraph(
            "<b>This guide is educational, not a treatment plan.</b> "
            "Please do not change or stop any medication without working with your doctor. "
            "A functional medicine approach works <i>alongside</i> — not instead of — "
            "your existing medical care.",
            st["body_sm"]),
    ]]
    note_tbl = Table(note_rows, colWidths=[8 * mm, col_w - 8 * mm])
    note_tbl.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",   (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 6),
        ("LEFTPADDING",  (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("BACKGROUND",   (0, 0), (-1, -1), colors.HexColor("#FDF0EC")),
        ("BOX",          (0, 0), (-1, -1), 0.5, TERRACOTTA),
        ("ROUNDEDCORNERS", [5]),
    ]))
    story.append(KeepTogether([note_tbl, Spacer(1, 5 * mm)]))

    # ── CTA ──────────────────────────────────────────────────────────────────
    story.append(cta_box(st))

    # ── Footer ───────────────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(
        "© 2026 Shivani Hari · Functional Medicine Health Coach · "
        "This guide is for educational purposes only.",
        st["footer"]))

    return story


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Desktop"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "Thyroid-Root-Cause-Guide-ShivaniHari.pdf"

    doc = SimpleDocTemplate(
        str(out_path),
        pagesize=A4,
        leftMargin=MARGIN_L,
        rightMargin=MARGIN_R,
        topMargin=MARGIN_T,
        bottomMargin=MARGIN_B,
        title="Thyroid Root-Cause Guide",
        author="Shivani Hari",
        subject="Functional Medicine Thyroid Guide",
    )

    st = styles()
    story = build_story(st)
    doc.build(story)
    print(f"✅  Guide saved to: {out_path}")
    return str(out_path)


if __name__ == "__main__":
    main()
