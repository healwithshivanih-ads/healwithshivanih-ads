#!/usr/bin/env python3
"""Record the client's daily checklist — what she actually ticked off today.

This is the richest adherence signal the app produces: per supplement, per
remedy, per practice, every day. It lived in localStorage only, so it was
thrown away every time — the coach could not tell whether a client was taking
her supplements, and the practice-phasing work had to fall back on app-opens
and the weekly poll.

ONE record per local calendar day, upserted. The app posts the WHOLE of
today's checklist each time (debounced), so the newest post for a date wins
and an untick is recorded as faithfully as a tick — a client correcting
herself must not leave the earlier, rosier row standing.

The record carries the DENOMINATOR as well as the ticks: every item she was
shown today, with its name. Plans change; ids get renumbered (practice ids are
positional). Without the denominator captured at tick-time, a row read three
weeks later says "4 done" against a list that no longer exists.

`date` is the DEVICE's local day, not the server's — a US client's evening is
already tomorrow in UTC, and her day must not split across two rows. It is
sanity-clamped to ±2 days of server-today so a wrong device clock cannot write
rows into next year.

Reads JSON from stdin:
{
  "client_id": str,
  "date":      "YYYY-MM-DD",   # device-local day
  "plan_slug": str | null,
  "week":      int | null,
  "items": [ {"kind": "supplement"|"remedy"|"practice",
              "id": str, "name": str, "done": bool, "at": str|null}, ... ]
}

Writes JSON to stdout: {"ok": bool, "error": str?}
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

KINDS = ("supplement", "remedy", "practice")
MAX_ITEMS = 80


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / "fm-plans"


def _clean_date(raw, today: datetime) -> "str | None":
    """Accept a device-local YYYY-MM-DD within ±2 days of server-today.

    The window absorbs every real timezone offset (UTC-12 … UTC+14 spans less
    than two days either side) while refusing a device whose clock is wrong by
    months — those rows would poison every trailing-window average the coach
    reads.
    """
    if not isinstance(raw, str):
        return None
    try:
        d = datetime.strptime(raw.strip(), "%Y-%m-%d").date()
    except ValueError:
        return None
    if abs((d - today.date()).days) > 2:
        return None
    return d.isoformat()


def _clean_items(raw) -> list:
    if not isinstance(raw, list):
        return []
    out = []
    seen = set()
    for it in raw[:MAX_ITEMS]:
        if not isinstance(it, dict):
            continue
        kind = str(it.get("kind") or "").strip().lower()
        if kind not in KINDS:
            continue
        item_id = str(it.get("id") or "").strip()[:120]
        if not item_id or (kind, item_id) in seen:
            continue
        seen.add((kind, item_id))
        at = it.get("at")
        out.append(
            {
                "kind": kind,
                "id": item_id,
                "name": str(it.get("name") or "").strip()[:160],
                "done": bool(it.get("done")),
                "at": str(at).strip()[:20] if isinstance(at, str) and at.strip() else None,
            }
        )
    return out


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        json.dump({"ok": False, "error": "client_id required"}, sys.stdout)
        return 2

    now = datetime.now(timezone.utc)
    date = _clean_date(payload.get("date"), now)
    if not date:
        json.dump({"ok": False, "error": "bad or out-of-range date"}, sys.stdout)
        return 2

    items = _clean_items(payload.get("items"))
    if not items:
        json.dump({"ok": False, "error": "no items"}, sys.stdout)
        return 2

    client_dir = _plans_root() / "clients" / client_id
    if not client_dir.exists():
        json.dump({"ok": False, "error": f"client not found: {client_id}"}, sys.stdout)
        return 2

    week = payload.get("week")
    record = {
        "ts": now.isoformat(),
        "date": date,
        "plan_slug": (payload.get("plan_slug") or None),
        "week": week if isinstance(week, int) and 0 < week < 400 else None,
        "done": sum(1 for i in items if i["done"]),
        "total": len(items),
        "items": items,
        "source": "client_app",
    }

    log_path = client_dir / "_daily_ticks.jsonl"

    # Upsert by date: today's row is rewritten in place rather than appended,
    # so a client toggling boxes through the day leaves ONE row, not thirty.
    # Rows for other days are copied through untouched.
    kept: list[str] = []
    try:
        existing = log_path.read_text(encoding="utf-8")
    except OSError:
        existing = ""
    for line in existing.splitlines():
        if not line.strip():
            continue
        try:
            if json.loads(line).get("date") == date:
                continue  # superseded by this post
        except json.JSONDecodeError:
            pass  # keep a malformed line rather than silently dropping history
        kept.append(line)
    kept.append(json.dumps(record, ensure_ascii=False))

    # tmp + rename: a rewrite must never leave a half-written history behind.
    tmp = log_path.with_suffix(f".jsonl.tmp-{os.getpid()}")
    try:
        tmp.write_text("\n".join(kept) + "\n", encoding="utf-8")
        tmp.replace(log_path)
    except OSError as e:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        json.dump({"ok": False, "error": f"write failed: {e}"}, sys.stdout)
        return 1

    json.dump({"ok": True}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
