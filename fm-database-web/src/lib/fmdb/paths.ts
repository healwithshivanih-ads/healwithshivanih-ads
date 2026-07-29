import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Resolve the absolute path to the catalogue YAML root.
 * Defaults to ../fm-database/data relative to the Next app cwd,
 * overridable via FMDB_CATALOGUE_DIR.
 */
export function getCataloguePath(): string {
  const env = process.env.FMDB_CATALOGUE_DIR;
  if (env && env.length > 0) return path.resolve(env);
  return path.resolve(process.cwd(), "..", "fm-database", "data");
}

/**
 * Resolve the absolute path to the plans + clients root (PHI).
 * Defaults to ~/fm-plans, overridable via FMDB_PLANS_DIR.
 */
export function getPlansRoot(): string {
  const env = process.env.FMDB_PLANS_DIR;
  if (env && env.length > 0) return path.resolve(env);
  return path.join(os.homedir(), "fm-plans");
}

/**
 * Resolve a person's directory, wherever they currently live.
 *
 * Signed-up clients sit in `clients/<id>/`. People who never signed up and have
 * gone quiet are parked in `prospects/<id>/` by `fmdb prospects-sweep`, so they
 * stop skewing roster counts and burning cron cycles. Parking is a MOVE, not a
 * delete — so anything that reads a person's own data by id must resolve both.
 *
 * Mirrors `fmdb.plan.storage.client_dir` on the Python side. Keep them in
 * lockstep.
 *
 * Scope note: this is deliberately NOT applied to every `clients/<id>/...` path
 * in the app. Most of them (grocery lists, meal plans, lab orders, weekly
 * menus, dirty-genes reports) presuppose a published plan, which a parked
 * person by definition does not have — those returning empty is correct.
 * It IS applied wherever a parked person can still legitimately have data:
 * their record, sessions, photo, and uploaded files.
 *
 * Sync (not async) so it can be dropped into existing path expressions without
 * making their callers async. The stat is a cheap cached dirent lookup.
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

/**
 * Resolve the absolute path to the resources toolkit root.
 * Defaults to ~/fm-resources, overridable via FMDB_RESOURCES_DIR.
 */
export function getResourcesRoot(): string {
  const env = process.env.FMDB_RESOURCES_DIR;
  if (env && env.length > 0) return path.resolve(env);
  return path.join(os.homedir(), "fm-resources");
}
