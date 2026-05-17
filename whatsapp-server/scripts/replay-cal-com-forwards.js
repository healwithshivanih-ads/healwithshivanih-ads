#!/usr/bin/env node
// Replay cal.com booking forwards to fm-coach for any appointments that
// weren't acknowledged. Catches two cases:
//   1. Bookings that landed before the forwarder code shipped
//   2. Bookings whose forward POST failed at the time (e.g. fm-coach
//      receiver was unreachable — Tailscale Funnel down, redeploy, etc.)
//
// Marker is appointments.metadata.fm_coach_forwarded_at (set on successful
// forward). Replay skips any appointment that already has the marker.
//
// Usage (from inside Fly machine):
//   flyctl ssh console -a whatsapp-server-shivani -C 'cd /app && node scripts/replay-cal-com-forwards.js'
//
// Flags:
//   --since-days N   only consider appointments created in last N days (default 30)
//   --limit N        cap on candidates pulled (default 100)
//   --dry-run        report what would be sent without firing
//
// Exits non-zero if any forwards failed.

import { replayUnforwardedBookings } from '../src/services/forwarder/cal-com-forwarder.js';

function parseFlag(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return fallback;
  const v = process.argv[idx + 1];
  return v === undefined ? fallback : Number(v);
}

const sinceDays = parseFlag('--since-days', 30);
const limit = parseFlag('--limit', 100);
const dryRun = process.argv.includes('--dry-run');

console.log(`[replay] sinceDays=${sinceDays} limit=${limit} dryRun=${dryRun}`);

try {
  const result = await replayUnforwardedBookings({ sinceDays, limit, dryRun });
  console.log(`[replay] considered: ${result.considered}`);
  console.log(`[replay] forwarded:  ${result.forwarded}`);
  console.log(`[replay] failed:     ${result.failed}`);
  console.log(`[replay] skipped:    ${result.skipped}`);
  if (result.items.length) {
    console.log('[replay] per-item:');
    for (const it of result.items) {
      console.log(`  ${it.status.padEnd(10)} ${it.uid || ''} ${it.error || it.reason || ''}`);
    }
  }
  process.exit(result.failed > 0 ? 1 : 0);
} catch (err) {
  console.error('[replay] error:', err.message);
  process.exit(2);
}
