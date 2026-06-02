"use server";

import { runShim } from "@/lib/fmdb/shim";

export interface QuickChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ClientQuickChatResult {
  ok: boolean;
  answer?: string;
  used?: { entities: string[]; claims: string[] };
  error?: string;
}

/**
 * Ad-hoc clinical Q&A grounded in a single client's record + a light catalogue
 * lookup. No Analyze / subgraph rebuild — for the "client just asked me this on
 * the phone" moment. Backed by scripts/client-quick-chat.py (Sonnet).
 */
export async function clientQuickChatAction(
  clientId: string,
  question: string,
  history: QuickChatTurn[] = [],
): Promise<ClientQuickChatResult> {
  if (!clientId || !question.trim()) {
    return { ok: false, error: "A question is required." };
  }
  try {
    const raw = (await runShim(
      "client-quick-chat.py",
      { client_id: clientId, question: question.trim(), history },
      120_000,
    )) as ClientQuickChatResult;
    if (!raw || !raw.ok) {
      return { ok: false, error: raw?.error ?? "Quick chat failed." };
    }
    return { ok: true, answer: raw.answer, used: raw.used };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
