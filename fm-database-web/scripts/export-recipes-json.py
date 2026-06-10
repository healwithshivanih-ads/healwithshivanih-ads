#!/usr/bin/env python3
"""Project-2 (mobile app) recipe export. Emits the recipe library as clean JSON
for the client app — own-worded method + ingredients + attribution. RIGHTS GATE:
a recipe's photo is included ONLY if image.rights_status is licensed/original;
book_reference_uncleared placeholders are dropped (image: null).

stdin JSON (optional): {slugs?: [...], require_image?: bool}
stdout: {ok, recipes:[...], total, images_dropped}
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recipe_select as R

def main():
    try:
        req = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    except Exception:
        req = {}
    only = set(req.get("slugs") or [])
    require_image = bool(req.get("require_image"))
    recipes = R.load_recipes()
    out, dropped = [], 0
    for r in recipes:
        if only and r.get("slug") not in only:
            continue
        exp = R.export_for_app(r)
        if exp["image"] is None and (r.get("image") or {}).get("file"):
            dropped += 1                     # had a placeholder photo, gated out
        if require_image and exp["image"] is None:
            continue
        out.append(exp)
    out.sort(key=lambda c: c.get("name") or "")
    json.dump({"ok": True, "recipes": out, "total": len(out), "images_dropped": dropped},
              sys.stdout, ensure_ascii=False)

if __name__ == "__main__":
    main()
