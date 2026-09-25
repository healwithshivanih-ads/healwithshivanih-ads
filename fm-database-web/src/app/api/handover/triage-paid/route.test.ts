import { vi, describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "triage-paid-"));
vi.hoisted(() => {
  process.env.TRIAGE_NOTIFY_SECRET = "s3cret";
});
process.env.FMDB_PLANS_DIR = ROOT;
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/server-actions/letter-token", () => ({ stageDiscoveryClientArtifacts: async () => {} }));
vi.mock("@/lib/server-actions/assess", () => ({ saveSessionAction: async () => ({ ok: true }) }));
vi.mock("@/lib/fmdb/booking-lead-intake", () => ({
  createProspectRecord: async () => {
    const dir = path.join(ROOT, "clients", "cl-new");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "client.yaml"), "client_id: cl-new\nengagement_status: pending\n");
    return "cl-new";
  },
}));

function person(bucket: string, id: string, email: string, phone: string) {
  const dir = path.join(ROOT, bucket, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "client.yaml"), `client_id: ${id}\nemail: ${email}\nmobile_number: '${phone}'\n`);
}

async function post(body: Record<string, unknown>, secret = "s3cret") {
  const { POST } = await import("./route");
  const raw = JSON.stringify(body);
  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const res = await POST(
    new Request("http://x/api/handover/triage-paid", { method: "POST", body: raw, headers: { "x-handover-signature": sig } }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const base = { source: "ochre-funnel", paid_at: "2026-09-24T09:00:00.000Z", amount_inr: 999 };
const read = (bucket: string, id: string) =>
  fs.readFileSync(path.join(ROOT, bucket, id, "client.yaml"), "utf8");

describe("POST /api/handover/triage-paid", () => {
  beforeAll(() => {
    person("clients", "cl-a", "asha@example.com", "+919811111111");
    person("clients", "cl-b", "bina@example.com", "+919822222222");
    person("prospects", "cl-p", "parked@example.com", "+919833333333");
  });

  it("refuses a bad signature and an unknown source", async () => {
    expect((await post({ ...base, payment_id: "pay_BAD001", first_name: "X", email: "x@y.z" }, "nope")).status).toBe(401);
    expect((await post({ ...base, source: "evil", payment_id: "pay_BAD002", first_name: "X", email: "x@y.z" })).status).toBe(401);
  });

  it("stamps the credit on the matching person, once", async () => {
    const r = await post({ ...base, payment_id: "pay_A00001", first_name: "Asha", email: "ASHA@example.com" });
    expect(r.body).toMatchObject({ ok: true, outcome: "recorded", clientId: "cl-a" });
    expect(read("clients", "cl-a")).toContain("triage_payment_id: pay_A00001");
    const again = await post({ ...base, payment_id: "pay_A00001", first_name: "Asha", email: "asha@example.com" });
    expect(again.body).toMatchObject({ outcome: "already_recorded" });
  });

  it("matches on phone alone (last 10 digits)", async () => {
    const r = await post({ ...base, payment_id: "pay_B00001", first_name: "Bina", phone: "9822222222" });
    expect(r.body).toMatchObject({ outcome: "recorded", clientId: "cl-b" });
  });

  it("brings a parked prospect back into clients/", async () => {
    const r = await post({ ...base, payment_id: "pay_P00001", first_name: "Parked", email: "parked@example.com" });
    expect(r.body).toMatchObject({ outcome: "restored", clientId: "cl-p" });
    expect(fs.existsSync(path.join(ROOT, "clients", "cl-p", "client.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "prospects", "cl-p"))).toBe(false);
  });

  it("creates a prospect when nobody matches", async () => {
    const r = await post({ ...base, payment_id: "pay_N00001", first_name: "New", email: "new@example.com" });
    expect(r.body).toMatchObject({ outcome: "created", clientId: "cl-new" });
    expect(read("clients", "cl-new")).toContain("triage_paid_at");
  });

  it("stops — and returns 200 so it is not retried — when email and phone name different people", async () => {
    const r = await post({ ...base, payment_id: "pay_C00001", first_name: "Mix", email: "asha@example.com", phone: "+919822222222" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, outcome: "conflict" });
  });

  it("lists the conflict for the dashboard with both candidates named", async () => {
    const { listUnplacedTriagePayments } = await import("@/lib/fmdb/triage-payment-intake");
    const rows = await listUnplacedTriagePayments();
    const row = rows.find((r) => r.paymentId === "pay_C00001")!;
    expect(row.outcome).toBe("conflict");
    expect(row.candidates.map((c) => c.clientId).sort()).toEqual(["cl-a", "cl-b"]);
  });

  it("placing it credits the chosen person and clears it from the list", async () => {
    const m = await import("@/lib/fmdb/triage-payment-intake");
    expect(await m.resolveTriagePayment("pay_C00001", "cl-b")).toEqual({ ok: true });
    expect(read("clients", "cl-b")).toContain("triage_paid_at");
    expect((await m.listUnplacedTriagePayments()).some((r) => r.paymentId === "pay_C00001")).toBe(false);
    // a redelivery from the funnel is now a no-op on the chosen person
    const again = await post({ ...base, payment_id: "pay_C00001", first_name: "Mix", email: "asha@example.com", phone: "+919822222222" });
    expect(again.body).toMatchObject({ outcome: "already_recorded", clientId: "cl-b" });
  });

  it("dismissing clears it without crediting anyone", async () => {
    const m = await import("@/lib/fmdb/triage-payment-intake");
    await post({ ...base, payment_id: "pay_I00001", first_name: "" , email: "" });
    expect((await m.listUnplacedTriagePayments()).some((r) => r.paymentId === "pay_I00001")).toBe(true);
    expect(await m.dismissTriagePayment("pay_I00001")).toEqual({ ok: true });
    expect((await m.listUnplacedTriagePayments()).some((r) => r.paymentId === "pay_I00001")).toBe(false);
  });
});
