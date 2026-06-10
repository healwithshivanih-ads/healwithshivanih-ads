#!/usr/bin/env python3
"""List/search the recipe library — JSON for the plan-editor recipe picker.
Reads stdin JSON: {search?, meal_type?, diet?, dosha?, season?, slugs?}.
Returns: {ok, recipes:[{slug,name,meal_type,diet,seasons,balances_dosha,one_line,
kcal,has_image,image_cleared}], total}.
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recipe_select as R

def card(rec):
    img = rec.get("image") or {}
    return {
        "slug": rec.get("slug"), "name": rec.get("name"),
        "meal_type": rec.get("meal_type") or [], "diet": rec.get("diet") or [],
        "seasons": rec.get("seasons") or [], "balances_dosha": rec.get("balances_dosha") or [],
        "one_line": rec.get("one_line") or "",
        "kcal": rec.get("approx_kcal_per_serving"),
        "has_image": bool(img.get("file")),
        "image_cleared": img.get("rights_status") in ("licensed", "original"),
        "source": (rec.get("attribution") or {}).get("book") or "",
    }

def main():
    try:
        req = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    except Exception:
        req = {}
    recipes = R.load_recipes()
    q = (req.get("search") or "").lower().strip()
    mt = (req.get("meal_type") or "").lower().strip()
    diet = (req.get("diet") or "").lower().strip()
    dosha = (req.get("dosha") or "").lower().strip()
    season = (req.get("season") or "").lower().strip()
    only = set(req.get("slugs") or [])
    out = []
    for r in recipes:
        if only and r.get("slug") not in only:
            continue
        if q and q not in (r.get("name", "") + " " + r.get("one_line", "") + " " + " ".join(r.get("main_ingredients") or [])).lower():
            continue
        if mt and mt not in [x.lower() for x in (r.get("meal_type") or [])]:
            continue
        if diet and diet not in [x.lower() for x in (r.get("diet") or [])]:
            continue
        if dosha and dosha not in [x.lower() for x in (r.get("balances_dosha") or [])]:
            continue
        if season and season not in [x.lower() for x in (r.get("seasons") or [])]:
            continue
        out.append(card(r))
    out.sort(key=lambda c: c["name"] or "")
    json.dump({"ok": True, "recipes": out, "total": len(out)}, sys.stdout, ensure_ascii=False)

if __name__ == "__main__":
    main()
