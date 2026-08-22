/**
 * Menopause-stage derivation from a client's free-text condition fields.
 *
 * Ported from fm-database/fmdb/assess/suggester.py::menopause_stage() — keep
 * the marker word lists and precedence (post-check before peri-check) in
 * lockstep with that function. This is a UI-display-gating duplicate (which
 * FmFormSection to show), not a safety-screen parity surface — it doesn't
 * touch anything `plan/contra_screen.py` or its TS mirror is responsible for,
 * so it doesn't widen that fixture-pinned parity surface.
 *
 * There is no structured menopause field on Client — `active_conditions` and
 * `medical_history` carry free text like "Postmenopausal" or "Perimenopause
 * onset 2023". Substring matching on a bare "menopaus" would misfire on
 * "Premenopausal" (which literally contains that substring) — hence the
 * anchored "perimenopaus"/"postmenopaus" markers below, never the bare root.
 */

const POST_MENOPAUSE_MARKERS = [
  "postmenopaus", "post-menopaus", "post menopaus", "surgical menopause",
  "menopause complete", "hysterectomy with oophorectomy",
] as const;

const PERI_MENOPAUSE_MARKERS = [
  "perimenopaus", "peri-menopaus", "peri menopaus", "menopause transition",
  "menopausal transition",
] as const;

type Blobbable = string | string[] | null | undefined;

function toBlobs(v: Blobbable): string[] {
  if (v == null) return [];
  if (typeof v === "string") return [v];
  return v.map((x) => String(x));
}

export type MenopauseStage = "postmenopause" | "perimenopause" | null;

/**
 * 'postmenopause' | 'perimenopause' | null, from the client's own record.
 * Mirrors fm-database's menopause_stage() field-for-field: reads
 * active_conditions, medical_history, and (optionally) current_conditions,
 * joins them lowercased, checks post-markers before peri-markers so a
 * record carrying both (an older perimenopause entry plus a newer
 * postmenopause one) resolves to the later, true state.
 */
export function menopauseStage(
  activeConditions?: Blobbable,
  medicalHistory?: Blobbable,
  currentConditions?: Blobbable,
): MenopauseStage {
  const blobs = [
    ...toBlobs(activeConditions),
    ...toBlobs(medicalHistory),
    ...toBlobs(currentConditions),
  ];
  const text = blobs.join(" | ").toLowerCase();
  if (!text) return null;
  if (POST_MENOPAUSE_MARKERS.some((m) => text.includes(m))) return "postmenopause";
  if (PERI_MENOPAUSE_MARKERS.some((m) => text.includes(m))) return "perimenopause";
  return null;
}
