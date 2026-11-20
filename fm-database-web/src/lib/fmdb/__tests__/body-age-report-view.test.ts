import { describe, expect, it } from "vitest";
import { bodyAgeFileUrl, outcomeLabel, toBodyAgeView } from "../body-age-report-view";

const DIR = "/Users/x/fm-plans/clients/cl-900/files/body-age/BA-20261120-cl-900-S";

describe("body age report: what the coach card shows", () => {
  it("turns the script's files into coach-only links", () => {
    const v = toBodyAgeView("cl-900", "standard", {
      ok: true,
      ready: true,
      blockers: [],
      warnings: [],
      soon: [],
      report: { outcome: "foundation" },
      files: { pdf: `${DIR}/Body-age-report-R.pdf`, html: `${DIR}/report.html`, email_preview: `${DIR}/email-preview.html` },
      pages: 16,
      recorded: false,
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.reportNo).toBe("BA-20261120-cl-900-S");
    expect(v.pdfUrl).toBe("/api/body-age-file/cl-900/BA-20261120-cl-900-S/Body-age-report-R.pdf");
    expect(v.emailUrl).toBe("/api/body-age-file/cl-900/BA-20261120-cl-900-S/email-preview.html");
    expect(v.ready).toBe(true);
    expect(v.pages).toBe(16);
  });

  it("is not ready unless the script says so, and passes the blockers on", () => {
    const v = toBodyAgeView("cl-900", "deeper", {
      ok: true,
      blockers: ["needs wording: phosphorus"],
      files: { html: `${DIR}/report.html` },
    });
    expect(v.ok && v.ready).toBe(false);
    expect(v.ok && v.blockers).toEqual(["needs wording: phosphorus"]);
    expect(v.ok && v.pdfUrl).toBeNull(); // no PDF was made: no link
  });

  it("passes the script's refusal on in its own words", () => {
    const msg = "the report carries the brand name, which is embargoed until Sat 2 Jan 2027, 20:00 IST.";
    expect(toBodyAgeView("cl-001", "standard", { ok: false, error: msg })).toEqual({ ok: false, error: msg });
  });

  it("never builds a link out of anything but plain names", () => {
    expect(bodyAgeFileUrl("cl-900", "BA-1", "/a/b/../../etc/passwd")).toBe("/api/body-age-file/cl-900/BA-1/passwd");
    expect(bodyAgeFileUrl("cl-900", "../x", "/a/report.pdf")).toBeNull();
    expect(bodyAgeFileUrl("cl/900", "BA-1", "/a/report.pdf")).toBeNull();
    expect(bodyAgeFileUrl("cl-900", "BA-1", "/a/.hidden.pdf")).toBeNull();
    expect(bodyAgeFileUrl("cl-900", "BA-1", "/a/x\\y.pdf")).toBeNull();
    // the attachment name the buyer sees has spaces and commas
    expect(bodyAgeFileUrl("cl-900", "BA-S-900-260704", "/a/Body age report, Ochre, 4 July 2026.pdf")).toBe(
      "/api/body-age-file/cl-900/BA-S-900-260704/Body%20age%20report%2C%20Ochre%2C%204%20July%202026.pdf",
    );
    expect(bodyAgeFileUrl("cl-900", "BA-1", undefined)).toBeNull();
  });

  it("never calls a result urgent in the coach's label", () => {
    for (const o of ["nothing", "self", "foundation", "doctor_only", "doctor_soon"]) {
      expect(outcomeLabel(o)).not.toMatch(/urgent|emergency/i);
    }
    expect(outcomeLabel("doctor_soon")).toMatch(/next day or two/);
  });
});
