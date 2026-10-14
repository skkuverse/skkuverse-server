/**
 * The lists beside the rules change only the way their kind allows
 * (`__tests__/helpers/architecture/lists.ts`; PR 227 F2, PR 229 F2):
 *
 *   - `list-growth`: against the base branch, an allowlist or a ratchet gains
 *     no entry unless the rule's own commit records the debt
 *     (`Architecture-Debt: <list path>`), and an exemption gains one only
 *     when its reason cites a decision that `docs/decisions/` declares.
 *   - `list-registry`: every file in `allowlists/` and `exemptions/` is read
 *     by a rule (its name appears as a string in an architecture test or
 *     helper), and
 *     every file in `ratchets/` is registered in `RATCHET_DECISIONS` with a
 *     decision that exists. A stray list holds nothing back.
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
  LIST_DIRS,
  RATCHET_DECISIONS,
  baseCommit,
  debtCommits,
  growthViolations,
  listChanges,
  listEntries,
  type DebtCommit,
} from "../helpers/architecture/lists";
import { ROOT } from "../helpers/architecture/ratchet";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const DECISIONS = new Set(["ADR 0010 D9", "ADR 0010 D2"]);
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
  const exemption = "__tests__/architecture/exemptions/rule.json";
  const ruleCommit: DebtCommit = { lists: [allowlist], changed: [allowlist, "__tests__/architecture/naming.test.ts"] };

  it("passes a list that shrank, stayed or kept its entries", () => {
    // Arrange
    const changes = [
      { file: allowlist, before: '["a", "b"]', after: '["a"]' },
      { file: ratchet, before: '["a"]', after: '["a"]' },
      { file: exemption, before: JSON.stringify({ a: REASON }), after: "{}" },
    ];

    // Act & Assert
    expect(growthViolations(changes, [], DECISIONS, citedDecisions)).toEqual([]);
  });

  it("refuses an allowlist or ratchet entry, a new file's included, unless the rule's own commit records it", () => {
    // Arrange
    const changes = [
      { file: allowlist, before: '["a"]', after: '["a", "b"]' },
      { file: ratchet, before: undefined, after: '["c"]' },
    ];
    const listOnly: DebtCommit = { lists: [allowlist, ratchet], changed: [allowlist, ratchet] };

    // Act
    const refused = growthViolations(changes, [listOnly], DECISIONS, citedDecisions);
    const recorded = growthViolations(changes.slice(0, 1), [ruleCommit], DECISIONS, citedDecisions);

    // Assert
    expect(refused.map((v) => v.split(" (")[0])).toEqual([`${allowlist}: b`, `${ratchet}: c`]);
    expect(recorded).toEqual([]);
  });

  it("passes a new exemption whose reason cites a decision that exists, and refuses any other", () => {
    // Arrange
    const after = JSON.stringify({
      cited: `no domain seam yet (ADR 0010 D9); ${REASON}`,
      missing: `as ADR 0010 D99 asks; ${REASON}`,
      uncited: REASON,
    });

    // Act
    const violations = growthViolations([{ file: exemption, before: "{}", after }], [ruleCommit], DECISIONS, citedDecisions);

    // Assert
    expect(violations.map((v) => v.split(" (")[0])).toEqual([`${exemption}: missing`, `${exemption}: uncited`]);
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
    if (base === undefined && process.env.CI) throw new Error("list-growth needs the base branch: check out full history");

    // Act
    const violations = base === undefined ? [] : growthViolations(listChanges(base), debtCommits(base), decisionHeadings(), citedDecisions);

    // Assert
    expect(violations).toEqual([]);
  });

  it("are each read by a rule, and each ratchet waits on a decision that exists", () => {
    // Arrange
    const tests = [...filesUnder("__tests__/architecture"), ...filesUnder("__tests__/helpers/architecture")].filter(
      (f) => f.endsWith(".ts") && !f.endsWith("list-growth.test.ts"),
    );
    const testText = tests.map(readSource).join("\n");
    const headings = decisionHeadings();

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
          return testText.includes(`"${name}"`) ? [] : [`${f}: no architecture test reads it`];
        }),
    );

    // Assert
    expect(stray).toEqual([]);
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
