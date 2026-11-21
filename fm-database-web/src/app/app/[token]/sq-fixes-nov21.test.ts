import { describe, expect, it } from "vitest";
import { askHandoff } from "@/lib/fmdb/ask-safety";
import { bpCard } from "./sq-ask";
import { itemCadence, sessionWhen } from "./ochre-exercise";

describe("client round fixes, 21 Nov", () => {
  it("a sweet that is 'bache' (left over) is not an ache", () => {
    expect(askHandoff("Diwali ke sweets bache hai, ek laddoo chalega kya")).toBeNull();
    expect(askHandoff("I have a stomachache")).toBe("symptom");
    expect(askHandoff("my back aches")).toBe("symptom");
  });
  it("a BP reading is answered by range", () => {
    expect(bpCard(185, 100).src).toBe("Please act now");
    expect(bpCard(150, 95).heading).toContain("high side");
    expect(bpCard(85, 55).heading).toContain("low side");
    expect(bpCard(120, 80).heading).toContain("usual range");
    expect(bpCard(120, 80).buttons?.[0].to).toBe("vitals");
  });
  it("a Daily header is hidden when the movements are weekly", () => {
    expect(sessionWhen({ when: "Daily", items: [{ cadence: "3x/week" }] })).toBe("");
    expect(sessionWhen({ when: "Daily", items: [{ cadence: "" }] })).toBe("Daily");
    expect(itemCadence({ cadence: "daily", prescription: "3 x 10 minutes, twice a week" })).toBe("");
    expect(itemCadence({ cadence: "3x/week", prescription: "5 stands" })).toBe("3x/week");
  });
});
