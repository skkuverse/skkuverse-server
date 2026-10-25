/**
 * A committed config file fails the boot with every issue (ADR 0010, D5): a
 * `.config.ts` in a module scope that reads a file (`readFileSync`, or an
 * import or `require` of a `.json`) parses it through `parseConfigFile`
 * (`src/infra/config-file.ts`), imported from there, so every issue is
 * thrown with its path in one line. A `.config.ts` that holds TypeScript
 * values only reads no file and is not checked.
 *
 * A file that keeps its own parse for a reason is exempt in
 * `exemptions/config-files.json` (helpers/architecture/exemptions.ts).
 * Every module scope is checked, and there is no allowlist.
 */
import ts from "typescript";
import { calleeName, collect, importsOf, parseSource } from "../helpers/architecture/ast";
import { expectExempted } from "../helpers/architecture/exemptions";
import { inScope, moduleScopes } from "../helpers/architecture/scopes";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const RULE = "config-files";
const PARSER_MODULE = /(?:^|\/)infra\/config-file$/;
const FILE_READS = new Set(["readFileSync", "readFile"]);

interface ConfigFileUse {
  /** File reads: `readFileSync`/`readFile` calls, `.json` imports, and `require(…)` of anything but a package name. */
  reads: number;
  /** Calls of the `parseConfigFile` imported from infra/config-file, by name or through a namespace import. */
  parses: number;
}

const isPackageName = (arg: ts.Expression | undefined): boolean =>
  arg !== undefined && ts.isStringLiteralLike(arg) && !arg.text.startsWith(".") && !arg.text.startsWith("/") && !arg.text.endsWith(".json");

/** The one module load by path, `require(OVERLAY_ENTRY)` (ADR 0023, D4): a module, not a config file. */
const isOverlayEntry = (arg: ts.Expression | undefined): boolean => arg !== undefined && ts.isIdentifier(arg) && arg.text === "OVERLAY_ENTRY";

/** How many files a source reads, and how many times it calls the `parseConfigFile` it imports from infra/config-file. */
export function configFileUse(file: string, source: string): ConfigFileUse {
  const sf = parseSource(file, source);
  const imports = importsOf(sf);
  const parserNames = new Set(imports.filter((i) => PARSER_MODULE.test(i.specifier) && i.imported === "parseConfigFile").map((i) => i.local));
  const parserNamespaces = new Set(imports.filter((i) => PARSER_MODULE.test(i.specifier) && i.imported === "*").map((i) => i.local));
  let reads = imports.filter((i) => !i.isType && i.kind !== "require" && i.specifier.endsWith(".json")).length;
  let parses = 0;
  for (const call of collect(sf, ts.isCallExpression)) {
    const name = calleeName(call);
    if (name !== undefined && FILE_READS.has(name)) reads += 1;
    if (ts.isIdentifier(call.expression) && call.expression.text === "require" && !isPackageName(call.arguments[0]) && !isOverlayEntry(call.arguments[0])) reads += 1;
    const callee = call.expression;
    if (ts.isIdentifier(callee) && parserNames.has(callee.text)) parses += 1;
    const viaNamespace =
      ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && parserNamespaces.has(callee.expression.text) && callee.name.text === "parseConfigFile";
    if (viaNamespace) parses += 1;
  }
  return { reads, parses };
}

/**
 * For the non-spec `src/` files in the scopes: `<file>: reads a file outside a .config.ts` for any other role that
 * reads one, and `<file>` for a `.config.ts` that reads more files than it parses through parseConfigFile, sorted.
 */
export function unparsedConfigFiles(files: readonly string[], scopes: readonly string[], read: (file: string) => string): string[] {
  return files
    .filter((file) => file.startsWith("src/") && file.endsWith(".ts") && !file.endsWith(".spec.ts"))
    .filter((file) => scopes.some((scope) => inScope(file, scope)))
    .flatMap((file) => {
      const use = configFileUse(file, read(file));
      if (use.reads === 0) return [];
      if (!file.endsWith(".config.ts")) return [`${file}: reads a file outside a .config.ts`];
      return use.reads > use.parses ? [file] : [];
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
    ["TypeScript values only", 'import type { XDoc } from "./x.document";\nexport const SEED = [{ name: "x" }];'],
    ["a namespace import of the parser", 'import * as cfg from "../../infra/config-file";\nimport raw from "./x.json";\nexport const x = cfg.parseConfigFile("x", s, raw);'],
    ["a require of a package", 'const zod = require("zod");\nexport const x = zod;'],
    // WHY: the perimeter overlay's entry is a module, loaded by path once (ADR 0023, D4); eslint-syntax pins the call.
    ["the overlay entry's load", 'export const OVERLAY_ENTRY = path.join(__dirname, "current", "perimeter.overlay");\nexport const load = () => require(OVERLAY_ENTRY);'],
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
    ["a required path.join of a .json", 'import path from "path";\nexport const x = schema.parse(require(path.join(__dirname, "x.json")));'],
    ["a readFile from fs/promises", 'import { readFile } from "fs/promises";\nexport const load = async () => schema.parse(JSON.parse(await readFile("x.json", "utf8")));'],
    [
      "a second file parsed by hand",
      'import fs from "fs";\nimport { parseConfigFile } from "../../infra/config-file";\nconst a = parseConfigFile("a", s, JSON.parse(fs.readFileSync("a.json", "utf8")));\nconst b = schemaB.parse(JSON.parse(fs.readFileSync("b.json", "utf8")));',
    ],
  ])("fails %s", (_case, source) => {
    // Act & Assert
    expect(unparsedConfigFiles(["src/x/x.config.ts"], ["src/x/"], () => source)).toEqual(["src/x/x.config.ts"]);
  });

  it("checks the files in the scopes, specs aside, and refuses a read in any other role", () => {
    // Arrange
    const source = 'import raw from "./x.json";\nexport const x = schema.parse(raw);';
    const files = ["src/x/x.config.ts", "src/y/y.config.ts", "src/x/x.schema.ts", "src/x/x.service.ts", "src/x/x.config.spec.ts"];

    // Act & Assert
    expect(unparsedConfigFiles(files, ["src/x/"], () => source)).toEqual([
      "src/x/x.config.ts",
      "src/x/x.schema.ts: reads a file outside a .config.ts",
      "src/x/x.service.ts: reads a file outside a .config.ts",
    ]);
  });
});

describe(".config files in the module scopes", () => {
  it("read files only in a .config.ts, each parsed through parseConfigFile, or are exempt with a reason", () => {
    // Act & Assert
    expectExempted(RULE, unparsedConfigFiles(filesUnder("src"), moduleScopes(), readSource));
  });
});
