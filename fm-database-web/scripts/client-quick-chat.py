#!/usr/bin/env python3
"""Client quick-chat — ad-hoc clinical Q&A grounded in ONE client's record.

For the "client just asked me this on the phone" moment. No Analyze, no
subgraph rebuild — just load the client's record + a light catalogue lookup
keyed off the question, and answer in coaching scope.

Reads JSON from stdin:
{
  "client_id": str,
  "question":  str,
  "history":   [{"role": "user"|"assistant", "content": str}],   # optional
  "dry_run":   bool                                              # optional
}

Writes JSON to stdout:
{
  "ok": bool,
  "answer": str,
  "used": {"entities": [str], "claims": [str]},
  "usage": {"input_tokens": int, "output_tokens": int, "model": str} | null,
  "error": str | null
}
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import yaml

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
DATA = FMDB_ROOT / "data"
sys.path.insert(0, str(FMDB_ROOT))


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv  # type: ignore
        load_dotenv(FMDB_ROOT / ".env", override=True)
    except Exception:
        envp = FMDB_ROOT / ".env"
        if envp.exists():
            for line in envp.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env)
    return Path(os.path.expanduser("~/fm-plans"))


_STOP = {
    "the", "and", "for", "her", "his", "she", "him", "they", "with", "from",
    "this", "that", "what", "should", "would", "could", "have", "has", "are",
    "was", "were", "will", "shall", "about", "into", "over", "under", "than",
    "then", "them", "their", "your", "you", "she's", "doing", "feel", "feeling",
    "very", "much", "more", "less", "but", "not", "now", "can", "does", "did",
    "client", "patient", "asked", "asking", "question", "continue", "stop",
}


def _keywords(text: str) -> set[str]:
    out: set[str] = set()
    for raw in text.lower().replace("/", " ").replace("-", " ").split():
        w = "".join(ch for ch in raw if ch.isalnum())
        if len(w) >= 4 and w not in _STOP:
            out.add(w)
    return out


def _client_context(client: dict, sessions: list[dict]) -> str:
    g = client.get
    lines: list[str] = []
    lines.append(f"Name: {g('display_name') or client.get('client_id')}")
    age = g("age_band")
    lines.append(f"Age band: {age}  Sex: {g('sex')}  City: {g('city')}, {g('country')}")
    if g("dietary_preference"):
        lines.append(f"Diet: {g('dietary_preference')}  Avoids: {g('foods_to_avoid')}")

    def _lst(key, label):
        v = g(key)
        if v:
            if isinstance(v, list):
                v = ", ".join(str(x) for x in v if x)
            if v:
                lines.append(f"{label}: {v}")

    _lst("active_conditions", "Active conditions")
    _lst("medical_history", "Medical history")
    _lst("current_medications", "Medications")
    _lst("current_supplements", "Current supplements")
    _lst("known_allergies", "Allergies")
    _lst("goals", "Goals")
    if g("reported_triggers"):
        lines.append(f"Reported triggers: {g('reported_triggers')}")

    # Abnormal lab markers
    abn = []
    for m in (g("lab_markers") or []):
        if not isinstance(m, dict):
            continue
        if str(m.get("flag")) not in ("optimal", "normal", "None", ""):
            abn.append(f"{m.get('marker_name')}={m.get('value')}{m.get('unit','')} [{m.get('flag')}] {m.get('fm_interpretation','')}")
    if abn:
        lines.append("Notable lab markers (" + str(g("lab_markers_date") or "") + "):")
        lines.extend("  - " + a for a in abn[:24])

    # Intake insights
    ii = g("intake_insights") or {}
    if isinstance(ii, dict):
        if ii.get("patterns"):
            lines.append("Intake patterns:")
            lines.extend("  - " + str(p) for p in ii["patterns"][:5])
        if ii.get("red_flags"):
            lines.append("Intake red flags:")
            lines.extend("  - " + str(p) for p in ii["red_flags"][:5])

    # Recent sessions (most recent first)
    if sessions:
        lines.append("Recent sessions (newest first):")
        for s in sessions[:5]:
            d = s.get("date", "?")
            t = s.get("session_type", "?")
            pc = (s.get("presenting_complaints") or "").strip().replace("\n", " ")
            cn = (s.get("coach_notes") or "").strip().replace("\n", " ")
            blurb = (pc + (" | " + cn if cn else ""))[:400]
            lines.append(f"  - {d} [{t}] {blurb}")

    return "\n".join(lines)


def _catalogue_grounding(question: str, client: dict) -> tuple[str, list[str], list[str]]:
    """Light keyword retrieval over the catalogue. Returns (context, entity_slugs, claim_slugs)."""
    kws = _keywords(question)
    # seed with client condition words too
    for c in (client.get("active_conditions") or []):
        kws |= _keywords(str(c))
    if not kws:
        return "", [], []

    def _score(slug: str) -> int:
        slug_words = set(slug.split("-"))
        s = 2 * len(slug_words & kws)          # whole-word hits weigh most
        s += sum(1 for k in kws if k in slug)  # substring hits
        return s

    def _ranked(paths: list) -> list:
        scored = [(p, _score(p.stem)) for p in paths]
        scored = [(p, sc) for (p, sc) in scored if sc > 0]
        scored.sort(key=lambda t: (-t[1], t[0].stem))  # best first, deterministic
        return [p for (p, _) in scored]

    ent_blocks: list[str] = []
    ent_slugs: list[str] = []
    for kind in ("topics", "mechanisms", "symptoms", "supplements"):
        d = DATA / kind
        if not d.is_dir():
            continue
        matched = _ranked(list(d.glob("*.yaml")))
        for p in matched[:8]:
            try:
                e = yaml.safe_load(p.read_text()) or {}
            except Exception:
                continue
            summary = (e.get("summary") or e.get("notes_for_coach") or "").strip().replace("\n", " ")
            if not summary:
                continue
            ent_slugs.append(f"{kind}/{p.stem}")
            ent_blocks.append(f"[{kind[:-1]}] {e.get('display_name', p.stem)} (tier: {e.get('evidence_tier','?')}): {summary[:320]}")
        if len(ent_blocks) >= 14:
            break

    claim_blocks: list[str] = []
    claim_slugs: list[str] = []
    cd = DATA / "claims"
    if cd.is_dir():
        cmatched = _ranked(list(cd.glob("*.yaml")))
        for p in cmatched[:12]:
            try:
                c = yaml.safe_load(p.read_text()) or {}
            except Exception:
                continue
            stmt = (c.get("coaching_translation") or c.get("statement") or "").strip().replace("\n", " ")
            if not stmt:
                continue
            claim_slugs.append(p.stem)
            claim_blocks.append(f"({c.get('evidence_tier','?')}) {stmt[:300]}")

    parts = []
    if ent_blocks:
        parts.append("CATALOGUE ENTRIES (FM reference):\n" + "\n".join("  - " + b for b in ent_blocks))
    if claim_blocks:
        parts.append("CATALOGUE EVIDENCE NOTES:\n" + "\n".join("  - " + b for b in claim_blocks))
    return "\n\n".join(parts), ent_slugs, claim_slugs


SYSTEM = """You are an FM (functional-medicine) coaching assistant for Shivani, an FMCA-trained \
health coach in India (NBHWC scope). She asks you quick, ad-hoc clinical questions — usually \
something a client just asked her on the phone or by message. Answer briefly and practically, \
as if helping her reply in the moment.

GROUNDING: Base your answer on (a) THIS client's record below and (b) the catalogue reference \
provided. Refer to the client's own specifics (their labs, conditions, meds) when relevant. If \
the record lacks something you'd need, say so plainly.

SCOPE — non-negotiable (NBHWC/FMCA):
- Educate and coach lifestyle/nutrition/behaviour. Do NOT diagnose, prescribe medication, or \
give definitive interpretations of a specific lab value as if you were the clinician.
- Decisions about prescription drugs and medical therapies (e.g. continuing/stopping HBOT, \
adjusting thyroid dose) belong to the prescribing clinician — frame these as "this is X's \
clinician's call" and explain what to consider / what to ask.
- Flag red flags that need prompt medical review with 🔴.
- Be honest about uncertainty and evidence strength. Never invent specifics (doses, prices, \
test results, timelines) that aren't in the record or catalogue.

STYLE: Concise — a few sentences or short bullets, the way you'd brief her between calls. Lead \
with the practical answer, then the key caveat / referral note. No long essays."""


def main() -> int:
    _load_dotenv()
    try:
        payload = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"bad input: {e}"}))
        return 0

    client_id = (payload.get("client_id") or "").strip()
    question = (payload.get("question") or "").strip()
    history = payload.get("history") or []
    dry_run = bool(payload.get("dry_run"))

    if not client_id or not question:
        print(json.dumps({"ok": False, "error": "client_id and question are required"}))
        return 0

    cfile = _plans_root() / "clients" / client_id / "client.yaml"
    if not cfile.exists():
        print(json.dumps({"ok": False, "error": f"client {client_id} not found"}))
        return 0
    try:
        client = yaml.safe_load(cfile.read_text()) or {}
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"could not load client: {e}"}))
        return 0

    # recent sessions, newest first by filename date heuristic
    sdir = _plans_root() / "clients" / client_id / "sessions"
    sessions: list[dict] = []
    if sdir.is_dir():
        files = sorted(sdir.glob("*.yaml"), reverse=True)
        for p in files[:8]:
            try:
                s = yaml.safe_load(p.read_text()) or {}
                if isinstance(s, dict):
                    sessions.append(s)
            except Exception:
                continue
        sessions.sort(key=lambda s: str(s.get("date", "")), reverse=True)

    ctx = _client_context(client, sessions)
    cat_ctx, ent_slugs, claim_slugs = _catalogue_grounding(question, client)

    if dry_run:
        print(json.dumps({
            "ok": True,
            "answer": f"[dry-run] Would answer: {question}\n\nContext built ({len(ctx)} chars), "
                      f"entities={ent_slugs}, claims={claim_slugs}",
            "used": {"entities": ent_slugs, "claims": claim_slugs},
            "usage": None,
            "error": None,
        }))
        return 0

    user_block = (
        f"CLIENT RECORD:\n{ctx}\n\n"
        + (cat_ctx + "\n\n" if cat_ctx else "")
        + f"QUESTION FROM SHIVANI: {question}"
    )

    msgs = []
    for h in history[-8:]:
        role = h.get("role")
        content = (h.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            msgs.append({"role": role, "content": content})
    msgs.append({"role": "user", "content": user_block})

    try:
        from anthropic import Anthropic
        from _api_guard import require_api_authorized  # cost guard C
        require_api_authorized("client-quick-chat.py")
        client_api = Anthropic()
        resp = client_api.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1000,
            system=SYSTEM,
            messages=msgs,
        )
        answer = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()
        usage = {
            "input_tokens": getattr(resp.usage, "input_tokens", None),
            "output_tokens": getattr(resp.usage, "output_tokens", None),
            "model": getattr(resp, "model", "claude-sonnet-4-6"),
        }
        try:
            from fmdb.usage import log_usage  # type: ignore
            log_usage(client_id, "client-quick-chat.py", usage["model"], resp.usage, notes="quick-chat")
        except Exception:
            pass
        print(json.dumps({
            "ok": True, "answer": answer or "(no answer)",
            "used": {"entities": ent_slugs, "claims": claim_slugs},
            "usage": usage, "error": None,
        }))
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"AI call failed: {e}"}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
