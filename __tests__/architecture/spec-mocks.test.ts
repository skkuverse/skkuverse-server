/**
 * Only a boundary spec doubles the process boundary itself (ADR 0011, D1;
 * `.claude/rules/tests.md`, "What to double"). A service spec runs over the
 * repository and client fakes, so the query a fake copies is pinned once, in
 * the repository spec, and a service spec never depends on how the driver is
 * called.
 *
 * In a migrated scope, these appear only in a `*.repository.spec.ts` or
 * `*.client.spec.ts`:
 *
 *   - `jest.mock` (or `jest.doMock`) of a seam that leaves the process: the
 *     Mongo client (`src/infra/db`), the collections over it
 *     (`src/infra/mongo`) and `axios`. The seams' own specs
 *     (`src/infra/db.spec.ts`, `src/infra/mongo.spec.ts`) may mock what they
 *     wrap;
 *   - `jest.spyOn(<X>Repository.prototype, …)` or
 *     `jest.spyOn(<X>Client.prototype, …)`: a spy on the real class instead of
 *     its fake.
 *
 * Mocking the logger, or a module that is not a seam, is not checked here.
 * Modules not yet migrated keep their module mocks until their rework, so
 * there is no allowlist; a test that has no fake to use instead is exempt with
 * its reason in `exemptions/spec-mocks.json`.
 */
import path from "path";
import ts from "typescript";
import { expectExempted } from "../helpers/architecture/exemptions";
import { inScope, migratedScopes } from "../helpers/architecture/migrated";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const SEAMS = new Set(["src/infra/db", "src/infra/mongo", "axios"]);
const SEAM_OWNERS = new Set(["src/infra/db.spec.ts", "src/infra/mongo.spec.ts"]);
const BOUNDARY_SPEC = /\.(?:repository|client)\.spec\.ts$/;
const DOUBLED_CLASS = /^\w+(?:Repository|Client)$/;
const MOCK_CALLS = new Set(["mock", "doMock"]);

/** A module specifier as a repo path (`../../infra/mongo` → `src/infra/mongo`), or a package name as written. */
export function resolveSpecifier(file: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)).replace(/\.ts$/, "");
}

const isJestCall = (call: ts.CallExpression, names: ReadonlySet<string>): boolean =>
  ts.isPropertyAccessExpression(call.expression) &&
  ts.isIdentifier(call.expression.expression) &&
  call.expression.expression.text === "jest" &&
  names.has(call.expression.name.text);

/** `<file>: jest.mock(<seam>)` and `<file>: jest.spyOn(<Class>.prototype)` for each double a non-boundary spec holds. */
export function specMockViolations(file: string, source: string): string[] {
  if (BOUNDARY_SPEC.test(file) || SEAM_OWNERS.has(file)) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      if (isJestCall(node, MOCK_CALLS) && first && ts.isStringLiteralLike(first) && SEAMS.has(resolveSpecifier(file, first.text))) {
        out.push(`${file}: jest.mock(${resolveSpecifier(file, first.text)})`);
      }
      const isPrototypeSpy =
        isJestCall(node, new Set(["spyOn"])) &&
        first !== undefined &&
        ts.isPropertyAccessExpression(first) &&
        first.name.text === "prototype" &&
        ts.isIdentifier(first.expression) &&
        DOUBLED_CLASS.test(first.expression.text);
      if (isPrototypeSpy) out.push(`${file}: jest.spyOn(${first.expression.getText(sf)}.prototype)`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function testFilesInScopes(scopes: readonly string[]): string[] {
  return [...filesUnder("src"), ...filesUnder("__tests__/nest")]
    .filter((f) => /\.(?:spec|test)\.ts$/.test(f))
    .filter((f) => scopes.some((scope) => inScope(f, scope)));
}

describe("spec mock rule applies as specified", () => {
  it.each([
    ["the Mongo collections, relative", "src/x/y/x-y.service.spec.ts", 'jest.mock("../../infra/mongo", () => ({}));', ["jest.mock(src/infra/mongo)"]],
    ["the Mongo client, through doMock", "src/x/x.service.spec.ts", 'jest.doMock("../infra/db");', ["jest.mock(src/infra/db)"]],
    ["axios", "src/x/x.mapper.spec.ts", 'jest.mock("axios", () => ({ get: jest.fn() }));', ["jest.mock(axios)"]],
    ["a spy on a repository's prototype", "src/x/x.service.spec.ts", 'jest.spyOn(XRepository.prototype, "findOne");', ["jest.spyOn(XRepository.prototype)"]],
    ["a spy on a client's prototype", "__tests__/nest/x/x.routes.test.ts", 'jest.spyOn(XClient.prototype, "fetchList");', ["jest.spyOn(XClient.prototype)"]],
  ])("refuses %s outside a boundary spec", (_case, file, source, problems) => {
    // Act & Assert
    expect(specMockViolations(file, source)).toEqual(problems.map((p) => `${file}: ${p}`));
  });

  it.each([
    ["a repository spec mocking the Mongo client", "src/x/x.repository.spec.ts", 'jest.mock("../infra/db");'],
    ["a client spec mocking axios", "src/x/y/x-y.client.spec.ts", 'jest.mock("axios");'],
    ["the collections' own spec mocking the client", "src/infra/mongo.spec.ts", 'jest.mock("./db");'],
    ["the logger, anywhere", "src/x/x.service.spec.ts", 'jest.mock("../infra/logger", () => ({}));'],
    ["a module that is not a seam", "src/x/x.service.spec.ts", 'jest.mock("./x.config");'],
    ["a spy on a fake instance or another prototype", "src/x/x.service.spec.ts", 'jest.spyOn(fake, "findOne");\njest.spyOn(XService.prototype, "run");'],
    ["a path that only ends like a seam", "src/x/x.service.spec.ts", 'jest.mock("./mongo");'],
  ])("passes %s", (_case, file, source) => {
    // Act & Assert
    expect(specMockViolations(file, source)).toEqual([]);
  });
});

describe("specs in migrated scopes", () => {
  it("double Mongo, axios and real repositories or clients only in repository and client specs", () => {
    // Act
    const violations = testFilesInScopes(migratedScopes()).flatMap((f) => specMockViolations(f, readSource(f)));

    // Assert
    expectExempted("spec-mocks", violations);
  });
});
