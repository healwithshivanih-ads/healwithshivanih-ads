import { describe, it, expect } from "vitest";
import { buildLibraryRecipeResolver, loadLibraryRecipes } from "./client-app";

describe("kachumber dedup", () => {
  it("duplicate slug is gone, survivor remains, and every live dish form resolves", async () => {
    const lib = await loadLibraryRecipes();
    expect(lib.filter((l) => l.slug === "kachumber")).toHaveLength(0);
    expect(lib.filter((l) => l.slug === "kachumber-salad")).toHaveLength(1);

    const resolve = buildLibraryRecipeResolver(lib);
    // every distinct kachumber dish form present across all 11 live plans
    for (const dish of [
      "Kachumber salad (1 small bowl)",
      "kachumber salad (1 small bowl)",
      "Kachumber Salad (1 small bowl)",
      "small kachumber salad (1 bowl)",
      "small Kachumber salad (1 bowl)",
      "warm Kachumber salad (1 bowl)",
      "warm kachumber salad (1 bowl)",
    ]) {
      const hit = resolve(dish);
      expect(hit, `did not resolve: ${dish}`).toBeTruthy();
      expect(hit!.title.toLowerCase(), dish).toBe("kachumber salad");
    }
  });

  it("the surviving recipe contains no onion", async () => {
    const lib = await loadLibraryRecipes();
    const k = lib.find((l) => l.slug === "kachumber-salad")!.recipe;
    const blob = `${k.title} ${(k.mains ?? []).join(" ")} ${(k.ingredients ?? []).join(" ")}`.toLowerCase();
    expect(blob).not.toMatch(/\bonion\b/);
  });
});
