"use server";

/**
 * Sequoya "Founding 20" — coach-side actions behind the FoundingMemberCard.
 *
 *  - setFoundingMember     mark / unmark (records join date + the private
 *                          ₹1,50,000 Sequoya+ rate), then feeds the places
 *                          counter on grow.theochretree.com (best-effort).
 *  - issueFoundingGift     the founder's ONE gifted Foundation session: picks or
 *                          creates the recipient, writes both records, prepares
 *                          the recipient's /foundation/<token> link (app token +
 *                          intake + Fly staging, via startFoundationSession) and
 *                          returns a WhatsApp message the founder can forward.
 *  - revokeFoundingGift    undo a gift the recipient has not started.
 *  - recordGiftStep        call 1 held / call 2 held / joined Sequoya, on the
 *                          recipient — call 2 anchors the 7-day ₹12k credit.
 *
 * Rules live in lib/fmdb/founding.ts (pure, tested). All writes use dumpYaml.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { revalidatePath } from "next/cache";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { dumpYaml } from "@/lib/fmdb/yaml-dump";
import {
  FOUNDING_GIFT_EXPIRES_ON,
  FOUNDING_PLACES,
  FOUNDING_SPLUS_RATE_INR,
  countFoundingMembers,
  firstNameOf,
  foundingGiftOf,
  giftCreditDeadline,
  giftMessage,
  giftProgress,
  giftRefusal,
  giftedSessionOf,
  isFoundingMember,
  ymdOf,
  type GiftProgress,
} from "@/lib/fmdb/founding";
import { pushFoundingCount } from "@/lib/fmdb/founding-counter";
import { foundationSessionPaid } from "@/lib/fmdb/foundation-orders";
import { latestPublishedPlanSlug, startFoundationSession } from "./foundation-session";
import { stageClientAppArtifacts, stageDiscoveryClientArtifacts } from "./letter-token";

type Doc = Record<string, unknown>;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function istTodayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** clients/<id>/client.yaml, or prospects/<id>/client.yaml for a parked person. */
async function clientYamlPath(clientId: string): Promise<string | null> {
  if (!SAFE_ID.test(clientId)) return null;
  for (const bucket of ["clients", "prospects"]) {
    const p = path.join(getPlansRoot(), bucket, clientId, "client.yaml");
    try {
      await fs.access(p);
      return p;
    } catch {
      /* try next bucket */
    }
  }
  return null;
}

async function readDoc(clientId: string): Promise<{ file: string; doc: Doc } | null> {
  const file = await clientYamlPath(clientId);
  if (!file) return null;
  try {
    const doc = (yaml.load(await fs.readFile(file, "utf-8")) ?? {}) as Doc;
    return { file, doc };
  } catch {
    return null;
  }
}

async function writeDoc(file: string, doc: Doc): Promise<void> {
  doc.updated_at = new Date().toISOString();
  await fs.writeFile(file, dumpYaml(doc, { sortKeys: false }), "utf-8");
}

/** Re-project to Fly so the app mark / gift card appear without waiting for
 *  the per-minute refresh. Best-effort. */
async function restage(clientId: string): Promise<void> {
  const slug = await latestPublishedPlanSlug(clientId).catch(() => null);
  if (slug) await stageClientAppArtifacts(clientId, slug).catch(() => {});
  else await stageDiscoveryClientArtifacts(clientId).catch(() => {});
}

async function allClientDocs(): Promise<Doc[]> {
  const dir = path.join(getPlansRoot(), "clients");
  let ids: string[] = [];
  try {
    ids = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: Doc[] = [];
  for (const id of ids) {
    try {
      out.push((yaml.load(await fs.readFile(path.join(dir, id, "client.yaml"), "utf-8")) ?? {}) as Doc);
    } catch {
      /* not a client dir */
    }
  }
  return out;
}

async function foundingCount(): Promise<number> {
  return countFoundingMembers(await allClientDocs());
}

function publicBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://intake.theochretree.com").replace(/\/+$/, "");
}

// ── read ─────────────────────────────────────────────────────────────────────

export interface FoundingState {
  founding: boolean;
  joinedOn: string | null;
  rateInr: number | null;
  placesTaken: number;
  placesTotal: number;
  mobileNumber: string | null;
  firstName: string;
  /** Present when this client was GIVEN a gifted Foundation session. */
  received: {
    founderId: string;
    founderName: string;
    expiresOn: string;
    call1On: string | null;
    call2On: string | null;
    joinedOn: string | null;
    creditDeadline: string | null;
    progress: GiftProgress | null;
  } | null;
  /** People this founder could gift to (not signed up, not already gifted). */
  candidates: { id: string; name: string }[];
  gift: {
    recipientId: string;
    recipientName: string;
    issuedOn: string;
    expiresOn: string;
    link: string | null;
    progress: GiftProgress | null;
  } | null;
}

export async function loadFoundingState(clientId: string): Promise<{ ok: true; state: FoundingState } | { ok: false; error: string }> {
  const rec = await readDoc(clientId);
  if (!rec) return { ok: false, error: "client_not_found" };
  const { doc } = rec;
  const issued = foundingGiftOf(doc);
  let gift: FoundingState["gift"] = null;
  if (issued) {
    const r = await readDoc(issued.recipient_client_id);
    const token = typeof r?.doc.app_token === "string" ? r.doc.app_token : "";
    gift = {
      recipientId: issued.recipient_client_id,
      recipientName:
        (typeof r?.doc.display_name === "string" && r.doc.display_name) || issued.recipient_client_id,
      issuedOn: issued.issued_on,
      expiresOn: issued.expires_on,
      link: token ? `${publicBase()}/foundation/${token}` : null,
      progress: r ? giftProgress(r.doc, istTodayYmd()) : null,
    };
  }
  const received = giftedSessionOf(doc);
  const rate = typeof doc.founding_splus_rate_inr === "number" ? doc.founding_splus_rate_inr : null;
  const all = await allClientDocs();
  const candidates =
    isFoundingMember(doc) && !issued
      ? all
          .filter((d) => {
            const id = typeof d.client_id === "string" ? d.client_id : "";
            const es = typeof d.engagement_status === "string" ? d.engagement_status.trim() : "";
            return id && id !== clientId && es !== "signed_up" && !isFoundingMember(d) && !giftedSessionOf(d);
          })
          .map((d) => ({ id: String(d.client_id), name: String(d.display_name || d.client_id) }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];
  return {
    ok: true,
    state: {
      founding: isFoundingMember(doc),
      joinedOn: ymdOf(doc.founding_joined_on),
      rateInr: rate,
      placesTaken: countFoundingMembers(all),
      placesTotal: FOUNDING_PLACES,
      mobileNumber: typeof doc.mobile_number === "string" ? doc.mobile_number : null,
      firstName: firstNameOf(doc),
      received: received
        ? {
            founderId: received.gifted_by,
            founderName: received.gifted_by_name,
            expiresOn: received.expires_on,
            call1On: received.call_1_on,
            call2On: received.call_2_on,
            joinedOn: received.joined_on,
            creditDeadline: giftCreditDeadline(received),
            progress: giftProgress(doc, istTodayYmd()),
          }
        : null,
      candidates,
      gift,
    },
  };
}

// ── mark / unmark ────────────────────────────────────────────────────────────

export async function setFoundingMember(
  clientId: string,
  input: { founding: boolean; joinedOn?: string; rateInr?: number },
): Promise<
  | { ok: true; placesTaken: number; counter: { ok: boolean; error?: string } }
  | { ok: false; error: string }
> {
  const rec = await readDoc(clientId);
  if (!rec) return { ok: false, error: "client_not_found" };
  const { file, doc } = rec;

  if (input.founding) {
    const joinedOn = input.joinedOn ?? istTodayYmd();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(joinedOn)) return { ok: false, error: "join date must be YYYY-MM-DD" };
    const rate = input.rateInr ?? (typeof doc.founding_splus_rate_inr === "number" ? doc.founding_splus_rate_inr : FOUNDING_SPLUS_RATE_INR);
    if (!Number.isInteger(rate) || rate <= 0) return { ok: false, error: "rate must be a whole number of rupees" };
    if (!isFoundingMember(doc)) {
      const others = await foundingCount();
      if (others >= FOUNDING_PLACES) {
        return { ok: false, error: `all ${FOUNDING_PLACES} founding places are taken` };
      }
    }
    doc.founding_member = true;
    doc.founding_joined_on = joinedOn;
    doc.founding_splus_rate_inr = rate;
  } else {
    if (!isFoundingMember(doc)) return { ok: false, error: "not a founding member" };
    if (foundingGiftOf(doc)) {
      return { ok: false, error: "this founder has gifted a Foundation session — revoke the gift first (only possible before the recipient starts)" };
    }
    delete doc.founding_member;
    delete doc.founding_joined_on;
    delete doc.founding_splus_rate_inr;
  }
  await writeDoc(file, doc);
  await restage(clientId);

  const placesTaken = await foundingCount();
  const counter = await pushFoundingCount(placesTaken);
  revalidatePath(`/clients-v2/${clientId}`);
  return { ok: true, placesTaken, counter: counter.ok ? { ok: true } : { ok: false, error: counter.error } };
}

// ── the gift ─────────────────────────────────────────────────────────────────

export async function issueFoundingGift(
  founderId: string,
  recipient:
    | { kind: "existing"; clientId: string }
    | { kind: "new"; name: string; mobile?: string; email?: string },
): Promise<
  | { ok: true; recipientId: string; link: string; waText: string; founderMobile: string | null }
  | { ok: false; error: string }
> {
  const founderRec = await readDoc(founderId);
  if (!founderRec) return { ok: false, error: "founder not found" };
  const today = istTodayYmd();

  let recipientId: string | null = null;
  let recipientDoc: Doc | null = null;
  if (recipient.kind === "existing") {
    recipientId = recipient.clientId.trim();
    const r = await readDoc(recipientId);
    if (!r) return { ok: false, error: `no client ${recipientId}` };
    recipientDoc = r.doc;
  } else {
    const name = recipient.name.trim();
    if (!name) return { ok: false, error: "recipient name is required" };
    if (!recipient.mobile?.trim() && !recipient.email?.trim()) {
      return { ok: false, error: "add a mobile number or email for the recipient" };
    }
  }

  const refusal = giftRefusal({
    founderId,
    founder: founderRec.doc,
    recipientId,
    recipient: recipientDoc,
    recipientHasPaidFoundation: recipientId ? (await foundationSessionPaid(recipientId)).paid : false,
    recipientHasPublishedPlan: recipientId ? !!(await latestPublishedPlanSlug(recipientId)) : false,
    todayYmd: today,
  });
  if (refusal) return { ok: false, error: refusal };

  if (recipient.kind === "new") {
    const { createProspectRecord } = await import("@/lib/fmdb/booking-lead-intake");
    recipientId = await createProspectRecord({
      name: recipient.name.trim(),
      email: recipient.email?.trim() || null,
      phone: recipient.mobile?.trim() || null,
      leadSource: "founding_gift",
      origin: `Sequoya founding gift from ${firstNameOf(founderRec.doc)} (${founderId})`,
    });
  }
  if (!recipientId) return { ok: false, error: "could not resolve the recipient" };

  // Recipient side first: if the founder write then failed, the recipient
  // would hold a gift nobody issued — visible on their card, easy to undo.
  const r = await readDoc(recipientId);
  if (!r) return { ok: false, error: "recipient record missing after create" };
  const founderFirst = firstNameOf(founderRec.doc, "a friend");
  r.doc.gifted_foundation_session = {
    gifted_by: founderId,
    gifted_by_name: founderFirst,
    issued_on: today,
    expires_on: FOUNDING_GIFT_EXPIRES_ON,
  };
  await writeDoc(r.file, r.doc);

  founderRec.doc.founding_gift = {
    recipient_client_id: recipientId,
    issued_on: today,
    expires_on: FOUNDING_GIFT_EXPIRES_ON,
  };
  await writeDoc(founderRec.file, founderRec.doc);

  // App token + full intake token + Fly staging — the same preparation a paid
  // Foundation client gets. The page reads gifted_foundation_session and shows
  // the gift instead of the pay step.
  const prep = await startFoundationSession(recipientId);
  if (!prep.ok) return { ok: false, error: `gift recorded, but the link could not be prepared: ${prep.error}` };

  const waText = giftMessage({
    founderFirst,
    recipientFirst: firstNameOf(r.doc),
    url: prep.payUrl,
    expiresOn: FOUNDING_GIFT_EXPIRES_ON,
  });
  revalidatePath(`/clients-v2/${founderId}`);
  revalidatePath(`/clients-v2/${recipientId}`);
  return {
    ok: true,
    recipientId,
    link: prep.payUrl,
    waText,
    founderMobile: typeof founderRec.doc.mobile_number === "string" ? founderRec.doc.mobile_number : null,
  };
}

/** Re-build the forwardable message for an already-issued gift. */
export async function foundingGiftMessage(
  founderId: string,
): Promise<{ ok: true; waText: string; link: string } | { ok: false; error: string }> {
  const f = await readDoc(founderId);
  const issued = f ? foundingGiftOf(f.doc) : null;
  if (!f || !issued) return { ok: false, error: "no gift issued" };
  const r = await readDoc(issued.recipient_client_id);
  const token = typeof r?.doc.app_token === "string" ? r.doc.app_token : "";
  if (!r || !token) return { ok: false, error: "recipient link not ready" };
  const link = `${publicBase()}/foundation/${token}`;
  return {
    ok: true,
    link,
    waText: giftMessage({
      founderFirst: firstNameOf(f.doc, "a friend"),
      recipientFirst: firstNameOf(r.doc),
      url: link,
      expiresOn: issued.expires_on,
    }),
  };
}

export async function revokeFoundingGift(founderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const f = await readDoc(founderId);
  const issued = f ? foundingGiftOf(f.doc) : null;
  if (!f || !issued) return { ok: false, error: "no gift issued" };
  const r = await readDoc(issued.recipient_client_id);
  if (r) {
    const g = giftedSessionOf(r.doc);
    if (g && (g.call_1_on || g.call_2_on || g.joined_on || ymdOf(r.doc.intake_submitted_at))) {
      return { ok: false, error: "the recipient has already started — the gift can no longer be revoked" };
    }
    if (g && g.gifted_by === founderId) {
      delete r.doc.gifted_foundation_session;
      await writeDoc(r.file, r.doc);
      await restage(issued.recipient_client_id);
    }
  }
  delete f.doc.founding_gift;
  await writeDoc(f.file, f.doc);
  revalidatePath(`/clients-v2/${founderId}`);
  return { ok: true };
}

export async function recordGiftStep(
  recipientId: string,
  step: "call_1" | "call_2" | "joined",
  onDate: string,
): Promise<{ ok: true; progress: GiftProgress | null } | { ok: false; error: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) return { ok: false, error: "date must be YYYY-MM-DD" };
  if (onDate > istTodayYmd()) return { ok: false, error: "that has not happened yet" };
  const r = await readDoc(recipientId);
  if (!r) return { ok: false, error: "recipient not found" };
  const g = r.doc.gifted_foundation_session as Doc | undefined;
  if (!g || !giftedSessionOf(r.doc)) return { ok: false, error: "this person holds no gifted Foundation session" };
  const cur = giftedSessionOf(r.doc)!;
  if (step === "call_2" && !cur.call_1_on) return { ok: false, error: "record the first call first" };
  if (step === "call_2" && cur.call_1_on && onDate < cur.call_1_on) return { ok: false, error: "the second call can't be before the first" };
  const key = step === "call_1" ? "call_1_on" : step === "call_2" ? "call_2_on" : "joined_on";
  g[key] = onDate;
  await writeDoc(r.file, r.doc);
  if (step === "call_2") {
    // The lab-review call is the one that reveals the Starting Map in their
    // app — same marker a paid Foundation client gets (idempotent there).
    const { markDiscoveryCallDoneAction } = await import("./app-token");
    await markDiscoveryCallDoneAction(recipientId, onDate).catch(() => {});
  }
  await restage(recipientId);
  const founderId = cur.gifted_by;
  revalidatePath(`/clients-v2/${founderId}`);
  revalidatePath(`/clients-v2/${recipientId}`);
  return { ok: true, progress: giftProgress(r.doc, istTodayYmd()) };
}
