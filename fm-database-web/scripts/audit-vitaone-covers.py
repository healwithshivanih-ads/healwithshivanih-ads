#!/usr/bin/env python3
"""
Weekly VitaOne commission-leak audit → emails the coach when money is leaking.

Mirrors the /dashboard-v2 FmVitaoneCoverageChip (getVitaoneCoverageStatus):
finds supplements PRESCRIBED in live published plans whose buy link resolves to
FM Nutrition (10% commission) when VitaOne (30%) should win — usually because
the matching VitaOne product has an empty `covers` list, or none exists.

Items VitaOne genuinely doesn't stock (ACCEPTED_GAPS) are skipped so the digest
stays high-signal. Sends email ONLY when leaks > 0 (silence = all clean).

Run weekly via launchd (com.healwithshivanih.vitaone-covers-audit). Reads Gmail
SMTP creds from fm-database-web/.env.local. Use --dry-run to compute + print
without sending.
"""
from __future__ import annotations

import os
import re
import sys
import ssl
import smtplib
import collections
from email.message import EmailMessage
from pathlib import Path

import yaml

PLANS_ROOT = Path(os.environ.get("FMDB_PLANS_DIR") or (Path.home() / "fm-plans"))
LINKS = PLANS_ROOT / "supplement_links.yaml"
PUBLISHED = PLANS_ROOT / "published"
ENV_LOCAL = Path(__file__).resolve().parent.parent / ".env.local"

RANK = {"vitaone": 0, "fmnutrition": 1, "amazon": 2, "custom": 3, "other": 4, "iherb": 5}

# Keep in sync with ACCEPTED_GAPS in src/app/vitaone-coverage-action.ts
ACCEPTED_GAPS = {
    "cordyceps", "medicinal-mushrooms", "taurine", "l-theanine", "bromelain",
    "chromium", "creatine-monohydrate", "oregano-oil", "saccharomyces-boulardii",
    "zinc-picolinate", "indole-3-carbinol", "vitamin-k2",
    # FM Nutrition / Autoimmunity Care brand blends — no VitaOne equivalent
    # (verified 2026-07-07).
    "h-pylori-combo", "leaky-gut-care",
}


def canon(s: str) -> str:
    return re.sub(r"^_+|_+$", "", re.sub(r"[^a-z0-9]+", "_", (s or "").lower()))


def source_of(v: dict) -> str:
    return v.get("source") or ("vitaone" if "vitaone" in (v.get("url") or "") else "other")


def resolve_source(slug: str, links: dict) -> str | None:
    """Replicate pickLinkEntry's deterministic (covers/aliases/key) tier + tie-break."""
    cs = canon(slug)
    cands = []
    for k, v in links.items():
        toks = [canon(k)] + [canon(a) for a in (v.get("aliases") or [])] \
            + [canon(c) for c in (v.get("covers") or [])]
        if cs in toks:
            cands.append(v)
    if not cands:
        return None
    cands.sort(key=lambda v: RANK.get(source_of(v), 9))
    return source_of(cands[0])


def find_leaks():
    links = yaml.safe_load(LINKS.read_text()) or {}
    counts = collections.Counter()
    for f in PUBLISHED.glob("*.yaml"):
        if ".bak" in f.name:
            continue
        try:
            d = yaml.safe_load(f.read_text()) or {}
        except Exception:
            continue
        for s in (d.get("supplement_protocol") or []):
            slug = (s or {}).get("supplement_slug")
            if slug:
                counts[slug] += 1
    leaks = []
    for slug, n in counts.items():
        if slug in ACCEPTED_GAPS:
            continue
        if resolve_source(slug, links) == "fmnutrition":
            leaks.append((slug, n))
    leaks.sort(key=lambda t: (-t[1], t[0]))
    return leaks


def load_env(path: Path) -> dict:
    env = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, val = line.partition("=")
        env[k.strip()] = val.strip().strip('"').strip("'")
    return env


def send_email(leaks, env):
    user = env.get("GMAIL_USER") or os.environ.get("GMAIL_USER")
    pw = env.get("GMAIL_APP_PASSWORD") or os.environ.get("GMAIL_APP_PASSWORD")
    to = env.get("VITAONE_AUDIT_EMAIL") or user
    if not (user and pw and to):
        print("ERROR: GMAIL_USER / GMAIL_APP_PASSWORD not set — cannot email", file=sys.stderr)
        return False
    lines = [f"  • {slug}  ({n} plan{'s' if n != 1 else ''})" for slug, n in leaks]
    body = (
        f"{len(leaks)} supplement(s) prescribed in live plans are sending clients "
        f"to FM Nutrition (10% commission) instead of VitaOne (30%):\n\n"
        + "\n".join(lines)
        + "\n\nFix each: if VitaOne stocks it, add a VitaOne entry (or the slug to an "
        "existing VitaOne product's `covers`) in ~/fm-plans/supplement_links.yaml so "
        "VitaOne wins the link. If VitaOne genuinely doesn't stock it, add the slug to "
        "ACCEPTED_GAPS (scripts/audit-vitaone-covers.py + vitaone-coverage-action.ts) "
        "to silence it.\n\nFull list also on the dashboard: /dashboard-v2 (💸 chip).\n"
    )
    msg = EmailMessage()
    msg["Subject"] = f"💸 VitaOne commission leak — {len(leaks)} item(s) going to FM Nutrition"
    msg["From"] = user
    msg["To"] = to
    msg.set_content(body)
    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ctx) as smtp:
        smtp.login(user, pw)
        smtp.send_message(msg)
    print(f"emailed {to}: {len(leaks)} leak(s)")
    return True


def main():
    dry = "--dry-run" in sys.argv
    leaks = find_leaks()
    if not leaks:
        print("no leaks — all prescribed items resolve to VitaOne or accepted gaps")
        return 0
    print(f"{len(leaks)} leak(s):")
    for slug, n in leaks:
        print(f"  {slug} ({n})")
    if dry:
        print("(dry-run — not sending)")
        return 0
    send_email(leaks, load_env(ENV_LOCAL))
    return 0


if __name__ == "__main__":
    sys.exit(main())
