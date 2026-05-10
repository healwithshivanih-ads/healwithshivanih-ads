#!/usr/bin/env bash
# Laptop setup helper for FM Coach app.
# Run this from fm-database-web/ on the laptop the first time you deploy v0.63.
#
#   cd ~/code/healwithshivanih-ads/fm-database-web
#   bash scripts/setup-laptop.sh
#
# Idempotent — re-runnable. Reads existing .env.local, only prompts for
# missing keys, then npm install + build + pm2 restart.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ENV_FILE="$ROOT/.env.local"

echo "FM Coach — laptop setup"
echo "======================="
echo "Repo: $ROOT"
echo

# ── Step 1: read existing .env.local (if any) ─────────────────────────────────

touch "$ENV_FILE"
chmod 600 "$ENV_FILE" 2>/dev/null || true

read_key() {
  # Read the value of a key from .env.local (empty if missing or blank).
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d'=' -f2- || true
}

set_key() {
  # Write or overwrite a key=value line in .env.local.
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v -E "^${key}=" "$ENV_FILE" > "$tmp" 2>/dev/null || true
  echo "${key}=${value}" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

prompt_if_missing() {
  # Args: KEY  prompt_label  [secret]  [hint]
  local key="$1" label="$2" secret="${3:-}" hint="${4:-}"
  local current
  current="$(read_key "$key")"
  if [[ -n "$current" ]]; then
    local masked
    if [[ "$secret" == "secret" ]]; then
      masked="$(printf '%s' "$current" | sed 's/./*/g' | head -c 8)…"
    else
      masked="$current"
    fi
    echo "  ✓ $key already set ($masked) — keeping"
    return
  fi
  if [[ -n "$hint" ]]; then echo "  $hint"; fi
  local value
  if [[ "$secret" == "secret" ]]; then
    read -rsp "  $label: " value; echo
  else
    read -rp "  $label: " value
  fi
  if [[ -n "$value" ]]; then
    set_key "$key" "$value"
    echo "  ✓ $key written"
  else
    echo "  · $key skipped (left unset)"
  fi
}

echo "→ Checking .env.local"
echo
echo "Gmail (for 'Send to client' email):"
prompt_if_missing GMAIL_USER          "GMAIL_USER (your gmail address)"        ""       "  Get an App Password at https://myaccount.google.com/apppasswords"
prompt_if_missing GMAIL_APP_PASSWORD  "GMAIL_APP_PASSWORD (16-char app pw)"    secret
echo
echo "AiSensy (WhatsApp outbound — broadcast + per-client send):"
prompt_if_missing AISENSY_API_KEY     "AISENSY_API_KEY (paste, or blank to skip)" ""    "  Find your API key in AiSensy → Settings → API"
echo

# ── Step 2: install + build ───────────────────────────────────────────────────

echo "→ npm install"
npm install
echo
echo "→ npm run build"
npm run build

# ── Step 3: PM2 restart with fresh env ────────────────────────────────────────

PM2="$ROOT/node_modules/.bin/pm2"
if [[ ! -x "$PM2" ]]; then
  echo "PM2 not found at $PM2 — installing locally"
  npm install pm2
fi

echo
echo "→ Restarting PM2 (delete + start so .env.local is re-read)"
"$PM2" delete fm-coach 2>/dev/null || true
"$PM2" start ecosystem.config.js
"$PM2" save || true

echo
echo "✓ Done. App is running on http://localhost:3002"
echo "  Logs: $PM2 logs fm-coach"
