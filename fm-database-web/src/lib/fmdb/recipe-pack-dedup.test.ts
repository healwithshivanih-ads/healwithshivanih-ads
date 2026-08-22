import { describe, it, expect } from "vitest";
import { dedupeRecipePack, dishKey } from "./recipe-pack-dedup";

const t = (title: string, aliases?: string[]) => ({ title, aliases });
const titles = (rs: { title: string }[]) => rs.map((r) => r.title);

describe("dishKey", () => {
  it("ignores case, punctuation, filler and word order", () => {
    expect(dishKey("3-Egg Omelette with Onion and Cabbage")).toBe(dishKey("3-Egg Omelette (Onion & Cabbage)"));
    expect(dishKey("Cabbage-Coconut Thoran")).toBe(dishKey("Cabbage-coconut thoran"));
    expect(dishKey("Chana masala")).toBe(dishKey("Masala chana"));
  });
  it("keeps genuinely different dishes apart", () => {
    expect(dishKey("Chana masala")).not.toBe(dishKey("Chana-spinach masala"));
    expect(dishKey("Moong dal")).not.toBe(dishKey("Sprouted moong dal chilla"));
  });
  it("is empty for an all-filler or blank title", () => {
    expect(dishKey("with and of")).toBe("");
    expect(dishKey("")).toBe("");
  });
});

describe("dedupeRecipePack", () => {
  it("drops the AI twin of a library recipe — the Nazneen case", () => {
    const pack = [t("3-Egg Omelette with Onion and Cabbage"), t("Ajwain Besan Cheela"), t("Cabbage-Coconut Thoran")];
    const lib = [t("3-Egg Omelette (Onion & Cabbage)"), t("Cabbage-coconut thoran"), t("Brown Rice")];
    const out = dedupeRecipePack(pack, lib);
    expect(titles(out.pack)).toEqual(["Ajwain Besan Cheela"]);
    expect(titles(out.library)).toEqual(titles(lib));
    expect(titles(out.dropped)).toEqual(["3-Egg Omelette with Onion and Cabbage", "Cabbage-Coconut Thoran"]);
  });

  it("a library alias counts as a title", () => {
    const out = dedupeRecipePack([t("Methi thepla")], [t("Fenugreek flatbread", ["Methi thepla"])]);
    expect(out.pack).toEqual([]);
    expect(out.dropped.length).toBe(1);
  });

  it("keeps the first of two same-titled pack entries", () => {
    const out = dedupeRecipePack([t("Poha"), t("POHA"), t("Upma")], []);
    expect(titles(out.pack)).toEqual(["Poha", "Upma"]);
  });

  it("keeps the first of two library copies of one dish", () => {
    const out = dedupeRecipePack([], [t("Brown rice"), t("Brown Rice")]);
    expect(titles(out.library)).toEqual(["Brown rice"]);
  });

  it("never merges untitled or all-filler entries", () => {
    const out = dedupeRecipePack([t(""), t(""), t("and")], [t("")]);
    expect(out.pack.length).toBe(3);
    expect(out.library.length).toBe(1);
  });

  it("leaves a pack recipe alone when the library has no twin", () => {
    const out = dedupeRecipePack([t("Kodo millet pulao with peas and jeera")], [t("Kodo millet khichdi")]);
    expect(out.pack.length).toBe(1);
    expect(out.dropped).toEqual([]);
  });
});
