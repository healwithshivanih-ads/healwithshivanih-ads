#!/usr/bin/env python3
"""Scrape vitaone.in (Odoo eCommerce) → JSON catalog, with affiliate auth.

The affiliate-visible product list differs from the public catalog (more
products visible to logged-in affiliates). This script supports three auth
modes — pick whichever is convenient:

  Mode A (recommended) — Odoo email + password
      export VITAONE_EMAIL="shivanihari@gmail.com"
      export VITAONE_PASSWORD="<your password>"
      python3 scripts/vitaone-scrape.py

  Mode B — Odoo session cookie value only (faster, no creds at rest)
      # In Chrome: F12 → Application → Cookies → vitaone.in
      #            → copy the value of the `_ei_sid` cookie (Odoo's session
      #            name; NOT 'session_id' — vitaone uses _ei_sid)
      export VITAONE_SESSION_ID="<paste _ei_sid value>"
      python3 scripts/vitaone-scrape.py

  Mode C — full Cookie string (for sites behind Cloudflare cf_clearance)
      # In DevTools → Network → click the /shop request → Headers
      #            → copy entire `cookie` request header value
      export VITAONE_COOKIE="session_id=...; cf_clearance=...; ..."
      python3 scripts/vitaone-scrape.py

  Mode D — anonymous (public catalog only, no auth)
      python3 scripts/vitaone-scrape.py
      # WARNING: misses affiliate-only products

Output: scripts/vitaone-catalog.json
Re-run periodically to refresh — overwrites in-place.

Politeness:
  - 300ms delay between requests
  - Standard browser User-Agent
  - 3-retry exponential backoff on 429 / 5xx
  - Silent on 404 / 410
"""
from __future__ import annotations

import json
import os
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


# --- authentication --------------------------------------------------------

def _authed_marker_present(html: str) -> bool:
    """Heuristic: does this HTML look like the response sent to a logged-in
    user? Odoo storefronts typically render '/web/session/logout' or 'My
    Account' links once authenticated; the homepage shows 'Sign in' otherwise.
    """
    indicators = (
        "/web/session/logout",
        "/my/account",
        '"is_user_logged_in":true',
        "o_logged_in",
    )
    return any(s in html for s in indicators)


def authenticate() -> str:
    """Authenticate the requests.Session against vitaone. Returns a
    short string describing which mode was used (for logging)."""
    # Mode C — paste full Cookie header (highest priority — bypasses CF)
    cookie_full = os.environ.get("VITAONE_COOKIE")
    if cookie_full:
        session.headers["Cookie"] = cookie_full
        return f"Cookie header ({len(cookie_full)} chars)"

    # Mode B — Odoo session cookie alone. Vitaone uses `_ei_sid` (Odoo's
    # default session cookie name), NOT `session_id`. Set both for safety
    # in case a future Odoo upgrade ever switches.
    sid = os.environ.get("VITAONE_SESSION_ID")
    if sid:
        session.cookies.set("_ei_sid", sid, domain="vitaone.in")
        session.cookies.set("session_id", sid, domain="vitaone.in")
        return f"_ei_sid cookie ({sid[:6]}…)"

    # Mode A — email + password POST to /web/login (Odoo standard)
    email = os.environ.get("VITAONE_EMAIL")
    password = os.environ.get("VITAONE_PASSWORD")
    if email and password:
        # Step 1: GET the login page to seed CSRF token + initial cookies
        r = session.get(f"{BASE}/web/login", timeout=30)
        if r.status_code != 200:
            print(f"  ! /web/login GET → {r.status_code}; auth aborted", file=sys.stderr)
            return f"FAILED at GET (status {r.status_code})"
        m = re.search(r'name="csrf_token"\s+value="([^"]+)"', r.text)
        csrf = m.group(1) if m else None
        # Step 2: POST credentials
        payload = {"login": email, "password": password, "redirect": ""}
        if csrf:
            payload["csrf_token"] = csrf
        r2 = session.post(
            f"{BASE}/web/login",
            data=payload,
            timeout=30,
            allow_redirects=True,
        )
        # Odoo redirects to /web after successful login; failure stays on /web/login
        ok_url = "/web/login" not in r2.url
        ok_html = _authed_marker_present(r2.text)
        if ok_url or ok_html:
            return f"email+password (final URL: {r2.url})"
        # Look for an inline error message
        err_m = re.search(r'<p class="alert alert-danger[^"]*">(.*?)</p>', r2.text, re.DOTALL)
        err = re.sub(r"\s+", " ", err_m.group(1)).strip() if err_m else "no error message in HTML"
        print(f"  ! login POST appears to have failed: {err}", file=sys.stderr)
        return f"FAILED at POST ({err[:80]})"

    return "anonymous (no env vars set — public catalog only)"


def verify_auth() -> bool:
    """Probe /my/account — Odoo redirects anonymous users to /web/login.
    If we land on /my/account (not /web/login) and the HTML has logged-in
    markers, we're authenticated.
    """
    r = session.get(f"{BASE}/my/account", timeout=30, allow_redirects=True)
    if r.status_code != 200:
        return False
    if "/web/login" in r.url:
        return False
    return _authed_marker_present(r.text) or "/my/" in r.url


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
    # Authenticate (optional but strongly recommended for full catalog)
    print("→ authenticating…", file=sys.stderr)
    mode = authenticate()
    print(f"  mode: {mode}", file=sys.stderr)
    auth_verified = False
    if not mode.startswith("anonymous") and not mode.startswith("FAILED"):
        auth_verified = verify_auth()
        if auth_verified:
            print("  ✓ session shows logged-in markers", file=sys.stderr)
        else:
            print("  ⚠ logged-in markers not detected — auth may have silently failed.", file=sys.stderr)
            print("    Continuing anyway. If product count is the same as the public catalog,", file=sys.stderr)
            print("    your auth env vars probably didn't take. Re-check VITAONE_EMAIL/PASSWORD", file=sys.stderr)
            print("    or VITAONE_SESSION_ID, or use Mode C (VITAONE_COOKIE='full cookie header').", file=sys.stderr)
    elif mode.startswith("FAILED"):
        print("  ✗ authentication FAILED — proceeding as anonymous.", file=sys.stderr)
        print("    The output will be the public catalog only.", file=sys.stderr)
    else:
        print("  ⓘ no auth env vars set. Output will be the public catalog only.", file=sys.stderr)
        print("    Set VITAONE_EMAIL + VITAONE_PASSWORD (or VITAONE_SESSION_ID) and re-run", file=sys.stderr)
        print("    to capture affiliate-only products.", file=sys.stderr)

    print("\n→ trying sitemap.xml…", file=sys.stderr)
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
        "auth_mode": mode,
        "auth_verified": auth_verified,
        "count": len(products),
        "products": products,
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"\n✓ wrote {len(products)} products → {OUT.relative_to(Path.cwd()) if OUT.is_absolute() and Path.cwd() in OUT.parents else OUT}", file=sys.stderr)
    print("\nNext: commit the JSON to git so the AI suggester can read it.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
