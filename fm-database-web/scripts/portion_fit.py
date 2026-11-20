"""
portion_fit — make a drafted day add up to the client's daily target.

Coach, 20 Nov 2026: "Menu and target can't be so far apart — the generator
itself should choose correctly based on client target". The drafting model
is shown the grams of every catalogue dish, but it cannot add up as it
writes, so this deterministic step runs on its draft:

  1. Each day is added up exactly as the client app will (menu_macros.py,
     parity-pinned to the app).
  2. Portions are moved one step at a time — half a bowl of dal, one more
     roti, two fewer almonds — whichever step brings the day closest to the
     target, never past half or one-and-a-half times what was written.
  3. If protein is still short, ONE diet-safe protein side is added to lunch
     or dinner (curd, paneer, sprouts, eggs — only what this client eats).

It never adds a new dish beyond that side, never touches a component it
cannot count, and returns what is still off so the coach sees it.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "fm-database"))

from menu_macros import KEYS, MenuMacros, menu_portion, portion_factor  # noqa: E402

WEIGHT = {"protein_g": 2.0, "carbs_g": 1.0, "fat_g": 1.0, "fibre_g": 0.5}
STEP = {"piece": 1.0, "bowl": 0.5, "glass": 0.5, "tbsp": 1.0}
MAX_MOVES = 40
SCALE = (0.5, 1.5)
PROTEIN_SLOTS = ("lunch", "dinner")


def bands_for(target: dict) -> dict:
    kcal = target.get("kcal_now") or 0
    b = {}
    if target.get("protein"):
        b["protein_g"] = (target["protein"]["low"], target["protein"]["high"])
    if target.get("carb_share") and kcal:
        b["carbs_g"] = (round(kcal * target["carb_share"][0] / 4), round(kcal * target["carb_share"][1] / 4))
    if target.get("fat_share") and kcal:
        b["fat_g"] = (round(kcal * target["fat_share"][0] / 9), round(kcal * target["fat_share"][1] / 9))
    if target.get("fibre"):
        b["fibre_g"] = (target["fibre"], None)
    return b


def miss(totals: dict, bands: dict) -> float:
    e = 0.0
    for k, (lo, hi) in bands.items():
        x = totals.get(k, 0)
        if x < lo:
            e += WEIGHT[k] * (lo - x) / lo
        elif hi and x > hi:
            e += WEIGHT[k] * (x - hi) / hi
    return e


def _fmt(q: float, unit: str, original: str) -> str:
    q = round(q * 2) / 2
    n = str(int(q)) if q == int(q) else f"{q:g}"
    if unit == "piece":
        # keep a counted noun the coach wrote: "2 eggs" → "3 eggs"
        return re.sub(r"\d+(?:\.\d+)?", n, original, count=1) if re.search(r"\d", original) else n
    if unit == "tbsp":
        return f"{n} tbsp"
    if unit == "glass":
        return f"{n} glass" if q <= 1 else f"{n} glasses"
    word = "cup" if re.search(r"\bcups?\b", original) else "katori" if "katori" in original else "bowl"
    return f"{n} {word}" if q <= 1 else f"{n} {word}s"


class _Part:
    """One component of a slot: fixed grams, or grams per menu unit × qty."""

    def __init__(self, mm: MenuMacros, title: str, portion: str | None):
        self.title, self.portion = title, portion
        self.unit_m = None
        self.fixed = None
        self.qty = self.q0 = 0.0
        self.unit = None
        m = mm.meal([{"title": title, "portion": portion}])
        mp = menu_portion(portion)
        hit = mm.recipe(title)
        if hit and mp and hit.get("portion") and mp["unit"] == hit["portion"]["unit"]:
            per = portion_factor(hit["portion"], {"qty": 1, "unit": mp["unit"]})
            self.unit_m = {k: hit["m"][k] * per for k in KEYS}
        elif not hit and mp:
            one = {"piece": "1", "bowl": "1 bowl", "glass": "1 glass", "tbsp": "1 tbsp"}[mp["unit"]]
            pm = mm.plain(title, one)
            if pm:
                self.unit_m = pm
        if self.unit_m and mp:
            self.unit, self.qty, self.q0 = mp["unit"], mp["qty"], mp["qty"]
        else:
            self.fixed = {k: (m or {}).get(k, 0) for k in KEYS} if m else dict.fromkeys(KEYS, 0)

    def kind(self) -> str:
        """'veg' never goes down, 'protein' only up, 'fat' only down, else either."""
        if not self.unit_m:
            return "fixed"
        m = self.unit_m
        kcal = m["protein_g"] * 4 + m["carbs_g"] * 4 + m["fat_g"] * 9
        t = self.title.lower()
        if re.search(r"sabzi|sabji|bhaji|palya|poriyal|thoran|saag|salad|kachumber|greens|vegetable|stir.?fry|curry|kootu|avial|raita", t):
            return "veg"
        if kcal and m["fat_g"] * 9 / kcal >= 0.5:
            return "fat"
        if kcal and m["protein_g"] * 4 / kcal >= 0.22:
            return "protein"
        return "other"

    def grams(self) -> dict:
        if self.unit_m:
            return {k: self.unit_m[k] * self.qty for k in KEYS}
        return self.fixed  # type: ignore[return-value]

    def text(self) -> str:
        if not self.unit_m or self.qty == self.q0:
            return f"{self.title} ({self.portion})" if self.portion else self.title
        return f"{self.title} ({_fmt(self.qty, self.unit or 'bowl', self.portion or '')})"


_SAME = {
    "Curd": ("curd", "dahi", "yogurt", "yoghurt", "raita"),
    "Paneer": ("paneer",),
    "Moong sprouts": ("sprout",),
    "Boiled eggs": ("egg",),
}


def _sides(client: dict) -> list[tuple[str, str]]:
    """Protein sides this client may have, best first. Diet + dairy + avoid list."""
    pref = str(client.get("dietary_preference") or "").lower()
    avoid = str(client.get("foods_to_avoid") or "").lower()
    out: list[tuple[str, str]] = []
    try:
        from fmdb.plan.dairy import resolve_dairy, text_is_dairy_safe

        dairy = resolve_dairy(client)
    except Exception:
        dairy, text_is_dairy_safe = None, None  # type: ignore[assignment]
    vegan = "vegan" in pref
    if not vegan and text_is_dairy_safe is not None and text_is_dairy_safe("curd paneer", dairy):
        if "curd" not in avoid and "dahi" not in avoid:
            out.append(("Curd", "1 cup"))
    if "sprout" not in avoid and "moong" not in avoid:
        out.append(("Moong sprouts", "1 bowl"))
    if ("egg" in pref or "non" in pref) and "egg" not in avoid:
        out.append(("Boiled eggs", "2"))
    # Paneer last: about 17 g of fat in half a cup, so leaner sides go first.
    if not vegan and text_is_dairy_safe is not None and text_is_dairy_safe("paneer", dairy) and "paneer" not in avoid:
        out.append(("Paneer", "1/2 cup"))
    return out


def fit_day(day: dict, bands: dict, client: dict, mm: MenuMacros) -> dict:
    """Mutates day["slots"][*]["dish"]. Returns {"before", "after", "added"}."""
    slots = [s for s in (day.get("slots") or []) if isinstance(s, dict)]
    parts = [[_Part(mm, c["title"], c["portion"]) for c in mm.split(str(s.get("dish") or ""))] for s in slots]

    def totals() -> dict:
        t = dict.fromkeys(KEYS, 0.0)
        for ps in parts:
            for p in ps:
                for k, v in p.grams().items():
                    t[k] += v
        return t

    before = {k: round(v) for k, v in totals().items()}
    added = None

    def climb() -> None:
        for _ in range(MAX_MOVES):
            cur = miss(totals(), bands)
            best = None
            for ps in parts:
                for p in ps:
                    if not p.unit_m:
                        continue
                    step = STEP[p.unit or "bowl"]
                    if p.unit == "piece" and p.unit_m["protein_g"] < 1 and p.unit_m["fat_g"] > 0.3:
                        step = 2.0  # nuts move two at a time
                    k = p.kind()
                    for d in (step, -step):
                        if (k == "veg" and d < 0) or (k == "protein" and d < 0) or (k == "fat" and d > 0):
                            continue
                        q = p.qty + d
                        if q < max(SCALE[0] * p.q0, step / 2) or q > SCALE[1] * p.q0 + 1e-9:
                            continue
                        p.qty = q
                        e = miss(totals(), bands)
                        p.qty -= d
                        if e < cur - 1e-6 and (best is None or e < best[0]):
                            best = (e, p, d)
            if not best:
                return
            best[1].qty += best[2]

    climb()
    added_list: list[str] = []
    meal_idx = [i for i, s in enumerate(slots) if any(w in str(s.get("slot") or "").lower() for w in PROTEIN_SLOTS)]
    sides = _sides(client)
    for idx in meal_idx:  # at most one side per main meal
        if "protein_g" not in bands or totals()["protein_g"] >= bands["protein_g"][0] * 0.95:
            break
        here = " ".join(p.title.lower() for p in parts[idx])
        for title, portion in list(sides):
            if any(w in here for w in _SAME[title]):
                continue  # already has curd / paneer / sprouts / eggs
            side = _Part(mm, title, portion)
            if not side.unit_m:
                continue
            parts[idx].append(side)
            sides.remove((title, portion))
            added_list.append(f"{title} ({portion}) at {slots[idx].get('slot')}")
            climb()
            break
    added = "; ".join(added_list) or None
    for s, ps in zip(slots, parts):
        s["dish"] = " + ".join(p.text() for p in ps)
    return {"before": before, "after": {k: round(v) for k, v in totals().items()}, "added": added}


def fit_week(days: list, target: dict, client: dict, mm: MenuMacros | None = None) -> list[dict]:
    mm = mm or MenuMacros()
    bands = bands_for(target)
    return [fit_day(d, bands, client, mm) for d in days if isinstance(d, dict)]
