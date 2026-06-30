#!/usr/bin/env python3
"""Generate this month's do's & don'ts card for a maintenance client.

The one living thing in the maintenance tier. Keyed to the Indian season (by
month) + the client's conditions. Cached on the plan as
`plan.monthly_cards["YYYY-MM"] = {title, dos, donts}` and rendered by the app's
maintenance home.

Two paths (spec PLAN_END_GAME_SPEC.md):
  A (Haiku) — tailored prose, gated behind FM_API_OK (cost guard). Default when
              available; obeys the no-hallucination rule.
  B (deterministic) — seasonal + condition template, zero API. The reliable
              fallback (and what ships today).

Input (stdin JSON):  {"client_id": "cl-007", "month": "2026-07", "dry_run": false}
Output (stdout JSON): {"ok": bool, "card": {month,title,dos,donts} | null, "error": str | null}
"""
import sys
import json
import os
import glob
from pathlib import Path
from datetime import datetime, timezone


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    return Path(env) if env else Path.home() / "fm-plans"


def _strs(v) -> list:
    return [s for s in (v or []) if isinstance(s, str) and s.strip()]


# ── season → base do's / don'ts (Indian calendar) ────────────────────────────
_SEASONS = {
    "summer": (  # Apr–Jun
        ["Hydrate steadily — coconut water, buttermilk, cucumber, lots of plain water",
         "Lean on cooling foods (mint, fennel, melons) and lighter dinners",
         "Move early morning or evening, out of the midday heat"],
        ["Heavy fried or very spicy food in peak heat",
         "Skipping water through a busy day",
         "Strenuous exertion in the midday sun"],
    ),
    "monsoon": (  # Jul–Sep
        ["Favour warm, freshly cooked food — soups, khichdi, sautéed veg",
         "Add ginger, turmeric and a little black pepper for digestion",
         "Drink boiled or filtered water; keep meals warm and simple"],
        ["Raw salads, street food and pre-cut fruit (higher infection risk now)",
         "Leftover or stored cooked greens",
         "Heavy, cold, hard-to-digest foods in the evening"],
    ),
    "autumn": (  # Oct–Nov
        ["Eat with the season — fresh local produce, steady regular meals",
         "Support immunity with amla, tulsi and good sleep",
         "Keep your routine steady through the festival weeks"],
        ["Overdoing festival sweets and fried snacks day after day",
         "Erratic sleep and late nights piling up",
         "Skipping meals then over-eating later"],
    ),
    "winter": (  # Dec–Feb
        ["Warming, nourishing food — soups, sesame, a little ghee, root veg",
         "Get midday sun for vitamin D; keep moving for circulation",
         "Warm spices (cinnamon, ginger) and warm water through the day"],
        ["Excess refined carbs and sugar (easy to drift into in winter)",
         "Long sedentary days without movement",
         "Cold, raw foods late in the evening"],
    ),
    "spring": (  # Mar
        ["Lighter, detox-friendly foods — bitter greens, methi, seasonal veg",
         "A gentle spring-clean of habits: earlier nights, more movement",
         "Stay hydrated as the weather warms"],
        ["Heavy, mucus-forming foods (excess dairy, deep-fried)",
         "Letting allergens build up — keep your space aired and clean",
         "Skipping breakfast then grazing all day"],
    ),
}


def _season(month: int) -> str:
    if month in (4, 5, 6):
        return "summer"
    if month in (7, 8, 9):
        return "monsoon"
    if month in (10, 11):
        return "autumn"
    if month in (12, 1, 2):
        return "winter"
    return "spring"  # March


# ── condition keyword → one do + one don't ───────────────────────────────────
_CONDITION_RULES = [
    (("thyroid", "hashimoto", "hypothyroid"),
     "Take your thyroid support consistently, at the same time each day",
     "Large amounts of raw goitrogens (raw cabbage, cauliflower) — cook them instead"),
    (("gut", "ibs", "sibo", "bloat", "reflux", "acid"),
     "Chew slowly and finish dinner a little earlier",
     "Late, heavy or rushed meals"),
    (("pcos", "insulin", "blood sugar", "diabetes", "weight"),
     "Protein-led breakfast and a short walk after meals",
     "Sugary drinks and refined-carb snacking between meals"),
    (("perimenopause", "menopause", "hormone", "estrogen", "oestrogen"),
     "Magnesium-rich foods and some strength movement each week",
     "Late caffeine and alcohol that disrupt sleep"),
    (("stress", "anxiety", "sleep", "insomnia", "cortisol", "adrenal", "fatigue"),
     "A steady wind-down routine and a consistent sleep/wake time",
     "Screens and stimulating work right up to bedtime"),
]


def _build_card(month_str: str, conditions: list) -> dict:
    dt = datetime.strptime(month_str, "%Y-%m")
    season = _season(dt.month)
    dos, donts = _SEASONS[season]
    dos = list(dos)
    donts = list(donts)

    cond_text = " ".join(conditions).lower()
    added = 0
    for keys, do, dont in _CONDITION_RULES:
        if added >= 2:
            break
        if any(k in cond_text for k in keys):
            dos.append(do)
            donts.append(dont)
            added += 1

    return {
        "month": month_str,
        "title": f"{dt.strftime('%B')} — your do's & don'ts",
        "dos": dos,
        "donts": donts,
    }


def _latest_published_plan_file(root: Path, client_id: str):
    import yaml  # type: ignore

    best = None
    best_v = -1
    for p in glob.glob(str(root / "published" / "*.yaml")):
        try:
            d = yaml.safe_load(open(p)) or {}
        except Exception:
            continue
        if d.get("client_id") != client_id:
            continue
        v = 0
        tail = p.rsplit("-v", 1)
        if len(tail) == 2 and tail[1].split(".")[0].isdigit():
            v = int(tail[1].split(".")[0])
        if v >= best_v:
            best_v = v
            best = (p, d)
    return best


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "card": None, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    client_id = str(payload.get("client_id") or "").strip()
    dry = bool(payload.get("dry_run"))
    month = str(payload.get("month") or "").strip() or datetime.now(timezone.utc).strftime("%Y-%m")
    if not client_id:
        json.dump({"ok": False, "card": None, "error": "client_id required"}, sys.stdout)
        return 2

    try:
        import yaml  # type: ignore
    except ImportError as e:
        json.dump({"ok": False, "card": None, "error": f"pyyaml: {e}"}, sys.stdout)
        return 1

    root = _plans_root()
    cpath = root / "clients" / client_id / "client.yaml"
    if not cpath.exists():
        json.dump({"ok": False, "card": None, "error": "client not found"}, sys.stdout)
        return 1
    client = yaml.safe_load(open(cpath)) or {}
    conditions = _strs(client.get("active_conditions")) + _strs(client.get("goals"))

    # Path B (deterministic) ships today. Path A (Haiku) is a future layer behind
    # FM_API_OK — kept deliberately simple here for reliability + zero cap risk.
    card = _build_card(month, conditions)

    found = _latest_published_plan_file(root, client_id)
    if not found:
        json.dump({"ok": False, "card": None, "error": "no published plan"}, sys.stdout)
        return 1
    ppath, plan = found

    if not dry:
        cards = plan.get("monthly_cards")
        if not isinstance(cards, dict):
            cards = {}
        cards[month] = card
        plan["monthly_cards"] = cards
        with open(ppath, "w") as f:
            yaml.safe_dump(plan, f, sort_keys=False, allow_unicode=True)

    json.dump({"ok": True, "card": card, "error": None}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
