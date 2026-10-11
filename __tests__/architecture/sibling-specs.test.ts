/**
 * A role file whose test sits next to it has that test (ADR 0011, D1):
 * `x.rules.ts` → `x.rules.spec.ts` in the same folder. The roles are the pure
 * ones, `.rules`, `.mapper` and `.schema`, and the adapters, `.repository`,
 * `.client` and `.poller`. A `.rules` file that declares no function holds
 * constants only and needs none.
 *
 * The other roles are tested elsewhere or by judgment: a controller and a
 * module by the route and architecture tests, a `.wire` by
 * `__tests__/contracts/`, a `.query` through its repository's spec (no new
 * structure pins), and a `.service` by a spec only when it composes more than
 * a delegation.
 *
 * The allowlist holds the files of modules not yet migrated; a migrated scope
 * carries no entry (migrated-scopes.test.ts).
 */
import ts from "typescript";
import { EXEMPT, parse } from "../helpers/architecture/names";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const RULE = "sibling-specs";

export const SPEC_ROLES = new Set(["rules", "mapper", "schema", "repository", "client", "poller"]);

const isCode = (node: ts.Node): boolean =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node) ||
  ts.isClassLike(node);

export function declaresFunction(file: string, source: string): boolean {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node: ts.Node): boolean => isCode(node) || (ts.forEachChild(node, visit) ?? false);
  return visit(sf);
}

function needsSpec(file: string): boolean {
  if (!file.startsWith("src/") || !file.endsWith(".ts") || file.endsWith(".spec.ts")) return false;
  if (file.includes(".generated.") || EXEMPT.has(file)) return false;
  const { parts } = parse(file);
  return parts.length > 1 && SPEC_ROLES.has(parts.at(-1)!);
}

/** Each role file under src/ without its sibling spec, sorted. `read` gives a file's source. */
export function missingSpecs(files: readonly string[], read: (file: string) => string): string[] {
  const present = new Set(files);
  return files
    .filter(needsSpec)
    .filter((file) => !present.has(file.replace(/\.ts$/, ".spec.ts")))
    .filter((file) => !file.endsWith(".rules.ts") || declaresFunction(file, read(file)))
    .sort();
}

describe("sibling spec rule applies as specified", () => {
  const withFunctions = (): string => "export function f(): number { return 1; }";

  it.each([...SPEC_ROLES])("fails a .%s file without its spec", (role) => {
    // Arrange
    const file = `src/x/x.${role}.ts`;

    // Act & Assert
    expect(missingSpecs([file], withFunctions)).toEqual([file]);
  });

  it("passes a role file whose spec sits next to it, in a module root and in a sub-module", () => {
    // Arrange
    const files = ["src/x/x.mapper.ts", "src/x/x.mapper.spec.ts", "src/x/y/x-y.schema.ts", "src/x/y/x-y.schema.spec.ts"];

    // Act & Assert
    expect(missingSpecs(files, withFunctions)).toEqual([]);
  });

  it("counts no spec in another folder, under another name or under __tests__/", () => {
    // Arrange
    const files = [
      "src/x/x.rules.ts",
      "src/x/y/x.rules.spec.ts",
      "src/x/x.rule.spec.ts",
      "src/x/x.spec.ts",
      "__tests__/x/x.rules.spec.ts",
    ];

    // Act & Assert
    expect(missingSpecs(files, withFunctions)).toEqual(["src/x/x.rules.ts"]);
  });

  it("asks nothing of the roles tested elsewhere, of generated and exempt files, or outside src/", () => {
    // Arrange
    const files = [
      "src/x/x.controller.ts",
      "src/x/x.module.ts",
      "src/x/x.service.ts",
      "src/x/x.query.ts",
      "src/x/x.wire.ts",
      "src/x/x.types.ts",
      "src/x/x.document.ts",
      "src/x/x.constants.ts",
      "src/x/x.config.ts",
      "src/x/x.schema.generated.ts",
      "src/shared/regex.util.ts",
      "src/infra/db.ts",
      "src/main.ts",
      "scripts/lib/x.rules.ts",
    ];

    // Act & Assert
    expect(missingSpecs(files, withFunctions)).toEqual([]);
  });

  it("asks no spec of a .rules file of constants only, but of one with a function and of a mapper of constants", () => {
    // Arrange
    const sources: Record<string, string> = {
      "src/a/a.rules.ts": 'export const MAX_A = 3;\nexport const A_KINDS = ["x", "y"] as const;',
      "src/b/b.rules.ts": "export const isB = (value: number): boolean => value > 1;",
      "src/c/c.rules.ts": "export function isC(value: number): boolean { return value > 1; }",
      "src/d/d.mapper.ts": "export const D = 1;",
    };

    // Act
    const missing = missingSpecs(Object.keys(sources), (file) => sources[file] ?? "");

    // Assert
    expect(missing).toEqual(["src/b/b.rules.ts", "src/c/c.rules.ts", "src/d/d.mapper.ts"]);
  });
});

describe("src/ role files", () => {
  it("have a sibling spec", () => {
    // Act & Assert
    expectAllowlisted(RULE, missingSpecs(filesUnder("src"), readSource));
  });
});
