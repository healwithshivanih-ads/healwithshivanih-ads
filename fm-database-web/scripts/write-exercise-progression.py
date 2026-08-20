#!/usr/bin/env python3
"""Write the PROGRESSION onto every prescribed exercise in a plan.

A level with no next rung is a plateau with extra steps. This reads each
exercise's ladder from the catalogue and writes, in the client's own words:
where they are now (the rung's OWN prescription, not the letter), what READY
looks like, and what comes next.

Deterministic and idempotent — no model call, safe to re-run after a level
changes. Skips entries with no ladder (warm-ups, cool-downs, pacing drills,
which are deliberately levelless).

stdin:  {"plan_slug": str, "dry_run": bool}
stdout: {"ok": bool, "written": N, "topped_out": [...], "no_ladder": [...], "error": str|null}
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import yaml

CAT = Path(__file__).resolve().parents[2] / "fm-database" / "data" / "exercises"


def plans_root() -> Path:
    return Path(os.environ.get("FMDB_PLANS_DIR") or (Path.home() / "fm-plans"))


def rung_text(lv: dict) -> str:
    """The rung as the client should hear it — its own prescription, not 'level B'."""
    p = str(lv.get("prescription") or "").strip()
    if p:
        return p
    bits = [f"{lv[k]} {k}" for k in ("reps", "sets", "hold", "support") if lv.get(k)]
    return ", ".join(bits) or str(lv.get("level", ""))


def main() -> int:
    q = json.loads(sys.stdin.read() or "{}")
    slug, dry = q.get("plan_slug"), bool(q.get("dry_run"))
    if not slug:
        print(json.dumps({"ok": False, "error": "plan_slug required"}))
        return 1

    root = plans_root()
    hits = list((root / "published").glob(f"{slug}-v*.yaml")) or list((root / "drafts").glob(f"{slug}.yaml"))
    if not hits:
        print(json.dumps({"ok": False, "error": f"plan not found: {slug}"}))
        return 1
    f = hits[0]
    plan = yaml.safe_load(f.read_text())

    written, topped, noladder, missing = 0, [], [], []
    for pr in plan.get("lifestyle_practices") or []:
        for e in pr.get("exercises") or []:
            cf = CAT / f"{e.get('exercise')}.yaml"
            if not cf.exists():
                missing.append(e.get("exercise"))
                continue
            d = yaml.safe_load(cf.read_text())
            levels = d.get("levels") or []
            if not levels:
                noladder.append(e["exercise"])
                continue
            labels = [str(l.get("level")) for l in levels]
            cur = str(e.get("level") or labels[0])
            if cur not in labels:
                cur = labels[0]
                e["level"] = cur
            i = labels.index(cur)
            now = rung_text(levels[i])
            if i + 1 < len(levels):
                nxt = rung_text(levels[i + 1])
                e["note"] = (
                    f"Now: {now}. "
                    f"When that feels comfortable three times a week — not sooner — it becomes: {nxt}."
                )
            else:
                topped.append(e["exercise"])
                e["note"] = (
                    f"Now: {now}. This is the top of this one — stay here and keep it steady "
                    f"rather than pushing for more."
                )
            written += 1

    if written and not dry:
        f.write_text(yaml.safe_dump(plan, sort_keys=False, allow_unicode=True, width=96, default_flow_style=False))

    print(json.dumps({
        "ok": True, "written": written, "topped_out": topped,
        "no_ladder": noladder, "missing_from_catalogue": missing,
        "dry_run": dry, "error": None,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
