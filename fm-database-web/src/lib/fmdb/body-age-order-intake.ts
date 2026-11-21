import "server-only";

/**
 * A paid body age order becoming people's records, on the coach's Mac.
 *
 * For each person on the order: find them by email or phone in clients/ and prospects/ (the way a paid short
 * call does), else create them as a prospect. Then put what the order told us on the record: date of birth and
 * sex (the report cannot be made without both), email, phone and the home-visit address. The order keeps the
 * record ids in `client_ids`, one per person, in order.
 *
 * It never guesses. If the email and the phone point at two different people, or at more than one, the order is
 * left unplaced with a plain reason for the coach. Two people on one order who share an email or a phone get
 * separate records. A TEST order never creates or touches a record here; the coach attaches it to the test
 * profile from the order list. Nothing is sent to anyone.
 */
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "./paths";
import { dumpYaml } from "./yaml-dump";
import { patchBodyAgeOrder, type BodyAgeOrder, type OrderPerson } from "./body-age-orders";

export interface Found {
  clientId: string;
  bucket: "clients" | "prospects";
}

export type Match = { kind: "existing"; found: Found } | { kind: "new" } | { kind: "unclear"; why: string };

const last10 = (p: string | null | undefined) => String(p ?? "").replace(/\D/g, "").slice(-10);

/** Pure: who is this person, given everyone whose email or phone matches. `taken` = ids already used by this order. */
export function matchPerson(byEmail: Found[], byPhone: Found[], taken: string[]): Match {
  const free = (l: Found[]) => l.filter((f) => !taken.includes(f.clientId));
  const e = free(byEmail);
  const p = free(byPhone);
  const ids = [...new Set([...e, ...p].map((f) => f.clientId))];
  if (ids.length === 0) return { kind: "new" };
  if (ids.length > 1) {
    return { kind: "unclear", why: `their email and phone match more than one record (${ids.join(", ")})` };
  }
  return { kind: "existing", found: e[0] ?? p[0] };
}

async function readDoc(file: string): Promise<Record<string, unknown> | null> {
  try {
    return (yaml.load(await fs.readFile(file, "utf8")) ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function findPeople(email: string, phone10: string): Promise<{ byEmail: Found[]; byPhone: Found[] }> {
  const byEmail: Found[] = [];
  const byPhone: Found[] = [];
  for (const bucket of ["clients", "prospects"] as const) {
    const ids = await fs.readdir(path.join(getPlansRoot(), bucket)).catch(() => [] as string[]);
    for (const id of ids) {
      const doc = await readDoc(path.join(getPlansRoot(), bucket, id, "client.yaml"));
      if (!doc) continue;
      if (email && String(doc.email ?? "").trim().toLowerCase() === email) byEmail.push({ clientId: id, bucket });
      if (phone10.length === 10 && last10(String(doc.mobile_number ?? doc.mobile ?? "")) === phone10) byPhone.push({ clientId: id, bucket });
    }
  }
  return { byEmail, byPhone };
}

/** What the order adds to a record. Never overwrites a date of birth, sex (F/M), email or phone already there. */
export function stampFromOrder(doc: Record<string, unknown>, person: OrderPerson, order: BodyAgeOrder): Record<string, unknown> {
  const out = { ...doc };
  if (!out.date_of_birth) out.date_of_birth = person.date_of_birth;
  const sex = String(out.sex ?? "").trim().toUpperCase();
  if (sex !== "F" && sex !== "M") out.sex = person.sex;
  if (!String(out.email ?? "").trim()) out.email = person.email;
  if (!String(out.mobile_number ?? "").trim()) out.mobile_number = person.phone;
  out.collection_address = order.visit.address;
  out.collection_pincode = order.visit.pincode;
  return out;
}

export type PlaceResult = { ok: true; clientIds: string[] } | { ok: false; why: string };

/** Find or create a record for each person on a paid, real order. `forceNew` skips the search (the coach said so). */
export async function placeBodyAgeOrder(order: BodyAgeOrder, forceNew = false): Promise<PlaceResult> {
  if (order.test) return { ok: false, why: "a test order is attached to the test profile by hand" };
  if (order.status === "pending" || order.status === "cancelled") return { ok: false, why: "not paid" };
  if (order.client_ids?.length) return { ok: true, clientIds: order.client_ids };

  // Decide everyone first, so a problem with the second person creates nothing for the first.
  const plan: Match[] = [];
  const taken: string[] = [];
  for (const person of order.people) {
    const m: Match = forceNew
      ? { kind: "new" }
      : await findPeople(person.email, last10(person.phone)).then((f) => matchPerson(f.byEmail, f.byPhone, taken));
    if (m.kind === "unclear") return { ok: false, why: `${person.full_name}: ${m.why}` };
    if (m.kind === "existing") taken.push(m.found.clientId);
    plan.push(m);
  }

  const clientIds: string[] = [];
  for (const [i, person] of order.people.entries()) {
    const m = plan[i];
    let clientId: string;
    if (m.kind === "existing") {
      clientId = m.found.clientId;
      if (m.found.bucket === "prospects") {
        // They just bought something: back out of the parked folder (the move `fmdb prospects-restore` makes).
        await fs.mkdir(path.join(getPlansRoot(), "clients"), { recursive: true });
        await fs.rename(path.join(getPlansRoot(), "prospects", clientId), path.join(getPlansRoot(), "clients", clientId));
      }
    } else {
      const { createProspectRecord } = await import("./booking-lead-intake");
      clientId = await createProspectRecord({
        name: person.full_name,
        email: person.email,
        phone: person.phone,
        leadSource: "body_age_report",
        origin: "body age report order",
      });
    }
    const file = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
    const doc = await readDoc(file);
    if (!doc) return { ok: false, why: `${person.full_name}: the record ${clientId} could not be read` };
    await fs.writeFile(file, dumpYaml(stampFromOrder(doc, person, order), { sortKeys: false }), "utf8");
    clientIds.push(clientId);
  }
  await patchBodyAgeOrder(order.order_id, { client_ids: clientIds });
  return { ok: true, clientIds };
}
