# Inbound WhatsApp Forwarder — Contract

**Problem:** AiSensy on the current plan does NOT deliver inbound webhooks, so
client button-tap replies to the weekly poll never reach the coach app
automatically.

**Solution:** Shivani's custom WhatsApp app receives messages from Meta (via
whatever BSP / Cloud API it uses) and forwards them as a POST to this app's
existing inbound endpoint. From the coach app's perspective nothing changes —
the same handler that processed AiSensy webhooks now processes forwarded ones.

This doc is the contract the forwarder must honour. As long as the POST shape
matches, the coach app does not care where the message originated.

---

## Endpoint

```
POST {COACH_APP_URL}/api/aisensy-webhook
```

`COACH_APP_URL` examples:
- Dev:        `https://abc123.trycloudflare.com`
- Production: `https://coach.healwithshivani.com` (or wherever PM2 is hosting)

The endpoint name keeps the `aisensy-webhook` slug because that handler already
exists and works. We're routing different upstreams through the same door.

---

## Headers

```
Content-Type: application/json
X-AiSensy-Secret: <secret>
```

`<secret>` must match the `AISENSY_WEBHOOK_SECRET` env var on the coach app
server. If the env var is unset the handler accepts any POST (dev mode); set
it for production.

---

## Body schema

Send JSON in one of these two shapes — the handler accepts both:

### Shape A — AiSensy-native (preferred for compatibility)

```jsonc
{
  "waId":      "919876543210",   // sender phone in E.164 without leading +
  "message":   "All good 🌿",     // the button label text exactly as the client tapped
  "name":      "Priya Sharma",   // optional sender display name
  "type":      "text",           // MUST be "text" — handler skips other types
  "timestamp": 1712345678        // optional unix seconds; used for received_at display
}
```

### Shape B — Generic

```jsonc
{
  "phone":   "919876543210",
  "message": "All good 🌿",
  "name":    "Priya Sharma"
}
```

Pick whichever your forwarder finds easier to produce. Internally we read
`waId ?? phone ?? wa_id` and `message ?? text ?? body`.

---

## Phone format

Send digits only, with country code, **without** the leading `+`.

- ✅ `919876543210` (India 10-digit number with `91` prefix)
- ✅ `4407911123456` (UK)
- ❌ `+919876543210` (handler strips the `+` if present, but cleaner to omit)
- ❌ `9876543210` (no country code — handler still tries to match by trailing-10-digits
  but you risk misrouting to the wrong client when phones collide)

The handler matches the phone to a `client.yaml` by `client.mobile_number`,
trying:
1. Exact E.164 match
2. Trailing 10-digit match (cheap fallback for clients who saved their number
   without a country code)

If no client matches, the message is saved to
`~/fm-plans/_aisensy_unmatched.yaml` and the handler returns 200 (so the
forwarder doesn't retry — unmatched is not an error, it's a coach review item).

---

## Message text — important for poll replies

For **weekly poll button taps**, the `message` field MUST contain one of the
registered button labels verbatim (case-insensitive substring match). The
classifier (`src/lib/poll-labels.ts → classifyPollReply`) scans the text for:

| Dimension     | Label substrings                                       |
|---------------|--------------------------------------------------------|
| overall       | `"all good"`, `"some struggles"`, `"need help"`        |
| supplements   | `"all taken"`, `"missed 1-2"`, `"missed 1"`, `"stopped"` |
| meals         | `"yes mostly"`, `"half the time"`, `"struggling"`      |
| movement      | `"most days"`, `"a few times"`, `"none"`               |

If the forwarder strips emoji or normalises whitespace, that's fine — the
match is substring + lowercase. If the forwarder reformats the button label
(e.g. wraps it in `"Client tapped: All good"`) the substring still matches and
the classifier still fires. Just don't fully replace the label text.

If the inbound text is **free-form** (not a poll reply), the classifier
returns null and the handler routes it through the generic `quick_note`
session path instead. Both paths work — coach gets the message either way.

---

## Response

The handler returns one of these JSON shapes (HTTP 200 in all cases except
auth fail or malformed body):

```jsonc
// Successful poll reply
{ "ok": true, "poll": true, "client_id": "cl-004", "dim": "overall",
  "score": "good", "session_id": "2026-05-14-001-poll" }

// Successful free-form message
{ "ok": true, "client_id": "cl-004", "session_id": "2026-05-14-001-...",
  "message": "Note saved for Priya" }

// No matching client — saved to unmatched log
{ "ok": true, "matched": false,
  "note": "Message received but no matching client — saved to _aisensy_unmatched.yaml for coach review" }

// Auth failed
HTTP 401 { "ok": false, "error": "Unauthorized" }

// Malformed body
HTTP 400 { "ok": false, "error": "..." }
```

Treat any 2xx as delivered. Retry on 5xx (server error). Do NOT retry on
401 / 400.

---

## Quick test (curl)

After exposing the coach app at `https://abc123.trycloudflare.com`:

```bash
# Free-form message test (no poll classification)
curl -X POST https://abc123.trycloudflare.com/api/aisensy-webhook \
  -H "Content-Type: application/json" \
  -H "X-AiSensy-Secret: $AISENSY_WEBHOOK_SECRET" \
  -d '{
    "waId": "919999999999",
    "message": "Feeling better today!",
    "name": "Test Client",
    "type": "text"
  }'

# Poll-reply test — should classify as overall=good
curl -X POST https://abc123.trycloudflare.com/api/aisensy-webhook \
  -H "Content-Type: application/json" \
  -H "X-AiSensy-Secret: $AISENSY_WEBHOOK_SECRET" \
  -d '{
    "waId": "919999999999",
    "message": "All good 🌿",
    "name": "Test Client",
    "type": "text"
  }'
```

Use a real `waId` matching a `client.mobile_number` in `~/fm-plans/clients/*/client.yaml`
to see the full happy path. With a fake number you'll get the unmatched-log path.

---

## What the forwarder should do — pseudocode

```python
def on_whatsapp_message_received(meta_payload):
    # meta_payload is whatever your BSP / Meta Cloud API hands you.
    # Extract the bits we care about:
    body = {
        "waId":      extract_sender_phone(meta_payload),       # digits, no +
        "message":   extract_message_text(meta_payload),       # button label or free text
        "name":      extract_sender_name(meta_payload),        # optional
        "type":      "text",                                    # always "text"; skip media for now
        "timestamp": extract_timestamp(meta_payload),          # unix seconds
    }
    requests.post(
        f"{COACH_APP_URL}/api/aisensy-webhook",
        headers={
            "Content-Type": "application/json",
            "X-AiSensy-Secret": SHARED_SECRET,
        },
        json=body,
        timeout=10,
    )
```

That's the whole contract. Coach app handles classification, client matching,
session persistence, and the 3-strike adherence-drop detector.

---

## Operational notes

- **Media messages** (image / audio / document) are silently skipped by the
  handler today. If the forwarder receives one, either drop it on the floor
  or extract any text caption and send THAT. Don't try to forward binary —
  the handler doesn't process it.
- **Interactive button replies** from Meta Cloud API arrive as
  `interactive.button_reply.title` rather than top-level `message`. The
  forwarder should normalise that — pull the title out and put it in our
  `message` field. The handler does NOT currently parse the nested shape.
- **Retries:** Meta Cloud API may deliver the same message twice. The handler
  does not deduplicate today — duplicate messages will create duplicate
  `quick_note` sessions. Forwarder should dedupe by Meta's message_id if
  reliability becomes an issue.
- **Idempotency keys:** Not required today. If we add them later, the
  forwarder can include `X-Idempotency-Key: <meta-message-id>` and the
  handler will be taught to swallow repeats.

---

## When to revisit

If we move to a BSP that gives us native webhooks (Twilio / 360dialog /
Gupshup / upgraded AiSensy), the forwarder becomes unnecessary — those
providers POST to `/api/aisensy-webhook` directly. The contract above is
already what they send, so the switch is just "point their webhook URL at
the same endpoint."

Until then, the custom forwarder is the bridge.
