#!/usr/bin/env python3
"""
render-lab-requisition.py — clean, one-page lab requisition for the client
to hand to Dr Lal / Apollo / Thyrocare / SRL / Metropolis.

NOT a client letter (no warm tone, no education, no protocol). This is a
literal requisition slip: client identity, ordered tests grouped by
sample type, clinical reason per test, prep instructions.

stdin:
{
  "plan_slug":   "...",
  "client_id":   "..."
}

stdout:
{
  "ok": true,
  "markdown": "...",
  "html":     "...",   # standalone A4-ready HTML (brand_html-wrapped)
  "summary":  "..."    # short plain-text version for WhatsApp deep-link
}
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime
from pathlib import Path

# Reuse the FM-database loaders + brand wrapper from the letter renderer.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / ".." / "fm-database"))

import yaml  # type: ignore

try:
    from brand_html import wrap_in_brand_html  # type: ignore
except Exception:  # pragma: no cover — brand_html lives next door
    def wrap_in_brand_html(md_or_html: str, title: str = "", subtitle: str = "") -> str:
        return f"<html><body>{md_or_html}</body></html>"


# ── Sample-type classifier — mirror src/lib/fmdb/lab-sample-type.ts ────────
SAMPLE_RULES: list[tuple[str, list[str]]] = [
    ("Stool",       ["stool", "fecal", "faecal", "occult blood (fobt)"]),
    ("Urine",       ["urine", "dutch", "spot urine", "24hr", "24-hr", "mycotoxin"]),
    ("Saliva",      ["saliva", "salivary"]),
    ("Breath",      ["breath test", "ubt", "sibo breath"]),
    ("Hair / nail", ["hair", "nail mineral", "hair tissue"]),
    ("Swab",        ["swab", "buccal", "cheek"]),
    ("Imaging",     ["ultrasound", "mri", "ct scan", "dexa", "x-ray", "xray", "scan ", "fibroscan"]),
]
SAMPLE_ORDER = ["Blood", "Stool", "Urine", "Saliva", "Breath", "Hair / nail", "Swab", "Imaging", "Other"]
SAMPLE_ICON = {
    "Blood": "🩸", "Stool": "💩", "Urine": "💧", "Saliva": "🧪",
    "Breath": "🌬️", "Hair / nail": "💇", "Swab": "👅", "Imaging": "🩻", "Other": "📋",
}
# Sample-type fasting / prep defaults — overridden by per-test prep_notes
SAMPLE_PREP = {
    "Blood":  "Fasting 10–12 hrs (water only). Morning draw preferred (7–10 am).",
    "Stool":  "Collect at home in supplied kit. Refrigerate, deliver within 24 hrs. Avoid antibiotics + probiotics for 2 weeks before, unless instructed.",
    "Urine":  "Per-test instructions on the kit. For 24-hr collections, start the morning of, discard first void, collect everything for the next 24 hrs ending with first void next day.",
    "Saliva": "Collect on waking before brushing / eating / drinking. Multiple samples through the day per kit instructions.",
    "Breath": "Fasting 8 hrs before the appointment. No antibiotics for 4 weeks before. Test takes 2-3 hrs at the clinic.",
    "Hair / nail": "Per kit instructions — usually 1 g of hair from the back of the head, freshly washed and dry.",
    "Swab":   "Inside-cheek swab — no eating / drinking for 30 min before.",
    "Imaging": "Per the imaging centre's instructions when you book.",
    "Other":  "Per the lab's instructions.",
}


def _infer_sample(label: str) -> str:
    lc = label.lower()
    for kind, needles in SAMPLE_RULES:
        if any(n in lc for n in needles):
            return kind
    return "Blood"


def _load_yaml(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        with path.open() as f:
            return yaml.safe_load(f)
    except Exception:
        return None


def _plans_root() -> Path:
    return Path(os.environ.get("FMDB_PLANS_DIR") or (Path.home() / "fm-plans"))


def _load_plan(slug: str) -> dict | None:
    root = _plans_root()
    for bucket in ("drafts", "ready", "published", "superseded", "revoked"):
        d = root / bucket
        if not d.is_dir():
            continue
        # Direct slug-named file
        f = d / f"{slug}.yaml"
        if f.exists():
            return _load_yaml(f)
        # Versioned: <slug>-vN.yaml — pick highest N
        candidates = sorted(d.glob(f"{slug}-v*.yaml"))
        if candidates:
            return _load_yaml(candidates[-1])
    return None


def _load_client(client_id: str) -> dict | None:
    return _load_yaml(_plans_root() / "clients" / client_id / "client.yaml")


def _fmt_date(s: str | None) -> str:
    if not s:
        return ""
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).strftime("%-d %b %Y")
    except Exception:
        return s


def _derive_age(client: dict) -> str:
    dob = client.get("date_of_birth")
    if dob:
        try:
            d = datetime.fromisoformat(str(dob)).date()
            today = date.today()
            yrs = today.year - d.year - ((today.month, today.day) < (d.month, d.day))
            return f"{yrs}y"
        except Exception:
            pass
    return str(client.get("age_band") or "—")


def _build_markdown(plan: dict, client: dict) -> str:
    """Build the requisition as Markdown (also the basis for plain text)."""
    name = client.get("display_name") or client.get("client_id") or "Client"
    age = _derive_age(client)
    sex = (client.get("sex") or "—").upper()
    phone = client.get("mobile_number") or client.get("mobile") or "—"
    plan_slug = plan.get("slug") or "—"

    # Bucket lab orders by sample type → (new, repeat)
    raw = plan.get("lab_orders") or []
    buckets: dict[str, dict[str, list[dict]]] = {}
    for it in raw:
        if not isinstance(it, dict):
            continue
        test = (it.get("test") or "").strip()
        if not test:
            continue
        kind = "repeat" if it.get("kind") == "repeat" else "new"
        sample = _infer_sample(test)
        buckets.setdefault(sample, {"new": [], "repeat": []})[kind].append(it)

    if not buckets:
        return f"# Lab requisition\n\nNo lab orders attached to plan `{plan_slug}`."

    lines: list[str] = []
    lines.append(f"# 🔬 Lab Requisition — {name}")
    lines.append("")
    lines.append(f"**Date issued:** {date.today().strftime('%-d %b %Y')}  ")
    lines.append(f"**Patient:** {name} · {age} · {sex} · {phone}")
    lines.append("")
    lines.append("Please order the following tests. Tests are grouped by sample type so all bloods can be drawn in one visit, stool kits collected at home, etc.")
    lines.append("")

    for sample in SAMPLE_ORDER:
        bucket = buckets.get(sample)
        if not bucket:
            continue
        all_tests = bucket["new"] + bucket["repeat"]
        if not all_tests:
            continue
        icon = SAMPLE_ICON.get(sample, "📋")
        lines.append(f"## {icon} {sample} ({len(all_tests)})")
        prep = SAMPLE_PREP.get(sample) or ""
        if prep:
            lines.append(f"*Prep: {prep}*")
            lines.append("")
        if bucket["new"]:
            lines.append("**Order fresh:**")
            for it in bucket["new"]:
                test = (it.get("test") or "").strip()
                reason = (it.get("reason") or "").strip()
                line = f"- **{test}**"
                if reason:
                    line += f" — _why:_ {reason}"
                lines.append(line)
            lines.append("")
        if bucket["repeat"]:
            lines.append("**Re-test (compare against prior):**")
            for it in bucket["repeat"]:
                test = (it.get("test") or "").strip()
                reason = (it.get("reason") or "").strip()
                weeks = it.get("due_in_weeks")
                line = f"- **{test}**"
                if reason:
                    line += f" — _why:_ {reason}"
                if isinstance(weeks, (int, float)) and weeks > 0:
                    line += f" _(after week {int(weeks)})_"
                lines.append(line)
            lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("**Notes for the patient**")
    lines.append("- Ask the lab to share results directly with you (PDF) so we can review them together.")
    lines.append("- If any test is unavailable, the lab can suggest a closest equivalent — please ask before substituting.")
    lines.append("- Send the report to me on WhatsApp / email once it's back.")
    lines.append("")
    lines.append("_Issued by Shivani Hari · functional medicine coach · healwithshivanih.com_")
    return "\n".join(lines)


def _build_summary(plan: dict, client: dict) -> str:
    """Short plain-text version for WhatsApp deep-link (≤500 chars)."""
    name = (client.get("display_name") or "").split()[0] or "there"
    raw = plan.get("lab_orders") or []
    buckets: dict[str, int] = {}
    for it in raw:
        if isinstance(it, dict) and (it.get("test") or "").strip():
            sample = _infer_sample(it["test"])
            buckets[sample] = buckets.get(sample, 0) + 1
    if not buckets:
        return f"Hi {name}, sending your fresh lab requisition shortly."
    counts = [f"{SAMPLE_ICON.get(s, '📋')} {n} {s.lower()}" for s, n in buckets.items() if n]
    body = ", ".join(counts)
    return (
        f"Hi {name}, time for your next round of labs 🔬\n\n"
        f"I've prepared a requisition sheet you can hand to Dr Lal / Apollo / "
        f"Thyrocare / SRL — it lists {body}. You can take the blood tests in "
        "one visit; stool / urine / breath kits are picked up at the lab and "
        "collected at home or returned later.\n\n"
        "I'm emailing the full sheet now — share the results with me once they're back so we can review together.\n\n"
        "— Shivani"
    )


def main() -> int:
    payload = json.loads(sys.stdin.read() or "{}")
    plan_slug = payload.get("plan_slug")
    client_id = payload.get("client_id")
    if not plan_slug or not client_id:
        print(json.dumps({"ok": False, "error": "plan_slug and client_id required"}))
        return 1
    plan = _load_plan(plan_slug)
    client = _load_client(client_id)
    if not plan:
        print(json.dumps({"ok": False, "error": f"plan {plan_slug} not found"}))
        return 1
    if not client:
        print(json.dumps({"ok": False, "error": f"client {client_id} not found"}))
        return 1

    md = _build_markdown(plan, client)
    summary = _build_summary(plan, client)
    title = f"Lab Requisition — {client.get('display_name') or client_id}"
    html = wrap_in_brand_html(md, title=title, subtitle=date.today().strftime("%-d %b %Y"))
    print(json.dumps({"ok": True, "markdown": md, "html": html, "summary": summary}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
