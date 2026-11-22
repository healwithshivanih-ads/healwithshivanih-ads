import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadPincodeList, pincodeAnswer } from "../body-age-pincode";

/** The catalogue's copy of the laboratory's list: present, sane, and answering for real PIN codes. */
describe("body age order: the PIN code list on file", () => {
  it("loads a few thousand codes and answers yes and no", async () => {
    const file = path.join(process.cwd(), "..", "fm-database", "data", "lab_providers", "thyrocare_pincodes.txt");
    const list = await loadPincodeList(file);
    expect(list).not.toBeNull();
    expect(list!.size).toBeGreaterThan(3000); // a truncated download must not quietly refuse most of India
    expect(pincodeAnswer("400014", list)).toBe("yes"); // Dadar, Mumbai
    expect(pincodeAnswer("110001", list)).toBe("yes"); // New Delhi
    expect(pincodeAnswer("744101", list)).toBe("no"); // Port Blair
    for (const code of list!) expect(code).toMatch(/^[1-9]\d{5}$/);
  });
});
