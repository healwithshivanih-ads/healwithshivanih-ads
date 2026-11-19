"""The body age report as an A4 PDF.

How it is made (no cost: headless Chrome and pypdf):
  1. the report page is printed to A4 with paper rules (no table split across pages);
  2. a second PDF is printed with one page per report page: running header, footer with CLICKABLE contact
     links, page number and a faint ring mark;
  3. pypdf lays (2) over (1). Chrome does not repeat a fixed box per page or paint a page background image,
     and text in @page margin boxes cannot be a link, which is why the furniture is a separate layer.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from . import wording as W
from .page import fonts_css, report_html, ringmark

HEAD_L = "Sequoya by Shivani Hari · certified functional health coach (IAFM, FMCA)"     # embargoed name: see page.PREPARED_BY
SITE, SITE_URL = "theochretree.com", "https://theochretree.com"
CALL, CALL_URL = "+91 87792 89917", "tel:+918779289917"                 # voice calls
WA = "+91 89765 63971"                                                   # WhatsApp only: this number takes no voice calls
WA_URL = "https://wa.me/918976563971?text=" + quote("Hi, I have a question about my body age report.")
MAIL = "admin@theochretree.com"
MAIL_URL = "mailto:admin@theochretree.com?subject=" + quote("My body age report")
WM_OPACITY = 0.06   # faint: visible on open paper, never competing with text

# the heart section opens a page; in the deeper report page 1 carries one more line, the body figure shares a
# page with its table, and the contents list runs in three columns to fit under the letter
CSS_STANDARD = "#heart{break-before:page;margin-top:0}"
CSS_DEEPER = (CSS_STANDARD + "figure{max-width:212px} ul.stand li{padding:7px 0 8px} #first{margin-top:10px} h1{font-size:40px} "
              "#glance{break-before:page;margin-top:0} nav{columns:3;font-size:12.5px} .navh{margin-top:14px} "
              # a little tighter, so the letter and the contents list still share page 2 and no section tail is stranded
              # on a page of its own now that the report carries the safety lines added on 19 Nov 2026
              "ol.todo li{margin-top:15px} .lettersep{margin-top:14px} .letter p{margin-top:9px} .sign{margin-top:10px;font-size:34px} "
              "nav a{padding:3px 0} .tm .by{margin-top:5px} .tm .nums{margin-top:5px} .means p{margin-top:6px}")

CHROME_PATHS = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "google-chrome", "google-chrome-stable",
                "chromium", "chromium-browser"]


def find_chrome() -> Optional[str]:
    env = os.environ.get("FMDB_CHROME")
    for c in ([env] if env else []) + CHROME_PATHS:
        if c and (os.path.isfile(c) or shutil.which(c)):
            return c if os.path.isfile(c) else shutil.which(c)
    return None


def chrome_pdf(chrome: str, src: Path, pdf: Path, budget: int = 9000) -> None:
    subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer",
                    f"--virtual-time-budget={budget}", f"--print-to-pdf={pdf}", src.as_uri()],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=180)


def chrome_png(chrome: str, src: Path, png: Path, width: int, height: int) -> None:
    subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--force-device-scale-factor=2",
                    f"--window-size={width},{height}", "--virtual-time-budget=4000", f"--screenshot={png}", src.as_uri()],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=120)


def head_right(rp: Any) -> str:
    what = "Body age report, with deeper tests" if rp.kind == "deeper" else "Body age report"
    return f"{what} · {rp.name} · sample collected {W.day(rp.sample_date)}"


def furniture_html(n: int, head_r: str) -> str:
    """One page per report page: header, footer with real links, page number, faint ring mark."""
    svg = ringmark(cls="", opacity=WM_OPACITY)
    foot = (f'<a href="{SITE_URL}">{SITE}</a> &nbsp;·&nbsp; Call <a href="{CALL_URL}">{CALL}</a> &nbsp;·&nbsp; '
            f'WhatsApp <a href="{WA_URL}">{WA}</a> &nbsp;·&nbsp; <a href="{MAIL_URL}">{MAIL}</a>')
    pages = "".join(f'<div class="pg"><div class="hd"><span>{HEAD_L}</span><span>{head_r}</span></div><div class="wm">{svg}</div>'
                    f'<div class="ft"><span>{foot}</span><span>Page {i} of {n}</span></div></div>' for i in range(1, n + 1))
    css = """@page{size:A4;margin:0} html,body{margin:0}
.pg{position:relative;width:210mm;height:296.6mm;overflow:hidden;break-after:page;font:8.5pt "Instrument Sans",Arial,sans-serif;color:#6F6A72}
.pg:last-child{break-after:auto}
.hd,.ft{position:absolute;left:14mm;right:14mm;display:flex;justify-content:space-between;align-items:baseline}
.hd{top:9.6mm} .ft{bottom:7.6mm}
.ft a{color:#6F6A72;text-decoration:underline;text-decoration-color:#C94A77;text-decoration-thickness:.8pt;text-underline-offset:2pt}
.wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center} .wm svg{width:130mm;height:130mm}"""
    return f"<!doctype html><html><head><meta charset=utf-8><style>{fonts_css()}</style><style>{css}</style></head><body>{pages}</body></html>"


def build_pdf(rp: Any, out: Path, chrome: Optional[str] = None) -> dict:
    """Write the report PDF to `out`. Returns {pages, links} for checking."""
    from pypdf import PdfReader, PdfWriter
    chrome = chrome or find_chrome()
    if not chrome:
        raise RuntimeError("Chrome was not found: it prints the report to PDF (set FMDB_CHROME to its path)")
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="body-age-") as tmp:
        t = Path(tmp)
        (t / "report.html").write_text(report_html(rp, CSS_DEEPER if rp.kind == "deeper" else CSS_STANDARD))
        chrome_pdf(chrome, t / "report.html", t / "body.pdf")
        body = PdfReader(str(t / "body.pdf"))
        n = len(body.pages)
        (t / "furniture.html").write_text(furniture_html(n, head_right(rp)))
        chrome_pdf(chrome, t / "furniture.html", t / "furniture.pdf", 6000)
        furn = PdfReader(str(t / "furniture.pdf"))
        if len(furn.pages) != n:
            raise RuntimeError(f"header/footer layer has {len(furn.pages)} pages, the report has {n}")
        w = PdfWriter(clone_from=body)                # clone keeps the in-document jump targets Chrome wrote
        for i, pg in enumerate(w.pages):
            pg.merge_page(furn.pages[i], over=True)    # carries the footer's link areas across
        w.add_metadata({"/Title": f"Body age report, {rp.name}, {W.day(rp.sample_date)}", "/Author": "Shivani Hari"})
        with open(out, "wb") as fh:
            w.write(fh)
    return {"pages": n, "links": links(out)}


def links(pdf: Path) -> list[tuple[int, str, str]]:
    """Every link in the finished PDF, for checking: (page, kind, target). kind is web | jump | BROKEN."""
    from pypdf import PdfReader
    r = PdfReader(str(pdf))
    names = set(r.named_destinations.keys())
    out = []
    for i, pg in enumerate(r.pages, 1):
        for a in pg.get("/Annots", []) or []:
            a = a.get_object()
            if a.get("/Subtype") != "/Link":
                continue
            act = a.get("/A")
            act = act.get_object() if act is not None else {}
            if "/URI" in act:
                out.append((i, "web", str(act["/URI"])))
            else:
                d = a.get("/Dest", act.get("/D"))
                out.append((i, "jump" if (str(d) in names or not isinstance(d, str)) else "BROKEN", str(d)[:40]))
    return out
