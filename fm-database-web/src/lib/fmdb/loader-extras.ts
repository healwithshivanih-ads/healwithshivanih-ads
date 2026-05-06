import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getCataloguePath, getPlansRoot, getResourcesRoot } from "./paths";
import type { Client, MindMap } from "./types";

async function readYaml<T>(absPath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(absPath, "utf-8");
    return yaml.load(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function listYamlFiles(dir: string): Promise<string[]> {
  try {
    const names = await fs.readdir(dir);
    return names
      .filter((n) => n.endsWith(".yaml") || n.endsWith(".yml"))
      .map((n) => path.join(dir, n));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

// ---- Resources ----

export interface Resource {
  slug: string;
  title?: string;
  kind?: string;
  audience?: string;
  description?: string;
  file_path?: string | null;
  url?: string | null;
  text?: string | null;
  related_topics?: string[];
  related_mechanisms?: string[];
  related_supplements?: string[];
  related_symptoms?: string[];
  tags?: string[];
  shareable?: boolean;
  license_notes?: string;
  size_bytes?: number;
  mime_type?: string;
  version?: number;
  status?: string;
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  [key: string]: unknown;
}

export async function loadAllResources(): Promise<Resource[]> {
  const dir = path.join(getResourcesRoot(), "resources");
  const files = await listYamlFiles(dir);
  const out: Resource[] = [];
  for (const f of files) {
    const r = await readYaml<Resource>(f);
    if (r) out.push(r);
  }
  return out;
}

export async function loadResourceBySlug(slug: string): Promise<Resource | null> {
  const dir = path.join(getResourcesRoot(), "resources");
  return readYaml<Resource>(path.join(dir, `${slug}.yaml`));
}

// ---- Clients (extras: detail + sessions) ----

export interface ClientWithMeta extends Client {
  display_name?: string;
  current_medications?: string[];
  known_allergies?: string[];
  created_at?: string;
  updated_at?: string;
  status?: string;
}

export async function loadClientById(id: string): Promise<ClientWithMeta | null> {
  const root = getPlansRoot();
  const dirPath = path.join(root, "clients", id, "client.yaml");
  const data = await readYaml<ClientWithMeta>(dirPath);
  if (data) return data;
  // legacy flat
  return readYaml<ClientWithMeta>(path.join(root, "clients", `${id}.yaml`));
}

export interface ClientSession {
  session_id?: string;
  date?: string;
  presenting_complaints?: string;
  selected_symptoms?: string[];
  selected_topics?: string[];
  generated_plan_slug?: string | null;
  drivers_identified?: unknown[];
  supplements_suggested?: unknown[];
  synthesis_notes?: string;
  [key: string]: unknown;
}

export async function loadClientSessions(id: string): Promise<ClientSession[]> {
  const root = getPlansRoot();
  const dir = path.join(root, "clients", id, "sessions");
  const files = await listYamlFiles(dir);
  const out: ClientSession[] = [];
  for (const f of files) {
    const data = await readYaml<ClientSession>(f);
    if (data) {
      out.push({ ...data, _file: f } as ClientSession);
    }
  }
  // Sort newest first by filename (which encodes date)
  return out.sort((a, b) =>
    String((b as { _file?: string })._file ?? "").localeCompare(
      String((a as { _file?: string })._file ?? "")
    )
  );
}

// ---- MindMaps ----

export interface MindMapNode {
  label: string;
  children?: MindMapNode[];
  linked_kind?: string | null;
  linked_slug?: string | null;
  notes?: string;
}

export interface MindMapFull extends MindMap {
  tree?: MindMapNode[];
}

export async function loadAllMindMaps(): Promise<MindMapFull[]> {
  const dir = path.join(getCataloguePath(), "mindmaps");
  const files = await listYamlFiles(dir);
  const out: MindMapFull[] = [];
  for (const f of files) {
    const data = await readYaml<MindMapFull>(f);
    if (data) out.push(data);
  }
  return out;
}

export async function loadMindMapBySlug(slug: string): Promise<MindMapFull | null> {
  const dir = path.join(getCataloguePath(), "mindmaps");
  return readYaml<MindMapFull>(path.join(dir, `${slug}.yaml`));
}

export function countMindMapNodes(tree: MindMapNode[] | undefined): {
  total: number;
  linked: number;
} {
  let total = 0;
  let linked = 0;
  function walk(nodes: MindMapNode[] | undefined) {
    if (!nodes) return;
    for (const n of nodes) {
      total++;
      if (n.linked_slug) linked++;
      if (n.children && n.children.length) walk(n.children);
    }
  }
  walk(tree);
  return { total, linked };
}

// ---- Backlog ----

export interface BacklogItem {
  id: string;
  kind: string;
  name: string;
  why?: string;
  status: "open" | "added" | "rejected" | string;
  suggested_by?: string;
  created_at?: string;
  last_seen_at?: string;
  seen_count?: number;
  session_refs?: unknown[];
  status_changed_at?: string;
  status_note?: string;
  extra?: Record<string, unknown>;
}

export async function loadBacklog(): Promise<BacklogItem[]> {
  const file = path.join(getCataloguePath(), "_backlog.yaml");
  try {
    const raw = await fs.readFile(file, "utf-8");
    const data = yaml.load(raw);
    if (Array.isArray(data)) return data as BacklogItem[];
    return [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
