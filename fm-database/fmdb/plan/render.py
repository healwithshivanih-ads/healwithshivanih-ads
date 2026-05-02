"""Client-facing plan renderer (Markdown + print-friendly HTML).

The structured `Plan` model is coach-facing — it's full of slugs, evidence
tiers, status_history, and other plumbing the client should never see.
This module turns a plan into a readable artifact the coach can hand the
client: catalogue slugs are looked up and replaced with display names,
mechanisms are hidden by default (too clinical), `notes_for_coach` and
provenance fields are stripped, and section copy is rephrased into "what
/ why / when" plain English.

Outputs:
- `render_markdown(plan, client, catalogue)` → Markdown string
- `render_html(plan, client, catalogue)` → standalone HTML string with
  embedded print-friendly CSS (no external assets, ready for browser
  Print-to-PDF or save-as).

Zero new dependencies. PDF generation is intentionally not built in —
browser Print-to-PDF gives consistent output across platforms without
forcing weasyprint / wkhtmltopdf installs.
"""
from __future__ import annotations

import html
from datetime import date
from typing import Optional

from .models import Plan, Client


# ---------------------------------------------------------------------------
# Catalogue lookups (resolve slugs → display names + summaries)
# ---------------------------------------------------------------------------


def _topic_display(slug: str, cat) -> str:
    for t in cat.topics:
        if t.slug == slug:
            return t.display_name
    return slug.replace("-", " ").title()


def _topic_summary(slug: str, cat) -> str:
    for t in cat.topics:
        if t.slug == slug:
            return (t.summary or "").strip()
    return ""


def _symptom_display(slug: str, cat) -> str:
    for s in cat.symptoms:
        if s.slug == slug:
            return s.display_name
    return slug.replace("-", " ").title()


def _supplement_display(slug: str, cat) -> str:
    for s in cat.supplements:
        if s.slug == slug:
            return s.display_name
    return slug.replace("-", " ").title()


def _cooking_display(slug: str, cat) -> str:
    for c in cat.cooking_adjustments:
        if c.slug == slug:
            return c.display_name
    return slug.replace("-", " ").title()


def _remedy_display(slug: str, cat) -> str:
    for r in cat.home_remedies:
        if r.slug == slug:
            return r.display_name
    return slug.replace("-", " ").title()


def _education_display(target_kind: str, target_slug: str, cat) -> str:
    if target_kind == "topic":
        return _topic_display(target_slug, cat)
    if target_kind == "mechanism":
        for m in cat.mechanisms:
            if m.slug == target_slug:
                return m.display_name
    if target_kind == "claim":
        for c in cat.claims:
            if c.slug == target_slug:
                return getattr(c, "display_name", None) or getattr(c, "title", None) or target_slug
    return target_slug.replace("-", " ").title()


def _client_label(client: Optional[Client]) -> str:
    if not client:
        return "Your"
    name = getattr(client, "display_name", None) or getattr(client, "name", None)
    if name:
        return f"{name}'s"
    return f"Client {client.client_id}'s"


# ---------------------------------------------------------------------------
# Markdown
# ---------------------------------------------------------------------------


def render_markdown(plan: Plan, client: Optional[Client], cat,
                    resources: Optional[list] = None) -> str:
    lines: list[str] = []
    p = lines.append

    # ---- Header ----
    p(f"# {_client_label(client)} Plan")
    p("")
    p(f"**Plan period:** {plan.plan_period_start.isoformat()} → "
      f"{plan.plan_period_recheck_date.isoformat()} "
      f"({plan.plan_period_weeks} weeks)")
    p(f"**Recheck on:** {plan.plan_period_recheck_date.isoformat()}")
    p("")

    # ---- What we're focusing on ----
    if plan.primary_topics or plan.contributing_topics or plan.presenting_symptoms:
        p("## What we're focusing on")
        p("")
        if plan.primary_topics:
            p("**Primary focus areas:**")
            for slug in plan.primary_topics:
                name = _topic_display(slug, cat)
                summ = _topic_summary(slug, cat)
                line = f"- **{name}**"
                if summ:
                    # First sentence only — keep client-facing copy short
                    first_sentence = summ.split(".")[0].strip()
                    if first_sentence:
                        line += f" — {first_sentence}."
                p(line)
            p("")
        if plan.contributing_topics:
            p("**Also relevant:**")
            for slug in plan.contributing_topics:
                p(f"- {_topic_display(slug, cat)}")
            p("")
        if plan.presenting_symptoms:
            p("**What you came in with:**")
            for slug in plan.presenting_symptoms:
                p(f"- {_symptom_display(slug, cat)}")
            p("")

    # ---- Lifestyle practices ----
    if plan.lifestyle_practices:
        p("## Daily practices")
        p("")
        for prac in plan.lifestyle_practices:
            cad = f" — *{prac.cadence}*" if prac.cadence else ""
            p(f"- **{prac.name}**{cad}")
            if prac.details:
                p(f"  {prac.details}")
        p("")

    # ---- Nutrition ----
    n = plan.nutrition
    if (n.pattern or n.add or n.reduce or n.meal_timing
            or n.cooking_adjustments or n.home_remedies):
        p("## Nutrition")
        p("")
        if n.pattern:
            p(f"**Overall pattern:** {n.pattern}")
            p("")
        if n.add:
            p("**Add more of:**")
            for f in n.add:
                p(f"- {f}")
            p("")
        if n.reduce:
            p("**Reduce or avoid:**")
            for f in n.reduce:
                p(f"- {f}")
            p("")
        if n.meal_timing:
            p(f"**Meal timing:** {n.meal_timing}")
            p("")
        if n.cooking_adjustments:
            p("**Cooking adjustments:**")
            for slug in n.cooking_adjustments:
                p(f"- {_cooking_display(slug, cat)}")
            p("")
        if n.home_remedies:
            p("**Home remedies:**")
            for slug in n.home_remedies:
                p(f"- {_remedy_display(slug, cat)}")
            p("")

    # ---- Education ----
    if plan.education:
        p("## What I'd like you to learn this period")
        p("")
        for ed in plan.education:
            name = _education_display(ed.target_kind, ed.target_slug, cat)
            p(f"- **{name}**")
            if ed.client_facing_summary:
                p(f"  {ed.client_facing_summary}")
        p("")

    # ---- Resources (attached handouts / links / inline notes) ----
    if resources:
        import os as _os
        client_facing = [r for r in resources
                         if getattr(r, "audience", "both") in ("client", "both")]
        if client_facing:
            p("## Resources")
            p("")
            for r in client_facing:
                title = getattr(r, "title", None) or getattr(r, "slug", "Untitled")
                p(f"- **{title}**")
                desc = (getattr(r, "description", "") or "").strip()
                if desc:
                    p(f"  {desc}")
                url = getattr(r, "url", None)
                file_path = getattr(r, "file_path", None)
                text = getattr(r, "text", None)
                if url:
                    p(f"  Link: {url}")
                elif file_path:
                    p(f"  (See attached file: {_os.path.basename(file_path)})")
                elif text:
                    snippet = text.strip()
                    if len(snippet) > 280:
                        snippet = snippet[:280].rstrip() + "…"
                    p(f"  {snippet}")
            p("")

    # ---- Supplements ----
    if plan.supplement_protocol:
        p("## Supplement protocol")
        p("")
        p("| Supplement | Dose | When | With food | Duration |")
        p("|---|---|---|---|---|")
        for s in plan.supplement_protocol:
            name = _supplement_display(s.supplement_slug, cat)
            if s.form:
                name = f"{name} ({s.form})"
            dose = s.dose or "—"
            timing = s.timing or "—"
            food = s.take_with_food or "—"
            dur = f"{s.duration_weeks} weeks" if s.duration_weeks else "—"
            p(f"| {name} | {dose} | {timing} | {food} | {dur} |")
        p("")
        # Notes section for any supplements with rationale or titration
        notes_block = []
        for s in plan.supplement_protocol:
            if s.coach_rationale or s.titration:
                name = _supplement_display(s.supplement_slug, cat)
                bits = []
                if s.coach_rationale:
                    bits.append(f"_{s.coach_rationale}_")
                if s.titration:
                    bits.append(f"**Titration:** {s.titration}")
                notes_block.append(f"- **{name}** — " + " · ".join(bits))
        if notes_block:
            p("**Notes:**")
            for line in notes_block:
                p(line)
            p("")

    # ---- Lab orders ----
    if plan.lab_orders:
        p("## Lab tests to discuss with your clinician")
        p("")
        for lab in plan.lab_orders:
            line = f"- **{lab.test}**"
            if lab.reason:
                line += f" — {lab.reason}"
            p(line)
        p("")

    # ---- Referrals ----
    if plan.referrals:
        p("## Referrals")
        p("")
        for r in plan.referrals:
            urg = f" *(urgency: {r.urgency.value})*" if r.urgency.value != "routine" else ""
            p(f"- **{r.to}**{urg} — {r.reason}")
        p("")

    # ---- Tracking ----
    t = plan.tracking
    if t.habits or t.symptoms_to_monitor or t.recheck_questions:
        p("## What to track")
        p("")
        if t.habits:
            p("**Daily / weekly habits:**")
            for h in t.habits:
                p(f"- **{h.name}** — *{h.cadence}*")
            p("")
        if t.symptoms_to_monitor:
            p("**Symptoms to monitor:**")
            for slug in t.symptoms_to_monitor:
                p(f"- {_symptom_display(slug, cat)}")
            p("")
        if t.recheck_questions:
            p("**Questions for your recheck:**")
            for q in t.recheck_questions:
                p(f"- {q}")
            p("")

    # ---- Footer ----
    p("---")
    p("")
    p(f"_Prepared {date.today().isoformat()}. Recheck on "
      f"{plan.plan_period_recheck_date.isoformat()}._")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# HTML (standalone, with print-friendly CSS)
# ---------------------------------------------------------------------------


_HTML_CSS = """
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #1f2937;
  line-height: 1.55;
  max-width: 780px;
  margin: 32px auto;
  padding: 0 20px;
  font-size: 15px;
}
h1 { color: #14532d; border-bottom: 3px solid #14532d; padding-bottom: 8px; margin-bottom: 8px; }
h2 { color: #166534; margin-top: 28px; border-left: 4px solid #86efac; padding-left: 10px; }
h3 { color: #1f2937; margin-top: 20px; }
ul { padding-left: 22px; }
li { margin: 4px 0; }
strong { color: #064e3b; }
em { color: #4b5563; }
table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
th, td { border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; vertical-align: top; }
th { background: #ecfdf5; color: #065f46; font-weight: 600; }
tr:nth-child(even) td { background: #f9fafb; }
hr { border: none; border-top: 1px solid #d1d5db; margin: 24px 0 12px; }
.meta { color: #6b7280; font-size: 13px; }
.section { page-break-inside: avoid; }
@media print {
  body { margin: 0; padding: 0; }
  h2 { page-break-after: avoid; }
  table { page-break-inside: auto; }
  tr { page-break-inside: avoid; page-break-after: auto; }
}
"""


def _md_inline_to_html(text: str) -> str:
    """Tiny inline markdown converter — handles **bold**, *italic*, `code`,
    and escapes HTML entities. Block-level structure is built directly in
    `render_html` rather than parsed from markdown."""
    s = html.escape(text)
    # Bold first (so we don't catch the * inside **)
    import re
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    return s


def render_html(plan: Plan, client: Optional[Client], cat,
                title: Optional[str] = None,
                resources: Optional[list] = None) -> str:
    """Standalone HTML — embeds CSS, no external assets. Ready for browser
    Print-to-PDF or save-as-PDF."""
    md = render_markdown(plan, client, cat, resources=resources)
    body_parts: list[str] = []
    in_table = False
    in_list = False
    table_buffer: list[str] = []

    def _flush_list():
        nonlocal in_list
        if in_list:
            body_parts.append("</ul>")
            in_list = False

    def _flush_table():
        nonlocal in_table, table_buffer
        if in_table:
            # First buffered row is the header; second is the separator (skip);
            # subsequent rows are data.
            rows = [r for r in table_buffer if not set(r.replace("|", "").strip()) <= {"-", " ", ":"}]
            if rows:
                body_parts.append("<table>")
                head = rows[0]
                body_parts.append("<thead><tr>")
                for cell in [c.strip() for c in head.strip("|").split("|")]:
                    body_parts.append(f"<th>{_md_inline_to_html(cell)}</th>")
                body_parts.append("</tr></thead><tbody>")
                for row in rows[1:]:
                    body_parts.append("<tr>")
                    for cell in [c.strip() for c in row.strip("|").split("|")]:
                        body_parts.append(f"<td>{_md_inline_to_html(cell)}</td>")
                    body_parts.append("</tr>")
                body_parts.append("</tbody></table>")
            table_buffer = []
            in_table = False

    for raw_line in md.split("\n"):
        line = raw_line.rstrip()
        # Table row
        if line.startswith("|") and line.endswith("|"):
            _flush_list()
            in_table = True
            table_buffer.append(line)
            continue
        if in_table:
            _flush_table()

        if not line:
            _flush_list()
            continue

        if line.startswith("# "):
            _flush_list()
            body_parts.append(f"<h1>{_md_inline_to_html(line[2:])}</h1>")
        elif line.startswith("## "):
            _flush_list()
            body_parts.append(f'<h2 class="section">{_md_inline_to_html(line[3:])}</h2>')
        elif line.startswith("### "):
            _flush_list()
            body_parts.append(f"<h3>{_md_inline_to_html(line[4:])}</h3>")
        elif line.startswith("- "):
            if not in_list:
                body_parts.append("<ul>")
                in_list = True
            body_parts.append(f"<li>{_md_inline_to_html(line[2:])}</li>")
        elif line.startswith("  ") and in_list:
            # Continuation of last list item
            if body_parts and body_parts[-1].startswith("<li>"):
                inner = body_parts[-1][4:-5]  # strip <li></li>
                body_parts[-1] = f"<li>{inner}<br><span class='meta'>{_md_inline_to_html(line.strip())}</span></li>"
        elif line.startswith("---"):
            _flush_list()
            body_parts.append("<hr>")
        else:
            _flush_list()
            body_parts.append(f"<p>{_md_inline_to_html(line)}</p>")

    _flush_list()
    _flush_table()

    page_title = title or f"{_client_label(client)} Plan"
    return (
        "<!DOCTYPE html>\n"
        f'<html lang="en"><head><meta charset="utf-8">'
        f"<title>{html.escape(page_title)}</title>"
        f"<style>{_HTML_CSS}</style>"
        "</head><body>\n"
        + "\n".join(body_parts)
        + "\n</body></html>"
    )
