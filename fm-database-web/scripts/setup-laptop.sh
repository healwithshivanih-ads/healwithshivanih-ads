#!/usr/bin/env bash
# Laptop setup helper for FM Coach app.
# Run this from fm-database-web/ on the laptop the first time you deploy v0.63.
#
#   cd ~/code/healwithshivanih-ads/fm-database-web
#   bash scripts/setup-laptop.sh
#
# It will:
#   1. Walk you through filling in .env.local (email + AiSensy API key)
#   2. npm install + npm run build
#   3. Restart PM2 with the new env vars

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ENV_FILE="$ROOT/.env.local"

echo "FM Coach — laptop setup"
echo "======================="
echo "Repo: $ROOT"
echo

# ── Step 1: .env.local ────────────────────────────────────────────────────────

if [[ -f "$ENV_FILE" ]]; then
  echo "✓ .env.local already exists — skipping env setup."
  echo "  (edit it manually if you need to change keys)"
else
  echo "→ Creating .env.local"
  echo
  echo "Gmail (for 'Send to client' email)"
  echo "Get an App Password at https://myaccount.google.com/apppasswords"
  read -rp "  GMAIL_USER (your gmail address): " gmail_user
  read -rsp "  GMAIL_APP_PASSWORD (16-char app password): " gmail_pw
  echo
  echo
  echo "AiSensy (WhatsApp outbound — broadcast + per-client send)"
  echo "Find your API key in AiSensy → Settings → API"
  read -rp "  AISENSY_API_KEY (paste, or blank to skip): " aisensy_key
  echo

  {
    echo "GMAIL_USER=$gmail_user"
    echo "GMAIL_APP_PASSWORD=$gmail_pw"
    if [[ -n "$aisensy_key" ]]; then
      echo "AISENSY_API_KEY=$aisensy_key"
    fi
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "✓ Wrote $ENV_FILE (chmod 600)"
fi

# ── Step 2: install + build ───────────────────────────────────────────────────

echo
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
