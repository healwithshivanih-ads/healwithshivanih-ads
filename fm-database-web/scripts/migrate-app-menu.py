#!/usr/bin/env python3
"""One-off migration: write a letter-derived app_menu into a published plan.

Mirrors client-app.ts parseWeekTables (formats A + B) + weekTablesToAppMenu +
migrateMenuIntoPlan for clients whose apps never loaded (no app_token), so the
self-migration in the app data layer never fired. Idempotent — skips plans
that already carry app_menu.

stdin: {"client_id": "...", "plan_slug": "...", "letter_md": "<filename.md>", "dry_run": bool}
stdout: {"ok": true, "weeks": N, "dishes": N, "skipped": "..."} | {"ok": false, "error": "..."}
"""
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

PLANS_ROOT = Path(os.environ.get("FMDB_PLANS_DIR") or Path.home() / "fm-plans")
DOW_SHORT = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def clean_dish_cell(raw: str) -> str:
    c = re.sub(r"[✦✨⭐]", "", raw).replace("**", "").strip()
    if re.match(r"^same\b", c, re.I) or re.match(r"^[-–—]+$", c):
        return ""
    return c


def parse_week_tables(md: str) -> list[dict]:
    tables = []
    for m in re.finditer(r"^#{2,3} .*?Week (\d+)[^\n]*$", md, re.I | re.M):
        week = int(m.group(1))
        rest = md[m.end():]
        table_lines = []
        in_table = False
        for line in rest.split("\n"):
            t = line.strip()
            if t.startswith("|"):
                in_table = True
                parts = [c.strip() for c in t.split("|")]
                cells = parts[1:-1]
                if len(cells) >= 2 and not re.match(r"^[-:\s]+$", cells[0]):
                    table_lines.append(cells)
            elif in_table:
                break
            elif t.startswith("#"):
                break
        if len(table_lines) < 2:
            continue
        header = [c.replace("**", "").strip() for c in table_lines[0]]
        if re.match(r"^day$", header[0], re.I):
            # format B: rows are days, columns are slots
            slots = header[1:]
            rows = [{"slot": s, "cells": [""] * 7} for s in slots]
            day_dates: list = [None] * 7
            for cells in table_lines[1:]:
                day_cell = cells[0].replace("**", "").strip()
                dow_m = re.match(r"^(mon|tue|wed|thu|fri|sat|sun)", day_cell, re.I)
                if not dow_m:
                    continue
                col = DOW_SHORT.index(dow_m.group(1).lower())
                date_m = re.search(r"(\d{1,2}\s+\w{3,})", day_cell)
                if date_m:
                    day_dates[col] = date_m.group(1)
                for si in range(len(slots)):
                    rows[si]["cells"][col] = clean_dish_cell(cells[si + 1] if si + 1 < len(cells) else "")
            if any(any(r["cells"]) for r in rows):
                tables.append({"week": week, "rows": rows, "dayDates": day_dates})
        else:
            # format A: rows are slots, columns are Mon..Sun
            rows = []
            for cells in table_lines[1:]:
                if len(cells) < 8:
                    continue
                slot = cells[0].replace("**", "").strip()
                if slot.startswith("*"):
                    continue
                rows.append({"slot": slot, "cells": [clean_dish_cell(c) for c in cells[1:8]]})
            if rows:
                tables.append({"week": week, "rows": rows})
    return tables


def to_app_menu(tables: list[dict], synced_from: str) -> dict:
    return {
        "is_sample": len(tables) == 1,
        "synced_from": synced_from,
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "weeks": [
            {
                "week": t["week"],
                "day_dates": t.get("dayDates"),
                "days": [
                    {
                        "slots": [
                            {
                                "slot": re.sub(r"\s*\([^)]*\)\s*$", "", r["slot"]).strip(),
                                "dish": r["cells"][di],
                            }
                            for r in t["rows"]
                            if r["cells"][di]
                        ]
                    }
                    for di in range(7)
                ],
            }
            for t in tables
        ],
    }


def main() -> int:
    payload = json.loads(sys.stdin.read() or "{}")
    client_id = payload.get("client_id", "")
    plan_slug = payload.get("plan_slug", "")
    letter_md = payload.get("letter_md", "")
    dry_run = bool(payload.get("dry_run"))

    letter_path = PLANS_ROOT / "clients" / client_id / "meal-plans" / letter_md
    if not letter_path.exists():
        print(json.dumps({"ok": False, "error": f"letter not found: {letter_path}"}))
        return 1

    published = sorted((PLANS_ROOT / "published").glob(f"{plan_slug}-v*.yaml"), reverse=True)
    if not published:
        print(json.dumps({"ok": False, "error": f"no published file for {plan_slug}"}))
        return 1
    plan_file = published[0]
    doc = yaml.safe_load(plan_file.read_text()) or {}
    if doc.get("app_menu"):
        print(json.dumps({"ok": True, "skipped": "app_menu already present"}))
        return 0

    tables = parse_week_tables(letter_path.read_text())
    if not tables:
        print(json.dumps({"ok": False, "error": "no week tables parsed from letter"}))
        return 1

    menu = to_app_menu(tables, "issued letters (one-time migration)")
    dishes = sum(len(d["slots"]) for w in menu["weeks"] for d in w["days"])
    if dry_run:
        print(json.dumps({"ok": True, "dry_run": True, "weeks": len(menu["weeks"]), "dishes": dishes, "menu": menu}))
        return 0

    doc["app_menu"] = menu
    amendments = doc.get("amendments") or []
    amendments.append({
        "at": datetime.now(timezone.utc).isoformat(),
        "by": "system",
        "field": "app_menu",
        "summary": "Menu migrated from issued letters — the plan is now the source of truth.",
    })
    doc["amendments"] = amendments
    tmp = plan_file.with_suffix(f".tmp-{os.getpid()}")
    tmp.write_text(yaml.dump(doc, sort_keys=False, width=100, allow_unicode=True))
    tmp.rename(plan_file)
    print(json.dumps({"ok": True, "weeks": len(menu["weeks"]), "dishes": dishes, "file": str(plan_file)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
