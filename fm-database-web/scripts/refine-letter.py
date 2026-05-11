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

SYSTEM = """\
You are a health coach assistant helping refine a personalised client wellness plan letter.

The coach will ask you to adjust the letter — change meals, swap recipes, soften language, \
add something, remove something, or restructure a section.

RULES:
1. Always output the COMPLETE updated letter (not just the changed section).
2. Keep all the original sections unless the coach asks to remove one.
3. Maintain the same warm, friendly, jargon-free tone throughout.
4. Preserve all supplement links, recipe footnotes, brand recommendations exactly unless \
   the coach asks you to change them.
5. Respect dietary preferences already in the letter — do not accidentally add non-veg \
   items to a vegetarian plan, etc.
6. After the document, write a brief 1–2 sentence explanation of what you changed.

Output format — use these exact tags, nothing outside them:
<document>
[complete updated letter in Markdown]
</document>
<reply>
[brief explanation of changes made]
</reply>
"""


def extract(text: str) -> tuple[str, str]:
    """Pull document and reply from Claude's structured output."""
    doc_match = re.search(r"<document>(.*?)</document>", text, re.DOTALL)
    reply_match = re.search(r"<reply>(.*?)</reply>", text, re.DOTALL)
    doc   = doc_match.group(1).strip()   if doc_match   else text.strip()
    reply = reply_match.group(1).strip() if reply_match else "Done."
    return doc, reply


def main():
    inp = json.load(sys.stdin)
    current_md = inp.get("markdown", "").strip()
    message    = inp.get("message", "").strip()
    history    = inp.get("history", [])   # list of {role, content}
    client_id  = (inp.get("client_id") or "").strip()  # for usage logging

    if not current_md:
        print(json.dumps({"ok": False, "error": "markdown is required"}))
        return
    if not message:
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
    messages.append({"role": "user", "content": message})

    try:
        api = anthropic.Anthropic()
        full_text = ""
        with api.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=8000,
            system=SYSTEM,
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
                model="claude-sonnet-4-6",
                usage=final_message.usage,
                notes=f"history_turns={len(history)}",
            )
        except Exception:
            pass

        updated_md, reply = extract(full_text)

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
            "markdown": updated_md,
            "html": html,
            "reply": reply,
        }))

    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))


if __name__ == "__main__":
    main()
