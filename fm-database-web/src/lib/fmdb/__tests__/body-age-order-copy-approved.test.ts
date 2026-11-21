import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The order page wording was approved by Shivani on 21 Nov 2026, word for word. This pins the file that holds
 * it. If this fails you changed a sentence a buyer reads (or a comment in that file): show her the exact change,
 * and only after her own yes replace the fingerprint below (shasum -a 256 on the file).
 */
const APPROVED_SHA256 = "1926c04afad9b7ed2e1d4b9fa73150d3cd4842b0f12c2e7a3dd55b7604dda077";

describe("body age order page wording", () => {
  it("is the wording Shivani approved", () => {
    const file = path.join(process.cwd(), "src/app/order/body-age/order-copy.ts");
    const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(sha).toBe(APPROVED_SHA256);
  });
});
