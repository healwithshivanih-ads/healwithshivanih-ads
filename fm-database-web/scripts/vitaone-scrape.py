#!/usr/bin/env python3
"""Scrape vitaone.in (Odoo eCommerce) → JSON catalog.

Run from a network that can reach vitaone.in (your laptop — the Claude
Code sandbox is firewalled and can't fetch the site directly). Output
goes to scripts/vitaone-catalog.json.

Usage:
  cd ~/code/healwithshivanih-ads/fm-database-web
  python3 scripts/vitaone-scrape.py
  # writes scripts/vitaone-catalog.json with every public product

Re-run periodically to refresh — overwrites the JSON file in-place.

Politeness:
  - 300ms delay between requests
  - Standard browser User-Agent (Odoo Cloudflare layer can be picky)
  - Respects 404 / 410 (skips silently)
  - Retries up to 3 times on transient 5xx
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin
from xml.etree import ElementTree as ET

try:
    import requests
except ImportError:
    print("Missing 'requests'. Install: pip install requests", file=sys.stderr)
    sys.exit(1)

BASE = "https://vitaone.in"
REFERRAL_CODE = "?pr=vita13720sh"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/127 Safari/537.36"
)
OUT = Path(__file__).parent / "vitaone-catalog.json"

session = requests.Session()
session.headers.update({
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
})


def fetch(url: str, *, retries: int = 3, sleep: float = 1.5) -> str | None:
    last = None
    for i in range(retries):
        try:
            r = session.get(url, timeout=30)
            last = r.status_code
            if r.status_code == 200:
                return r.text
            if r.status_code in (404, 410):
                return None
            if r.status_code in (429, 502, 503, 504):
                time.sleep(sleep * (i + 1) * 2)
                continue
        except requests.RequestException as e:
            print(f"  ! retry {i + 1} {url}: {e}", file=sys.stderr)
            time.sleep(sleep * (i + 1))
    print(f"  ✗ FAIL {url} (last={last})", file=sys.stderr)
    return None


# --- product-URL discovery -------------------------------------------------

SITEMAP_CANDIDATES = [
    "/sitemap.xml",
    "/website/sitemap.xml",
    "/sitemap-en.xml",
    "/sitemap-products.xml",
]


def parse_sitemap_xml(xml: str, urls: set[str]) -> list[str]:
    """Add product URLs to `urls`, return any nested sitemap URLs."""
    nested = []
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as e:
        print(f"  ! sitemap parse error: {e}", file=sys.stderr)
        return nested
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    # Sitemap-index → list of sitemap.xml URLs
    for loc in root.findall(".//sm:sitemap/sm:loc", ns):
        nested.append(loc.text)
    # Url-set → list of page URLs
    for loc in root.findall(".//sm:url/sm:loc", ns):
        u = (loc.text or "").strip()
        if "/shop/" in u and not u.endswith("/shop/"):
            urls.add(u)
    return nested


def discover_via_sitemap() -> set[str]:
    urls: set[str] = set()
    queue = [urljoin(BASE, c) for c in SITEMAP_CANDIDATES]
    seen: set[str] = set()
    while queue:
        sm_url = queue.pop(0)
        if sm_url in seen:
            continue
        seen.add(sm_url)
        body = fetch(sm_url)
        if not body:
            continue
        nested = parse_sitemap_xml(body, urls)
        queue.extend(u for u in nested if u and u not in seen)
        time.sleep(0.3)
    return urls


def discover_via_pagination() -> set[str]:
    """Fallback: crawl /shop?page=N for product links."""
    urls: set[str] = set()
    seen_count = 0
    for page in range(1, 25):  # generous safety bound
        html = fetch(f"{BASE}/shop?page={page}")
        if not html:
            break
        # Odoo product cards typically have href="/shop/<slug>-<id>"
        found = re.findall(r'href="(/shop/[^"#?\s]+)"', html)
        new = {
            urljoin(BASE, u)
            for u in found
            if "/shop/page/" not in u
               and "/shop/cart" not in u
               and "/shop/checkout" not in u
               and "/shop/category" not in u
        }
        before = len(urls)
        urls |= new
        if len(urls) == before:  # no new products this page → end
            break
        seen_count = len(urls)
        print(f"  page {page}: {seen_count} unique URLs so far", file=sys.stderr)
        time.sleep(0.4)
    return urls


# --- product-page parsing --------------------------------------------------

def parse_product(url: str) -> dict | None:
    html = fetch(url)
    if not html:
        return None
    out: dict = {"url": url + REFERRAL_CODE, "url_raw": url}

    # Try JSON-LD structured data first (most reliable on Odoo)
    for ld in re.findall(
        r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',
        html,
        re.DOTALL,
    ):
        try:
            data = json.loads(ld.strip())
        except Exception:
            continue
        if isinstance(data, list):
            data = next((d for d in data if isinstance(d, dict) and d.get("@type") == "Product"), None)
            if data is None:
                continue
        if isinstance(data, dict) and data.get("@type") == "Product":
            out["name"] = (data.get("name") or "").strip()
            offers = data.get("offers", {})
            if isinstance(offers, list) and offers:
                offers = offers[0]
            if isinstance(offers, dict):
                out["price"] = offers.get("price") or offers.get("lowPrice")
                out["currency"] = offers.get("priceCurrency", "INR")
                avail = (offers.get("availability") or "").lower()
                out["in_stock"] = "instock" in avail or "in_stock" in avail
            desc = data.get("description") or ""
            if isinstance(desc, str):
                out["description"] = re.sub(r"\s+", " ", desc).strip()[:500]
            img = data.get("image")
            if isinstance(img, list) and img:
                img = img[0]
            out["image"] = img if isinstance(img, str) else None
            sku = data.get("sku") or data.get("mpn")
            if sku:
                out["sku"] = str(sku)
            break

    # Fallback: OpenGraph
    if not out.get("name"):
        og_title = re.search(r'<meta\s+property="og:title"\s+content="([^"]+)"', html)
        if og_title:
            out["name"] = og_title.group(1).strip()
    if not out.get("image"):
        og_image = re.search(r'<meta\s+property="og:image"\s+content="([^"]+)"', html)
        if og_image:
            out["image"] = og_image.group(1).strip()
    if "price" not in out:
        og_price = re.search(r'<meta\s+property="(?:og:price:amount|product:price:amount)"\s+content="([^"]+)"', html)
        if og_price:
            try:
                out["price"] = float(og_price.group(1))
            except ValueError:
                pass

    # Derive a slug from the URL tail (e.g. /shop/magnesium-bisglycinate-115)
    tail = url.rstrip("/").rsplit("/", 1)[-1]
    out["slug"] = tail
    # Numeric Odoo product ID is usually the last hyphen-separated segment
    m = re.search(r"-(\d+)$", tail)
    if m:
        out["odoo_id"] = int(m.group(1))

    return out if out.get("name") else None


# --- main ------------------------------------------------------------------

def main() -> int:
    print("→ trying sitemap.xml…", file=sys.stderr)
    urls = discover_via_sitemap()
    if urls:
        print(f"  ✓ sitemap yielded {len(urls)} product URLs", file=sys.stderr)
    else:
        print("  ✗ sitemap empty/blocked, falling back to /shop pagination crawl", file=sys.stderr)
        urls = discover_via_pagination()
        print(f"  ✓ pagination yielded {len(urls)} product URLs", file=sys.stderr)

    if not urls:
        print("\n✗ Found 0 product URLs. Check connectivity to vitaone.in:", file=sys.stderr)
        print(f"   curl -sI -A '{USER_AGENT[:40]}…' {BASE}/sitemap.xml", file=sys.stderr)
        return 2

    sorted_urls = sorted(urls)
    print(f"\n→ fetching {len(sorted_urls)} product pages…", file=sys.stderr)
    products: list[dict] = []
    for i, u in enumerate(sorted_urls, 1):
        if i % 10 == 0 or i == len(sorted_urls):
            print(f"  [{i}/{len(sorted_urls)}] processed", file=sys.stderr)
        p = parse_product(u)
        if p:
            products.append(p)
        time.sleep(0.3)

    out = {
        "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "referral_code": REFERRAL_CODE.lstrip("?"),
        "base_url": BASE,
        "count": len(products),
        "products": products,
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"\n✓ wrote {len(products)} products → {OUT.relative_to(Path.cwd()) if OUT.is_absolute() and Path.cwd() in OUT.parents else OUT}", file=sys.stderr)
    print("\nNext: commit the JSON to git so the AI suggester can read it.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
