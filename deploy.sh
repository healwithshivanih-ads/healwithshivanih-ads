#!/bin/bash
# deploy.sh — Push everything to a DigitalOcean server and set up cron
#
# Usage:
#   bash deploy.sh <server-ip>
#
# Example:
#   bash deploy.sh 143.198.45.12
#
# Requirements on your Mac:
#   - SSH key already added to the server (DigitalOcean does this automatically)

set -e

SERVER_IP="$1"
if [ -z "$SERVER_IP" ]; then
  echo "Usage: bash deploy.sh <server-ip>"
  exit 1
fi

REMOTE_DIR="/root/meta_ads"
SSH="ssh -o StrictHostKeyChecking=no root@$SERVER_IP"

echo ""
echo "============================================================"
echo "  Heal With Shivanih — Cloud Deploy"
echo "  Server: $SERVER_IP"
echo "============================================================"

# ── 1. Copy files ─────────────────────────────────────────────────────────────
echo ""
echo "▶  Copying files to server..."
ssh -o StrictHostKeyChecking=no root@$SERVER_IP "mkdir -p $REMOTE_DIR"

scp -o StrictHostKeyChecking=no \
  lead_responder.py \
  google_form_responder.py \
  send_reminders.py \
  .env \
  responder.env \
  requirements.txt \
  root@$SERVER_IP:$REMOTE_DIR/

# Copy leads DB if it exists and has data
if [ -f leads.db ]; then
  echo "   Copying leads.db (existing leads)..."
  scp -o StrictHostKeyChecking=no leads.db root@$SERVER_IP:$REMOTE_DIR/
fi

echo "   ✅ Files copied"

# ── 2. Install Python + dependencies ─────────────────────────────────────────
echo ""
echo "▶  Installing Python dependencies on server..."
$SSH << 'ENDSSH'
apt-get update -qq
apt-get install -y -qq python3 python3-pip
pip3 install -q -r /root/meta_ads/requirements.txt
echo "   ✅ Dependencies installed"
ENDSSH

# ── 3. Set up cron jobs ───────────────────────────────────────────────────────
echo ""
echo "▶  Setting up cron jobs (UTC times)..."
$SSH << 'ENDSSH'
# Write crontab
crontab - << 'CRON'
# Lead responder — poll every 5 min
*/5 * * * * cd /root/meta_ads && python3 lead_responder.py --once >> /root/meta_ads/leads.log 2>&1

# Google Form responder — poll every 5 min
*/5 * * * * cd /root/meta_ads && python3 google_form_responder.py --once >> /root/meta_ads/leads.log 2>&1

# 26 April reminders (IST → UTC: IST = UTC+5:30)
# Morning 8:00 AM IST = 2:30 AM UTC
30 2 26 4 * cd /root/meta_ads && python3 send_reminders.py --morning >> /root/meta_ads/reminders.log 2>&1

# 1 hour before 5:00 PM IST = 11:30 AM UTC
30 11 26 4 * cd /root/meta_ads && python3 send_reminders.py --hour-before >> /root/meta_ads/reminders.log 2>&1

# 1 min before 5:59 PM IST = 12:29 PM UTC
29 12 26 4 * cd /root/meta_ads && python3 send_reminders.py --final >> /root/meta_ads/reminders.log 2>&1
CRON
echo "   ✅ Cron jobs installed"
crontab -l
ENDSSH

# ── 4. Test it works ──────────────────────────────────────────────────────────
echo ""
echo "▶  Running quick test on server..."
$SSH "cd /root/meta_ads && python3 lead_responder.py --once 2>&1 | tail -5"

echo ""
echo "============================================================"
echo "  ✅ Deploy complete!"
echo ""
echo "  Useful commands:"
echo "  ssh root@$SERVER_IP                          # log in"
echo "  ssh root@$SERVER_IP 'tail -f /root/meta_ads/leads.log'     # watch leads"
echo "  ssh root@$SERVER_IP 'tail -f /root/meta_ads/reminders.log' # watch reminders"
echo "  bash deploy.sh $SERVER_IP                    # re-deploy after any changes"
echo "============================================================"
echo ""
