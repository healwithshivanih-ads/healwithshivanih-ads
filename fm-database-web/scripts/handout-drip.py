#!/usr/bin/env python3
"""Staggered handout drip — schedule + auto-enqueue into the WhatsApp cron.

Given a client with a published plan that has handouts attached, build a
priority-ordered, date-stamped drip schedule anchored to the plan's Day 1
(meal_plan_started_on, else plan_period_start + 3d, else today), front-loaded
(the early high-impact guides land first), and enqueue one row per handout
into ~/fm-plans/_pending_sends.yaml. The existing fm-coach-cron sidecar fires
each row's `fm_handout_v1` template on its send_at — fully automatic.

Sends only succeed once `fm_handout_v1` is approved by Meta; until then rows
sit queued (or the coach runs `setup` after approval). Schedule is also stored
at clients/<id>/handout_schedule.yaml for the UI to display + to avoid
double-enqueueing.

Actions (JSON on stdin): {"action": "setup"|"load"|"preview", "client_id": str}
"""
from __future__ import annotations

import json
import os
import sys
import datetime
from pathlib import Path

import yaml

# Priority order for the known starter handouts (foundational / immediately
# actionable first). Anything attached but not listed appends after, in
# attach order. Front-loaded cadence in days from Day 1.
PRIORITY = [
    "thyroid-everyday-support",
    "iron-for-vegetarians",
    "steady-blood-sugar",
    "vitamin-d-and-b12-basics",
    "sleep-and-stress-reset",
    "gut-and-hormone-balance",
]
CADENCE_DAYS = [0, 7, 14, 28, 42, 56, 70, 84, 98, 112]

APP_URL = (os.environ.get("NEXT_PUBLIC_APP_URL") or "https://intake.theochretree.com").rstrip("/")


def _plans_root() -> Path:
    return Path(os.environ.get("FMDB_PLANS_DIR") or os.path.expanduser("~/fm-plans"))


def _resources_root() -> Path:
    return Path(os.path.expanduser(os.environ.get("FMDB_RESOURCES_DIR") or "~/fm-resources")) / "resources"


def _handout_titles() -> dict:
    return {slug: d.get("title", slug) for slug, d in _load_all_handouts().items()}


def _active_plan(root: Path, client_id: str) -> dict | None:
    """Most recent published plan for the client."""
    pub = root / "published"
    best = None
    if pub.is_dir():
        for f in sorted(pub.glob("*.yaml"), reverse=True):
            try:
                p = yaml.safe_load(f.read_text()) or {}
            except Exception:
                continue
            if p.get("client_id") == client_id:
                if best is None or str(p.get("updated_at", "")) > str(best.get("updated_at", "")):
                    best = p
    return best


def _day1(plan: dict) -> datetime.date:
    msd = plan.get("meal_plan_started_on")
    if msd:
        try:
            return datetime.date.fromisoformat(str(msd)[:10])
        except Exception:
            pass
    pps = plan.get("plan_period_start")
    if pps:
        try:
            return datetime.date.fromisoformat(str(pps)[:10]) + datetime.timedelta(days=3)
        except Exception:
            pass
    return datetime.date.today()


def _load_all_handouts() -> dict[str, dict]:
    """slug → full resource dict for every article-kind handout."""
    out = {}
    rd = _resources_root()
    if rd.is_dir():
        for f in rd.glob("*.yaml"):
            if f.stem == "test-brief":
                continue
            try:
                d = yaml.safe_load(f.read_text()) or {}
            except Exception:
                continue
            if d.get("kind") == "article":
                out[d.get("slug", f.stem)] = d
    return out


def _auto_match(plan: dict, handouts: dict[str, dict]) -> list[str]:
    """Match handouts whose related_topics overlap with plan topics."""
    plan_topics = set(plan.get("primary_topics") or [])
    for driver in plan.get("hypothesized_drivers") or []:
        if isinstance(driver, dict):
            slug = driver.get("mechanism") or driver.get("topic") or ""
            if slug:
                plan_topics.add(slug)
    contributing = plan.get("contributing_topics") or []
    if isinstance(contributing, list):
        for item in contributing:
            if isinstance(item, dict):
                plan_topics.add(item.get("mechanism") or item.get("topic") or "")
            elif isinstance(item, str):
                plan_topics.add(item)
    plan_topics.discard("")

    matched = []
    for slug, res in handouts.items():
        htopics = set(res.get("related_topics") or [])
        if htopics & plan_topics:
            matched.append(slug)
    return matched


def _effective_slugs(plan: dict, handouts: dict[str, dict]) -> list[str]:
    """Attached slugs if set, else auto-matched from plan topics."""
    attached = [s for s in (plan.get("attached_resources") or []) if s in handouts]
    if attached:
        return attached
    return _auto_match(plan, handouts)


def _build_schedule(client: dict, plan: dict) -> list[dict]:
    handouts = _load_all_handouts()
    titles = {slug: d.get("title", slug) for slug, d in handouts.items()}
    attached = _effective_slugs(plan, handouts)
    # order: known priority first, then any extras in attach order
    ordered = [s for s in PRIORITY if s in attached] + [s for s in attached if s not in PRIORITY]
    d1 = _day1(plan)
    sched = []
    for i, slug in enumerate(ordered):
        offset = CADENCE_DAYS[i] if i < len(CADENCE_DAYS) else CADENCE_DAYS[-1] + (i - len(CADENCE_DAYS) + 1) * 14
        send_on = d1 + datetime.timedelta(days=offset)
        sched.append({
            "slug": slug,
            "title": titles.get(slug, slug),
            "week": offset // 7,
            "send_on": send_on.isoformat(),
            "url": f"{APP_URL}/handouts/{slug}.html",
            "sent_at": None,
        })
    return sched


def _sched_path(root: Path, client_id: str) -> Path:
    return root / "clients" / client_id / "handout_schedule.yaml"


def _enqueue(root: Path, client: dict, plan: dict, sched: list[dict]) -> int:
    """Append one pending-send row per not-yet-sent handout. Mirrors the row
    shape drained by fm-coach-cron (plan-publish-followups.ts)."""
    pend_file = root / "_pending_sends.yaml"
    try:
        existing = yaml.safe_load(pend_file.read_text()) if pend_file.exists() else []
    except Exception:
        existing = []
    existing = existing or []
    # avoid duplicate handout rows for this client+slug
    have = {(r.get("client_id"), r.get("kind"), tuple(r.get("template_params", [])[:1]))
            for r in existing if isinstance(r, dict)}
    fname = (client.get("display_name") or client.get("client_id") or "").split()[0] or "there"
    phone = client.get("mobile_number") or ""
    added = 0
    import secrets
    for item in sched:
        if item.get("sent_at"):
            continue
        send_at_iso = datetime.datetime.fromisoformat(item["send_on"]).replace(
            hour=4, minute=30, tzinfo=datetime.timezone.utc).isoformat()  # ~10am IST
        row = {
            "id": secrets.token_urlsafe(6),
            "send_at": send_at_iso,
            "kind": "handout",
            "client_id": client.get("client_id"),
            "plan_slug": plan.get("slug"),
            "phone": phone,
            "template_name": "fm_handout_v1",
            "template_params": [fname, item["title"], item["url"]],
        }
        key = (row["client_id"], "handout", (fname,))  # weak dedupe per client
        # finer dedupe: skip if a row with same slug-url already queued
        if any(r.get("kind") == "handout" and r.get("client_id") == row["client_id"]
               and r.get("template_params", [])[2:3] == [item["url"]] for r in existing if isinstance(r, dict)):
            continue
        existing.append(row)
        added += 1
    from atomic_write import write_text_atomic  # audit Phase-1b: atomic _pending_sends write
    write_text_atomic(pend_file, yaml.safe_dump(existing, sort_keys=False, allow_unicode=True))
    return added


def main() -> int:
    payload = json.load(sys.stdin)
    action = payload.get("action", "preview")
    cid = (payload.get("client_id") or "").strip()
    root = _plans_root()
    if not cid:
        print(json.dumps({"ok": False, "error": "client_id required"})); return 0
    cfile = root / "clients" / cid / "client.yaml"
    if not cfile.exists():
        print(json.dumps({"ok": False, "error": f"client {cid} not found"})); return 0
    client = yaml.safe_load(cfile.read_text()) or {}

    if action == "load":
        sp = _sched_path(root, cid)
        sched = (yaml.safe_load(sp.read_text()) or {}).get("items", []) if sp.exists() else []
        print(json.dumps({"ok": True, "schedule": sched})); return 0

    plan = _active_plan(root, cid)
    if not plan:
        print(json.dumps({"ok": False, "error": "no published plan for this client"})); return 0
    sched = _build_schedule(client, plan)
    if not sched:
        print(json.dumps({"ok": False, "error": "no handouts attached to the active plan"})); return 0

    if action == "list":
        # Return all available handouts with attached + auto-matched flags for the UI.
        handouts = _load_all_handouts()
        currently_attached = set(plan.get("attached_resources") or [])
        auto = set(_auto_match(plan, handouts))
        items = []
        for slug, res in sorted(handouts.items()):
            items.append({
                "slug": slug,
                "title": res.get("title", slug),
                "attached": slug in currently_attached,
                "matched": slug in auto,
            })
        print(json.dumps({"ok": True, "handouts": items, "plan_slug": plan.get("slug")}))
        return 0

    if action == "update_attachments":
        # Write the coach-selected slugs to attached_resources on the published plan file.
        new_slugs = payload.get("slugs") or []
        pub = root / "published"
        target = None
        if pub.is_dir():
            for f in sorted(pub.glob("*.yaml"), reverse=True):
                try:
                    p = yaml.safe_load(f.read_text()) or {}
                except Exception:
                    continue
                if p.get("client_id") == cid:
                    target = f
                    break
        if not target:
            print(json.dumps({"ok": False, "error": "published plan file not found"}))
            return 0
        plan_data = yaml.safe_load(target.read_text()) or {}
        plan_data["attached_resources"] = new_slugs
        target.write_text(yaml.safe_dump(plan_data, sort_keys=False, allow_unicode=True))
        print(json.dumps({"ok": True, "slugs": new_slugs}))
        return 0

    if action == "preview":
        print(json.dumps({"ok": True, "schedule": sched, "day1": _day1(plan).isoformat()})); return 0

    if action == "setup":
        # If slugs were auto-matched (not explicitly attached), persist them to the plan now.
        handouts = _load_all_handouts()
        currently_attached = plan.get("attached_resources") or []
        if not currently_attached:
            matched_slugs = [item["slug"] for item in sched]
            pub = root / "published"
            if pub.is_dir():
                for f in sorted(pub.glob("*.yaml"), reverse=True):
                    try:
                        p = yaml.safe_load(f.read_text()) or {}
                    except Exception:
                        continue
                    if p.get("client_id") == cid:
                        p["attached_resources"] = matched_slugs
                        f.write_text(yaml.safe_dump(p, sort_keys=False, allow_unicode=True))
                        break
        # persist schedule
        sp = _sched_path(root, cid)
        sp.parent.mkdir(parents=True, exist_ok=True)
        sp.write_text(yaml.safe_dump(
            {"plan_slug": plan.get("slug"), "day1": _day1(plan).isoformat(), "items": sched},
            sort_keys=False, allow_unicode=True))
        enq = _enqueue(root, client, plan, sched)
        print(json.dumps({"ok": True, "schedule": sched, "enqueued": enq,
                          "note": "Rows queued; the cron fires fm_handout_v1 on each date once Meta approves it."}))
        return 0

    print(json.dumps({"ok": False, "error": f"unknown action {action}"}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
