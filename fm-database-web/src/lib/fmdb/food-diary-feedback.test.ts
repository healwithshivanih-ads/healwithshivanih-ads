/**
 * Food diary — the client corrects the AI, and gets one line per meal
 * (coach, 2026-10-23: "I took a picture of spaghetti only … I need the option
 * to correct it" and "it needs to be diet aware — no one will add dal to
 * spaghetti").
 */
import { describe, it, expect } from "vitest";
import { clientDiaryView, entryNeedsRead, entryReadState, foldDiary, type DiaryLine, type FoodDiaryConfig } from "./food-diary";
import { ideaAllowed, mealFeedback } from "./food-diary-balance";

const CFG: FoodDiaryConfig = { id: "fd-1", start: "2026-10-23", days: 3, status: "active" };
const add: DiaryLine = {
  op: "add", diary_id: "fd-1", ts: "2026-10-23T15:51:00Z", entry_id: "a",
  date: "2026-10-23", time: "21:21", band: "evening", photo: "a.jpg", note: "",
};
const misread: DiaryLine = {
  op: "read", diary_id: "fd-1", ts: "2026-10-23T15:55:00Z", entry_id: "a",
  reading: {
    readable: true, confidence: 0.85, read_at: "2026-10-23T15:55:00Z",
    dishes: [{ name: "spaghetti with egg", count: 1, size: "large" }],
    balance: { protein: "present", veg: "none", carbs: "heavy" },
  },
};
const corrected: DiaryLine = { op: "edit", diary_id: "fd-1", ts: "2026-10-23T16:10:00Z", entry_id: "a", name: "spaghetti" };
const reread: DiaryLine = {
  op: "read", diary_id: "fd-1", ts: "2026-10-23T16:14:00Z", entry_id: "a",
  reading: {
    readable: true, confidence: 0.9, read_at: "2026-10-23T16:14:00Z",
    dishes: [{ name: "spaghetti", count: 1, size: "large" }],
    balance: { protein: "none", veg: "none", carbs: "heavy" },
    protein_idea: "chickpeas tossed through",
  },
};
const veg = { dietary_preference: "Vegetarian" };

describe("the client corrects what the AI saw", () => {
  it("shows what it was read as, then her words, and re-reads the plate", () => {
    let e = foldDiary([add, misread], "fd-1").entries[0];
    expect(entryNeedsRead(e)).toBe(false);
    let v = clientDiaryView(CFG, foldDiary([add, misread], "fd-1"), "2026-10-23", { client: veg })!;
    expect(v.entries[0].looksLike).toBe("spaghetti with egg");
    expect(v.entries[0].yours).toBeUndefined();

    e = foldDiary([add, misread, corrected], "fd-1").entries[0];
    expect(e.client_label).toBe("spaghetti");
    expect(entryNeedsRead(e)).toBe(true); // her words came after the read
    v = clientDiaryView(CFG, foldDiary([add, misread, corrected], "fd-1"), "2026-10-23", { client: veg })!;
    expect(v.entries[0].looksLike).toBe("spaghetti");
    expect(v.entries[0].yours).toBe(true);
    // The misread plate's "Protein ✓" must not linger while it is re-read.
    expect(v.entries[0].marks).toBeUndefined();
    expect(v.tip).toBeNull();

    const after = foldDiary([add, misread, corrected, reread], "fd-1");
    expect(entryNeedsRead(after.entries[0])).toBe(false);
    v = clientDiaryView(CFG, after, "2026-10-23", { client: veg })!;
    expect(v.entries[0].marks?.protein).toBe("none");
    expect(v.entries[0].feedback).toBe("Mostly carbs on this plate. Try adding chickpeas tossed through.");
  });
  it("the coach's correction still wins over the client's", () => {
    const coach: DiaryLine = { op: "label", diary_id: "fd-1", ts: "2026-10-23T16:20:00Z", entry_id: "a", label: "spaghetti aglio olio" };
    const v = clientDiaryView(CFG, foldDiary([add, misread, corrected, reread, coach], "fd-1"), "2026-10-23", { client: veg })!;
    expect(v.entries[0].looksLike).toBe("spaghetti aglio olio");
    expect(v.entries[0].yours).toBeUndefined();
  });
  it("an unreadable photo the client named does not go to the coach", () => {
    const blurry: DiaryLine = { ...misread, reading: { readable: false, confidence: 0.1, reason: "blurry", read_at: "2026-10-23T15:55:00Z" } };
    expect(entryReadState(foldDiary([add, blurry], "fd-1").entries[0])).toBe("unreadable");
    const named = foldDiary([add, blurry, corrected, { ...blurry, ts: "2026-10-23T16:14:00Z", reading: { ...blurry.reading!, read_at: "2026-10-23T16:14:00Z" } }], "fd-1");
    expect(entryReadState(named.entries[0])).toBe("labelled");
  });
});

describe("the protein idea must suit THIS client", () => {
  it("vetoes what her diet, dairy reaction, allergies or avoid list rule out", () => {
    expect(ideaAllowed("grilled chicken strips", veg)).toBe(false);
    expect(ideaAllowed("a boiled egg on the side", veg)).toBe(false);
    expect(ideaAllowed("a boiled egg on the side", { dietary_preference: "Eggetarian" })).toBe(true);
    expect(ideaAllowed("grilled paneer cubes", { ...veg, known_allergies: ["Milk"] })).toBe(false);
    expect(ideaAllowed("grilled paneer cubes", { ...veg, foods_to_avoid: "paneer" })).toBe(false);
    expect(ideaAllowed("baked tofu", { ...veg, foods_to_avoid: "soy" })).toBe(false);
    expect(ideaAllowed("chickpeas tossed through", veg)).toBe(true);
    expect(ideaAllowed("a slice of seitan", { ...veg, foods_to_avoid: "gluten" })).toBe(false);
    expect(ideaAllowed("", veg)).toBe(false);
  });
  it("no safe idea → plain 'some protein', never a mismatched dish from a list", () => {
    const bal = { protein: "none" as const, veg: "none" as const, carbs: "heavy" as const };
    expect(mealFeedback(bal, "evening", veg, { gentle: false, idea: "grilled chicken" })).toBe(
      "Mostly carbs on this plate. Adding some protein would help.",
    );
    expect(mealFeedback(bal, "evening", veg, { gentle: false })).not.toMatch(/dal|chilla|rajma/);
  });
});

describe("one line per meal", () => {
  const ok = { protein: "present" as const, veg: "present" as const, carbs: "balanced" as const };
  it("observes, never judges, and never gives a number", () => {
    const lines = [
      mealFeedback(ok, "midday", veg, { gentle: false }),
      mealFeedback({ ...ok, veg: "none" }, "midday", veg, { gentle: false }),
      mealFeedback({ ...ok, carbs: "heavy" }, "midday", veg, { gentle: false }),
      mealFeedback({ ...ok, protein: "light" }, "morning", veg, { gentle: false, idea: "a spoon of peanut butter" }),
      mealFeedback({ ...ok, protein: "none" }, "evening", veg, { gentle: true, idea: "chickpeas" }),
    ].join(" ");
    expect(lines).not.toMatch(/\b(bad|too much|failed|should|must|wrong|poor|unhealthy)\b|\d/i);
  });
  it("a gentle client never hears about carbs", () => {
    const heavy = { protein: "none" as const, veg: "none" as const, carbs: "heavy" as const };
    const line = mealFeedback(heavy, "evening", veg, { gentle: true, idea: "chickpeas tossed through" })!;
    expect(line).toBe("Next time, try adding chickpeas tossed through for some protein.");
    expect(line).not.toMatch(/carb/i);
  });
  it("no line under an early-morning drink or a late-night snack", () => {
    expect(mealFeedback({ ...ok, protein: "none" }, "waking", veg, { gentle: false })).toBeNull();
    expect(mealFeedback({ ...ok, protein: "none" }, "bedtime", veg, { gentle: false })).toBeNull();
  });
});
