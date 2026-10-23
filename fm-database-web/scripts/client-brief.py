#!/usr/bin/env python
"""client-brief.py — everything the coach re-explains in chat, in one block.

Usage:
    client-brief.py <client_id | name fragment>        # markdown to stdout
    client-brief.py <id> --json                         # the same, as JSON
    echo '{"client":"nazneen"}' | client-brief.py       # shim form (JSON out)

Deterministic and free: files and dates only, never a model call. Nothing in
~/fm-plans is written. Read-only on purpose — this is the briefing the
author-* skills and the Brief view share, so it must never have side effects.

Why it exists (docs/COACH_APP_RESTRUCTURE_REVIEW.md §4D): three chat skills
each rebuilt client context a different way, and none of them rendered the
three things the coach kept re-typing — lifecycle state, what was last sent
and received, and whether the client is using the app. This renders those,
plus the clinical snapshot assess.py already assembles, plus what is waiting
on the inbox for this person.

Sections, in the order a coach reads them:
  who          name, id, age/sex, city, diet rules, conditions, meds, allergies, goals
  lifecycle    state, since, reason, tier paid, renewal decision, opt-out
  plan         live plan, week N of M, phase, ends, supplements, practices, deferred items
  recent       last 8 thread messages in/out (dated, channel, template), last check-in,
               last labs date, last session, pending sends
  app          last open, opens in 14d, ticks this week, practices logged, feedback
  do not       opt-out, foods to avoid, triggers, non-negotiables, anxious flags
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Optional

import yaml

FMDB_ROOT = Path(__file__).resolve().parents[2] / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))

from fmdb.plan.dairy import coach_label as _dairy_coach_label  # noqa: E402

from fmdb.plan.lifecycle import (  # noqa: E402
    effective_meal_plan_start,
    effective_recheck_date,
    load_all_plans,
    load_decisions,
    resolve_lifecycle,
)


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR", "").strip()
    return Path(env).expanduser() if env else Path.home() / "fm-plans"


def _ymd(v: Any) -> Optional[dt.date]:
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    if isinstance(v, str):
        try:
            return dt.date.fromisoformat(v.strip()[:10])
        except ValueError:
            return None
    return None


def _iso(d: Optional[dt.date]) -> Optional[str]:
    return d.isoformat() if d else None


def _as_list(v: Any) -> list[str]:
    """client.yaml fields that are sometimes a list and sometimes free text."""
    if v is None:
        return []
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    text = str(v).strip()
    if not text:
        return []
    parts = [t.strip(" -•") for t in re.split(r"\n|;", text)]
    return [t for t in parts if t]


def _load(path: Path) -> dict:
    try:
        doc = yaml.safe_load(path.read_text()) or {}
        return doc if isinstance(doc, dict) else {}
    except Exception:
        return {}


# ── locate the person ─────────────────────────────────────────────────────────


def find_person(root: Path, needle: str) -> tuple[Optional[dict], Optional[Path], bool]:
    """By id first, then by case-insensitive name fragment. Returns (doc, dir, parked)."""
    needle = needle.strip()
    for base, parked in (("clients", False), ("prospects", True)):
        p = root / base / needle / "client.yaml"
        if p.exists():
            return _load(p), p.parent, parked
    hits: list[tuple[dict, Path, bool]] = []
    low = needle.lower()
    for base, parked in (("clients", False), ("prospects", True)):
        for f in sorted((root / base).glob("*/client.yaml")) if (root / base).is_dir() else []:
            d = _load(f)
            if low and low in str(d.get("display_name") or "").lower():
                hits.append((d, f.parent, parked))
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        names = ", ".join(f"{h[0].get('client_id')} ({h[0].get('display_name')})" for h in hits)
        raise SystemExit(f"ambiguous: {names}")
    return None, None, False


# ── thread (the rolling WhatsApp / email sessions) ────────────────────────────

_TAG = re.compile(r"\[([a-z_]+):\s*([^\]]*)\]", re.I)
_SEG_SPLIT = re.compile(r"\n\s*---\s*\n")
_WEBHOOK_HEAD = re.compile(r"^WhatsApp message from .*?Received:\s*(\d{1,2})/(\d{1,2})/(\d{4}),\s*(\d{1,2}):(\d{2}):\d{2}\s*([ap]m)\s*", re.I)
_INBOUND_SOURCES = {"whatsapp_webhook", "whatsapp_inbound", "email_inbound", "client_app_chat", "app_chat"}
_OUTBOUND_SOURCES = {"whatsapp_outbound", "email_outbound"}


def thread_messages(sessions: list[tuple[Path, dict]], limit: int = 8) -> list[dict]:
    out: list[dict] = []
    for f, d in sessions:
        pc = str(d.get("presenting_complaints") or "")
        if "[source:" not in pc:
            continue
        sdate = str(d.get("date") or "")[:10]
        # A rolling thread file starts with an inbound tag; later inbound
        # segments appended by the webhook carry no tag of their own (the TS
        # thread reader uses the same rule).
        inbound_thread = "[source: whatsapp_webhook]" in pc or "[source: whatsapp_inbound]" in pc
        for seg in _SEG_SPLIT.split(pc):
            tags = {k.lower(): v.strip() for k, v in _TAG.findall(seg)}
            src = tags.get("source", "")
            if src in _INBOUND_SOURCES:
                direction = "in"
            elif src in _OUTBOUND_SOURCES:
                direction = "out"
            elif inbound_thread and not src:
                direction = "in"
            else:
                continue
            text = _TAG.sub("", seg).strip()
            text = re.sub(r"\s+", " ", text)
            when = (tags.get("sent_at") or tags.get("received_at") or sdate)[:16].replace("T", " ")
            # The webhook writes "WhatsApp message from <name> (<phone>) Received:
            # 22/7/2026, 11:08:00 am <body>" — lift the timestamp, drop the header.
            m = _WEBHOOK_HEAD.match(text)
            if m:
                dd, mm, yyyy, hh, mi, ampm = m.groups()
                h = int(hh) % 12 + (12 if ampm.lower() == "pm" else 0)
                when = f"{yyyy}-{int(mm):02d}-{int(dd):02d} {h:02d}:{mi}"
                text = text[m.end():].strip()
            if not text:
                continue
            out.append({
                "when": when,
                "direction": direction,
                "channel": "email" if "email" in src else "whatsapp",
                "template": tags.get("template"),
                "text": text[:220],
            })
    # File order IS chronological (session files are date-named, segments are
    # appended). Sorting by `when` would push untagged inbound segments, which
    # carry only the session date, ahead of every timestamped outbound one.
    return out[-limit:]


# ── app engagement ────────────────────────────────────────────────────────────


def app_usage(cdir: Path, today: dt.date) -> dict:
    opens: list[str] = []
    doc = _load(cdir / "_app_opens.yaml")
    if isinstance(doc.get("opens"), list):
        opens = [str(x) for x in doc["opens"]]
    opens.sort()
    cutoff14 = (today - dt.timedelta(days=14)).isoformat()
    ticks_week = None
    tf = cdir / "_daily_ticks.jsonl"
    if tf.exists():
        week_cut = (today - dt.timedelta(days=7)).isoformat()
        done = total = days = 0
        for line in tf.read_text().splitlines()[-60:]:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if str(row.get("date", "")) >= week_cut:
                done += int(row.get("done") or 0)
                total += int(row.get("total") or 0)
                days += 1
        ticks_week = {"days_logged": days, "done": done, "of": total}
    practices = None
    pf = cdir / "_practice_log.jsonl"
    if pf.exists():
        rows = []
        for line in pf.read_text().splitlines()[-40:]:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        recent = [r for r in rows if str(r.get("date", "")) >= cutoff14]
        practices = {"sessions_14d": len(recent), "last": (rows[-1].get("date") if rows else None),
                     "last_name": (rows[-1].get("name") if rows else None)}
    return {
        "last_open": opens[-1][:16].replace("T", " ") if opens else None,
        "opens_14d": sum(1 for o in opens if o >= cutoff14),
        "ticks_this_week": ticks_week,
        "practices": practices,
    }


# ── pending sends / deferred items / coach notes ──────────────────────────────


def pending_sends(root: Path, cid: str, phone: str) -> list[dict]:
    doc = _load(root / "_pending_sends.yaml") if (root / "_pending_sends.yaml").exists() else {}
    rows = doc if isinstance(doc, list) else doc.get("rows") or doc.get("pending") or []
    if not isinstance(rows, list):
        try:
            rows = yaml.safe_load((root / "_pending_sends.yaml").read_text()) or []
        except Exception:
            rows = []
    last10 = re.sub(r"\D", "", phone or "")[-10:]
    out = []
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        rp = re.sub(r"\D", "", str(r.get("phone") or ""))[-10:]
        if r.get("client_id") == cid or (last10 and rp == last10):
            out.append({"kind": r.get("kind"), "due": str(r.get("send_at") or r.get("due_at") or "")[:16],
                        "template": r.get("template_name"), "status": r.get("status")})
    return out


def deferred_items(root: Path, slug: Optional[str]) -> list[str]:
    if not slug:
        return []
    doc = _load(root / "_deferred_items.yaml")
    out = []
    for key, v in doc.items():
        if str(key).startswith(slug) and isinstance(v, dict) and v.get("status") in (None, "open", "deferred"):
            out.append(f"{key.split('::')[-1]}: {v.get('status') or 'open'}")
    return out


# ── the brief ─────────────────────────────────────────────────────────────────


def build(root: Path, needle: str, today: dt.date) -> dict:
    c, cdir, parked = find_person(root, needle)
    if not c or not cdir:
        return {"ok": False, "error": f"no such person: {needle}"}
    cid = str(c.get("client_id") or cdir.name)
    name = str(c.get("display_name") or cid)

    plans = [p for p in load_all_plans(root) if p.get("client_id") == cid]
    decisions = load_decisions(root)
    lc = resolve_lifecycle(c, plans, today, decisions)

    # Live plan = the one lifecycle points at, else newest published.
    live = next((p for p in plans if p.get("slug") == lc.get("planSlug")), None)
    if live is None:
        pubs = [p for p in plans if p.get("_bucket") == "published"]
        pubs.sort(key=lambda p: str(p.get("plan_period_start") or ""), reverse=True)
        live = pubs[0] if pubs else None

    plan_block: dict = {}
    if live:
        start = effective_meal_plan_start(live)
        end = effective_recheck_date(live, (c.get("weight_loss") or {}).get("week_overrides") if isinstance(c.get("weight_loss"), dict) else None,
                                     bool(isinstance(c.get("weight_loss"), dict) and c["weight_loss"].get("enabled")))
        weeks = int(live.get("plan_period_weeks") or 0)
        week_now = ((today - start).days // 7 + 1) if start and start <= today else None
        supps = []
        for s in live.get("supplement_protocol") or []:
            if not isinstance(s, dict):
                continue
            supps.append(" ".join(x for x in [
                str(s.get("display_name") or s.get("supplement_slug") or ""),
                str(s.get("dose") or ""), str(s.get("timing") or ""),
                f"(from week {s['start_week']})" if s.get("start_week") not in (None, 1) else "",
            ] if x).strip())
        practices = [str(p.get("name") or "") for p in (live.get("lifestyle_practices") or []) if isinstance(p, dict)]
        plan_block = {
            "slug": live.get("slug"),
            "is_maintenance": live.get("is_maintenance") is True,
            "started": _iso(start),
            "ends": _iso(end),
            "weeks": weeks,
            "week_now": week_now,
            "phase": live.get("phase") or live.get("plan_phase"),
            "supplements": supps,
            "practices": practices,
            "deferred": deferred_items(root, str(live.get("slug") or "")),
            "renewal_decision": (decisions.get(str(live.get("slug") or "")) or {}).get("decision")
            if isinstance(decisions.get(str(live.get("slug") or "")), dict) else None,
            "menu_weeks_live": len(((live.get("app_menu") or {}).get("weeks") or [])) if isinstance(live.get("app_menu"), dict) else 0,
        }
    pipeline = [f"{p.get('slug')} ({p.get('_bucket')})" for p in plans if p.get("_bucket") in ("draft", "ready_to_publish")]

    # Sessions, newest last.
    sessions: list[tuple[Path, dict]] = []
    for f in sorted(glob.glob(str(cdir / "sessions" / "*.yaml"))):
        sessions.append((Path(f), _load(Path(f))))
    last_checkin = None
    last_feedback = None
    last_session = None
    last_msq = None
    for f, d in sessions:
        pc = str(d.get("presenting_complaints") or "")
        date = str(d.get("date") or "")[:10]
        if isinstance(d.get("checkin_response"), dict):
            ci = d["checkin_response"]
            slipped = [f"{i.get('name')}: {i.get('status')}"
                       for i in (ci.get("supplements") or []) + (ci.get("practices") or [])
                       if isinstance(i, dict) and i.get("status") not in (None, "Still taking", "Keeping up")]
            last_checkin = {"date": date, "week": ci.get("week"), "rating_of_5": ci.get("rating"),
                            "in_her_words": str(ci.get("feel") or "")[:240], "slipped": slipped}
        elif isinstance(d.get("feedback_response"), dict):
            fb = d["feedback_response"]
            last_feedback = {"date": date, "stage": fb.get("stage"), "recommend_0_10": fb.get("recommend"),
                             "biggest_change": str(fb.get("biggest_change") or "")[:200]}
        elif "msq" in pc.lower() and re.search(r"total (\d+)", pc):
            m = re.search(r"total (\d+)", pc)
            w = re.search(r"\[week: (\d+)\]", pc)
            last_msq = {"date": date, "total": int(m.group(1)) if m else None, "week": int(w.group(1)) if w else None}
        elif "[source:" not in pc and date:
            st = re.search(r"\[session_type:\s*([a-z_]+)\]", pc)
            last_session = {"date": date, "type": st.group(1) if st else ("assessed" if d.get("ai_analysis") else "note")}

    labs = c.get("lab_markers") if isinstance(c.get("lab_markers"), list) else []
    lab_dates = sorted({str(m.get("date") or "")[:10] for m in labs if isinstance(m, dict) and m.get("date")})
    flagged = [f"{m.get('marker_name')} {m.get('value')} {m.get('unit') or ''} ({m.get('flag')})"
               for m in labs if isinstance(m, dict) and str(m.get("flag") or "").lower() not in ("", "normal", "optimal", "ok")][:12]

    weights = []
    for s in c.get("health_snapshots") or []:
        if isinstance(s, dict) and isinstance(s.get("measurements"), dict) and s["measurements"].get("weight_kg") is not None:
            weights.append((str(s.get("date") or "")[:10], s["measurements"]["weight_kg"]))
    for m in c.get("measurements_log") or []:
        if isinstance(m, dict) and m.get("weight_kg") is not None:
            weights.append((str(m.get("date") or "")[:10], m["weight_kg"]))
    weights = sorted(set(weights))

    age = None
    dob = _ymd(c.get("date_of_birth"))
    if dob:
        age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))

    tier = None
    if c.get("maintenance_paid_through"):
        tier = f"maintenance paid through {str(c['maintenance_paid_through'])[:10]}"
    elif c.get("programme_tier"):
        tier = str(c["programme_tier"])
    elif live and plan_block.get("weeks"):
        tier = f"{plan_block['weeks']}-week programme"

    anxious = [k for k in ("anxiety", "anxious", "ssri", "benzo") if k in json.dumps(c.get("current_medications") or c.get("medications") or []).lower() + " " + json.dumps(c.get("active_conditions") or []).lower()]

    brief = {
        "ok": True,
        "today": today.isoformat(),
        "who": {
            "client_id": cid, "name": name, "parked": parked,
            "age": age, "sex": c.get("sex"), "city": c.get("city"), "country": c.get("country"),
            "mobile": c.get("mobile_number"), "email": c.get("email"),
            "diet": c.get("dietary_preference"),
            "conditions": _as_list(c.get("active_conditions")),
            "medical_history": _as_list(c.get("medical_history")),
            "medications": _as_list(c.get("current_medications") or c.get("medications")),
            "allergies": _as_list(c.get("known_allergies") or c.get("allergies")),
            # Milk-protein allergy vs lactose intolerance — fmdb/plan/dairy.py.
            "dairy": _dairy_coach_label(c),
            "goals": c.get("goals"),
        },
        "lifecycle": {
            "state": lc["state"], "since": lc.get("since"), "reason": lc.get("reason"),
            "engagement_status": lc.get("engagement"), "lapsed_on": _iso(_ymd(c.get("lapsed_on"))),
            "tier": tier, "renewal_decision": plan_block.get("renewal_decision"),
            "next_contact_date": c.get("next_contact_date"),
            "marketing_opt_out": lc.get("optedOut"), "declined": lc.get("declined"),
            "mind_body_depth": c.get("mind_body_depth"),
        },
        "plan": plan_block,
        "plans_in_pipeline": pipeline,
        "recent": {
            "thread": thread_messages(sessions),
            "last_checkin": last_checkin,
            "last_msq": last_msq,
            "last_coach_session": last_session,
            "labs_on_file_dates": lab_dates[-3:],
            "labs_flagged": flagged,
            "weights": weights[-4:],
            "pending_sends": pending_sends(root, cid, str(c.get("mobile_number") or "")),
        },
        "app": {**app_usage(cdir, today), "feedback": last_feedback, "app_token": bool(c.get("app_token"))},
        "do_not": {
            "marketing_opt_out": lc.get("optedOut"),
            "foods_to_avoid": _as_list(c.get("foods_to_avoid")),
            "reported_triggers": _as_list(c.get("reported_triggers")),
            "non_negotiables": _as_list(c.get("non_negotiables")),
            "anxious_client_flags": anxious,
            "notes": str(c.get("notes") or "")[:300],
        },
        "NOTE": "Read-only. Prices are not here — ask the coach. Lifecycle comes from fmdb.plan.lifecycle, the one resolver.",
    }
    return brief


# ── markdown ──────────────────────────────────────────────────────────────────


def _li(items: list[Any]) -> str:
    return "\n".join(f"- {x}" for x in items) if items else "- (none)"


def render(b: dict) -> str:
    if not b.get("ok"):
        return f"**{b.get('error')}**"
    w, lc, p, r, a, dn = b["who"], b["lifecycle"], b["plan"], b["recent"], b["app"], b["do_not"]
    lines = [f"# {w['name']} · {w['client_id']}{' (parked in prospects/)' if w['parked'] else ''}", ""]
    bits = [f"{w['age']}" if w.get("age") else None, w.get("sex"), w.get("city"), w.get("diet")]
    lines.append("**Who:** " + " · ".join(str(x) for x in bits if x))
    lines.append(f"**Conditions:** {', '.join(w['conditions']) or '—'}")
    if w["medical_history"]:
        lines.append(f"**History:** {', '.join(map(str, w['medical_history']))}")
    lines.append(f"**Medications:** {', '.join(map(str, w['medications'])) or '—'}")
    if w["allergies"]:
        lines.append(f"**Allergies:** {', '.join(map(str, w['allergies']))}")
    if w.get("dairy"):
        lines.append(f"**Dairy:** {w['dairy']}")
    if w.get("goals"):
        lines.append(f"**Goals:** {w['goals'] if isinstance(w['goals'], str) else ', '.join(map(str, w['goals']))}")
    lines += ["", f"## Lifecycle: {lc['state'].upper()}" + (f" since {lc['since']}" if lc.get("since") else ""),
              f"- {lc['reason']}"]
    if lc.get("tier"):
        lines.append(f"- tier: {lc['tier']}")
    if lc.get("renewal_decision"):
        lines.append(f"- renewal decision on file: {lc['renewal_decision']}")
    if lc.get("next_contact_date"):
        lines.append(f"- next_contact_date (hand-set): {lc['next_contact_date']}")
    if lc.get("marketing_opt_out"):
        lines.append("- **marketing opt-out: YES — no follow-ups, notes or win-back**")
    if lc.get("declined"):
        lines.append("- declined the programme")
    if lc.get("mind_body_depth"):
        lines.append(f"- mind-body depth: {lc['mind_body_depth']}")
    lines.append("")
    if p:
        wk = f"week {p['week_now']} of {p['weeks']}" if p.get("week_now") else f"{p['weeks']} weeks"
        lines.append(f"## Plan: {p['slug']}{' (maintenance)' if p['is_maintenance'] else ''}")
        lines.append(f"- {wk} · started {p['started']} · ends {p['ends']}" + (f" · phase {p['phase']}" if p.get("phase") else ""))
        lines.append(f"- menu weeks live in the app: {p['menu_weeks_live']}")
        lines.append("- supplements:")
        lines += [f"  - {s}" for s in p["supplements"]] or ["  - (none)"]
        lines.append("- practices: " + (", ".join(p["practices"]) or "(none)"))
        if p["deferred"]:
            lines.append("- deferred items: " + "; ".join(p["deferred"]))
    else:
        lines.append("## Plan: none published")
    if b["plans_in_pipeline"]:
        lines.append("- in pipeline: " + ", ".join(b["plans_in_pipeline"]))
    lines += ["", "## Recent"]
    if r["thread"]:
        lines.append("- thread (oldest → newest):")
        for m in r["thread"]:
            arrow = "←" if m["direction"] == "in" else "→"
            tpl = f" [{m['template']}]" if m.get("template") else ""
            lines.append(f"  - {m['when']} {arrow} {m['channel']}{tpl}: {m['text']}")
    else:
        lines.append("- thread: nothing on record")
    if r["last_checkin"]:
        ci = r["last_checkin"]
        lines.append(f"- last check-in {ci['date']} (week {ci.get('week')}): {ci.get('rating_of_5')}/5 — “{ci['in_her_words']}”"
                     + (f"; slipped: {', '.join(ci['slipped'])}" if ci["slipped"] else ""))
    if r["last_msq"]:
        lines.append(f"- last MSQ {r['last_msq']['date']}: total {r['last_msq']['total']}")
    if r["last_coach_session"]:
        lines.append(f"- last coach session: {r['last_coach_session']['date']} ({r['last_coach_session']['type']})")
    if r["labs_on_file_dates"]:
        lines.append(f"- labs on file: {', '.join(r['labs_on_file_dates'])}" + (f"; flagged: {'; '.join(r['labs_flagged'])}" if r["labs_flagged"] else ""))
    if r["weights"]:
        lines.append("- weight: " + " → ".join(f"{kg} kg ({d})" for d, kg in r["weights"]))
    if r["pending_sends"]:
        lines.append("- queued sends: " + "; ".join(f"{s['kind']} {s.get('template') or ''} due {s['due']}" for s in r["pending_sends"]))
    lines += ["", "## App"]
    if a.get("app_token"):
        lines.append(f"- last open {a['last_open'] or 'never'} · {a['opens_14d']} opens in 14d")
        if a.get("ticks_this_week"):
            t = a["ticks_this_week"]
            lines.append(f"- this week: {t['days_logged']} days logged, {t['done']}/{t['of']} items ticked")
        if a.get("practices"):
            pr = a["practices"]
            lines.append(f"- practices: {pr['sessions_14d']} in 14d" + (f", last {pr['last']} ({pr['last_name']})" if pr.get("last") else ""))
        if a.get("feedback"):
            fb = a["feedback"]
            lines.append(f"- feedback {fb['date']} ({fb['stage']}): recommend {fb.get('recommend_0_10')}/10 — “{fb['biggest_change']}”")
    else:
        lines.append("- no app token")
    lines += ["", "## Do not"]
    if dn["marketing_opt_out"]:
        lines.append("- marketing opt-out — reply only")
    if dn["foods_to_avoid"]:
        lines.append(f"- foods to avoid: {', '.join(map(str, dn['foods_to_avoid']))}")
    if dn["reported_triggers"]:
        lines.append(f"- triggers: {', '.join(map(str, dn['reported_triggers']))}")
    if dn["non_negotiables"]:
        lines.append(f"- non-negotiables (coach-only): {', '.join(map(str, dn['non_negotiables']))}")
    if dn["anxious_client_flags"]:
        lines.append("- anxious-client flags present — prune urgency in anything client-facing")
    if dn["notes"]:
        lines.append(f"- coach notes: {dn['notes']}")
    lines.append("")
    lines.append(f"_{b['NOTE']}_")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("client", nargs="?", default="")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--today", default="")
    args = ap.parse_args()
    needle = args.client
    as_json = args.json
    if not needle and not sys.stdin.isatty():
        try:
            payload = json.loads(sys.stdin.read() or "{}")
        except json.JSONDecodeError:
            payload = {}
        needle = str(payload.get("client") or payload.get("client_id") or "")
        as_json = True
        if payload.get("today"):
            args.today = str(payload["today"])
    if not needle:
        print("usage: client-brief.py <client_id | name> [--json]", file=sys.stderr)
        return 2
    today = dt.date.fromisoformat(args.today) if args.today else dt.date.today()
    brief = build(_plans_root(), needle, today)
    if as_json:
        print(json.dumps(brief, indent=2, default=str))
    else:
        print(render(brief))
    return 0 if brief.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
