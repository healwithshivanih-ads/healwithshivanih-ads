import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadPincodeList, parsePincodeList, pincodeAnswer, tidyPincode } from "../body-age-pincode";
import { COPY } from "@/app/order/body-age/order-copy";
import { isPublicPath } from "../middleware-policy";

describe("body age order: does the laboratory come to this PIN code", () => {
  it("reads six-digit codes from the list and ignores notes and anything else", () => {
    const list = parsePincodeList("# read 22 Nov 2026\n400001\n400014, 411001\n  560001 # Bengaluru\n12345\n4000011\nabc\n012345\n");
    expect([...list].sort()).toEqual(["400001", "400014", "411001", "560001"]);
  });

  it("answers yes or no from a list, and unknown when there is no list", () => {
    const list = parsePincodeList("400001\n400014\n");
    expect(pincodeAnswer("400014", list)).toBe("yes");
    expect(pincodeAnswer(" 400 014 ", list)).toBe("yes");
    expect(pincodeAnswer("793001", list)).toBe("no");
    expect(pincodeAnswer("400014", null)).toBe("unknown");
    expect(pincodeAnswer("400014", new Set())).toBe("unknown"); // an empty file must never refuse everyone
    expect(tidyPincode(400014)).toBe("");
  });

  it("a missing or empty list file means unknown, never a refusal", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ba-pin-"));
    expect(await loadPincodeList(path.join(dir, "nope.txt"))).toBeNull();
    const empty = path.join(dir, "empty.txt");
    await fs.writeFile(empty, "# nothing read yet\n");
    expect(await loadPincodeList(empty)).toBeNull();
    const real = path.join(dir, "list.txt");
    await fs.writeFile(real, "400001\n");
    expect(pincodeAnswer("400001", await loadPincodeList(real))).toBe("yes");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("the form's question is public, and what a buyer is told keeps her rules", () => {
    expect(isPublicPath("/api/body-age/pincode")).toBe(true);
    const said = `${COPY.pin.yes} ${COPY.pin.no}`;
    for (const banned of [/urgent/i, /thyrocare|acumen/i, /sequoya|rings/i, /\bfree\b/i, /sorry/i]) expect(said).not.toMatch(banned);
    expect(COPY.pin.no).toMatch(/Nothing has been charged/);
    expect(COPY.pin.no).toMatch(/WhatsApp/); // a stale list can be wrong: never a dead end
  });
});
