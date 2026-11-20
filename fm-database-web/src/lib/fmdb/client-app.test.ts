import { describe, expect, it } from "vitest";

import { clientRemedyName } from "./client-app";
describe("clientRemedyName", () => {
  it("drops the condition from a remedy name", () => {
    expect(clientRemedyName("Psyllium Husk with Fresh Yogurt for Irritable Bowel Syndrome")).toBe("Psyllium Husk with Fresh Yogurt");
    expect(clientRemedyName("Jeera Water")).toBe("Jeera Water");
  });
});
