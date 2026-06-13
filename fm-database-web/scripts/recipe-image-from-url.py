#!/usr/bin/env python3
"""Download an image from a URL, QC with Haiku, crop, save to web images dir,
and write the image: block to the recipe YAML.

Usage:
  recipe-image-from-url.py <slug> <url> [--dish "Dish name"] [--no-qc]
"""
import sys, os, json, re, subprocess, urllib.request, tempfile, argparse, base64

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WEB_IMG = os.path.join(ROOT, "public", "recipe-images", "images", "web")
RECIPES = os.path.abspath(os.path.join(ROOT, "..", "fm-database", "data", "_recipes"))
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")


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
    import anthropic
    client = anthropic.Anthropic(api_key=_load_key())
    data = open(jpg_path, "rb").read()
    mt = ("image/png" if data[:8] == b"\x89PNG\r\n\x1a\n"
          else "image/webp" if data[:4] == b"RIFF" and data[8:12] == b"WEBP"
          else "image/gif" if data[:6] in (b"GIF87a", b"GIF89a")
          else "image/jpeg")
    b64 = base64.b64encode(data).decode()
    try:
        msg = client.messages.create(
            model="claude-haiku-4-5", max_tokens=120,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": mt, "data": b64}},
                {"type": "text", "text":
                 f'This image is a candidate photo for the dish "{dish}". '
                 "Rate how well it shows THIS specific dish as a finished plated food, "
                 "0-5 (5 = clearly this exact dish, appetising, no text/watermark/collage; "
                 "3 = a similar/related dish; 0 = unrelated). "
                 'Reply ONLY compact JSON: {"score": N, "why": "..."}.'}]}])
        txt = msg.content[0].text
        m = re.search(r'"score"\s*:\s*([0-5])', txt)
        why = re.search(r'"why"\s*:\s*"([^"]+)"', txt)
        score = int(m.group(1)) if m else 0
        reason = why.group(1) if why else ""
        return score, reason
    except Exception as e:
        return -1, str(e)


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
    w, h = dims(src)
    if not w:
        return False
    target_w = w
    target_h = int(round(w * 2 / 3))
    if target_h > h:
        target_h = h
        target_w = int(round(h * 3 / 2))
    subprocess.run(["sips", "--cropToHeightWidth", str(target_h), str(target_w),
                    src, "--out", dst], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    cw, _ = dims(dst)
    if cw > 1400:
        subprocess.run(["sips", "--resampleWidth", "1400", dst],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return os.path.exists(dst)


def write_image_block(yaml_path, rel_file, source_url):
    txt = open(yaml_path, encoding="utf-8").read()
    block = (
        "image:\n"
        f"  file: {rel_file}\n"
        "  credit: web reference (coach-selected)\n"
        f"  source_url: {source_url}\n"
        "  rights_status: web_reference_uncleared\n"
        "  note: coach-selected image; replace with licensed or original photo\n"
        "    before any external/commercial use\n"
    )
    if re.search(r"^image:", txt, re.M):
        txt = re.sub(r"^image:\n(?:[ \t]+.*\n?)*", block, txt, count=1, flags=re.M)
    else:
        if re.search(r"^sources:", txt, re.M):
            txt = re.sub(r"^sources:", block + "sources:", txt, count=1, flags=re.M)
        else:
            txt = txt.rstrip() + "\n" + block
    open(yaml_path, "w", encoding="utf-8").write(txt)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("url")
    ap.add_argument("--dish", default="")
    ap.add_argument("--no-qc", action="store_true")
    args = ap.parse_args()

    recipe_path = os.path.join(RECIPES, args.slug + ".yaml")
    if not os.path.exists(recipe_path):
        print(json.dumps({"ok": False, "error": f"No recipe YAML for {args.slug}"}))
        sys.exit(1)

    # download
    try:
        req = urllib.request.Request(args.url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Download failed: {e}"}))
        sys.exit(1)

    if len(raw) < 20_000:
        print(json.dumps({"ok": False, "error": "Image too small (<20KB)"}))
        sys.exit(1)

    tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False).name
    open(tmp, "wb").write(raw)

    w, h = dims(tmp)
    if w < 300 or h < 200:
        os.unlink(tmp)
        print(json.dumps({"ok": False, "error": f"Image too small ({w}×{h})"}))
        sys.exit(1)

    score, why = (5, "qc skipped") if args.no_qc else qc_score(args.dish or args.slug, tmp)

    dst = os.path.join(WEB_IMG, args.slug + ".jpg")
    if not crop_band(tmp, dst):
        os.unlink(tmp)
        print(json.dumps({"ok": False, "error": "Crop failed"}))
        sys.exit(1)
    os.unlink(tmp)

    write_image_block(recipe_path, f"images/web/{args.slug}.jpg", args.url)

    print(json.dumps({
        "ok": True,
        "slug": args.slug,
        "score": score,
        "why": why,
        "img": f"/recipe-images/images/web/{args.slug}.jpg",
    }))


if __name__ == "__main__":
    main()
