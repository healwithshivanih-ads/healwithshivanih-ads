#!/usr/bin/env bash
# Ready-to-run curl examples. Assumes server is running on localhost:3000.
# Set ADMIN_KEY before running admin examples.
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
ADMIN_KEY="${ADMIN_API_KEY:-changeme}"
VERIFY_TOKEN="${VERIFY_TOKEN:-pick-any-long-random-string}"
SAMPLES="$(dirname "$0")/sample-payloads"

echo "=== 1. Health check ==="
curl -s "$BASE/healthz" | jq . || curl -s "$BASE/healthz"
echo

echo "=== 2. Meta webhook verification (GET) ==="
curl -s "$BASE/webhook?hub.mode=subscribe&hub.verify_token=$VERIFY_TOKEN&hub.challenge=test-challenge-1234"
echo

echo "=== 3. POST /webhook — incoming text (signature will be invalid in dev — server still logs) ==="
curl -s -X POST "$BASE/webhook" \
  -H 'Content-Type: application/json' \
  --data-binary @"$SAMPLES/incoming-text.json"
echo

echo "=== 4. POST /webhook — button reply ==="
curl -s -X POST "$BASE/webhook" \
  -H 'Content-Type: application/json' \
  --data-binary @"$SAMPLES/button-reply.json"
echo

echo "=== 5. POST /webhook — status delivered ==="
curl -s -X POST "$BASE/webhook" \
  -H 'Content-Type: application/json' \
  --data-binary @"$SAMPLES/status-delivered.json"
echo

echo "=== 6. POST /webhooks/meta-ad — CTWA lead ==="
curl -s -X POST "$BASE/webhooks/meta-ad" \
  -H 'Content-Type: application/json' \
  --data-binary @"$SAMPLES/meta-ad-lead.json"
echo

echo "=== 7. POST /webhooks/calendly — invitee.created ==="
curl -s -X POST "$BASE/webhooks/calendly" \
  -H 'Content-Type: application/json' \
  --data-binary @"$SAMPLES/calendly-invitee-created.json"
echo

echo "=== 8. POST /webhooks/wix-booking ==="
curl -s -X POST "$BASE/webhooks/wix-booking" \
  -H 'Content-Type: application/json' \
  --data-binary @"$SAMPLES/wix-booking-created.json"
echo

echo "=== 9. POST /webhooks/form — generic form intake ==="
curl -s -X POST "$BASE/webhooks/form" \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+919876543210","name":"Priya","tags":["follow-up-due"],"source":"website"}'
echo

echo "=== 10. GET /api/stats ==="
curl -s "$BASE/api/stats" -H "x-api-key: $ADMIN_KEY" | jq . || true
echo

echo "=== 11. GET /api/contacts ==="
curl -s "$BASE/api/contacts?limit=10" -H "x-api-key: $ADMIN_KEY" | jq . || true
echo

echo "=== 12. POST /api/send-template (will fail without real Meta token + approved template) ==="
echo 'curl -X POST "$BASE/api/send-template" -H "x-api-key: $ADMIN_KEY" -H "Content-Type: application/json" -d {...}'
echo
