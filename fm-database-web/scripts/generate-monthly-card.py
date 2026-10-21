#!/usr/bin/env python3
"""Generate this month's do's & don'ts card for a maintenance client.

The one living thing in the maintenance tier. Keyed to the month of the year
WHERE THE CLIENT LIVES (a table per region — India, the US; see
_REGION_TABLES) + the client's conditions. Cached on the plan as
`plan.monthly_cards["YYYY-MM"] = {title, dos, donts}` and rendered by the app's
maintenance home.

Two paths (spec PLAN_END_GAME_SPEC.md):
  A (Haiku) — tailored prose, gated behind FM_API_OK (cost guard). Default when
              available; obeys the no-hallucination rule.
  B (deterministic) — seasonal + condition template, zero API. The reliable
              fallback (and what ships today).

Input (stdin JSON):
  {"client_id": "cl-007", "month": "2026-07", "dry_run": false,
   "plan_slug": "<optional — the exact plan to write to>",
   "review": false,          # true (the monthly cron): HOLD the card for the
                             #   coach when anything stands out, instead of
                             #   putting it live
   "only_if_missing": false} # true (the monthly cron): leave an existing card
                             #   for that month untouched
Output (stdout JSON):
  {"ok": bool, "card": {...} | null, "flags": [str], "status": "live" |
   "pending_review" | null, "skipped": str | null, "error": str | null}

A stored card carries `status`. "pending_review" never renders in the app; an
absent status (cards written before this field) or "live" does. `flags` says
why a card was held, in the coach's words — see review_flags().
"""
import sys
import json
import os
import glob
import re
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
_MONTHS_INDIA = {
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


# ── United States: a temperate four-season year (2026-10-21) ────────────────
# Written for Krittika in Fairfax, VA, whose India cards were all Diwali and
# mithai. The year is shaped by different things there: the clock changes,
# a real winter, the farmers' markets, and Halloween / Thanksgiving / the
# December party season rather than the Indian festival calendar. No Indian
# festivals on purpose — a diaspora client may well keep Diwali, but that is
# the coach's line to add, not the template's to assume.
#
# Assumes the four-season pattern most of the country has. The Gulf Coast and
# the Southwest have a different summer; give them their own table if a client
# lives there rather than stretching this one.
_MONTHS_US = {
    1: (["Warm, cooked, savoury breakfasts rather than cold cereal",
         "Get outside in daylight for 15 minutes even when it's cold; winter sun is at its weakest now",
         "Soups and stews built on winter vegetables — squash, carrots, beans"],
        ["Letting the new-year reset become an all-or-nothing crash diet",
         "Staying indoors and sitting all day because it's cold out"]),
    2: (["Keep the warm, cooked meals going while winter holds",
         "Citrus is at its best now — oranges and clementines with your meals",
         "Move indoors on icy days rather than skipping movement altogether"],
        ["Game-day snacking stretching into the whole weekend",
         "Skipping breakfast because the mornings are dark"]),
    3: (["Protect your sleep the week the clocks go forward — same wake time, earlier lights-out",
         "Bring in the first spring greens as they reach the stores",
         "Lighten dinners as the evenings warm up"],
        ["Letting the clock change cost you a week of sleep",
         "Carrying winter comfort eating on into spring"]),
    4: (["Asparagus, peas and fresh greens while they're in season",
         "Longer days — take a walk after dinner while it's still light",
         "Drink more water as you get more active outdoors"],
        ["Doing too much too soon once the weather turns — build up gently",
         "Holiday candy lingering in the house for weeks"]),
    5: (["The farmers' markets reopen — buy what's local and in season",
         "Protein at every meal, especially breakfast",
         "Morning walks while it's cool and bright"],
        ["Long weekend cookouts turning into an afternoon of grazing",
         "Sitting for hours without a break as work picks up"]),
    6: (["Hydrate steadily as it warms — water first, through the day",
         "Berries, cucumbers and zucchini while they're cheap and good",
         "Move early in the morning or after sundown, out of the midday heat"],
        ["Sweet tea, lemonade and iced coffees as the daily drinks",
         "Skipping meals on busy summer days and catching up at night"]),
    7: (["Salt AND water on the hottest days — plain water alone isn't enough",
         "Keep meals light and fresh; summer produce is at its peak",
         "Find shade or air conditioning for any exercise in a heatwave"],
        ["Ice cream and ice-cold drinks as the everyday answer to the heat",
         "Late summer nights cutting into your sleep"]),
    8: (["Tomatoes, corn and peaches — the best of the year, eaten fresh",
         "Start getting back to a school-and-work routine before it starts",
         "Keep your bedroom cool so the hot nights don't wreck your sleep"],
        ["Vacation eating stretching past the vacation",
         "Letting the late-summer rush push dinner later and later"]),
    9: (["Plan the week's meals on Sunday as routines restart",
         "Apples and the first squash of the season",
         "Keep the walking habit as the days get shorter"],
        ["Snacking at your desk in place of a proper lunch",
         "Dropping movement once the summer routine ends"]),
    10: (["Pumpkin, squash and warming spices — cinnamon, ginger, turmeric",
          "Get morning daylight as the days shorten; it steadies your sleep",
          "Decide in advance how much Halloween candy comes into the house"],
         ["A bowl of candy sitting out for weeks after Halloween",
          "Giving up outdoor movement as it gets cold"]),
    11: (["Keep the same wake time when the clocks go back",
          "At Thanksgiving, vegetables and protein first; dessert after, on a fuller stomach",
          "A walk after the big meal — it's what protects your sugars"],
         ["Treating the whole long weekend as one long meal",
          "Waiting for January to restart what you can restart now"]),
    12: (["Warm, grounding food — the cold and the party season both ask a lot of digestion",
          "Get outside in daylight every day you can",
          "Hold your basics through the parties; one good meal a day anchors the rest"],
         ["Back-to-back late nights and rich food with no recovery day between",
          "Treating December as a write-off before it's even started"]),
}

# Which table a client gets, by `client.country`. A country with no table
# falls back to India's AND the card is held for the coach (review_flags),
# so a new country is a held card until someone writes its lines here.
_REGION_TABLES = {"india": _MONTHS_INDIA, "us": _MONTHS_US}
_COUNTRY_REGION = {
    "": "india",  # unset country = an Indian client (the roster default)
    "india": "india", "in": "india", "ind": "india", "bharat": "india",
    "united states": "us", "united states of america": "us", "usa": "us", "us": "us",
    "u.s.": "us", "u.s.a.": "us", "america": "us",
}


def region_for(country):
    """The month table for this client's country, or None when we have none."""
    return _COUNTRY_REGION.get(str(country or "").strip().lower())



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
    # Food-only on purpose. This read "Take your thyroid support consistently"
    # until 2026-10-21, which told a client on no thyroid supplement or
    # medicine to take one. A card line must be true of every client its
    # keyword matches, and a keyword says nothing about what they take.
    (("thyroid", "hashimoto", "hypothyroid"),
     "Cook your cabbage, cauliflower and broccoli rather than eating them raw",
     "One millet flour every single day — rotate your flours through the week"),
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


def _build_card(month_str: str, conditions: list, region: str = "india") -> dict:
    dt = datetime.strptime(month_str, "%Y-%m")
    dos, donts = _REGION_TABLES.get(region, _MONTHS_INDIA)[dt.month]
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
        "region": region if region in _REGION_TABLES else "india",
    }


def _version_of(path: str) -> int:
    tail = path.rsplit("-v", 1)
    if len(tail) == 2 and tail[1].split(".")[0].isdigit():
        return int(tail[1].split(".")[0])
    return 0


def _current_plan_file(root: Path, client_id: str, plan_slug: str = ""):
    """The plan the app actually shows this client.

    Was "highest version wins", which is a tie for almost every client (each
    plan is v1) and then fell to glob order — Niti has both plan-1 and its
    maintenance successor in published/, and the card could land on the dead
    one. Now: the named slug when given; otherwise maintenance first, then the
    newest programme start, then the version.
    """
    import yaml  # type: ignore

    best = None
    best_key = None
    for p in glob.glob(str(root / "published" / "*.yaml")):
        try:
            d = yaml.safe_load(open(p)) or {}
        except Exception:
            continue
        if d.get("client_id") != client_id:
            continue
        if plan_slug and d.get("slug") != plan_slug:
            continue
        key = (
            bool(d.get("is_maintenance")),
            str(d.get("plan_period_start") or ""),
            _version_of(p),
        )
        if best_key is None or key > best_key:
            best_key = key
            best = (p, d)
    return best


def _prev_month(month_str: str) -> str:
    dt = datetime.strptime(month_str, "%Y-%m")
    y, m = (dt.year, dt.month - 1) if dt.month > 1 else (dt.year - 1, 12)
    return f"{y:04d}-{m:02d}"



# Words in a DO line that a diet rules out. Do-lines only: a don't line that
# names meat ("avoid fried chicken") is advice against it, not a prescription.
_DIET_WORDS = {
    "vegetarian": ["chicken", "mutton", "fish", "prawn", "meat", "bone broth", "egg"],
    "eggetarian": ["chicken", "mutton", "fish", "prawn", "meat", "bone broth"],
    "vegan": ["ghee", "curd", "chaas", "buttermilk", "doodh", "milk", "paneer", "honey",
              "chicken", "mutton", "fish", "prawn", "meat", "egg"],
    "jain": ["garlic", "onion", "ginger", "potato", "root vegetable", "carrot", "beetroot",
             "radish", "chicken", "mutton", "fish", "prawn", "meat", "egg"],
}


_AVOID_STOPWORDS = {
    "raw", "based", "products", "product", "foods", "food", "any", "all", "and", "the",
    "too", "much", "very", "with", "from", "eating", "meals", "meal", "missing", "skipping",
    "delayed", "missed", "late", "days", "day", "school", "brings", "causes", "sometimes",
    "used", "get", "kid", "since", "childhood", "itchy", "tongue", "dry", "mouth", "pain",
    "stomach", "breakfast", "lunch", "dinner", "night", "work", "stress",
}


def _text_list(v) -> list:
    if isinstance(v, list):
        return [str(x) for x in v if str(x).strip()]
    if isinstance(v, str) and v.strip():
        return [x for x in re.split(r"[;\n]", v) if x.strip()]
    return []


def review_flags(card: dict, client: dict, plan: dict, prev_card) -> list:
    """Why this card should wait for the coach, or [] when it can go live.

    Deterministic and deliberately narrow — each flag names something the
    template genuinely cannot know, so a clean card stays automatic and a held
    one says exactly what to look at.
    """
    flags: list = []
    dos = [str(x) for x in card.get("dos") or []]
    do_text = " ".join(dos).lower()

    country = str(client.get("country") or "").strip()
    if region_for(country) is None:
        flags.append(
            f"Lives in {country}, and there are no seasonal lines for there yet, so this "
            f"card uses the Indian season, festivals and markets. Check it fits where they are."
        )

    diet = str(client.get("dietary_preference") or "").lower()
    for kind, words in _DIET_WORDS.items():
        # "non-vegetarian" contains "vegetarian" — the trap the app's diet
        # regex fell into (reference_app_supplement_phasing_diet). Anchor it.
        if not re.search(rf"(?<![a-z-]){kind}", diet):
            continue
        hit = sorted({w for w in words if re.search(rf"\b{re.escape(w)}", do_text)})
        if hit:
            flags.append(f"Their diet is {client.get('dietary_preference')}, and a 'do' names {', '.join(hit)}.")

    preg = str(client.get("pregnancy_status") or "").lower()
    if preg and preg not in ("not_pregnant", "not_applicable", "no", "none"):
        flags.append(f"Pregnancy status is '{client.get('pregnancy_status')}'. Check every line is right for that.")

    try:
        from food_cautions import foods_named_in, live_cautions, screen_text, plain_food_names
    except Exception:
        foods_named_in = None  # type: ignore

    if foods_named_in is not None:
        avoid_texts = _text_list(client.get("foods_to_avoid")) + [
            a for a in _text_list(client.get("known_allergies")) + _text_list(client.get("allergies"))
            if a.strip().lower() not in ("none", "nil", "no", "na", "n/a")
        ] + _text_list(client.get("reported_triggers"))
        avoid_keys = foods_named_in(avoid_texts)
        named = foods_named_in(dos)
        clash = plain_food_names(sorted(avoid_keys & named))
        # The nutrient table only knows ~200 foods (no sesame, no brinjal), so
        # also match the plain head words of each entry — "Sesame (rash)" →
        # "sesame". A missed allergy is the one miss this screen must not make.
        for t in avoid_texts:
            head = re.split(r"\(|\s[-–—:]\s|:", t, maxsplit=1)[0].lower()
            for w in re.findall(r"[a-z]{3,}", head):
                if w not in _AVOID_STOPWORDS and re.search(rf"\b{w}", do_text) and w not in clash:
                    clash.append(w)
        if clash:
            flags.append(
                f"A 'do' names {', '.join(clash)}, which is on their "
                f"avoid / allergy / trigger list."
            )
        live = live_cautions(client, plan)
        seen = set()
        for line in dos:
            for h in screen_text(line, live):
                if h.effective_severity in ("avoid", "moderate") and h.id not in seen:
                    seen.add(h.id)
                    flags.append(f"Food caution for their condition: {h.line()}.")

    if isinstance(prev_card, dict) and prev_card.get("dos") == card.get("dos") and \
            prev_card.get("donts") == card.get("donts"):
        flags.append("Identical to last month's card.")

    return flags


def _decide(client_id: str, month: str, plan_slug: str, action: str, drop) -> int:
    """The coach's call on a held card: approve it (optionally without some
    lines) so it goes live, or skip the month. Skipped is remembered so the
    cron does not write the card again tomorrow."""
    import yaml  # type: ignore

    found = _current_plan_file(_plans_root(), client_id, plan_slug)
    if not found:
        json.dump({"ok": False, "card": None, "error": "no published plan"}, sys.stdout)
        return 1
    ppath, plan = found
    cards = plan.get("monthly_cards") if isinstance(plan.get("monthly_cards"), dict) else {}
    card = cards.get(month)
    if not isinstance(card, dict):
        json.dump({"ok": False, "card": None, "error": f"no card for {month}"}, sys.stdout)
        return 1
    drop_set = {str(x).strip() for x in drop if str(x).strip()}
    if action == "approve":
        card["dos"] = [x for x in card.get("dos") or [] if str(x).strip() not in drop_set]
        card["donts"] = [x for x in card.get("donts") or [] if str(x).strip() not in drop_set]
        if not card["dos"] and not card["donts"]:
            json.dump({"ok": False, "card": None, "error": "every line removed — skip the month instead"}, sys.stdout)
            return 1
        card["status"] = "live"
    else:
        card["status"] = "skipped"
    card["decided_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    cards[month] = card
    plan["monthly_cards"] = cards
    tmp = ppath + ".tmp"
    with open(tmp, "w") as f:
        yaml.safe_dump(plan, f, sort_keys=False, allow_unicode=True)
    os.replace(tmp, ppath)
    json.dump({"ok": True, "card": card, "flags": card.get("flags") or [], "status": card["status"],
               "skipped": None, "error": None}, sys.stdout)
    return 0


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

    action = str(payload.get("action") or "generate")
    if action in ("approve", "skip"):
        return _decide(client_id, month, str(payload.get("plan_slug") or "").strip(), action,
                       payload.get("drop") or [])

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

    try:
        datetime.strptime(month, "%Y-%m")
    except ValueError:
        json.dump({"ok": False, "card": None, "error": f"bad month: {month}"}, sys.stdout)
        return 2

    found = _current_plan_file(root, client_id, str(payload.get("plan_slug") or "").strip())
    if not found:
        json.dump({"ok": False, "card": None, "error": "no published plan"}, sys.stdout)
        return 1
    ppath, plan = found
    cards = plan.get("monthly_cards")
    if not isinstance(cards, dict):
        cards = {}

    if payload.get("only_if_missing") and isinstance(cards.get(month), dict):
        existing = cards[month]
        json.dump({"ok": True, "card": existing, "flags": existing.get("flags") or [],
                   "status": existing.get("status") or "live", "skipped": "exists",
                   "error": None}, sys.stdout)
        return 0

    # Path B (deterministic) ships today. Path A (Haiku) is a future layer behind
    # FM_API_OK — kept deliberately simple here for reliability + zero cap risk.
    card = _build_card(month, conditions, region_for(client.get("country")) or "india")
    flags = review_flags(card, client, plan, cards.get(_prev_month(month)))
    # The coach saving a card herself IS the review; the cron holds on a flag.
    status = "pending_review" if (payload.get("review") and flags) else "live"
    card["status"] = status
    card["flags"] = flags
    card["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    card["generated_by"] = "auto" if payload.get("review") else "coach"

    if not dry:
        cards[month] = card
        plan["monthly_cards"] = cards
        tmp = ppath + ".tmp"
        with open(tmp, "w") as f:
            yaml.safe_dump(plan, f, sort_keys=False, allow_unicode=True)
        os.replace(tmp, ppath)

    json.dump({"ok": True, "card": card, "flags": flags, "status": status,
               "skipped": None, "error": None}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
