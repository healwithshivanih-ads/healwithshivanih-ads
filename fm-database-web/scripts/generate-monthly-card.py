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
# ── One entry PER MONTH, not per season ─────────────────────────────────────
# The seasonal table this replaced had four buckets covering 2-3 months each, so
# any two months inside a bucket produced a BYTE-IDENTICAL card. October and
# November both landed in "festival": a maintenance client paid in October, got
# a card, and in November the same card arrived under a new heading. The monthly
# card IS the recurring deliverable of a paid subscription — month two has to
# read like it was written after month one, or the subscription answers itself.
#
# India-keyed: the festival calendar, the monsoon, and the wedding/travel season
# move Indian eating more than the meteorological season does.
_MONTHS = {
    1: (["Warm, cooked breakfasts — the cold makes raw food harder to digest",
         "Sesame, jaggery and ghee in small amounts — the traditional winter foods, and they earn it",
         "Get out into the winter sun for 15 minutes; vitamin D is at its lowest now"],
        ["Sitting all day because it's cold — circulation needs you to move",
         "Letting the new-year reset become an all-or-nothing crash diet"]),
    2: (["Keep the winter warmth going — soups, dals, root vegetables",
         "Start easing back into morning movement as the mornings soften",
         "Green garlic, methi and winter greens while they're still in the market"],
        ["Late nights creeping back in as the season turns",
         "Skipping breakfast once mornings get busier"]),
    3: (["Bitter greens — neem, methi, karela — the traditional spring cleanse, and it holds up",
         "Lighten dinners as the evenings warm",
         "Start hydrating properly before the heat arrives, not after"],
        ["Carrying winter's heavy, rich eating into the warm months",
         "Holi sweets running on for a fortnight after the day itself"]),
    4: (["Hydrate steadily — coconut water, buttermilk, cucumber, plain water",
         "Cooling foods: mint, fennel, melons. Lighter dinners",
         "Move early morning or after sundown, out of the midday heat"],
        ["Heavy fried or very spicy food in peak heat",
         "Strenuous exertion in the midday sun"]),
    5: (["Salt AND water — in this heat plain water alone isn't enough",
         "Curd, chaas and sattu; keep meals small and frequent",
         "Watch for the afternoon slump — it's usually dehydration, not hunger"],
        ["Chilled drinks straight from the fridge on an empty stomach",
         "Cutting meals in the heat and then over-eating at night"]),
    6: (["Ease into monsoon eating — warm, freshly cooked, simple",
         "Ginger and turmeric as the humidity climbs",
         "Boiled or filtered water from here on"],
        ["Raw and cold food as the damp sets in — digestion is already slowing",
         "Cut fruit and juices from outside once the rains start"]),
    7: (["Warm, freshly cooked food — soups, khichdi, sautéed vegetables",
         "Ginger, turmeric and a little black pepper for digestion",
         "Keep meals simple; this is the month digestion is weakest"],
        ["Raw salads, street food and pre-cut fruit — infection risk is highest now",
         "Leftover or stored cooked greens"]),
    8: (["Keep food warm and cooked through while the damp holds",
         "Immunity foods — amla, tulsi, haldi doodh",
         "Protect sleep; the damp and the festival run-up both eat into it"],
        ["Fried monsoon snacks becoming the daily habit",
         "Damp-stored grains and flours — check before you cook"]),
    9: (["Transition eating — lighter than monsoon, not yet cooling",
         "Rebuild digestion after the monsoon: warm water, ginger before meals",
         "Get ahead of the festival season while things are still calm"],
        ["Carrying monsoon-season heaviness into the festival months",
         "Letting the Ganesh sweets set the pattern for October"]),
    10: (["Plan the festival weeks rather than riding them — decide in advance which days are the indulgent ones",
          "Protein and vegetables FIRST at a festival meal; sweets after, on a fuller stomach",
          "Keep your movement going through the festivities — it's what protects the sugars"],
         ["Grazing on mithai across the whole month rather than on the days that matter",
          "Erratic sleep piling up through the celebrations"]),
    11: (["The post-Diwali reset — back to your regular plate this week, not in January",
          "Warm, cooked food as the mornings cool; bring the greens back",
          "Rebuild the routine that the festival weeks interrupted — sleep first, then meals"],
         ["Letting festival leftovers stretch two weeks past the festival",
          "Waiting for the new year to restart what you can restart now"]),
    12: (["Warm, grounding food — the season and the wedding circuit both ask a lot of digestion",
          "Winter sun and winter greens: sarson, bathua, methi",
          "Hold your basics through the party season; one good meal a day anchors the rest"],
         ["Back-to-back late nights and rich food with no recovery day between",
          "Treating December as a write-off before it's even started"]),
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
    dos, donts = _MONTHS[dt.month]
    dos = list(dos)
    donts = list(donts)

    # Rotate WHICH of the client's matching condition rules get the emphasis, so
    # a client with three relevant conditions hears about a different one each
    # month instead of the same two forever. Deterministic (keyed on the month),
    # so regenerating the same month is idempotent.
    cond_text = " ".join(conditions).lower()
    matches = [(do, dont) for keys, do, dont in _CONDITION_RULES
               if any(k in cond_text for k in keys)]
    if matches:
        offset = (dt.year * 12 + dt.month) % len(matches)
        for do, dont in [matches[(offset + i) % len(matches)] for i in range(min(2, len(matches)))]:
            dos.append(do)
            donts.append(dont)

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
