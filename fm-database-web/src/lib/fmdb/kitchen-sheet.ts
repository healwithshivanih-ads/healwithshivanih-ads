/**
 * kitchen-sheet.ts — server loader for /app/<token>/kitchen-sheet, the printable
 * bilingual menu + recipes a client hands to their household cook.
 *
 * Reuses loadClientAppData() for the client's menu + recipe pack (one load, same
 * gating), reads the per-language glossary off the catalogue, and composes a
 * deterministic translation via the pure ./menu-translate module. No AI, no
 * second recipe sweep — recipe translations ride along on the pack (client-app
 * passes them through), and the menu is composed from the glossary + those names.
 */

import { promises as fs } from "fs";
import path from "path";
import yaml from "js-yaml";
import { getCataloguePath } from "./paths";
import { loadClientAppData } from "./client-app";
import {
  normalizeGlossary,
  buildTermIndex,
  translateWeek,
  translateRecipe,
  type Glossary,
  type TranslatedWeek,
  type TranslatedRecipe,
  type Coverage,
} from "./menu-translate";

export interface KitchenSheet {
  /** false when the app data couldn't load OR no glossary exists for `lang`. */
  available: boolean;
  lang: string;
  langName: string;
  ui: Record<string, string>;
  firstName: string;
  coachName: string;
  menuIsSample: boolean;
  weeks: TranslatedWeek[];
  recipes: TranslatedRecipe[];
  coverage: Coverage;
  /** every language a glossary exists for — drives the on-page toggle. */
  availableLangs: { code: string; name: string }[];
}

const TRANSLATIONS_DIR = () => path.join(getCataloguePath(), "_translations");

/** Read + normalize one language's glossary, or null when absent/malformed. */
async function loadGlossary(lang: string): Promise<Glossary | null> {
  // lang comes from a URL query — keep it to a plain code so it can't escape the
  // translations dir.
  if (!/^[a-z]{2,5}$/.test(lang)) return null;
  try {
    const raw = await fs.readFile(path.join(TRANSLATIONS_DIR(), `${lang}.yaml`), "utf8");
    const parsed = yaml.load(raw) as Parameters<typeof normalizeGlossary>[0];
    return normalizeGlossary(parsed);
  } catch {
    return null;
  }
}

/** List every language with a glossary on disk, for the language toggle. */
async function listLanguages(): Promise<{ code: string; name: string }[]> {
  let files: string[] = [];
  try {
    files = await fs.readdir(TRANSLATIONS_DIR());
  } catch {
    return [];
  }
  const out: { code: string; name: string }[] = [];
  for (const f of files) {
    if (!f.endsWith(".yaml") || f.startsWith("_")) continue;
    const code = f.replace(/\.yaml$/, "");
    const g = await loadGlossary(code);
    if (g) out.push({ code, name: g.langName });
  }
  return out;
}

export async function loadKitchenSheet(
  token: string,
  opts: { lang?: string; deviceTz?: string | null } = {},
): Promise<KitchenSheet> {
  const lang = opts.lang ?? "hi";
  const empty: KitchenSheet = {
    available: false,
    lang,
    langName: lang,
    ui: {},
    firstName: "",
    coachName: "The Ochre Tree",
    menuIsSample: false,
    weeks: [],
    recipes: [],
    coverage: { components: 0, translated: 0 },
    availableLangs: [],
  };

  const [data, glossary, availableLangs] = await Promise.all([
    loadClientAppData(token, { deviceTz: opts.deviceTz ?? null }).catch((err) => {
      console.error("[kitchen-sheet] app data failed:", err);
      return null;
    }),
    loadGlossary(lang),
    listLanguages(),
  ]);

  empty.availableLangs = availableLangs;
  if (!data || !glossary) return empty;

  const { index, maxWords } = buildTermIndex(glossary, data.recipePack ?? []);
  const coverage: Coverage = { components: 0, translated: 0 };
  const weeks = (data.weekMenus ?? []).map((w) =>
    translateWeek(w, glossary, index, maxWords, coverage),
  );
  const recipes = (data.recipePack ?? []).map((r) => translateRecipe(r, glossary));

  return {
    available: true,
    lang,
    langName: glossary.langName,
    ui: glossary.ui,
    firstName: data.client?.firstName ?? "",
    coachName: data.coach?.name ?? "The Ochre Tree",
    menuIsSample: data.menuIsSample ?? false,
    weeks,
    recipes,
    coverage,
    availableLangs,
  };
}
