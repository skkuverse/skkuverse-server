/**
 * A module doc's glossary, context and flowchart cannot drift from the code
 * (refactor design D16; openspec module-docs spec). For each feature module:
 *
 *   - every `QUIRK(<system>)` in a non-spec file under `src/<m>/` has `<system>`
 *     in the Context table's Quirk tag column, and a row with no quirk holds —;
 *   - every brand declared under `src/<m>/` (`Brand<…, "X">`) is in a Term cell;
 *   - every collection in `config.<m>.collections` (src/infra/config.ts) and
 *     every route of the module's controllers, `<METHOD> <path>`, is in the
 *     flowchart;
 *   - the backticked identifiers of the Not column are exactly the names of the
 *     ESLint block `glossary/<m>`, which bans them in `src/<m>/**`.
 *
 * And no module keeps its glossary in .claude/rules/naming.md. The template is
 * not a module, so it is not checked here.
 *
 * The allowlist names the feature modules not yet migrated whose doc leaves a
 * gap. It only shrinks, and a migrated module is never on it.
 */
import type { Linter } from "eslint";
import ts from "typescript";
import { commentsOf } from "../helpers/architecture/comments";
import { migratedScopes } from "../helpers/architecture/migrated";
import {
  CONTEXT_HEADER,
  GLOSSARY_HEADER,
  NONE_CELL,
  codeSpans,
  columnCells,
  docPathOf,
  featureModules,
  mermaidText,
  migratedEntries,
  migratedModules,
  namesRoute,
  namesWord,
  parseDoc,
  readIfExists,
} from "../helpers/architecture/module-docs";
import { expectAllowlisted, readAllowlist } from "../helpers/architecture/ratchet";
import { routesIn } from "../helpers/architecture/routes";
import { filesUnder, isNonSpecSource, readSource } from "../helpers/architecture/tree";

const ESLINT_CONFIG: Linter.Config[] = require("../../eslint.config.js");

const RULE = "glossary-coverage";
const CONFIG_FILE = "src/infra/config.ts";
const NAMING_FILE = ".claude/rules/naming.md";
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const QUIRK_CELL = /^`[a-z][a-z0-9-]*`(?:,\s*`[a-z][a-z0-9-]*`)*$/;

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/** The systems named by `QUIRK(<system>)` in a source's comments, never in its strings. */
export function quirkSystems(file: string, source: string): string[] {
  return commentsOf(file, source).flatMap((c) => [...c.raw.matchAll(/QUIRK\(([^)\s]+)\)/g)].map((m) => m[1]!));
}

/** The brand names a source declares: `X` of each `Brand<…, "X">`. */
export function brandNames(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === "Brand") {
      const name = node.typeArguments?.[1];
      if (name && ts.isLiteralTypeNode(name) && ts.isStringLiteral(name.literal)) names.push(name.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

function objectProperty(object: ts.ObjectLiteralExpression | undefined, name: string): ts.ObjectLiteralExpression | undefined {
  const found = object?.properties.find(
    (p) => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name,
  );
  return found && ts.isPropertyAssignment(found) && ts.isObjectLiteralExpression(found.initializer) ? found.initializer : undefined;
}

/** The values of `config.<module>.collections`; `process.env.X || "name"` gives its default. A value that is neither throws. */
export function configCollections(source: string, module: string): string[] {
  const sf = ts.createSourceFile(CONFIG_FILE, source, ts.ScriptTarget.Latest, true);
  const config = sf.statements
    .filter(ts.isVariableStatement)
    .flatMap((s) => [...s.declarationList.declarations])
    .find((d) => ts.isIdentifier(d.name) && d.name.text === "config")?.initializer;
  if (!config || !ts.isObjectLiteralExpression(config)) throw new Error(`${CONFIG_FILE}: config is not an object literal`);
  const collections = objectProperty(objectProperty(config, module), "collections");
  return (collections?.properties ?? []).map((p) => {
    const value = ts.isPropertyAssignment(p) ? p.initializer : undefined;
    const isDefaulted =
      value !== undefined &&
      ts.isBinaryExpression(value) &&
      [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(value.operatorToken.kind);
    const literal = isDefaulted ? value.right : value;
    if (!literal || !ts.isStringLiteralLike(literal)) {
      throw new Error(`${CONFIG_FILE}: a value of config.${module}.collections is neither a string nor env || "default"`);
    }
    return literal.text;
  });
}

function denylistViolations(module: string, names: readonly string[], config: readonly Linter.Config[]): string[] {
  const blockName = `glossary/${module}`;
  const blocks = config.filter((c) => c.name === blockName);
  const out: string[] = [];
  if (blocks.length > 1 || (names.length > 0 && blocks.length === 0)) {
    out.push(`${module}: ${blocks.length} eslint ${blockName} blocks, expected one`);
  }
  const files = [`src/${module}/**/*.ts`];
  for (const block of blocks) {
    if (JSON.stringify(block.files) !== JSON.stringify(files)) {
      out.push(`${module}: eslint ${blockName} files is ${JSON.stringify(block.files)}, expected ${JSON.stringify(files)}`);
    }
    const entry = block.rules?.["id-denylist"];
    const [severity, ...listed] = Array.isArray(entry) ? entry : [entry];
    if (severity !== "error") out.push(`${module}: eslint ${blockName} id-denylist is not "error"`);
    for (const name of listed.filter((n) => !names.includes(String(n)))) {
      out.push(`${module}: eslint ${blockName} lists ${String(name)}, which no Not cell has`);
    }
    for (const name of names.filter((n) => !listed.includes(n))) {
      out.push(`${module}: Not name ${name} is missing from eslint ${blockName}`);
    }
  }
  return out;
}

export interface GlossaryInput {
  module: string;
  doc: string | undefined;
  quirks: readonly string[];
  brands: readonly string[];
  collections: readonly string[];
  routes: readonly string[];
  config: readonly Linter.Config[];
}

/** `<module>: <gap>` for each quirk, brand, collection, route or Not name the doc and the code disagree on. */
export function glossaryViolations(input: GlossaryInput): string[] {
  const { module } = input;
  const doc = parseDoc(input.doc ?? "");
  const quirkCells = doc.tables.filter((t) => t.header === CONTEXT_HEADER).flatMap((t) => columnCells(t, "Quirk tag"));
  const glossary = doc.tables.filter((t) => t.header === GLOSSARY_HEADER);
  const tagged = new Set(quirkCells.flatMap(codeSpans));
  const terms = new Set(glossary.flatMap((t) => columnCells(t, "Term")).flatMap(codeSpans));
  const notNames = unique(
    glossary
      .flatMap((t) => columnCells(t, "Not"))
      .filter((cell) => cell !== NONE_CELL)
      .flatMap(codeSpans)
      .filter((name) => IDENTIFIER.test(name)),
  );
  const diagram = mermaidText(doc);
  return [
    ...quirkCells
      .filter((cell) => cell !== NONE_CELL && !QUIRK_CELL.test(cell))
      .map((cell) => `${module}: Quirk tag ${JSON.stringify(cell)} is neither backticked systems nor ${NONE_CELL}`),
    ...unique(input.quirks)
      .filter((system) => !tagged.has(system))
      .map((system) => `${module}: QUIRK(${system}) has no \`${system}\` in the Context table's Quirk tag column`),
    ...unique(input.brands).filter((brand) => !terms.has(brand)).map((brand) => `${module}: brand ${brand} has no Term cell`),
    ...unique(input.collections)
      .filter((c) => !namesWord(diagram, c))
      .map((c) => `${module}: collection ${c} is not in the flowchart`),
    ...unique(input.routes).filter((r) => !namesRoute(diagram, r)).map((r) => `${module}: route ${r} is not in the flowchart`),
    ...denylistViolations(module, notNames, input.config),
  ];
}

/** A `### <module>` heading in naming.md is a module glossary left behind. */
export function namingGlossaryViolations(naming: string, modules: readonly string[]): string[] {
  return parseDoc(naming)
    .headings.filter((h) => h.level === 3 && modules.includes(h.text.replace(/`/g, "").trim().toLowerCase()))
    .map((h) => `${NAMING_FILE}: ### ${h.text}`);
}

function realGlossaryInput(module: string, files: readonly string[]): GlossaryInput {
  const sources = files.filter((f) => f.startsWith(`src/${module}/`) && isNonSpecSource(f));
  return {
    module,
    doc: readIfExists(docPathOf(module)),
    quirks: sources.flatMap((f) => quirkSystems(f, readSource(f))),
    brands: sources.flatMap((f) => brandNames(f, readSource(f))),
    collections: configCollections(readSource(CONFIG_FILE), module),
    routes: sources
      .filter((f) => f.endsWith(".controller.ts"))
      .flatMap((f) => routesIn(f, readSource(f)))
      .map((r) => `${r.method} /${r.path}`),
    config: ESLINT_CONFIG,
  };
}

const DOC = [
  "## Context",
  "",
  "| System | Quirk tag | Gives | Enters at |",
  "| --- | --- | --- | --- |",
  "| HSSC | `hssc` | Bus positions | `HsscClient` |",
  "| MongoDB | — | Storage | `BusRepository` |",
  "",
  "## Glossary",
  "",
  "| Term | Means | Derived from | Not |",
  "| --- | --- | --- | --- |",
  "| `stationId` (`StationId`) | One stop of a route | `toStationId` | `stopId`, a bare id |",
  "| `keyword` | The search text | `toKeyword` | query (the `.query` role), `term` |",
  "| route | One bus line | `ROUTES` | — |",
  "",
  "## Structure",
  "",
  "```mermaid",
  "flowchart LR",
  '  up["HSSC"] -->|positions| cache[("bus_cache")]',
  '  cache --> eta["GET /bus/hssc/:stationId"]',
  "```",
  "",
].join("\n");
const BLOCK: Linter.Config = { name: "glossary/bus", files: ["src/bus/**/*.ts"], rules: { "id-denylist": ["error", "stopId", "term"] } };
const INPUT: GlossaryInput = {
  module: "bus",
  doc: DOC,
  quirks: ["hssc", "hssc"],
  brands: ["StationId"],
  collections: ["bus_cache"],
  routes: ["GET /bus/hssc/:stationId"],
  config: [{ name: "boundaries/get-client", files: ["src/**/*.ts"] }, BLOCK],
};

describe("glossary-coverage rule applies as specified", () => {
  it("passes a doc that names every quirk system, brand, collection and route, with a matching id-denylist", () => {
    // Act
    const violations = glossaryViolations(INPUT);

    // Assert
    expect(violations).toEqual([]);
  });

  it("names the module and the system of a quirk with no Context row", () => {
    // Act
    const violations = glossaryViolations({ ...INPUT, quirks: ["hssc", "topis"] });

    // Assert
    expect(violations).toEqual(["bus: QUIRK(topis) has no `topis` in the Context table's Quirk tag column"]);
  });

  it("wants — in a Quirk tag cell with no quirk", () => {
    // Arrange
    const doc = DOC.replace("| MongoDB | — |", "| MongoDB | none |");

    // Act
    const violations = glossaryViolations({ ...INPUT, doc });

    // Assert
    expect(violations).toEqual(['bus: Quirk tag "none" is neither backticked systems nor —']);
  });

  it("names a brand that no Term cell has", () => {
    // Act
    const violations = glossaryViolations({ ...INPUT, brands: ["StationId", "RouteId"] });

    // Assert
    expect(violations).toEqual(["bus: brand RouteId has no Term cell"]);
  });

  it("names a collection the flowchart lacks, matched on word boundaries", () => {
    // Act
    const violations = glossaryViolations({ ...INPUT, collections: ["bus_cache", "stations"] });

    // Assert
    expect(violations).toEqual(["bus: collection stations is not in the flowchart"]);
    expect(namesWord('raw[("buildings_raw")]', "buildings")).toBe(false);
    expect(namesWord('raw[("buildings_raw")] --> b[("buildings")]', "buildings")).toBe(true);
  });

  it("names a route the flowchart lacks, and does not read a longer path as a shorter one", () => {
    // Act
    const violations = glossaryViolations({ ...INPUT, routes: ["GET /bus/hssc/:stationId", "GET /bus/nearby", "GET /bus/hssc"] });

    // Assert
    expect(violations).toEqual(["bus: route GET /bus/nearby is not in the flowchart", "bus: route GET /bus/hssc is not in the flowchart"]);
    expect(namesRoute('r["GET /health/ready"]', "GET /health")).toBe(false);
    expect(namesRoute('r["GET /health/ready"] --> l["GET /health"]', "GET /health")).toBe(true);
  });

  it.each<[string, Linter.StringSeverity, string[], string[]]>([
    ["an extra name in the block", "error", ["stopId", "term", "lineId"], ["bus: eslint glossary/bus lists lineId, which no Not cell has"]],
    ["a Not name missing from the block", "error", ["stopId"], ["bus: Not name term is missing from eslint glossary/bus"]],
    ["a block that only warns", "warn", ["stopId", "term"], ['bus: eslint glossary/bus id-denylist is not "error"']],
  ])("names %s", (_name, severity, names, expected) => {
    // Arrange
    const denylist: Linter.RuleEntry = [severity, ...names];
    const config = [{ ...BLOCK, rules: { "id-denylist": denylist } }];

    // Act
    const violations = glossaryViolations({ ...INPUT, config });

    // Assert
    expect(violations).toEqual(expected);
  });

  it("wants exactly one glossary block, over the module's own files", () => {
    // Act
    const none = glossaryViolations({ ...INPUT, config: [] });
    const two = glossaryViolations({ ...INPUT, config: [BLOCK, BLOCK] });
    const elsewhere = glossaryViolations({ ...INPUT, config: [{ ...BLOCK, files: ["src/**/*.ts"] }] });
    const nothingBanned = glossaryViolations({ ...INPUT, doc: DOC.replace("`stopId`, a bare id", "a bare id").replace(", `term`", ""), config: [] });

    // Assert
    expect(none).toEqual(["bus: 0 eslint glossary/bus blocks, expected one"]);
    expect(two).toEqual(["bus: 2 eslint glossary/bus blocks, expected one"]);
    expect(elsewhere).toEqual(['bus: eslint glossary/bus files is ["src/**/*.ts"], expected ["src/bus/**/*.ts"]']);
    expect(nothingBanned).toEqual([]);
  });

  it("finds QUIRK systems in comments only, brands in Brand<…, \"X\">, and collections with their env default", () => {
    // Arrange
    const source = [
      "// QUIRK(skku): buildInfo drops rooms.",
      'const s = "QUIRK(not-a-comment)";',
      'export type SkkuId = Brand<number, "SkkuId">;',
      "export type Plain = Brand<number, Name>;",
    ].join("\n");
    const config = [
      "const config = {",
      '  ad: { collections: { ads: process.env.MONGO_AD_COLLECTION || "ads", adEvents: "ad_events" } },',
      "  health: {},",
      '  broken: { collections: { x: process.env.X } },',
      "};",
    ].join("\n");

    // Act & Assert
    expect(quirkSystems("src/x/x.rules.ts", source)).toEqual(["skku"]);
    expect(brandNames("src/x/x.types.ts", source)).toEqual(["SkkuId"]);
    expect(configCollections(config, "ad")).toEqual(["ads", "ad_events"]);
    expect(configCollections(config, "health")).toEqual([]);
    expect(configCollections(config, "app-config")).toEqual([]);
    expect(() => configCollections(config, "broken")).toThrow(/neither a string nor env/);
  });

  it("fails a module glossary left in naming.md, and keeps the shared one", () => {
    // Arrange
    const naming = "## Glossary\n\n### Every module\n\n| Term | Meaning | Not |\n\n### building\n\n| Term | Meaning | Not |\n";

    // Act
    const violations = namingGlossaryViolations(naming, ["ad", "building"]);

    // Assert
    expect(violations).toEqual([".claude/rules/naming.md: ### building"]);
  });

  it("never allowlists a migrated module", () => {
    // Act
    const listed = migratedEntries(["building", "bus"], ["ad", "building"]);

    // Assert
    expect(listed).toEqual(["building"]);
  });
});

describe("module glossaries", () => {
  const files = filesUnder("src");
  const modules = featureModules(files);
  const migrated = migratedModules(modules, migratedScopes());

  it.each(migrated)("of %s name every quirk system, brand, collection and route, and match its id-denylist", (module) => {
    // Act
    const violations = glossaryViolations(realGlossaryInput(module, files));

    // Assert
    expect(violations).toEqual([]);
  });

  it("leave gaps only in the modules not yet migrated, which the allowlist names", () => {
    // Act
    const withGaps = modules.filter((m) => glossaryViolations(realGlossaryInput(m, files)).length > 0);

    // Assert
    expect(migratedEntries(readAllowlist(RULE), migrated)).toEqual([]);
    expectAllowlisted(RULE, withGaps);
  });

  it("live only in the module docs, not in .claude/rules/naming.md", () => {
    // Act
    const violations = namingGlossaryViolations(readSource(NAMING_FILE), modules);

    // Assert
    expect(violations).toEqual([]);
  });
});
