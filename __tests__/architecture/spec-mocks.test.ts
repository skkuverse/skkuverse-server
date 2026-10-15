/**
 * Only a boundary spec doubles the process boundary itself (ADR 0011, D1;
 * `.claude/rules/tests.md`, "What to double"). A service spec runs over the
 * repository and client fakes, so the query a fake copies is pinned once, in
 * the repository spec, and a service spec never depends on how the driver is
 * called.
 *
 * In a module scope, these appear only in a `*.repository.spec.ts` or
 * `*.client.spec.ts`:
 *
 *   - `jest.mock` (or `doMock`, `setMock`, `unstable_mockModule`) of a seam that leaves the process: the
 *     Mongo client (`src/infra/db`), the collections over it
 *     (`src/infra/mongo`), the driver itself (`mongodb`), the FCM call
 *     (`src/infra/fcm`) and `axios`. The seams' own specs
 *     (`src/infra/db.spec.ts`, `src/infra/mongo.spec.ts`,
 *     `src/infra/fcm.spec.ts`) may mock what they wrap;
 *   - `jest.spyOn(<X>Repository.prototype, …)` or
 *     `jest.spyOn(<X>Client.prototype, …)`, a cast around it included: a spy
 *     on the real class instead of its fake (`jest.replaceProperty` counts
 *     as a spy);
 *   - `jest.spyOn(axios, …)` on the axios import (or its `.default`), and an
 *     assignment to one of its members (`axios.get = jest.fn()`);
 *   - `new <X>Repository(…)` or `new <X>Client(…)`: the real class, spied on
 *     or not, where its fake (`Fake<X>…`) belongs.
 *
 * A class is read by the name it is exported under, so an alias
 * (`import { MapRepository as Repo }`) is no way around the rule.
 *
 * Mocking the logger, or a module that is not a seam, is not checked here.
 * There is no allowlist; a test that has no fake to use instead is exempt with
 * its reason in `exemptions/spec-mocks.json`.
 */
import ts from "typescript";
import { importsOf, parseSource, resolveSpecifier, skipOuter } from "../helpers/architecture/ast";
import { expectExempted } from "../helpers/architecture/exemptions";
import { inScope, moduleScopes } from "../helpers/architecture/scopes";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const SEAMS = new Set(["src/infra/db", "src/infra/mongo", "src/infra/fcm", "axios", "mongodb"]);
const SEAM_OWNERS = new Set(["src/infra/db.spec.ts", "src/infra/mongo.spec.ts", "src/infra/fcm.spec.ts"]);
const BOUNDARY_SPEC = /\.(?:repository|client)\.spec\.ts$/;
const DOUBLED_CLASS = /^(?!Fake)\w+(?:Repository|Client)$/;
const MOCK_CALLS = new Set(["mock", "doMock", "setMock", "unstable_mockModule"]);
const SPY_CALLS = new Set(["spyOn", "replaceProperty"]);

const isJestCall = (call: ts.CallExpression, names: ReadonlySet<string>): boolean =>
  ts.isPropertyAccessExpression(call.expression) &&
  ts.isIdentifier(call.expression.expression) &&
  call.expression.expression.text === "jest" &&
  names.has(call.expression.name.text);

/** The class a `new` builds, by its name: `new MapRepository()` or `new db.MapRepository()`. */
const constructedName = (node: ts.NewExpression): string | undefined => {
  const callee = skipOuter(node.expression);
  if (ts.isIdentifier(callee)) return callee.text;
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
};

/** `axios`, or `axios.default`, through any name the axios import is bound to. */
const isAxios = (node: ts.Expression, axiosNames: ReadonlySet<string>): boolean => {
  const e = skipOuter(node);
  if (ts.isIdentifier(e)) return axiosNames.has(e.text);
  return ts.isPropertyAccessExpression(e) && e.name.text === "default" && ts.isIdentifier(e.expression) && axiosNames.has(e.expression.text);
};

/**
 * `<file>: jest.mock(<seam>)`, `<file>: jest.spyOn(<Class>.prototype)`, `<file>: jest.spyOn(axios)` and
 * `<file>: new <Class>` for each double, or real repository or client, a non-boundary spec holds.
 */
export function specMockViolations(file: string, source: string): string[] {
  if (BOUNDARY_SPEC.test(file) || SEAM_OWNERS.has(file)) return [];
  const sf = parseSource(file, source);
  const imports = importsOf(sf);
  const axiosNames = new Set(imports.filter((i) => i.target === "axios" && (i.imported === "default" || i.imported === "*") && i.local !== "").map((i) => i.local));
  const exportedName = new Map(imports.filter((i) => i.imported !== "*" && i.imported !== "default" && i.local !== "").map((i) => [i.local, i.imported]));
  const className = (name: string): string => exportedName.get(name) ?? name;
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node)) {
      const name = constructedName(node);
      if (name !== undefined && DOUBLED_CLASS.test(className(name))) out.push(`${file}: new ${className(name)}`);
    }
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      if (isJestCall(node, MOCK_CALLS) && first && ts.isStringLiteralLike(first) && SEAMS.has(resolveSpecifier(file, first.text))) {
        out.push(`${file}: jest.mock(${resolveSpecifier(file, first.text)})`);
      }
      const spied = first === undefined ? undefined : skipOuter(first);
      if (isJestCall(node, SPY_CALLS) && spied !== undefined) {
        const target = ts.isPropertyAccessExpression(spied) && spied.name.text === "prototype" ? skipOuter(spied.expression) : undefined;
        if (target !== undefined && ts.isIdentifier(target) && DOUBLED_CLASS.test(className(target.text))) {
          out.push(`${file}: jest.spyOn(${className(target.text)}.prototype)`);
        }
        if (isAxios(spied, axiosNames)) out.push(`${file}: jest.spyOn(axios)`);
      }
    }
    const assigned = ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken ? skipOuter(node.left) : undefined;
    if (assigned !== undefined && (ts.isPropertyAccessExpression(assigned) || ts.isElementAccessExpression(assigned)) && isAxios(assigned.expression, axiosNames)) {
      out.push(`${file}: axios member assigned`);
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
    ["a spy on a client's prototype", "__tests__/nest/map/map.routes.test.ts", 'jest.spyOn(XClient.prototype, "fetchList");', ["jest.spyOn(XClient.prototype)"]],
    ["the driver", "src/x/x.service.spec.ts", 'jest.mock("mongodb");', ["jest.mock(mongodb)"]],
    ["the FCM call", "src/x/y/x-y.service.spec.ts", 'jest.mock("../../infra/fcm");', ["jest.mock(src/infra/fcm)"]],
    ["a spy on axios", "src/x/x.service.spec.ts", 'import axios from "axios";\njest.spyOn(axios, "get");', ["jest.spyOn(axios)"]],
    ["a spy on a cast prototype", "src/x/x.service.spec.ts", 'jest.spyOn(XRepository.prototype as any, "findOne");', ["jest.spyOn(XRepository.prototype)"]],
    ["a real repository instance", "src/x/x.service.spec.ts", 'const repo = new MapRepository();\njest.spyOn(repo, "listPlaces");', ["new MapRepository"]],
    ["an aliased repository", "src/x/x.service.spec.ts", 'import { MapRepository as Repo } from "../map/map.repository";\nnew Repo();', ["new MapRepository"]],
    [
      "a spy on an aliased repository's prototype",
      "src/x/x.service.spec.ts",
      'import { MapRepository as Repo } from "../map/map.repository";\njest.spyOn(Repo.prototype, "listPlaces");',
      ["jest.spyOn(MapRepository.prototype)"],
    ],
    ["axios through setMock", "src/x/x.service.spec.ts", 'jest.setMock("axios", { get: jest.fn() });', ["jest.mock(axios)"]],
    ["the driver through unstable_mockModule", "src/x/x.service.spec.ts", 'jest.unstable_mockModule("mongodb", () => ({}));', ["jest.mock(mongodb)"]],
    ["a replaced axios property", "src/x/x.service.spec.ts", 'import axios from "axios";\njest.replaceProperty(axios, "defaults", {});', ["jest.spyOn(axios)"]],
    ["an assigned axios member", "src/x/x.service.spec.ts", 'import axios from "axios";\naxios.get = jest.fn();', ["axios member assigned"]],
    ["a spy on a namespace's default", "src/x/x.service.spec.ts", 'import * as ax from "axios";\njest.spyOn(ax.default, "get");', ["jest.spyOn(axios)"]],
    ["a required axios", "src/x/x.service.spec.ts", 'const axios = require("axios");\njest.spyOn(axios, "get");', ["jest.spyOn(axios)"]],
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
    ["a fake repository", "src/x/x.service.spec.ts", "const repo = new FakeMapRepository();"],
    ["a real repository in its own spec", "src/x/x.repository.spec.ts", "const repo = new XRepository(clock);"],
  ])("passes %s", (_case, file, source) => {
    // Act & Assert
    expect(specMockViolations(file, source)).toEqual([]);
  });
});

describe("specs in the module scopes", () => {
  it("double Mongo, axios and real repositories or clients only in repository and client specs", () => {
    // Act
    const violations = testFilesInScopes(moduleScopes()).flatMap((f) => specMockViolations(f, readSource(f)));

    // Assert
    expectExempted("spec-mocks", violations);
  });
});
