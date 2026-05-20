"""
brand_html.py — shared Shivani Hari / Deep Mind brand HTML wrapper.

Usage:
    from brand_html import wrap_in_brand_html
    html = wrap_in_brand_html(markdown_text, title="Your Plan", subtitle="Prepared for Jane")
"""

import base64
import re
from pathlib import Path
from datetime import date

# ── Brand tokens (from May_2026_Visual_Social_Calendar.html) ─────────────────
BONE    = "#F7F4F3"
INK     = "#0D0D0D"
INDIGO  = "#2B2D42"
LAVENDER= "#8D99AE"
ROSE    = "#D6A2A2"

LOGO_PATH = Path("/Users/shivani/Shivani Hari Brand/shivani-hari-logo-transparent.png")


def _logo_data_uri() -> str:
    try:
        raw = LOGO_PATH.read_bytes()
        b64 = base64.b64encode(raw).decode()
        return f"data:image/png;base64,{b64}"
    except Exception:
        return ""


def _md_to_html(md: str) -> str:
    """
    Lightweight markdown → HTML converter.
    Handles: headings, bold, italic, links, unordered lists, ordered lists,
    tables, horizontal rules, paragraphs, footnote-style sections.
    """
    import markdown as md_lib
    return md_lib.markdown(
        md,
        extensions=["tables", "fenced_code", "nl2br"],
    )


# Week section detection for per-week print buttons
_WEEK_HEADING_RE = re.compile(r'Week\s+(\d+)\s+Meal\s+Plan', re.IGNORECASE)

# Headings that should be hidden when printing (referral / links / appendix content)
_NO_PRINT_HEADING_RE = re.compile(
    r'supplement\s+protocol|where\s+to\s+buy|recommended\s+products|'
    r'product\s+guide|recipe\s+appendix|shop\s+|shopping|iherb|vitaone|'
    r'buy\s+here|referral',
    re.IGNORECASE,
)


def _add_target_blank(html: str) -> str:
    """Add target="_blank" rel="noopener noreferrer" to all external <a href="..."> links."""
    return re.sub(
        r'<a\s+href="(https?://[^"]+)"',
        r'<a target="_blank" rel="noopener noreferrer" href="\1"',
        html,
    )


def _wrap_week_sections(html: str) -> str:
    """
    Wrap each "Week N Meal Plan" H2 section (from the H2 to the next H2 or end)
    in <div id="print-week-N" class="week-section"> so per-week print buttons
    can isolate individual weeks for printing.
    """
    parts = re.split(r'(<h2[^>]*>.*?</h2>)', html, flags=re.DOTALL | re.IGNORECASE)

    result: list[str] = []
    in_week_div = False

    for part in parts:
        if re.match(r'<h2', part, re.IGNORECASE):
            heading_text = re.sub(r'<[^>]+>', '', part)
            m = _WEEK_HEADING_RE.search(heading_text)

            # Close any open week div before starting another heading
            if in_week_div:
                result.append('</div>  <!-- /week-section -->')
                in_week_div = False

            if m:
                week_num = m.group(1)
                result.append(f'<div id="print-week-{week_num}" class="week-section">')
                in_week_div = True

        result.append(part)

    if in_week_div:
        result.append('</div>  <!-- /week-section -->')

    return ''.join(result)


def _wrap_no_print_sections(html: str) -> str:
    """
    Scan HTML for H2 headings that match supplement/referral/product/recipe
    patterns and wrap those sections in <div class="no-print"> so they are
    hidden when the client prints the document.

    A "section" runs from the matched H2 to the next H2 (or end of content).
    """
    # Split on every <h2 ...>...</h2> tag (keeping the delimiter)
    parts = re.split(r'(<h2[^>]*>.*?</h2>)', html, flags=re.DOTALL | re.IGNORECASE)

    result: list[str] = []
    in_no_print = False

    for part in parts:
        if re.match(r'<h2', part, re.IGNORECASE):
            # Plain heading text (strip tags)
            heading_text = re.sub(r'<[^>]+>', '', part)
            is_no_print = bool(_NO_PRINT_HEADING_RE.search(heading_text))

            if is_no_print and not in_no_print:
                result.append('<div class="no-print">')
                in_no_print = True
            elif not is_no_print and in_no_print:
                result.append('</div>')
                in_no_print = False

        result.append(part)

    if in_no_print:
        result.append('</div>')

    return ''.join(result)


# CSS is defined once here so both letter and brief share identical styling.
_CSS = f"""
  /* ── Google Fonts (Libre Baskerville + Inter) ── */
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Inter:wght@300;400;500;600&display=swap');

  :root {{
    --bone:     {BONE};
    --ink:      {INK};
    --indigo:   {INDIGO};
    --lavender: {LAVENDER};
    --rose:     {ROSE};
    --max-w:    720px;
  }}

  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

  html {{ font-size: 16px; }}

  body {{
    background: var(--bone);
    color: var(--ink);
    font-family: 'Inter', Arial, sans-serif;
    font-weight: 400;
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
  }}

  /* ── Page shell ── */
  .page {{
    max-width: var(--max-w);
    margin: 0 auto;
    padding: 56px 48px 80px;
  }}

  /* ── Header ── */
  .brand-header {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 32px;
    margin-bottom: 40px;
    border-bottom: 1.5px solid var(--indigo);
  }}

  .brand-logo {{
    height: 160px;
    width: auto;
    max-width: 400px;
    display: block;
    object-fit: contain;
  }}

  .doc-meta {{
    text-align: right;
    font-size: 11px;
    color: var(--lavender);
    letter-spacing: 0.04em;
    line-height: 1.6;
    padding-top: 4px;
  }}

  .doc-meta .doc-type {{
    font-family: 'Libre Baskerville', Georgia, serif;
    font-size: 13px;
    color: var(--indigo);
    display: block;
    margin-bottom: 3px;
    font-style: italic;
  }}

  /* ── Document title block ── */
  .doc-title-block {{
    margin-bottom: 40px;
    padding-bottom: 28px;
    border-bottom: 1px solid rgba(43,45,66,0.15);
  }}

  .doc-title-block h1 {{
    font-family: 'Libre Baskerville', Georgia, serif;
    font-size: clamp(26px, 4vw, 38px);
    font-weight: 400;
    line-height: 1.15;
    color: var(--indigo);
    margin-bottom: 10px;
  }}

  .doc-subtitle {{
    font-size: 14px;
    color: var(--lavender);
    letter-spacing: 0.02em;
  }}

  .rose-dot {{
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--rose);
    margin: 0 8px 1px;
    vertical-align: middle;
  }}

  /* ── Body content ── */
  .content h1 {{
    font-family: 'Libre Baskerville', Georgia, serif;
    font-size: 26px;
    font-weight: 400;
    color: var(--indigo);
    margin: 44px 0 16px;
    line-height: 1.2;
  }}

  .content h2 {{
    font-family: 'Libre Baskerville', Georgia, serif;
    font-size: 19px;
    font-weight: 400;
    font-style: italic;
    color: var(--indigo);
    margin: 36px 0 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(43,45,66,0.12);
  }}

  .content h3 {{
    font-family: 'Inter', Arial, sans-serif;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--lavender);
    margin: 28px 0 8px;
  }}

  .content p {{
    font-size: 15px;
    line-height: 1.8;
    color: var(--ink);
    margin-bottom: 16px;
  }}

  .content em {{
    color: var(--lavender);
    font-style: italic;
  }}

  .content strong {{
    font-weight: 600;
    color: var(--indigo);
  }}

  .content ul, .content ol {{
    margin: 12px 0 20px 20px;
    font-size: 15px;
    line-height: 1.8;
  }}

  .content li {{
    margin-bottom: 6px;
    padding-left: 4px;
  }}

  .content ul li::marker {{
    color: var(--rose);
  }}

  .content ol li::marker {{
    color: var(--lavender);
    font-weight: 600;
  }}

  /* Tables — meal plans, supplement lists */
  .content table {{
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0 28px;
    font-size: 14px;
  }}

  .content thead tr {{
    background: var(--indigo);
    color: #fff;
  }}

  .content th {{
    padding: 10px 14px;
    font-family: 'Inter', Arial, sans-serif;
    font-weight: 500;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    text-align: left;
  }}

  .content td {{
    padding: 10px 14px;
    border-bottom: 1px solid rgba(43,45,66,0.10);
    vertical-align: top;
    line-height: 1.6;
  }}

  .content tbody tr:nth-child(even) td {{
    background: rgba(247,244,243,0.6);
  }}

  /* Links */
  .content a {{
    color: var(--indigo);
    text-underline-offset: 3px;
    text-decoration-color: var(--rose);
  }}

  .content a:hover {{
    color: var(--rose);
  }}

  /* Horizontal rules → visual dividers */
  .content hr {{
    border: none;
    border-top: 1px solid rgba(43,45,66,0.15);
    margin: 36px 0;
  }}

  /* Blockquotes — coach notes, disclaimer */
  .content blockquote {{
    border-left: 3px solid var(--rose);
    margin: 20px 0;
    padding: 12px 20px;
    background: rgba(214,162,162,0.07);
    font-size: 14px;
    color: var(--lavender);
    font-style: italic;
  }}

  /* ── Footer ── */
  .brand-footer {{
    margin-top: 64px;
    margin-bottom: 32px;
    padding-top: 24px;
    border-top: 1.5px solid var(--indigo);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 16px;
  }}

  .brand-footer .name {{
    font-family: 'Libre Baskerville', Georgia, serif;
    font-size: 15px;
    color: var(--indigo);
    font-style: italic;
    margin-bottom: 3px;
  }}

  .brand-footer .tagline {{
    font-size: 11px;
    color: var(--lavender);
    letter-spacing: 0.05em;
  }}

  .brand-footer .contact {{
    font-size: 11px;
    color: var(--lavender);
    text-align: right;
    line-height: 1.8;
  }}

  .brand-footer .contact a {{
    color: var(--indigo);
    text-decoration: none;
  }}

  /* ── Print page footer (repeats on every printed page via position:fixed) ── */
  .print-page-footer {{
    display: none;
  }}

  /* ── No-print utility (referral / supplement / recipe sections) ── */
  .no-print {{ /* visible on screen */ }}

  /* ── Print-only client name above week headings ── */
  .print-client-name {{ display: none; }}

  /* ── Recipe links (dish name + ✦ in meal plan cells) ── */
  a.recipe-link {{
    color: inherit;
    font-weight: inherit;
    text-decoration: underline;
    text-decoration-color: var(--rose);
    text-underline-offset: 2px;
    cursor: pointer;
    transition: color 0.15s;
  }}
  a.recipe-link:hover {{
    color: var(--rose);
    text-decoration-color: var(--rose);
  }}

  /* ── Recipe note banner ── */
  .recipe-note {{
    display: none; /* shown by JS only when recipes are found */
    background: rgba(214,162,162,0.08);
    border-left: 3px solid var(--rose);
    border-radius: 0 6px 6px 0;
    padding: 10px 18px;
    margin: 0 0 28px;
    font-size: 13px;
    color: var(--lavender);
    line-height: 1.6;
  }}
  .recipe-note strong {{
    color: var(--indigo);
    font-weight: 600;
  }}
  .recipe-note .recipe-note-symbol {{
    color: var(--rose);
    font-weight: 700;
  }}

  /* ── Start-date confirm buttons (WhatsApp) ── */
  .start-buttons-panel {{
    margin: 18px 0 24px;
    padding: 18px 20px;
    background: linear-gradient(135deg, rgba(5,150,105,0.07), rgba(214,162,162,0.06));
    border: 1px solid rgba(5,150,105,0.18);
    border-radius: 12px;
  }}
  .start-buttons-heading {{
    font-family: 'Cormorant Garamond', 'Libre Baskerville', serif;
    font-size: 22px;
    font-weight: 600;
    color: var(--indigo);
    margin: 0 0 4px;
  }}
  .start-buttons-sub {{
    font-size: 13px;
    color: var(--lavender);
    margin: 0 0 14px;
    line-height: 1.5;
  }}
  .start-buttons-sub strong {{
    color: var(--indigo);
    font-weight: 600;
  }}
  .start-buttons-row {{
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }}
  .start-btn {{
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-radius: 10px;
    text-decoration: none !important;
    color: white !important;
    font-size: 14px;
    line-height: 1.3;
    transition: transform 80ms ease;
    flex: 1 1 220px;
    min-height: 56px;
  }}
  .start-btn:hover {{ transform: translateY(-1px); }}
  .start-btn-icon {{
    font-size: 22px;
    flex-shrink: 0;
  }}
  .start-btn-body {{
    display: flex;
    flex-direction: column;
    gap: 1px;
    text-align: left;
  }}
  .start-btn-body small {{
    font-size: 11px;
    opacity: 0.85;
    font-weight: 400;
  }}
  .start-btn-confirm {{ background: #059669; }}
  .start-btn-confirm:hover {{ background: #047857; }}
  .start-btn-edit {{ background: #6366f1; }}
  .start-btn-edit:hover {{ background: #4f46e5; }}
  .start-btn-supps {{ background: #d97706; }}
  .start-btn-supps:hover {{ background: #b45309; }}

  /* ── Per-week print buttons ── */
  .week-print-bar {{
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin: 0 0 28px;
    padding: 14px 18px;
    background: rgba(43,45,66,0.04);
    border: 1px solid rgba(43,45,66,0.12);
    border-radius: 6px;
    align-items: center;
  }}

  .week-print-bar-label {{
    font-size: 12px;
    font-weight: 500;
    color: var(--lavender);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin-right: 4px;
    flex-shrink: 0;
  }}

  .week-print-btn {{
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 16px;
    background: var(--indigo);
    color: #fff;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    font-family: 'Inter', Arial, sans-serif;
    font-weight: 500;
    cursor: pointer;
    letter-spacing: 0.01em;
    transition: background 0.15s;
  }}

  .week-print-btn:hover {{
    background: #3d3f5a;
  }}

  /* ── Complete Shopping List (sits above the detailed schedule) ── */
  #supplement-shopping-list {{
    margin: 48px 0 0;
    padding: 24px 28px;
    background: linear-gradient(180deg, #faf6f1 0%, #f5efe6 100%);
    border: 2px solid #d6a86c;
    border-radius: 12px;
  }}
  .shop-header {{ margin-bottom: 16px; }}
  .shop-title {{
    font-family: 'Libre Baskerville', Georgia, serif;
    font-size: 21px;
    font-weight: 400;
    color: var(--indigo);
    margin: 0 0 6px;
  }}
  .shop-subtitle {{
    font-size: 13px;
    color: var(--ink-muted);
    line-height: 1.55;
    margin: 0;
  }}
  .shop-note-later {{
    margin: 12px 0 0;
    padding: 8px 12px;
    background: rgba(214, 168, 108, 0.18);
    border-left: 3px solid #b8862e;
    border-radius: 4px;
    font-size: 12.5px;
    color: #6f4f1a;
    line-height: 1.55;
  }}
  .shop-table-wrap {{ overflow-x: auto; margin-top: 8px; }}
  .shop-table {{
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }}
  .shop-table th {{
    text-align: left;
    padding: 8px 10px;
    background: rgba(43, 45, 66, 0.06);
    color: var(--indigo);
    font-weight: 700;
    border-bottom: 1.5px solid rgba(43, 45, 66, 0.15);
    text-transform: uppercase;
    font-size: 10.5px;
    letter-spacing: 0.5px;
  }}
  .shop-table td {{
    padding: 9px 10px;
    border-bottom: 1px solid rgba(43, 45, 66, 0.08);
    vertical-align: top;
  }}
  .shop-table tr:last-child td {{ border-bottom: 0; }}
  .shop-num {{
    font-family: monospace;
    color: var(--ink-muted);
    width: 28px;
    text-align: center;
  }}
  .phase-chip {{
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10.5px;
    font-weight: 700;
    white-space: nowrap;
  }}
  .phase-now {{ background: #d4edda; color: #155724; }}
  .phase-later {{ background: #fde2d0; color: #8a4a14; }}
  .shop-disclaimer {{
    margin: 14px 0 0;
    font-size: 11.5px;
    color: var(--ink-muted);
    line-height: 1.55;
  }}

  /* ── Supplement Schedule ──
     Hidden by default in normal screen view (coach feedback 2026-05-19:
     "Remove 'Your Supplement Schedule' visible block. Schedule should
     print with the button only.") The 💊 Supplements print button
     in the top print-bar sets body[data-print-supplement] which
     re-shows this section (see the print-isolation block below).
     The shopping list (#supplement-shopping-list) stays visible since
     it's a one-time "buy everything now" reference. */
  #supplement-schedule {{ display: none; }}
  body[data-print-supplement] #supplement-schedule {{
    display: block;
    margin: 56px 0 0;
    padding-top: 40px;
    border-top: 1.5px solid var(--indigo);
  }}

  /* ── Daily Routine timeline — the at-a-glance day strip ──────────
     Visible on screen (unlike the schedule) and placed near the top of
     the letter so the client can't miss it. Has its own print button
     (printRoutine → body[data-print-routine]). */
  #daily-routine {{
    margin: 36px 0;
    padding: 22px 24px;
    background: #faf8f6;
    border: 1.5px solid var(--rose);
    border-radius: 14px;
  }}
  .routine-header {{
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }}
  .routine-title {{
    font-family: 'Libre Baskerville', Georgia, serif;
    font-size: 21px;
    font-weight: 400;
    color: var(--indigo);
    margin: 0 0 6px;
  }}
  .routine-subtitle {{
    font-size: 12.5px;
    color: var(--lavender);
    margin: 0;
    max-width: 32em;
    line-height: 1.55;
  }}
  .routine-track {{ display: flex; flex-direction: column; }}
  .routine-row {{
    display: flex;
    gap: 16px;
    padding: 12px 0;
    border-bottom: 1px dashed #e3ddd7;
  }}
  .routine-row:last-child {{ border-bottom: none; }}
  .routine-anchor {{
    flex: 0 0 110px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }}
  .routine-emoji {{ font-size: 19px; }}
  .routine-label {{ font-weight: 700; font-size: 13px; color: var(--indigo); }}
  .routine-time {{
    font-size: 10px;
    color: var(--lavender);
    font-family: 'Courier New', monospace;
  }}
  .routine-body {{ flex: 1; min-width: 0; }}
  .routine-activity {{
    font-size: 13px;
    color: var(--ink);
    margin-bottom: 5px;
  }}
  .routine-supp {{ font-size: 12.5px; color: #3a4250; margin-top: 3px; line-height: 1.4; }}
  .routine-supp-dose {{ color: var(--lavender); font-size: 11.5px; }}
  .routine-supp-tag {{ color: #8a4a14; font-size: 11px; }}
  .routine-supp-none {{ color: #b8b2aa; font-style: italic; font-size: 11.5px; }}
  .routine-prn {{
    margin-top: 16px;
    padding: 14px 16px;
    background: #fbf4ea;
    border: 1px dashed #e0c79a;
    border-radius: 12px;
  }}
  .routine-prn-head {{
    font-size: 13px;
    font-weight: 700;
    color: #8a4a14;
    margin-bottom: 4px;
  }}
  .routine-prn-note {{
    font-size: 11.5px;
    color: var(--lavender);
    line-height: 1.55;
    margin: 0 0 8px;
  }}
  .routine-prn-when {{ color: #8a4a14; font-size: 11px; font-style: italic; }}
  .routine-foot {{
    font-size: 11.5px;
    color: var(--lavender);
    margin-top: 14px;
    line-height: 1.55;
  }}

  .schedule-header {{
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 28px;
    flex-wrap: wrap;
  }}

  .schedule-title {{
    font-family: 'Libre Baskerville', Georgia, serif;
    font-size: 22px;
    font-weight: 400;
    color: var(--indigo);
    margin: 0 0 6px;
  }}

  .schedule-subtitle {{
    font-size: 13px;
    color: var(--lavender);
    line-height: 1.55;
    max-width: 520px;
  }}

  .print-btn {{
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px;
    background: var(--indigo);
    color: #fff;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    font-family: 'Inter', Arial, sans-serif;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    letter-spacing: 0.01em;
    transition: background 0.15s;
    flex-shrink: 0;
  }}
  .print-btn:hover {{ background: #3d3f5a; }}

  /* Timeline track */
  .timeline-track {{
    display: flex;
    gap: 12px;
    overflow-x: auto;
    padding-bottom: 12px;
    margin-bottom: 32px;
    scroll-snap-type: x mandatory;
  }}

  .timeline-slot {{
    flex: 0 0 auto;
    min-width: 140px;
    background: #fff;
    border: 1px solid rgba(43,45,66,0.12);
    border-radius: 8px;
    padding: 14px 14px 12px;
    scroll-snap-align: start;
  }}

  .timeline-slot-label {{
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--indigo);
    margin-bottom: 10px;
    white-space: nowrap;
  }}

  .supp-pills {{
    display: flex;
    flex-direction: column;
    gap: 6px;
  }}

  .supp-pill {{
    background: var(--bone);
    border: 1px solid rgba(43,45,66,0.15);
    border-radius: 20px;
    padding: 4px 10px;
    font-size: 11.5px;
    color: var(--ink);
    line-height: 1.4;
  }}

  .supp-pill-name {{ font-weight: 500; }}

  .supp-pill-dose {{
    display: block;
    font-size: 10.5px;
    color: var(--lavender);
    margin-top: 1px;
  }}

  /* "from wk N" tag on a timeline pill for phased-in supplements. */
  .supp-pill-week {{
    display: inline-block;
    font-size: 9.5px;
    font-weight: 600;
    color: #8a4a14;
    background: #fde2d0;
    border-radius: 6px;
    padding: 0 5px;
    margin-top: 2px;
  }}

  /* Schedule table */
  .schedule-table-wrap {{
    overflow-x: auto;
    margin-top: 4px;
  }}

  .schedule-table {{
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
  }}

  .schedule-table th {{
    text-align: left;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--lavender);
    border-bottom: 1.5px solid var(--indigo);
    padding: 6px 10px 8px;
  }}

  .schedule-table td {{
    vertical-align: top;
    padding: 10px 10px;
    border-bottom: 1px solid rgba(43,45,66,0.08);
    line-height: 1.5;
  }}

  .schedule-table tr:last-child td {{ border-bottom: none; }}

  .slot-chip {{
    display: inline-block;
    background: rgba(43,45,66,0.06);
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11.5px;
    white-space: nowrap;
    color: var(--indigo);
    font-weight: 500;
  }}

  .rationale-cell {{ max-width: 240px; font-size: 12.5px; color: #444; }}
  .buy-cell       {{ min-width: 160px; font-size: 12.5px; }}
  .buy-cell a     {{ color: var(--indigo); font-weight: 500; }}
  .buy-cell a:hover {{ text-decoration: underline; }}

  .buy-badge {{
    display: inline-block;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 10px;
    font-weight: 600;
    letter-spacing: 0.03em;
    margin-left: 4px;
    vertical-align: middle;
  }}
  .buy-badge-vitaone {{ background: #d4edda; color: #155724; }}
  .buy-badge-amazon  {{ background: #fff3cd; color: #856404; }}
  .buy-badge-iherb   {{ background: #cce5ff; color: #004085; }}

  /* ── Print ── */
  @media print {{
    body {{ background: #fff; }}
    /* Leave room at bottom for our fixed contact footer */
    .page {{ padding: 15mm 14mm 22mm; max-width: 100%; }}

    /* Hide referral / supplement link / recipe appendix / product guide sections */
    .no-print {{ display: none !important; }}
    .no-print-buttons {{ display: none !important; }}

    /* Always hide the screen print buttons */
    .week-print-bar {{ display: none !important; }}

    /* Supplement schedule: keep the timeline + table, hide buy column & badges */
    #supplement-schedule {{ page-break-before: always; }}
    .timeline-track {{ overflow: visible; flex-wrap: wrap; }}
    .buy-cell {{ display: none; }}
    .schedule-table th:last-child {{ display: none; }}
    .buy-badge {{ display: none; }}

    /* Suppress link URL expansion — browser default stylesheets often add
       a[href]::after {{ content: " (" attr(href) ")"; }}
       Override globally so no link shows its URL in the printed output. */
    a, a::after, a::before {{ text-decoration: none !important; }}
    a[href]::after {{ content: none !important; }}
    abbr[title]::after {{ content: none !important; }}

    /* Tables — meal plan tables must be readable when printed */
    .content table {{
      font-size: 10px;
      page-break-inside: avoid;
      width: 100%;
      table-layout: fixed;
    }}
    .content th {{
      font-size: 9px;
      padding: 6px 5px;
    }}
    .content td {{
      padding: 5px;
      font-size: 10px;
      line-height: 1.4;
      word-wrap: break-word;
    }}

    /* Headings — keep with following content */
    h1, h2, h3 {{ page-break-after: avoid; }}

    /* Start major sections on new page */
    h1 {{ page-break-before: always; }}
    h1:first-of-type {{ page-break-before: avoid; }}

    /* Main footer */
    .brand-footer {{ margin-top: 32px; }}

    /* ── Fixed contact footer — appears on EVERY printed page ── */
    .print-page-footer {{
      display: block;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 5px 14mm;
      font-size: 9px;
      color: #8D99AE;
      text-align: center;
      border-top: 0.5px solid rgba(43,45,66,0.25);
      background: #fff;
      font-family: 'Inter', Arial, sans-serif;
      letter-spacing: 0.03em;
    }}

    /* ── Per-week isolation ──
       When body[data-print-week="N"] is set (via JS before window.print()),
       hide every direct child of .content that is NOT the target week-section.
       Header, title block and page footer remain for branding context.
    */
    body[data-print-week] .content > *:not(.week-section) {{
      display: none !important;
    }}
    body[data-print-week="1"] .week-section:not(#print-week-1) {{ display: none !important; }}
    body[data-print-week="2"] .week-section:not(#print-week-2) {{ display: none !important; }}
    body[data-print-week="3"] .week-section:not(#print-week-3) {{ display: none !important; }}
    body[data-print-week="4"] .week-section:not(#print-week-4) {{ display: none !important; }}
    body[data-print-week="5"] .week-section:not(#print-week-5) {{ display: none !important; }}

    /* Hide supplement schedule + main footer when printing a single week.
       The schedule is injected at .page level (sibling of .content), so it
       isn't covered by the `.content > *:not(.week-section)` rule above.
       Without this, the schedule prints as overflow after every week. */
    body[data-print-week] #supplement-schedule {{ display: none !important; }}
    body[data-print-week] #supplement-shopping-list {{ display: none !important; }}
    body[data-print-week] .brand-footer {{ display: none !important; }}

    /* ── Single-week density — fit one A4 page ──
       Week 1 / 2 are 7×7 tables with multi-line "✦ Start with: … Then: …"
       lunch & dinner cells. At default 10px font + 1.4 line-height the table
       overflows onto a second page. Tighten font, line-height, and padding
       in week-print mode so a 7-row × 7-day table fits within ~180×270mm. */
    body[data-print-week] .content table {{
      font-size: 9px;
      line-height: 1.25;
      page-break-inside: avoid;
    }}
    body[data-print-week] .content th {{ font-size: 8.5px; padding: 4px 3px; }}
    body[data-print-week] .content td {{ font-size: 9px;   padding: 3px 4px; line-height: 1.25; }}
    body[data-print-week] .week-section {{ page-break-inside: avoid; }}
    body[data-print-week] .week-section h2 {{ font-size: 14px; margin: 4px 0 8px; }}

    /* ── Client name above each week — print only ── */
    .print-client-name {{
      display: block;
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--lavender);
      margin-bottom: 2px;
      font-family: 'Inter', Arial, sans-serif;
    }}

    /* ── Supplement schedule print isolation ──
       When body[data-print-supplement] is set, hide all page content except
       the supplement schedule itself, and within the schedule strip away
       everything that isn't a daily-checklist essential (no subtitle, no
       visual bubble timeline, no "Why" rationale column, no "Where to buy"
       links) — the client gets a single A4 sheet with When | Supplement |
       Dose, chronologically ordered, ready to stick on the fridge.
    */
    body[data-print-supplement] .page > .doc-title-block,
    body[data-print-supplement] .page > .content,
    body[data-print-supplement] #supplement-shopping-list,
    body[data-print-supplement] .page > .brand-footer {{ display: none !important; }}
    body[data-print-supplement] #supplement-schedule {{
      page-break-before: avoid !important;
      margin-top: 0 !important;
      padding-top: 16px !important;
      border-top: none !important;
    }}
    /* Strip non-essential pieces inside the schedule */
    body[data-print-supplement] .schedule-subtitle,
    body[data-print-supplement] .timeline-track,
    body[data-print-supplement] .print-btn {{ display: none !important; }}
    /* Drop the "Why" rationale column too — daily-use sheets don't need it.
       The "Where to buy" column stays hidden via the existing .no-print rule. */
    body[data-print-supplement] .schedule-table thead th:nth-child(4),
    body[data-print-supplement] .schedule-table tbody td:nth-child(4) {{
      display: none !important;
    }}
    /* Tighter density so the daily checklist fits one A4 page */
    body[data-print-supplement] .schedule-title {{ font-size: 18px; margin-bottom: 4px; }}
    body[data-print-supplement] .schedule-table {{ font-size: 11px; }}
    body[data-print-supplement] .schedule-table th {{ font-size: 10px; padding: 6px 8px; }}
    body[data-print-supplement] .schedule-table td {{ padding: 5px 8px; line-height: 1.35; }}
    body[data-print-supplement] .schedule-table {{ page-break-inside: avoid; }}

    /* ── Print just the Daily Routine ──────────────────────────────
       printRoutine() sets body[data-print-routine] — hide everything
       except #daily-routine so the client gets a clean one-page strip
       for the fridge. */
    body[data-print-routine] .page > .doc-title-block,
    body[data-print-routine] .page > .content,
    body[data-print-routine] #supplement-shopping-list,
    body[data-print-routine] #supplement-schedule,
    body[data-print-routine] .page > .brand-footer {{ display: none !important; }}
    body[data-print-routine] #daily-routine {{
      margin: 0 !important;
      border: none !important;
      background: #fff !important;
      padding: 0 !important;
    }}
    body[data-print-routine] .print-btn {{ display: none !important; }}
    body[data-print-routine] .routine-row {{ page-break-inside: avoid; }}
  }}

  @page {{
    size: A4;
    /* margin: 0 removes the browser's native header/footer strip (URL, date,
       page numbers). Content margins are handled via .page padding instead. */
    margin: 0;
  }}
"""


def _start_date_buttons_html(
    meal_start_ymd,            # Optional[str]
    supplements_start_ymd,     # Optional[str]
    plan_slug,                 # Optional[str]
    letter_type,               # Optional[str]
    coach_phone_e164: str = "918976563971",
    include_supplements: bool = False,
) -> str:
    """Inject WhatsApp 'confirm or change start date' buttons into the letter.

    Pattern B of the client-side start-date confirmation flow (see CLAUDE.md
    v0.71). Generates one or two wa.me deep links that pre-compose structured
    messages the webhook recognises:
        ✅ START: YYYY-MM-DD [plan: <slug>]    → meal-plan start confirmed
        📅 I'd like to start ...               → free-form, falls to coach
        📦 supplements arrived                  → supplements_started_on = today

    The webhook parser is at src/lib/start-date-parser.ts.

    Args:
        meal_start_ymd: assumed meal-plan start date (default +3d or coach-set)
        supplements_start_ymd: same for supplements
        plan_slug: included in the structured message so the webhook can pick
            the right plan even if the client has multiple (the webhook
            currently picks "latest published" but the slug tag is forward-
            compatible).
        include_supplements: only render the 📦 button for supplement_plan
            and consolidated letter types — would be noise on a pure meal plan.

    Buttons are hidden on print via the .no-print-buttons CSS class.
    Returns "" if no dates are available (graceful degrade for letters
    generated before this feature shipped).
    """
    if not meal_start_ymd:
        return ""

    # Weeks-after-1-2 letters (the fortnight phase letters) must NOT ask
    # the client when they start — Day 1 was locked at the initial
    # package; by Week 3 they are already mid-plan. The confirm/change
    # start-date buttons belong only on the first letter. Coach decision
    # 2026-05-20.
    if (letter_type or "") == "meal_plan_phase":
        return ""

    from urllib.parse import quote
    import datetime as _dt
    try:
        meal_d = _dt.date.fromisoformat(meal_start_ymd)
        meal_human = meal_d.strftime("%a %-d %b")
    except Exception:
        meal_human = meal_start_ymd

    slug_tag = f" [plan: {plan_slug}]" if plan_slug else ""

    # ✅ Confirm meal start — pre-composed structured message
    confirm_text = f"✅ START: {meal_start_ymd}{slug_tag}"
    confirm_url = f"https://wa.me/{coach_phone_e164}?text={quote(confirm_text)}"

    # 📅 Pick a different day — soft pre-fill, coach will follow up
    edit_text = "📅 I'd like to start my plan on a different day — I'll start on "
    edit_url = f"https://wa.me/{coach_phone_e164}?text={quote(edit_text)}"

    buttons = [
        f'<a class="start-btn start-btn-confirm" href="{confirm_url}" target="_blank" rel="noopener">'
        f'<span class="start-btn-icon">✅</span>'
        f'<span class="start-btn-body"><strong>Yes — {meal_human} works</strong>'
        f'<small>Tap to confirm via WhatsApp</small></span></a>',
        f'<a class="start-btn start-btn-edit" href="{edit_url}" target="_blank" rel="noopener">'
        f'<span class="start-btn-icon">📅</span>'
        f'<span class="start-btn-body"><strong>I&rsquo;ll start a different day</strong>'
        f'<small>Tap to reply via WhatsApp</small></span></a>',
    ]

    if include_supplements and supplements_start_ymd:
        supp_text = f"📦 supplements arrived [plan: {plan_slug}]" if plan_slug else "📦 supplements arrived"
        supp_url = f"https://wa.me/{coach_phone_e164}?text={quote(supp_text)}"
        buttons.append(
            f'<a class="start-btn start-btn-supps" href="{supp_url}" target="_blank" rel="noopener">'
            f'<span class="start-btn-icon">📦</span>'
            f'<span class="start-btn-body"><strong>My supplements have arrived</strong>'
            f'<small>Tap when they land — I&rsquo;ll start the count</small></span></a>'
        )

    return f"""
    <aside class="start-buttons-panel no-print-buttons" aria-label="Confirm your start date">
      <div class="start-buttons-heading">📅 Confirm your Day 1</div>
      <div class="start-buttons-sub">Your Day 1 is set to <strong>{meal_human}</strong>. Tap to confirm or pick a different day.</div>
      <div class="start-buttons-row">
        {''.join(buttons)}
      </div>
    </aside>
    """


def wrap_in_brand_html(
    markdown_content: str,
    title: str,
    subtitle: str = "",
    doc_type: str = "Personalised Health Plan",
    client_name: str = "",
    meal_start_ymd=None,            # Optional[str] YYYY-MM-DD
    supplements_start_ymd=None,     # Optional[str] YYYY-MM-DD
    plan_slug=None,                 # Optional[str]
    letter_type=None,               # Optional[str]
) -> str:
    logo_uri = _logo_data_uri()
    logo_tag = (
        f'<img src="{logo_uri}" alt="Shivani Hari" class="brand-logo">'
        if logo_uri else
        '<span style="font-family:\'Libre Baskerville\',serif;font-size:20px;color:#2B2D42;font-style:italic;">Shivani Hari</span>'
    )
    # Escape client name for safe use in HTML attribute and JS
    import html as _html_mod
    safe_client_name = _html_mod.escape(client_name or "", quote=True)

    body_html = _add_target_blank(
        _wrap_no_print_sections(
            _wrap_week_sections(
                _md_to_html(markdown_content)
            )
        )
    )
    today = date.today().strftime("%-d %B %Y")

    # Pattern B: WhatsApp confirm/edit buttons for the client's start date.
    # Hidden on print (no-print-buttons class). Returns "" if no start date
    # is available — letters generated before this feature shipped still render.
    # Supplements arrived button only renders for letter types that include
    # supplements (supplement_plan + consolidated).
    include_supps = (letter_type or "") in ("supplement_plan", "consolidated")
    start_buttons_html = _start_date_buttons_html(
        meal_start_ymd=meal_start_ymd,
        supplements_start_ymd=supplements_start_ymd,
        plan_slug=plan_slug,
        letter_type=letter_type,
        include_supplements=include_supps,
    )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} — Shivani Hari</title>
  <style>{_CSS}</style>
</head>
<body data-client-name="{safe_client_name}">
  <div class="page">

    <!-- Header -->
    <header class="brand-header">
      {logo_tag}
      <div class="doc-meta">
        <span class="doc-type">{doc_type}</span>
        {today}
      </div>
    </header>

    <!-- Title block -->
    <div class="doc-title-block">
      <h1>{title}</h1>
      {f'<p class="doc-subtitle">{subtitle}<span class="rose-dot"></span>Prepared with care</p>' if subtitle else ''}
    </div>

    {start_buttons_html}

    <!-- Body -->
    <div class="content" data-plan-slug="{plan_slug or ''}">
      {body_html}
    </div>

    <!-- Footer -->
    <footer class="brand-footer">
      <div>
        <div class="name">The Ochre Tree</div>
        <div class="tagline">Biology &times; behaviour &times; subconscious patterns</div>
      </div>
      <div class="contact">
        <a href="https://www.theochretree.com" target="_blank" rel="noopener">www.theochretree.com</a><br>
        WhatsApp: <a href="https://wa.me/918976563971">+91 89765 63971</a><br>
        <a href="mailto:reachochretree@gmail.com">reachochretree@gmail.com</a><br>
        <span style="font-size:10px;color:#8D99AE;">This document is for personal use only and is not medical advice.</span>
      </div>
    </footer>

  </div>

  <!-- Repeating contact footer — visible on every printed page -->
  <div class="print-page-footer">
    The Ochre Tree &nbsp;·&nbsp; www.theochretree.com &nbsp;·&nbsp; WhatsApp: +91 88501 76753 &nbsp;·&nbsp; reachochretree@gmail.com
  </div>

  <!-- Per-week print functionality + client name injection -->
  <script>
  (function () {{
    // ── Inject print-only client name above each week section ────────────────
    var clientName = document.body.dataset.clientName || '';
    if (clientName) {{
      document.querySelectorAll('.week-section').forEach(function (sec) {{
        var nameEl = document.createElement('div');
        nameEl.className = 'print-client-name';
        nameEl.textContent = clientName;
        sec.insertBefore(nameEl, sec.firstChild);
      }});
    }}

    // ── Build top-of-page print bar ──────────────────────────────────────────
    // Each `.week-section` gets its own "Week N" button. When a supplement
    // schedule is present (#supplement-schedule injected by render-client-letter
    // post-wrap), we also add a "Supplements" button — printable separately
    // from the meal weeks. The supplement section also has its own in-place
    // 🖨 Print Schedule button further down the page; this one is the
    // top-level twin for symmetry with the week buttons.
    var sections = document.querySelectorAll('.week-section');
    var supplementSection = document.getElementById('supplement-schedule');
    if (sections.length === 0 && !supplementSection) return;

    var bar = document.createElement('div');
    bar.className = 'week-print-bar';

    var lbl = document.createElement('span');
    lbl.className = 'week-print-bar-label';
    lbl.textContent = '🖨 Print:';
    bar.appendChild(lbl);

    sections.forEach(function (sec) {{
      var weekNum = sec.id.replace('print-week-', '');
      var h2 = sec.querySelector('h2');
      var rawText = h2 ? h2.textContent : 'Week ' + weekNum;
      var label = rawText.replace(/^[^A-Z]*/, '').replace(/ *[—–-].*$/, '').trim();
      if (!label) label = 'Week ' + weekNum;

      var btn = document.createElement('button');
      btn.className = 'week-print-btn';
      btn.textContent = label;
      btn.addEventListener('click', function () {{
        document.body.setAttribute('data-print-week', weekNum);
        window.print();
      }});
      bar.appendChild(btn);
    }});

    if (supplementSection) {{
      var suppBtn = document.createElement('button');
      suppBtn.className = 'week-print-btn';
      suppBtn.textContent = '💊 Supplements';
      suppBtn.addEventListener('click', function () {{
        document.body.setAttribute('data-print-supplement', '1');
        window.print();
      }});
      bar.appendChild(suppBtn);
    }}

    // Insert the bar at the top of .content (recipe-note removed 2026-05-19)
    var content = document.querySelector('.content');
    if (content) {{
      content.insertBefore(bar, content.firstChild);
    }}

    // Clear attributes after print so full-document print works next time
    window.addEventListener('afterprint', function () {{
      document.body.removeAttribute('data-print-week');
      document.body.removeAttribute('data-print-supplement');
      document.body.removeAttribute('data-print-routine');
    }});
  }})();
  </script>

  <!-- Recipe linking: index recipe-style h3 headings (✦ dishes + teas/home
       remedies whose h3 starts with a letter), then turn each meal-plan table
       LINE (each <br>-separated segment) into a clickable jump-to-recipe
       anchor — making the whole line clickable, not just the ✦ symbol. -->
  <script>
  (function () {{
    var SYMBOL = '✦';

    function slugify(text) {{
      return 'recipe-' + text
        .replace(new RegExp(SYMBOL, 'g'), '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    }}

    // Strip ✦ + parentheticals so "Methi (Fenugreek) Water" matches cell
    // text that just says "methi water". Lowercases + collapses whitespace.
    function searchKey(text) {{
      return text
        .replace(new RegExp(SYMBOL, 'g'), '')
        .replace(/\([^)]*\)/g, ' ')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }}

    function keyWords(text) {{
      return searchKey(text).split(' ').filter(function (w) {{ return w.length > 2; }});
    }}

    // ── Step 1: Index recipe-style h3 headings ──────────────────────────────
    // A recipe-style heading (a) starts with ✦, OR (b) starts with a letter or
    // digit (i.e. NOT an emoji-prefixed section divider like "🌙 Night Hunger"),
    // AND has ≥ 2 words after stripping ✦/parentheticals (so single-word names
    // like "Salad" can't false-match common cells). This is what lets teas /
    // home remedies (Methi Water, Golden Milk, Jeera Water) get indexed even
    // though their h3 has no ✦.
    var recipes = [];
    document.querySelectorAll('h3').forEach(function (h3) {{
      var raw = h3.textContent.trim();
      if (!raw) return;
      var startsWithSymbol = raw.charAt(0) === SYMBOL;
      var startsWithAlnum = /^[A-Za-z0-9]/.test(raw);
      if (!startsWithSymbol && !startsWithAlnum) return;
      var key = searchKey(raw);
      var words = keyWords(raw);
      if (!key || words.length < 2) return;
      var id = slugify(raw);
      h3.id = id;
      recipes.push({{ id: id, key: key, words: words, name: raw }});
    }});

    // External recipes page mode: if no inline recipes were found and a
    // plan slug is set, link every ✦-marked cell to /recipes/<slug>.
    // (Post-reformat letters strip the inline appendix entirely.)
    // Recipe-note banner was removed 2026-05-19 (coach feedback: didn't
    // work consistently). We still keep the inline-recipe linking logic.
    var contentEl = document.querySelector('.content');
    var planSlug = contentEl ? contentEl.getAttribute('data-plan-slug') : '';
    var externalUrl = planSlug ? ('/recipes/' + planSlug) : '';

    if (recipes.length === 0 && !externalUrl) return;

    // Sort longest key first so substring matching prefers more specific names.
    recipes.sort(function (a, b) {{ return b.key.length - a.key.length; }});

    // ── Step 3: Per-line link wrapping in every meal-plan table cell ────────
    // Split each cell on <br>; for each segment, score every indexed recipe
    // (substring-match bonus + word overlap), pick the best, and wrap the
    // ENTIRE segment in a single anchor — clicking anywhere on the line jumps
    // to the recipe. Standalone ✦ markers in the segment are stripped (the
    // link styling is the visual cue now).
    var BR_SPLIT = /(<br\s*\/?\s*>)/gi;

    function bestRecipeFor(plainText) {{
      var t = plainText.toLowerCase();
      var best = null;
      var bestScore = 0;
      recipes.forEach(function (r) {{
        var score = 0;
        if (t.indexOf(r.key) !== -1) score += 5;          // strong: full name verbatim
        r.words.forEach(function (w) {{
          if (t.indexOf(w) !== -1) score += 1;            // fallback: word overlap
        }});
        if (score > bestScore) {{ bestScore = score; best = r; }}
      }});
      // Require either a substring hit (≥ 5) or ≥ 2 word matches to avoid
      // false positives on cells that share a single common ingredient word.
      return bestScore >= 5 || bestScore >= 2 ? best : null;
    }}

    document.querySelectorAll('td').forEach(function (td) {{
      if (!/[A-Za-z]/.test(td.textContent)) return; // skip "—" / placeholder cells

      var html = td.innerHTML;
      var parts = html.split(BR_SPLIT); // alternating: text, <br>, text, …
      var changed = false;
      var rebuilt = parts.map(function (part) {{
        if (BR_SPLIT.test(part)) {{ BR_SPLIT.lastIndex = 0; return part; }}
        var plain = part
          .replace(/<[^>]+>/g, '')
          .replace(new RegExp(SYMBOL, 'g'), '')
          .trim();
        if (plain.length < 3) return part;
        var hasSymbol = part.indexOf(SYMBOL) !== -1;
        var inner = part
          .replace(new RegExp('\\s*' + SYMBOL + '\\s*', 'g'), ' ')
          .replace(/^\s+|\s+$/g, '');
        if (!inner) return part;
        // Prefer inline (anchor in same doc) when we indexed h3 recipes.
        var r = recipes.length > 0 ? bestRecipeFor(plain) : null;
        if (r) {{
          changed = true;
          return '<a href="#' + r.id + '" class="recipe-link" title="Jump to recipe: ' +
                 r.name.replace(/"/g, '&quot;') + '">' + inner + '</a>';
        }}
        // External recipes page fallback — link any ✦-marked dish.
        if (externalUrl && hasSymbol) {{
          changed = true;
          return '<a href="' + externalUrl + '" target="_blank" rel="noopener" ' +
                 'class="recipe-link" title="Open your recipe pack">' + inner + '</a>';
        }}
        return part;
      }});
      if (changed) td.innerHTML = rebuilt.join('');
    }});
  }})();
  </script>
</body>
</html>"""
