/**
 * The follow-up scan end to end, over a real temp plans root:
 *
 *   - a PARKED prospect (prospects/<id>/) still gets their due touch — the
 *     scan used to read clients/ only, so the sweep silently ended sequences;
 *   - the day-1 draft carries the content-library item matched to their
 *     interests, and records which item it claimed;
 *   - an item that has not premiered yet is never put in a draft.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/api/whatsapp/actions", () => ({
  loadCommunicationThreadAction: async () => [],
  recordOutboundMessageAction: async () => ({ ok: true }),
}));
vi.mock("@/app/api/email/actions", () => ({ sendClientEmailAction: async () => ({ ok: true }) }));
vi.mock("@/lib/fmdb/foundation-orders", () => ({ foundationSessionPaid: async () => ({ paid: false }) }));
vi.mock("@/lib/fmdb/founding", () => ({ giftedSessionOf: () => null }));

import { scanDiscoveryFollowupAction } from "./discovery-followup";

let root: string;
let cat: string;
const prev: Record<string, string | undefined> = {};

function istToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
}
function daysAgo(n: number): string {
  const d = new Date(`${istToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const HUMAN_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
function bookedLine(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `Booked 15 min Discover call for Tue, ${d} ${HUMAN_MONTH[m - 1]}, ${y}, 11:00 am IST.`;
}

function writePerson(bucket: "clients" | "prospects", id: string, callYmd: string, interests: unknown[]) {
  const dir = path.join(root, bucket, id);
  fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "client.yaml"),
    yaml.dump({
      client_id: id,
      display_name: "Asha Test",
      email: "asha@example.com",
      engagement_status: "pending",
      interests,
    }),
  );
  fs.writeFileSync(
    path.join(dir, "sessions", `${id}-${callYmd}-001.yaml`),
    yaml.dump({
      presenting_complaints: "[session_type: quick_note] [source: booking_form] Bloating",
      coach_notes: [
        bookedLine(callYmd),
        "",
        "What they told us on the booking form:",
        "- How long has this been going on?",
        "  1 to 3 years",
        "- What is your main area of concern?",
        "  Bloating after meals",
      ].join("\n"),
    }),
  );
}

function writeLibrary(items: unknown[]) {
  fs.writeFileSync(path.join(cat, "_content_library.yaml"), yaml.dump({ items }));
}

const LIVE_GUT_VIDEO = {
  id: "gut-video",
  kind: "video",
  title: "Why You Bloat",
  url: "https://youtu.be/GUTGUT",
  concerns: ["gut"],
  live_from: "2026-01-01",
  stage: "first",
  line: "Why bloating happens and what eases it.",
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "followup-scan-"));
  cat = fs.mkdtempSync(path.join(os.tmpdir(), "followup-cat-"));
  for (const b of ["clients", "prospects", "drafts", "ready", "published"]) fs.mkdirSync(path.join(root, b));
  for (const k of ["FMDB_PLANS_DIR", "FMDB_CATALOGUE_DIR"]) prev[k] = process.env[k];
  process.env.FMDB_PLANS_DIR = root;
  process.env.FMDB_CATALOGUE_DIR = cat;
});

afterEach(() => {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(cat, { recursive: true, force: true });
});

function readState(bucket: string, id: string) {
  return yaml.load(fs.readFileSync(path.join(root, bucket, id, "_discovery_followup.yaml"), "utf-8")) as {
    touches: Array<{ touch: number; status: string; body?: string; content_id?: string }>;
  };
}

describe("scanDiscoveryFollowupAction", () => {
  it("drafts the day-1 touch for a parked prospect, with the matched video", async () => {
    writeLibrary([LIVE_GUT_VIDEO]);
    writePerson("prospects", "cl-950", daysAgo(1), [{ concern: "gut", source: "booking_form", at: daysAgo(2) }]);

    const res = await scanDiscoveryFollowupAction();
    expect(res.drafted).toBe(1);

    const st = readState("prospects", "cl-950");
    const t1 = st.touches.find((t) => t.touch === 1)!;
    expect(t1.status).toBe("pending");
    expect(t1.content_id).toBe("gut-video");
    expect(t1.body).toContain("https://youtu.be/GUTGUT");
    // The concern quoted is the concern answer, not the duration answer.
    expect(t1.body).not.toContain("1 to 3 years");
  });

  it("never drafts an item that has not premiered", async () => {
    writeLibrary([{ ...LIVE_GUT_VIDEO, live_from: "2099-01-01" }]);
    writePerson("clients", "cl-951", daysAgo(1), [{ concern: "gut", source: "booking_form", at: daysAgo(2) }]);

    await scanDiscoveryFollowupAction();
    const t1 = readState("clients", "cl-951").touches.find((t) => t.touch === 1)!;
    expect(t1.content_id).toBeUndefined();
    expect(t1.body).not.toContain("http");
  });

  it("does not send content for a concern the coach dismissed", async () => {
    writeLibrary([LIVE_GUT_VIDEO]);
    writePerson("clients", "cl-952", daysAgo(1), [
      { concern: "gut", source: "booking_form", at: daysAgo(2), dismissed: true },
    ]);
    await scanDiscoveryFollowupAction();
    const t1 = readState("clients", "cl-952").touches.find((t) => t.touch === 1)!;
    expect(t1.content_id).toBeUndefined();
  });
});
