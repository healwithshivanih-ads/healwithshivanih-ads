import yaml from "js-yaml";

/**
 * Safe YAML serialiser for every file the Python side reads back.
 *
 * ── The bug this exists to prevent ──────────────────────────────────────
 * The Python shims load these YAML files with PyYAML, which follows the
 * YAML **1.1** spec. YAML 1.1 treats an underscore as a digit separator, so
 * an unquoted scalar like `30_60` resolves to the integer 3060. Our intake
 * form stores range-chip answers as strings of exactly that shape — e.g.
 * `time_to_fall_asleep: "30_60"` (the "30–60 min" chip), `1_5`, `15_30`.
 *
 * js-yaml follows YAML **1.2**, which dropped underscore digit separators.
 * Under 1.2 `30_60` is just a plain string, so `js-yaml.dump` emits it
 * WITHOUT quotes. Round-trips cleanly in JS — but the next time a Python
 * shim loads that client.yaml, PyYAML reads `30_60` as int 3060, and the
 * Pydantic `Client.time_to_fall_asleep: str` field rejects it. Every shim
 * that touches the client then crashes (assess, generate-draft, …).
 *
 * Because a real JavaScript number NEVER serialises with an underscore, any
 * unquoted `<digits>_<digits>` scalar in js-yaml's output is DEFINITIVELY a
 * string that PyYAML would misread. We quote exactly those and nothing else.
 *
 * Note js-yaml already quotes plain numeric strings (`"918976563971"` →
 * `'918976563971'`) and YAML-1.1 boolean words (`"yes"` → `'yes'`); the
 * underscore-numeric case is the one gap it leaves, so that is all we patch.
 *
 * We post-process the dumped text rather than pass `forceQuotes: true` so
 * that multiline fields (`notes_for_coach`, letter bodies, …) keep their
 * readable block-scalar form instead of collapsing into escaped single lines.
 */

// A scalar that is all digits + underscores (optionally signed / decimal).
// Only matters — i.e. only mis-parses under PyYAML — when it contains an
// underscore, so `needsQuote` gates on that.
const NUMERIC_UNDERSCORE = /^[-+]?[0-9][0-9_]*(?:\.[0-9_]+)?$/;

// A block-scalar header: `|`, `>`, with optional chomping/indent indicator.
const BLOCK_SCALAR_INTRO = /^[|>][+-]?\d*$/;

function needsQuote(token: string): boolean {
  return token.includes("_") && NUMERIC_UNDERSCORE.test(token);
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Quote unquoted numeric-underscore scalars in already-dumped block-style
 * YAML. Skips the raw content of literal/folded block scalars so a note that
 * happens to contain such a token is never rewritten.
 */
function quoteRiskyScalars(text: string): string {
  const lines = text.split("\n");
  let inBlockScalar = false;
  let blockIndent = 0;

  const out = lines.map((line) => {
    if (inBlockScalar) {
      // Blank lines and anything more-indented than the block key belong to
      // the block scalar's content — leave untouched.
      if (line.trim() === "" || indentOf(line) > blockIndent) return line;
      inBlockScalar = false; // dedented back out — fall through and inspect
    }

    // `key: value` (optionally a `- ` list-of-maps prefix), or `- value`.
    let prefix: string | undefined;
    let value: string | undefined;
    let m = line.match(/^(\s*(?:- )?[A-Za-z0-9_.\-]+: )(\S.*)$/);
    if (m) {
      prefix = m[1];
      value = m[2];
    } else {
      m = line.match(/^(\s*- )(\S.*)$/);
      if (m) {
        prefix = m[1];
        value = m[2];
      }
    }
    if (prefix === undefined || value === undefined) return line;

    const trimmed = value.trimEnd();
    if (BLOCK_SCALAR_INTRO.test(trimmed)) {
      inBlockScalar = true;
      blockIndent = indentOf(line);
      return line;
    }
    if (needsQuote(trimmed)) return `${prefix}'${trimmed}'`;
    return line;
  });

  return out.join("\n");
}

/**
 * Drop-in replacement for `yaml.dump` for any YAML a Python shim will read.
 * Same options and output as `yaml.dump`, except numeric-underscore string
 * scalars are quoted so PyYAML round-trips them as strings. `noRefs` is
 * defaulted on (we never want YAML anchors in these files).
 */
export function dumpYaml(value: unknown, opts?: yaml.DumpOptions): string {
  return quoteRiskyScalars(yaml.dump(value, { noRefs: true, ...opts }));
}
