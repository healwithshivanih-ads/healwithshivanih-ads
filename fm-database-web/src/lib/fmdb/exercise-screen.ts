/**
 * TypeScript mirror of `fmdb/plan/exercise_screen.py`.
 *
 * WHY A MIRROR AND NOT A SHIM. The coach UI can shell out to Python, but the
 * client app cannot — it reads the catalogue off disk. The catalogue already
 * carries three of these pairs (lab-nutrient-priorities, food-cautions,
 * somatic-read) and the house rule is the same each time: the two engines are
 * pinned to a fixture captured from the real Python over the real catalogue,
 * so drift fails a test rather than silently changing what a client is shown.
 *
 * Regenerate the fixture by hand whenever the matcher legitimately changes:
 *   fm-database$ .venv/bin/python -m scripts.dump_exercise_screen_fixture
 */

export type Verdict = "blocked" | "caution" | "watch" | "clear";
export type NoteKind = "block" | "caution" | "pain" | "age";

export interface ScreenNote {
  kind: NoteKind;
  label: string;
  detail: string;
  modification: string;
}

export interface ExerciseVerdict {
  slug: string;
  display_name: string;
  client_name: string;
  modality: string;
  verdict: Verdict;
  notes: ScreenNote[];
  start_level: string | null;
  start_reason: string;
}

/** Mirrors contra_screen._NEGATED. The separator lookahead (not \b) is
 *  load-bearing: intake stores `not_pregnant`, and `_` is a word character. */
const NEGATED =
  /\b(?:not|non|no|never|nil|none|negative|denies|absent|unremarkable)(?=[ _-])(?:[ _-]+(?:a|an|any|the|of|for|h\/o|history|hx|sign|signs|symptom|symptoms|evidence|episode|episodes|known|current|prior|past|significant|reported))*[ _-]+\w+/gi;

/** Mirrors exercise_screen._SCREEN_FIELDS. */
const SCREEN_FIELDS = [
  "active_conditions", "medical_history", "current_medications", "medications",
  "known_allergies", "notes", "reported_triggers",
  // A dict — flattened to "key value" pairs, which is how exercise_limitations
  // and exercise_current reach the screen. See the Python note.
  "weight_loss",
] as const;

const SIDE_SUFFIXES = ["_left", "_right"];
const REGION_FOLD: Record<string, string> = {
  neck_front: "neck", neck_back: "neck", head_back: "neck",
  scapula: "upper_back",
  arm: "shoulder",
  hand: "wrist_hand",
  upper_abdomen: "abdomen", lower_abdomen: "abdomen",
  pelvis: "sacrum_pelvis", sacrum: "sacrum_pelvis",
  buttock: "hip",
  shin: "ankle_foot", foot: "ankle_foot", achilles: "ankle_foot",
};
const REGION_IGNORE = new Set(["head", "face", "jaw"]);

/** Intake body-map slugs → side-agnostic exercise regions. */
export function foldPainRegions(painLocations?: string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of painLocations ?? []) {
    let p = String(raw).trim().toLowerCase();
    for (const suf of SIDE_SUFFIXES) {
      if (p.endsWith(suf)) { p = p.slice(0, -suf.length); break; }
    }
    if (REGION_IGNORE.has(p)) continue;
    out.add(REGION_FOLD[p] ?? p);
  }
  return out;
}

type ClientRecord = Record<string, unknown>;

/** Mirrors contra_screen._blob — flatten the named fields, then strip negations. */
function blob(client: ClientRecord, fields: readonly string[]): string {
  const parts: string[] = [];
  for (const f of fields) {
    if (!(f in client)) continue;
    const v = client[f];
    if (Array.isArray(v)) parts.push(...v.map((x) => String(x)));
    else if (v && typeof v === "object") {
      parts.push(...Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k} ${x}`));
    } else if (v) parts.push(String(v));
  }
  return parts.join(" ").toLowerCase().replace(NEGATED, " ");
}

/** Mirrors ExerciseCaution._normalise — collapse non-alphanumerics to spaces. */
function normalise(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function anyTermMatches(terms: string[], hay: string): boolean {
  const h = normalise(hay);
  if (!h) return false;
  return terms.map(normalise).filter(Boolean).some((t) => h.includes(t));
}

/** Mirrors exercise_screen._age_of / Client.estimated_age. */
export function estimateAge(client: ClientRecord): number | null {
  for (const key of ["estimated_age", "age"]) {
    const v = client[key];
    if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  }
  const band = String(client["age_band"] ?? "").replace("–", "-").trim();
  if (!band) return null;
  const parts = band.split("-").map((p) => p.trim()).filter((p) => /^\d+$/.test(p));
  if (parts.length === 2) return Math.floor((Number(parts[0]) + Number(parts[1])) / 2);
  if (parts.length === 1) return Number(parts[0]);
  return null;
}

interface ExerciseLike {
  slug?: string;
  display_name?: string;
  client_name?: string;
  modality?: string;
  balance_demand?: number;
  joint_stress?: string[];
  levels?: { level?: string; support?: string }[];
  cautions?: {
    condition?: string;
    condition_aliases?: string[];
    severity?: string;
    reason?: string;
    modification?: string;
  }[];
}

function pickStartLevel(ex: ExerciseLike, supported: boolean): [string | null, string] {
  const levels = ex.levels ?? [];
  if (levels.length === 0) return [null, ""];
  if (supported) {
    for (const lv of levels) {
      const sup = String(lv.support ?? "").trim().toLowerCase();
      if (sup && sup !== "none") return [String(lv.level), "start supported"];
    }
  }
  return [String(levels[0].level), "start at the easiest level"];
}

/** Screen ONE exercise against ONE client record. */
export function screenExercise(ex: ExerciseLike, client: ClientRecord): ExerciseVerdict {
  const hay = blob(client, SCREEN_FIELDS);
  const pain = foldPainRegions(client["pain_locations"] as string[] | undefined);
  const age = estimateAge(client);

  const notes: ScreenNote[] = [];
  let blocked = false;
  let cautioned = false;
  let supported = false;

  for (const c of ex.cautions ?? []) {
    const terms = [c.condition ?? "", ...(c.condition_aliases ?? [])];
    if (!anyTermMatches(terms, hay)) continue;
    if ((c.severity ?? "caution") === "block") {
      blocked = true;
      notes.push({ kind: "block", label: c.condition ?? "", detail: c.reason ?? "", modification: "" });
    } else {
      cautioned = true;
      supported = true;
      notes.push({
        kind: "caution", label: c.condition ?? "", detail: c.reason ?? "",
        modification: c.modification ?? "",
      });
    }
  }

  const stress = new Set((ex.joint_stress ?? []).map(String));
  const overlap = [...pain].filter((r) => stress.has(r)).sort();
  if (overlap.length > 0) {
    notes.push({
      kind: "pain",
      label: overlap.map((r) => r.replace(/_/g, " ")).join(", "),
      detail:
        "This client has tagged pain in a region the exercise loads. Confirm it is " +
        "comfortable before prescribing, and work in a pain-free range.",
      modification: "",
    });
  }

  const demand = Number(ex.balance_demand ?? 0);
  if (age !== null && demand >= 2 && age >= 75) {
    supported = true;
    notes.push({
      kind: "age",
      label: `age ~${age}, balance demand ${demand}/3`,
      detail:
        "The over-75s gain the most from balance work and can least afford a fall. " +
        "Keep support until recovery strategies are confirmed.",
      modification: "",
    });
  }

  const verdict: Verdict = blocked
    ? "blocked"
    : cautioned
      ? "caution"
      : notes.length > 0
        ? "watch"
        : "clear";

  const [startLevel, startReason] = blocked ? [null, ""] as [null, string] : pickStartLevel(ex, supported);

  return {
    slug: ex.slug ?? "?",
    display_name: ex.display_name ?? "",
    client_name: (ex.client_name ?? "").trim() || (ex.display_name ?? ""),
    modality: String(ex.modality ?? ""),
    verdict,
    notes,
    start_level: startLevel,
    start_reason: startReason,
  };
}

const VERDICT_ORDER: Record<Verdict, number> = { blocked: 0, caution: 1, watch: 2, clear: 3 };

/** Screen the whole catalogue, most-restricted first. */
export function screenAll(exercises: ExerciseLike[], client: ClientRecord): ExerciseVerdict[] {
  const out = exercises.map((e) => screenExercise(e, client));
  out.sort((a, b) => {
    const d = VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict];
    if (d !== 0) return d;
    if (a.modality !== b.modality) return a.modality < b.modality ? -1 : 1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  return out;
}

export function summarise(verdicts: ExerciseVerdict[]): Record<Verdict, number> {
  const counts: Record<Verdict, number> = { blocked: 0, caution: 0, watch: 0, clear: 0 };
  for (const v of verdicts) counts[v.verdict] += 1;
  return counts;
}
