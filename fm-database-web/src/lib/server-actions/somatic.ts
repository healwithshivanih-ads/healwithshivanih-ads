"use server";

/**
 * Chief-complaint somatic read — coach-side only.
 *
 * Deterministic and free: no API call. It resolves the client's own recorded
 * conditions against the catalogue, so the cost of showing it is a file read.
 */

import { runShim } from "@/lib/fmdb/shim";

export interface SomaticRoot {
  pattern: string;
  note: string;
}

export interface SomaticReadItem {
  condition: string;
  target_slug: string;
  display_name: string;
  sensitivity: "general" | "sensitive" | "coach_only" | string;
  /** coach_only_note is set — never auto-surface, whatever the client's depth */
  gated: boolean;
  /** safe to show unsupervised at the client's `full` depth */
  client_safe: boolean;
  themes: string[];
  roots: SomaticRoot[];
  reframe: string;
  inquiry_question: string;
  somatic_practice: string;
  differential_note: string;
}

export async function loadSomaticRead(
  clientId: string,
): Promise<{ ok: true; reads: SomaticReadItem[] } | { ok: false; error: string }> {
  if (!clientId) return { ok: false, error: "clientId required" };
  try {
    const out = (await runShim("somatic-read.py", { client_id: clientId })) as {
      ok?: boolean;
      reads?: SomaticReadItem[];
      error?: string;
    } | null;
    if (!out?.ok) return { ok: false, error: out?.error || "read failed" };
    return { ok: true, reads: out.reads ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
