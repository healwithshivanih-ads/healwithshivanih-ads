"use server";

/**
 * The coach records (or clears) a client's dairy reaction type — milk-protein
 * allergy vs lactose intolerance. The intake derives it from the client's
 * answers; this is the route for "I asked her on the call". A coach-set type
 * carries `dairy_reaction_source: coach`, and an intake re-submit never
 * overwrites it (`_apply_dairy_answers` in intake-token-action.py).
 *
 * Passing `null` hands the decision back to the intake answers: the type is
 * re-derived from them (deriveDairyReactionType, the TS mirror of the Python
 * derivation), or removed when there are none.
 */

import { DAIRY_REACTION_TYPES, deriveDairyReactionType, type DairyReactionType } from "@/lib/fmdb/dairy-reaction";

export async function setDairyReactionType(
  clientId: string,
  type: DairyReactionType | null,
): Promise<{ ok: true; type: DairyReactionType | null } | { ok: false; error: string }> {
  if (!clientId || !/^[A-Za-z0-9_-]+$/.test(clientId)) {
    return { ok: false, error: "valid clientId required" };
  }
  if (type !== null && !(DAIRY_REACTION_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `unknown dairy reaction type ${type}` };
  }
  try {
    const yaml = await import("js-yaml");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { getPlansRoot } = await import("@/lib/fmdb/paths");
    const { dumpYaml } = await import("@/lib/fmdb/yaml-dump");
    const { revalidatePath } = await import("next/cache");

    const file = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
    const data = (yaml.load(await fs.readFile(file, "utf8")) ?? {}) as Record<string, unknown>;

    let next: DairyReactionType | null = type;
    if (type) {
      data.dairy_reaction_type = type;
      data.dairy_reaction_source = "coach";
    } else {
      next = deriveDairyReactionType({
        symptoms: data.dairy_reaction_symptoms,
        timing: data.dairy_reaction_timing,
        curd: data.tolerates_curd,
        paneer: data.tolerates_paneer,
        ghee: data.tolerates_ghee,
      });
      if (next) {
        data.dairy_reaction_type = next;
        data.dairy_reaction_source = "intake";
      } else {
        delete data.dairy_reaction_type;
        delete data.dairy_reaction_source;
      }
    }

    await fs.writeFile(file, dumpYaml(data, { noRefs: true, sortKeys: false }), "utf8");
    revalidatePath(`/clients-v2/${clientId}`, "layout");
    return { ok: true, type: next };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
