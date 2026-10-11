/**
 * The size ratchets (eslint.config.js, block "size-ratchets"; ADR 0010, D9)
 * stay tight. ESLint already fails anything over a limit; this fails a limit
 * that has drifted above the worst file or function, which would let new code
 * grow into the slack. Lines may sit within MARGIN of the worst so that a
 * small edit to the worst file does not force a config change; `complexity`
 * and `max-params` must equal the worst.
 *
 * The worst values are measured by linting src/ with each limit at its
 * minimum and reading the sizes ESLint reports.
 *
 * The per-role caps of migrated modules (blocks "size/<role>") are held the
 * same way: each `max-lines` within 10 of the largest file it covers, measured
 * with the block's own options (comment lines count, D10), and none covering no
 * file. So are their function caps (block "size-ratchets/migrated"): lines
 * within 10 of the longest function, `max-depth`, `max-params` and
 * `complexity` at the worst, over the migrated modules' files.
 */
import { Linter } from "eslint";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

const tsparser = require("@typescript-eslint/parser");
const config: Linter.Config[] = require("../../eslint.config.js");

const RULES = ["max-lines", "max-lines-per-function", "complexity", "max-params"] as const;
const MIGRATED_RULES = ["max-lines-per-function", "max-depth", "complexity", "max-params"] as const;
type RatchetRule = (typeof RULES)[number] | (typeof MIGRATED_RULES)[number];

const MARGIN: Readonly<Record<RatchetRule, number>> = {
  "max-lines": 10,
  "max-lines-per-function": 10,
  complexity: 0,
  "max-params": 0,
  "max-depth": 0,
};

function namedBlock(name: string): Linter.Config {
  const found = config.find((c) => c.name === name);
  if (!found) throw new Error(`no ESLint block named ${name}`);
  return found;
}

function setting(rule: RatchetRule, name = "size-ratchets"): { limit: number; options: Record<string, unknown> } {
  const entry = namedBlock(name).rules?.[rule];
  if (!Array.isArray(entry)) throw new Error(`${name} has no ${rule}`);
  const value = entry[1] as number | { max: number };
  return typeof value === "number" ? { limit: value, options: {} } : { limit: value.max, options: value };
}

/** The size ESLint reports in a message: "(42)" or "complexity of 42". */
export function reportedSize(message: string): number | undefined {
  const match = /\((\d+)\)|complexity of (\d+)/.exec(message);
  return match ? Number(match[1] ?? match[2]) : undefined;
}

/** Each rule at its minimum, keeping the block's other options, so ESLint reports every size. */
function atMinimum(rules: readonly RatchetRule[], name: string): Linter.RulesRecord {
  return Object.fromEntries(
    rules.map((rule) => {
      const { options } = setting(rule, name);
      const isObject = rule === "max-lines" || rule === "max-lines-per-function";
      return [rule, ["error", isObject ? { ...options, max: 1 } : 0]];
    }),
  );
}

function worstSizes(
  rules: readonly RatchetRule[] = RULES,
  name = "size-ratchets",
  files: readonly string[] = sourceFiles(),
): Record<RatchetRule, { size: number; where: string }> {
  const minimum = atMinimum(rules, name);
  const worst = Object.fromEntries(rules.map((r) => [r, { size: 0, where: "" }])) as Record<
    RatchetRule,
    { size: number; where: string }
  >;
  const linter = new Linter({ configType: "flat" });
  for (const file of files) {
    const messages = linter.verify(
      readSource(file),
      [{ files: ["**/*.ts"], languageOptions: { parser: tsparser }, rules: minimum }],
      file,
    );
    for (const m of messages) {
      const rule = m.ruleId as RatchetRule | null;
      const size = m.message ? reportedSize(m.message) : undefined;
      if (rule && size !== undefined && rules.includes(rule) && size > worst[rule].size) {
        worst[rule] = { size, where: `${file}:${m.line}` };
      }
    }
  }
  return worst;
}

/** A file's lines as `max-lines` counts them with `options`. */
function countedLines(file: string, linter: Linter, options: Record<string, unknown>): number {
  const rules: Linter.RulesRecord = {
    "max-lines": ["error", { ...options, max: 1 }],
  };
  const messages = linter.verify(
    readSource(file),
    [{ files: ["**/*.ts"], languageOptions: { parser: tsparser }, rules }],
    file,
  );
  const size = messages[0]?.message ? reportedSize(messages[0].message) : undefined;
  return size ?? 1;
}

/** `<folder>/**\/*<tail>` or a single file, as eslint.config.js derives them from the migrated scope. */
function matchesGlob(glob: string, file: string): boolean {
  if (!glob.includes("*")) return file === glob;
  const match = /^(src\/(?:[\w-]+\/)+)\*\*\/\*((?:\.[a-z]+)?\.ts)$/.exec(glob);
  if (!match) throw new Error(`unexpected migrated glob ${glob}`);
  return file.startsWith(match[1]!) && file.endsWith(match[2]!);
}

describe("size ratchet measurement", () => {
  it("reads the size from each rule's message", () => {
    expect(reportedSize("File has too many lines (440). Maximum allowed is 1.")).toBe(440);
    expect(reportedSize("Method 'run' has too many lines (122). Maximum allowed is 1.")).toBe(122);
    expect(reportedSize("Function 'x' has a complexity of 47. Maximum allowed is 0.")).toBe(47);
    expect(reportedSize("Function 'x' has too many parameters (7). Maximum allowed is 0.")).toBe(7);
    expect(reportedSize("Blocks are nested too deeply (3). Maximum allowed is 0.")).toBe(3);
  });
});

describe("size ratchets", () => {
  it("sit at the worst file and function (lines within 10, complexity and max-params exact)", () => {
    const worst = worstSizes();
    const loose = RULES.flatMap((rule) => {
      const { limit } = setting(rule);
      const { size, where } = worst[rule];
      return limit - size > MARGIN[rule]
        ? [`${rule}: limit ${limit}, worst ${size} (${where}); lower the limit to ${size}`]
        : [];
    });
    expect(loose).toEqual([]);
  });

  it("of the migrated modules' functions sit at the worst function they cover", () => {
    const name = "size-ratchets/migrated";
    const globs = namedBlock(name).files as string[];
    const covered = sourceFiles().filter((f) => globs.some((g) => matchesGlob(g, f)));
    expect(covered.length).toBeGreaterThan(0);
    const worst = worstSizes(MIGRATED_RULES, name, covered);
    const loose = MIGRATED_RULES.flatMap((rule) => {
      const { limit } = setting(rule, name);
      const { size, where } = worst[rule];
      return limit - size > MARGIN[rule]
        ? [`${name} ${rule}: limit ${limit}, worst ${size} (${where}); lower the limit to ${size}`]
        : [];
    });
    expect(loose).toEqual([]);
  });

  it("per role sit at the largest file of that role in the migrated modules", () => {
    const linter = new Linter({ configType: "flat" });
    const files = sourceFiles();
    const roleBlocks = config.filter((c) => c.name?.startsWith("size/"));
    expect(roleBlocks.length).toBeGreaterThan(0);
    const loose = roleBlocks.flatMap((b) => {
      const entry = b.rules?.["max-lines"] as [string, { max: number }];
      const covered = files.filter((f) => (b.files as string[]).some((g) => matchesGlob(g, f)));
      if (covered.length === 0) return [`${b.name}: covers no file; delete it`];
      const worst = Math.max(...covered.map((f) => countedLines(f, linter, entry[1])));
      return entry[1].max - worst > MARGIN["max-lines"]
        ? [`${b.name}: limit ${entry[1].max}, largest ${worst}; lower the limit to ${worst + MARGIN["max-lines"]} or less`]
        : [];
    });
    expect(loose).toEqual([]);
  });
});
