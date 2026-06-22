#!/usr/bin/env python3
"""
refine-letter.py — chat-based refinement of a generated client letter.

stdin:
{
  "markdown":   "<current full letter>",
  "message":    "<coach's latest request>",
  "history":    [{"role": "user"|"assistant", "content": "..."}],   // prior turns
  "plan_slug":  "...",   // optional — for context only
  "client_id":  "..."    // optional — for context only
}

stdout:
{
  "ok":       true,
  "markdown": "<complete updated letter>",
  "html":     "<branded HTML or null>",
  "reply":    "<short explanation of what changed>"
}

Claude always returns the FULL updated document — no diffs, no partials.
The chat history is carried across turns so Claude has full context.
"""
from __future__ import annotations  # PEP 604 `str | None` for py3.9 venv
import sys, json, os, re
from pathlib import Path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../fm-database"))

try:
    from dotenv import load_dotenv
    _env = Path(__file__).parent.parent.parent / "fm-database" / ".env"
    load_dotenv(_env, override=True)
except Exception:
    pass

import anthropic

# ── DISCUSS mode ──────────────────────────────────────────────────────────────
# Conversational only. No file write. Used by the coach to talk through
# changes before committing — clarify, propose, accumulate. The AI keeps
# a running pending-changes list at the bottom of each reply so the coach
# always sees what's queued.
SYSTEM_DISCUSS = """\
You are a health coach assistant helping refine a personalised client wellness plan letter.

You are in DISCUSS mode. The coach is talking through edits she wants to make
— she's NOT asking you to commit anything yet. Your job:

1. Confirm you understood each edit (or ask a one-line clarifying question
   if it's genuinely ambiguous — never ask just to be polite).
2. Maintain a running list of "Pending changes" at the END of each reply, as
   plain bullets. Re-emit the FULL list every reply, including changes from
   earlier turns the coach hasn't retracted.
3. If the coach says "drop that one" / "actually skip the dosa swap" /
   "never mind" — remove it from the pending list and confirm.
4. Respect dietary preferences and existing safety constraints (vegetarian,
   Jain, foods_to_avoid). Refuse to queue an edit that violates them; flag
   the conflict in your reply.
5. Be brief. Replies should be ≤ 5 sentences (plus the pending-changes
   block). The coach can read the rewrite later.

DO NOT emit the rewritten letter in this mode. DO NOT use <document> tags.

Output format — wrap your conversational reply in <reply>…</reply>, then
emit the pending list inside <pending>…</pending> as a YAML list of strings:

<reply>
Got it — I'll swap ragi porridge for ragi dosa on Monday breakfast only,
keeping the rest of week 1 as-is.
</reply>
<pending>
- Day 1 (Mon) breakfast: swap ragi porridge → ragi dosa
- Day 4 dinner: drop paneer, replace with grilled tofu
</pending>

If the coach's first message is open-ended ("can you make this better?"),
ASK what specifically. If she gives a clear edit, queue it.
"""

# ── FINALISE mode ─────────────────────────────────────────────────────────────
# Applies every change in <pending> to the current document in ONE rewrite.
# Returns the full updated letter.
SYSTEM_FINALISE = """\
You are a health coach assistant.

You are in FINALISE mode. The coach wants her edits applied to the letter
NOW. Apply every edit she asked for and output the complete rewritten
document.

WHERE THE EDITS ARE — apply edits from ANY of these, whichever are present:
  (a) a <pending> block earlier in the chat (a built-up edit queue), AND/OR
  (b) edit instructions stated directly in the coach's chat messages —
      including her most recent message.
A <pending> block is OPTIONAL. If there isn't one, the coach's plain-text
messages ARE the edit list — apply them. NEVER ask the coach to re-state
or "share the list of" edits — you can already see them in the conversation.

RULES:
1. Apply EVERY edit the coach asked for, in one pass.
2. Always output the COMPLETE updated letter (not just the changed
   sections). Preserve EVERYTHING the coach didn't ask you to change.
3. Maintain the same warm, friendly, jargon-free tone.
4. Preserve all supplement links, recipe footnotes, brand recommendations,
   and start-date buttons exactly unless explicitly told otherwise.
5. Respect dietary preferences (vegetarian, Jain, eggetarian, vegan,
   foods_to_avoid). If a requested change would violate one, skip THAT
   change and name it in the <reply>.
6. If — and only if — there is genuinely no edit instruction anywhere in
   the conversation, return the letter UNCHANGED inside <document> and say
   so in <reply>. You must ALWAYS emit a <document> block; never refuse.
7. After the document, write a 1–3 sentence summary of what changed.
8. NO EVIDENCE-HEDGING: never introduce evidence-quality framing into the
   client letter — no "emerging / thin / limited evidence", "may help",
   "might support", "is thought to", "more research needed", or any
   strength-of-evidence label on a supplement / remedy / herb / food /
   practice (including Ayurvedic guidance). Present everything plainly and
   confidently. The only caveats allowed are SAFETY ones (allergy, drug
   interaction, "check with me before starting if…"). Only add such hedging
   if the coach EXPLICITLY asks for it.

Output format — use these exact tags, ALWAYS including <document>:
<document>
[complete updated letter in Markdown]
</document>
<reply>
[brief summary of changes made — also list any that were skipped and why]
</reply>
"""

# Backwards-compat alias for any code path still referring to SYSTEM directly.
SYSTEM = SYSTEM_FINALISE


def extract(text: str) -> tuple[str | None, str, list[str]]:
    """Pull document, reply, and pending-list from Claude's structured output.

    Returns (doc | None, reply, pending). `doc` is None unless Claude emitted
    a `<document>…</document>` envelope (FINALISE mode); we never fall back
    to using arbitrary text as the new letter content — once burned the
    consolidated meal plan, never again.

    `pending` is the list of staged edits from the <pending> block in
    DISCUSS mode. Each entry is a one-line string. Empty list when the
    block is absent.
    """
    doc_match = re.search(r"<document>(.*?)</document>", text, re.DOTALL)
    reply_match = re.search(r"<reply>(.*?)</reply>", text, re.DOTALL)
    pending_match = re.search(r"<pending>(.*?)</pending>", text, re.DOTALL)

    doc = doc_match.group(1).strip() if doc_match else None
    if reply_match:
        reply = reply_match.group(1).strip()
    else:
        # No <reply> block — surface the whole text as the conversational
        # reply (likely a clarifying question from the model).
        reply = text.strip() or "Done."

    pending: list[str] = []
    if pending_match:
        for line in pending_match.group(1).splitlines():
            ln = line.strip()
            if ln.startswith("-"):
                pending.append(ln.lstrip("-").strip())
            elif ln:
                pending.append(ln)

    return doc, reply, pending


def main():
    inp = json.load(sys.stdin)
    current_md = inp.get("markdown", "").strip()
    message    = inp.get("message", "").strip()
    history    = inp.get("history", [])   # list of {role, content}
    client_id  = (inp.get("client_id") or "").strip()  # for usage logging
    # mode: "discuss" (default) = conversational, no file write;
    #       "finalise" = apply queued edits, return full updated letter.
    mode = (inp.get("mode") or "discuss").strip().lower()
    if mode not in ("discuss", "finalise"):
        mode = "discuss"

    if not current_md:
        print(json.dumps({"ok": False, "error": "markdown is required"}))
        return
    # Discuss mode requires a message; finalise mode is allowed empty-message
    # (the queued edits in history carry the intent).
    if not message and mode == "discuss":
        print(json.dumps({"ok": False, "error": "message is required"}))
        return

    # Build message list: inject current document at start of conversation,
    # then replay history, then add the new user turn.
    # We do this by prepending a synthetic first exchange that sets the document.
    messages = [
        {
            "role": "user",
            "content": (
                f"Here is the current version of the client letter:\n\n"
                f"<document>\n{current_md}\n</document>\n\n"
                f"Please confirm you have it."
            ),
        },
        {
            "role": "assistant",
            "content": (
                "<document>\n[acknowledged — I have the current letter]\n</document>\n"
                "<reply>Got it. Ready to help you refine it.</reply>"
            ),
        },
    ]

    # Replay prior conversation turns (skip the bootstrap pair above)
    for turn in history:
        if turn.get("role") in ("user", "assistant") and turn.get("content"):
            messages.append({"role": turn["role"], "content": turn["content"]})

    # Add the new request
    if mode == "finalise":
        # The coach may have typed a direct edit in the SAME box and hit
        # Apply (the UI defaults to finalise mode) — that message must NOT
        # be discarded. It IS the edit to apply. Include it, plus any
        # edits queued earlier in the chat.
        if message:
            apply_instr = (
                f"{message}\n\n"
                "Apply this edit — together with any other edits I asked "
                "for earlier in this chat (a <pending> block if present, "
                "otherwise my plain messages) — to the document. Return the "
                "FULL rewritten letter in <document>...</document>, then "
                "summarise in <reply>...</reply>."
            )
        else:
            apply_instr = (
                "Apply every edit I asked for in this chat — the <pending> "
                "block above if there is one, otherwise the edits stated "
                "directly in my messages — to the document. Return the FULL "
                "rewritten letter in <document>...</document>, then summarise "
                "in <reply>...</reply>."
            )
        messages.append({"role": "user", "content": apply_instr})
    else:
        messages.append({"role": "user", "content": message})

    # Pick model + system prompt per mode. Haiku is plenty for the
    # conversational pass (cheap, instant); Sonnet for the actual rewrite.
    if mode == "finalise":
        active_system = SYSTEM_FINALISE
        active_model = "claude-sonnet-4-6"
        active_max_tokens = 12000
    else:
        active_system = SYSTEM_DISCUSS
        active_model = "claude-haiku-4-5"
        active_max_tokens = 2000

    try:
        from _api_guard import require_api_authorized  # cost guard C
        require_api_authorized("refine-letter.py")
        api = anthropic.Anthropic()
        full_text = ""
        with api.messages.stream(
            model=active_model,
            max_tokens=active_max_tokens,
            system=active_system,
            messages=messages,
        ) as stream:
            for chunk in stream.text_stream:
                full_text += chunk
            final_message = stream.get_final_message()

        try:
            from fmdb.usage import log_usage as _log_usage
            _log_usage(
                client_id=client_id or None,
                script="refine-letter.py",
                model=active_model,
                usage=final_message.usage,
                notes=f"mode={mode} history_turns={len(history)}",
            )
        except Exception:
            pass

        updated_md, reply, pending = extract(full_text)

        # DISCUSS mode: we DON'T expect a <document> block. Return the
        # reply + the pending-edits list so the UI can render the
        # running queue.
        if mode == "discuss":
            print(json.dumps({
                "ok": True,
                "mode": "discuss",
                "markdown": None,
                "html": None,
                "reply": reply,
                "pending": pending,
                "no_update": True,
            }))
            return

        # FINALISE mode: a <document> block is required. If missing,
        # return error rather than corrupting the file.
        if updated_md is None:
            print(json.dumps({
                "ok": False,
                "mode": "finalise",
                "error": (
                    "The AI didn't emit a <document> block on finalise. "
                    "Reply was:\n\n" + reply
                ),
                "reply": reply,
                "no_update": True,
            }))
            return

        # Safety check — the AI sometimes returns a `<document>` block
        # that's drastically shorter than the original (e.g. it dropped
        # most of the letter while "answering"). Require the rewrite to
        # be at least half the original size before we trust it.
        if len(updated_md) < max(500, len(current_md) // 2):
            print(json.dumps({
                "ok": True,
                "markdown": None,
                "html": None,
                "reply": (
                    "I drafted a rewrite that came back much shorter than the "
                    "current letter — refused to save it. Try a more specific "
                    "instruction (e.g. 'on Monday breakfast, swap ragi porridge "
                    "to ragi dosa — keep everything else'), or open the editor "
                    "directly. Original reply was:\n\n" + reply
                ),
                "no_update": True,
            }))
            return

        # Generate branded HTML
        try:
            from brand_html import wrap_in_brand_html
            html = wrap_in_brand_html(
                updated_md,
                title="Your Personalised Wellness Plan",
                doc_type="Personalised Wellness Plan",
            )
        except Exception:
            html = None

        print(json.dumps({
            "ok": True,
            "mode": "finalise",
            "markdown": updated_md,
            "html": html,
            "reply": reply,
        }))

    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))


if __name__ == "__main__":
    main()
