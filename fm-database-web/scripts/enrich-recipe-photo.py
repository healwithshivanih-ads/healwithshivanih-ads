#!/usr/bin/env python3
"""Attach a recipe-inbox candidate's photo to an EXISTING library recipe.

The dedup gate flags a forward as a duplicate of a recipe already in the
library. When the forward carries a photo the existing recipe lacks, the
coach shouldn't have to choose between a messy duplicate and losing the
image — this attaches the forwarded photo (credited) to the recipe she
already has, then marks the candidate merged.

Reuses the same image path as approve: download the captured og:image via
recipe-image-from-url.py (--no-qc, free) or copy the forwarded photo, then
write the target recipe's image block (credit + source_url + rights_status
web_reference_uncleared).

Reads JSON from stdin:  { "candidate_id": "rc-...", "target_slug": "..." }
Writes JSON to stdout:  { "ok": bool, "target_slug": str, "img": str|null, "error": str|null }
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

SCRIPTS_DIR = Path(__file__).resolve().parent
FMDB_ROOT = SCRIPTS_DIR.parent.parent / "fm-database"
RECIPES_DIR = FMDB_ROOT / "data" / "_recipes"
PLANS_ROOT = Path(os.environ.get("FMDB_PLANS_DIR") or (Path.home() / "fm-plans"))
INBOX_DIR = PLANS_ROOT / "_recipe_inbox"
WEB_IMG_DIR = SCRIPTS_DIR.parent / "public" / "recipe-images" / "images" / "web"


def _fail(msg: str) -> None:
    json.dump({"ok": False, "target_slug": None, "img": None, "error": msg}, sys.stdout)
    sys.exit(0)


def _write_image_block(slug: str, rel_file: str, source_url: str, credit: str) -> None:
    p = RECIPES_DIR / f"{slug}.yaml"
    txt = p.read_text()
    c = (credit or "forwarded photo").replace("'", "''")
    block = (
        "image:\n"
        f"  file: {rel_file}\n"
        f"  credit: '{c}'\n"
        + (f"  source_url: {source_url}\n" if source_url else "")
        + "  rights_status: web_reference_uncleared\n"
        "  note: forwarded photo; replace with licensed or original before any external use\n"
    )
    if re.search(r"^image:", txt, re.M):
        txt = re.sub(r"^image:\n(?:[ \t]+.*\n?)*", block, txt, count=1, flags=re.M)
    else:
        txt = txt.rstrip() + "\n" + block
    p.write_text(txt)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        _fail("invalid JSON on stdin")
    cid = str(payload.get("candidate_id", ""))
    slug = str(payload.get("target_slug", ""))
    if not re.fullmatch(r"rc-[a-z0-9\-]+", cid):
        _fail(f"bad candidate_id: {cid!r}")
    if not re.fullmatch(r"[a-z0-9\-]+", slug) or not (RECIPES_DIR / f"{slug}.yaml").exists():
        _fail(f"target recipe not found: {slug}")
    cpath = INBOX_DIR / f"{cid}.yaml"
    if not cpath.exists():
        _fail(f"candidate not found: {cid}")

    candidate = yaml.safe_load(cpath.read_text()) or {}
    credit = str(candidate.get("image_credit") or "").strip()
    source_url = str(candidate.get("source_url") or "")

    media_file = candidate.get("media_file")
    img_url = candidate.get("image_url")
    if not media_file and not img_url:
        _fail("this candidate has no photo to use")

    try:
        if media_file:
            src = INBOX_DIR / str(media_file)
            if not src.exists():
                _fail("forwarded photo file is missing")
            WEB_IMG_DIR.mkdir(parents=True, exist_ok=True)
            dst = WEB_IMG_DIR / f"{slug}.jpg"
            if src.suffix.lower() in (".jpg", ".jpeg"):
                shutil.copyfile(src, dst)
            else:
                r = subprocess.run(
                    ["sips", "-s", "format", "jpeg", str(src), "--out", str(dst)],
                    capture_output=True,
                )
                if r.returncode != 0:
                    shutil.copyfile(src, dst)
            _write_image_block(slug, f"images/web/{slug}.jpg", source_url, credit or "forwarded photo")
            img = f"/recipe-images/images/web/{slug}.jpg"
        else:
            args = [sys.executable, str(SCRIPTS_DIR / "recipe-image-from-url.py"),
                    slug, str(img_url), "--no-qc"]
            if credit:
                args += ["--credit", credit]
            r = subprocess.run(args, capture_output=True, text=True, timeout=60)
            out = {}
            try:
                out = json.loads(r.stdout or "{}")
            except Exception:
                pass
            if not out.get("ok"):
                _fail(out.get("error", "couldn't download the photo"))
            img = out.get("img")
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        _fail(str(e))

    candidate["status"] = "merged"
    candidate["merged_into"] = slug
    candidate["merged_at"] = datetime.now(timezone.utc).isoformat()
    cpath.write_text(yaml.safe_dump(candidate, sort_keys=False, allow_unicode=True))

    json.dump({"ok": True, "target_slug": slug, "img": img, "error": None}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
