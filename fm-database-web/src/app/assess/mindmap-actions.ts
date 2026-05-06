"use server";

import {
  findMindMapPathways,
  type MindMapPathwayResult,
} from "@/lib/fmdb/loader-extras";

export async function getMindMapPathways(
  symptomSlugs: string[],
  topicSlugs: string[]
): Promise<MindMapPathwayResult[]> {
  return findMindMapPathways(symptomSlugs, topicSlugs);
}
