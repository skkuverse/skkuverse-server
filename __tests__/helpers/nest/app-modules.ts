/**
 * The boot list of a route test that stands for a whole feature (the characterization tests, PR 238 F7):
 * the modules `src/app.module.ts` imports, in its order, kept when their file sits under one of the given
 * folders. A module split or a new sub-module reaches such a test without an edit to it.
 *
 * `appModuleImportsUnder` reads the source only, so the `route-clock` rule resolves the same list statically.
 */
import fs from "node:fs";
import path from "node:path";
import type { ModuleMetadata, Type } from "@nestjs/common";
import ts from "typescript";
import { collect, importsOf, parseSource, skipOuter } from "../architecture/ast";

export const APP_MODULE_FILE = "src/app.module.ts";

const ROOT = path.resolve(__dirname, "../../..");

export interface AppModuleImport {
  name: string;
  /** The repo path of the file it comes from, without `.ts`. */
  file: string;
}

function moduleImportsArray(sf: ts.SourceFile): ts.ArrayLiteralExpression {
  const decorator = collect(sf, ts.isDecorator).find((d) => ts.isCallExpression(d.expression) && d.expression.expression.getText(sf) === "Module");
  const metadata = decorator !== undefined && ts.isCallExpression(decorator.expression) ? decorator.expression.arguments[0] : undefined;
  const imports =
    metadata !== undefined && ts.isObjectLiteralExpression(metadata)
      ? metadata.properties.find((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "imports")
      : undefined;
  const list = imports !== undefined && ts.isPropertyAssignment(imports) ? skipOuter(imports.initializer) : undefined;
  if (list === undefined || !ts.isArrayLiteralExpression(list)) throw new Error(`${APP_MODULE_FILE}: no @Module({ imports: [...] }) array`);
  return list;
}

/** `AppModule`'s `imports` in order, each with its file; throws on an entry that is not an imported identifier. */
export function appModuleImports(source: string): AppModuleImport[] {
  const sf = parseSource(APP_MODULE_FILE, source);
  const files = new Map(importsOf(sf).filter((b) => b.kind === "import").map((b) => [b.local, b.target]));
  return moduleImportsArray(sf).elements.map((e) => {
    const file = ts.isIdentifier(e) ? files.get(e.text) : undefined;
    if (!ts.isIdentifier(e) || file === undefined) throw new Error(`${APP_MODULE_FILE}: cannot resolve the import ${e.getText(sf)}`);
    return { name: e.text, file };
  });
}

/** Those of `appModuleImports` whose file sits under one of `folders` (`src/bus/`, …); throws when a folder holds none. */
export function appModuleImportsUnder(source: string, folders: readonly string[]): AppModuleImport[] {
  const all = appModuleImports(source);
  for (const folder of folders) {
    if (!folder.endsWith("/") || !all.some((m) => m.file.startsWith(folder))) {
      throw new Error(`${APP_MODULE_FILE} imports no module under "${folder}" (a folder ends with "/")`);
    }
  }
  return all.filter((m) => folders.some((folder) => m.file.startsWith(folder)));
}

/**
 * The module classes under `folders`, loaded when called: a test calls it after it points the env at its
 * `mongod`, because `src/infra/config.ts` reads the env at import.
 */
export function appModulesUnder(...folders: string[]): NonNullable<ModuleMetadata["imports"]> {
  const source = fs.readFileSync(path.join(ROOT, APP_MODULE_FILE), "utf8");
  return appModuleImportsUnder(source, folders).map(({ name, file }) => {
    const loaded = (require(path.join(ROOT, file)) as Record<string, Type<unknown> | undefined>)[name];
    if (loaded === undefined) throw new Error(`${file} exports no ${name}`);
    return loaded;
  });
}
