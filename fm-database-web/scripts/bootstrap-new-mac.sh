#!/usr/bin/env bash
# Bootstrap FM Coach on a fresh Mac (mini or laptop).
# Handles everything setup-laptop.sh assumes is already done:
#   • Homebrew prerequisites
#   • git clone (skipped if you're already in the repo)
#   • Python venv + pip install for fm-database
#   • Then hands off to setup-laptop.sh for .env / npm / pm2
#
# Run from anywhere:
#   curl -fsSL https://raw.githubusercontent.com/.../bootstrap-new-mac.sh | bash
# Or, more typically, once you've git cloned:
#   cd ~/code/healwithshivanih-ads/fm-database-web
#   bash scripts/bootstrap-new-mac.sh
#
# Idempotent — safe to re-run.
#
# AFTER this script finishes, you still need to migrate ~/fm-plans/ from
# the old machine (client data is NOT in git — see end-of-script notes).

set -euo pipefail

echo "FM Coach — new-Mac bootstrap"
echo "============================"
echo

# ── Step 0: prerequisites ─────────────────────────────────────────────────────

need() {
  # Print install hint for a missing CLI binary.
  local cmd="$1" install_hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "✗ $cmd not found"
    echo "  → $install_hint"
    return 1
  fi
  echo "  ✓ $cmd $(command -v "$cmd")"
}

echo "→ Checking prerequisites"
MISSING=0
need brew    "Install Homebrew: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"" || MISSING=1
need git     "brew install git"     || MISSING=1
need python3 "brew install python@3.12" || MISSING=1
need node    "brew install node@20" || MISSING=1
need npm     "brew install node@20" || MISSING=1

if [[ $MISSING -ne 0 ]]; then
  echo
  echo "Install the missing tools above, then re-run this script."
  exit 1
fi
echo

# ── Step 1: locate or clone the repo ─────────────────────────────────────────

# If we were run from inside the repo (typical case), use that. Otherwise
# clone into ~/code/healwithshivanih-ads.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$SCRIPT_DIR/../../README.md" && -d "$SCRIPT_DIR/../../fm-database" ]]; then
  REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
  echo "→ Using existing repo at $REPO"
else
  REPO_PARENT="$HOME/code"
  REPO="$REPO_PARENT/healwithshivanih-ads"
  if [[ -d "$REPO" ]]; then
    echo "→ Repo already at $REPO — pulling latest"
    (cd "$REPO" && git pull --ff-only) || true
  else
    echo "→ Cloning repo into $REPO"
    mkdir -p "$REPO_PARENT"
    echo "  (you'll need a GitHub URL — paste it when prompted)"
    read -rp "  Repo URL: " REPO_URL
    if [[ -z "$REPO_URL" ]]; then
      echo "✗ No URL supplied — aborting."
      exit 1
    fi
    git clone "$REPO_URL" "$REPO"
  fi
fi
echo

# ── Step 2: Python venv + fmdb install ───────────────────────────────────────

FMDB="$REPO/fm-database"
VENV="$FMDB/.venv"

echo "→ Setting up Python venv at $VENV"
if [[ ! -d "$VENV" ]]; then
  python3 -m venv "$VENV"
  echo "  ✓ venv created"
else
  echo "  ✓ venv exists — reusing"
fi

# shellcheck disable=SC1091
"$VENV/bin/pip" install --upgrade pip --quiet
echo "→ Installing fmdb Python dependencies"
"$VENV/bin/pip" install -r "$FMDB/requirements.txt" --quiet
echo "  ✓ dependencies installed"
echo

# ── Step 3: fm-database/.env (Anthropic API key for Python shims) ────────────

FMDB_ENV="$FMDB/.env"
if [[ ! -f "$FMDB_ENV" ]] || ! grep -q '^ANTHROPIC_API_KEY=' "$FMDB_ENV" 2>/dev/null; then
  echo "→ fm-database/.env not configured"
  echo "  This file holds the Anthropic API key used by the Python shims"
  echo "  (assess.py, render-client-letter.py, etc.)."
  read -rsp "  ANTHROPIC_API_KEY (paste — input hidden): " ANTHROPIC_KEY
  echo
  if [[ -n "$ANTHROPIC_KEY" ]]; then
    printf 'ANTHROPIC_API_KEY=%s\nFMDB_EXTRACTOR=anthropic\nFMDB_USER=shivani\n' "$ANTHROPIC_KEY" > "$FMDB_ENV"
    chmod 600 "$FMDB_ENV"
    echo "  ✓ fm-database/.env written"
  else
    echo "  ! skipped — AI calls will fail until you add ANTHROPIC_API_KEY to $FMDB_ENV"
  fi
else
  echo "  ✓ fm-database/.env already configured"
fi
echo

# ── Step 4: hand off to setup-laptop.sh (npm + build + pm2 + .env.local) ─────

echo "→ Running setup-laptop.sh (npm install + build + pm2 start)"
echo "  This will prompt you for Gmail + WhatsApp server keys if not already set."
echo
bash "$REPO/fm-database-web/scripts/setup-laptop.sh"

# ── Step 5: data migration reminder ──────────────────────────────────────────

cat <<EOF

══════════════════════════════════════════════════════════════════════
 ✓ App installed at $REPO
 ✓ Server running on http://localhost:3002

 ★ NEXT — migrate your client data from the old machine ★

 Client records, plans, sessions, uploaded files, and AI usage logs
 are NOT in git (they're PHI). They live in ~/fm-plans/ on the old
 laptop. To copy them over:

   On the OLD machine (find its IP or use Tailscale / a USB drive):
     rsync -av --progress ~/fm-plans/ <username>@<new-mac>:~/fm-plans/

   OR with a USB drive:
     # on old: rsync -av ~/fm-plans/ /Volumes/USB/fm-plans/
     # on new: rsync -av /Volumes/USB/fm-plans/ ~/fm-plans/

   Don't forget message templates + supplement links + custom plans:
     ~/fm-plans/message_templates.yaml
     ~/fm-plans/supplement_links.yaml
     ~/fm-plans/custom_templates/

 For inbound WhatsApp webhooks (AiSensy is decommissioned — we use
 the self-hosted WhatsApp Cloud API server on Fly):
   WHATSAPP_SERVER_URL and WHATSAPP_SERVER_API_KEY are the relevant
   env vars. Webhooks are received by the Fly app, not this machine.

══════════════════════════════════════════════════════════════════════
EOF
