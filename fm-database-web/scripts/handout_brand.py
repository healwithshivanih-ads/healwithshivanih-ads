"""Deep Mind brand renderer for client-facing handouts.

Separate from brand_html.py (which is the letter/meal-plan template, sage+ochre).
This applies the **Deep Mind** brand kit used for The Ochre Tree carousels:
Bone / Indigo / Rose / Lavender + Libre Baskerville + Inter, with the
typographic wordmark "THE OCHRE TREE · Shivani Hari" as the logo.

Source of brand kit: ~/Documents/.../Carousels/template/_base.css
"""
from __future__ import annotations

import re
from pathlib import Path

# Reuse the markdown→HTML converter from the letter template (parsing only).
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import brand_html  # noqa: E402

_CSS = """
@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400;1,700&family=Inter:wght@400;500;600;700&display=swap');
:root{--bone:#F7F4F3;--ink:#0D0D0D;--indigo:#2B2D42;--lavender:#7280A1;--rose:#D6A2A2;--line:#E3DCD9;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bone);color:var(--ink);font-family:'Inter',Arial,sans-serif;font-weight:500;line-height:1.7;-webkit-font-smoothing:antialiased;}
.page{max-width:760px;margin:0 auto;padding:60px 56px 72px;}
.wordmark{font-size:13px;letter-spacing:.22em;color:var(--lavender);font-weight:700;text-transform:uppercase;}
.wordmark strong{color:var(--indigo);font-weight:800;}
.pulse{display:inline-block;width:11px;height:11px;border-radius:50%;background:var(--rose);margin-right:12px;vertical-align:middle;}
h1.title{font-family:'Libre Baskerville',Georgia,serif;font-weight:400;color:var(--indigo);font-size:40px;line-height:1.15;letter-spacing:-.01em;margin:20px 0 6px;}
.subtitle{font-family:'Libre Baskerville',Georgia,serif;font-style:italic;color:var(--lavender);font-size:19px;}
.divider{width:96px;height:2px;background:var(--indigo);margin:26px 0 34px;}
.content p{font-size:17px;margin:0 0 16px;}
.content strong{color:var(--indigo);font-weight:700;}
.content em{font-style:italic;}
.content h2,.content h3{font-family:'Libre Baskerville',Georgia,serif;font-weight:400;color:var(--indigo);line-height:1.2;}
.content h2{font-size:26px;margin:30px 0 10px;}
.content h3{font-size:21px;margin:24px 0 8px;}
.content ul,.content ol{list-style:none;margin:0 0 16px;padding:0;}
.content li{font-size:17px;margin:0 0 9px;padding-left:26px;position:relative;}
.content li::before{content:"";position:absolute;left:3px;top:11px;width:8px;height:8px;border-radius:50%;background:var(--rose);}
.content hr{border:none;border-top:1px solid var(--line);margin:34px 0 22px;}
.foot{margin-top:30px;border-top:1px solid var(--line);padding-top:18px;}
@page{size:A4;margin:12mm 14mm;}
@media print{
  body{background:#fff;font-size:11.3px;line-height:1.42;}
  .page{max-width:none;padding:0;}
  .wordmark{font-size:9.5px;letter-spacing:.18em;}
  .pulse{width:8px;height:8px;margin-right:8px;}
  h1.title{font-size:24px;margin:10px 0 4px;}
  .subtitle{font-size:13.5px;}
  .divider{margin:11px 0 15px;}
  .content p{font-size:11.3px;margin:0 0 7px;}
  .content h2{font-size:15.5px;margin:13px 0 5px;page-break-after:avoid;}
  .content h3{font-size:13px;margin:10px 0 4px;page-break-after:avoid;}
  .content li{font-size:11.3px;margin:0 0 4.5px;padding-left:18px;page-break-inside:avoid;}
  .content li::before{top:7px;width:6px;height:6px;}
  .content p{page-break-inside:avoid;}
  .content hr{margin:15px 0 10px;}
  .foot{margin-top:13px;padding-top:9px;}
}
"""

_WORDMARK = '<span class="wordmark"><span class="pulse"></span><strong>THE OCHRE TREE</strong> &middot; Shivani Hari</span>'


def render_handout(markdown_text: str, title: str, subtitle: str = "A guide from Shivani Hari") -> str:
    """Return standalone Deep Mind–branded HTML for a handout markdown body."""
    # Strip the leading "# Title" + "*A guide from Shivani Hari*" so the masthead
    # (below) owns the title rather than duplicating it in the body.
    body_md = re.sub(r"^#\s+.*\n+\*A guide from Shivani Hari\*\n+", "", markdown_text, count=1)
    body_html = brand_html._md_to_html(body_md)
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — The Ochre Tree</title>
<style>{_CSS}</style></head>
<body><div class="page">
  <header>
    {_WORDMARK}
    <h1 class="title">{title}</h1>
    <div class="subtitle">{subtitle}</div>
    <div class="divider"></div>
  </header>
  <div class="content">{body_html}</div>
  <div class="foot">{_WORDMARK}</div>
</div></body></html>"""
