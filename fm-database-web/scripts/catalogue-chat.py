#!/usr/bin/env python3
"""Catalogue chat — natural-language commands → structured reclassify proposals.

The coach types things like:
  - "Anti-gravity exercise isn't a condition; make it a healing program."
  - "Merge bloating-and-gas into bloating."
  - "Delete the duplicate antigravity topic."

Haiku reads the message + a slim catalogue snapshot (slugs only, grouped by
kind) and returns a structured proposal via tool-use. The UI surfaces it for
confirmation; on Apply, reclassify-entity.py does the actual mutation.

Reads JSON from stdin:
{
  "user_message": str,
  "dry_run":      bool,     # if true, return a synthetic proposal
}

Writes JSON to stdout:
{
  "ok": bool,
  "proposal": {
    "action":          "move" | "merge" | "delete" | "noop",
    "source_kind":     str | null,
    "source_slug":     str | null,
    "target_kind":     str | null,    # for move
    "merge_into_kind": str | null,    # for merge
    "merge_into_slug": str | null,    # for merge
    "reasoning":       str,
    "needs_clarification": bool,      # true if Haiku couldn't resolve uniquely
    "clarification":   str | null,    # follow-up question to ask the coach
  },
  "usage": {...},
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


KINDS = [
    "topics", "mechanisms", "symptoms", "supplements", "protocols",
    "titration_protocols", "lab_panels", "lab_tests", "claims", "sources",
    "cooking_adjustments", "home_remedies", "mindmaps", "drug_depletions",
]
KINDS_WITH_ALIASES = {"topics", "mechanisms", "symptoms", "supplements", "protocols"}
# High-cardinality kinds whose display_name is a long sentence (claims ~3300,
# each a full statement; sources ~330). Sending those sentences was ~40-68% of
# the per-message snapshot (~58K+ tokens), and the chat only needs the SLUG to
# validate/route a command (delete claims/X, move claims->topics). So emit
# slug-only for these — they stay reachable, the bloat is gone.
SLUG_ONLY_KINDS = {"claims", "sources"}


def _slim_catalogue() -> dict[str, list[dict]]:
    """Return {kind: [{slug, display_name}, ...]} per catalogue kind — except the
    high-cardinality SLUG_ONLY_KINDS (claims, sources), which emit {slug} only to
    keep the snapshot small. Display name elsewhere lets Haiku disambiguate."""
    root = Path(os.environ.get("FMDB_CATALOGUE_DIR") or (FMDB_ROOT / "data"))
    out: dict[str, list[dict]] = {}
    for k in KINDS:
        d = root / k
        rows: list[dict] = []
        slug_only = k in SLUG_ONLY_KINDS
        if d.exists():
            for f in sorted(d.glob("*.yaml")):
                try:
                    data = yaml.safe_load(f.read_text()) or {}
                    slug = data.get("slug") or data.get("id") or f.stem
                    if slug_only:
                        rows.append({"slug": str(slug)})
                    else:
                        name = data.get("display_name") or data.get("title") or slug
                        rows.append({"slug": str(slug), "display_name": str(name)})
                except Exception:
                    pass
        out[k] = rows
    return out


_TOOL = {
    "name": "reclassify_proposal",
    "description": (
        "Return a structured proposal for ONE catalogue action: move, merge, delete, or noop. "
        "If the coach's request is ambiguous, set needs_clarification=true and ask a follow-up question."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["move", "merge", "delete", "noop"],
                "description": "What the coach wants to do."
            },
            "source_kind": {
                "type": ["string", "null"],
                "enum": KINDS + [None],
                "description": "Kind of the entity being acted on."
            },
            "source_slug": {
                "type": ["string", "null"],
                "description": "Slug of the entity being acted on. Must match an existing slug in the source kind."
            },
            "target_kind": {
                "type": ["string", "null"],
                "enum": KINDS + [None],
                "description": "For action=move: the destination kind. Different from source_kind."
            },
            "merge_into_kind": {
                "type": ["string", "null"],
                "enum": ["topics", "mechanisms", "symptoms", "supplements", "protocols", None],
                "description": "For action=merge: kind of the canonical entity to merge into."
            },
            "merge_into_slug": {
                "type": ["string", "null"],
                "description": "For action=merge: slug of the canonical entity (must exist)."
            },
            "reasoning": {
                "type": "string",
                "description": "One sentence explaining why this is the right action."
            },
            "needs_clarification": {
                "type": "boolean",
                "description": "true if the request is ambiguous and the coach must clarify."
            },
            "clarification": {
                "type": ["string", "null"],
                "description": "If needs_clarification=true, a short follow-up question."
            },
        },
        "required": ["action", "reasoning", "needs_clarification"],
    },
}


SYSTEM_PROMPT = """You are a catalogue librarian for a Functional Medicine knowledge base.

The coach manages a YAML catalogue with these kinds: topics (Conditions), mechanisms (Root causes),
symptoms (Symptoms), supplements (Supplements), protocols (Healing programs), titration_protocols
(Dose schedules), lab_panels (Lab panels), lab_tests (Lab markers), claims (Evidence notes),
sources (References), cooking_adjustments (Kitchen swaps), home_remedies (Home remedies),
mindmaps (Mind maps), drug_depletions (Drug-nutrient depletions).

Your job: read the coach's natural-language request and propose ONE structured action.

Rules:
1. Pick exactly one action: move (change kind), merge (fold into another entity), delete (remove), or noop.
2. Source slug MUST already exist in the slim catalogue snapshot you're given. If not, set
   needs_clarification=true with a follow-up question.
3. For "move": target_kind must differ from source_kind. Stub will be auto-created if the target
   slug doesn't exist yet.
4. For "merge": merge_into_kind must be one of topics/mechanisms/symptoms/supplements/protocols
   (these support aliases). merge_into_slug must already exist.
5. For "delete": leave target_* fields null.
6. If the coach's intent is genuinely unclear (multiple candidate slugs, missing key info),
   prefer needs_clarification=true with one focused question over guessing.
7. Treat domain phrases as the COACH-FACING kind labels: "Condition" = topic, "Root cause" =
   mechanism, "Healing program" = protocol, "Dose schedule" = titration_protocol, "Lab marker" =
   lab_test, "Evidence note" = claim, "Reference" = source. Map back to the internal kind name
   in your response.
8. Reasoning is ONE sentence, plain English, no slug jargon.

Always call the `reclassify_proposal` tool — never reply in plain text.
"""


def _synthetic_proposal(user_message: str) -> dict:
    return {
        "ok": True,
        "proposal": {
            "action": "noop",
            "source_kind": None,
            "source_slug": None,
            "target_kind": None,
            "merge_into_kind": None,
            "merge_into_slug": None,
            "reasoning": f"[dry-run] echoing message: {user_message[:120]}",
            "needs_clarification": True,
            "clarification": "Dry-run — set ANTHROPIC_API_KEY to enable real interpretation.",
        },
        "usage": {
            "model": "dry-run",
            "stop_reason": "end_turn",
            "input_tokens": 0,
            "output_tokens": 0,
        },
    }


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON on stdin: {e}"}, sys.stdout)
        return 2

    user_message = (payload.get("user_message") or "").strip()
    dry_run = bool(payload.get("dry_run"))

    if not user_message:
        json.dump({"ok": False, "error": "user_message is required"}, sys.stdout)
        return 2

    _load_dotenv()

    if dry_run or not os.environ.get("ANTHROPIC_API_KEY"):
        json.dump(_synthetic_proposal(user_message), sys.stdout)
        return 0

    try:
        from anthropic import Anthropic
    except ImportError:
        json.dump({"ok": False, "error": "anthropic SDK not installed"}, sys.stdout)
        return 1

    catalogue = _slim_catalogue()
    catalogue_block = json.dumps(catalogue, indent=0, separators=(",", ":"))

    from _api_guard import require_api_authorized  # cost guard C
    require_api_authorized("catalogue-chat.py")
    client = Anthropic()
    try:
        message = client.messages.create(
            model=os.environ.get("FMDB_HAIKU_MODEL", "claude-haiku-4-5"),
            max_tokens=1024,
            system=[
                {"type": "text", "text": SYSTEM_PROMPT},
                {
                    "type": "text",
                    "text": "Catalogue snapshot (slug + display name per kind; claims & sources are slug-only):\n" + catalogue_block,
                    "cache_control": {"type": "ephemeral"},
                },
            ],
            tools=[_TOOL],
            tool_choice={"type": "tool", "name": "reclassify_proposal"},
            messages=[{"role": "user", "content": user_message}],
        )
    except Exception as e:
        json.dump({"ok": False, "error": f"anthropic call failed: {type(e).__name__}: {e}"}, sys.stdout)
        return 1

    # Extract the tool-use block
    proposal: dict | None = None
    for block in message.content:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == "reclassify_proposal":
            proposal = dict(block.input)
            break

    if proposal is None:
        json.dump({
            "ok": False,
            "error": "model returned no tool-use; check system prompt",
        }, sys.stdout)
        return 1

    usage = {
        "model": message.model,
        "stop_reason": message.stop_reason,
        "input_tokens": message.usage.input_tokens,
        "output_tokens": message.usage.output_tokens,
        "cache_creation_input_tokens": getattr(message.usage, "cache_creation_input_tokens", 0) or 0,
        "cache_read_input_tokens": getattr(message.usage, "cache_read_input_tokens", 0) or 0,
    }

    json.dump({"ok": True, "proposal": proposal, "usage": usage, "error": None}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
