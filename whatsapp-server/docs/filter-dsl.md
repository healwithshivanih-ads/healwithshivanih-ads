# Filter DSL

Status: locked, v0.1

One JSON tree format used by four subsystems:
- Segment definitions (`segments.filter`)
- Ad-hoc broadcast audiences (`broadcasts.audience_filter`)
- AI policy scopes (`ai_policies.scope_filter`)
- Flow triggers (`flows.trigger.filter`, when flows ship)

One language, one evaluator, four consumers.

## 1. Shape

A filter is a JSON tree. Internal nodes are logical operators (`and`, `or`,
`not`). Leaves are typed conditions.

```json
{
  "and": [
    { "has_tag": "cortisol-lead" },
    { "opted_in": true },
    { "not": { "has_tag": "do-not-contact" } }
  ]
}
```

Three logical operators:

| Operator | Shape | Meaning |
|---|---|---|
| `and` | `{ "and": [c1, c2, …] }` | All children must match |
| `or` | `{ "or": [c1, c2, …] }` | Any child matches |
| `not` | `{ "not": <condition> }` | Negate the inner condition |

`and: []` and `or: []` both match nothing. Fail closed.

## 2. Conditions

### Identity & reachability

```json
{ "has_identity": "whatsapp" }
{ "has_identity": ["whatsapp", "email"] }       // OR (has any)
{ "primary_channel": "whatsapp" }
{ "phone_country_code": "91" }
```

### Tags

```json
{ "has_tag": "cortisol-lead" }
{ "has_tag": ["cortisol-lead", "booked-call"] }  // OR (any)
{ "has_all_tags": ["cortisol-lead", "mumbai"] }  // AND (all)
{ "has_no_tags": ["unsubscribed", "vip"] }       // none of these
```

### Compliance & subscription

```json
{ "opted_in": true }
{ "opt_in_status": "pending" }
{ "subscribed_on_channel": "whatsapp" }
{ "on_suppression_list": false }
{ "suppressed_for_reason": "unsubscribed" }
```

### Profile

```json
{ "city": "Mumbai" }                              // case-insensitive equality
{ "city_in": ["Mumbai", "Pune", "Bangalore"] }
{ "country": "IN" }
{ "locale_starts_with": "en" }
{ "name_contains": "shivani" }                    // case-insensitive substring
{ "field_equals": { "path": "metadata.RequestedSpokenLanguage", "value": "Hindi" } }
{ "field_exists": "metadata.RegisteredOn" }
```

`field_equals` and `field_exists` are the escape hatch for Wix custom fields
and anything else we forgot. Dotted JSON paths.

### Time & activity

Time conditions accept either an **ISO timestamp** or a **relative spec**
like `"30 days ago"`, `"7 days from now"`, `"24 hours ago"`. Relative specs
parsed at evaluation time, not save time.

```json
{ "last_inbound_before": "30 days ago" }          // dormant
{ "last_inbound_after": "7 days ago" }            // recently active
{ "last_outbound_before": "14 days ago" }
{ "no_message_in_last": "30 days" }
{ "created_after": "2026-01-01" }
{ "created_before": "30 days ago" }
{ "appointment_within": "next 7 days" }
{ "appointment_within": "last 30 days" }
{ "no_appointment_ever": true }
```

### Broadcast history

```json
{ "received_broadcast_in_last": "14 days" }       // fatigue check
{ "received_broadcast": "<broadcast_id>" }
{ "did_not_receive_broadcast": "<broadcast_id>" }
{ "replied_to_broadcast": "<broadcast_id>" }
{ "broadcast_count_in_last": { "days": 7, "min": 1, "max": 3 } }
```

### Flow membership (for v1.5; conditions exist in v1)

```json
{ "in_active_flow": "cortisol-funnel-v1" }
{ "completed_flow": "cortisol-funnel-v1" }
{ "in_any_active_flow": true }
```

### Not supported: raw SQL escape hatch

`{ "sql": "..." }` is deliberately NOT supported. Every condition is
structured. If you need something the DSL can't express, we add a typed
condition. Non-negotiable: keeps the UI buildable and segments safe.

## 3. Worked examples

### Warm cortisol leads in Mumbai, not messaged in 2 weeks

```json
{
  "and": [
    { "has_tag": "cortisol-lead" },
    { "city_in": ["Mumbai", "Pune"] },
    { "has_identity": "whatsapp" },
    { "opted_in": true },
    { "on_suppression_list": false },
    { "no_message_in_last": "14 days" },
    { "not": { "in_any_active_flow": true } }
  ]
}
```

### Got last broadcast but didn't reply

```json
{
  "and": [
    { "received_broadcast": "b_abc123" },
    { "not": { "replied_to_broadcast": "b_abc123" } }
  ]
}
```

### Hindi speakers never broadcast to, opted in

```json
{
  "and": [
    { "field_equals": { "path": "metadata.RequestedSpokenLanguage", "value": "Hindi" } },
    { "opted_in": true },
    { "not": { "received_broadcast_in_last": "365 days" } }
  ]
}
```

### AI policy: auto-reply to warm leads, draft for everyone else

Two policies, ranked by priority:

```json
// priority 10 — auto for warm leads
{
  "and": [
    { "has_tag": "cortisol-lead" },
    { "opted_in": true },
    { "not": { "has_tag": "vip" } }
  ]
}
// priority 0 — catch-all, draft
{ "opted_in": true }
```

## 4. The evaluator

```
evaluateFilter(filter, workspace_id, options) →
  { contact_ids: uuid[], count: number, breakdown: {…}, sample: contact[] }
```

The JSON tree compiles to one SQL query against contacts joined with
contact_tags, contact_identities, messages, broadcast_recipients,
suppression_list, appointments, flow_runs. Each condition emits a SQL
fragment; logical operators wrap with AND/OR/NOT. No N+1.

### Three operating modes

| Mode | Output | Use case |
|---|---|---|
| Count only | `count` | Live count as user builds filter |
| Preview | count + breakdown (by channel/tag) + 10 random samples | Pre-send sanity check |
| Materialize | All matching `contact_id`s | Actual broadcast send |

Count mode targets <100ms even at 100k contacts. The denormalized
`contacts.last_*` columns avoid scanning `messages` for common filters.

## 5. Suppression layering

The filter expresses **eligibility**. Suppression expresses **don't send right
now**. They stack at send time:

```
contact_ids = evaluateFilter(broadcast.filter)
           − contacts on hard suppression (workspace-wide)
           − contacts violating soft suppression (workspace policy)
           − contacts in broadcast.exclude_contact_ids
           = final_recipient_ids
```

Each removed contact gets a `broadcast_recipients` row with `status='skipped'`
and a `suppression_reason`. Skipped is logged, not hidden.

## 6. UI affordances

The DSL is the data; the UI is a visual rule builder. It knows what arguments
each condition takes (typed dropdowns, not freeform). Adding a new condition
to the DSL = adding metadata for the UI + a compiler function for the
evaluator. Touchpoints are co-located.

**"Build with AI" button** (in v1): coach types "everyone in Pune tagged
cortisol-lead who hasn't booked yet" → Claude generates the filter JSON →
visual builder pre-fills with it → coach confirms.

## 7. Design judgements locked in

| Judgement | Choice |
|---|---|
| Time strings | Relative ("30 days ago") parsed at evaluation. A saved segment means the same thing in March as in June. |
| Identity match semantics | `has_identity` matches if ANY identity matches the channel. Use `primary_channel` for primary-only. |
| Format | JSON tree, not string expression language. UI-buildable, AI-emittable, parser-bug-free. |
| Build with AI | In v1, not v1.5. |
