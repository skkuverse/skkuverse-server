/**
 * A service in a migrated scope has its spec (ADR 0011, D1): `x.service.ts`
 * → `x.service.spec.ts` in the same folder, over fakes. A service that only
 * delegates (a door that forwards to its repository, a call into a mapper the
 * mapper's spec covers) is exempt instead, in
 * `exemptions/service-specs.json` with the reason (helpers/architecture/
 * exemptions.ts). An exempt service keeps the shape its reason claims
 * (`delegationProblems`): no branch (`if`, `?:`, `switch`, `&&`, `||`, `??`)
 * and no loop in any method, and at most MAX_DELEGATION_STATEMENTS
 * statements per method. A service that grows a decision fails here until it
 * gets its spec, whatever its reason says.
 *
 * Modules not yet migrated are not checked, so there is no allowlist.
 */
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import { collect, parseSource } from "../helpers/architecture/ast";
import { expectExempted, readExemptions } from "../helpers/architecture/exemptions";
import { inScope, migratedScopes } from "../helpers/architecture/migrated";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const RULE = "service-specs";

/** Each `.service.ts` in a scope without its sibling spec, sorted. */
export function servicesWithoutSpecs(files: readonly string[], scopes: readonly string[]): string[] {
  const present = new Set(files);
  return files
    .filter((file) => file.startsWith("src/") && file.endsWith(".service.ts"))
    .filter((file) => scopes.some((scope) => inScope(file, scope)))
    .filter((file) => !present.has(file.replace(/\.ts$/, ".spec.ts")))
    .sort();
}

const MAX_DELEGATION_STATEMENTS = 2;

const BRANCH_OPERATORS = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken]);

const isDecision = (n: ts.Node): n is ts.Node =>
  ts.isIfStatement(n) ||
  ts.isConditionalExpression(n) ||
  ts.isSwitchStatement(n) ||
  ts.isIterationStatement(n, false) ||
  (ts.isBinaryExpression(n) && BRANCH_OPERATORS.has(n.operatorToken.kind));

/** `<file>: <Class.method> <problem>` for each method of a service's classes that does more than delegate. */
export function delegationProblems(file: string, source: string): string[] {
  return parseSource(file, source)
    .statements.filter(ts.isClassDeclaration)
    .flatMap((cls) =>
      cls.members.flatMap((m) => {
        if (!(ts.isMethodDeclaration(m) || ts.isGetAccessor(m) || ts.isConstructorDeclaration(m)) || !m.body) return [];
        const name = `${cls.name?.text ?? "(anonymous)"}.${m.name?.getText() ?? "constructor"}`;
        const out: string[] = [];
        if (collect(m.body, isDecision).length > 0) out.push(`${file}: ${name} decides (a branch or a loop)`);
        if (m.body.statements.length > MAX_DELEGATION_STATEMENTS) out.push(`${file}: ${name} runs ${m.body.statements.length} statements`);
        return out;
      }),
    );
}

describe("service spec rule applies as specified", () => {
  it("asks a spec of each service in a scope, next to it, and nothing outside the scopes", () => {
    // Arrange
    const files = [
      "src/a/a.service.ts",
      "src/a/a.service.spec.ts",
      "src/a/b/a-b.service.ts",
      "src/a/c/a-c.service.ts",
      "src/a/c/other.service.spec.ts",
      "src/a/a.mapper.ts",
      "src/z/z.service.ts",
      "__tests__/nest/a/a.service.ts",
    ];

    // Act & Assert
    expect(servicesWithoutSpecs(files, ["src/a/"])).toEqual(["src/a/b/a-b.service.ts", "src/a/c/a-c.service.ts"]);
  });

  describe("an exemption file", () => {
    let dir: string;
    const write = (body: unknown): void => fs.writeFileSync(path.join(dir, "rule.json"), JSON.stringify(body));
    const reason = "pure delegation: forwards each call to `ARepository` unchanged";

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "exemptions-"));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("exempts the listed paths and reads a missing file as none", () => {
      // Arrange
      write({ "src/a/a.service.ts": reason });

      // Act & Assert
      expect(() => expectExempted("rule", ["src/a/a.service.ts"], dir)).not.toThrow();
      expect(readExemptions("missing", dir)).toEqual(new Map());
    });

    it("fails a violation it does not list, and a listed path that no longer violates", () => {
      // Arrange
      write({ "src/a/a.service.ts": reason });

      // Act & Assert
      expect(() => expectExempted("rule", ["src/a/a.service.ts", "src/b/b.service.ts"], dir)).toThrow(/src\/b\/b\.service\.ts/);
      expect(() => expectExempted("rule", [], dir)).toThrow(/Delete these[\s\S]*src\/a\/a\.service\.ts/);
    });

    it.each([
      ["an empty reason", { "src/a/a.service.ts": "" }],
      ["a short reason", { "src/a/a.service.ts": "delegation" }],
      ["a long reason of too few words", { "src/a/a.service.ts": "delegation-to-the-repository-and-the-mapper-only" }],
      ["a reason that is not a string", { "src/a/a.service.ts": true }],
      ["an array", ["src/a/a.service.ts"]],
      ["unsorted paths", { "src/b/b.service.ts": reason, "src/a/a.service.ts": reason }],
    ])("is refused with %s", (_case, body) => {
      // Arrange
      write(body);

      // Act & Assert
      expect(() => readExemptions("rule", dir)).toThrow(/rule\.json/);
    });
  });
});

describe("delegation shape applies as specified", () => {
  it("passes a service that forwards, and flags a branch, a loop or a long method", () => {
    // Arrange
    const source = `
export class XService {
  constructor(private readonly repository: XRepository) {}
  list(campus: Campus): Promise<X[]> { return this.repository.listX(campus); }
  async sheet(lang: Lang): Promise<Sheet> { const now = this.clock.now(); return toSheet(await this.config.read(), now, lang); }
  pick(id: number): X { return id > 0 ? this.repository.one(id) : this.repository.none(); }
  fallback(id: number): X { return this.repository.one(id) ?? DEFAULT; }
  each(ids: number[]): void { for (const id of ids) this.repository.touch(id); }
  long(): void { this.a(); this.b(); this.c(); }
}`;

    // Act
    const problems = delegationProblems("src/x/x.service.ts", source);

    // Assert
    expect(problems).toEqual([
      "src/x/x.service.ts: XService.pick decides (a branch or a loop)",
      "src/x/x.service.ts: XService.fallback decides (a branch or a loop)",
      "src/x/x.service.ts: XService.each decides (a branch or a loop)",
      "src/x/x.service.ts: XService.long runs 3 statements",
    ]);
  });
});

describe("services in migrated scopes", () => {
  it("have a sibling spec or a reasoned exemption", () => {
    // Act & Assert
    expectExempted(RULE, servicesWithoutSpecs(filesUnder("src"), migratedScopes()));
  });

  it("keep the delegation shape their exemption claims", () => {
    // Arrange
    const exempt = [...readExemptions(RULE).keys()];

    // Act
    const problems = exempt.flatMap((file) => delegationProblems(file, readSource(file)));

    // Assert
    expect(exempt.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
