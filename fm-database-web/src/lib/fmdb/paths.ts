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
 * Resolve the absolute path to the resources toolkit root.
 * Defaults to ~/fm-resources, overridable via FMDB_RESOURCES_DIR.
 */
export function getResourcesRoot(): string {
  const env = process.env.FMDB_RESOURCES_DIR;
  if (env && env.length > 0) return path.resolve(env);
  return path.join(os.homedir(), "fm-resources");
}
