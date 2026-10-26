/**
 * The syntax every architecture rule reads the same way: what a source
 * exports, what it imports and from which repo path, and the shared names
 * (the shared layers, Nest lifecycle hooks, Mongo reads). A rule that copies
 * one of these drifts from the others in which syntax it sees, so a re-export
 * is read by one rule and missed by the next; `ast-helpers` (architecture
 * tests) fails a copy outside this folder.
 */
import path from "path";
import ts from "typescript";

/** The top-level `src/` folders that are layers every feature may use, not features. */
export const SHARED_LAYERS: readonly string[] = ["config", "http", "infra", "perimeter", "scheduling", "shared"];

export const isSharedLayer = (folder: string): boolean => SHARED_LAYERS.includes(folder);

/** The gitignored `src/` folder a build or the composed gate copies the private perimeter overlay to: no module. */
export const OVERLAY_FOLDER = "private";

/** Nest's lifecycle hooks: public because Nest calls them, never production code. */
export const NEST_LIFECYCLE: ReadonlySet<string> = new Set([
  "onModuleInit",
  "onModuleDestroy",
  "onApplicationBootstrap",
  "beforeApplicationShutdown",
  "onApplicationShutdown",
]);

/** The Mongo driver's read calls, and the index of each one's options argument. */
export const MONGO_READ_OPTIONS_ARG: Readonly<Record<string, number>> = {
  find: 1,
  findOne: 1,
  aggregate: 1,
  countDocuments: 1,
  estimatedDocumentCount: 0,
  distinct: 2,
};

export const MONGO_READS: ReadonlySet<string> = new Set(Object.keys(MONGO_READ_OPTIONS_ARG));

/** The Mongo driver's write calls. */
export const MONGO_WRITES: ReadonlySet<string> = new Set([
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "bulkWrite",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
]);

export function parseSource(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

/** A statement declared with `export` (`export default` included). */
export const isExported = (node: ts.Node): boolean => hasModifier(node, ts.SyntaxKind.ExportKeyword);

/** A class member that is `private`, `protected` or `#private`. */
export const isNonPublic = (member: ts.ClassElement): boolean =>
  (member.name !== undefined && ts.isPrivateIdentifier(member.name)) ||
  hasModifier(member, ts.SyntaxKind.PrivateKeyword) ||
  hasModifier(member, ts.SyntaxKind.ProtectedKeyword);

/** An expression without the parentheses, `as`, `satisfies`, `<T>` and `!` around it. */
export function skipOuter(expression: ts.Expression): ts.Expression {
  let e = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e) || ts.isNonNullExpression(e)) {
      e = e.expression;
    } else {
      return e;
    }
  }
}

export const isFunctionExpression = (node: ts.Node | undefined): node is ts.ArrowFunction | ts.FunctionExpression =>
  node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

/** The identifiers a binding declares: `a`, or each name of `{ a, b: c }` and `[d, ...e]`. */
export function boundIdentifiers(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : boundIdentifiers(element.name)));
}

export type ExportKind = "function" | "class" | "variable" | "enum" | "interface" | "type" | "namespace" | "default" | "reexport";

export interface ExportedBinding {
  /** The name an importer uses: `default` for a default export. */
  exported: string;
  /** The name it is declared under in this file, when it is declared here. */
  local: string | undefined;
  kind: ExportKind;
  /** An interface, a type alias, or a type-only specifier. */
  isType: boolean;
  /** The declaration in this file: the statement, or a variable's declarator. */
  declaration: ts.Node | undefined;
  /** A variable's initializer without outer expressions, or a default export's expression; not for a destructured name. */
  initializer: ts.Expression | undefined;
  /** The module specifier of a re-export (`export { x } from "./m"`, `export * as m from "./m"`). */
  from: string | undefined;
}

export interface ModuleExports {
  bindings: ExportedBinding[];
  /** The specifiers of `export * from "…"`, whose names this module exports too. */
  stars: string[];
}

interface LocalDeclaration {
  kind: Exclude<ExportKind, "default" | "reexport">;
  declaration: ts.Node;
  initializer: ts.Expression | undefined;
}

function declarationKind(s: ts.Statement): LocalDeclaration["kind"] | undefined {
  if (ts.isFunctionDeclaration(s)) return "function";
  if (ts.isClassDeclaration(s)) return "class";
  if (ts.isEnumDeclaration(s)) return "enum";
  if (ts.isInterfaceDeclaration(s)) return "interface";
  if (ts.isTypeAliasDeclaration(s)) return "type";
  if (ts.isModuleDeclaration(s)) return "namespace";
  return undefined;
}

/** Every top-level declaration of a source by name; an overloaded function by its implementation. */
export function localDeclarations(sf: ts.SourceFile): Map<string, LocalDeclaration> {
  const out = new Map<string, LocalDeclaration>();
  for (const s of sf.statements) {
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        const whole = ts.isIdentifier(d.name);
        for (const id of boundIdentifiers(d.name)) {
          out.set(id.text, { kind: "variable", declaration: d, initializer: whole && d.initializer ? skipOuter(d.initializer) : undefined });
        }
      }
      continue;
    }
    const kind = declarationKind(s);
    const name = (s as { name?: ts.Node }).name;
    if (kind === undefined || name === undefined || !ts.isIdentifier(name)) continue;
    out.set(name.text, { kind, declaration: s, initializer: undefined });
  }
  return out;
}

const isTypeKind = (kind: ExportKind): boolean => kind === "interface" || kind === "type";

/** Everything a source exports: in place, through `export { … }`, re-exported, destructured or as `default`. */
export function exportsOf(sf: ts.SourceFile): ModuleExports {
  const locals = localDeclarations(sf);
  const bindings = new Map<string, ExportedBinding>();
  const stars: string[] = [];
  const add = (b: ExportedBinding): void => {
    bindings.set(b.exported, b);
  };
  const fromLocal = (exported: string, local: string, typeOnly: boolean): ExportedBinding => {
    const decl = locals.get(local);
    const kind = decl?.kind ?? "variable";
    return { exported, local, kind, isType: typeOnly || isTypeKind(kind), declaration: decl?.declaration, initializer: decl?.initializer, from: undefined };
  };
  for (const s of sf.statements) {
    if (ts.isExportDeclaration(s)) {
      const from = s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier) ? s.moduleSpecifier.text : undefined;
      if (!s.exportClause) {
        if (from !== undefined) stars.push(from);
        continue;
      }
      if (ts.isNamespaceExport(s.exportClause)) {
        add({ exported: s.exportClause.name.text, local: undefined, kind: "reexport", isType: s.isTypeOnly, declaration: undefined, initializer: undefined, from });
        continue;
      }
      for (const e of s.exportClause.elements) {
        const typeOnly = s.isTypeOnly || e.isTypeOnly;
        const local = (e.propertyName ?? e.name).text;
        if (from !== undefined) {
          add({ exported: e.name.text, local: undefined, kind: "reexport", isType: typeOnly, declaration: undefined, initializer: undefined, from });
        } else {
          add(fromLocal(e.name.text, local, typeOnly));
        }
      }
      continue;
    }
    if (ts.isExportAssignment(s)) {
      add({ exported: "default", local: undefined, kind: "default", isType: false, declaration: s, initializer: skipOuter(s.expression), from: undefined });
      continue;
    }
    if (!isExported(s)) continue;
    const isDefault = hasModifier(s, ts.SyntaxKind.DefaultKeyword);
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) for (const id of boundIdentifiers(d.name)) add(fromLocal(id.text, id.text, false));
      continue;
    }
    const kind = declarationKind(s);
    const name = (s as { name?: ts.Node }).name;
    const local = name !== undefined && ts.isIdentifier(name) ? name.text : undefined;
    if (kind === undefined) continue;
    if (isDefault) {
      add({ exported: "default", local, kind, isType: false, declaration: s, initializer: undefined, from: undefined });
    } else if (local !== undefined) {
      add(fromLocal(local, local, false));
    }
  }
  return { bindings: [...bindings.values()], stars };
}

/**
 * The repo-relative path a relative specifier names, without `.ts` (`../infra/mongo` from
 * `src/x/x.repository.ts` → `src/infra/mongo`); undefined for a package.
 */
export function resolveRelative(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  return path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier)).replace(/\.(?:ts|js)$/, "");
}

/** A relative specifier as a repo path, or a package name as written. */
export const resolveSpecifier = (importer: string, specifier: string): string => resolveRelative(importer, specifier) ?? specifier;

/** The source file a resolved module path names among `files` (`<path>.ts`; src/ keeps no folder entrypoints). */
export function moduleFile(resolved: string, files: ReadonlySet<string>): string | undefined {
  return files.has(`${resolved}.ts`) ? `${resolved}.ts` : undefined;
}

/**
 * How a source names another module: `import` (a declaration with bindings), `reexport` (`export … from`),
 * `import-type` (`import("…").X` in a type), `side-effect` (`import "…"`), `import-equals`
 * (`import x = require("…")`), `require` (a `require("…")` call) or `dynamic` (an `import("…")` call).
 */
export type ImportKind = "import" | "reexport" | "import-type" | "side-effect" | "import-equals" | "require" | "dynamic";

export interface ImportedBinding {
  kind: ImportKind;
  /** The resolved repo path without `.ts` for a relative specifier, the package name otherwise. */
  target: string;
  specifier: string;
  /**
   * The name taken from the target: an export name, `default`, or `*` for a namespace (an `import-equals`, or a
   * `require` or `dynamic` call bound whole or not bound); empty for a `side-effect` import.
   */
  imported: string;
  /** The name it is bound to here (the exported name for a re-export). */
  local: string;
  isType: boolean;
  /** `export { … } from` and `export * from` read the target's names too. */
  isReexport: boolean;
  node: ts.Node;
}

/**
 * Every binding a source takes from another module: `import` declarations (a side-effect import with an empty
 * name), `export … from` re-exports (an `export *` as `*`), `import("…").X` types, `import x = require("…")`,
 * and `require("…")` and `import("…")` calls with a string literal (a destructured `require` per name).
 */
export function importsOf(sf: ts.SourceFile): ImportedBinding[] {
  const file = sf.fileName;
  const out: ImportedBinding[] = [];
  const target = (specifier: string): string => resolveSpecifier(file, specifier);
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)) {
      const specifier = s.moduleSpecifier.text;
      const clause = s.importClause;
      if (!clause) {
        out.push({ kind: "side-effect", target: target(specifier), specifier, imported: "", local: "", isType: false, isReexport: false, node: s });
        continue;
      }
      const typeOnly = clause.isTypeOnly;
      const base = { kind: "import" as const, target: target(specifier), specifier, isReexport: false, node: s };
      if (clause.name) out.push({ ...base, imported: "default", local: clause.name.text, isType: typeOnly });
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) out.push({ ...base, imported: "*", local: named.name.text, isType: typeOnly });
      if (named && ts.isNamedImports(named)) {
        for (const e of named.elements) {
          out.push({ ...base, imported: (e.propertyName ?? e.name).text, local: e.name.text, isType: typeOnly || e.isTypeOnly });
        }
      }
    }
    if (ts.isExportDeclaration(s) && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier)) {
      const specifier = s.moduleSpecifier.text;
      const base = { kind: "reexport" as const, target: target(specifier), specifier, isReexport: true, node: s };
      if (!s.exportClause) out.push({ ...base, imported: "*", local: "*", isType: s.isTypeOnly });
      else if (ts.isNamespaceExport(s.exportClause)) out.push({ ...base, imported: "*", local: s.exportClause.name.text, isType: s.isTypeOnly });
      else {
        for (const e of s.exportClause.elements) {
          out.push({ ...base, imported: (e.propertyName ?? e.name).text, local: e.name.text, isType: s.isTypeOnly || e.isTypeOnly });
        }
      }
    }
    if (ts.isImportEqualsDeclaration(s) && ts.isExternalModuleReference(s.moduleReference) && ts.isStringLiteral(s.moduleReference.expression)) {
      const specifier = s.moduleReference.expression.text;
      out.push({ kind: "import-equals", target: target(specifier), specifier, imported: "*", local: s.name.text, isType: s.isTypeOnly, isReexport: false, node: s });
    }
  }
  const visit = (n: ts.Node): void => {
    if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) {
      const specifier = n.argument.literal.text;
      const imported = n.qualifier ? (ts.isIdentifier(n.qualifier) ? n.qualifier.text : n.qualifier.left.getText(sf)) : "*";
      out.push({ kind: "import-type", target: target(specifier), specifier, imported, local: imported, isType: true, isReexport: false, node: n });
    }
    const loaded = ts.isCallExpression(n) ? loadedSpecifier(n) : undefined;
    if (loaded !== undefined) {
      const base = { ...loaded, target: target(loaded.specifier), isType: false, isReexport: false, node: n };
      const binding = loaded.kind === "require" && ts.isVariableDeclaration(n.parent) && n.parent.initializer === n ? n.parent.name : undefined;
      if (binding !== undefined && ts.isObjectBindingPattern(binding)) {
        for (const e of binding.elements) {
          const local = ts.isIdentifier(e.name) ? e.name.text : "";
          const key = e.propertyName ?? e.name;
          out.push({ ...base, imported: ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : "*", local });
        }
      } else {
        out.push({ ...base, imported: "*", local: binding !== undefined && ts.isIdentifier(binding) ? binding.text : "" });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The specifier a `require("…")` or `import("…")` call loads, when it is a string literal. */
function loadedSpecifier(call: ts.CallExpression): { kind: "require" | "dynamic"; specifier: string } | undefined {
  const [first] = call.arguments;
  if (first === undefined || !ts.isStringLiteralLike(first)) return undefined;
  if (call.expression.kind === ts.SyntaxKind.ImportKeyword) return { kind: "dynamic", specifier: first.text };
  return ts.isIdentifier(call.expression) && call.expression.text === "require" ? { kind: "require", specifier: first.text } : undefined;
}

/**
 * The names a module exports, following its relative `export *` into the files among `files`
 * (a cycle or a package target stops the walk; a package's names are unknown, so `open` is set).
 */
export function exportedNamesDeep(
  file: string,
  read: (file: string) => string,
  files: ReadonlySet<string>,
): { names: Set<string>; open: boolean } {
  const names = new Set<string>();
  let open = false;
  const seen = new Set<string>();
  const walk = (current: string): void => {
    if (seen.has(current)) return;
    seen.add(current);
    const { bindings, stars } = exportsOf(parseSource(current, read(current)));
    for (const b of bindings) names.add(b.exported);
    for (const star of stars) {
      const resolved = resolveRelative(current, star);
      const next = resolved === undefined ? undefined : moduleFile(resolved, files);
      if (next === undefined) open = true;
      else walk(next);
    }
  };
  walk(file);
  names.delete("default");
  return { names, open };
}

/** The call's callee name: `f(…)` → `f`, `a.b.f(…)` → `f`, `a["f"](…)` → `f`. */
export function calleeName(call: ts.CallExpression): string | undefined {
  const e = skipOuter(call.expression);
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression)) return e.argumentExpression.text;
  return undefined;
}

/** Every node under `root` (itself included) that `pick` keeps, in source order. */
export function collect<T extends ts.Node>(root: ts.Node, pick: (n: ts.Node) => n is T): T[] {
  const out: T[] = [];
  const visit = (n: ts.Node): void => {
    if (pick(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(root);
  return out;
}
