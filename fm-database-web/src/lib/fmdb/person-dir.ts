import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getPlansRoot } from "./paths";

/**
 * Resolve a person's directory, wherever they currently live.
 *
 * Signed-up clients sit in `clients/<id>/`. People who never signed up and have
 * gone quiet are parked in `prospects/<id>/` by `fmdb prospects-sweep`, so they
 * stop skewing roster counts and burning cron cycles. Parking is a MOVE, not a
 * delete — so anything that reads a person's own data by id must resolve both,
 * or their page 404s and the record looks lost.
 *
 * Mirrors `fmdb.plan.storage.client_dir` on the Python side. Keep them in
 * lockstep.
 *
 * Scope note: this is deliberately NOT applied to every `clients/<id>/...` path
 * in the app. Most of them (grocery lists, meal plans, lab orders, weekly
 * menus, dirty-genes reports) presuppose a published plan, which a parked
 * person by definition does not have — those returning empty is correct. It IS
 * applied wherever a parked person can still legitimately have data: their
 * record, sessions, photo, and uploaded files.
 *
 * Sync (not async) so it drops into existing path expressions without making
 * their callers async. The stat is a cheap cached dirent lookup.
 *
 * Lives in its own `server-only` module rather than in `paths.ts` because
 * paths.ts is pulled into CLIENT bundles (via lab-coverage.ts →
 * lab-recommend-card.tsx). A `node:fs` import there fails the Turbopack build
 * with "the chunking context does not support external modules" — and tsc does
 * not catch it, because it is a bundling error, not a type error.
 */
export function resolvePersonDir(id: string): string {
  const root = getPlansRoot();
  const active = path.join(root, "clients", id);
  try {
    if (fs.statSync(active).isDirectory()) return active;
  } catch {
    // not there — fall through to the parked location
  }
  const parked = path.join(root, "prospects", id);
  try {
    if (fs.statSync(parked).isDirectory()) return parked;
  } catch {
    // neither exists — hand back the active path so creation is unaffected
  }
  return active;
}
