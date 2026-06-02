#!/usr/bin/env python3
"""Render client handout Resources → fm-coach static folder (public/handouts/).

Run whenever a handout's text changes. Output is served by the app at
/handouts/<slug>.html (public — see middleware allowlist), so the WhatsApp
drip can link to https://<public-app-url>/handouts/<slug>.html.

Reads article-kind Resources from ~/fm-resources/resources/ (or
FMDB_RESOURCES_DIR), renders each via handout_brand (Deep Mind brand), and
writes <slug>.html. Generic educational content only — never client data.
"""
from __future__ import annotations

import glob
import os
import sys
from pathlib import Path

import yaml

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import handout_brand  # noqa: E402

RES_DIR = Path(os.path.expanduser(os.environ.get("FMDB_RESOURCES_DIR") or "~/fm-resources")) / "resources"
OUT_DIR = SCRIPTS.parent / "public" / "handouts"


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in sorted(glob.glob(str(RES_DIR / "*.yaml"))):
        try:
            d = yaml.safe_load(open(f)) or {}
        except Exception as e:
            print(f"  ! skip {f}: {e}")
            continue
        if d.get("kind") != "article" or d.get("status", "active") != "active":
            continue
        if d.get("audience") == "coach":
            continue
        html = handout_brand.render_handout(d.get("text", ""), d.get("title", d.get("slug", "")))
        out = OUT_DIR / f"{d['slug']}.html"
        out.write_text(html)
        print(f"  ✓ public/handouts/{d['slug']}.html")
        n += 1
    print(f"built {n} handout(s) → {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
