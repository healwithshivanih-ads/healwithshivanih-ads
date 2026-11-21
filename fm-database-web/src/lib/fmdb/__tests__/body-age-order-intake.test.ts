/** A paid body age order becoming records, over a temp plans root. Creating a brand-new record is mocked. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let created = 0;
let root: string;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../booking-lead-intake", () => ({
  createProspectRecord: async (o: { name: string; email: string | null; phone: string | null; leadSource: string }) => {
    created += 1;
    const id = `cl-90${created}`;
    const dir = path.join(root, "clients", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "client.yaml"), yaml.dump({ client_id: id, display_name: o.name, sex: "other", email: o.email, mobile_number: o.phone, lead_source: o.leadSource }));
    return id;
  },
}));

import { matchPerson, placeBodyAgeOrder, stampFromOrder } from "../body-age-order-intake";
import { buildBodyAgeOrder, loadBodyAgeOrder, saveBodyAgeOrder, type BodyAgeOrder, type OrderPerson } from "../body-age-orders";
import { attachTestOrder, loadBodyAgeOrderList, moveBodyAgeOrder } from "../../server-actions/body-age-orders";
import { labItemsFor } from "../body-age-lab-items";

const ASHA: OrderPerson = { full_name: "Asha Rao", date_of_birth: "1980-03-02", sex: "F", email: "asha@example.com", phone: "+919820000000" };
const RAVI: OrderPerson = { full_name: "Ravi Rao", date_of_birth: "1978-11-20", sex: "M", email: "asha@example.com", phone: "+919820000000" }; // shares her contact
const VISIT = { address: "12 Palm Grove, Bandra West", pincode: "400050", preferred_date: "2027-01-08", preferred_slot: "morning" as const, notes: "" };

async function order(people: OrderPerson[], over: Partial<BodyAgeOrder> = {}, n = 1): Promise<BodyAgeOrder> {
  const o = { ...buildBodyAgeOrder(`ba-20270105-0000000${n}`, "k", { report_kind: "standard", people, visit: VISIT }, 4999, new Date().toISOString(), false), status: "paid" as const, ...over };
  await saveBodyAgeOrder(o);
  return o;
}
function existing(bucket: string, id: string, doc: Record<string, unknown>) {
  const dir = path.join(root, bucket, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "client.yaml"), yaml.dump({ client_id: id, ...doc }));
}
const record = (id: string) => yaml.load(fs.readFileSync(path.join(root, "clients", id, "client.yaml"), "utf8")) as Record<string, unknown>;

let prev: string | undefined;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ba-intake-"));
  prev = process.env.FMDB_PLANS_DIR;
  process.env.FMDB_PLANS_DIR = root;
  created = 0;
});
afterEach(() => {
  if (prev === undefined) delete process.env.FMDB_PLANS_DIR;
  else process.env.FMDB_PLANS_DIR = prev;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("body age order: whose record", () => {
  it("never guesses between two records", () => {
    const a = { clientId: "cl-1", bucket: "clients" as const };
    const b = { clientId: "cl-2", bucket: "clients" as const };
    expect(matchPerson([], [], [])).toEqual({ kind: "new" });
    expect(matchPerson([a], [a], [])).toEqual({ kind: "existing", found: a });
    expect(matchPerson([], [b], [])).toEqual({ kind: "existing", found: b });
    expect(matchPerson([a], [b], []).kind).toBe("unclear");
    expect(matchPerson([a, b], [], []).kind).toBe("unclear");
    expect(matchPerson([a], [a], ["cl-1"])).toEqual({ kind: "new" }); // the partner already took that record
  });

  it("adds what the order knows and keeps what the record already had", () => {
    const o = buildBodyAgeOrder("ba-20270105-00000001", "k", { report_kind: "standard", people: [ASHA], visit: VISIT }, 4999, "t", false);
    const fresh = stampFromOrder({ sex: "other" }, ASHA, o);
    expect(fresh).toMatchObject({ date_of_birth: "1980-03-02", sex: "F", email: "asha@example.com", mobile_number: "+919820000000", collection_pincode: "400050" });
    const kept = stampFromOrder({ sex: "M", date_of_birth: "1979-01-01", email: "old@example.com", mobile_number: "111" }, ASHA, o);
    expect(kept).toMatchObject({ sex: "M", date_of_birth: "1979-01-01", email: "old@example.com", mobile_number: "111" });
  });
});

describe("body age order: becoming records", () => {
  it("a new buyer gets a record with the details the report needs", async () => {
    const o = await order([ASHA]);
    const r = await placeBodyAgeOrder(o);
    expect(r).toEqual({ ok: true, clientIds: ["cl-901"] });
    expect(record("cl-901")).toMatchObject({ date_of_birth: "1980-03-02", sex: "F", collection_address: VISIT.address, lead_source: "body_age_report" });
    expect((await loadBodyAgeOrder(o.order_id))?.client_ids).toEqual(["cl-901"]);
    expect(await placeBodyAgeOrder((await loadBodyAgeOrder(o.order_id))!)).toEqual({ ok: true, clientIds: ["cl-901"] }); // twice changes nothing
    expect(created).toBe(1);
  });

  it("two people who share an email and phone get a record each", async () => {
    const r = await placeBodyAgeOrder(await order([ASHA, RAVI]));
    expect(r).toEqual({ ok: true, clientIds: ["cl-901", "cl-902"] });
    expect(record("cl-902")).toMatchObject({ sex: "M", date_of_birth: "1978-11-20" });
  });

  it("someone already on file is found, and comes back from the parked folder", async () => {
    existing("prospects", "cl-050", { display_name: "Asha R", email: "ASHA@example.com", sex: "F" });
    const r = await placeBodyAgeOrder(await order([ASHA]));
    expect(r).toEqual({ ok: true, clientIds: ["cl-050"] });
    expect(fs.existsSync(path.join(root, "prospects", "cl-050"))).toBe(false);
    expect(record("cl-050")).toMatchObject({ display_name: "Asha R", date_of_birth: "1980-03-02" });
    expect(created).toBe(0);
  });

  it("an unclear match creates nothing, for anyone on the order", async () => {
    existing("clients", "cl-051", { email: "asha@example.com" });
    existing("clients", "cl-052", { mobile_number: "9820000000" });
    const o = await order([{ ...RAVI, email: "ravi@example.com", phone: "+919811111111" }, ASHA]);
    const r = await placeBodyAgeOrder(o);
    expect(r.ok).toBe(false);
    expect(created).toBe(0);
    expect((await loadBodyAgeOrder(o.order_id))?.client_ids).toBeUndefined();
    const rows = await loadBodyAgeOrderList();
    expect(rows[0].unplaced).toMatch(/more than one record/);
    expect(JSON.stringify(rows)).not.toContain("access_key");
  });

  it("a test order, or an unpaid one, never creates a record", async () => {
    expect((await placeBodyAgeOrder(await order([ASHA], { test: true }))).ok).toBe(false);
    expect((await placeBodyAgeOrder(await order([ASHA], { status: "pending" }, 2))).ok).toBe(false);
    expect(created).toBe(0);
  });
});

describe("body age order: the coach's steps", () => {
  it("a test order goes on the test profile and then moves step by step", async () => {
    const o = await order([ASHA], { test: true });
    expect((await moveBodyAgeOrder(o.order_id, "booked", "2027-01-08")).ok).toBe(false); // no records yet
    expect((await attachTestOrder(o.order_id)).ok).toBe(true);
    expect((await loadBodyAgeOrder(o.order_id))?.client_ids).toEqual(["cl-900"]);
    expect((await moveBodyAgeOrder(o.order_id, "booked")).ok).toBe(false); // needs the date
    expect((await moveBodyAgeOrder(o.order_id, "booked", "2027-01-08")).ok).toBe(true);
    expect((await moveBodyAgeOrder(o.order_id, "results_in")).ok).toBe(false); // cannot skip the sample
    expect((await moveBodyAgeOrder(o.order_id, "collected", "2027-01-08")).ok).toBe(true);
    expect((await moveBodyAgeOrder(o.order_id, "results_in")).ok).toBe(true);
    expect((await moveBodyAgeOrder(o.order_id, "report_sent")).ok).toBe(true);
    expect(await loadBodyAgeOrder(o.order_id)).toMatchObject({ status: "report_sent", booked_for: "2027-01-08", collected_on: "2027-01-08" });
  });

  it("the coach can never mark an order paid, and a real order cannot go on the test profile", async () => {
    const pending = await order([ASHA], { status: "pending" });
    expect((await moveBodyAgeOrder(pending.order_id, "paid")).ok).toBe(false);
    const real = await order([ASHA], {}, 2);
    expect((await attachTestOrder(real.order_id)).ok).toBe(false);
  });
});

describe("body age order: what to book at the laboratory", () => {
  it("reads both packages from the lab price file, the deeper one with the urine test", async () => {
    const file = path.resolve(__dirname, "../../../../../fm-database/data/lab_providers/thyrocare.yaml");
    const std = await labItemsFor("standard", file);
    const deep = await labItemsFor("deeper", file);
    expect(std.items.length).toBeGreaterThan(0);
    expect(std.ourCostInr).toBe(2049);
    expect(deep.ourCostInr).toBe(5094);
    expect(deep.items.join(" ")).toMatch(/urine/i);
    expect((await labItemsFor("deeper", "/nope.yaml")).items).toEqual([]);
  });
});
