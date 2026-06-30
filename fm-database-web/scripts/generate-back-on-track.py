#!/usr/bin/env python3
"""Generate a back-on-track (flare-reset) card for a graduating client.

Deterministic — NO API. Derives a short self-serve reset from the client's
latest published plan: their plate pattern, 1-2 anchor supplements, 1-2 key
daily practices, and the foods to ease off. Writes
`client.yaml#back_on_track_plan` (rendered in the app's library floor +
maintenance) and returns the card. It's a sensible DRAFT — the coach can edit it.

Input (stdin JSON):  {"client_id": "cl-007", "dry_run": false}
Output (stdout JSON): {"ok": bool, "card": {title, intro, steps} | null, "error": str | null}
"""
import sys
import json
import os
import glob
from pathlib import Path


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    return Path(env) if env else Path.home() / "fm-plans"


def _humanize(slug: str) -> str:
    return slug.replace("-", " ").replace("_", " ").strip().title()


def _latest_published_plan(root: Path, client_id: str):
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
        if len(tail) == 2:
            num = tail[1].split(".")[0]
            if num.isdigit():
                v = int(num)
        if v >= best_v:
            best_v = v
            best = d
    return best


def _strs(v) -> list:
    return [s for s in (v or []) if isinstance(s, str) and s.strip()]


def _short(s: str) -> str:
    """foods_to_avoid / reduce entries often carry a "— reason" or "(detail)";
    keep just the short food name for the reset card."""
    return s.split(" — ")[0].split(" - ")[0].split(" (")[0].split(":")[0].strip()


# Generic, lifestyle-scope safety triggers — NOT diagnostic and NOT
# client-specific (we never fabricate condition-specific red flags). These are
# the "this is beyond a reset" lines PLAN_END_GAME_SPEC.md makes NON-OPTIONAL,
# so a hands-free / self-serve tier stays responsible and inside coaching scope.
_RED_FLAGS = [
    "Chest pain, trouble breathing, fainting, or sudden one-sided weakness — "
    "call your local emergency number now. This is not a reset situation.",
    "A high fever that won't settle, severe or fast-worsening pain, persistent "
    "vomiting, or blood where there shouldn't be — please see a doctor.",
    "If things are getting sharply worse instead of easing, you're frightened, "
    "or you're pregnant and unsure — reach out to Shivani or a doctor rather "
    "than finishing the reset on your own.",
]


def _build_card(client: dict, plan: dict) -> dict:
    first = (str(client.get("display_name") or "").split(" ") or ["you"])[0] or "you"
    nut = plan.get("nutrition") or {}
    steps: list[str] = []

    pattern = str(nut.get("pattern") or "").strip()
    steps.append(
        f"Back to your plate — {pattern}. Protein and veg first, kept simple."
        if pattern
        else "Back to your plate — protein and veg first, home-cooked and simple."
    )

    steps.append(
        "Put sleep and water first for a few days — they settle a flare more than anything else on this list."
    )

    names = [_humanize(s.get("supplement_slug", "")) for s in (plan.get("supplement_protocol") or []) if isinstance(s, dict) and s.get("supplement_slug")][:2]
    if names:
        # As-needed, NOTHING NEW, only doses already established as safe over the
        # 12 weeks — keeps this a lifestyle reset, never new prescribing (spec).
        steps.append(
            f"If they helped you before, you can lean on the basics you already know — {', '.join(names)}. "
            "Nothing new, and only at the amount you've already been taking."
        )

    pnames = [str(p.get("name") or "").strip() for p in (plan.get("lifestyle_practices") or []) if isinstance(p, dict) and str(p.get("name") or "").strip()][:2]
    if pnames:
        steps.append(f"Come back to your daily basics — {', '.join(pnames)}.")

    eases = [_short(x) for x in (_strs(nut.get("reduce")) + _strs(client.get("foods_to_avoid")))]
    eases = [e for e in eases if e][:2]
    if eases:
        steps.append(f"Ease back off {', '.join(eases)} for a few days.")

    steps.append(
        "Give it 5–7 days. If it isn't settling, book a re-check with Shivani rather than pushing on — "
        "that's what the reset is for, not a substitute for being seen."
    )

    return {
        "title": "Your reset",
        "intro": (
            f"An off-week or a flare happens to everyone, {first}. When it does, you don't need "
            "the whole plan — just come back to the few things that move the needle fastest for you. "
            "This is a gentle reset, not a new prescription."
        ),
        "steps": steps,
        "red_flags": list(_RED_FLAGS),
    }


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "card": None, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    client_id = str(payload.get("client_id") or "").strip()
    dry = bool(payload.get("dry_run"))
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
    plan = _latest_published_plan(root, client_id) or {}
    card = _build_card(client, plan)

    if not dry:
        client["back_on_track_plan"] = card
        with open(cpath, "w") as f:
            yaml.safe_dump(client, f, sort_keys=False, allow_unicode=True)

    json.dump({"ok": True, "card": card, "error": None}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
