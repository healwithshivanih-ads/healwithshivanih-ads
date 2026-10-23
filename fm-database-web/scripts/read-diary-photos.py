#!/usr/bin/env python3
"""Read food-diary photos with Haiku (docs/FOOD_DIARY_PLAN.md §5 / §5b).

Coach decision 2026-10-23: the AI reads every diary photo; only a photo it
truly cannot read goes to her. This shim is the reader. It runs on the Mac
only (fired by /api/cron/food-diary), never on Fly, and every call goes
through anthropic_client.build_client — the cost guard.

For each photo with no reading yet it asks Haiku, with a forced tool, for:
  - dishes: plain names + count + size (count = pieces for breads/idli/eggs,
    katoris/bowls/glasses otherwise) — the coach estimate feeds these to the
    deterministic nutrient engine (food-diary-estimate.ts);
  - balance: protein present|light|none, veg present|light|none,
    carbs balanced|heavy — the only part a client ever sees, as words;
  - readable + confidence + reason.
and appends ONE `{"op":"read", …}` line per photo to the client's
_food_diary.mac.jsonl (the Mac's own file — see food-diary.ts for the fold).

NOT AUTHORIZED (FM_API_OK unset) → no call is made, nothing is written, and
the photos stay unread: the next authorized run reads them. The guard is
checked here BEFORE build_client, because build_client's refusal exits the
process — fine for a one-shot shim, wrong for a batch where we want to say
how many photos are waiting.

A failed call leaves that photo unread too (retried next run). Nothing here
ever reaches the client directly.

stdin:  {"clients": [{"client_id": str, "diary_id": str}], "max_photos": int?,
         "dry_run": bool?}
stdout: {"ok": true, "read": int, "unreadable": int, "queued": int,
         "api_blocked": bool, "errors": [str]}
"""
from __future__ import annotations

import base64
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

MODEL = "claude-haiku-4-5"
#: Mirrors DIARY_READ_MIN_CONFIDENCE in src/lib/fmdb/food-diary.ts (test-pinned).
MIN_CONFIDENCE = 0.5
MAX_PHOTOS_DEFAULT = 40

TOOL = {
    "name": "record_diary_photo",
    "description": "Report what this food-diary photo shows.",
    "input_schema": {
        "type": "object",
        "properties": {
            "is_food_or_drink": {"type": "boolean", "description": "Is this a photo of something eaten or drunk?"},
            "readable": {
                "type": "boolean",
                "description": "Can you tell what the food is? False if blurry, too dark, not food, "
                "or a packet whose label you cannot read.",
            },
            "confidence": {
                "type": "number",
                "description": "0 to 1 — how sure you are about the dishes. Be honest; a wrong guess is worse.",
            },
            "dishes": {
                "type": "array",
                "description": "Each separate item on the plate or in the glass. Empty if unreadable.",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Plain dish name as an Indian home cook would say it: "
                            "'moong dal', 'jowar roti', 'poha', 'paneer bhurji', 'masala chai', 'banana'.",
                        },
                        "count": {
                            "type": "integer",
                            "description": "Pieces for breads, idli, dosa, eggs, fruit; katoris/bowls/glasses otherwise. 1 if unsure.",
                        },
                        "size": {"type": "string", "enum": ["small", "regular", "large"]},
                    },
                    "required": ["name", "count", "size"],
                },
            },
            "balance": {
                "type": "object",
                "description": "The plate's proportions — NOT nutrition maths. Judge what you can see.",
                "properties": {
                    "protein": {
                        "type": "string",
                        "enum": ["present", "light", "none"],
                        "description": "present = a real serving of dal, curd, paneer, egg, chicken, fish, "
                        "sprouts, chana, tofu; light = a token amount; none = nothing protein-rich.",
                    },
                    "veg": {"type": "string", "enum": ["present", "light", "none"]},
                    "carbs": {
                        "type": "string",
                        "enum": ["balanced", "heavy"],
                        "description": "heavy = the plate leans on rice / roti / poha / bread / biscuits "
                        "with little protein or veg beside it.",
                    },
                },
                "required": ["protein", "veg", "carbs"],
            },
            "reason": {"type": "string", "description": "If not readable: why, in 2-4 words. Else empty."},
            "protein_idea": {
                "type": "string",
                "description": "If the plate is light on protein or has none: ONE addition that would bring "
                "protein to THIS dish — something a person would actually eat WITH it, in the same cuisine "
                "(spaghetti → 'chickpeas tossed through' or 'grilled paneer', never dal), and allowed by the "
                "client's diet, allergies and foods to avoid. A short noun phrase, no quantities, no advice "
                "words. Empty if the plate already has protein or nothing suitable fits.",
            },
        },
        "required": ["is_food_or_drink", "readable", "confidence", "dishes", "balance", "reason", "protein_idea"],
    },
}

SYSTEM = "\n".join(
    [
        "You read photos from a client's food diary for an Indian functional-medicine coach.",
        "Name what is on the plate or in the glass, plainly, as an Indian home cook would.",
        "Indian home food is hard to read from a photo: dal, sambar and rasam look alike in a katori;",
        "roti and paratha differ by ghee you cannot see. When you are not sure, lower `confidence`.",
        "If you cannot tell what it is at all — blurry, dark, not food, an unreadable packet — set",
        "`readable` false and say why in `reason`. That photo goes to the coach, which is fine.",
        "The client's own note, when given, is their description — trust it over your eyes.",
        "When two dishes look alike, prefer the one the client's diet allows: for a vegetarian a yellow",
        "pancake is a besan or moong chilla, not an omelette; a curry is paneer or soya, not chicken.",
        "Always fill `balance` for a readable plate, even when unsure.",
        "If the client or coach has said what the plate is, that IS the plate — name those dishes and",
        "judge `balance` for them, even if you would have guessed something else.",
        "`protein_idea` must suit the dish and respect every diet, allergy and avoid line given.",
        "`balance` is about proportions you can see, never grams. Do not judge the food; describe it.",
    ]
)


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    return Path(env).expanduser().resolve() if env else Path.home() / "fm-plans"


def _person_dir(client_id: str) -> "Path | None":
    root = _plans_root()
    for bucket in ("clients", "prospects"):
        d = root / bucket / client_id
        if d.is_dir():
            return d
    return None


def _load_dotenv() -> None:
    envp = FMDB_ROOT / ".env"
    try:
        from dotenv import load_dotenv  # type: ignore

        load_dotenv(envp, override=False)
    except Exception:
        if envp.exists():
            for line in envp.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _as_text(v) -> str:
    if isinstance(v, list):
        return ", ".join(str(x) for x in v if x)
    return str(v or "")


def _diet_context(doc: dict) -> str:
    """Everything the reader needs so `protein_idea` is something THIS client
    can eat. The client app filters the idea again before showing it."""
    lines = [f"Client's diet: {doc.get('dietary_preference') or 'not recorded (treat as vegetarian)'}."]
    if _as_text(doc.get("known_allergies")).strip():
        lines.append(f"Allergies: {_as_text(doc.get('known_allergies'))}.")
    if _as_text(doc.get("foods_to_avoid")).strip():
        lines.append(f"Foods to avoid: {_as_text(doc.get('foods_to_avoid'))}.")
    try:
        from fmdb.plan.dairy import dairy_prompt_line

        d = dairy_prompt_line(doc)
        if d:
            lines.append(d)
    except Exception:
        pass
    return "\n".join(lines)


def read_lines(person: Path) -> list:
    out = []
    for f in sorted(person.glob("_food_diary.*.jsonl")):
        try:
            text = f.read_text(encoding="utf-8")
        except Exception:
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue  # torn final line
            if isinstance(d, dict) and d.get("op") and d.get("diary_id") and d.get("ts"):
                out.append(d)
    return out


def _ts(s) -> float:
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def unread_entries(lines: list, diary_id: str) -> list:
    """Live photos of this diary that need a read, oldest first: never read,
    or the client / coach said what it is AFTER the last read (the balance
    must be judged for the real plate). Mirrors food-diary.ts::entryNeedsRead.

    Each returned add-line carries `label` — the coach's correction, else the
    client's — so the reader can be told what the plate is."""
    mine = sorted((l for l in lines if l.get("diary_id") == diary_id), key=lambda l: l["ts"])
    added: dict = {}
    deleted: set = set()
    read_at: dict = {}
    coach: dict = {}
    client: dict = {}
    for l in mine:
        eid = l.get("entry_id")
        if not eid:
            continue
        op = l["op"]
        if op == "add" and eid not in added and l.get("photo"):
            added[eid] = dict(l)
        elif op == "delete":
            deleted.add(eid)
        elif op == "read":
            read_at[eid] = max(read_at.get(eid, 0.0), _ts((l.get("reading") or {}).get("read_at") or l["ts"]))
        elif op == "label":
            lab = str(l.get("label") or "").strip()
            coach[eid] = (lab, _ts(l["ts"])) if lab else None
        elif op == "edit" and isinstance(l.get("name"), str):
            nm = l["name"].strip()
            client[eid] = (nm, _ts(l["ts"])) if nm else None
    out = []
    for eid, a in added.items():
        if eid in deleted:
            continue
        c, k = coach.get(eid), client.get(eid)
        labelled_at = max((c or ("", 0.0))[1], (k or ("", 0.0))[1])
        if eid in read_at and labelled_at <= read_at[eid]:
            continue
        a["label"] = (c or k or ("", 0.0))[0]
        out.append(a)
    return out


def normalise_reading(raw: dict) -> dict:
    """Clamp the model's answer into the stored shape; `readable` is true only
    when the model said so, it is food, confidence clears the bar and at least
    one dish was named."""
    dishes = []
    for d in raw.get("dishes") or []:
        if not isinstance(d, dict) or not str(d.get("name") or "").strip():
            continue
        try:
            count = int(d.get("count") or 1)
        except (TypeError, ValueError):
            count = 1
        size = d.get("size") if d.get("size") in ("small", "regular", "large") else "regular"
        dishes.append({"name": str(d["name"]).strip()[:80], "count": max(1, min(6, count)), "size": size})
    try:
        conf = float(raw.get("confidence") or 0)
    except (TypeError, ValueError):
        conf = 0.0
    conf = max(0.0, min(1.0, conf))
    bal = raw.get("balance") if isinstance(raw.get("balance"), dict) else {}
    balance = {
        "protein": bal.get("protein") if bal.get("protein") in ("present", "light", "none") else None,
        "veg": bal.get("veg") if bal.get("veg") in ("present", "light", "none") else None,
        "carbs": bal.get("carbs") if bal.get("carbs") in ("balanced", "heavy") else None,
    }
    readable = bool(raw.get("readable")) and bool(raw.get("is_food_or_drink")) and conf >= MIN_CONFIDENCE and bool(dishes)
    out = {"readable": readable, "confidence": round(conf, 2), "dishes": dishes if readable else []}
    # Protein alone is enough to mark the plate; veg / carbs ride along only
    # when the model gave a valid word for them (it occasionally omits one).
    if readable and balance["protein"]:
        out["balance"] = {k: v for k, v in balance.items() if v}
    idea = str(raw.get("protein_idea") or "").strip().strip(".")[:100]
    if readable and idea and balance["protein"] in ("light", "none"):
        out["protein_idea"] = idea
    reason = str(raw.get("reason") or "").strip()[:80]
    if not readable:
        out["reason"] = reason or ("not food" if not raw.get("is_food_or_drink") else "unclear")
    return out


def _ask(api, b64: str, context: str):
    resp = api.messages.create(
        model=MODEL,
        max_tokens=600,
        system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
        tools=[TOOL],
        tool_choice={"type": "tool", "name": TOOL["name"]},
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
                    {"type": "text", "text": context},
                ],
            }
        ],
    )
    call = next((b for b in resp.content if getattr(b, "type", None) == "tool_use"), None)
    return (call.input if call and isinstance(call.input, dict) else None), resp.usage


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2
    clients = payload.get("clients") or []
    max_photos = int(payload.get("max_photos") or MAX_PHOTOS_DEFAULT)
    dry_run = bool(payload.get("dry_run"))

    import yaml  # type: ignore

    work = []  # (client_id, person, diary_id, entry, diet)
    for c in clients:
        cid = str((c or {}).get("client_id") or "")
        did = str((c or {}).get("diary_id") or "")
        person = _person_dir(cid) if cid else None
        if not person or not did:
            continue
        try:
            doc = yaml.safe_load((person / "client.yaml").read_text(encoding="utf-8")) or {}
        except Exception:
            doc = {}
        diet = _diet_context(doc)
        for e in unread_entries(read_lines(person), did):
            work.append((cid, person, did, e, diet))

    out = {"ok": True, "read": 0, "unreadable": 0, "queued": len(work), "api_blocked": False, "errors": []}
    if not work:
        json.dump(out, sys.stdout)
        return 0

    from _api_guard import api_authorized

    if not dry_run and not api_authorized():
        # Nothing written: every photo stays unread and is picked up by the
        # next authorized run. Not an error — a manual shell run is $0 by design.
        out["api_blocked"] = True
        json.dump(out, sys.stdout)
        return 0

    api = None
    if not dry_run:
        _load_dotenv()
        from anthropic_client import build_client

        api = build_client()

    for cid, person, did, e, diet in work[:max_photos]:
        photo = person / "files" / "diary" / str(e.get("photo"))
        try:
            b64 = base64.b64encode(photo.read_bytes()).decode("ascii")
        except Exception:
            out["errors"].append(f"{cid}: photo missing {e.get('photo')}")
            continue
        band = {"waking": "early morning", "morning": "breakfast", "midday": "lunch", "evening": "evening", "bedtime": "late night"}.get(
            str(e.get("band")), "a meal"
        )
        context = (
            f"Meal: {band}, around {e.get('time')}.\n{diet}\n"
            f"Client's note: {e.get('note') or '(none)'}"
            + (f"\nThe client / coach says this plate is: {e['label']}" if e.get("label") else "")
        )
        if dry_run:
            reading_raw = {
                "is_food_or_drink": True, "readable": True, "confidence": 0.9,
                "dishes": [{"name": "moong dal", "count": 1, "size": "regular"}],
                "balance": {"protein": "present", "veg": "light", "carbs": "balanced"}, "reason": "",
            }
            usage = None
        else:
            try:
                reading_raw, usage = _ask(api, b64, context)
            except Exception as ex:  # left unread → retried next run
                out["errors"].append(f"{cid}: {type(ex).__name__}: {str(ex)[:160]}")
                continue
            if usage is not None:
                try:
                    from fmdb.usage import log_usage

                    log_usage(client_id=cid, script="read-diary-photos.py", model=MODEL, usage=usage, notes="food diary photo")
                except Exception:
                    pass
            if not reading_raw:
                out["errors"].append(f"{cid}: no tool output for {e.get('entry_id')}")
                continue
        reading = normalise_reading(reading_raw)
        reading["read_at"] = datetime.now(timezone.utc).isoformat()
        reading["model"] = "dry-run" if dry_run else MODEL
        line = {
            "op": "read",
            "diary_id": did,
            "ts": reading["read_at"],
            "entry_id": e["entry_id"],
            "reading": reading,
        }
        with (person / "_food_diary.mac.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(line, ensure_ascii=False) + "\n")
        try:
            os.chmod(person / "_food_diary.mac.jsonl", 0o600)
        except Exception:
            pass
        out["read" if reading["readable"] else "unreadable"] += 1

    out["queued"] = max(0, len(work) - out["read"] - out["unreadable"])
    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
