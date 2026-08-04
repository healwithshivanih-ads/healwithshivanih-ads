/**
 * Drug-catalogue alias matching.
 *
 * The bug this pins: a plain substring test let a SHORT alias match inside an
 * unrelated word — 'pan' (the Indian pantoprazole brand Pan-40) matched
 * "recheck thyroid panel" and "Panadol 500", which implies GERD, pulls in
 * B12/magnesium depletion advice, and changes protocol cautions. The letter
 * renderer binds those cautions as HARD RULES, so a phantom match reaches the
 * client.
 *
 * Both halves matter:
 *   - the false positives must stop matching, AND
 *   - the true positives ("Pan-40", "Pan D") must keep matching.
 *
 * The last block asserts the TS matcher and `fmdb/drug_match.py` agree, since
 * the two are hand-mirrored across six callers.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aliasMatches, drugAliases, matchDrug } from "./drug-match";
import { PY_TEST_TIMEOUT_MS, TEST_PYTHON } from "./test-python";

/** Trimmed stand-ins for the real catalogue records. */
const PPI = {
  slug: "proton-pump-inhibitors",
  drug_name: "Proton Pump Inhibitors (PPIs)",
  drug_aliases: ["omeprazole", "pantoprazole", "pan", "pan-d", "pantop", "ppi"],
};
const ARB = {
  slug: "ace-inhibitors-arbs",
  drug_name: "ACE Inhibitors / ARBs",
  drug_aliases: ["telmisartan", "telma", "arb", "ramipril"],
};
const ASPIRIN = {
  slug: "aspirin-chronic",
  drug_name: "Aspirin (chronic low-dose)",
  drug_aliases: ["aspirin", "asa", "ecosprin"],
};
const MONTELUKAST = {
  slug: "montelukast",
  drug_name: "Montelukast",
  drug_aliases: ["montair", "ltra"],
};
const METFORMIN = {
  slug: "metformin",
  drug_name: "Metformin",
  drug_aliases: ["glycomet", "janumet"],
};
const DRUGS = [PPI, ARB, ASPIRIN, MONTELUKAST, METFORMIN];

const slugFor = (med: string) => matchDrug(med, DRUGS)?.drug.slug ?? null;

describe("short aliases do not match inside unrelated words", () => {
  // The two cases named in the report.
  it("'recheck thyroid panel' is not a PPI", () => {
    expect(slugFor("recheck thyroid panel")).toBeNull();
  });

  it("'Panadol 500' is not a PPI", () => {
    expect(slugFor("Panadol 500")).toBeNull();
  });

  it.each([
    ["pancreatic enzymes", "pan"],
    ["Carbamazepine 200mg", "arb"],
    ["Fluticasone nasal spray", "asa"],
    ["Ultracet 1-0-1", "ltra"],
  ])("%s does not match on the '%s' alias", (med) => {
    expect(slugFor(med)).toBeNull();
  });
});

describe("real medications still match", () => {
  it.each([
    ["Pan-40", "proton-pump-inhibitors"],
    ["Pan D", "proton-pump-inhibitors"],
    ["pan", "proton-pump-inhibitors"],
    ["Tab Pan 40 OD", "proton-pump-inhibitors"],
    ["Pantoprazole 40mg", "proton-pump-inhibitors"],
    ["on PPI for 3 years", "proton-pump-inhibitors"],
    ["Telma 40", "ace-inhibitors-arbs"],
    ["ARB (started 2024)", "ace-inhibitors-arbs"],
    ["ASA 75mg", "aspirin-chronic"],
    ["Janumet 50/500 BD", "metformin"],
  ])("%s → %s", (med, slug) => {
    expect(slugFor(med)).toBe(slug);
  });

  it("digits may terminate a short alias — Pan40 without a separator", () => {
    // `\b` would fail here because it treats digits as word characters; the
    // matcher deliberately uses a LETTER boundary instead.
    expect(slugFor("Pan40")).toBe("proton-pump-inhibitors");
  });
});

describe("matcher mechanics", () => {
  it("longest alias wins", () => {
    // Both 'pan' and 'pantoprazole' match; the longer one decides.
    expect(matchDrug("Pantoprazole + pan", DRUGS)?.alias).toBe("pantoprazole");
  });

  it("aliases at or above the boundary length keep substring matching", () => {
    // 'pan-d' is 5 chars, so it is not boundary-guarded and still matches a
    // run-together brand string.
    expect(aliasMatches("pan-d", "tab pan-dsr")).toBe(true);
    expect(aliasMatches("pan", "tab pandsr")).toBe(false);
  });

  it("rejects junk medication strings below the 3-char floor", () => {
    expect(matchDrug("a", DRUGS)).toBeNull();
    expect(matchDrug("", DRUGS)).toBeNull();
  });

  it("dedupes name + aliases, lowercased", () => {
    expect(drugAliases({ drug_name: "Metformin", drug_aliases: ["metformin", "Glycomet"] }))
      .toEqual(["metformin", "glycomet"]);
  });
});

describe("no catalogue alias fires on common non-drug clinical phrases", () => {
  // Guards the whole real catalogue, not just the fixtures — a future short
  // alias that collides with everyday intake wording fails here.
  const PHRASES = [
    "recheck thyroid panel",
    "Panadol 500",
    "full lipid panel",
    "pancreatic enzymes",
    "nasal spray as needed",
    "vitamin D 60k weekly",
  ];

  it(
    "real drug_depletions catalogue",
    () => {
      const script = `
import json, sys, pathlib
sys.path.insert(0, ${JSON.stringify(path.resolve(process.cwd(), "..", "fm-database"))})
import yaml
from fmdb.drug_match import match_drug
d = pathlib.Path(${JSON.stringify(path.resolve(process.cwd(), "..", "fm-database", "data", "drug_depletions"))})
drugs = [yaml.safe_load(p.read_text()) for p in sorted(d.glob("*.yaml")) if not p.name.startswith("_")]
drugs = [x for x in drugs if isinstance(x, dict)]
phrases = json.loads(sys.argv[1])
print(json.dumps({p: (match_drug(p, drugs) or {}).get("slug") for p in phrases}))
`;
      const out = spawnSync(TEST_PYTHON, ["-c", script, JSON.stringify(PHRASES)], {
        encoding: "utf-8",
      });
      expect(out.status, out.stderr).toBe(0);
      const got = JSON.parse(out.stdout.trim()) as Record<string, string | null>;
      for (const phrase of PHRASES) expect(got[phrase], phrase).toBeNull();
    },
    PY_TEST_TIMEOUT_MS,
  );
});

describe("TS and Python matchers agree", () => {
  const CASES = [
    "recheck thyroid panel",
    "Panadol 500",
    "Pan-40",
    "Pan D",
    "Pan40",
    "pan",
    "Carbamazepine 200mg",
    "Fluticasone nasal spray",
    "Ultracet 1-0-1",
    "Telma 40",
    "ASA 75mg",
    "Janumet 50/500 BD",
    "Pantoprazole 40mg",
  ];

  it(
    "same slug for the same fixtures",
    () => {
      const script = `
import json, sys, pathlib
sys.path.insert(0, ${JSON.stringify(path.resolve(process.cwd(), "..", "fm-database"))})
from fmdb.drug_match import match_drug
drugs = json.loads(sys.argv[1])
cases = json.loads(sys.argv[2])
print(json.dumps({c: (match_drug(c, drugs) or {}).get("slug") for c in cases}))
`;
      const out = spawnSync(
        TEST_PYTHON,
        ["-c", script, JSON.stringify(DRUGS), JSON.stringify(CASES)],
        { encoding: "utf-8" },
      );
      expect(out.status, out.stderr).toBe(0);
      const py = JSON.parse(out.stdout.trim()) as Record<string, string | null>;
      const ts = Object.fromEntries(CASES.map((c) => [c, slugFor(c)]));
      expect(py).toEqual(ts);
    },
    PY_TEST_TIMEOUT_MS,
  );
});
