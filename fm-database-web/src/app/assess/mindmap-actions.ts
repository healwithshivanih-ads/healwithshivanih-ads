"use server";

import {
  findMindMapPathways,
  type MindMapPathwayResult,
} from "@/lib/fmdb/loader-extras";
import { runShim } from "@/lib/fmdb/shim";

export async function getMindMapPathways(
  symptomSlugs: string[],
  topicSlugs: string[],
  clientSex?: string | null,
): Promise<MindMapPathwayResult[]> {
  return findMindMapPathways(symptomSlugs, topicSlugs, clientSex);
}

export interface SubgraphReadiness {
  ok: boolean;
  counts?: {
    topics: number;
    mechanisms: number;
    symptoms: number;
    supplements: number;
    claims: number;
    cooking_adjustments: number;
    home_remedies: number;
    protocols: number;
  };
  matched_symptoms_in_catalogue?: number;
  matched_topics_in_catalogue?: number;
  unmatched_symptoms?: string[];
  unmatched_topics?: string[];
  verdict?: "rich" | "moderate" | "thin" | "empty";
  error?: string;
}

/** Cheap check (no API call) of what the AI's subgraph will contain
 *  if the coach hits Analyze right now. Used to render a pre-flight
 *  readiness banner. */
export async function peekSubgraphAction(
  symptoms: string[],
  topics: string[],
): Promise<SubgraphReadiness> {
  try {
    const result = (await runShim("peek-subgraph.py", { symptoms, topics }, 15_000)) as SubgraphReadiness;
    return result;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
