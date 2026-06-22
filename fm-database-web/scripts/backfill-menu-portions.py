#!/usr/bin/env python3
"""Backfill explicit per-component portions onto existing app menus.

The menu generators now author "Component (qty) + Component (qty)" for new
menus. This one-time pass adds the same portions to menus that already exist
on published plans — WITHOUT changing the dishes themselves, just adding a
single-serving household quantity to each component that lacks one. Touches
plan.app_menu and plan.app_menu_pending.

Haiku, ~$0.15 total for all current clients. Idempotent: a dish whose every
component already has a "(...)" portion is skipped (no API tokens spent on it).

Usage:
  backfill-menu-portions.py [--plan <file.yaml>]... [--dry-run]
  (no --plan → every published plan that has a structured app_menu)
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from pathlib import Path

FMDB_ROOT = Path("/Users/shivani/code/healwithshivanih-ads/fm-database")
PLANS_DIR = Path(os.environ.get("FMDB_PLANS_DIR") or (Path.home() / "fm-plans")) / "published"
MODEL = "claude-haiku-4-5"


def _load_env() -> None:
    env = FMDB_ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[len("export "):]
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _fully_portioned(dish: str) -> bool:
    """Every '+'-component already carries a (qty) bracket?"""
    parts = [p.strip() for p in dish.split("+") if p.strip()]
    return bool(parts) and all("(" in p for p in parts)


# every (week,day,slot) dish location we might rewrite, with a stable id
def _collect(plan: dict):
    locs = []  # (id, dish, setter)
    am = plan.get("app_menu")
    if isinstance(am, dict):
        for wi, wk in enumerate(am.get("weeks") or []):
            for di, day in enumerate(wk.get("days") or []):
                for si, slot in enumerate(day.get("slots") or []):
                    if isinstance(slot, dict) and slot.get("dish"):
                        locs.append((f"m-{wi}-{di}-{si}", slot["dish"], slot))
    pend = plan.get("app_menu_pending")
    if isinstance(pend, dict):
        for di, day in enumerate(pend.get("days") or []):
            for si, slot in enumerate(day.get("slots") or []):
                if isinstance(slot, dict) and slot.get("dish"):
                    locs.append((f"p-{di}-{si}", slot["dish"], slot))
    return locs


TOOL = {
    "name": "record_portions",
    "description": "Return each dish rewritten with explicit portions.",
    "input_schema": {
        "type": "object",
        "properties": {
            "dishes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"id": {"type": "string"}, "dish": {"type": "string"}},
                    "required": ["id", "dish"],
                },
            }
        },
        "required": ["dishes"],
    },
}

SYSTEM = (
    "You add explicit single-serving household portions to Indian home-cooked "
    "menu dishes. For each dish, return it rewritten so EVERY '+'-separated "
    "component has a portion in brackets — (1 bowl), (2), (1 cup), (small bowl), "
    "(30 g), (1 tbsp). Keep the EXACT same foods, wording and order — only ADD a "
    "quantity to any component missing one; leave components that already have a "
    "quantity unchanged. Use realistic one-person portions (these are weight-aware "
    "plans). Return every dish via the record_portions tool, same id."
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="append", default=[])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    try:
        import yaml  # type: ignore
    except ImportError as e:
        print(f"pyyaml: {e}", file=sys.stderr)
        return 1

    files = args.plan or [
        f for f in sorted(glob.glob(str(PLANS_DIR / "*.yaml")))
    ]
    _load_env()
    import anthropic  # type: ignore

    from _api_guard import require_api_authorized  # cost guard C
    require_api_authorized("backfill-menu-portions.py")
    client = anthropic.Anthropic()
    summary = []
    for f in files:
        try:
            plan = yaml.safe_load(Path(f).read_text()) or {}
        except yaml.YAMLError:
            continue
        if not isinstance(plan, dict):
            continue
        locs = _collect(plan)
        todo = [(i, d, s) for (i, d, s) in locs if not _fully_portioned(d)]
        name = os.path.basename(f).split("-plan")[0]
        if not locs:
            continue
        if not todo:
            summary.append(f"{name}: already portioned ({len(locs)} dishes)")
            continue

        # batch ~30 dishes per call so the tool output never overflows max_tokens
        by_id: dict = {}
        BATCH = 30
        err = None
        for start in range(0, len(todo), BATCH):
            payload = [{"id": i, "dish": d} for (i, d, _s) in todo[start : start + BATCH]]
            try:
                msg = client.messages.create(
                    model=MODEL,
                    max_tokens=4096,
                    system=SYSTEM,
                    tools=[TOOL],
                    tool_choice={"type": "tool", "name": "record_portions"},
                    messages=[{"role": "user", "content": json.dumps({"dishes": payload})}],
                )
            except Exception as e:  # noqa: BLE001
                err = str(e)
                continue
            result = next((b.input for b in msg.content if getattr(b, "type", "") == "tool_use"), None)
            for x in (result or {}).get("dishes", []):
                if x.get("id") and x.get("dish"):
                    by_id[x["id"]] = x["dish"]
        if err and not by_id:
            summary.append(f"{name}: API error {err}")
            continue

        changed = 0
        for (i, _d, slot) in todo:
            new = (by_id.get(i) or "").strip()
            # sanity: keep the rewrite only if it still has the same number of
            # components (the model added quantities, didn't drop/add foods)
            if new and len(new.split("+")) == len(_d.split("+")):
                slot["dish"] = new
                changed += 1
        if changed and not args.dry_run:
            bak = Path(f).with_suffix(".yaml.bak-portions")
            if not bak.exists():
                bak.write_text(Path(f).read_text())
            tmp = Path(f).with_suffix(".yaml.tmp")
            tmp.write_text(yaml.safe_dump(plan, sort_keys=False, allow_unicode=True))
            os.replace(tmp, f)
        summary.append(f"{name}: {changed}/{len(todo)} dishes portioned" + (" (dry-run)" if args.dry_run else ""))

    print(json.dumps({"ok": True, "summary": summary}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
