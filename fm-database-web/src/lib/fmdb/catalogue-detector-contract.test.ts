/**
 * The two catalogue guardrail detectors, and the one failure they must never
 * counterfeit.
 *
 * Both `getCatalogueOrphanStatus` and `getCatalogueDuplicateStatus` spawn the
 * fmdb CLI and summarise its JSON for a dashboard chip. Both used to answer a
 * spawn failure with the same empty summary they answer a clean catalogue with,
 * so the chip hid — and a hidden guardrail chip is indistinguishable from good
 * news. It went unnoticed twice, because the failure says nothing anywhere: no
 * toast, no log, no thrown error. The only signal was the dev server's timing
 * line (an ENOENT resolves in ~2ms; a real scan is 12-16s).
 *
 * Two things are pinned here, and they fail for different reasons:
 *
 *  1. The CLI's JSON SHAPE. The payload cannot report its own breakage — if
 *     `--json` started emitting an object, or renamed `blocking`, the actions
 *     would parse it into zero findings and go quiet again. Same reasoning as
 *     fm-database/tests/test_duplicates_ratchet.py.
 *  2. The DISCRIMINATION. Point the interpreter at nothing and the actions must
 *     say "unavailable", never a clean zero. This is the regression itself.
 *
 * The shape tests drive the real catalogue (~14s each) — that is the cost of
 * checking a contract rather than a mock of one.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { execFile } from "node:child_process";
import path from "node:path";
import { TEST_PYTHON } from "./test-python";

const FMDB_DIR = path.resolve(process.cwd(), "..", "fm-database");
const SCAN_TIMEOUT_MS = 90_000;

/**
 * Run an fmdb detector and return its stdout. Both detectors exit 1 when they
 * FIND something (that is a successful scan, not a failure), so the exit code
 * is ignored and only empty stdout counts as broken — the same rule both
 * actions apply.
 */
function runDetector(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      TEST_PYTHON,
      ["-m", "fmdb.cli", ...args],
      { cwd: FMDB_DIR, timeout: SCAN_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (stdout.trim()) return resolve(stdout);
        reject(new Error(`fmdb ${args.join(" ")} produced no stdout: ${err?.message ?? ""}\n${stderr}`));
      },
    );
  });
}

describe("fmdb orphans --json contract", () => {
  it("emits a list of orphans with the fields the chip reads", async () => {
    const items = JSON.parse(await runDetector(["orphans", "--json"]));
    // A list, not an object: the action's `Array.isArray` guard turns anything
    // else into "unavailable", so a shape change must fail HERE and loudly
    // rather than there and silently.
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0); // no orphans at all would make this vacuous

    for (const o of items) {
      expect(typeof o.kind).toBe("string");
      expect(typeof o.slug).toBe("string");
      expect(typeof o.display_name).toBe("string");
      expect(typeof o.reason).toBe("string");
      // `blocking` drives the whole chip: it decides both the count shown and
      // whether the chip renders at all. A missing field is falsy, which reads
      // as "nothing is blocking" — the quiet failure again.
      expect(typeof o.blocking).toBe("boolean");
    }
    // The chip only ever renders mechanisms/supplements as blocking; if the CLI
    // starts marking other kinds blocking, KIND_LABEL needs a new entry.
    const blockingKinds = new Set(items.filter((o: { blocking: boolean }) => o.blocking).map((o: { kind: string }) => o.kind));
    for (const k of blockingKinds) expect(["mechanism", "supplement"]).toContain(k);
  }, SCAN_TIMEOUT_MS);
});

describe("fmdb duplicates contract — two modes, two shapes", () => {
  /**
   * `--check-new --json` only emits JSON once the ratchet merge (842099e7) is in
   * this branch's fm-database. Before it, `--json` is ignored and the command
   * prints "No NEW duplicates (N known, all in baseline)." — so this asserts a
   * contract that does not exist yet here, and skipping is honest where failing
   * would be noise. It arms itself automatically once main is merged; if you see
   * it skipped AFTER a merge that should have brought the ratchet, that is the
   * finding.
   */
  it("--check-new emits a {new, known} OBJECT, which is what the chip reads", async ({ skip }) => {
    const raw = await runDetector(["duplicates", "--check-new", "--json"]);
    if (!raw.trimStart().startsWith("{")) {
      skip(`fmdb duplicates --check-new --json is not JSON on this branch yet: ${raw.trim().split("\n")[0]}`);
      return;
    }
    // The ratchet mode. Every finding on disk is already accepted in
    // _duplicates_baseline.yaml, so the chip fires only on what is NEW; a chip
    // driven by the full scan would assert hundreds of accepted findings as
    // actionable on every dashboard load. fm-database/tests/test_duplicates_ratchet.py
    // pins this from the Python side; this is the TS consumer's half.
    const payload = JSON.parse(raw);
    expect(Array.isArray(payload)).toBe(false); // an array here would be the full scan
    expect(Array.isArray(payload.new)).toBe(true);
    expect(typeof payload.known).toBe("number");
  }, SCAN_TIMEOUT_MS);

  it("plain --json stays a bare ARRAY, which the chip must reject", async () => {
    const items = JSON.parse(await runDetector(["duplicates", "--json"]));
    // The action guards `Array.isArray(payload)` explicitly: reading the full
    // scan as a ratchet result would surface the entire accepted baseline as new.
    // If these two modes ever converge on one shape, that guard needs revisiting.
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);

    for (const d of items) {
      expect(["SHARED_ALIAS", "ALIAS_IS_SLUG", "SAME_DISPLAY", "NEAR_SLUG"]).toContain(d.check);
      expect(typeof d.entity_kind).toBe("string");
      expect(Array.isArray(d.slugs)).toBe(true);
      // The action counts `severity === "CRITICAL"`. A renamed or lowercased
      // value would count zero criticals against a catalogue full of them.
      expect(["CRITICAL", "WARNING"]).toContain(d.severity);
      expect(typeof d.detail).toBe("string");
      expect(Array.isArray(d.evidence)).toBe(true);
    }
  }, SCAN_TIMEOUT_MS);
});

describe("a detector that cannot run reports unavailable, not all-clear", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    delete process.env.FMDB_PYTHON;
  });

  /**
   * PYTHON is read from the environment once, at module load — so the module
   * has to be imported AFTER the variable is poisoned. That is also exactly how
   * the bug reached production: a git worktree has no `.venv`, the default path
   * resolves to a file that is not there, and execFile rejects with ENOENT in
   * about two milliseconds.
   */
  async function withMissingInterpreter<T>(load: () => Promise<T>): Promise<T> {
    process.env.FMDB_PYTHON = "/nonexistent/definitely-not-a-python";
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
    return load();
  }

  it("orphans: ENOENT is not zero orphans", async () => {
    const { getCatalogueOrphanStatus } = await withMissingInterpreter(
      () => import("@/app/catalogue-orphan-action"),
    );
    const status = await getCatalogueOrphanStatus();
    expect(status.status).toBe("unavailable");
    // The precise thing that must not happen: the chip's hide condition
    // (`blocking === 0`) must not be satisfiable by a failed scan.
    expect(status).not.toHaveProperty("blocking", 0);
    if (status.status === "unavailable") {
      expect(status.error).toMatch(/nonexistent|ENOENT|not found/i);
    }
  }, 30_000);

  it("duplicates: a rejection with no stdout is not zero NEW duplicates", async () => {
    const { getCatalogueDuplicateStatus } = await withMissingInterpreter(
      () => import("@/app/catalogue-duplicate-action"),
    );
    const status = await getCatalogueDuplicateStatus();
    // The tricky half: this action ALREADY caught a rejection on purpose, because
    // exit 1 with a full payload on stdout is the normal "criticals exist" case.
    // Only the no-stdout rejection is a failed run.
    expect(status.status).toBe("unavailable");
    // The chip hides on newCount === 0, so a failed scan must never produce it.
    expect(status).not.toHaveProperty("newCount", 0);
  }, 30_000);
});
