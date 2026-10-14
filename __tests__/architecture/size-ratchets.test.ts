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
 * The per-role caps (blocks "size/<role>") are held the
 * same way: each `max-lines` within 10 of the largest file it covers, measured
 * with the block's own options (comment lines count, D10), and none covering no
 * file. So are their function caps (block "size-ratchets/migrated"): lines
 * within 10 of the longest function, `max-depth`, `max-params` and
 * `complexity` at the worst, over every module scope's files.
 *
 * A file over its role's cap with no domain seam to split along carries a
 * per-file cap, `exemptions/size-caps.json` (ADR 0010 D9), applied by a
 * `size-exemption/<file>` block after the role blocks. Its file is left out of
 * its role's largest-file measure; the entry fails when its file is gone, is
 * no longer covered by a role cap, is back under that cap, or sits more than
 * 10 lines below its own `max`.
 */
import { Linter } from "eslint";
import { readSizeCapExemptions, type SizeCapExemption } from "../helpers/architecture/exemptions";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

const tsparser = require("@typescript-eslint/parser");
const config: Linter.Config[] = require("../../eslint.config.js");

const RULES = ["max-lines", "max-lines-per-function", "complexity", "max-params"] as const;
const FUNCTION_RULES = ["max-lines-per-function", "max-depth", "complexity", "max-params"] as const;
type RatchetRule = (typeof RULES)[number] | (typeof FUNCTION_RULES)[number];

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

/** `<folder>/**\/*<tail>` or a single file, as eslint.config.js derives them from the module scopes. */
function matchesGlob(glob: string, file: string): boolean {
  if (!glob.includes("*")) return file === glob;
  const match = /^(src\/(?:[\w-]+\/)+)\*\*\/\*((?:\.[a-z]+)?\.ts)$/.exec(glob);
  if (!match) throw new Error(`unexpected scope glob ${glob}`);
  return file.startsWith(match[1]!) && file.endsWith(match[2]!);
}

/** `<file>: <problem>` for each size-cap exemption whose file, role cap or ESLint block does not hold it. */
export function sizeCapProblems(
  exemptions: ReadonlyMap<string, SizeCapExemption>,
  files: ReadonlySet<string>,
  blocks: readonly Linter.Config[],
): string[] {
  const linter = new Linter({ configType: "flat" });
  const roleBlocks = blocks.filter((c) => c.name?.startsWith("size/"));
  const indexOf = (name: string): number => blocks.findIndex((c) => c.name === name);
  return [...exemptions].flatMap(([file, { max }]) => {
    if (!files.has(file)) return [`${file}: no such source; delete its entry`];
    const role = roleBlocks.find((b) => (b.files as string[]).some((g) => matchesGlob(g, file)));
    if (role === undefined) return [`${file}: no role cap covers it; delete its entry`];
    const { max: roleMax, ...options } = (role.rules?.["max-lines"] as [string, { max: number }])[1];
    const lines = countedLines(file, linter, options);
    if (lines <= roleMax) return [`${file}: ${lines} lines, under its role cap ${roleMax}; delete its entry`];
    if (max < lines || max - lines > MARGIN["max-lines"]) return [`${file}: max ${max}, ${lines} lines; set max to ${lines} to ${lines + MARGIN["max-lines"]}`];
    const block = blocks.find((c) => c.name === `size-exemption/${file}`);
    const blockMax = (block?.rules?.["max-lines"] as [string, { max: number }] | undefined)?.[1].max;
    if (blockMax !== max || indexOf(`size-exemption/${file}`) < indexOf(role.name ?? "")) {
      return [`${file}: eslint.config.js does not apply max ${max} after ${role.name ?? "its role block"}`];
    }
    return [];
  });
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

  it("of the module scopes' functions sit at the worst function they cover", () => {
    const name = "size-ratchets/migrated";
    const globs = namedBlock(name).files as string[];
    const covered = sourceFiles().filter((f) => globs.some((g) => matchesGlob(g, f)));
    expect(covered.length).toBeGreaterThan(0);
    const worst = worstSizes(FUNCTION_RULES, name, covered);
    const loose = FUNCTION_RULES.flatMap((rule) => {
      const { limit } = setting(rule, name);
      const { size, where } = worst[rule];
      return limit - size > MARGIN[rule]
        ? [`${name} ${rule}: limit ${limit}, worst ${size} (${where}); lower the limit to ${size}`]
        : [];
    });
    expect(loose).toEqual([]);
  });

  it("per role sit at the largest file of that role", () => {
    const linter = new Linter({ configType: "flat" });
    const exempt = readSizeCapExemptions();
    const files = sourceFiles().filter((f) => !exempt.has(f));
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

  it("per file, from exemptions/size-caps.json, raise only an over-cap file's max-lines, held within 10 of it", () => {
    // Act
    const problems = sizeCapProblems(readSizeCapExemptions(), new Set(sourceFiles()), config);

    // Assert
    expect(problems).toEqual([]);
    expect(config.filter((c) => c.name?.startsWith("size-exemption/")).map((c) => c.name)).toEqual(
      [...readSizeCapExemptions().keys()].map((f) => `size-exemption/${f}`),
    );
  });
});

describe("size cap exemption rule applies as specified", () => {
  const file = "src/building/building.rules.ts";
  const linter = new Linter({ configType: "flat" });
  const lines = countedLines(file, linter, { skipBlankLines: true, skipComments: false });
  const options = { skipBlankLines: true, skipComments: false };
  const role: Linter.Config = { name: "size/rules", files: [file], rules: { "max-lines": ["error", { ...options, max: 10 }] } };
  const exemptBlock = (max: number): Linter.Config => ({ name: `size-exemption/${file}`, files: [file], rules: { "max-lines": ["error", { ...options, max }] } });
  const reason = "no domain seam to split along yet (ADR 0010 D9)";

  it("passes a file over its role cap whose max sits within 10 of it, applied after the role block", () => {
    // Act & Assert
    expect(sizeCapProblems(new Map([[file, { max: lines + 5, reason }]]), new Set([file]), [role, exemptBlock(lines + 5)])).toEqual([]);
  });

  it.each([
    ["a max far above the file", lines + 30, [role, exemptBlock(lines + 30)], new Set([file]), /set max/],
    ["a file back under its role cap", lines, [{ ...role, rules: { "max-lines": ["error", { ...options, max: lines + 1 }] } } as Linter.Config, exemptBlock(lines)], new Set([file]), /under its role cap/],
    ["a block missing from the config", lines, [role], new Set([file]), /does not apply/],
    ["a block before the role block", lines, [exemptBlock(lines), role], new Set([file]), /does not apply/],
    ["a file that is gone", lines, [role, exemptBlock(lines)], new Set<string>(), /no such source/],
  ])("refuses %s", (_case, max, blocks, files, message) => {
    // Act
    const problems = sizeCapProblems(new Map([[file, { max, reason }]]), files, blocks);

    // Assert
    expect(problems).toEqual([expect.stringMatching(message)]);
  });
});
