#!/usr/bin/env python3
"""Parse a staged recipe-inbox candidate into a structured recipe draft.

Candidates land in ~/fm-plans/_recipe_inbox/ from the WhatsApp webhook
(forwarded reels / cookbook photos / PDFs) or the /recipes "Add manually"
card. This shim turns one candidate's raw material (caption text, source
URL, attached image or PDF) into a draft matching the _recipes library
schema, written back onto the candidate as `parsed:` for coach review.
Nothing touches the library until approve-recipe-candidate.py runs.

Model choice (API-economy): claude-haiku-4-5 for text + images;
claude-sonnet-4-6 only when the attachment is a PDF document.

Instagram links: reels usually carry the full recipe in the caption. When
the forwarded message has only a URL, we try a best-effort anonymous fetch
of the page's og:description meta (public posts often expose the caption
there). If that fails the shim returns a friendly error telling the coach
to paste the caption text instead — never a hard crash.

Reads JSON from stdin:  { "candidate_id": "rc-..." , "dry_run": bool? }
Writes JSON to stdout:  { "ok": bool, "candidate": {...} | null, "error": str|null }
"""
from __future__ import annotations

import base64
import html as html_lib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

SCRIPTS_DIR = Path(__file__).resolve().parent
FMDB_ROOT = SCRIPTS_DIR.parent.parent / "fm-database"
PLANS_ROOT = Path(os.environ.get("FMDB_PLANS_DIR") or (Path.home() / "fm-plans"))
INBOX_DIR = PLANS_ROOT / "_recipe_inbox"

HAIKU = "claude-haiku-4-5"
SONNET = "claude-sonnet-4-6"

sys.path.insert(0, str(FMDB_ROOT))


def _load_env() -> None:
    env = FMDB_ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[len("export "):]
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _fail(msg: str) -> None:
    json.dump({"ok": False, "candidate": None, "error": msg}, sys.stdout)
    sys.exit(0)


_LIST_FIELDS = ("meal_type", "diet", "seasons", "balances_dosha", "aggravates_dosha",
                "rasa", "main_ingredients", "contains_allergens", "steps", "ingredients")


def _coerce_list(v):
    """Tool-use occasionally serialises an array field as a STRING (a JSON
    array, or newline/numbered text). Coerce back to a real list so the
    review UI and approve gate never choke on a str where a list belongs."""
    if isinstance(v, list) or v is None:
        return v
    if isinstance(v, str):
        s = v.strip().rstrip(",").strip()  # models sometimes append a trailing comma
        if s.startswith("["):
            cleaned = re.sub(r",(\s*[\]}])", r"\1", s)  # drop trailing commas inside
            if cleaned.endswith("]"):
                try:
                    parsed = json.loads(cleaned)
                    if isinstance(parsed, list):
                        return [str(x) for x in parsed]
                except Exception:
                    pass
            quoted = re.findall(r'"((?:[^"\\]|\\.)*)"', s)  # pull quoted items
            if quoted:
                return [q.replace('\\"', '"') for q in quoted]
        # plain string: split on newlines, dropping list bullets / numbering
        parts = [re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", ln).strip()
                 for ln in s.splitlines() if ln.strip()]
        return parts or [s]
    return [v]


def _normalize_lists(parsed: dict) -> None:
    """Force every list-typed recipe field to an actual list, in place."""
    for f in _LIST_FIELDS:
        if f in parsed:
            parsed[f] = _coerce_list(parsed[f])
    # ingredients must be a list of dicts, not strings
    ings = parsed.get("ingredients")
    if isinstance(ings, list):
        parsed["ingredients"] = [
            i if isinstance(i, dict) else {"item": str(i), "qty": "", "unit": ""}
            for i in ings
        ]


def _is_instagram(url: str) -> bool:
    return "instagram.com" in (url or "").lower()


def _fetch_og_description(url: str) -> str | None:
    """Anonymous fetch of a page's og:description — works for many public
    Instagram posts; returns None on any failure (login wall, timeout...)."""
    try:
        import requests

        resp = requests.get(
            url,
            timeout=8,
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
        )
        if resp.status_code != 200:
            return None
        m = re.search(
            r'<meta[^>]+property="og:description"[^>]+content="([^"]+)"', resp.text
        ) or re.search(
            r'<meta[^>]+content="([^"]+)"[^>]+property="og:description"', resp.text
        )
        if not m:
            return None
        text = html_lib.unescape(m.group(1)).strip()
        return text if len(text) > 40 else None
    except Exception:
        return None


def _fetch_og_image(url: str) -> tuple[str | None, str | None]:
    """Return (image_url, credit) for a page's hero photo, from og:image /
    twitter:image. Skips obvious logos/favicons. credit is the source host or
    @handle so the recipe can attribute it. (None, None) on any failure."""
    try:
        import requests
        from urllib.parse import urljoin, urlparse

        resp = requests.get(url, timeout=10, headers=_BROWSER_HEADERS)
        if resp.status_code != 200:
            return None, None
        img = None
        for pat in (
            r'<meta[^>]+property="og:image(?::secure_url)?"[^>]+content="([^"]+)"',
            r'<meta[^>]+content="([^"]+)"[^>]+property="og:image"',
            r'<meta[^>]+name="twitter:image"[^>]+content="([^"]+)"',
        ):
            m = re.search(pat, resp.text)
            if m:
                img = html_lib.unescape(m.group(1)).strip()
                break
        if not img:
            return None, None
        img = urljoin(url, img)
        low = img.lower()
        if any(bad in low for bad in ("favicon", "logo", "sprite", "icon", "avatar")):
            return None, None
        host = urlparse(url).netloc.replace("www.", "")
        if "instagram.com" in host:
            m = re.search(r"instagram\.com/([^/?#]+)", url)
            credit = f"@{m.group(1)}" if m and m.group(1) not in ("reel", "p") else host
        else:
            credit = host
        return img, credit
    except Exception:
        return None, None


# Browser-like headers so recipe sites don't reject the fetch as a bare bot.
_BROWSER_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
                   "(KHTML, like Gecko) Version/17.0 Safari/605.1.15"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.google.com/",
}

# Sentinel returned when the site actively blocks automated reading (403/429 /
# bot challenge) — the caller turns this into a "paste the text" message that
# names the block, instead of a generic "nothing parseable".
_BLOCKED = "\x00BLOCKED\x00"


def _find_recipe_jsonld(text: str) -> dict | None:
    """Most recipe sites embed a schema.org Recipe as JSON-LD — the cleanest,
    most reliable source of ingredients + steps. Return the Recipe object."""
    def walk(obj):
        if isinstance(obj, dict):
            t = obj.get("@type")
            if t == "Recipe" or (isinstance(t, list) and "Recipe" in t):
                return obj
            for v in obj.values():
                r = walk(v)
                if r:
                    return r
        elif isinstance(obj, list):
            for v in obj:
                r = walk(v)
                if r:
                    return r
        return None

    for block in re.findall(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',
                            text, re.S):
        try:
            rec = walk(json.loads(block.strip()))
            if rec:
                return rec
        except Exception:
            continue
    return None


def _jsonld_to_text(rec: dict) -> str | None:
    """Format a schema.org Recipe into clean plain text for the extractor."""
    name = str(rec.get("name") or "").strip()
    ings = rec.get("recipeIngredient") or rec.get("ingredients") or []
    if isinstance(ings, str):
        ings = [ings]
    instr = rec.get("recipeInstructions") or []

    def flat_steps(x):
        out = []
        if isinstance(x, str):
            out.append(x)
        elif isinstance(x, dict):
            if x.get("@type") == "HowToSection":
                for s in x.get("itemListElement") or []:
                    out += flat_steps(s)
            else:
                t = x.get("text") or x.get("name")
                if t:
                    out.append(str(t))
        elif isinstance(x, list):
            for s in x:
                out += flat_steps(s)
        return out

    steps = flat_steps(instr)
    if not ings and not steps:
        return None
    parts = []
    if name:
        parts.append(name)
    y = rec.get("recipeYield")
    if y:
        parts.append(f"Serves: {y if isinstance(y, str) else (y[0] if isinstance(y, list) and y else y)}")
    for k in ("prepTime", "cookTime", "totalTime"):
        if rec.get(k):
            parts.append(f"{k}: {rec[k]}")
    if ings:
        parts.append("\nIngredients:\n" + "\n".join(f"- {html_lib.unescape(str(i))}" for i in ings))
    if steps:
        parts.append("\nInstructions:\n" + "\n".join(
            f"{n}. {html_lib.unescape(s)}" for n, s in enumerate(steps, 1)))
    return "\n".join(parts).strip()


def _fetch_page_text(url: str, cap: int = 7000) -> str | None:
    """Fetch a recipe web page and return clean recipe text. Prefers the
    embedded schema.org Recipe (JSON-LD); falls back to the html2text body.
    Returns _BLOCKED when the site rejects automated reading, None otherwise."""
    try:
        import requests

        resp = requests.get(url, timeout=12, headers=_BROWSER_HEADERS)
        if resp.status_code in (403, 401, 429) or (
            resp.status_code == 200
            and re.search(r"(?i)just a moment|attention required|enable javascript|cf-browser-verification|access denied", resp.text[:4000])
        ):
            return _BLOCKED
        if resp.status_code != 200:
            return None
        raw = resp.text

        # 1) schema.org Recipe — cleanest, most reliable
        rec = _find_recipe_jsonld(raw)
        if rec:
            structured = _jsonld_to_text(rec)
            if structured and len(structured) > 80:
                return structured[:cap]

        # 2) fall back to the page body
        stripped = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", raw, flags=re.I | re.S)
        try:
            import html2text

            h = html2text.HTML2Text()
            h.ignore_links = True
            h.ignore_images = True
            h.body_width = 0
            body = h.handle(stripped)
        except Exception:
            body = html_lib.unescape(re.sub(r"<[^>]+>", " ", stripped))
        body = re.sub(r"\n{3,}", "\n\n", body).strip()
        m = re.search(r"(?im)^\s*#*\s*ingredients?\b", body)
        if m and m.start() > 400:
            body = body[max(0, m.start() - 200):]
        return body[:cap] if len(body) > 120 else None
    except Exception:
        return None


RECIPE_TOOL = {
    "name": "record_recipe",
    "description": "Record the structured recipe extracted from the material.",
    "input_schema": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Dish name, title case"},
            "meal_type": {
                "type": "array",
                "items": {"type": "string", "enum": [
                    "breakfast", "lunch", "dinner", "snack", "side", "drink",
                    "salad", "soup", "condiment"]},
            },
            "diet": {
                "type": "array",
                "items": {"type": "string", "enum": [
                    "vegetarian", "vegan", "jain", "eggetarian",
                    "non_vegetarian", "gluten_free", "dairy_free", "nut_free"]},
                "description": "Derived strictly from the ingredient list",
            },
            "region": {"type": "string"},
            "seasons": {
                "type": "array",
                "items": {"type": "string", "enum": [
                    "spring", "summer", "monsoon", "autumn", "winter", "all"]},
            },
            "balances_dosha": {
                "type": "array",
                "items": {"type": "string", "enum": ["vata", "pitta", "kapha"]},
                "description": "Only if clearly inferable; else empty — coach fills in",
            },
            "aggravates_dosha": {
                "type": "array",
                "items": {"type": "string", "enum": ["vata", "pitta", "kapha"]},
            },
            "rasa": {
                "type": "array",
                "items": {"type": "string", "enum": [
                    "sweet", "sour", "salty", "pungent", "bitter", "astringent"]},
            },
            "main_ingredients": {
                "type": "array", "items": {"type": "string"},
                "description": "Lowercased key ingredient names",
            },
            "contains_allergens": {
                "type": "array",
                "items": {"type": "string", "enum": [
                    "dairy", "gluten", "nuts", "peanut", "soy", "egg",
                    "shellfish", "sesame", "mustard"]},
            },
            "ingredients": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "item": {"type": "string"},
                        "qty": {"type": "string"},
                        "unit": {"type": "string"},
                    },
                    "required": ["item", "qty", "unit"],
                },
            },
            "steps": {
                "type": "array", "items": {"type": "string"},
                "description": "Method rewritten in YOUR OWN words — never the author's prose",
            },
            "servings": {"type": "string"},
            "prep_time_min": {"type": "integer"},
            "cook_time_min": {"type": "integer"},
            "one_line": {"type": "string", "description": "One-sentence description in our own words"},
            "headnote": {"type": "string", "description": "Short warm note on why/when this dish works"},
            "attribution_author": {
                "type": "string",
                "description": "Creator handle / author / book if identifiable, else empty string",
            },
            "parse_notes": {
                "type": "string",
                "description": "Anything estimated or uncertain (e.g. 'quantities not stated in reel — home-cook estimates used')",
            },
        },
        "required": [
            "name", "meal_type", "diet", "seasons", "main_ingredients",
            "contains_allergens", "ingredients", "steps", "servings", "one_line",
        ],
    },
}

SYSTEM_PROMPT = """You extract structured recipes for an Indian functional-medicine coach's
curated recipe library. The material may be an Instagram reel caption, a photographed
cookbook page or handwritten recipe, or a recipe PDF.

Rules:
1. Ingredient lists are facts — capture items and quantities faithfully. If quantities
   are NOT stated, give sensible home-cook estimates and say so in parse_notes. Never
   leave qty blank when an amount is guessable; use unit conventions tsp/tbsp/cup/g/whole.
1b. HOME PORTIONS: if the source is scaled for many servings (canteen / institutional /
   catering — e.g. serves 50-100, quantities in pounds/quarts), RESCALE the whole recipe
   down to a normal home batch of 2-4 servings and convert to Indian home units
   (cups/tbsp/tsp/g). Set servings to that small number. Note the rescale in parse_notes.
   Also prefer Indian pantry equivalents where natural (e.g. mixed vegetables, local
   greens) without changing the dish's character.
2. Method steps and descriptions must be REWRITTEN in your own words (copyright) —
   concise, home-kitchen instructions. Never copy the author's prose.
3. diet[] is derived strictly from ingredients: meat/fish/prawns -> non_vegetarian;
   egg (no meat) -> eggetarian; no animal flesh/egg -> vegetarian; additionally vegan
   if no dairy/ghee/honey; gluten_free / dairy_free / nut_free when true. jain ONLY if
   no onion, garlic, or root vegetables.
4. contains_allergens conservative: dairy (milk/paneer/yogurt/cheese — NOT ghee),
   gluten (wheat/barley/rye), nuts (tree nuts), peanut, soy, egg, shellfish, sesame.
5. balances_dosha / aggravates_dosha / rasa: fill only when clearly inferable from the
   ingredients (warming/cooling/heavy/light); otherwise return empty arrays — the coach
   completes them.
6. seasons: ["all"] unless the dish is clearly seasonal.
7. one_line + headnote in a warm, plain voice. No hype, no exclamation marks.
8. attribution_author: the creator's handle or name if visible in the material, else "".
9. If the material does NOT actually contain a recipe (e.g. just a link preview with no
   ingredients and nothing readable), still call the tool but set name to "" — that
   signals unparseable."""


def main() -> int:
    _load_env()
    try:
        payload = json.load(sys.stdin)
    except Exception:
        _fail("invalid JSON on stdin")
    cid = str(payload.get("candidate_id", ""))
    if not re.fullmatch(r"rc-[a-z0-9\-]+", cid):
        _fail(f"bad candidate_id: {cid!r}")
    cpath = INBOX_DIR / f"{cid}.yaml"
    if not cpath.exists():
        _fail(f"candidate not found: {cid}")

    candidate = yaml.safe_load(cpath.read_text()) or {}
    text = str(candidate.get("text") or "").strip()
    source_url = candidate.get("source_url")
    media_file = candidate.get("media_file")
    media_mime = str(candidate.get("media_mime") or "")

    # Enrich a bare instagram/web link with the page's og:description caption.
    fetched_caption = None
    if source_url and len(re.sub(r"https?://\S+", "", text).strip()) < 40:
        url = str(source_url)
        if _is_instagram(url):
            # Instagram: the recipe lives in the caption; full-page fetch hits a
            # login wall, so og:description is the best anonymous signal.
            fetched_caption = _fetch_og_description(url)
            if fetched_caption:
                text = f"{text}\n\n[caption fetched from link]\n{fetched_caption}"
        else:
            # Any other recipe site (blog / Harvard / etc.): the ingredients +
            # method are in the page body — fetch and convert the whole page.
            page = _fetch_page_text(url)
            if page == _BLOCKED:
                from urllib.parse import urlparse
                host = urlparse(url).netloc.replace("www.", "")
                _fail(
                    f"{host} blocks automated reading, so I can't pull this recipe from the "
                    f"link. Two easy ways round it: open the page, copy the recipe text and "
                    f"paste it into the box above; or forward a screenshot of the recipe. "
                    f"Then parse again."
                )
            elif page:
                fetched_caption = True
                text = f"{text}\n\n[recipe page fetched from link]\n{page}"
            else:
                og = _fetch_og_description(url)
                if og:
                    fetched_caption = True
                    text = f"{text}\n\n[summary fetched from link]\n{og}"

    content: list[dict] = []
    model = HAIKU
    if media_file:
        mpath = INBOX_DIR / str(media_file)
        if mpath.exists():
            data = base64.standard_b64encode(mpath.read_bytes()).decode()
            if media_mime.startswith("image/"):
                content.append({
                    "type": "image",
                    "source": {"type": "base64", "media_type": media_mime, "data": data},
                })
            elif media_mime == "application/pdf":
                model = SONNET
                content.append({
                    "type": "document",
                    "source": {"type": "base64", "media_type": "application/pdf", "data": data},
                })
            # audio/video attachments can't be parsed here — the caption must carry it

    has_text = len(re.sub(r"https?://\S+", "", text).strip()) >= 40
    if not content and not has_text:
        _fail(
            "Nothing parseable yet — the link didn't expose its caption and there's no "
            "image/PDF. Paste the reel's caption text (or a screenshot) and parse again."
        )

    user_text = "Extract the recipe from this material.\n\n"
    if source_url:
        user_text += f"Source link: {source_url}\n"
    if text:
        user_text += f"\nText / caption:\n{text}\n"
    content.append({"type": "text", "text": user_text})

    if payload.get("dry_run"):
        parsed = {
            "name": "Dry Run Khichdi", "meal_type": ["dinner"], "diet": ["vegetarian"],
            "seasons": ["all"], "main_ingredients": ["moong dal", "rice"],
            "contains_allergens": [],
            "ingredients": [{"item": "moong dal", "qty": "0.5", "unit": "cup"}],
            "steps": ["Cook."], "servings": "2", "one_line": "Dry-run stub.",
        }
    else:
        try:
            sys.path.insert(0, str(SCRIPTS_DIR))
            from anthropic_client import build_client

            client = build_client()
            resp = client.messages.create(
                model=model,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": content}],
                tools=[RECIPE_TOOL],
                tool_choice={"type": "tool", "name": "record_recipe"},
            )
            parsed = None
            for block in resp.content:
                if block.type == "tool_use" and block.name == "record_recipe":
                    parsed = dict(block.input)
                    break
            if parsed is None:
                _fail("model returned no structured recipe")
            try:
                from fmdb.usage import log_usage  # type: ignore

                log_usage(client_id=None, script="parse-recipe-candidate",
                          model=model, usage=resp.usage, notes=f"candidate={cid}")
            except Exception:
                pass
        except Exception as e:  # noqa: BLE001
            _fail(f"parse failed: {e}")

    if not str(parsed.get("name") or "").strip():
        _fail(
            "The material didn't contain a readable recipe. Paste the caption text or "
            "attach a clearer photo, then parse again."
        )

    _normalize_lists(parsed)

    # Capture the source photo so the forwarded recipe keeps its own image
    # (attached on approve). A forwarded photo IS the image; a link exposes one
    # via og:image. Store the reference + a source credit on the candidate.
    if not candidate.get("image_url") and not media_file and source_url:
        img_url, credit = _fetch_og_image(str(source_url))
        if img_url:
            candidate["image_url"] = img_url
            candidate["image_credit"] = credit
    if media_file and not candidate.get("image_credit"):
        candidate["image_credit"] = "forwarded photo"

    candidate["parsed"] = parsed
    candidate["status"] = "parsed"
    candidate["parsed_at"] = datetime.now(timezone.utc).isoformat()
    candidate["parse_model"] = model
    if fetched_caption:
        candidate["fetched_caption"] = True
    cpath.write_text(yaml.safe_dump(candidate, sort_keys=False, allow_unicode=True))

    json.dump({"ok": True, "candidate": candidate, "error": None}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
