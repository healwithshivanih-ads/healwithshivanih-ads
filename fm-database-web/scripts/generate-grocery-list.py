#!/usr/bin/env python3
"""Generate the structured weekly grocery list for a client's fortnight menu.

Reads JSON from stdin:
  {
    "client_id": "cl-005",
    "plan_slug": "hariharan-plan-5-2026-06-10-cl-005",
    "weeks": [{"week": 1, "days": [{"dow": "Mon", "slots": [{"slot": "Breakfast", "dish": "Ragi dosa with sambar"}, ...]}, ...]}, ...],
    "recipes_text": "...optional recipe-pack markdown (ingredient lists)...",
    "dietary_preference": "Vegetarian (eggetarian)",
    "dry_run": false
  }

Writes JSON to stdout:
  { "ok": bool, "path": str|null, "weeks": [{"week": N, "items": N}], "usage": {...}|null, "error": str|null }

One Haiku call with tool-use returns per-week ingredient lists with
quantities, Indian-shopping categories, and pantry-staple flags. The result
is written ATOMICALLY to meal-plans/<plan_slug>-grocery.yaml — the client
app only ever reads that file (src/lib/fmdb/client-app.ts AppGrocery).

The list is derived ONLY from the dishes on the menu (+ the recipe pack's
ingredient lists when supplied) — the model is told not to invent dishes.
Quantities are for ONE person for the week; the app notes household scaling.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

SCRIPTS_DIR = Path(__file__).resolve().parent
FMDB_ROOT = SCRIPTS_DIR.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))
sys.path.insert(0, str(SCRIPTS_DIR))

from atomic_write import write_text_atomic  # noqa: E402


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv  # type: ignore

        load_dotenv(FMDB_ROOT / ".env", override=True)
    except Exception:
        envp = FMDB_ROOT / ".env"
        if envp.exists():
            for line in envp.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


MODEL = "claude-haiku-4-5"

CATEGORIES = [
    "Grains & atta",
    "Dals & legumes",
    "Vegetables & fresh",
    "Dairy",
    "Nuts, seeds & dry fruit",
    "Spices & masala",
    "Other",
]

_TOOL = {
    "name": "record_grocery_list",
    "description": "Record the structured weekly grocery list.",
    "input_schema": {
        "type": "object",
        "properties": {
            "weeks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "week": {"type": "integer"},
                        "items": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "item": {"type": "string"},
                                    "qty": {"type": "string"},
                                    "category": {"type": "string", "enum": CATEGORIES},
                                    "staple": {"type": "boolean"},
                                    "for": {"type": "array", "items": {"type": "string"}},
                                },
                                "required": ["item", "category"],
                            },
                        },
                    },
                    "required": ["week", "items"],
                },
            }
        },
        "required": ["weeks"],
    },
}

SYSTEM = """You are building a weekly grocery shopping list for an Indian functional-medicine client from their prescribed meal plan.

HARD RULES:
1. Derive ingredients ONLY from the dishes on the menu (and the recipe pack's ingredient lists when given). Never invent dishes or add foods that aren't implied by the menu.
2. Use Indian shopping names a Mumbai household uses: atta (not flour types in English alone), dahi, paneer, methi, palak, jeera, haldi, sabzi vegetable names. Keep English in brackets only when helpful, e.g. "Ragi (finger millet) atta".
3. Quantities are for ONE person for ONE week, rounded to practical purchase sizes (e.g. "500 g", "1 small bunch", "12 (1/day + cooking)"). Count repeated dishes across the week when sizing.
4. Categorise for the shopping trip using exactly the given categories.
5. Mark `staple: true` for pantry items virtually every Indian kitchen already stocks (salt, haldi, jeera, basic oil, common whole spices) — buyers skip these unless out.
6. Aggregate: one line per ingredient per week, not per dish. List the dishes it's for in `for` (max 4, short names).
7. Respect the stated dietary preference absolutely — never list ingredients that violate it.
8. Keep each week's list focused: typically 20-40 lines including staples."""


def _build_user(payload: dict[str, Any]) -> str:
    lines: list[str] = []
    pref = payload.get("dietary_preference") or ""
    if pref:
        lines.append(f"DIETARY PREFERENCE (absolute): {pref}\n")
    for wk in payload.get("weeks") or []:
        lines.append(f"## Week {wk.get('week')}")
        for day in wk.get("days") or []:
            slots = ", ".join(
                f"{s.get('slot')}: {s.get('dish')}" for s in (day.get("slots") or []) if s.get("dish")
            )
            if slots:
                lines.append(f"- {day.get('dow')}: {slots}")
        lines.append("")
    rec = (payload.get("recipes_text") or "").strip()
    if rec:
        lines.append("## Recipe pack (ingredient lists — use these for exact ingredients)\n")
        lines.append(rec[:20000])
    return "\n".join(lines)


def main() -> None:
    _load_dotenv()
    payload = json.loads(sys.stdin.read() or "{}")
    client_id = payload.get("client_id") or ""
    plan_slug = payload.get("plan_slug") or ""
    weeks = payload.get("weeks") or []
    if not client_id or not plan_slug or not weeks:
        print(json.dumps({"ok": False, "error": "client_id, plan_slug and weeks are required", "path": None, "weeks": [], "usage": None}))
        return

    plans_root = Path(os.environ.get("FMDB_PLANS_DIR") or (Path.home() / "fm-plans")).expanduser()
    out_path = plans_root / "clients" / client_id / "meal-plans" / f"{plan_slug}-grocery.yaml"

    if payload.get("dry_run"):
        print(json.dumps({"ok": True, "path": str(out_path), "weeks": [{"week": w.get("week"), "items": 0} for w in weeks], "usage": None, "error": None, "dry_run": True}))
        return

    from anthropic_client import build_client  # noqa: E402

    client = build_client()
    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=8192,
            system=SYSTEM,
            tools=[_TOOL],
            tool_choice={"type": "tool", "name": "record_grocery_list"},
            messages=[{"role": "user", "content": _build_user(payload)}],
        )
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"API call failed: {e}", "path": None, "weeks": [], "usage": None}))
        return

    # Truncation guard (audit rule 2026-06-05): never persist clipped output.
    if resp.stop_reason == "max_tokens":
        print(json.dumps({"ok": False, "error": "output truncated (max_tokens) — not saved", "path": None, "weeks": [], "usage": None}))
        return

    tool_input: dict[str, Any] | None = None
    for block in resp.content:
        if getattr(block, "type", "") == "tool_use" and getattr(block, "name", "") == "record_grocery_list":
            tool_input = block.input  # type: ignore[assignment]
            break
    if not tool_input or not tool_input.get("weeks"):
        print(json.dumps({"ok": False, "error": "model returned no grocery data", "path": None, "weeks": [], "usage": None}))
        return

    doc = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "plan_slug": plan_slug,
        "model": MODEL,
        "weeks": tool_input["weeks"],
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_text_atomic(out_path, yaml.safe_dump(doc, sort_keys=False, allow_unicode=True))

    usage_entry = None
    try:
        from fmdb.usage import log_usage  # noqa: E402

        usage_entry = log_usage(
            client_id=client_id,
            script="generate-grocery-list.py",
            model=MODEL,
            usage=resp.usage,
            notes=f"grocery list for {plan_slug}",
        )
    except Exception:
        pass

    print(
        json.dumps(
            {
                "ok": True,
                "path": str(out_path),
                "weeks": [{"week": w.get("week"), "items": len(w.get("items") or [])} for w in tool_input["weeks"]],
                "usage": usage_entry,
                "error": None,
            }
        )
    )


if __name__ == "__main__":
    main()
