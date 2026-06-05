"""
brand_html.py — shared The Ochre Tree / Shivani Hari brand HTML wrapper.

Usage:
    from brand_html import wrap_in_brand_html
    html = wrap_in_brand_html(markdown_text, title="Your Plan", subtitle="Prepared for Jane")

Design: The Ochre Tree (2026-05-29 migration)
  – Forest green + ochre + warm paper palette
  – System fonts only (Georgia serif, system-ui sans, cursive script) — no CDN
  – New masthead / signoff structure matching the Nidhi letter design
  – All API-letter functional CSS retained (supplement schedule, daily routine,
    shopping list, week-section print, recipe linking, start-date buttons)
"""

import base64
import re
from pathlib import Path
from datetime import date

# ── Brand tokens (The Ochre Tree palette) ─────────────────────────────────────
PAPER    = "#faf9f7"
PAPER_2  = "#f4efe6"
PAPER_3  = "#efe8da"
FOREST   = "#4a6152"
FOREST_2 = "#5a7563"
FOREST_3 = "#6b8a74"
FOREST_W = "#e9efe9"
OCHRE    = "#a9651f"
OCHRE_2  = "#c2832e"
OCHRE_W  = "#f3e7d3"
INK      = "#262219"
MUTED    = "#6f6a5d"
FAINT    = "#9b9587"
LINE     = "#e6dfd1"
LINE_STR = "#d6cdbb"

LOGO_PATH = Path("/Users/shivani/Shivani Hari Brand/shivani-hari-logo-transparent.png")

# ── Inline SVG icons ──────────────────────────────────────────────────────────
_TREE_SVG_BG = (
    '<svg class="masthead__tree-bg" viewBox="0 0 100 100" fill="none" aria-hidden="true">'
    '<path d="M50 92V52" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
    '<path d="M50 60c-8-3-13-10-12-19M50 52c8-2 14-9 14-19M50 70c6-2 11-7 11-14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
    '<path d="M50 18c-12 0-20 9-20 20 0 13 9 20 20 20s20-7 20-20c0-11-8-20-20-20Z" stroke="currentColor" stroke-width="2.2"/>'
    '<path d="M34 30c-7 1-12 6-12 13M66 30c7 1 12 6 12 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
    '</svg>'
)

_LOGO_SVG = (
    '<svg class="brandmark__logo" viewBox="0 0 100 100" fill="none" aria-hidden="true">'
    '<path d="M50 94V54" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'
    '<path d="M50 64c-9-3-14-11-13-21M50 56c9-2 15-10 15-21M50 74c7-2 12-8 12-15" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
    '<path d="M50 12c-13 0-22 10-22 22 0 14 10 22 22 22s22-8 22-22c0-12-9-22-22-22Z" stroke="currentColor" stroke-width="3"/>'
    '</svg>'
)

_PRINT_ICON = (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
    'stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;flex-shrink:0">'
    '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>'
    '<rect x="6" y="14" width="12" height="8" rx="1"/>'
    '</svg>'
)


def _logo_data_uri() -> str:
    try:
        raw = LOGO_PATH.read_bytes()
        b64 = base64.b64encode(raw).decode()
        return f"data:image/png;base64,{b64}"
    except Exception:
        return ""


def _md_to_html(md: str) -> str:
    """Lightweight markdown → HTML (tables, fenced code, nl2br)."""
    import markdown as md_lib
    return md_lib.markdown(
        md,
        extensions=["tables", "fenced_code", "nl2br"],
    )


# Week section detection for per-week print buttons.
# Matches any H2 starting with "Week N" where N is a number — catches the
# original Claude-design "Week 1 Meal Plan" AND newer hand-authored variants
# like "Week 1 — Day-by-day". Requires SINGULAR "Week" (the `(?!s)` lookahead
# excludes plural "Weeks 3–12 pattern" range headings so summary sections
# don't get wrapped as a print week).
# Coach feedback 2026-05-29: print buttons silently dropped whenever the
# letter author used any heading format other than "Week N Meal Plan".
_WEEK_HEADING_RE = re.compile(r'^\s*Week(?!s)\s+(\d+)\b', re.IGNORECASE)

# Headings that should be hidden when printing (supplement / referral / appendix)
_NO_PRINT_HEADING_RE = re.compile(
    r'supplement\s+protocol|where\s+to\s+buy|recommended\s+products|'
    r'product\s+guide|recipe\s+appendix|shop\s+|shopping|iherb|vitaone|'
    r'buy\s+here|referral',
    re.IGNORECASE,
)


_DAY_ROW_RE = re.compile(
    r"(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:day|sday|nesday|rsday|urday)?\s+\d+",
    re.IGNORECASE,
)

# A whole cell that IS a day name (optionally with a trailing date) — used to
# detect the TRANSPOSED meal-table orientation where days are the COLUMN
# headers (e.g. "| | Mon | Tue | … | Sun |") and meals are the rows. Anchored
# so "Breakfast" / "Activity" / "Duration" never match.
_DAY_NAME_RE = re.compile(
    r"^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:day|sday|nesday|rsday|urday)?(?:\s+.+)?$",
    re.IGNORECASE,
)


def _convert_meal_tables_to_day_cards(html: str) -> str:
    """Convert markdown-rendered meal-plan tables into the Ochre Tree
    day-card grid format from the Claude Design bundle.

    Detection: any <table> whose FIRST body row's first cell text starts
    with a day-of-week + number pattern ("Sun 31 May", "Mon 1 Jun", etc.)
    is treated as a meal-plan table. Header cells become meal labels
    (Breakfast / Lunch / Dinner / Snack / On waking, etc.); each body row
    becomes one <article class="day-card">.

    Why this exists: markdown letters are easy to author (rows + columns)
    but render as cramped tables. The design wants recipe-card-style day
    cards stacked in a 2-column grid. Doing the conversion here means
    BOTH the chat-ingest path AND the API path produce the right format
    automatically — no per-call HTML hand-authoring.

    Coach feedback 2026-05-29: "go back to the Claude design format ...
    make sure the api route also does that."
    """
    # Find every <table>...</table> block at the top level.
    table_re = re.compile(r"<table>(.+?)</table>", re.DOTALL | re.IGNORECASE)

    def convert_one_table(match: "re.Match[str]") -> str:
        inner = match.group(1)
        # Parse header row
        thead_m = re.search(
            r"<thead>(.+?)</thead>", inner, re.DOTALL | re.IGNORECASE
        )
        tbody_m = re.search(
            r"<tbody>(.+?)</tbody>", inner, re.DOTALL | re.IGNORECASE
        )
        if not thead_m or not tbody_m:
            return match.group(0)
        # Capture EMPTY header cells too (.*? not .+?): transposed meal
        # tables start with a blank corner cell ("| | Mon | Tue | …"); if we
        # drop it, the day columns shift by one and Monday is lost.
        header_cells = re.findall(
            r"<th[^>]*>(.*?)</th>", thead_m.group(1), re.DOTALL | re.IGNORECASE
        )
        if len(header_cells) < 3:
            return match.group(0)  # not a meal-plan-shaped table

        # Body rows
        row_blocks = re.findall(
            r"<tr[^>]*>(.+?)</tr>", tbody_m.group(1), re.DOTALL | re.IGNORECASE
        )
        if not row_blocks:
            return match.group(0)
        first_row_cells = re.findall(
            r"<td[^>]*>(.+?)</td>", row_blocks[0], re.DOTALL | re.IGNORECASE
        )
        if not first_row_cells:
            return match.group(0)

        def _strip_inline(s: str) -> str:
            return re.sub(r"<[^>]+>", "", s).strip()

        first_cell_text = _strip_inline(first_row_cells[0])
        if not _DAY_ROW_RE.match(first_cell_text):
            # ── Transposed orientation ──────────────────────────────────
            # Days as COLUMN headers, meals as ROWS:
            #   | | Mon | Tue | … | Sun |
            #   | Breakfast | … | … |
            # Convert one day-card per day column (so it never spills off
            # the page as a 7-column table). Detect: header cells after the
            # first are ALL day names.
            day_headers = [_strip_inline(h) for h in header_cells[1:]]
            if len(day_headers) >= 4 and all(
                _DAY_NAME_RE.match(d) for d in day_headers if d
            ) and all(day_headers):
                parsed_rows: list[tuple[str, list[str]]] = []
                for row in row_blocks:
                    rcells = re.findall(
                        r"<td[^>]*>(.*?)</td>", row, re.DOTALL | re.IGNORECASE
                    )
                    if not rcells:
                        continue
                    parsed_rows.append((_strip_inline(rcells[0]), rcells[1:]))
                t_cards: list[str] = []
                for di, day_full in enumerate(day_headers):
                    dm = re.match(r"^(\w+?)\s+(.+)$", day_full)
                    t_dow = dm.group(1) if dm else day_full
                    t_date = dm.group(2) if dm else ""
                    t_rows: list[str] = []
                    for meal_label, day_cells in parsed_rows:
                        if di >= len(day_cells):
                            continue
                        cell_inner = day_cells[di].strip()
                        if not _strip_inline(cell_inner):
                            continue
                        t_rows.append(
                            f'        <div class="meal-row"><span class="ml">{meal_label}</span><span class="md">{cell_inner}</span></div>'
                        )
                    if not t_rows:
                        continue
                    t_cards.append(
                        '    <article class="day-card">\n'
                        f'      <div class="day-card__head"><span class="dow">{t_dow}</span><span class="date">{t_date}</span></div>\n'
                        '      <div class="day-card__body">\n'
                        + "\n".join(t_rows)
                        + "\n      </div>\n"
                        "    </article>"
                    )
                if t_cards:
                    return (
                        '<div class="meal-grid">\n' + "\n".join(t_cards) + "\n  </div>"
                    )
            return match.group(0)  # not a meal-plan table — leave alone

        # Build day cards
        meal_labels = [_strip_inline(h) for h in header_cells[1:]]

        cards: list[str] = []
        for row in row_blocks:
            cells = re.findall(
                r"<td[^>]*>(.+?)</td>", row, re.DOTALL | re.IGNORECASE
            )
            if not cells:
                continue
            day_full = _strip_inline(cells[0])
            # Split "Sun 31 May" → dow="Sun", date="31 May"
            dow_match = re.match(
                r"^(\w+?)\s+(.+)$", day_full
            )
            dow = dow_match.group(1) if dow_match else day_full
            date_part = dow_match.group(2) if dow_match else ""

            rows_html: list[str] = []
            for i, cell in enumerate(cells[1:]):
                if i >= len(meal_labels):
                    break
                label = meal_labels[i]
                # Keep cell HTML (preserves bold, links) but strip outer
                # whitespace
                cell_inner = cell.strip()
                # Skip empty meal slots so the row doesn't print a blank.
                if not _strip_inline(cell_inner):
                    continue
                rows_html.append(
                    f'        <div class="meal-row"><span class="ml">{label}</span><span class="md">{cell_inner}</span></div>'
                )

            cards.append(
                '    <article class="day-card">\n'
                f'      <div class="day-card__head"><span class="dow">{dow}</span><span class="date">{date_part}</span></div>\n'
                f'      <div class="day-card__body">\n'
                + "\n".join(rows_html)
                + "\n      </div>\n"
                "    </article>"
            )

        return (
            '<div class="meal-grid">\n'
            + "\n".join(cards)
            + "\n  </div>"
        )

    return table_re.sub(convert_one_table, html)


def _add_target_blank(html: str) -> str:
    """Add target="_blank" rel="noopener noreferrer" to all external links."""
    return re.sub(
        r'<a\s+href="(https?://[^"]+)"',
        r'<a target="_blank" rel="noopener noreferrer" href="\1"',
        html,
    )


def _wrap_week_sections(html: str) -> str:
    """
    Wrap each "Week N Meal Plan" H2 section in
    <div id="print-week-N" class="week-section"> for per-week print buttons.
    """
    parts = re.split(r'(<h2[^>]*>.*?</h2>)', html, flags=re.DOTALL | re.IGNORECASE)
    result: list[str] = []
    in_week_div = False

    for part in parts:
        if re.match(r'<h2', part, re.IGNORECASE):
            heading_text = re.sub(r'<[^>]+>', '', part)
            m = _WEEK_HEADING_RE.search(heading_text)
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
    Wrap H2 sections matching supplement/referral/product/recipe patterns
    in <div class="no-print"> so they hide on print.
    """
    parts = re.split(r'(<h2[^>]*>.*?</h2>)', html, flags=re.DOTALL | re.IGNORECASE)
    result: list[str] = []
    in_no_print = False

    for part in parts:
        if re.match(r'<h2', part, re.IGNORECASE):
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


# ─────────────────────────────────────────────────────────────────────────────
# CSS — The Ochre Tree design, system fonts, no CDN
# ─────────────────────────────────────────────────────────────────────────────
_CSS = f"""
/* ============================================================
   1. TOKENS — The Ochre Tree
   ============================================================ */
:root {{
  --paper:       {PAPER};
  --paper-2:     {PAPER_2};
  --paper-3:     {PAPER_3};
  --forest:      {FOREST};
  --forest-2:    {FOREST_2};
  --forest-3:    {FOREST_3};
  --forest-wash: {FOREST_W};
  --ochre:       {OCHRE};
  --ochre-2:     {OCHRE_2};
  --ochre-wash:  {OCHRE_W};
  --ink:         {INK};
  --muted:       {MUTED};
  --faint:       {FAINT};
  --line:        {LINE};
  --line-strong: {LINE_STR};

  /* Slot colours — daily routine and supplement schedule */
  --slot-morning-bg: #f6ecd6;  --slot-morning-fg: #8a6212;
  --slot-midday-bg:  #e6efe3;  --slot-midday-fg:  #2f6a3c;
  --slot-evening-bg: #e7e8ef;  --slot-evening-fg: #46507e;
  --slot-night-bg:   #ece7ef;  --slot-night-fg:   #5a4a72;

  /* Typography — system stack, no CDN */
  --serif:  Georgia, "Iowan Old Style", "Noto Serif", "Times New Roman", serif;
  --sans:   -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --script: "Segoe Script", "Bradley Hand", "Snell Roundhand", "Brush Script MT", cursive;

  /* Legacy aliases (for any render-client-letter.py inline references) */
  --bone:     var(--paper);
  --indigo:   var(--forest);
  --lavender: var(--muted);
  --rose:     var(--ochre);
  --ink-muted: var(--muted);

  /* Spacing scale */
  --s1:4px; --s2:8px; --s3:16px; --s4:24px;
  --s5:32px; --s6:48px; --s7:64px; --s8:96px;

  --radius:    8px;
  --radius-sm: 5px;
  --shadow:      0 1px 2px rgba(38,34,25,.04), 0 10px 30px rgba(74,97,82,.07);
  --shadow-soft: 0 1px 2px rgba(38,34,25,.03), 0 6px 18px rgba(74,97,82,.06);
  --measure: 64ch;
  --max-w: 760px;
}}

/* ============================================================
   2. BASE RESET
   ============================================================ */
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
html {{ font-size: 16px; -webkit-text-size-adjust: 100%; }}

body {{
  background:
    radial-gradient(120% 60% at 100% 0%, rgba(194,131,46,.05), transparent 60%),
    var(--paper);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 16.5px;
  line-height: 1.66;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}}

h1, h2, h3, h4 {{ font-family: var(--serif); color: var(--forest); font-weight: 700; margin: 0; line-height: 1.18; }}
p  {{ margin: 0 0 var(--s3) 0; max-width: var(--measure); }}
strong {{ font-weight: 700; color: var(--forest); }}
em {{ font-style: italic; }}
a  {{ color: var(--forest-2); text-decoration: underline; text-underline-offset: 2px;
     text-decoration-color: rgba(90,117,99,.35); transition: color .18s ease, text-decoration-color .18s ease; }}
a:hover {{ color: var(--forest-3); text-decoration-color: var(--forest-3); }}
ul, ol {{ max-width: var(--measure); padding-left: 1.4em; margin: 0 0 var(--s3); }}
li {{ margin-bottom: 6px; }}
blockquote {{ border-left: 3px solid var(--forest-2); background: var(--forest-wash);
              margin: var(--s4) 0; padding: var(--s3) var(--s4);
              border-radius: 0 var(--radius-sm) var(--radius-sm) 0; max-width: var(--measure); }}
blockquote p:last-child {{ margin-bottom: 0; }}
hr {{ border: none; border-top: 1px solid var(--line); margin: var(--s5) 0; }}

/* ============================================================
   3. PAGE SHELL (.letter replaces .page)
   ============================================================ */
.letter {{
  max-width: var(--max-w);
  margin: 0 auto;
  padding: 0 0 var(--s8);
  background: var(--paper);
  box-shadow: 0 1px 0 var(--line), 0 30px 80px rgba(20,83,45,.05);
}}
@media (min-width: 880px) {{ .letter {{ margin: var(--s7) auto; }} }}

/* Legacy alias — keep .page working for any injected HTML that uses it */
.page {{ max-width: var(--max-w); margin: 0 auto; padding: 56px 48px 80px; }}

/* ============================================================
   4. MASTHEAD (replaces .brand-header)
   ============================================================ */
.masthead {{
  position: relative; overflow: hidden;
  padding: var(--s7) var(--s7) var(--s6);
  background: linear-gradient(155deg, var(--forest-wash) 0%, var(--paper) 48%, var(--ochre-wash) 125%);
  border-bottom: 1px solid var(--line);
}}
.masthead__tree-bg {{
  position: absolute; right: -28px; top: -22px;
  width: 240px; height: 240px; opacity: .10; color: var(--forest); pointer-events: none;
}}
.masthead__top {{
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--s3); margin-bottom: var(--s5); flex-wrap: wrap;
}}
.brandmark {{ display: flex; align-items: center; gap: 12px; }}
.brandmark__logo {{ width: 42px; height: 42px; color: var(--forest); flex: none; }}
.brandmark__name {{ font-family: var(--serif); font-weight: 700; color: var(--forest); font-size: 18px; line-height: 1.1; }}
.brandmark__tag  {{ font-size: 11.5px; letter-spacing: .13em; text-transform: uppercase; color: var(--ochre); font-weight: 600; margin-top: 3px; }}
.masthead__date  {{ font-size: 12px; color: var(--faint); letter-spacing: .04em; line-height: 1.6; text-align: right; }}
.masthead__doc-type {{ font-family: var(--serif); font-size: 13px; color: var(--forest); display: block; margin-bottom: 3px; font-style: italic; }}

.masthead__phase {{
  font-family: var(--serif); font-size: clamp(26px, 4vw, 40px);
  font-weight: 700; line-height: 1.1; letter-spacing: -.01em;
  color: var(--forest); margin: 0 0 var(--s2); max-width: 22ch;
}}
.masthead__lede {{ font-size: 16px; color: var(--muted); max-width: 52ch; margin: 0; }}
.masthead__meta {{
  display: flex; flex-wrap: wrap; gap: var(--s2) var(--s5);
  margin-top: var(--s5); padding-top: var(--s4);
  border-top: 1px solid rgba(214,205,187,.7);
  font-size: 13.5px; color: var(--muted);
}}
.masthead__meta b {{ color: var(--forest); font-weight: 600; }}

/* Legacy header — used if code references .brand-header or .doc-title-block directly */
.brand-header {{
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--s5) var(--s7); border-bottom: 1px solid var(--line);
  background: linear-gradient(155deg, var(--forest-wash) 0%, var(--paper) 60%);
  flex-wrap: wrap; gap: 16px;
}}
.brand-logo {{ height: 64px; width: auto; max-width: 200px; display: block; object-fit: contain; }}
.doc-meta   {{ text-align: right; font-size: 11px; color: var(--muted); letter-spacing: .04em; line-height: 1.6; }}
.doc-meta .doc-type {{ font-family: var(--serif); font-size: 13px; color: var(--forest); display: block; margin-bottom: 3px; font-style: italic; }}
.doc-title-block {{ margin: var(--s5) var(--s7) var(--s4); }}
.doc-title-block h1 {{ font-family: var(--serif); font-size: clamp(24px, 4vw, 36px); font-weight: 700; color: var(--forest); margin-bottom: 8px; }}
.doc-subtitle {{ font-size: 14px; color: var(--muted); letter-spacing: .02em; }}
.rose-dot {{ display: inline-block; width: 7px; height: 7px; border-radius: 50%;
             background: var(--ochre); margin: 0 8px 1px; vertical-align: middle; }}

/* ============================================================
   5. BODY CONTENT
   ============================================================ */
.content {{ padding: var(--s7) var(--s7) var(--s5); }}
.content > * {{ max-width: var(--measure); }}

.content h1 {{
  font-family: var(--serif); font-size: 26px; font-weight: 700;
  color: var(--forest); margin: var(--s7) 0 var(--s3);
  padding-top: var(--s5); position: relative;
}}
.content h1::before {{ content: ""; display: block; width: 44px; height: 2px;
  background: var(--ochre); margin-bottom: var(--s4); border-radius: 2px; }}
.content h1:first-child {{ margin-top: 0; padding-top: 0; }}
.content h1:first-child::before {{ display: none; }}

.content h2 {{
  font-family: var(--serif); font-size: 21px; font-weight: 700;
  color: var(--forest); margin: var(--s6) 0 var(--s3);
  padding-top: var(--s4); position: relative;
}}
.content h2::before {{ content: ""; display: block; width: 36px; height: 2px;
  background: var(--ochre); margin-bottom: var(--s3); border-radius: 2px; }}
.content h2:first-child {{ margin-top: 0; padding-top: 0; }}
.content h2:first-child::before {{ display: none; }}

.content h3 {{
  font-family: var(--serif); font-size: 17px; font-weight: 700;
  color: var(--forest-2); margin: var(--s5) 0 var(--s2);
}}

.content p  {{ font-size: 15.5px; line-height: 1.76; color: var(--ink); margin-bottom: var(--s3); }}
.content em {{ color: var(--muted); font-style: italic; }}
.content strong {{ font-weight: 700; color: var(--forest); }}

.content ul, .content ol {{ margin: var(--s2) 0 var(--s4) 20px; font-size: 15.5px; line-height: 1.76; }}
.content li {{ margin-bottom: 7px; padding-left: 4px; }}
.content ul li::marker {{ color: var(--ochre); }}
.content ol li::marker {{ color: var(--muted); font-weight: 600; }}

/* Tables — meal plans, reference tables */
.content table {{ width: 100%; border-collapse: collapse; margin: var(--s4) 0 var(--s5); font-size: 14px; }}
.content thead tr {{ background: var(--forest); color: #fff; }}
.content th {{ padding: 10px 14px; font-family: var(--sans); font-weight: 600; font-size: 11.5px;
               text-transform: uppercase; letter-spacing: .07em; text-align: left; }}
.content td {{ padding: 10px 14px; border-bottom: 1px solid var(--line); vertical-align: top; line-height: 1.6; }}
.content tbody tr:nth-child(even) td {{ background: rgba(244,239,230,.5); }}
.content a {{ color: var(--forest-2); text-underline-offset: 3px; text-decoration-color: var(--ochre-wash); }}
.content a:hover {{ color: var(--ochre); }}
.content hr {{ border: none; border-top: 1px solid var(--line); margin: var(--s5) 0; }}
.content blockquote {{
  border-left: 3px solid var(--forest-2); margin: var(--s4) 0;
  padding: var(--s3) var(--s4); background: var(--forest-wash);
  font-size: 14px; color: var(--muted);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}}

/* Recipe links */
a.recipe-link {{ color: inherit; font-weight: inherit; text-decoration: underline;
  text-decoration-color: var(--ochre); text-underline-offset: 2px; cursor: pointer; transition: color .15s; }}
a.recipe-link:hover {{ color: var(--ochre); text-decoration-color: var(--ochre); }}

/* Recipe note banner */
.recipe-note {{
  display: none;
  background: var(--ochre-wash); border-left: 3px solid var(--ochre-2);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  padding: 10px 18px; margin: 0 0 28px; font-size: 13px; color: var(--muted); line-height: 1.6;
}}
.recipe-note strong {{ color: var(--forest); font-weight: 600; }}
.recipe-note .recipe-note-symbol {{ color: var(--ochre); font-weight: 700; }}

/* Callout / info block */
.callout {{
  background: var(--forest-wash); border-left: 3px solid var(--forest-2);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  padding: var(--s4) var(--s5); margin: var(--s5) 0; max-width: var(--measure);
}}
.callout p:last-child {{ margin-bottom: 0; }}
.eyebrow {{ font-size: 11.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--ochre); font-weight: 600; margin-bottom: var(--s2); }}

/* ============================================================
   6. REFERENCE BLOCKS (.block — supplement/routine/shopping containers)
   ============================================================ */
.block {{
  margin: 0 var(--s7) var(--s6);
  border: 1px solid var(--line); border-radius: var(--radius);
  background: var(--paper); box-shadow: var(--shadow); overflow: hidden;
}}
.block__head {{
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: var(--s4); padding: var(--s5) var(--s5) var(--s4); border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, var(--paper-2), var(--paper));
  flex-wrap: wrap;
}}
.block__title {{ display: flex; flex-direction: column; gap: 6px; }}
.block__title .eyebrow {{ font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--ochre); font-weight: 600; }}
.block__title h2 {{ font-size: 21px; margin: 0; }}
.block__title h2::before {{ display: none; }}
.block__title .sub {{ font-size: 13.5px; color: var(--muted); margin: 0; }}
.block__body {{ padding: var(--s5); }}

/* ============================================================
   7. PRINT BUTTON (shared across all blocks)
   ============================================================ */
.print-btn {{
  flex: none; display: inline-flex; align-items: center; gap: 8px;
  font-family: var(--sans); font-size: 13px; font-weight: 600; color: var(--forest);
  background: var(--paper); border: 1.5px solid var(--line-strong);
  border-radius: 999px; padding: 9px 16px; cursor: pointer;
  transition: background .18s ease, border-color .18s ease, color .18s ease, transform .12s ease;
  white-space: nowrap;
}}
.print-btn:hover {{ border-color: var(--forest-2); background: var(--forest-wash); }}
.print-btn:active {{ transform: translateY(1px); }}
.print-btn--sm {{ padding: 7px 14px; font-size: 12px; }}

/* ============================================================
   8. DAILY ROUTINE
   — Used by render-client-letter.py _build_daily_routine_html()
   — Legacy class names retained; new .rrow / .pill classes added
   ============================================================ */

/* #daily-routine — visible on screen (fridge sheet) */
#daily-routine {{
  margin: 0 var(--s7) var(--s6);
  padding: var(--s5) var(--s5) var(--s4);
  background: var(--paper);
  border: 1px solid var(--line); border-radius: var(--radius);
  box-shadow: var(--shadow);
}}
.routine-header {{
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px; flex-wrap: wrap; margin-bottom: 16px;
}}
.routine-title {{ font-family: var(--serif); font-size: 21px; font-weight: 700; color: var(--forest); margin: 0 0 6px; }}
.routine-subtitle {{ font-size: 12.5px; color: var(--muted); margin: 0; max-width: 32em; line-height: 1.55; }}
.routine-track {{ display: flex; flex-direction: column; }}

/* Legacy routine rows (API-generated letters) */
.routine-row {{
  display: flex; gap: 16px; padding: 12px 0;
  border-bottom: 1px dashed var(--line); align-items: flex-start;
}}
.routine-row:last-child {{ border-bottom: none; }}
.routine-anchor {{ flex: 0 0 110px; display: flex; flex-direction: column; gap: 1px; }}
.routine-emoji  {{ font-size: 19px; }}
.routine-label  {{ font-weight: 700; font-size: 13px; color: var(--forest); }}
.routine-time   {{ font-size: 10px; color: var(--faint); font-family: "Courier New", monospace; }}
.routine-body   {{ flex: 1; min-width: 0; }}
.routine-activity {{ font-size: 13px; color: var(--ink); margin-bottom: 5px; }}
.routine-supp      {{ font-size: 12.5px; color: #3a4250; margin-top: 3px; line-height: 1.4; }}
.routine-supp-dose {{ color: var(--muted); font-size: 11.5px; }}
.routine-supp-tag  {{ color: var(--ochre); font-size: 11px; }}
.routine-supp-none {{ color: var(--faint); font-style: italic; font-size: 11.5px; }}
.routine-prn {{
  margin-top: 16px; padding: 14px 16px;
  background: var(--ochre-wash); border: 1px dashed var(--ochre-2); border-radius: 12px;
}}
.routine-prn-head {{ font-size: 13px; font-weight: 700; color: var(--ochre); margin-bottom: 4px; }}
.routine-prn-note {{ font-size: 11.5px; color: var(--muted); line-height: 1.55; margin: 0 0 8px; }}
.routine-prn-when {{ color: var(--ochre); font-size: 11px; font-style: italic; }}
.routine-foot  {{ font-size: 11.5px; color: var(--muted); margin-top: 14px; line-height: 1.55; }}

/* New .rrow system (Nidhi-style chat-ingest letters) */
.routine__list {{ position: relative; }}
.routine__list::before {{
  content: ""; position: absolute; left: 25px; top: 14px; bottom: 14px;
  width: 2px; background: linear-gradient(180deg, var(--ochre-2), var(--forest-2)); opacity: .32;
}}
.rrow {{
  position: relative; display: grid;
  grid-template-columns: 52px 128px 1fr;
  gap: var(--s3) var(--s4); align-items: center;
  padding: var(--s3) 0; border-bottom: 1px solid var(--line);
}}
.rrow:last-child {{ border-bottom: 0; }}
.rrow__anchor {{
  width: 52px; height: 52px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; font-size: 22px;
  background: var(--paper); border: 2px solid var(--line-strong); z-index: 1;
  box-shadow: 0 0 0 5px var(--paper);
}}
.rrow__when {{ display: flex; flex-direction: column; gap: 1px; }}
.rrow__when .label {{ font-family: var(--serif); font-weight: 700; color: var(--forest); font-size: 16px; }}
.rrow__when .time  {{ font-size: 12.5px; color: var(--faint); font-variant-numeric: tabular-nums; }}
.rrow__take {{ display: flex; flex-wrap: wrap; gap: 8px; }}
.pill {{
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 13px; color: var(--ink); background: var(--paper-2);
  border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px;
}}
.pill::before {{ content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--forest-2); flex: none; }}
.rrow__take .none {{ font-size: 13px; color: var(--faint); font-style: italic; }}

/* ============================================================
   9. SUPPLEMENT SCHEDULE
   — display:none by default (coach feedback: "schedule should
     print via button only"). Shown by body[data-print-supplement].
   — Shopping list (#supplement-shopping-list) stays visible.
   ============================================================ */
#supplement-schedule {{ display: none; }}
body[data-print-supplement] #supplement-schedule {{
  display: block; margin: var(--s7) 0 0; padding-top: var(--s6);
  border-top: 1.5px solid var(--forest);
}}

.schedule-header {{
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px; margin-bottom: 28px; flex-wrap: wrap;
}}
.schedule-title {{ font-family: var(--serif); font-size: 22px; font-weight: 700; color: var(--forest); margin: 0 0 6px; }}
.schedule-subtitle {{ font-size: 13px; color: var(--muted); line-height: 1.55; max-width: 520px; }}

/* Timeline cards (legacy slot-based layout) */
.timeline-track {{
  display: flex; gap: 12px; overflow-x: auto; padding-bottom: 12px;
  margin-bottom: 32px; scroll-snap-type: x mandatory;
}}
.timeline-slot {{
  flex: 0 0 auto; min-width: 140px; background: var(--paper);
  border: 1px solid var(--line); border-radius: var(--radius);
  padding: 14px 14px 12px; scroll-snap-align: start;
}}
.timeline-slot-label {{
  font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase;
  color: var(--forest); margin-bottom: 10px; white-space: nowrap;
}}
.supp-pills {{ display: flex; flex-direction: column; gap: 6px; }}
.supp-pill {{
  background: var(--paper-2); border: 1px solid var(--line);
  border-radius: 20px; padding: 4px 10px; font-size: 11.5px; color: var(--ink); line-height: 1.4;
}}
.supp-pill-name {{ font-weight: 500; }}
.supp-pill-dose {{ display: block; font-size: 10.5px; color: var(--muted); margin-top: 1px; }}
.supp-pill-week {{ display: inline-block; font-size: 9.5px; font-weight: 600; color: var(--ochre);
                   background: var(--ochre-wash); border-radius: 6px; padding: 0 5px; margin-top: 2px; }}

/* Schedule table */
.schedule-table-wrap {{ overflow-x: auto; margin-top: 4px; }}
.schedule-table {{ width: 100%; border-collapse: collapse; font-size: 13.5px; }}
.schedule-table th {{
  text-align: left; font-size: 11px; font-weight: 600; letter-spacing: .05em;
  text-transform: uppercase; color: var(--muted); border-bottom: 1.5px solid var(--forest);
  padding: 6px 10px 8px;
}}
.schedule-table td {{
  vertical-align: top; padding: 10px; border-bottom: 1px solid var(--line); line-height: 1.5;
}}
.schedule-table tr:last-child td {{ border-bottom: none; }}

.slot-chip {{
  display: inline-block; background: var(--forest-wash); border-radius: 4px;
  padding: 2px 8px; font-size: 11.5px; white-space: nowrap;
  color: var(--forest); font-weight: 500;
}}

/* New .slot system (Nidhi-style schedule table) */
.supp-table {{ width: 100%; border-collapse: collapse; font-size: 14.5px; min-width: 540px; }}
.supp-table thead th {{
  text-align: left; font-family: var(--sans); font-weight: 600; color: var(--forest);
  font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
  padding: 0 var(--s3) 10px; border-bottom: 1.5px solid var(--line-strong); white-space: nowrap;
}}
.supp-table tbody td {{ padding: 13px var(--s3); border-bottom: 1px solid var(--line); vertical-align: middle; }}
.supp-table tbody tr:last-child td {{ border-bottom: 0; }}
.supp-table .name  {{ font-weight: 600; color: var(--forest); }}
.supp-table .name small {{ display: block; font-weight: 400; color: var(--faint); font-size: 12px; margin-top: 1px; }}
.supp-table .dose  {{ font-variant-numeric: tabular-nums; white-space: nowrap; }}
.supp-table .dur   {{ color: var(--muted); white-space: nowrap; }}

.slot {{
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12.5px; font-weight: 600; padding: 4px 11px;
  border-radius: 999px; white-space: nowrap;
}}
.slot::before {{ content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .9; }}
.slot--morning {{ background: var(--slot-morning-bg); color: var(--slot-morning-fg); }}
.slot--midday  {{ background: var(--slot-midday-bg);  color: var(--slot-midday-fg); }}
.slot--evening {{ background: var(--slot-evening-bg); color: var(--slot-evening-fg); }}
.slot--night   {{ background: var(--slot-night-bg);   color: var(--slot-night-fg); }}

.rationale-cell {{ max-width: 240px; font-size: 12.5px; color: var(--muted); }}
.buy-cell {{ min-width: 160px; font-size: 12.5px; }}
.buy-cell a {{ color: var(--forest); font-weight: 500; }}
.buy-cell a:hover {{ text-decoration: underline; }}

.buy {{
  display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
  letter-spacing: .01em; color: var(--forest-2); background: transparent;
  border: 1px solid var(--line-strong); border-radius: 6px; padding: 4px 10px;
  text-decoration: none; transition: border-color .18s ease, background .18s ease, color .18s ease;
}}
.buy:hover {{ border-color: var(--forest-2); background: var(--forest-wash); color: var(--forest); }}
.buy::before {{ content: ""; width: 7px; height: 7px; border-radius: 2px; background: var(--ochre); flex: none; }}
.buy--amazon::before {{ background: #b06d23; }}
.buy--iherb::before  {{ background: #2f6a3c; }}
.buy--vitaone::before{{ background: #46507e; }}

/* Legacy buy badges */
.buy-badge {{ display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 10px;
              font-weight: 600; letter-spacing: .03em; margin-left: 4px; vertical-align: middle; }}
.buy-badge-vitaone {{ background: #d4edda; color: #155724; }}
.buy-badge-amazon  {{ background: #fff3cd; color: #856404; }}
.buy-badge-iherb   {{ background: #cce5ff; color: #004085; }}

.legend {{
  display: flex; flex-wrap: wrap; gap: var(--s2) var(--s4);
  margin-top: var(--s4); padding-top: var(--s4); border-top: 1px solid var(--line);
  font-size: 12.5px; color: var(--muted);
}}
.legend span {{ display: inline-flex; align-items: center; gap: 7px; }}
.legend i {{ width: 9px; height: 9px; border-radius: 50%; display: inline-block; }}

/* table-wrap (supp + shop tables in .block) */
.table-wrap {{ overflow-x: auto; -webkit-overflow-scrolling: touch; }}

/* ============================================================
   10. SHOPPING LIST
   — Both legacy #supplement-shopping-list and new .block.shopping
   ============================================================ */
#supplement-shopping-list {{
  margin: var(--s7) var(--s7) 0;
  padding: var(--s5);
  background: linear-gradient(180deg, var(--paper-2) 0%, var(--ochre-wash) 100%);
  border: 1.5px solid var(--ochre-2); border-radius: var(--radius);
}}
.shop-header {{ margin-bottom: 16px; }}
.shop-title {{ font-family: var(--serif); font-size: 21px; font-weight: 700; color: var(--forest); margin: 0 0 6px; }}
.shop-subtitle {{ font-size: 13px; color: var(--muted); line-height: 1.55; margin: 0; }}
.shop-note-later {{
  margin: 12px 0 0; padding: 8px 12px;
  background: rgba(162,101,31,.12); border-left: 3px solid var(--ochre-2);
  border-radius: 4px; font-size: 12.5px; color: #6f4f1a; line-height: 1.55;
}}
.shop-table-wrap {{ overflow-x: auto; margin-top: 8px; }}
.shop-table {{ width: 100%; border-collapse: collapse; font-size: 14.5px; min-width: 540px; }}
.shop-table thead th {{
  text-align: left; font-weight: 600; color: var(--forest); font-size: 11px;
  letter-spacing: .08em; text-transform: uppercase; padding: 0 var(--s3) 10px;
  border-bottom: 1.5px solid var(--line-strong); white-space: nowrap;
}}
.shop-table tbody td {{ padding: 13px var(--s3); border-bottom: 1px solid var(--line); vertical-align: middle; }}
.shop-table tbody tr:last-child td {{ border-bottom: 0; }}
.shop-table .ck   {{ width: 30px; }}
.shop-table .num  {{ width: 30px; color: var(--faint); font-variant-numeric: tabular-nums; font-weight: 600; }}
.shop-table .name {{ font-weight: 600; color: var(--forest); }}
.shop-table .dose {{ font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--muted); }}
.shop-num {{ font-family: monospace; color: var(--muted); width: 28px; text-align: center; }}
.box {{
  width: 19px; height: 19px; border: 2px solid var(--line-strong);
  border-radius: 5px; display: inline-block; vertical-align: middle; background: var(--paper);
}}
.phase-chip {{ display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10.5px; font-weight: 700; white-space: nowrap; }}
.phase-now   {{ background: #d4edda; color: #155724; }}
.phase-later {{ background: var(--ochre-wash); color: #8a4a14; }}
.week-chip {{
  display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
  padding: 4px 11px; border-radius: 999px; white-space: nowrap;
}}
.week-chip::before {{ content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }}
.week-chip--now {{ background: var(--ochre-wash); color: var(--ochre); }}
.week-chip--w3  {{ background: var(--forest-wash); color: var(--forest-2); }}
.week-chip--w5  {{ background: var(--slot-evening-bg); color: var(--slot-evening-fg); }}
.shop-note {{
  display: flex; gap: 10px; align-items: flex-start; margin-top: var(--s4);
  padding: var(--s3) var(--s4); background: var(--ochre-wash);
  border-radius: var(--radius-sm); font-size: 13.5px; color: #7a4f15; max-width: none;
}}
.shop-note b {{ color: #7a4f15; }}
.shop-disclaimer {{ margin: 14px 0 0; font-size: 11.5px; color: var(--muted); line-height: 1.55; }}

/* ============================================================
   11. SIGN-OFF / FOOTER (replaces .brand-footer)
   ============================================================ */
.signoff {{ padding: var(--s5) var(--s7) 0; max-width: none; }}
.signoff .hr {{ width: 44px; height: 2px; background: var(--ochre); border-radius: 2px; margin-bottom: var(--s4); }}
.signoff p {{ color: var(--muted); max-width: 56ch; }}
.signoff .name {{ font-family: var(--script); font-size: 26px; color: var(--forest-2); margin: var(--s3) 0 2px; }}
.signoff .role {{ font-size: 13px; color: var(--faint); }}
.signoff .contact {{ font-size: 12px; color: var(--muted); margin-top: var(--s3); line-height: 1.8; }}
.signoff .contact a {{ color: var(--forest-2); }}

/* Legacy brand-footer — kept for backward compat */
.brand-footer {{
  margin-top: var(--s7); padding-top: var(--s4); border-top: 1.5px solid var(--forest);
  display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;
  padding-left: var(--s7); padding-right: var(--s7); padding-bottom: var(--s5);
}}
.brand-footer .name {{ font-family: var(--serif); font-size: 15px; color: var(--forest); font-style: italic; margin-bottom: 3px; }}
.brand-footer .tagline {{ font-size: 11px; color: var(--muted); letter-spacing: .05em; }}
.brand-footer .contact {{ font-size: 11px; color: var(--muted); text-align: right; line-height: 1.8; }}
.brand-footer .contact a {{ color: var(--forest); text-decoration: none; }}

/* ============================================================
   12. START-DATE CONFIRM BUTTONS (WhatsApp deep links)
   ============================================================ */
.start-buttons-panel {{
  margin: 0 var(--s7) var(--s5);
  padding: 18px 20px;
  background: linear-gradient(135deg, rgba(74,97,82,.07), rgba(162,101,31,.06));
  border: 1px solid rgba(74,97,82,.18); border-radius: var(--radius);
}}
.start-buttons-heading {{ font-family: var(--serif); font-size: 20px; font-weight: 700; color: var(--forest); margin: 0 0 4px; }}
.start-buttons-sub {{ font-size: 13px; color: var(--muted); margin: 0 0 14px; line-height: 1.5; }}
.start-buttons-sub strong {{ color: var(--forest); font-weight: 600; }}
.start-buttons-row {{ display: flex; gap: 10px; flex-wrap: wrap; }}
.start-btn {{
  display: inline-flex; align-items: center; gap: 10px; padding: 12px 16px;
  border-radius: 10px; text-decoration: none !important; color: white !important;
  font-size: 14px; line-height: 1.3; transition: transform 80ms ease;
  flex: 1 1 220px; min-height: 56px;
}}
.start-btn:hover {{ transform: translateY(-1px); }}
.start-btn-icon  {{ font-size: 22px; flex-shrink: 0; }}
.start-btn-body  {{ display: flex; flex-direction: column; gap: 1px; text-align: left; }}
.start-btn-body small {{ font-size: 11px; opacity: .85; font-weight: 400; }}
.start-btn-confirm {{ background: #059669; }}
.start-btn-confirm:hover {{ background: #047857; }}
.start-btn-edit    {{ background: #5a7563; }}
.start-btn-edit:hover {{ background: #4a6152; }}
.start-btn-supps   {{ background: var(--ochre); }}
.start-btn-supps:hover {{ background: var(--ochre-2); }}

/* ============================================================
   13. PER-WEEK PRINT BAR
   ============================================================ */
.week-print-bar {{
  display: flex; gap: 10px; flex-wrap: wrap; margin: 0 0 28px;
  padding: 14px 18px; background: rgba(74,97,82,.04);
  border: 1px solid rgba(74,97,82,.12); border-radius: var(--radius); align-items: center;
}}
.week-print-bar-label {{
  font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: .04em;
  text-transform: uppercase; margin-right: 4px; flex-shrink: 0;
}}
.week-print-btn {{
  display: inline-flex; align-items: center; gap: 6px; padding: 7px 16px;
  background: var(--forest); color: #fff; border: none; border-radius: 4px;
  font-size: 13px; font-family: var(--sans); font-weight: 500;
  cursor: pointer; letter-spacing: .01em; transition: background .15s;
}}
.week-print-btn:hover {{ background: var(--forest-2); }}

/* ============================================================
   14. PRINT-ONLY CLIENT NAME / PAGE FOOTER
   ============================================================ */
.print-page-footer {{ display: none; }}
.print-client-name {{ display: none; }}
.no-print-buttons  {{ /* visible on screen */ }}
.no-print          {{ /* visible on screen */ }}

/* ============================================================
   15. MOBILE RESPONSIVE
   ============================================================ */

/* ── 680px: collapse block heads, enlarge touch targets ── */
@media (max-width: 680px) {{
  .masthead {{ padding: var(--s6) var(--s4) var(--s5); }}
  .masthead__phase {{ font-size: 28px; }}
  .content {{ padding: var(--s6) var(--s4) var(--s4); }}
  .block {{ margin: 0 var(--s4) var(--s5); }}
  .block__head {{ flex-direction: column; padding: var(--s4); }}
  .block__body {{ padding: var(--s4); }}
  #supplement-shopping-list {{ margin: var(--s5) var(--s4) 0; padding: var(--s4); }}
  .signoff {{ padding: var(--s5) var(--s4) 0; }}
  .brand-footer {{ padding-left: var(--s4); padding-right: var(--s4); }}
  .start-buttons-panel {{ margin: 0 var(--s4) var(--s4); }}
  /* Enlarge print buttons for tap */
  .print-btn {{ padding: 12px 18px; min-height: 44px; }}
  .print-btn--sm {{ padding: 10px 14px; min-height: 44px; }}
}}

/* ── 600px: main phone breakpoint ── */
@media (max-width: 600px) {{
  html {{ font-size: 15px; }}
  .masthead {{ padding: var(--s5) var(--s3) var(--s4); }}
  .masthead__top {{ flex-direction: column; align-items: flex-start; gap: 10px; margin-bottom: var(--s4); }}
  .masthead__date {{ text-align: left; }}
  .masthead__phase {{ font-size: 24px; }}

  /* Legacy .page shell */
  .page {{ padding: 24px 16px 48px; }}
  .brand-header {{ flex-direction: column; align-items: flex-start; gap: 12px; padding: 20px 16px; }}
  .brand-logo {{ height: 64px; max-width: 200px; }}
  .doc-meta {{ text-align: left; }}
  .doc-title-block {{ margin: 0 16px var(--s4); }}
  .doc-title-block h1 {{ font-size: 24px; }}

  /* Body prose */
  .content {{ padding: var(--s5) var(--s3) var(--s4); }}
  .content p, .content ul, .content ol {{ font-size: 14px; }}
  .content li {{ margin-bottom: 8px; }}

  /* Meal plan tables */
  .content table {{ font-size: 12px; display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; white-space: nowrap; }}
  .content th {{ padding: 8px 10px; font-size: 10px; white-space: nowrap; }}
  .content td {{ padding: 8px 10px; font-size: 12px; white-space: normal; min-width: 90px; }}

  /* Routine rows */
  .routine-row {{ flex-direction: column; gap: 6px; padding: 10px 0; }}
  .routine-anchor {{ flex: none; width: 100%; flex-direction: row; align-items: center; gap: 8px; }}
  .routine-body {{ width: 100%; }}
  .routine-activity {{ font-size: 13px; }}
  .routine-supp {{ font-size: 12px; }}

  /* New .rrow — collapse to 2-col */
  .rrow {{ grid-template-columns: 46px 1fr; }}
  .rrow__when {{ grid-column: 2; }}
  .rrow__take {{ grid-column: 2; }}
  .routine__list::before {{ left: 22px; }}
  .rrow__anchor {{ width: 46px; height: 46px; font-size: 20px; }}

  /* Timeline slots */
  .timeline-slot {{ min-width: 110px; padding: 10px 10px 9px; }}
  .timeline-slot-label {{ font-size: 10px; }}
  .supp-pill {{ font-size: 11px; padding: 4px 8px; }}

  /* Schedule header */
  .schedule-header {{ flex-direction: column; gap: 10px; }}
  .schedule-title {{ font-size: 18px; }}

  /* Shopping list */
  #supplement-shopping-list {{ margin: var(--s4) 0 0; padding: var(--s4) var(--s3); }}
  .shop-title {{ font-size: 18px; }}
  .shop-table {{ font-size: 12px; }}
  .shop-table th {{ font-size: 10px; padding: 7px 8px; }}
  .shop-table td {{ padding: 8px 8px; }}

  /* Per-week print bar */
  .week-print-bar {{ flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px 14px; }}
  .week-print-btn {{ padding: 10px 16px; font-size: 13px; min-height: 44px; width: 100%; justify-content: center; }}

  /* Sign-off */
  .signoff {{ padding: var(--s4) var(--s3) 0; }}
  .brand-footer {{ flex-direction: column; gap: 12px; margin-top: var(--s6); padding-left: var(--s3); padding-right: var(--s3); }}
  .brand-footer .contact {{ text-align: left; }}

  /* Start-date buttons */
  .start-btn {{ flex: 1 1 100%; min-height: 52px; }}
  .start-buttons-panel {{ margin: 0 0 var(--s4); padding: 14px; }}
}}

/* ── 560px: reference tables, scroll hints ── */
@media (max-width: 560px) {{
  .reftable, .ferment-table {{
    display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%;
  }}
  .table-wrap::after {{
    content: "← scroll →"; display: block; font-size: 11px;
    color: var(--faint); text-align: center; margin-top: 4px; letter-spacing: .04em;
  }}
}}

/* ── 480px: body font shrink ── */
@media (max-width: 480px) {{
  body {{ font-size: 15px; }}
}}

/* ── 400px: very narrow ── */
@media (max-width: 400px) {{
  .page {{ padding: 20px 12px 40px; }}
  .brand-logo {{ height: 56px; max-width: 160px; }}
  .content table {{ font-size: 11px; }}
  .content th {{ padding: 7px 8px; font-size: 9.5px; }}
  .content td {{ padding: 6px 8px; font-size: 11px; min-width: 80px; }}
  .doc-title-block h1 {{ font-size: 20px; }}
  .timeline-slot {{ min-width: 96px; padding: 8px 8px 7px; }}
}}

/* ============================================================
   16. PRINT
   ============================================================ */
@media print {{
  @page {{ size: A4; margin: 0; }}

  body {{ background: #fff; }}
  .letter {{ box-shadow: none; margin: 0; max-width: none; padding-bottom: 22mm; }}
  .page  {{ padding: 15mm 14mm 22mm; max-width: 100%; }}

  /* Hide screen UI */
  .no-print {{ display: none !important; }}
  .no-print-buttons {{ display: none !important; }}
  .week-print-bar {{ display: none !important; }}
  .print-btn {{ display: none !important; }}

  /* Masthead print */
  .masthead {{ background: #fff !important; }}

  /* Link URL suppression */
  a, a::after, a::before {{ text-decoration: none !important; }}
  a[href]::after {{ content: none !important; }}
  abbr[title]::after {{ content: none !important; }}

  /* Meal plan tables */
  .content table {{ font-size: 10px; page-break-inside: avoid; width: 100%; table-layout: fixed; }}
  .content th {{ font-size: 9px; padding: 6px 5px; }}
  .content td {{ padding: 5px; font-size: 10px; line-height: 1.4; word-wrap: break-word; }}

  /* Headings — avoid orphan headings; h1 starts new page only for
     full-letter mode (overridden to avoid in per-week/section modes above) */
  h1, h2, h3 {{ page-break-after: avoid; }}
  h2 {{ page-break-before: avoid; }}
  h1:first-of-type {{ page-break-before: avoid; }}

  /* Supplement schedule + shopping tables must never spill off the page
     in any print mode — fixed layout + wrap, drop the screen min-width,
     and disable the screen overflow-x scroll wrapper (no scrolling on paper). */
  .schedule-table, .shop-table {{ table-layout: fixed !important; width: 100% !important; min-width: 0 !important; }}
  .schedule-table th, .schedule-table td,
  .shop-table th, .shop-table td {{ word-wrap: break-word; overflow-wrap: anywhere; }}
  .schedule-table-wrap, .shop-table-wrap, .table-wrap {{ overflow: visible !important; }}

  /* Supplement schedule — page break, no buy column */
  #supplement-schedule {{ page-break-before: always; }}
  .timeline-track {{ overflow: visible; flex-wrap: wrap; }}
  .buy-cell, .buy {{ display: none; }}
  .schedule-table th:last-child {{ display: none; }}
  .buy-badge {{ display: none; }}

  /* Fixed contact footer — every printed page */
  .print-page-footer {{
    display: block; position: fixed; bottom: 0; left: 0; right: 0;
    padding: 5px 14mm; font-size: 9px; color: {FAINT}; text-align: center;
    border-top: 0.5px solid rgba(74,97,82,.25); background: #fff;
    font-family: var(--sans, Arial, sans-serif); letter-spacing: .03em;
  }}

  /* Client name above each week — print only */
  .print-client-name {{
    display: block; font-size: 10px; letter-spacing: .12em;
    text-transform: uppercase; color: {MUTED};
    margin-bottom: 2px; font-family: var(--sans, Arial, sans-serif);
  }}

  /* ── Per-week isolation ──
     body[data-print-week="N"] prints only the target week-section.
     Masthead, footer, and all other sections are hidden to maximise
     vertical space — learned from Nidhi letter print testing. */

  /* 1. Hide all non-week chrome (masthead takes ~120px, content padding
        wastes another 96px — both must go for 7-day table to fit A4) */
  body[data-print-week] .masthead {{ display: none !important; }}
  body[data-print-week] .signoff {{ display: none !important; }}
  body[data-print-week] .brand-footer {{ display: none !important; }}
  body[data-print-week] #supplement-schedule {{ display: none !important; }}
  body[data-print-week] #supplement-shopping-list {{ display: none !important; }}
  body[data-print-week] #daily-routine {{ display: none !important; }}

  /* 2. Zero wrapper padding/margin so the week table starts at the top */
  body[data-print-week] .letter {{ padding-bottom: 0 !important; }}
  body[data-print-week] .content {{ padding: 8px 10px !important; }}

  /* 3. Suppress h1 page-break so week heading doesn't force a new page */
  body[data-print-week] h1 {{ page-break-before: avoid !important; }}

  /* 4. Show only the target week-section */
  body[data-print-week] .content > *:not(.week-section) {{ display: none !important; }}
  body[data-print-week="1"] .week-section:not(#print-week-1) {{ display: none !important; }}
  body[data-print-week="2"] .week-section:not(#print-week-2) {{ display: none !important; }}
  body[data-print-week="3"] .week-section:not(#print-week-3) {{ display: none !important; }}
  body[data-print-week="4"] .week-section:not(#print-week-4) {{ display: none !important; }}
  body[data-print-week="5"] .week-section:not(#print-week-5) {{ display: none !important; }}

  /* 5. Single-week density — compact tables to fit one A4 page */
  body[data-print-week] .content table {{ font-size: 9px; line-height: 1.25; page-break-inside: avoid; width: 100%; table-layout: fixed; }}
  body[data-print-week] .content th {{ font-size: 8.5px; padding: 3px 4px; white-space: normal; }}
  body[data-print-week] .content td {{ font-size: 9px; padding: 3px 4px; line-height: 1.25; word-wrap: break-word; }}
  body[data-print-week] .week-section {{ page-break-inside: avoid; margin: 0 !important; }}
  body[data-print-week] .week-section h2 {{ font-size: 13px; margin: 0 0 6px; padding-top: 0; border: none; }}

  /* ── Supplement schedule isolation ──
     body[data-print-supplement] shows only #supplement-schedule */
  body[data-print-supplement] .letter > .masthead,
  body[data-print-supplement] .page > .doc-title-block,
  body[data-print-supplement] .content,
  body[data-print-supplement] #supplement-shopping-list,
  body[data-print-supplement] .brand-footer,
  body[data-print-supplement] .signoff {{ display: none !important; }}
  body[data-print-supplement] #supplement-schedule {{
    page-break-before: avoid !important;
    /* Supply page margins here — no .page wrapper to lean on. */
    margin: 0 !important; padding: 8mm 14mm 0 !important; border-top: none !important;
    display: block !important;
  }}
  body[data-print-supplement] .schedule-subtitle,
  body[data-print-supplement] .timeline-track {{ display: none !important; }}
  body[data-print-supplement] .schedule-table thead th:nth-child(4),
  body[data-print-supplement] .schedule-table tbody td:nth-child(4) {{ display: none !important; }}
  body[data-print-supplement] .schedule-title {{ font-size: 18px; margin-bottom: 4px; }}
  body[data-print-supplement] .schedule-table {{ font-size: 11px; page-break-inside: avoid; }}
  body[data-print-supplement] .schedule-table th {{ font-size: 10px; padding: 6px 8px; }}
  body[data-print-supplement] .schedule-table td {{ padding: 5px 8px; line-height: 1.35; }}

  /* ── Daily Routine isolation ──
     body[data-print-routine] shows only #daily-routine (fridge sheet) */
  body[data-print-routine] .letter > .masthead,
  body[data-print-routine] .page > .doc-title-block,
  body[data-print-routine] .content,
  body[data-print-routine] #supplement-shopping-list,
  body[data-print-routine] #supplement-schedule,
  body[data-print-routine] .brand-footer,
  body[data-print-routine] .signoff {{ display: none !important; }}
  body[data-print-routine] #daily-routine {{
    margin: 0 !important; border: none !important;
    /* No .page wrapper exists in this template, so the section itself must
       supply the page margins — otherwise the routine prints edge-to-edge. */
    background: #fff !important; padding: 8mm 14mm 0 !important;
  }}
  body[data-print-routine] .routine-subtitle,
  body[data-print-routine] .routine-foot {{ display: none !important; }}
  body[data-print-routine] .routine-header {{ margin-bottom: 6px !important; }}
  body[data-print-routine] .routine-title {{ font-size: 16px !important; margin: 0 !important; }}
  body[data-print-routine] #daily-routine {{ font-size: 11px !important; line-height: 1.3 !important; }}
  body[data-print-routine] .routine-row {{ padding: 6px 0 !important; page-break-inside: avoid; }}
  body[data-print-routine] .routine-emoji {{ font-size: 15px !important; }}
  /* Nidhi-style .rrow in routine block */
  body[data-print-routine] .block.routine {{ margin: 0 !important; border: none !important; box-shadow: none !important; }}
  body[data-print-routine] .block__head {{ padding: 10px 20px 6px !important; }}
  body[data-print-routine] .block__body {{ padding: 8px 20px 12px !important; }}
  body[data-print-routine] .rrow {{ padding: 8px 0 !important; break-inside: avoid; }}

  /* ── Block printing (Nidhi-style schedule / shopping) ── */
  .block, .checkin, .callout {{ break-inside: avoid; }}
  .slot, .buy, .pill, .week-chip, .day-card__head {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
}}

/* ════════════════════════════════════════════════════════════
   MEAL PLAN — day cards (from Claude Design Ochre Tree bundle)
   Replaces dense markdown tables with a recipe-card grid.
   Converted from markdown via _convert_meal_tables_to_day_cards().
   ════════════════════════════════════════════════════════════ */
.meal-plan {{ margin: 28px 0 24px; }}
.meal-grid {{ display: grid; gap: 16px; grid-template-columns: 1fr; }}
@media (min-width: 620px) {{ .meal-grid {{ grid-template-columns: 1fr 1fr; }} }}
.day-card {{
  border: 1px solid {LINE};
  border-radius: 8px;
  background: {PAPER};
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(38,34,25,.03), 0 6px 18px rgba(74,97,82,.06);
}}
.day-card__head {{
  display: flex; align-items: baseline; gap: 10px;
  padding: 11px 24px; background: {FOREST}; color: #fff;
}}
.day-card__head .dow {{ font-family: Georgia, "Iowan Old Style", "Noto Serif", "Times New Roman", serif; font-weight: 700; font-size: 16px; }}
.day-card__head .date {{ font-size: 12px; color: rgba(255,255,255,.78); margin-left: auto; }}
.day-card__body {{ padding: 6px 24px 18px; }}
.meal-row {{
  display: grid; grid-template-columns: 78px 1fr; gap: 16px;
  padding: 11px 0; border-bottom: 1px solid {LINE}; align-items: start;
}}
.meal-row:last-child {{ border-bottom: 0; }}
.meal-row .ml {{
  font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase;
  font-weight: 700; color: {OCHRE}; padding-top: 2px;
}}
.meal-row .md {{ font-size: 14.5px; line-height: 1.45; color: {INK}; }}

/* "Every day · both weeks" highlight card (anchors / standing items) */
.day-card.everyday {{ background: {FOREST_W}; border-color: #cfe0d2; margin-top: 24px; }}
.day-card.everyday .day-card__head {{ background: {OCHRE}; }}

/* Week group header — sits above each meal-grid */
.weekgroup {{ margin: 0 0 48px; }}
.weekgroup:last-child {{ margin-bottom: 0; }}
.weekgroup__head {{
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  margin: 0 0 24px; padding-bottom: 16px;
  border-bottom: 1px solid {LINE};
}}
.weekgroup__no {{ font-family: Georgia, "Iowan Old Style", "Noto Serif", "Times New Roman", serif; font-weight: 700; color: {FOREST}; font-size: 19px; }}
.weekgroup__dates {{ font-size: 13px; color: {FAINT}; margin-left: 10px; }}

/* Day cards should never break across print pages */
@media print {{
  .day-card, .weekgroup {{ break-inside: avoid; }}
  .day-card__head {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
}}
"""


def _start_date_buttons_html(
    meal_start_ymd,
    supplements_start_ymd,
    plan_slug,
    letter_type,
    coach_phone_e164: str = "918976563971",
    include_supplements: bool = False,
) -> str:
    """Inject WhatsApp confirm/edit start-date buttons into the letter."""
    if not meal_start_ymd:
        return ""
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
    confirm_text = f"✅ START: {meal_start_ymd}{slug_tag}"
    confirm_url  = f"https://wa.me/{coach_phone_e164}?text={quote(confirm_text)}"
    edit_text    = "📅 I'd like to start my plan on a different day — I'll start on "
    edit_url     = f"https://wa.me/{coach_phone_e164}?text={quote(edit_text)}"

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
        supp_url  = f"https://wa.me/{coach_phone_e164}?text={quote(supp_text)}"
        buttons.append(
            f'<a class="start-btn start-btn-supps" href="{supp_url}" target="_blank" rel="noopener">'
            f'<span class="start-btn-icon">📦</span>'
            f'<span class="start-btn-body"><strong>My supplements have arrived</strong>'
            f'<small>Tap when they land — I&rsquo;ll start the count</small></span></a>'
        )

    return f"""
    <div class="start-buttons-panel no-print-buttons" aria-label="Confirm your start date">
      <div class="start-buttons-heading">📅 Confirm your Day 1</div>
      <div class="start-buttons-sub">Your Day 1 is set to <strong>{meal_human}</strong>. Tap to confirm or pick a different day.</div>
      <div class="start-buttons-row">
        {''.join(buttons)}
      </div>
    </div>
    """


def wrap_in_brand_html(
    markdown_content: str,
    title: str,
    subtitle: str = "",
    doc_type: str = "Personalised Health Plan",
    client_name: str = "",
    meal_start_ymd=None,
    supplements_start_ymd=None,
    plan_slug=None,
    letter_type=None,
    recipes_link_id=None,
) -> str:
    """Wrap markdown content in the Ochre Tree brand template.

    Generates a standalone HTML file with:
    - New Ochre Tree masthead (tree SVG + brandmark, system fonts, no CDN)
    - Converted markdown body in .content
    - Sign-off footer with contact details
    - Full print isolation CSS for week/supplement/routine sections
    - Recipe linking JS
    - Per-week print bar JS
    """
    import html as _html_mod

    # Try real logo first (backward compat), fall back to inline SVG
    logo_uri = _logo_data_uri()
    if logo_uri:
        brandmark_logo_tag = f'<img src="{logo_uri}" alt="The Ochre Tree" class="brandmark__logo" style="border-radius:0">'
    else:
        brandmark_logo_tag = _LOGO_SVG

    safe_client_name = _html_mod.escape(client_name or "", quote=True)

    body_html = _add_target_blank(
        _wrap_no_print_sections(
            _wrap_week_sections(
                # Day-card conversion runs FIRST (on raw markdown HTML)
                # so the resulting day-card grids get wrapped by the week
                # section divs that _wrap_week_sections adds — needed for
                # the per-week print isolation.
                _convert_meal_tables_to_day_cards(
                    _md_to_html(markdown_content)
                )
            )
        )
    )
    today = date.today().strftime("%-d %B %Y")

    include_supps = (letter_type or "") in ("supplement_plan", "consolidated")
    start_buttons_html = _start_date_buttons_html(
        meal_start_ymd=meal_start_ymd,
        supplements_start_ymd=supplements_start_ymd,
        plan_slug=plan_slug,
        letter_type=letter_type,
        include_supplements=include_supps,
    )

    subtitle_html = (
        f'<p class="masthead__lede">{subtitle}</p>' if subtitle else ""
    )
    client_meta_html = ""
    if client_name:
        client_meta_html = (
            f'<div class="masthead__meta"><span>Prepared for <b>{_html_mod.escape(client_name)}</b></span></div>'
        )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{_html_mod.escape(title)} — The Ochre Tree</title>
  <style>{_CSS}</style>
</head>
<body data-client-name="{safe_client_name}">
<div class="letter">

  <!-- ═══════════ MASTHEAD ═══════════ -->
  <header class="masthead">
    {_TREE_SVG_BG}
    <div class="masthead__top">
      <div class="brandmark">
        {brandmark_logo_tag}
        <div>
          <div class="brandmark__name">The Ochre Tree</div>
          <div class="brandmark__tag">Functional medicine · Shivani Hari</div>
        </div>
      </div>
      <div class="masthead__date">
        <span class="masthead__doc-type">{doc_type}</span>
        {today}
      </div>
    </div>

    <h1 class="masthead__phase">{_html_mod.escape(title)}</h1>
    {subtitle_html}
    {client_meta_html}
  </header>

  <!-- ═══════════ START-DATE BUTTONS ═══════════ -->
  {start_buttons_html}

  <!-- ═══════════ BODY ═══════════ -->
  <div class="content" data-plan-slug="{plan_slug or ''}" data-recipes-id="{recipes_link_id or plan_slug or ''}">
    {body_html}
  </div>

  <!-- ═══════════ SIGN-OFF ═══════════ -->
  <footer class="signoff">
    <div class="hr"></div>
    <p class="name">Shivani</p>
    <p class="role">Shivani Hari · Functional medicine · The Ochre Tree</p>
    <p class="contact">
      <a href="https://www.theochretree.com" target="_blank" rel="noopener">www.theochretree.com</a> &nbsp;·&nbsp;
      WhatsApp: <a href="https://wa.me/918976563971">+91 89765 63971</a> &nbsp;·&nbsp;
      <a href="mailto:reachochretree@gmail.com">reachochretree@gmail.com</a><br>
      <span style="font-size:10px;color:{FAINT}">This document is for personal use only and is not medical advice.</span>
    </p>
  </footer>

</div><!-- /.letter -->

<!-- Repeating contact footer on every printed page -->
<div class="print-page-footer">
  The Ochre Tree &nbsp;·&nbsp; www.theochretree.com &nbsp;·&nbsp; WhatsApp: +91 89765 63971 &nbsp;·&nbsp; reachochretree@gmail.com
</div>

<!-- Per-week print bar + client name injection -->
<script>
(function () {{
  var clientName = document.body.dataset.clientName || '';
  if (clientName) {{
    document.querySelectorAll('.week-section').forEach(function (sec) {{
      var el = document.createElement('div');
      el.className = 'print-client-name';
      el.textContent = clientName;
      sec.insertBefore(el, sec.firstChild);
    }});
  }}

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

  var content = document.querySelector('.content');
  if (content) content.insertBefore(bar, content.firstChild);

  window.addEventListener('afterprint', function () {{
    document.body.removeAttribute('data-print-week');
    document.body.removeAttribute('data-print-supplement');
    document.body.removeAttribute('data-print-routine');
  }});
}})();
</script>

<!-- Recipe linking -->
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

  var recipes = [];
  document.querySelectorAll('h3').forEach(function (h3) {{
    var raw = h3.textContent.trim();
    if (!raw) return;
    var startsWithSymbol = raw.charAt(0) === SYMBOL;
    var startsWithAlnum  = /^[A-Za-z0-9]/.test(raw);
    if (!startsWithSymbol && !startsWithAlnum) return;
    var key = searchKey(raw);
    var words = keyWords(raw);
    if (!key || words.length < 2) return;
    var id = slugify(raw);
    h3.id = id;
    recipes.push({{ id: id, key: key, words: words, name: raw }});
  }});

  var contentEl  = document.querySelector('.content');
  var planSlug   = contentEl ? contentEl.getAttribute('data-plan-slug') : '';
  // Prefer the stable letter_token (data-recipes-id) so ✦ recipe links survive
  // regeneration + aren't guessable; fall back to the slug.
  var recipesId  = (contentEl && contentEl.getAttribute('data-recipes-id')) || planSlug;
  var externalUrl = recipesId ? ('/recipes/' + recipesId) : '';

  if (recipes.length === 0 && !externalUrl) return;

  recipes.sort(function (a, b) {{ return b.key.length - a.key.length; }});

  var BR_SPLIT = /(<br\s*\/?\s*>)/gi;

  function bestRecipeFor(plainText) {{
    var t = plainText.toLowerCase();
    var best = null, bestScore = 0;
    recipes.forEach(function (r) {{
      var score = 0;
      if (t.indexOf(r.key) !== -1) score += 5;
      r.words.forEach(function (w) {{ if (t.indexOf(w) !== -1) score += 1; }});
      if (score > bestScore) {{ bestScore = score; best = r; }}
    }});
    return bestScore >= 5 || bestScore >= 2 ? best : null;
  }}

  document.querySelectorAll('td').forEach(function (td) {{
    if (!/[A-Za-z]/.test(td.textContent)) return;
    var html = td.innerHTML;
    var parts = html.split(BR_SPLIT);
    var changed = false;
    var rebuilt = parts.map(function (part) {{
      if (BR_SPLIT.test(part)) {{ BR_SPLIT.lastIndex = 0; return part; }}
      var plain = part.replace(/<[^>]+>/g, '').replace(new RegExp(SYMBOL, 'g'), '').trim();
      if (plain.length < 3) return part;
      var hasSymbol = part.indexOf(SYMBOL) !== -1;
      var inner = part
        .replace(new RegExp('\\\\s*' + SYMBOL + '\\\\s*', 'g'), ' ')
        .replace(/^\\s+|\\s+$/g, '');
      if (!inner) return part;
      var r = recipes.length > 0 ? bestRecipeFor(plain) : null;
      if (r) {{
        changed = true;
        return '<a href="#' + r.id + '" class="recipe-link" title="Jump to recipe: ' +
               r.name.replace(/"/g, '&quot;') + '">' + inner + '</a>';
      }}
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
