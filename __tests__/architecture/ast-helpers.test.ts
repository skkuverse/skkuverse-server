/**
 * The syntax helpers every architecture rule shares
 * (`__tests__/helpers/architecture/ast.ts`) read exports and imports in every
 * form TypeScript writes them, and no rule keeps its own copy: a copied
 * export walker is how one rule read a re-export and the next missed it
 * (PR 226 F7, PR 227 F7, PR 229 F13).
 *
 * The copy check reads `__tests__/architecture/*.test.ts` and the other
 * helpers for a hand-written export predicate (`SyntaxKind.ExportKeyword`),
 * a literal list of the shared layers, a lifecycle-hook set, a relative
 * import resolved with `path.posix.join`, or an import walk of its own
 * (`.moduleSpecifier` read outside ast.ts: use `importsOf`).
 */
import ts from "typescript";
import {
  MONGO_READS,
  MONGO_READ_OPTIONS_ARG,
  MONGO_WRITES,
  calleeName,
  collect,
  exportedNamesDeep,
  exportsOf,
  importsOf,
  localDeclarations,
  parseSource,
  resolveRelative,
  skipOuter,
} from "../helpers/architecture/ast";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const HELPER = "__tests__/helpers/architecture/ast.ts";

const exportsIn = (source: string) => exportsOf(parseSource("src/x/x.ts", source));

describe("exportsOf", () => {
  it("reads every export form, each by the name an importer uses", () => {
    // Arrange
    const source = [
      "export function f(): void {}",
      "export function g(n: number): number;",
      "export function g(n: unknown): number { return 1; }",
      "export class C {}",
      "export enum E { A }",
      "export interface I {}",
      "export type T = string;",
      "export const v = 1, w = () => 2;",
      "export const { a, b: renamed, ...rest } = obj;",
      "export const [first] = list;",
      "const local = 3;",
      "function hidden(): void {}",
      "export { local as viaClause, hidden };",
      "export type { I as J };",
      "export { type T as U };",
      'export { x, y as z } from "./other";',
      'export type { K } from "./types";',
      'export * as ns from "./ns";',
      'export * from "./star";',
      "export default function main(): void {}",
    ].join("\n");

    // Act
    const { bindings, stars } = exportsIn(source);

    // Assert
    expect(bindings.map((b) => [b.exported, b.kind, b.isType, b.from ?? null])).toEqual([
      ["f", "function", false, null],
      ["g", "function", false, null],
      ["C", "class", false, null],
      ["E", "enum", false, null],
      ["I", "interface", true, null],
      ["T", "type", true, null],
      ["v", "variable", false, null],
      ["w", "variable", false, null],
      ["a", "variable", false, null],
      ["renamed", "variable", false, null],
      ["rest", "variable", false, null],
      ["first", "variable", false, null],
      ["viaClause", "variable", false, null],
      ["hidden", "function", false, null],
      ["J", "interface", true, null],
      ["U", "type", true, null],
      ["x", "reexport", false, "./other"],
      ["z", "reexport", false, "./other"],
      ["K", "reexport", true, "./types"],
      ["ns", "reexport", false, "./ns"],
      ["default", "function", false, null],
    ]);
    expect(stars).toEqual(["./star"]);
  });

  it("keeps a variable's initializer without parentheses, as, satisfies or !, and none for a destructured name", () => {
    // Arrange
    const source = [
      "export const a = ((n: number): boolean => n > 1);",
      "export const b = (() => 1) as () => number;",
      "export const c = (() => 1) satisfies () => number;",
      "export const d = fn!;",
      "export const { e } = obj;",
    ].join("\n");

    // Act
    const kinds = exportsIn(source).bindings.map((x) => (x.initializer ? ts.SyntaxKind[x.initializer.kind] : null));

    // Assert
    expect(kinds).toEqual(["ArrowFunction", "ArrowFunction", "ArrowFunction", "Identifier", null]);
  });

  it("unwraps outer expressions only", () => {
    // Arrange
    const sf = parseSource("x.ts", "const a = (((f as unknown) as G)!);");
    const declaration = (sf.statements[0] as ts.VariableStatement).declarationList.declarations[0]!;

    // Act & Assert
    expect(ts.isIdentifier(skipOuter(declaration.initializer!))).toBe(true);
  });
});

describe("importsOf", () => {
  it("reads imports, re-exports and import types, resolving relative specifiers", () => {
    // Arrange
    const source = [
      'import def, { a, b as c, type D } from "./m";',
      'import * as ns from "../n";',
      'import type { E } from "../../shared/e.types";',
      'import axios from "axios";',
      'export { f as g } from "./m";',
      'export type { H } from "./h";',
      'export * from "./star";',
      'type L = import("../../miniapps/types").MiniAppLogo;',
    ].join("\n");

    // Act
    const imports = importsOf(parseSource("src/x/y/x-y.mapper.ts", source));

    // Assert
    expect(imports.map((i) => [i.target, i.imported, i.local, i.isType, i.isReexport])).toEqual([
      ["src/x/y/m", "default", "def", false, false],
      ["src/x/y/m", "a", "a", false, false],
      ["src/x/y/m", "b", "c", false, false],
      ["src/x/y/m", "D", "D", true, false],
      ["src/x/n", "*", "ns", false, false],
      ["src/shared/e.types", "E", "E", true, false],
      ["axios", "default", "axios", false, false],
      ["src/x/y/m", "f", "g", false, true],
      ["src/x/y/h", "H", "H", true, true],
      ["src/x/y/star", "*", "*", false, true],
      ["src/miniapps/types", "MiniAppLogo", "MiniAppLogo", true, false],
    ]);
  });

  it("reads side-effect imports, import-equals, require and dynamic import calls, each by its kind", () => {
    // Arrange
    const source = [
      'import "./polyfill";',
      'import fs = require("fs");',
      'const axios = require("axios");',
      'const { a, b: c } = require("./m");',
      'require("./side");',
      'const lazy = () => import("../n");',
      "const notALoad = require(name);",
    ].join("\n");

    // Act
    const imports = importsOf(parseSource("src/x/y/x-y.mapper.ts", source));

    // Assert
    expect(imports.map((i) => [i.kind, i.target, i.imported, i.local, i.isType])).toEqual([
      ["side-effect", "src/x/y/polyfill", "", "", false],
      ["import-equals", "fs", "*", "fs", false],
      ["require", "axios", "*", "axios", false],
      ["require", "src/x/y/m", "a", "a", false],
      ["require", "src/x/y/m", "b", "c", false],
      ["require", "src/x/y/side", "*", "", false],
      ["dynamic", "src/x/n", "*", "", false],
    ]);
  });

  it("marks each static form with its kind", () => {
    // Arrange
    const source = 'import { a } from "./m";\nexport { b } from "./m";\ntype T = import("./t").T;';

    // Act
    const kinds = importsOf(parseSource("src/x/x.ts", source)).map((i) => i.kind);

    // Assert
    expect(kinds).toEqual(["import", "reexport", "import-type"]);
  });

  it("resolves a relative specifier to a repo path and leaves a package alone", () => {
    // Act & Assert
    expect(resolveRelative("src/x/y/a.ts", "../../infra/mongo.ts")).toBe("src/infra/mongo");
    expect(resolveRelative("src/x/a.ts", "./b")).toBe("src/x/b");
    expect(resolveRelative("src/x/a.ts", "mongodb")).toBeUndefined();
  });
});

describe("calleeName", () => {
  it.each([
    ["an identifier", "find(filter);", "find"],
    ["a property", "db.col.find(filter);", "find"],
    ["an element access", 'col["find"](filter);', "find"],
    ["an optional chain", "col?.find(filter);", "find"],
    ["a cast callee", "(col.find as Finder)(filter);", "find"],
    ["a computed name", "col[name](filter);", undefined],
  ])("reads %s", (_case, source, name) => {
    // Arrange
    const [call] = collect(parseSource("x.ts", source), ts.isCallExpression);

    // Act & Assert
    expect(calleeName(call!)).toBe(name);
  });
});

describe("localDeclarations", () => {
  it("reads an overloaded function by its implementation", () => {
    // Arrange
    const sf = parseSource("x.ts", "function g(n: number): number;\nfunction g(n: string): number;\nfunction g(n: unknown): number { return 1; }");

    // Act
    const g = localDeclarations(sf).get("g");

    // Assert
    expect((g?.declaration as ts.FunctionDeclaration).body).toBeDefined();
  });
});

describe("the Mongo call names", () => {
  it("list each driver read with its options index, and each write", () => {
    // Act & Assert
    expect(MONGO_READ_OPTIONS_ARG).toEqual({ find: 1, findOne: 1, aggregate: 1, countDocuments: 1, estimatedDocumentCount: 0, distinct: 2 });
    expect([...MONGO_READS].sort()).toEqual(["aggregate", "countDocuments", "distinct", "estimatedDocumentCount", "find", "findOne"]);
    expect([...MONGO_WRITES].sort()).toEqual([
      "bulkWrite",
      "deleteMany",
      "deleteOne",
      "findOneAndDelete",
      "findOneAndReplace",
      "findOneAndUpdate",
      "insertMany",
      "insertOne",
      "replaceOne",
      "updateMany",
      "updateOne",
    ]);
  });
});

describe("exportedNamesDeep", () => {
  it("follows a relative export * through the files it knows, and marks a package star open", () => {
    // Arrange
    const sources: Record<string, string> = {
      "src/x/a.ts": 'export const a = 1;\nexport * from "./b";\nexport * from "./a";',
      "src/x/b.ts": 'export const b = 2;\nexport * from "./c";',
      "src/x/c.ts": "export type C = 3;\nexport default 1;",
      "src/x/d.ts": 'export * from "zod";',
    };
    const files = new Set(Object.keys(sources));
    const read = (f: string): string => sources[f] ?? "";

    // Act
    const deep = exportedNamesDeep("src/x/a.ts", read, files);
    const open = exportedNamesDeep("src/x/d.ts", read, files);

    // Assert
    expect([...deep.names].sort()).toEqual(["C", "a", "b"]);
    expect(deep.open).toBe(false);
    expect(open.open).toBe(true);
  });
});

/** `<file>: <what>` for each copy of a shared helper outside ast.ts. */
export function helperCopies(file: string, source: string): string[] {
  if (file === HELPER) return [];
  const copies: Array<[string, RegExp]> = [
    ["an export predicate (use isExported/exportsOf)", /SyntaxKind\.ExportKeyword/],
    ["a shared-layer list (use SHARED_LAYERS)", /["']config["'],\s*["']http["'],\s*["']infra["'],\s*["']scheduling["'],\s*["']shared["']/],
    ["a lifecycle-hook set (use NEST_LIFECYCLE)", /["']onModuleInit["'],\s*["']onModuleDestroy["']/],
    ["a relative import resolved by hand (use resolveRelative)", /path\.posix\.join\(path\.posix\.dirname\(/],
    ["an import walk of its own (use importsOf)", /\.moduleSpecifier\b/],
  ];
  return copies.filter(([, pattern]) => pattern.test(source)).map(([what]) => `${file}: ${what}`);
}

describe("helper copy rule applies as specified", () => {
  it.each([
    ["an export predicate", "const isExported = (n) => n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);"],
    ["a shared-layer list", 'const SHARED = new Set(["config", "http", "infra", "scheduling", "shared"]);'],
    ["a lifecycle set", 'const LIFECYCLE = new Set(["onModuleInit", "onModuleDestroy"]);'],
    ["a hand resolve", "path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));"],
    ["an import walk", "if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)) out.push(s.moduleSpecifier.text);"],
  ])("fails %s", (_case, source) => {
    // Act & Assert
    expect(helperCopies("__tests__/architecture/naming.test.ts", source)).toHaveLength(1);
  });

  it("passes the helper itself and a rule that imports it", () => {
    // Act & Assert
    expect(helperCopies(HELPER, "SyntaxKind.ExportKeyword")).toEqual([]);
    expect(helperCopies("__tests__/architecture/naming.test.ts", 'import { isExported } from "../helpers/architecture/ast";')).toEqual([]);
  });
});

describe("architecture tests and helpers", () => {
  it("share the syntax helpers instead of copying them", () => {
    // Arrange
    const files = [...filesUnder("__tests__/architecture"), ...filesUnder("__tests__/helpers/architecture")].filter(
      (f) => f.endsWith(".ts") && f !== "__tests__/architecture/ast-helpers.test.ts",
    );

    // Act
    const copies = files.flatMap((f) => helperCopies(f, readSource(f)));

    // Assert
    expect(copies).toEqual([]);
  });
});
