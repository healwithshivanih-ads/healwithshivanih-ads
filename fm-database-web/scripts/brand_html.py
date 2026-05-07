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

  /* ── Supplement Schedule ── */
  #supplement-schedule {{
    margin: 56px 0 0;
    padding-top: 40px;
    border-top: 1.5px solid var(--indigo);
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

    /* Hide main footer when printing a specific week (page footer still shows) */
    body[data-print-week] .brand-footer {{ display: none !important; }}

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
       the brand header (for context) and the supplement schedule itself.
    */
    body[data-print-supplement] .page > .doc-title-block,
    body[data-print-supplement] .page > .content,
    body[data-print-supplement] .page > .brand-footer {{ display: none !important; }}
    body[data-print-supplement] #supplement-schedule {{
      page-break-before: avoid !important;
      margin-top: 0 !important;
      padding-top: 24px !important;
      border-top: none !important;
    }}
    /* Reveal the schedule's buy column when printing in isolation mode
       (coach prints for reference; client gets the file-link-free version) */
    body[data-print-supplement] .buy-cell {{ display: table-cell !important; }}
    body[data-print-supplement] .schedule-table th:last-child {{ display: table-cell !important; }}
  }}

  @page {{
    size: A4;
    /* margin: 0 removes the browser's native header/footer strip (URL, date,
       page numbers). Content margins are handled via .page padding instead. */
    margin: 0;
  }}
"""


def wrap_in_brand_html(
    markdown_content: str,
    title: str,
    subtitle: str = "",
    doc_type: str = "Personalised Health Plan",
    client_name: str = "",
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

    <!-- Body -->
    <div class="content">
      <!-- Recipe note — hidden until JS confirms recipes exist -->
      <div class="recipe-note" id="recipe-note">
        <strong>Recipes included</strong> &nbsp;·&nbsp;
        Dishes marked with <span class="recipe-note-symbol">✦</span> have a full recipe
        in the <em>Recipe Appendix</em> at the end of this document.
        Click any underlined dish name to jump straight to its recipe while you&rsquo;re cooking.
      </div>
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
        WhatsApp: <a href="https://wa.me/918850176753">+91 88501 76753</a><br>
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

    // ── Build per-week print bar ─────────────────────────────────────────────
    var sections = document.querySelectorAll('.week-section');
    if (sections.length === 0) return;

    var bar = document.createElement('div');
    bar.className = 'week-print-bar';

    var lbl = document.createElement('span');
    lbl.className = 'week-print-bar-label';
    lbl.textContent = '🖨 Print:';
    bar.appendChild(lbl);

    sections.forEach(function (sec) {{
      var weekNum = sec.id.replace('print-week-', '');
      // Extract a short label from the H2 inside (e.g. "Week 1 Meal Plan")
      var h2 = sec.querySelector('h2');
      var rawText = h2 ? h2.textContent : 'Week ' + weekNum;
      // Strip emoji prefix and anything after "—"
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

    // Insert the bar below the recipe note (or at top of .content if no note)
    var content = document.querySelector('.content');
    var recipeNote = document.getElementById('recipe-note');
    if (content) {{
      if (recipeNote && recipeNote.style.display !== 'none') {{
        recipeNote.after(bar);
      }} else {{
        content.insertBefore(bar, content.firstChild);
      }}
    }}

    // Clear attributes after print so full-document print works next time
    window.addEventListener('afterprint', function () {{
      document.body.removeAttribute('data-print-week');
      document.body.removeAttribute('data-print-supplement');
    }});
  }})();
  </script>

  <!-- Recipe linking: index ✦ headings, link ✦ symbols in meal plan tables -->
  <script>
  (function () {{
    var SYMBOL = '✦'; // ✦

    // ── Helper: build a slug from heading text ───────────────────────────────
    function slugify(text) {{
      return 'recipe-' + text
        .replace(new RegExp(SYMBOL, 'g'), '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    }}

    // ── Helper: extract meaningful words from a string ───────────────────────
    function keyWords(text) {{
      return text
        .replace(new RegExp(SYMBOL, 'g'), ' ')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(' ')
        .filter(function (w) {{ return w.length > 2; }});
    }}

    // ── Step 1: Index every h3 that contains ✦ ──────────────────────────────
    var recipes = [];
    document.querySelectorAll('h3').forEach(function (h3) {{
      if (h3.textContent.indexOf(SYMBOL) === -1) return;
      var id = slugify(h3.textContent);
      h3.id = id;
      recipes.push({{ id: id, words: keyWords(h3.textContent) }});
    }});

    if (recipes.length === 0) return; // no recipes — nothing to do

    // ── Step 2: Show the recipe note banner ──────────────────────────────────
    var note = document.getElementById('recipe-note');
    if (note) note.style.display = 'block';

    // Move the print bar AFTER the note now that it's visible
    var bar = document.querySelector('.week-print-bar');
    if (bar && note) note.after(bar);

    // ── Step 3: Link dish name + ✦ in every table cell to its recipe ────────
    document.querySelectorAll('td').forEach(function (td) {{
      if (td.textContent.indexOf(SYMBOL) === -1) return;

      // Score each recipe by word overlap with the cell text
      var cellWords = keyWords(td.textContent);
      var best = null;
      var bestScore = 0;

      recipes.forEach(function (r) {{
        var score = 0;
        r.words.forEach(function (rw) {{
          if (cellWords.indexOf(rw) !== -1) score++;
        }});
        if (score > bestScore) {{ bestScore = score; best = r; }}
      }});

      // Replace "dish name ✦" with a link wrapping BOTH the name and symbol.
      // Pattern: any text (not containing an HTML tag) followed by optional
      // whitespace then ✦ — this makes the full dish name clickable.
      if (best) {{
        var anchorId = best.id;
        td.innerHTML = td.innerHTML.replace(
          /([^<>]*?)[ \t]*✦/g,
          function (match, dishText) {{
            var dish = dishText.trim();
            var inner = dish ? dish + ' ✦' : '✦';
            return '<a href="#' + anchorId + '" class="recipe-link" title="Jump to recipe">' + inner + '</a>';
          }}
        );
      }}
    }});
  }})();
  </script>
</body>
</html>"""
