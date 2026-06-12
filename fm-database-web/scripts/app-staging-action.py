#!/usr/bin/env python3
"""Stage CLIENT-FACING plan artifacts into the Fly-synced staging tree.

Why: after the intake staging cutover (FMDB_PLANS_DIR=/data/fm-plans-staging
on Fly), the public machine no longer holds published plans, letters or
sessions — which broke every token-gated client surface on the public host:
/app/<letter_token>, /letter/<token>, /recipes/<slug>, /supplements/<slug>.

This shim extends the staging philosophy (only active clients, only the
minimum data) to the client app: when the coach shares an app/letter link,
the client's OWN client-facing artifacts are staged; a per-minute refresh
keeps them current and mirrors app check-ins back to the authoritative
store; revoking the plan purges them from Fly.

What gets staged per client (and nothing else):
  - published/<plan_slug>-v*.yaml  — SANITIZED: notes_for_coach +
    ai_sanity_check stripped (coach-private; no client surface reads them)
  - clients/<id>/client.yaml       — app-relevant keys merged over any
    existing intake stub (never clobbers a live intake_form_draft)
  - clients/<id>/meal-plans/<plan_slug>*  — letter .md/.html (+ recipes etc.)
  - clients/<id>/sessions/*        — only sessions carrying poll_response /
    checkin_response (the app's wellbeing trend), copy-if-missing
  - supplement_links.yaml          — buy links for /supplements
  - clients/<id>/_app_staged.yaml  — marker {plan_slug, staged_at}; intake
    purge keeps the dir alive when this exists

Actions (stdin JSON):
  {"action": "stage", "client_id": str, "plan_slug": str}
  {"action": "refresh"}        # re-stage all marked clients + reverse-mirror
                               # app check-ins; purge if plan unpublished
Output: {"ok": bool, ...counts, "error": str?}
NO-OP when FMDB_STAGING_DIR is unset.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / "fm-plans"


def _staging_root() -> "Path | None":
    env = os.environ.get("FMDB_STAGING_DIR")
    if not env:
        return None
    return Path(env).expanduser().resolve()


# client.yaml keys the client app's loader reads (superset of the intake
# stub keys so a merged file serves both surfaces).
_APP_CLIENT_KEYS = (
    "client_id",
    "display_name",
    "date_of_birth",
    "age_band",
    "sex",
    "email",
    "mobile_number",
    "city",
    "country",
    "intake_date",
    "next_contact_date",
    "active_conditions",
    "goals",
    "dietary_preference",
    "foods_to_avoid",
    "non_negotiables",
    "ayurveda_constitution",
    "ayurveda_assessment",
    "cycle_status",
    "pregnancy_status",
    "lactation_started",
    "app_token",
    "app_token_created_at",
)

_PLAN_PRIVATE_KEYS = ("notes_for_coach", "ai_sanity_check")


def _published_files(root: Path, plan_slug: str) -> list[Path]:
    d = root / "published"
    if not d.exists():
        return []
    return sorted(d.glob(f"{plan_slug}-v*.yaml"))


def _stage_one(yaml, auth: Path, stag: Path, client_id: str, plan_slug: str) -> dict:
    counts = {"plan_files": 0, "letters": 0, "sessions_staged": 0}

    # 1. sanitized published plan(s)
    plan_published = False
    (stag / "published").mkdir(parents=True, exist_ok=True)
    for p in _published_files(auth, plan_slug):
        d = yaml.safe_load(p.read_text()) or {}
        for k in _PLAN_PRIVATE_KEYS:
            d.pop(k, None)
        (stag / "published" / p.name).write_text(
            yaml.safe_dump(d, sort_keys=False, allow_unicode=True)
        )
        counts["plan_files"] += 1
        plan_published = True
    if not plan_published:
        return {"ok": False, "error": f"plan not published: {plan_slug}", **counts}

    # 2. client.yaml — app keys merged over any existing staging stub
    auth_client = auth / "clients" / client_id / "client.yaml"
    if not auth_client.exists():
        return {"ok": False, "error": f"client not found: {client_id}", **counts}
    adata = yaml.safe_load(auth_client.read_text()) or {}
    sdir = stag / "clients" / client_id
    sdir.mkdir(parents=True, exist_ok=True)
    s_client = sdir / "client.yaml"
    existing = {}
    if s_client.exists():
        try:
            existing = yaml.safe_load(s_client.read_text()) or {}
        except Exception:
            existing = {}
    merged = dict(existing)  # keep intake stub keys / live draft untouched
    for k in _APP_CLIENT_KEYS:
        if k in adata:
            merged[k] = adata[k]
    merged["client_id"] = client_id
    s_client.write_text(yaml.safe_dump(merged, sort_keys=False, allow_unicode=True))

    # 3. letters (md + html + sidecars) + the send log. The app trusts ONLY
    # letters recorded in _send_log.yaml, and sent letters sometimes carry a
    # successor plan slug — so stage the log plus every file matching the
    # published slug OR any slug that appears in the log.
    auth_mp = auth / "clients" / client_id / "meal-plans"
    if auth_mp.exists():
        smp = sdir / "meal-plans"
        smp.mkdir(parents=True, exist_ok=True)
        prefixes = {plan_slug}
        send_log = auth_mp / "_send_log.yaml"
        if send_log.exists():
            shutil.copy2(send_log, smp / "_send_log.yaml")
            try:
                for entry in yaml.safe_load(send_log.read_text()) or []:
                    s = (entry or {}).get("plan_slug")
                    if s:
                        prefixes.add(s)
            except Exception:
                pass
        for f in auth_mp.iterdir():
            if f.is_file() and any(f.name.startswith(p) for p in prefixes):
                shutil.copy2(f, smp / f.name)
                counts["letters"] += 1

    # 4. app-relevant sessions (wellbeing trend), copy-if-missing
    auth_sess = auth / "clients" / client_id / "sessions"
    if auth_sess.exists():
        ssess = sdir / "sessions"
        ssess.mkdir(parents=True, exist_ok=True)
        for f in sorted(auth_sess.glob("*.yaml")):
            dest = ssess / f.name
            if dest.exists():
                continue
            try:
                sdata = yaml.safe_load(f.read_text()) or {}
            except Exception:
                continue
            if sdata.get("poll_response") or sdata.get("checkin_response") or sdata.get("msq_response"):
                shutil.copy2(f, dest)
                counts["sessions_staged"] += 1

    # 5. buy links for /supplements
    links = auth / "supplement_links.yaml"
    if links.exists():
        shutil.copy2(links, stag / "supplement_links.yaml")

    # 5b. coach app-overrides (hidden remedy suggestions) — the app loader
    # filters from this, so Fly must carry it (added 2026-06-12)
    ov = auth / "clients" / client_id / "app-overrides.yaml"
    if ov.exists():
        shutil.copy2(ov, sdir / "app-overrides.yaml")

    # 6. marker
    (sdir / "_app_staged.yaml").write_text(
        yaml.safe_dump(
            {"client_id": client_id, "plan_slug": plan_slug, "staged_at": datetime.now(timezone.utc).isoformat()},
            sort_keys=False,
        )
    )
    return {"ok": True, **counts}


def _refresh(yaml, auth: Path, stag: Path) -> dict:
    out = {"refreshed": 0, "checkins_mirrored": 0, "purged": 0, "errors": []}
    clients_dir = stag / "clients"
    if not clients_dir.exists():
        return {"ok": True, **out}
    for sdir in sorted(clients_dir.iterdir()):
        marker = sdir / "_app_staged.yaml"
        if not marker.exists():
            continue
        try:
            m = yaml.safe_load(marker.read_text()) or {}
        except Exception:
            continue
        client_id = m.get("client_id") or sdir.name
        plan_slug = m.get("plan_slug") or ""

        # reverse-mirror: app check-ins + MSQ submissions written on Fly →
        # authoritative store
        ssess = sdir / "sessions"
        auth_sess = auth / "clients" / client_id / "sessions"
        if ssess.exists() and (auth / "clients" / client_id).exists():
            auth_sess.mkdir(parents=True, exist_ok=True)
            for pattern in ("*-app-checkin.yaml", "*-app-msq.yaml", "*-app-travel.yaml"):
                for f in sorted(ssess.glob(pattern)):
                    dest = auth_sess / f.name
                    if not dest.exists():
                        shutil.copy2(f, dest)
                        out["checkins_mirrored"] += 1

        # reverse-mirror: app open timestamps (adoption tracking) — UNION
        # merge, never overwrite: Fly appends new opens between cron runs
        # while the authoritative copy holds the full history.
        s_opens = sdir / "_app_opens.yaml"
        a_opens = auth / "clients" / client_id / "_app_opens.yaml"
        if s_opens.exists() and (auth / "clients" / client_id).exists():
            try:
                fly_list = (yaml.safe_load(s_opens.read_text()) or {}).get("opens") or []
                auth_list = []
                if a_opens.exists():
                    auth_list = (yaml.safe_load(a_opens.read_text()) or {}).get("opens") or []
                merged = sorted(set(str(x) for x in auth_list) | set(str(x) for x in fly_list))[-2000:]
                if merged != auth_list:
                    a_opens.write_text(yaml.safe_dump({"opens": merged}, sort_keys=False))
            except Exception as e:
                out["errors"].append(f"{client_id} opens-merge: {e}")

        # plan revoked / superseded → purge the app artifacts from Fly
        if plan_slug and not _published_files(auth, plan_slug):
            for p in (stag / "published").glob(f"{plan_slug}-v*.yaml"):
                p.unlink(missing_ok=True)
            shutil.rmtree(sdir / "meal-plans", ignore_errors=True)
            marker.unlink(missing_ok=True)
            out["purged"] += 1
            continue

        # otherwise re-stage so coach edits (doses, new letters) stay fresh
        if plan_slug:
            res = _stage_one(yaml, auth, stag, client_id, plan_slug)
            if res.get("ok"):
                out["refreshed"] += 1
            else:
                out["errors"].append(f"{client_id}: {res.get('error')}")
    return {"ok": True, **out}


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    stag = _staging_root()
    if stag is None:
        json.dump({"ok": True, "staging_disabled": True}, sys.stdout)
        return 0
    try:
        import yaml  # type: ignore
    except ImportError as e:
        json.dump({"ok": False, "error": f"pyyaml: {e}"}, sys.stdout)
        return 1

    auth = _plans_root()
    action = payload.get("action") or ""
    if action == "stage":
        client_id = (payload.get("client_id") or "").strip()
        plan_slug = (payload.get("plan_slug") or "").strip()
        if not client_id or not plan_slug:
            json.dump({"ok": False, "error": "client_id and plan_slug required"}, sys.stdout)
            return 2
        json.dump(_stage_one(yaml, auth, stag, client_id, plan_slug), sys.stdout)
        return 0
    if action == "refresh":
        json.dump(_refresh(yaml, auth, stag), sys.stdout)
        return 0
    json.dump({"ok": False, "error": f"unknown action: {action}"}, sys.stdout)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
