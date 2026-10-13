/**
 * A committed config file fails the boot with every issue (ADR 0010, D5): a
 * `.config.ts` in a migrated scope that reads a file (`readFileSync`, or an
 * import or `require` of a `.json`) parses it through `parseConfigFile`
 * (`src/infra/config-file.ts`), imported from there, so every issue is
 * thrown with its path in one line. A `.config.ts` that holds TypeScript
 * values only (`src/ad/ad.config.ts`) reads no file and is not checked.
 *
 * A file that keeps its own parse for a reason is exempt in
 * `exemptions/config-files.json` (helpers/architecture/exemptions.ts).
 * Modules not yet migrated are not checked, so there is no allowlist.
 */
import ts from "typescript";
import { expectExempted } from "../helpers/architecture/exemptions";
import { inScope, migratedScopes } from "../helpers/architecture/migrated";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const RULE = "config-files";
const PARSER_MODULE = /(?:^|\/)infra\/config-file$/;

interface ConfigFileUse {
  readsFile: boolean;
  callsParser: boolean;
}

const calleeName = (call: ts.CallExpression): string | undefined => {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  return ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : undefined;
};

const isJsonRequire = (call: ts.CallExpression): boolean =>
  calleeName(call) === "require" && call.arguments.some((a) => ts.isStringLiteral(a) && a.text.endsWith(".json"));

/** Whether a source reads a file, and whether it calls the `parseConfigFile` it imports from infra/config-file. */
export function configFileUse(file: string, source: string): ConfigFileUse {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const parserNames = new Set<string>();
  let readsFile = false;
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    if (s.moduleSpecifier.text.endsWith(".json")) readsFile = true;
    const bindings = s.importClause?.namedBindings;
    if (!PARSER_MODULE.test(s.moduleSpecifier.text) || !bindings || !ts.isNamedImports(bindings)) continue;
    for (const e of bindings.elements) if ((e.propertyName ?? e.name).text === "parseConfigFile") parserNames.add(e.name.text);
  }
  let callsParser = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name === "readFileSync" || isJsonRequire(node)) readsFile = true;
      if (ts.isIdentifier(node.expression) && parserNames.has(node.expression.text)) callsParser = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { readsFile, callsParser };
}

/** Each `.config.ts` in a scope that reads a file without parsing it through parseConfigFile, sorted. */
export function unparsedConfigFiles(files: readonly string[], scopes: readonly string[], read: (file: string) => string): string[] {
  return files
    .filter((file) => file.startsWith("src/") && file.endsWith(".config.ts"))
    .filter((file) => scopes.some((scope) => inScope(file, scope)))
    .filter((file) => {
      const use = configFileUse(file, read(file));
      return use.readsFile && !use.callsParser;
    })
    .sort();
}

describe("config file rule applies as specified", () => {
  const PARSES = [
    'import fs from "fs";',
    'import { parseConfigFile } from "../../infra/config-file";',
    'export const read = () => parseConfigFile("x", schema, JSON.parse(fs.readFileSync("x.json", "utf8")));',
  ].join("\n");

  it.each([
    ["a file read parsed through parseConfigFile", PARSES],
    ["a renamed import of it", 'import { parseConfigFile as parse } from "../infra/config-file";\nimport x from "./x.json";\nparse("x", s, x);'],
    ["TypeScript values only", 'import type { AdDoc } from "./ad.document";\nexport const SEED = [{ name: "x" }];'],
  ])("passes %s", (_case, source) => {
    // Act & Assert
    expect(unparsedConfigFiles(["src/x/x.config.ts"], ["src/x/"], () => source)).toEqual([]);
  });

  it.each([
    ["a readFileSync parsed by hand", 'import fs from "fs";\nexport const x = schema.parse(JSON.parse(fs.readFileSync("x.json", "utf8")));'],
    ["a destructured readFileSync", 'import { readFileSync } from "fs";\nexport const x = schema.parse(readFileSync("x.json"));'],
    ["an imported .json", 'import raw from "./x.json";\nexport const x = schema.parse(raw);'],
    ["a required .json", 'export const x = schema.parse(require("./x.json"));'],
    ["a parseConfigFile imported from elsewhere", 'import { parseConfigFile } from "../ui.schema";\nimport raw from "./x.json";\nparseConfigFile("x", s, raw);'],
    ["the parser imported but not called", 'import { parseConfigFile } from "../infra/config-file";\nimport raw from "./x.json";\nschema.parse(raw);'],
  ])("fails %s", (_case, source) => {
    // Act & Assert
    expect(unparsedConfigFiles(["src/x/x.config.ts"], ["src/x/"], () => source)).toEqual(["src/x/x.config.ts"]);
  });

  it("checks only .config.ts files in the scopes", () => {
    // Arrange
    const source = 'import raw from "./x.json";\nexport const x = schema.parse(raw);';
    const files = ["src/x/x.config.ts", "src/y/y.config.ts", "src/x/x.schema.ts", "src/x/x.config.spec.ts"];

    // Act & Assert
    expect(unparsedConfigFiles(files, ["src/x/"], () => source)).toEqual(["src/x/x.config.ts"]);
  });
});

describe(".config files in migrated scopes", () => {
  it("parse the files they read through parseConfigFile, or are exempt with a reason", () => {
    // Act & Assert
    expectExempted(RULE, unparsedConfigFiles(filesUnder("src"), migratedScopes(), readSource));
  });
});
