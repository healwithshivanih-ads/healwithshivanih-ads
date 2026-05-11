"use server";

import {
  findMindMapPathways,
  type MindMapPathwayResult,
} from "@/lib/fmdb/loader-extras";

export async function getMindMapPathways(
  symptomSlugs: string[],
  topicSlugs: string[],
  clientSex?: string | null,
): Promise<MindMapPathwayResult[]> {
  return findMindMapPathways(symptomSlugs, topicSlugs, clientSex);
}
