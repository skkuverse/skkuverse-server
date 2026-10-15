/**
 * The lists beside the rules change only the way their kind allows
 * (`__tests__/helpers/architecture/lists.ts`; PR 227 F2, PR 229 F2,
 * PR 234 F1 F2):
 *
 *   - `list-growth`: against the base branch, an allowlist or a ratchet gains
 *     an entry only through commits that each carry
 *     `Architecture-Debt: <list path>` and change a rule file that reads the
 *     list; a size cap's `max`, or a cap in `caps/` (`role-max-lines.json`,
 *     the per-role `max-lines` eslint.config.js applies), rises only in
 *     commits that carry the trailer for its file; and an exemption gains an
 *     entry only when its reason cites a decision that `docs/decisions/`
 *     declares and that `EXEMPTION_DECISIONS` allows for its file.
 *   - `list-registry`: every file in `allowlists/`, `caps/` and `exemptions/` is read
 *     by a rule (an architecture test or helper, or `eslint.config.js`, names
 *     it), every exemption file is in `EXEMPTION_DECISIONS` with decisions
 *     that exist, and every file in `ratchets/` is registered in
 *     `RATCHET_DECISIONS` with a decision that exists. A stray list holds
 *     nothing back.
 *   - `exemption-reasons`: no reason is shared between two entries of any
 *     exemption file, so a reason cannot be pasted as boilerplate.
 */
import fs from "fs";
import os from "os";
import path from "path";
import {
  EXEMPTIONS_DIR,
  citedDecisions,
  decisionHeadings,
  readExemptions,
  readSizeCapExemptions,
  reasonProblem,
} from "../helpers/architecture/exemptions";
import {
  EXEMPTION_DECISIONS,
  LIST_DIRS,
  RATCHET_DECISIONS,
  baseCommit,
  growthViolations,
  listChanges,
  listCommits,
  listEntries,
  listReaders,
  missingBaseProblem,
  type ListCommit,
  type ListGate,
} from "../helpers/architecture/lists";
import { ROOT } from "../helpers/architecture/ratchet";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const DECISIONS = new Set(["ADR 0010 D9", "ADR 0010 D2"]);

/** The rule files a list's reader may be: the architecture tests, their helpers and eslint.config.js. */
const ruleSources = (): Map<string, string> =>
  new Map(
    [...filesUnder("__tests__/architecture"), ...filesUnder("__tests__/helpers/architecture"), "eslint.config.js"]
      .filter((f) => f.endsWith(".ts") || f === "eslint.config.js")
      .map((f) => [f, readSource(f)]),
  );
const REASON = "pure delegation: forwards each call to `XRepository` unchanged, as building.service.ts does";

describe("exemption reasons", () => {
  it.each([
    ["a short reason", "delegation"],
    ["too few words", "delegation-to-the-repository-and-the-mapper-only"],
    ["one word repeated", "x x x x x x x x x x x x x x x x x x x x x x x x"],
    ["eleven words that name nothing", "one two three four five six seven eight nine ten eleven"],
    ["filler that names nothing to open", "this service is exempt because it is simple enough and has no logic worth testing"],
    ["a decision that does not exist", "kept apart for now as ADR 0010 D99 asks, see the open item in its text"],
    ["not a string", true],
  ])("refuses %s", (_case, reason) => {
    // Act & Assert
    expect(reasonProblem(reason, DECISIONS)).toBeDefined();
  });

  it.each([
    ["a file it names", REASON],
    ["a decision it cites", "onModuleInit wraps it so a failure warns and continues (ADR 0010 D2), so the spec calls it"],
    ["a decision with a comma", "building's door for other features (ADR 0010, D9), forwarding each call unchanged to the repo"],
  ])("accepts a reason that names %s", (_case, reason) => {
    // Act & Assert
    expect(reasonProblem(reason, DECISIONS)).toBeUndefined();
  });

  it("reads the decisions docs/decisions/ declares", () => {
    // Act
    const headings = decisionHeadings();

    // Assert
    expect(headings.has("ADR 0010 D9")).toBe(true);
    expect(headings.has("ADR 0011 D1")).toBe(true);
    expect(headings.has("ADR 0010 D99")).toBe(false);
    expect(citedDecisions("as ADR 0010 D9 and ADR 0011, D2 say")).toEqual(["ADR 0010 D9", "ADR 0011 D2"]);
  });

  describe("an exemption file", () => {
    let dir: string;
    const write = (name: string, text: string): void => fs.writeFileSync(path.join(dir, `${name}.json`), text);

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "exemptions-"));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("refuses a key written twice, which JSON.parse would merge", () => {
      // Arrange
      write("rule", `{ "src/a.ts": ${JSON.stringify(REASON)}, "src/a.ts": ${JSON.stringify(`${REASON} again`)} }`);

      // Act & Assert
      expect(() => readExemptions("rule", dir, DECISIONS)).toThrow(/src\/a\.ts twice/);
    });

    it("refuses one reason pasted on two entries", () => {
      // Arrange
      write("rule", JSON.stringify({ "src/a.ts": REASON, "src/b.ts": REASON }));

      // Act & Assert
      expect(() => readExemptions("rule", dir, DECISIONS)).toThrow(/repeats the reason/);
    });

    it("reads a size cap as { max, reason } and refuses any other shape", () => {
      // Arrange
      write("size-caps", JSON.stringify({ "src/a.rules.ts": { max: 120, reason: `no domain seam yet (ADR 0010 D9); ${REASON}` } }));

      // Act
      const caps = readSizeCapExemptions(dir, DECISIONS);

      // Assert
      expect(caps.get("src/a.rules.ts")?.max).toBe(120);
      write("size-caps", JSON.stringify({ "src/a.rules.ts": { max: "120", reason: REASON } }));
      expect(() => readSizeCapExemptions(dir, DECISIONS)).toThrow(/must be \{ "max"/);
      write("size-caps", JSON.stringify({ "src/a.rules.ts": { max: 120, reason: REASON, extra: 1 } }));
      expect(() => readSizeCapExemptions(dir, DECISIONS)).toThrow(/must be \{ "max"/);
      write("size-caps", JSON.stringify({ "src/a.rules.ts": { max: 120, reason: "short" } }));
      expect(() => readSizeCapExemptions(dir, DECISIONS)).toThrow(/reason/);
    });
  });
});

describe("list growth rule applies as specified", () => {
  const allowlist = "__tests__/architecture/allowlists/rule.json";
  const ratchet = "__tests__/architecture/ratchets/rule.json";
  const exemption = "__tests__/architecture/exemptions/size-caps.json";
  const otherExemption = "__tests__/architecture/exemptions/service-specs.json";
  const reader = "__tests__/helpers/architecture/rule-reader.ts";
  const gate: ListGate = { decisions: DECISIONS, cited: citedDecisions, readers: () => [reader] };
  const commit = (hash: string, debt: string[], changed: string[], lists: ListCommit["lists"]): ListCommit => ({ hash, debt, changed, lists });
  const cap = (max: number): string => JSON.stringify({ "src/a.rules.ts": { max, reason: `no domain seam (ADR 0010 D9); ${REASON}` } });

  it("passes a list that shrank, stayed or kept its entries", () => {
    // Arrange
    const changes = [
      { file: allowlist, before: '["a", "b"]', after: '["a"]' },
      { file: ratchet, before: '["a"]', after: '["a"]' },
      { file: otherExemption, before: JSON.stringify({ a: REASON }), after: "{}" },
    ];

    // Act & Assert
    expect(growthViolations(changes, [], gate)).toEqual([]);
  });

  it("refuses an allowlist or ratchet entry, a new file's included, unless the commit that adds it records it", () => {
    // Arrange
    const changes = [
      { file: allowlist, before: '["a"]', after: '["a", "b"]' },
      { file: ratchet, before: undefined, after: '["c"]' },
    ];
    const listOnly = commit("1111111111", [allowlist, ratchet], [allowlist, ratchet], [
      { file: allowlist, before: '["a"]', after: '["a", "b"]' },
      { file: ratchet, before: undefined, after: '["c"]' },
    ]);
    const ruleCommit = commit("2222222222", [allowlist], [allowlist, reader], [{ file: allowlist, before: '["a"]', after: '["a", "b"]' }]);

    // Act
    const refused = growthViolations(changes, [listOnly], gate);
    const recorded = growthViolations(changes.slice(0, 1), [ruleCommit], gate);

    // Assert
    expect(refused.map((v) => v.split(" (")[0])).toEqual([`${allowlist}: b`, `${ratchet}: c`]);
    expect(recorded).toEqual([]);
  });

  it.each([
    ["a trailer with a change to a helper that does not read the list", ["__tests__/helpers/architecture/tree.ts"]],
    ["a trailer with a new empty rule file", ["__tests__/helpers/architecture/zz-empty.ts"]],
    ["a trailer with eslint.config.js when the list is not ESLint's", ["eslint.config.js"]],
  ])("refuses %s", (_case, ruleFiles) => {
    // Arrange
    const change = { file: allowlist, before: "[]", after: '["b"]' };
    const debt = commit("3333333333", [allowlist], [allowlist, ...ruleFiles], [change]);

    // Act & Assert
    expect(growthViolations([change], [debt], gate)).toHaveLength(1);
  });

  it("credits a debt commit only with the entries it added itself", () => {
    // Arrange
    const debt = commit("4444444444", [allowlist], [allowlist, reader], [{ file: allowlist, before: "[]", after: '["a"]' }]);
    const later = commit("5555555555", [], [allowlist], [{ file: allowlist, before: '["a"]', after: '["a", "b", "c", "d"]' }]);
    const change = { file: allowlist, before: "[]", after: '["a", "b", "c", "d"]' };

    // Act
    const violations = growthViolations([change], [debt, later], gate);

    // Assert
    expect(violations.map((v) => v.split(" (")[0])).toEqual([`${allowlist}: b`, `${allowlist}: c`, `${allowlist}: d`]);
  });

  it("refuses an entry no commit of its own added, as a merge would", () => {
    // Arrange
    const change = { file: allowlist, before: "[]", after: '["a"]' };

    // Act
    const violations = growthViolations([change], [commit("6666666666", [allowlist], [reader], [])], gate);

    // Assert
    expect(violations).toEqual([expect.stringContaining("no commit of its own added it")]);
  });

  it("refuses a size cap's max raised without the trailer, and passes one raised with it or lowered", () => {
    // Arrange
    const change = { file: exemption, before: cap(120), after: cap(130) };
    const bare = commit("7777777777", [], [exemption], [change]);
    const recorded = commit("8888888888", [exemption], [exemption], [change]);
    const lowered = { file: exemption, before: cap(130), after: cap(120) };

    // Act & Assert
    expect(growthViolations([change], [bare], gate)).toEqual([expect.stringContaining("src/a.rules.ts max raised")]);
    expect(growthViolations([change], [recorded], gate)).toEqual([]);
    expect(growthViolations([lowered], [], gate)).toEqual([]);
  });

  it("refuses a role cap raised without the trailer, and passes one raised with it, lowered, added or removed", () => {
    // Arrange
    const roleCaps = "__tests__/architecture/caps/role-max-lines.json";
    const change = { file: roleCaps, before: '{ "filter": 68, "error": 18 }', after: '{ "filter": 83, "error": 18 }' };
    const bare = commit("9999999999", [], [roleCaps], [change]);
    const recorded = commit("aaaaaaaaaa", [roleCaps], [roleCaps], [change]);
    const reshaped = { file: roleCaps, before: '{ "filter": 83, "error": 18 }', after: '{ "error": 12, "pipe": 31 }' };

    // Act & Assert
    expect(growthViolations([change], [bare], gate)).toEqual([expect.stringContaining(`${roleCaps}: filter max raised`)]);
    expect(growthViolations([change], [recorded], gate)).toEqual([]);
    expect(growthViolations([reshaped], [], gate)).toEqual([]);
  });

  it("passes a new exemption whose reason cites a decision its file allows, and refuses any other", () => {
    // Arrange
    const after = JSON.stringify({
      cited: `no domain seam yet (ADR 0010 D9); ${REASON}`,
      missing: `as ADR 0010 D99 asks; ${REASON}`,
      uncited: REASON,
      wrongDecision: `the AAA markers say so (ADR 0010 D2); ${REASON}`,
    });

    // Act
    const violations = growthViolations([{ file: exemption, before: "{}", after: JSON.stringify(JSON.parse(after)) }], [], gate);
    const unregistered = growthViolations([{ file: "__tests__/architecture/exemptions/rule.json", before: "{}", after: JSON.stringify({ a: REASON }) }], [], gate);

    // Assert
    expect(violations.map((v) => v.split(" (")[0])).toEqual([`${exemption}: missing`, `${exemption}: uncited`, `${exemption}: wrongDecision`]);
    expect(unregistered).toEqual([expect.stringContaining("register rule in EXEMPTION_DECISIONS")]);
  });

  it("finds the rule files that read a list by its name or its path", () => {
    // Arrange
    const sources = new Map([
      ["__tests__/architecture/test-hygiene.test.ts", 'expectAllowlisted("test-aaa", found);'],
      ["eslint.config.js", 'require("./__tests__/architecture/exemptions/size-caps.json");'],
      ["__tests__/helpers/architecture/tree.ts", "export const ROOT = 1;"],
      ["__tests__/architecture/list-growth.test.ts", '"test-aaa"'],
    ]);

    // Act & Assert
    expect(listReaders("__tests__/architecture/allowlists/test-aaa.json", sources)).toEqual(["__tests__/architecture/test-hygiene.test.ts"]);
    expect(listReaders("__tests__/architecture/exemptions/size-caps.json", sources)).toEqual(["eslint.config.js"]);
  });

  it("fails on a base that is missing when it was set or in CI, and names the cause", () => {
    // Act & Assert
    expect(missingBaseProblem({ ARCHITECTURE_BASE: "0000000000000000000000000000000000000000" })).toBe(
      "ARCHITECTURE_BASE=0000000000000000000000000000000000000000 is not in this checkout (new branch or rewritten history?)",
    );
    expect(missingBaseProblem({ CI: "true", GITHUB_BASE_REF: "dev" })).toMatch(/origin\/dev in the checkout/);
    expect(missingBaseProblem({})).toBeUndefined();
  });

  it("reads an array's strings and an object's keys", () => {
    // Act & Assert
    expect(listEntries('["a", "b"]')).toEqual(["a", "b"]);
    expect(listEntries('{ "a": 1, "b": { "max": 2 } }')).toEqual(["a", "b"]);
    expect(listEntries(undefined)).toEqual([]);
  });
});

describe("allowlists, ratchets and exemptions", () => {
  it("gain no entry their kind may not gain, against the base branch", () => {
    // Arrange
    const base = baseCommit();
    const problem = base === undefined ? missingBaseProblem() : undefined;
    if (problem !== undefined) throw new Error(problem);
    const sources = ruleSources();
    const gate: ListGate = { decisions: decisionHeadings(), cited: citedDecisions, readers: (file) => listReaders(file, sources) };

    // Act
    const violations = base === undefined ? [] : growthViolations(listChanges(base), listCommits(base), gate);

    // Assert
    expect(violations).toEqual([]);
  });

  it("are each read by a rule, and each ratchet and exemption file names decisions that exist", () => {
    // Arrange
    const sources = ruleSources();
    const headings = decisionHeadings();
    const exemptionFiles = filesUnder("__tests__/architecture/exemptions").filter((f) => f.endsWith(".json")).map((f) => path.basename(f, ".json"));

    // Act
    const stray = LIST_DIRS.flatMap((dir) =>
      filesUnder(`__tests__/architecture/${dir}`)
        .filter((f) => f.endsWith(".json"))
        .flatMap((f) => {
          const name = path.basename(f, ".json");
          if (dir === "ratchets") {
            const decision = RATCHET_DECISIONS[name];
            return decision !== undefined && headings.has(decision) ? [] : [`${f}: not in RATCHET_DECISIONS with a decision that exists`];
          }
          if (dir === "exemptions") {
            const decisions = EXEMPTION_DECISIONS[name] ?? [];
            if (decisions.length === 0 || !decisions.every((d) => headings.has(d))) return [`${f}: not in EXEMPTION_DECISIONS with decisions that exist`];
          }
          return listReaders(f, sources).length > 0 ? [] : [`${f}: no architecture test reads it`];
        }),
    );
    const unlisted = Object.keys(EXEMPTION_DECISIONS).filter((name) => !exemptionFiles.includes(name));

    // Assert
    expect(stray).toEqual([]);
    expect(unlisted).toEqual([]);
  });

  it("never share one reason between two exemptions", () => {
    // Arrange
    const files = fs.readdirSync(EXEMPTIONS_DIR).filter((f) => f.endsWith(".json"));

    // Act
    const reasons = files.flatMap((f) => {
      const text = fs.readFileSync(path.join(EXEMPTIONS_DIR, f), "utf8");
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return Object.entries(parsed).map(([key, value]) => {
        const reason = typeof value === "string" ? value : (value as { reason?: string }).reason ?? "";
        return [`${f}: ${key}`, reason.trim().toLowerCase().replace(/\s+/g, " ")] as const;
      });
    });
    const shared = reasons.filter(([, r], i) => reasons.findIndex(([, other]) => other === r) !== i).map(([where]) => where);

    // Assert
    expect(shared).toEqual([]);
    expect(path.relative(ROOT, EXEMPTIONS_DIR)).toBe("__tests__/architecture/exemptions");
  });
});
