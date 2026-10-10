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
 */
import { Linter } from "eslint";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

const tsparser = require("@typescript-eslint/parser");
const config: Linter.Config[] = require("../../eslint.config.js");

const RULES = ["max-lines", "max-lines-per-function", "complexity", "max-params"] as const;
type RatchetRule = (typeof RULES)[number];

const MARGIN: Readonly<Record<RatchetRule, number>> = {
  "max-lines": 10,
  "max-lines-per-function": 10,
  complexity: 0,
  "max-params": 0,
};

const block = config.find((c) => c.name === "size-ratchets");

function setting(rule: RatchetRule): { limit: number; options: Record<string, unknown> } {
  const entry = block?.rules?.[rule];
  if (!Array.isArray(entry)) throw new Error(`size-ratchets has no ${rule}`);
  const value = entry[1] as number | { max: number };
  return typeof value === "number" ? { limit: value, options: {} } : { limit: value.max, options: value };
}

/** The size ESLint reports in a message: "(42)" or "complexity of 42". */
export function reportedSize(message: string): number | undefined {
  const match = /\((\d+)\)|complexity of (\d+)/.exec(message);
  return match ? Number(match[1] ?? match[2]) : undefined;
}

function worstSizes(): Record<RatchetRule, { size: number; where: string }> {
  const rules: Linter.RulesRecord = {
    "max-lines": ["error", { ...setting("max-lines").options, max: 1 }],
    "max-lines-per-function": ["error", { ...setting("max-lines-per-function").options, max: 1 }],
    complexity: ["error", 0],
    "max-params": ["error", 0],
  };
  const worst = Object.fromEntries(RULES.map((r) => [r, { size: 0, where: "" }])) as Record<
    RatchetRule,
    { size: number; where: string }
  >;
  const linter = new Linter({ configType: "flat" });
  for (const file of sourceFiles()) {
    const messages = linter.verify(
      readSource(file),
      [{ files: ["**/*.ts"], languageOptions: { parser: tsparser }, rules }],
      file,
    );
    for (const m of messages) {
      const rule = m.ruleId as RatchetRule | null;
      const size = m.message ? reportedSize(m.message) : undefined;
      if (rule && size !== undefined && RULES.includes(rule) && size > worst[rule].size) {
        worst[rule] = { size, where: `${file}:${m.line}` };
      }
    }
  }
  return worst;
}

describe("size ratchet measurement", () => {
  it("reads the size from each rule's message", () => {
    expect(reportedSize("File has too many lines (440). Maximum allowed is 1.")).toBe(440);
    expect(reportedSize("Method 'run' has too many lines (122). Maximum allowed is 1.")).toBe(122);
    expect(reportedSize("Function 'x' has a complexity of 47. Maximum allowed is 0.")).toBe(47);
    expect(reportedSize("Function 'x' has too many parameters (7). Maximum allowed is 0.")).toBe(7);
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
});
