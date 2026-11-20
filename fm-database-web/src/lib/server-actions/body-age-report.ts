"use server";

/**
 * Body age report (coach-side): build one person's report PDF and the email it arrives in, as DRAFT files.
 *
 * Runs `scripts/body-age-report.py` ($0, no API, no sends). The script itself refuses a real buyer before the
 * launch (Sat 2 Jan 2027, 20:00 IST) and builds the test profile only until then, so this action adds no gate of
 * its own: it passes the script's answer on. Nothing here emails anyone; the coach downloads the PDF and sends it
 * herself.
 *
 * `record: true` also writes the report to the person's record (report entry, the 14-day Foundation credit, the
 * segment). Leave it off for a look; turn it on for the one that is actually going out.
 */

import { runShim } from "@/lib/fmdb/shim";
import {
  toBodyAgeView,
  type BodyAgeKind,
  type BodyAgeResult,
  type BodyAgeShimResult,
} from "@/lib/fmdb/body-age-report-view";

export async function buildBodyAgeReport(
  clientId: string,
  kind: BodyAgeKind,
  record = false,
): Promise<BodyAgeResult> {
  if (!/^[\w-]+$/.test(clientId)) return { ok: false, error: "bad client id" };
  if (kind !== "standard" && kind !== "deeper") return { ok: false, error: "kind must be standard or deeper" };
  try {
    // Chrome renders the PDF and the email images: allow three minutes.
    const raw = (await runShim("body-age-report.py", { client_id: clientId, kind, record }, 180_000)) as BodyAgeShimResult;
    return toBodyAgeView(clientId, kind, raw);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "the report could not be built" };
  }
}
