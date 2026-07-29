/**
 * Parking a non-signed-up person must never look like deleting them.
 *
 * `fmdb prospects-sweep` MOVES people who never signed up and have gone quiet
 * out of `clients/` and into `prospects/`, so roster counts, scans and crons
 * stop treating them as active. That is a destructive-looking operation on PHI,
 * so the properties worth pinning are the ones that would quietly lose a real
 * client or a real record:
 *
 *   - a signed-up client is NEVER parked, whatever else is true of them
 *   - a fresh lead inside the grace window stays put (you're still chasing them)
 *   - a record with no engagement_status is treated as NOT signed up
 *   - sessions and files survive the move
 *   - the record still resolves BY ID afterwards (storage.client_dir)
 *   - running it twice changes nothing
 *   - signing up brings them straight back
 *
 * Drives the real Python module, not a re-implementation.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PY_TEST_TIMEOUT_MS, TEST_PYTHON } from "./test-python";
import { findUnevidencedSignups } from "./engagement";

const FMDB = path.resolve(__dirname, "../../../../fm-database");

/** Build a throwaway plans tree, run the sweep, and report what happened. */
function runScenario(script: string): Record<string, unknown> {
  const src = `
import json, sys, tempfile, pathlib, shutil, datetime, yaml
from fmdb.plan import prospects, storage

tmp = pathlib.Path(tempfile.mkdtemp())
TODAY = datetime.date(2026, 7, 29)

def mk(cid, status, day, sessions=1, files=0, submitted=None, plan=False):
    d = tmp / "clients" / cid
    (d / "sessions").mkdir(parents=True)
    (d / "files").mkdir(exist_ok=True)
    # Every field Client requires — the read-back assertion below goes through
    # the real Pydantic model, which rejects a partial record.
    rec = {
        "client_id": cid, "display_name": cid, "intake_date": day, "sex": "F",
        "created_at": day + "T00:00:00Z", "updated_at": day + "T00:00:00Z",
        "updated_by": "test",
    }
    if status is not None:
        rec["engagement_status"] = status
    if submitted is not None:
        rec["intake_submitted_at"] = submitted
    (d / "client.yaml").write_text(yaml.safe_dump(rec))
    for i in range(sessions):
        (d / "sessions" / f"{cid}-{day}-00{i+1}.yaml").write_text("date: " + day)
    for i in range(files):
        (d / "files" / f"note{i}.txt").write_text("x")
    if plan:
        (tmp / "published").mkdir(exist_ok=True)
        (tmp / "published" / f"{cid}-plan.yaml").write_text(yaml.safe_dump({"client_id": cid}))

def sweep(**kw):
    return prospects.sweep(tmp, today=TODAY, apply=True, **kw)

def review(**kw):
    return prospects.unevidenced_signups(tmp, today=TODAY, **kw)

def bucket(cid):
    return storage.client_dir(tmp, cid).parent.name

def ids(rep, key):
    return sorted(r["client_id"] for r in rep.get(key, []))

out = {}
${script}
print(json.dumps(out, default=str))
shutil.rmtree(tmp)
`;
  const raw = execFileSync(TEST_PYTHON, ["-c", src], {
    cwd: FMDB,
    env: { ...process.env, PYTHONPATH: FMDB },
    encoding: "utf8",
  });
  return JSON.parse(raw);
}

describe("prospects sweep", () => {
  it(
    "parks the cold, keeps the fresh, and never touches a signed-up client",
    () => {
      const out = runScenario(`
mk("cold",   "pending",   "2026-05-01")   # 89d quiet
mk("fresh",  "pending",   "2026-07-25")   # 4d quiet — still being chased
mk("client", "signed_up", "2026-01-01")   # ancient but enrolled
rep = sweep()
out["parked"] = ids(rep, "moved")
out["kept"] = ids(rep, "kept")
out["client_bucket"] = bucket("client")
`);
      expect(out.parked).toEqual(["cold"]);
      expect(out.kept).toEqual(["fresh"]);
      // The whole point: enrolment beats inactivity. A quiet client is still a
      // client — dormancy is handled elsewhere, not by exiling them.
      expect(out.client_bucket).toBe("clients");
    },
    PY_TEST_TIMEOUT_MS
  );

  it(
    "treats a missing engagement_status as NOT signed up",
    () => {
      // cl-014 and cl-017 really did have no such field. Absence must not be
      // read as enrolment — but note the flip side is also safe here: the
      // grace window still protects a recently-created record.
      const out = runScenario(`
mk("nofield_old",   None, "2026-05-01")
mk("nofield_fresh", None, "2026-07-25")
rep = sweep()
out["parked"] = ids(rep, "moved")
out["kept"] = ids(rep, "kept")
`);
      expect(out.parked).toEqual(["nofield_old"]);
      expect(out.kept).toEqual(["nofield_fresh"]);
    },
    PY_TEST_TIMEOUT_MS
  );

  it(
    "keeps the record readable by id, with sessions and files intact",
    () => {
      const out = runScenario(`
mk("cold", "pending", "2026-05-01", sessions=3, files=2)
sweep()
d = storage.client_dir(tmp, "cold")
out["bucket"] = d.parent.name
out["sessions"] = len(list((d / "sessions").glob("*.yaml")))
out["files"] = len(list((d / "files").glob("*")))
out["loads"] = storage.load_client(tmp, "cold").client_id
`);
      // Parking is a move, not a delete: nothing about the person is lost and
      // their page must still open.
      expect(out.bucket).toBe("prospects");
      expect(out.sessions).toBe(3);
      expect(out.files).toBe(2);
      expect(out.loads).toBe("cold");
    },
    PY_TEST_TIMEOUT_MS
  );

  it(
    "is idempotent — a second run is a no-op, not an error",
    () => {
      const out = runScenario(`
mk("cold", "pending", "2026-05-01")
sweep()
rep2 = sweep()
out["second_parked"] = ids(rep2, "moved")
out["errors"] = rep2["errors"]
`);
      expect(out.second_parked).toEqual([]);
      expect(out.errors).toEqual([]);
    },
    PY_TEST_TIMEOUT_MS
  );

  it(
    "brings someone back the moment they sign up",
    () => {
      const out = runScenario(`
mk("cold", "pending", "2026-05-01")
sweep()
p = tmp / "prospects" / "cold" / "client.yaml"
d = yaml.safe_load(p.read_text()); d["engagement_status"] = "signed_up"
p.write_text(yaml.safe_dump(d))
rep = sweep()
out["restored"] = ids(rep, "restored")
out["bucket"] = bucket("cold")
`);
      // Self-healing: even if the web app's un-park missed, the sweep repairs
      // it rather than leaving a paying client outside the roster.
      expect(out.restored).toEqual(["cold"]);
      expect(out.bucket).toBe("clients");
    },
    PY_TEST_TIMEOUT_MS
  );

  it(
    "never parks a signed-up record, however unevidenced — that's report-only",
    () => {
      // The bug this prevents: auto-correcting an over-generous signed_up would
      // exile a genuinely paying client over a missing intake field. Far worse
      // than a roster that reads one too high.
      const out = runScenario(`
mk("anita_like", "signed_up", "2026-07-05")
flagged = review()
out["flagged"] = sorted(r["client_id"] for r in flagged)
out["quiet"] = flagged[0]["quiet_days"] if flagged else None
rep = sweep()
out["parked"] = ids(rep, "moved")
out["bucket"] = bucket("anita_like")
`);
      expect(out.flagged).toEqual(["anita_like"]);
      expect(out.quiet).toBe(24);
      // Flagged for review, but NOT moved.
      expect(out.parked).toEqual([]);
      expect(out.bucket).toBe("clients");
    },
    PY_TEST_TIMEOUT_MS
  );

  it(
    "the roster review agrees with the TypeScript implementation",
    () => {
      // The rule is written twice (Python CLI + TS dashboard chip) because the
      // dashboard cannot shell out per render. Pin that they agree, or they
      // drift and the chip starts disagreeing with the terminal.
      const out = runScenario(`
mk("unevidenced",  "signed_up", "2026-07-05")
mk("has_intake",   "signed_up", "2026-05-01", submitted="2026-05-02T00:00:00Z")
mk("has_plan",     "signed_up", "2026-05-01", plan=True)
mk("fresh_signup", "signed_up", "2026-07-25")
mk("a_prospect",   "pending",   "2026-05-01")
out["py"] = sorted(r["client_id"] for r in review())
`);

      const ts = findUnevidencedSignups(
        [
          { client_id: "unevidenced", engagement_status: "signed_up", last_touch: "2026-07-05" },
          {
            client_id: "has_intake",
            engagement_status: "signed_up",
            intake_submitted_at: "2026-05-02T00:00:00Z",
            last_touch: "2026-05-01",
          },
          { client_id: "has_plan", engagement_status: "signed_up", last_touch: "2026-05-01" },
          { client_id: "fresh_signup", engagement_status: "signed_up", last_touch: "2026-07-25" },
          { client_id: "a_prospect", engagement_status: "pending", last_touch: "2026-05-01" },
        ],
        new Set(["has_plan"]),
        "2026-07-29"
      ).map((r) => r.client_id);

      expect(out.py).toEqual(["unevidenced"]);
      expect(ts).toEqual(out.py);
    },
    PY_TEST_TIMEOUT_MS
  );

  it(
    "honours a custom quiet window",
    () => {
      const out = runScenario(`
mk("m", "pending", "2026-07-09")   # 20d quiet
out["at_15"] = ids(sweep(quiet_after_days=15), "moved")
`);
      expect(out.at_15).toEqual(["m"]);

      const out2 = runScenario(`
mk("m", "pending", "2026-07-09")   # 20d quiet
out["at_30"] = ids(sweep(quiet_after_days=30), "moved")
`);
      expect(out2.at_30).toEqual([]);
    },
    PY_TEST_TIMEOUT_MS
  );
});
