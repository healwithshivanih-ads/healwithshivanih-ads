#!/usr/bin/env python3
"""Source a recipe photo per dish via DuckDuckGo image search.

For each dish: query DDG images → download the first viable photo → crop a
centred landscape band (drops most title/watermark strips) → save to
public/recipe-images/images/web/<slug>.jpg → write the image: block into the
recipe YAML (only when the recipe file exists). Auto-approve; misses + every
chosen source URL go into a report for spot-fixing.

Usage:
  source-recipe-images.py <dishlist.json> [--limit N] [--only slug,slug]
                          [--replace-book] [--report out.json]
"""
import sys, os, json, re, subprocess, urllib.parse, urllib.request, tempfile, argparse, glob, base64

# ---- Haiku vision QC --------------------------------------------------------
_CLIENT = None


def _load_key():
    env = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..",
                                       "fm-database", ".env"))
    if os.path.exists(env):
        for ln in open(env):
            ln = ln.strip()
            if ln.startswith("export "):
                ln = ln[7:]
            if ln.startswith("ANTHROPIC_API_KEY="):
                return ln.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("ANTHROPIC_API_KEY")


def qc_score(dish, jpg_path):
    """Haiku vision: does this photo show `dish`? → int 0-5 (5 = clearly this dish)."""
    global _CLIENT
    if _CLIENT is None:
        import anthropic
        _CLIENT = anthropic.Anthropic(api_key=_load_key())
    data = open(jpg_path, "rb").read()
    mt = ("image/png" if data[:8] == b"\x89PNG\r\n\x1a\n"
          else "image/webp" if data[:4] == b"RIFF" and data[8:12] == b"WEBP"
          else "image/gif" if data[:6] in (b"GIF87a", b"GIF89a")
          else "image/jpeg")
    b64 = base64.b64encode(data).decode()
    try:
        msg = _CLIENT.messages.create(
            model="claude-haiku-4-5", max_tokens=120,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64",
                 "media_type": mt, "data": b64}},
                {"type": "text", "text":
                 f'This image is a candidate photo for the dish "{dish}". '
                 "Rate how well it shows THIS specific dish as a finished plated food, "
                 "0-5 (5 = clearly this exact dish, appetising, no text/watermark/collage; "
                 "3 = a similar/related dish; 0 = unrelated, raw ingredients, a person, "
                 "or a graphic). Reply ONLY compact JSON: {\"score\": N, \"why\": \"...\"}."}]}])
        txt = msg.content[0].text
        m = re.search(r'"score"\s*:\s*([0-5])', txt)
        return int(m.group(1)) if m else 0
    except Exception as e:
        sys.stderr.write(f"  qc error: {e}\n")
        return -1  # treat as inconclusive → hold

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WEB_IMG = os.path.join(ROOT, "public", "recipe-images", "images", "web")
RECIPES = os.path.abspath(os.path.join(ROOT, "..", "fm-database", "data", "_recipes"))
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")
BAD_HOSTS = ("lookaside", "fbcdn", "gstatic", "ytimg", "pinimg/originals/placeholder")


def http(url, binary=False, referer="https://duckduckgo.com/"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": referer})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read() if binary else r.read().decode("utf-8", "ignore")


def ddg_images(query, n=6):
    """Return up to n candidate image URLs (largest first-ish)."""
    seed = "https://duckduckgo.com/?q=%s&iax=images&ia=images" % urllib.parse.quote(query)
    html = http(seed)
    m = re.search(r"vqd=([0-9-]+)", html)
    if not m:
        return []
    vqd = m.group(1)
    api = ("https://duckduckgo.com/i.js?l=us-en&o=json&q=%s&vqd=%s&f=,,,&p=1"
           % (urllib.parse.quote(query), vqd))
    try:
        data = json.loads(http(api))
    except Exception:
        return []
    out = []
    for r in data.get("results", []):
        u = r.get("image")
        if not u or any(b in u for b in BAD_HOSTS):
            continue
        if r.get("width", 0) and r["width"] < 500:
            continue
        out.append(u)
        if len(out) >= n:
            break
    return out


def dims(path):
    try:
        o = subprocess.check_output(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
                                    stderr=subprocess.DEVNULL).decode()
        w = int(re.search(r"pixelWidth: (\d+)", o).group(1))
        h = int(re.search(r"pixelHeight: (\d+)", o).group(1))
        return w, h
    except Exception:
        return 0, 0


def crop_band(src, dst):
    """Crop a centred 3:2 landscape band → drops most top/bottom watermark strips."""
    w, h = dims(src)
    if not w:
        return False
    target_w = w
    target_h = int(round(w * 2 / 3))
    if target_h > h:  # already wide — crop width instead
        target_h = h
        target_w = int(round(h * 3 / 2))
    subprocess.run(["sips", "--cropToHeightWidth", str(target_h), str(target_w),
                    src, "--out", dst], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # downscale very large crops to keep the repo light
    cw, _ = dims(dst)
    if cw > 1400:
        subprocess.run(["sips", "--resampleWidth", "1400", dst],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return os.path.exists(dst)


def recipe_path_for(slug, library_slug):
    """Write ONLY to a recipe whose filename == the dish slug. The fuzzy
    library match (kodo↔foxtail↔sama 'millet upma', moong↔palak 'dal')
    is too loose to use as a write target — it corrupts the wrong file.
    If no exact-slug recipe exists yet, defer (recipe-creation makes it)."""
    p = os.path.join(RECIPES, slug + ".yaml")
    return p if os.path.exists(p) else None


def write_image_block(yaml_path, rel_file, source_url):
    txt = open(yaml_path, encoding="utf-8").read()
    block = (
        "image:\n"
        f"  file: {rel_file}\n"
        "  credit: web reference (auto-sourced)\n"
        f"  source_url: {source_url}\n"
        "  rights_status: web_reference_uncleared\n"
        "  note: auto-sourced + cropped for internal-app reference; replace with\n"
        "    licensed or original photo before any external/commercial use\n"
    )
    if re.search(r"^image:\s*$", txt, re.M):
        # replace existing image: ... block (until next top-level key)
        txt = re.sub(r"^image:\n(?:[ \t]+.*\n?)*", block, txt, count=1, flags=re.M)
    else:
        # insert before sources: (or append)
        if re.search(r"^sources:", txt, re.M):
            txt = re.sub(r"^sources:", block + "sources:", txt, count=1, flags=re.M)
        else:
            txt = txt.rstrip() + "\n" + block
    open(yaml_path, "w", encoding="utf-8").write(txt)


def has_web_image(yaml_path):
    txt = open(yaml_path, encoding="utf-8").read()
    return "images/web/" in txt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dishlist")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", default="")
    ap.add_argument("--replace-book", action="store_true",
                    help="also re-source dishes whose recipe currently uses a book image")
    ap.add_argument("--report", default="/tmp/recipe-image-report.json")
    ap.add_argument("--recipes-only", action="store_true",
                    help="skip dishes that have no recipe YAML yet")
    ap.add_argument("--qc", action="store_true",
                    help="Haiku vision QC; auto-publish score>=4, hold the rest")
    args = ap.parse_args()

    os.makedirs(WEB_IMG, exist_ok=True)
    dishes = json.load(open(args.dishlist))
    only = set(s.strip() for s in args.only.split(",") if s.strip())
    report = {"done": [], "held": [], "skipped": [], "failed": []}
    n = 0
    for d in dishes:
        slug = d["slug"]
        if only and slug not in only:
            continue
        rp = recipe_path_for(slug, d.get("library_slug"))
        if not rp:
            if args.recipes_only:
                report["skipped"].append({"slug": slug, "why": "no recipe yaml"})
                continue
            report["skipped"].append({"slug": slug, "why": "no recipe yaml (image deferred)"})
            continue
        if has_web_image(rp) and not args.replace_book:
            report["skipped"].append({"slug": slug, "why": "already has web image"})
            continue
        # source
        cands = []
        try:
            cands = ddg_images(d["query"])
        except Exception as e:
            report["failed"].append({"slug": slug, "why": f"search: {e}"})
            continue
        # download + QC up to 3 viable candidates; keep the best score
        best = None  # (score, tmp_path, url)
        tried = 0
        for url in cands:
            if tried >= 3:
                break
            try:
                raw = http(url, binary=True, referer="https://duckduckgo.com/")
            except Exception:
                continue
            if len(raw) < 40_000:
                continue
            tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False).name
            open(tmp, "wb").write(raw)
            w, h = dims(tmp)
            if w < 500 or h < 400:
                os.unlink(tmp); continue
            tried += 1
            sc = qc_score(d["dish"], tmp) if args.qc else 5
            if best is None or sc > best[0]:
                if best:
                    os.unlink(best[1])
                best = (sc, tmp, url)
            else:
                os.unlink(tmp)
            if best and best[0] >= 5:
                break  # perfect — stop early, save Haiku calls
        if not best:
            report["failed"].append({"slug": slug, "why": "no viable image", "dish": d["dish"]})
            continue
        score, tmp, url = best
        if score >= 4:  # auto-publish gate
            dst = os.path.join(WEB_IMG, slug + ".jpg")
            if crop_band(tmp, dst):
                write_image_block(rp, f"images/web/{slug}.jpg", url)
                report["done"].append({"slug": slug, "url": url, "score": score,
                                       "dish": d["dish"]})
        else:  # hold for review
            report["held"].append({"slug": slug, "url": url, "score": score,
                                   "dish": d["dish"]})
        os.unlink(tmp)
        n += 1
        if args.limit and n >= args.limit:
            break

    json.dump(report, open(args.report, "w"), indent=2)
    print(f"published={len(report['done'])} held={len(report['held'])} "
          f"skipped={len(report['skipped'])} failed={len(report['failed'])}  "
          f"report={args.report}")
    for h in report["held"]:
        print("  HELD", h["slug"], f"(score {h.get('score')})", "-", h["dish"])
    for f in report["failed"]:
        print("  FAIL", f["slug"], "-", f.get("why"))


if __name__ == "__main__":
    main()
