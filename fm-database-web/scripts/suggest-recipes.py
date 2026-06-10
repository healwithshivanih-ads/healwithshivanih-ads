#!/usr/bin/env python3
"""Auto-suggest recipes for a client's plan — the coach prunes, never hand-picks.
stdin JSON: {client: {...}, plan: {...}, n?: int}
stdout: {ok, recipes:[card...], total}  (highest-matched first, meal-type-balanced)
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
    client = req.get("client") or {}
    plan = req.get("plan") or {}
    n = int(req.get("n") or 16)
    recs = R.suggest_recipes_for_plan(client, plan, n=n)
    json.dump({"ok": True, "recipes": [card(r) for r in recs], "total": len(recs)},
              sys.stdout, ensure_ascii=False)

if __name__ == "__main__":
    main()
