"""The email a body age report arrives in: the approved short version, with the PDF attached.

Real email-grade HTML: one table column, inline styles, system fonts, the ring as a PNG (mail apps strip SVG,
web fonts and <details>). Images are referenced as cid:ring and cid:mark, the way the app's other emails send
them (Gmail blocks data: images); the preview page inlines them so it can be opened on its own.

This module only builds a DRAFT. Nothing here sends anything.
"""
from __future__ import annotations

import base64
import tempfile
from pathlib import Path
from typing import Any, Optional

from . import wording as W
from .page import ordinal, ringmark, rings_svg
from .panel import num
from .pdf import chrome_png, find_chrome

ASH, INK, HOT, HOTTEXT, WARM, MUTE, RULE = "#F5F0EB", "#2A292D", "#C94A77", "#A93860", "#8A5632", "#6F6A72", "#DDD5CC"
SERIF = "Georgia,'Times New Roman',serif"
SANS = "Arial,Helvetica,sans-serif"
SUBJECT = "Your body age report is ready"


def attachment_name(rp: Any) -> str:
    return f"Body age report, {rp.name}, {W.day(rp.sample_date)}.pdf"


def P(text: str, size: float = 17, color: str = INK, top: int = 14, font: str = SERIF, extra: str = "") -> str:
    return f'<p style="margin:{top}px 0 0 0;font-family:{font};font-size:{size}px;line-height:1.55;color:{color};{extra}">{text}</p>'


def H(text: str, top: int = 34) -> str:
    return (f'<p style="margin:{top}px 0 0 0;padding:0 0 7px 0;border-bottom:1.5px solid {INK};font-family:{SANS};font-size:12.5px;'
            f'line-height:1.3;font-weight:bold;letter-spacing:1.6px;text-transform:uppercase;color:{INK};">{text}</p>')


def email_body(rp: Any, ring_src: str = "cid:ring", mark_src: str = "cid:mark") -> str:
    tone = {"att": HOTTEXT, "watch": WARM, "steady": INK}
    stand = "".join(
        f'<tr><td style="padding:14px 0 15px 0;border-bottom:1px solid {RULE};">'
        f'<p style="margin:0;font-family:{SERIF};font-size:19px;line-height:1.3;color:{INK};"><b>{x["name"]}</b>'
        f'<span style="font-family:{SANS};font-size:13px;font-weight:bold;color:{tone[x["key"]]};"> &nbsp;·&nbsp; {x["status"]}</span></p>'
        f'{P(x["text"], 16.5, INK, 7)}{P(x["nums"], 12.5, MUTE, 5, SANS)}</td></tr>' for x in rp.stand)
    todo = "".join(
        f'<tr><td width="38" valign="top" style="padding:16px 0 0 0;font-family:{SERIF};font-size:34px;line-height:1;color:{HOT};">{i}</td>'
        f'<td valign="top" style="padding:16px 0 0 0;">'
        f'<p style="margin:0;font-family:{SANS};font-size:13px;line-height:1.3;font-weight:bold;color:{HOTTEXT};">{t["tag"]} '
        f'<span style="font-weight:normal;color:{MUTE};">· {t["when"]}</span></p>{P(t["email"], 16.5, INK, 5)}</td></tr>'
        for i, t in enumerate(rp.todo, 1))
    first = rp.letter[0]
    if first.startswith(rp.name + ", "):
        first = first[len(rp.name) + 2:]
        first = first[0].upper() + first[1:]
    gapw, _n = W.gap_words(rp.decision.body_age_gap)
    st = rp.step
    step = P(st["headline"], 19, INK, 14) + "".join(P(p, 16.5) for p in st.get("email_paras", st["paras"]))
    if st["outcome"] == "foundation":
        step += P(st["email_offer"], 16.5) + P(st["email_how"], 16.5)
        step += (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0 0;"><tr>'
                 f'<td bgcolor="{HOTTEXT}" style="background:{HOTTEXT};"><a href="{rp.book_url or "#"}" style="display:block;padding:13px 24px;'
                 f'font-family:{SANS};font-size:16px;font-weight:bold;color:#FFFFFF;text-decoration:none;">Book your session</a></td></tr></table>')
    alt = (f"A tree cross-section with {rp.age} rings, one for each year of your age. "
           f"The {ordinal(max(1, round(rp.body_age)))} ring is marked: body age about {round(rp.body_age)}.")
    return f"""<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your body age, what stands out, and what to do first.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{ASH};"><tr><td align="center" style="padding:0 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;"><tr><td style="padding:26px 0 44px 0;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding:0 10px 0 0;"><img src="{mark_src}" width="46" height="46" alt="" style="display:block;border:0;"></td>
<td valign="middle" style="font-family:{SERIF};font-size:22px;font-style:italic;color:{INK};">Your body age report</td></tr></table>

{P(f"Dear {rp.name},", 17, INK, 26)}
{P("Your body age report is ready. " + first)}
{"".join(P(x) for x in rp.letter[1:])}

<p style="margin:30px 0 0 0;font-family:{SERIF};font-size:31px;line-height:1.18;color:{INK};">Your body age is <span style="color:{HOTTEXT};">{W.ba_text(rp.body_age)}</span>. You are {rp.age}.</p>
{P(f"Your blood reads {gapw}.", 18, INK, 10)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:16px 0 0 0;">
<img src="{ring_src}" width="300" alt="{alt}" style="display:block;border:0;width:300px;max-width:100%;height:auto;"></td></tr></table>
{P("One ring for each year of your age. The coloured ring is where your blood reads.", 13, MUTE, 8, SANS, "text-align:center;")}

{H("What stands out", 26) + f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{stand}</table>' if rp.stand else ""}
{P(rp.rest, 16.5, INK, 14) if rp.rest else ""}

{H("What to do about it")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{todo}</table>
{P(W.KEEP, 16.5, INK, 16) if rp.keep else ""}

{H("Your full report")}
{P("This email is the report in brief. The full report is attached as a PDF. It has each result against its range, system by system, with what it means for you.", 16.5)}
{P("It is yours to keep.", 16.5)}

{H("Your next step")}
{step}

{P("Shivani", 20, INK, 34, SERIF, "font-style:italic;")}
{P("Shivani Hari · certified functional health coach (IAFM, FMCA)", 13, MUTE, 2, SANS)}

<p style="margin:30px 0 0 0;padding:14px 0 0 0;border-top:1px solid {RULE};font-family:{SANS};font-size:12px;line-height:1.6;color:{MUTE};">Sample collected {W.day(rp.sample_date)} · Report issued {W.day(rp.report_date)} · Next test due {W.day(rp.next_test)}<br>You are getting this email because you ordered a body age report.</p>

</td></tr></table>
</td></tr></table>"""


def email_html(rp: Any, ring_src: str = "cid:ring", mark_src: str = "cid:mark") -> str:
    return ("<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>{SUBJECT}</title></head><body style='margin:0;background:{ASH};'>" + email_body(rp, ring_src, mark_src) + "</body></html>")


def write_images(rp: Any, out_dir: Path, chrome: Optional[str] = None, ring_name: str = "ring.png") -> dict[str, Path]:
    """ring.png and mark.png for the email, drawn by headless Chrome from the same SVGs the report uses."""
    chrome = chrome or find_chrome()
    if not chrome:
        raise RuntimeError("Chrome was not found: it draws the email's two images (set FMDB_CHROME to its path)")
    from .page import fonts_css
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="body-age-mail-") as tmp:
        t = Path(tmp)
        (t / "ring.html").write_text(f"<!doctype html><meta charset=utf-8><style>{fonts_css()}</style><style>html,body{{margin:0;background:{ASH}}}"
                                     f"svg{{display:block;width:300px;height:auto}}</style>{rings_svg(rp.age, rp.body_age)}")
        (t / "mark.html").write_text(f"<!doctype html><meta charset=utf-8><style>html,body{{margin:0;background:{ASH}}}"
                                     f"svg{{display:block;width:125px;height:125px}}</style>{ringmark(cls='')}")
        chrome_png(chrome, t / "ring.html", out_dir / ring_name, 300, 372)       # shown 300 wide; drawn at twice that for sharp screens
        chrome_png(chrome, t / "mark.html", out_dir / "mark.png", 125, 125)
    return {"ring": out_dir / ring_name, "mark": out_dir / "mark.png"}


def preview_html(rp: Any, images: dict[str, Path]) -> str:
    """The email inside a plain mail-app frame, images inlined, for the coach to read before she sends it."""
    def b64(p: Path) -> str:
        return "data:image/png;base64," + base64.b64encode(Path(p).read_bytes()).decode()
    body = email_body(rp, b64(images["ring"]), b64(images["mark"]))
    return f"""<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>
<title>Draft email · {rp.name}</title><style>
body{{margin:0;background:#E9E4DE;color:#2A292D;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5}}
.wrap{{max-width:660px;margin:0 auto;padding:20px 16px 56px}} .note{{font-size:13.5px;color:#6F6A72;margin:0 0 14px}}
.mail{{background:#fff;border:1px solid #D9D2C8}} .hd{{padding:16px 18px 14px;border-bottom:1px solid #D9D2C8}} .hd h1{{margin:0;font-size:20px;font-weight:600}}
.hd dl{{margin:10px 0 0;display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-size:13.5px}} .hd dt{{color:#6F6A72}} .hd dd{{margin:0}}
.att{{padding:11px 18px;border-top:1px solid #D9D2C8;font-size:13.5px;color:#6F6A72}} .att b{{color:#2A292D}}</style></head><body><div class="wrap">
<p class="note"><b>Draft.</b> Not sent. This is the email {rp.name} would receive with the report attached.</p>
<div class="mail"><div class="hd"><h1>{SUBJECT}</h1><dl><dt>From</dt><dd>Shivani Hari</dd><dt>To</dt><dd>{rp.name}</dd></dl></div>
{body}
<div class="att">Attached: <b>{attachment_name(rp)}</b></div></div></div></body></html>"""


# ── the email for two: one email, both reports and the shared page attached ───────────────────────────────────
def two_attachments(two: Any) -> list[str]:
    """The three PDFs the email carries: each person's own report, then the page they share."""
    from . import two as T
    return [attachment_name(two.a), attachment_name(two.b), T.attachment_name(two)]


def two_email_body(two: Any, ring_srcs: tuple[str, str] = ("cid:ring1", "cid:ring2"), mark_src: str = "cid:mark") -> str:
    """The page for two in brief, built from the approved single email's parts and the page's own sentences.
    Nothing here is new wording: every line is on the page for two or in one of the two single emails."""
    from . import two as T
    S = T.SAMPLE
    tone = {"att": HOTTEXT, "watch": WARM, "steady": INK}
    people = ""
    for rp, ring in zip(two.people, ring_srcs):
        stand = "".join(
            f'<tr><td style="padding:14px 0 15px 0;border-bottom:1px solid {RULE};">'
            f'<p style="margin:0;font-family:{SERIF};font-size:19px;line-height:1.3;color:{INK};"><b>{x["name"]}</b>'
            f'<span style="font-family:{SANS};font-size:13px;font-weight:bold;color:{tone[x["key"]]};"> &nbsp;·&nbsp; {x["status"]}</span></p>'
            f'{P(T._plain(x["text"]), 16.5, INK, 7)}{P(x["nums"], 12.5, MUTE, 5, SANS)}</td></tr>' for x in rp.stand)
        alt = (f"A tree cross-section with {rp.age} rings, one for each year of age. "
               f"The {ordinal(max(1, round(rp.body_age)))} ring is marked: body age about {round(rp.body_age)}.")
        people += (H(f"{rp.name}, {rp.age}")
                   + f'<p style="margin:16px 0 0 0;font-family:{SERIF};font-size:31px;line-height:1.18;color:{HOTTEXT};">{W.ba_text(rp.body_age)}</p>'
                   + P(T.gap_line(rp), 18, INK, 6)
                   + f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:16px 0 0 0;">'
                     f'<img src="{ring}" width="300" alt="{alt}" style="display:block;border:0;width:300px;max-width:100%;height:auto;"></td></tr></table>'
                   + (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{stand}</table>' if rp.stand else "")
                   + (P(rp.rest, 16.5, INK, 14) if rp.rest else ""))
    alike = "".join(P((f"<b>{lead}</b> " if lead else "") + text, 16.5) for lead, text in two.alike)
    st = two.step
    step = P(st["headline"], 19, INK, 14) + "".join(P((f"<b>{n}</b> " if n else "") + x, 16.5) for n, x in st["paras"])
    for o in st["offers"]:
        step += P(f"<b>{o.title}: {o.price}.</b> {o.line}", 16.5) + P(o.how, 16.5)
        step += (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0 0;"><tr>'
                 f'<td bgcolor="{HOTTEXT}" style="background:{HOTTEXT};"><a href="{o.who.book_url or "#"}" style="display:block;padding:13px 24px;'
                 f'font-family:{SANS};font-size:16px;font-weight:bold;color:#FFFFFF;text-decoration:none;">{S["offer.button"]}</a></td></tr></table>')
    if st["fresh"]:
        step += P(st["fresh"], 16.5)
    a, b = two.a, two.b
    return f"""<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your body age, what stands out, and what to do first.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{ASH};"><tr><td align="center" style="padding:0 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;"><tr><td style="padding:26px 0 44px 0;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding:0 10px 0 0;"><img src="{mark_src}" width="46" height="46" alt="" style="display:block;border:0;"></td>
<td valign="middle" style="font-family:{SERIF};font-size:22px;font-style:italic;color:{INK};">{S["title"]}</td></tr></table>

{P(S["dear"].format(a=a.name, b=b.name), 17, INK, 26)}
{"".join(P(x) for x in two.letter)}

{people}
{P(S["rings"], 13, MUTE, 12, SANS, "text-align:center;")}

{H(S["h3"])}
{alike}

{H(S["h6"])}
{P(S["own"], 16.5)}

{H(S["h7"])}
{P(S["meta.next"].format(date=W.day(two.next_test)), 19, INK, 14)}
{P(S["next.headline"], 16.5)}
{P(two.next_text, 16.5)}

{H(S["h8"])}
{step}

{P("Shivani", 20, INK, 34, SERIF, "font-style:italic;")}
{P("Shivani Hari · certified functional health coach (IAFM, FMCA)", 13, MUTE, 2, SANS)}

<p style="margin:30px 0 0 0;padding:14px 0 0 0;border-top:1px solid {RULE};font-family:{SANS};font-size:12px;line-height:1.6;color:{MUTE};">Sample collected {W.day(two.sample_date)} · Report issued {W.day(two.report_date)} · Next test due {W.day(two.next_test)}<br>You are getting this email because you ordered a body age report.</p>

</td></tr></table>
</td></tr></table>"""


def two_email_html(two: Any, ring_srcs: tuple[str, str] = ("cid:ring1", "cid:ring2"), mark_src: str = "cid:mark") -> str:
    return ("<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>{SUBJECT}</title></head><body style='margin:0;background:{ASH};'>" + two_email_body(two, ring_srcs, mark_src) + "</body></html>")


def write_two_images(two: Any, out_dir: Path, chrome: Optional[str] = None) -> dict[str, Path]:
    """ring-1.png, ring-2.png and mark.png for the email for two."""
    one = write_images(two.a, out_dir, chrome, ring_name="ring-1.png")
    other = write_images(two.b, out_dir, chrome, ring_name="ring-2.png")
    return {"ring1": one["ring"], "ring2": other["ring"], "mark": one["mark"]}


def two_preview_html(two: Any, images: dict[str, Path]) -> str:
    """The email for two inside a plain mail-app frame, images inlined, for the coach to read. A draft: nothing sends."""
    def b64(p: Path) -> str:
        return "data:image/png;base64," + base64.b64encode(Path(p).read_bytes()).decode()
    body = two_email_body(two, (b64(images["ring1"]), b64(images["ring2"])), b64(images["mark"]))
    att = "".join(f"<br><b>{n}</b>" for n in two_attachments(two))
    return f"""<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>
<title>Draft email · {two.names}</title><style>
body{{margin:0;background:#E9E4DE;color:#2A292D;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5}}
.wrap{{max-width:660px;margin:0 auto;padding:20px 16px 56px}} .note{{font-size:13.5px;color:#6F6A72;margin:0 0 14px}}
.mail{{background:#fff;border:1px solid #D9D2C8}} .hd{{padding:16px 18px 14px;border-bottom:1px solid #D9D2C8}} .hd h1{{margin:0;font-size:20px;font-weight:600}}
.hd dl{{margin:10px 0 0;display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-size:13.5px}} .hd dt{{color:#6F6A72}} .hd dd{{margin:0}}
.att{{padding:11px 18px;border-top:1px solid #D9D2C8;font-size:13.5px;color:#6F6A72}} .att b{{color:#2A292D}}</style></head><body><div class="wrap">
<p class="note"><b>Draft.</b> Not sent. This is the one email {two.names} would receive, with both reports and the page they share attached.</p>
<div class="mail"><div class="hd"><h1>{SUBJECT}</h1><dl><dt>From</dt><dd>Shivani Hari</dd><dt>To</dt><dd>{two.names}</dd></dl></div>
{body}
<div class="att">Attached:{att}</div></div></div></body></html>"""
