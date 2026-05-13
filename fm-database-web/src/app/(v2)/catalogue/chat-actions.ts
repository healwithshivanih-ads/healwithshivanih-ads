"use server";

import { runShim } from "@/lib/fmdb/shim";
import {
  reclassifyEntityAction,
  type ReclassifyResult,
} from "./[kind]/[slug]/actions";

export interface CatalogueChatProposal {
  action: "move" | "merge" | "delete" | "noop";
  source_kind: string | null;
  source_slug: string | null;
  target_kind: string | null;
  merge_into_kind: string | null;
  merge_into_slug: string | null;
  reasoning: string;
  needs_clarification: boolean;
  clarification: string | null;
}

export interface CatalogueChatResult {
  ok: boolean;
  proposal?: CatalogueChatProposal;
  usage?: {
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: string | null;
}

/** Interpret a coach's natural-language catalogue command via Haiku.
 *  Returns a structured action proposal; the UI confirms then applies. */
export async function catalogueChatAction(input: {
  userMessage: string;
  dryRun?: boolean;
}): Promise<CatalogueChatResult> {
  try {
    const result = (await runShim(
      "catalogue-chat.py",
      { user_message: input.userMessage, dry_run: !!input.dryRun },
      45_000,
    )) as CatalogueChatResult;
    return result;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Apply a Haiku-proposed catalogue action. Re-uses reclassify-entity.py
 *  under the hood so policy + alias preservation stays in one place. */
export async function applyCatalogueProposalAction(
  proposal: CatalogueChatProposal,
  createStub: boolean = false,
): Promise<ReclassifyResult> {
  if (proposal.action === "noop" || proposal.needs_clarification) {
    return { ok: false, error: "proposal not actionable (noop or needs clarification)" };
  }
  if (!proposal.source_kind || !proposal.source_slug) {
    return { ok: false, error: "proposal missing source_kind/source_slug" };
  }
  if (proposal.action === "move") {
    if (!proposal.target_kind) {
      return { ok: false, error: "move proposal missing target_kind" };
    }
    return reclassifyEntityAction({
      action: "move",
      source_kind: proposal.source_kind,
      source_slug: proposal.source_slug,
      target_kind: proposal.target_kind,
      create_stub: createStub,
    });
  }
  if (proposal.action === "merge") {
    if (!proposal.merge_into_kind || !proposal.merge_into_slug) {
      return { ok: false, error: "merge proposal missing merge_into_kind/slug" };
    }
    return reclassifyEntityAction({
      action: "merge",
      source_kind: proposal.source_kind,
      source_slug: proposal.source_slug,
      merge_into_kind: proposal.merge_into_kind,
      merge_into_slug: proposal.merge_into_slug,
    });
  }
  if (proposal.action === "delete") {
    return reclassifyEntityAction({
      action: "delete",
      source_kind: proposal.source_kind,
      source_slug: proposal.source_slug,
    });
  }
  return { ok: false, error: `unknown action: ${proposal.action}` };
}
