/**
 * Every migrated feature module has one architecture doc in one fixed shape
 * (refactor design D16; openspec module-docs spec): `docs/explanation/<m>-architecture.md`,
 * linked from the explanation table of docs/README.md, loaded for agents by
 * `.claude/rules/<m>.md` and pointed to by a `SEE:` line above `@Module`.
 *
 * A doc has the six frontmatter keys, one H1 equal to its title and a `> `
 * summary, exactly the six H2 sections and nothing deeper, `None.` in an empty
 * section, only the three named tables, one flowchart in Structure, no digit
 * outside code spans, fences, links and frontmatter, no history phrase, at
 * most 200 lines, and links that resolve. docs/_module-template.md passes the
 * same structure checks, and the MD043 override in docs/.markdownlint-cli2.jsonc
 * names the template and exactly the migrated modules' docs.
 *
 * The allowlist names the feature modules not yet migrated whose doc is missing
 * or off-format. It only shrinks, and a migrated module is never on it.
 */
import path from "path";
import ts from "typescript";
import { HISTORY_PHRASES } from "../helpers/architecture/history";
import { migratedScopes } from "../helpers/architecture/migrated";
import {
  CONTEXT_HEADER,
  FIELD_HEADER,
  GLOSSARY_HEADER,
  MODULE_TEMPLATE,
  SECTIONS,
  docPathOf,
  existsInRepo,
  featureModules,
  linkTargets,
  linkTexts,
  migratedEntries,
  migratedModules,
  moduleFileOf,
  parseDoc,
  readIfExists,
  rulesPathOf,
  titleOf,
  withoutCodeSpans,
  withoutLinks,
  type ParsedDoc,
} from "../helpers/architecture/module-docs";
import { compareWithAllowlist, expectAllowlisted, readAllowlist } from "../helpers/architecture/ratchet";
import { routesIn } from "../helpers/architecture/routes";
import { filesUnder, isNonSpecSource, readSource } from "../helpers/architecture/tree";
import { isExemptPath } from "../helpers/architecture/wire-routes";

const RULE = "module-docs";
const MAX_LINES = 200;
const FRONTMATTER_KEYS = ["title", "type", "status", "owner", "last-updated", "audience"];
const STATUSES = ["draft", "accepted"];
const TEMPLATE_TITLE = "<Module> Architecture";
const TEMPLATE_DATE = "YYYY-MM-DD";
const MD_CONFIG = "docs/.markdownlint-cli2.jsonc";
const TABLE_HOMES = new Map([
  [CONTEXT_HEADER, "Context"],
  [GLOSSARY_HEADER, "Glossary"],
  [FIELD_HEADER, "Structure"],
]);

export interface DocOptions {
  file: string;
  title: string;
  /** The template keeps `<Module> Architecture` and `YYYY-MM-DD`. */
  template: boolean;
  /** The module serves a route other than `/health*` and `/internal/*`. */
  clientFacing: boolean;
  exists: (rel: string) => boolean;
}

const show = (value: string | string[] | undefined): string => JSON.stringify(value);
const proseOrComment = (doc: ParsedDoc) => doc.lines.filter((l) => l.kind === "prose" || l.kind === "comment");

function frontmatterViolations(doc: ParsedDoc, opts: DocOptions): string[] {
  const fm = doc.frontmatter;
  if (!fm) return ["no frontmatter"];
  const out = [
    ...FRONTMATTER_KEYS.filter((key) => !fm.has(key)).map((key) => `frontmatter lacks ${key}`),
    ...[...fm.keys()].filter((key) => !FRONTMATTER_KEYS.includes(key)).map((key) => `frontmatter key ${key} is not allowed`),
  ];
  const type = fm.get("type");
  const audience = fm.get("audience");
  const status = fm.get("status");
  const title = fm.get("title");
  const date = fm.get("last-updated");
  if (type !== undefined && type !== "explanation") out.push(`type is ${show(type)}, expected explanation`);
  if (audience !== undefined && audience !== "internal") out.push(`audience is ${show(audience)}, expected internal`);
  if (status !== undefined && !STATUSES.includes(String(status))) {
    out.push(`status is ${show(status)}, expected ${STATUSES.join(" or ")}`);
  }
  if (title !== undefined && title !== opts.title) out.push(`title is ${show(title)}, expected ${show(opts.title)}`);
  const dateOk = opts.template ? date === TEMPLATE_DATE : typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date);
  if (date !== undefined && !dateOk) {
    out.push(`last-updated is ${show(date)}, expected ${opts.template ? TEMPLATE_DATE : "a YYYY-MM-DD date"}`);
  }
  return out;
}

function headViolations(doc: ParsedDoc, title: string): string[] {
  const h1s = doc.headings.filter((h) => h.level === 1);
  if (h1s.length !== 1) return [`${h1s.length} H1 headings, expected one`];
  const h1 = h1s[0]!;
  const out: string[] = [];
  if (h1.text !== title) out.push(`H1 is ${show(h1.text)}, expected the title ${show(title)}`);
  const next = doc.lines.find((l) => l.n > h1.line && l.text.trim() !== "");
  if (!next || next.kind !== "prose" || !next.text.startsWith("> ")) out.push('no "> " summary line after the H1');
  return out;
}

function sectionViolations(doc: ParsedDoc): string[] {
  const out: string[] = [];
  const h2s = doc.headings.filter((h) => h.level === 2);
  const names = h2s.map((h) => h.text);
  if (names.join("\n") !== SECTIONS.join("\n")) {
    out.push(`sections are ${names.join(", ") || "none"}, expected ${SECTIONS.join(", ")}`);
  }
  for (const h of doc.headings.filter((heading) => heading.level > 2)) {
    out.push(`line ${h.line}: ${show(`${"#".repeat(h.level)} ${h.text}`)} is deeper than H2`);
  }
  for (const h of h2s) {
    const body = doc.lines.filter((l) => l.section === h.text && l.n > h.line && l.text.trim() !== "");
    if (body.length === 0) out.push(`section ${show(h.text)} is empty: write None.`);
    else if (body.length > 1 && body.some((l) => l.text.trim() === "None.")) {
      out.push(`section ${show(h.text)} holds None. and more`);
    }
  }
  return out;
}

function tableViolations(doc: ParsedDoc, clientFacing: boolean): string[] {
  const out: string[] = [];
  for (const table of doc.tables) {
    const home = TABLE_HOMES.get(table.header);
    if (home === undefined) out.push(`line ${table.line}: table ${show(table.header)} is not one of the three module doc tables`);
    else if (table.section !== home) out.push(`line ${table.line}: table ${show(table.header)} belongs in ${home}`);
  }
  for (const [header, home] of TABLE_HOMES) {
    const count = doc.tables.filter((t) => t.header === header && t.section === home).length;
    const required = header !== FIELD_HEADER || clientFacing;
    if (count > 1 || (count === 0 && required)) {
      const why = header === FIELD_HEADER ? " (the module serves a client-facing route)" : "";
      out.push(`${count} ${show(header)} tables in ${home}, expected one${why}`);
    }
  }
  return out;
}

function diagramViolations(doc: ParsedDoc): string[] {
  const blocks = doc.fences.filter((f) => f.info === "mermaid");
  if (blocks.length !== 1) return [`${blocks.length} mermaid blocks, expected one`];
  const block = blocks[0]!;
  const out: string[] = [];
  if (block.section !== "Structure") out.push(`line ${block.line}: the mermaid block belongs in Structure`);
  const first = block.body.find((l) => l.trim() !== "")?.trim() ?? "";
  if (/^C4/.test(first)) out.push(`line ${block.line}: the mermaid block uses C4 syntax, not a flowchart`);
  else if (!first.startsWith("flowchart")) out.push(`line ${block.line}: the mermaid block is not a flowchart`);
  return out;
}

function digitViolations(doc: ParsedDoc): string[] {
  return proseOrComment(doc)
    .filter((l) => /\d/.test(withoutLinks(withoutCodeSpans(l.text))))
    .map((l) => `line ${l.n}: a digit outside code, a link or a fence: ${l.text.trim()}`);
}

function historyViolations(doc: ParsedDoc): string[] {
  return proseOrComment(doc).flatMap((l) => {
    const prose = linkTexts(withoutCodeSpans(l.text));
    return HISTORY_PHRASES.filter(([, pattern]) => pattern.test(prose)).map(([phrase]) => `line ${l.n}: history phrase ${show(phrase)}`);
  });
}

/** Links resolve from where module docs live: the template's copies sit there too. */
function linkViolations(doc: ParsedDoc, exists: (rel: string) => boolean): string[] {
  const dir = path.posix.dirname(docPathOf("<module>"));
  return doc.lines
    .filter((l) => l.kind === "prose")
    .flatMap((l) =>
      linkTargets(l.text)
        .filter((target) => target !== "" && !/^(?:[a-z][a-z+.-]*:|#|\/)/i.test(target))
        .filter((target) => {
          const rel = path.posix.normalize(path.posix.join(dir, target.split("#")[0]!));
          return rel.startsWith("../") || !exists(rel);
        })
        .map((target) => `line ${l.n}: link ${target} does not resolve`),
    );
}

/** `<file>: <problem>` for each way a module doc, or the template, breaks the format. */
export function docViolations(text: string, opts: DocOptions): string[] {
  const doc = parseDoc(text);
  const problems = [
    ...frontmatterViolations(doc, opts),
    ...headViolations(doc, opts.title),
    ...sectionViolations(doc),
    ...tableViolations(doc, opts.clientFacing),
    ...diagramViolations(doc),
    ...digitViolations(doc),
    ...historyViolations(doc),
    ...(doc.lineCount > MAX_LINES ? [`${doc.lineCount} lines, the cap is ${MAX_LINES}`] : []),
    ...linkViolations(doc, opts.exists),
  ];
  return problems.map((p) => `${opts.file}: ${p}`);
}

/** The docs the `### explanation` table of docs/README.md links, relative to docs/. */
export function indexedDocs(readme: string): string[] {
  const doc = parseDoc(readme);
  const heading = doc.headings.find((h) => h.level === 3 && /^explanation\b/.test(h.text));
  if (!heading) return [];
  const next = doc.headings.find((h) => h.line > heading.line)?.line ?? Infinity;
  return doc.tables
    .filter((t) => t.line > heading.line && t.line < next)
    .flatMap((t) => t.rows.flat())
    .flatMap(linkTargets);
}

function rulesViolations(module: string, text: string | undefined): string[] {
  const file = rulesPathOf(module);
  if (text === undefined) return [`${file}: missing`];
  const doc = parseDoc(text);
  const paths = doc.frontmatter?.get("paths");
  const listed = Array.isArray(paths) ? paths : [];
  const out = [`src/${module}/**`, `__tests__/nest/${module}/**`]
    .filter((p) => !listed.includes(p))
    .map((p) => `${file}: paths lacks ${p}`);
  const body = doc.lines.filter((l) => l.kind !== "frontmatter").map((l) => l.text).join("\n");
  if (!body.includes(docPathOf(module))) out.push(`${file}: does not point to ${docPathOf(module)}`);
  return out;
}

/** The exact `// SEE:` line sits in the run of line comments that ends just above `@Module`. */
export function hasSeePointer(file: string, source: string, module: string): boolean {
  const expected = `// SEE: ${docPathOf(module)}`;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line;
  const moduleClass = sf.statements
    .filter(ts.isClassDeclaration)
    .find((c) =>
      (ts.getDecorators(c) ?? []).some(
        (d) => ts.isCallExpression(d.expression) && ts.isIdentifier(d.expression.expression) && d.expression.expression.text === "Module",
      ),
    );
  if (!moduleClass) return false;
  const run: string[] = [];
  let above = lineOf(moduleClass.getStart(sf));
  for (const range of [...(ts.getLeadingCommentRanges(source, moduleClass.getFullStart()) ?? [])].reverse()) {
    if (range.kind !== ts.SyntaxKind.SingleLineCommentTrivia || lineOf(range.end) !== above - 1) break;
    run.push(source.slice(range.pos, range.end).trimEnd());
    above = lineOf(range.pos);
  }
  return run.includes(expected);
}

export interface ModuleDocInput {
  module: string;
  doc: string | undefined;
  readme: string;
  rules: string | undefined;
  moduleSource: string | undefined;
  clientFacing: boolean;
  exists: (rel: string) => boolean;
}

/** Everything that keeps one module's doc from conforming: the doc, its index entry, its rules file, its `SEE:` line. */
export function moduleDocViolations(input: ModuleDocInput): string[] {
  const { module } = input;
  const file = docPathOf(module);
  const out =
    input.doc === undefined
      ? [`${file}: missing`]
      : docViolations(input.doc, { file, title: titleOf(module), template: false, clientFacing: input.clientFacing, exists: input.exists });
  if (!indexedDocs(input.readme).includes(`explanation/${module}-architecture.md`)) {
    out.push(`docs/README.md: the explanation table does not link explanation/${module}-architecture.md`);
  }
  out.push(...rulesViolations(module, input.rules));
  if (!hasSeePointer(moduleFileOf(module), input.moduleSource ?? "", module)) {
    out.push(`${moduleFileOf(module)}: no "// SEE: ${file}" in the comments just above @Module`);
  }
  return out;
}

/** The MD043 override's filter must be the template plus one doc per migrated module, relative to docs/. */
export function overrideFilterViolations(jsonc: string, migrated: readonly string[]): string[] {
  const parsed = ts.parseConfigFileTextToJson(MD_CONFIG, jsonc) as { config?: { overrides?: Array<{ filter?: unknown }> } };
  const filter = parsed.config?.overrides?.[0]?.filter;
  const expected = [path.basename(MODULE_TEMPLATE), ...migrated.map((m) => `explanation/${m}-architecture.md`)];
  if (JSON.stringify(filter) === JSON.stringify(expected)) return [];
  return [`${MD_CONFIG}: overrides[0].filter is ${JSON.stringify(filter)}, expected ${JSON.stringify(expected)}`];
}

function realModuleInput(module: string, files: readonly string[]): ModuleDocInput {
  const controllers = files.filter((f) => f.startsWith(`src/${module}/`) && isNonSpecSource(f) && f.endsWith(".controller.ts"));
  return {
    module,
    doc: readIfExists(docPathOf(module)),
    readme: readSource("docs/README.md"),
    rules: readIfExists(rulesPathOf(module)),
    moduleSource: readIfExists(moduleFileOf(module)),
    clientFacing: controllers.flatMap((f) => routesIn(f, readSource(f))).some((r) => !isExemptPath(r.path)),
    exists: existsInRepo,
  };
}

const DOC_FILE = "docs/explanation/bus-architecture.md";
const MERMAID = '```mermaid\nflowchart LR\n  up["HSSC"] -->|positions| cache[("bus_cache")]\n  cache --> eta["GET /bus/hssc/:stationId"]\n```\n';
const DOC = [
  "---",
  "title: Bus Architecture",
  "type: explanation",
  "status: draft",
  "owner: someone@example.com",
  "last-updated: 2026-10-11",
  "audience: internal",
  "---",
  "",
  "# Bus Architecture",
  "",
  "> What `src/bus/` serves, and who reads it.",
  "",
  "## Context",
  "",
  "Bus mirrors one upstream.",
  "",
  "| System | Quirk tag | Gives | Enters at |",
  "| --- | --- | --- | --- |",
  "| HSSC | `hssc` | Bus positions | `HsscClient` |",
  "",
  "## Glossary",
  "",
  "| Term | Means | Derived from | Not |",
  "| --- | --- | --- | --- |",
  "| `stationId` (`StationId`) | One stop of a route | `toStationId` | `stopId`, a bare id |",
  "",
  "## Structure",
  "",
  MERMAID,
  "| Field | App use |",
  "| --- | --- |",
  "| `eta` | `BusScreen` |",
  "",
  "## Invariants",
  "",
  "- A position older than `MAX_POSITION_AGE_MS` is not served.",
  "",
  "## Open questions",
  "",
  "None.",
  "",
  "## Related",
  "",
  "- [ADR 0010](../decisions/0010-server-architecture.md): the module shape",
  "",
].join("\n");
const README = [
  "### explanation (why)",
  "",
  "| Doc | Summary |",
  "| --- | --- |",
  "| [bus-architecture.md](explanation/bus-architecture.md) | Bus |",
  "",
  "### decisions (ADR)",
  "",
].join("\n");
const RULES = ["---", "paths:", '  - "src/bus/**"', '  - "__tests__/nest/bus/**"', "---", "", "# bus", "", "Read `docs/explanation/bus-architecture.md` first.", ""].join("\n");
const MODULE_SOURCE = [
  'import { Module } from "@nestjs/common";',
  "",
  "// SEE: docs/explanation/bus-architecture.md",
  "// WHY: a reason the module is wired this way.",
  "@Module({})",
  "export class BusModule {}",
  "",
].join("\n");
const EXISTS = (rel: string) => rel === "docs/decisions/0010-server-architecture.md";
const OPTIONS: DocOptions = { file: DOC_FILE, title: "Bus Architecture", template: false, clientFacing: true, exists: EXISTS };
const INPUT: ModuleDocInput = { module: "bus", doc: DOC, readme: README, rules: RULES, moduleSource: MODULE_SOURCE, clientFacing: true, exists: EXISTS };

/** `text` with `from` replaced; throws when `from` is absent, so a stale fixture never passes silently. */
function swap(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`fixture lacks ${JSON.stringify(from)}`);
  return text.replace(from, to);
}

const lineNo = (text: string, needle: string) => text.split("\n").findIndex((l) => l.includes(needle)) + 1;
const problems = (text: string, opts: Partial<DocOptions> = {}) =>
  docViolations(text, { ...OPTIONS, ...opts }).map((v) => v.replace(`${OPTIONS.file}: `, ""));
const TEMPLATE_DOC = swap(swap(swap(DOC, "title: Bus Architecture", `title: ${TEMPLATE_TITLE}`), "# Bus Architecture", `# ${TEMPLATE_TITLE}`), "last-updated: 2026-10-11", `last-updated: ${TEMPLATE_DATE}`);

describe("module-docs rule applies as specified", () => {
  it("passes a conforming doc, index entry, rules file and SEE: line", () => {
    // Act
    const violations = moduleDocViolations(INPUT);

    // Assert
    expect(violations).toEqual([]);
  });

  it("names the module's doc when it is missing", () => {
    // Act
    const violations = moduleDocViolations({ ...INPUT, doc: undefined });

    // Assert
    expect(violations).toEqual(["docs/explanation/bus-architecture.md: missing"]);
  });

  it("names the doc when the explanation table of docs/README.md does not link it", () => {
    // Arrange
    const readme = swap(README, "| [bus-architecture.md](explanation/bus-architecture.md) | Bus |", "| [web-origins.md](explanation/web-origins.md) | Origins |");

    // Act
    const violations = moduleDocViolations({ ...INPUT, readme });

    // Assert
    expect(violations).toEqual(["docs/README.md: the explanation table does not link explanation/bus-architecture.md"]);
  });

  it("drops an allowlisted module whose doc conforms, and never allowlists a migrated one", () => {
    // Act
    const ratchet = compareWithAllowlist([], ["bus"]);
    const listedMigrated = migratedEntries(["building", "bus"], ["ad", "building"]);
    const listedUnmigrated = migratedEntries(["bus", "map"], ["ad", "building"]);

    // Assert
    expect(ratchet.fixed).toEqual(["bus"]);
    expect(listedMigrated).toEqual(["building"]);
    expect(listedUnmigrated).toEqual([]);
  });

  it("names the doc and the key when the type is wrong", () => {
    // Arrange
    const text = swap(DOC, "type: explanation", "type: reference");

    // Act
    const violations = docViolations(text, OPTIONS);

    // Assert
    expect(violations).toEqual(['docs/explanation/bus-architecture.md: type is "reference", expected explanation']);
  });

  it.each([
    ["audience: internal", "audience: public", 'audience is "public", expected internal'],
    ["status: draft", "status: done", 'status is "done", expected draft or accepted'],
    ["audience: internal", "audience: internal\ntags: bus", "frontmatter key tags is not allowed"],
    ["owner: someone@example.com\n", "", "frontmatter lacks owner"],
    ["last-updated: 2026-10-11", "last-updated: soon", 'last-updated is "soon", expected a YYYY-MM-DD date'],
  ])("fails frontmatter %j → %j", (from, to, expected) => {
    // Arrange
    const text = swap(DOC, from, to);

    // Act
    const violations = problems(text);

    // Assert
    expect(violations).toEqual([expected]);
  });

  it("expects the module name in Title Case, hyphens as spaces, as the title", () => {
    // Arrange
    const text = swap(swap(DOC, "title: Bus Architecture", "title: App Settings"), "# Bus Architecture", "# App Settings");

    // Act
    const violations = problems(text, { title: titleOf("app-config") });

    // Assert
    expect(titleOf("building")).toBe("Building Architecture");
    expect(violations).toEqual([
      'title is "App Settings", expected "App Config Architecture"',
      'H1 is "App Settings", expected the title "App Config Architecture"',
    ]);
  });

  it.each([
    ["# Bus Architecture", "# Bus", ['H1 is "Bus", expected the title "Bus Architecture"']],
    ["> What `src/bus/` serves, and who reads it.", "What `src/bus/` serves.", ['no "> " summary line after the H1']],
    ["## Context\n", "# Another title\n\n## Context\n", ["2 H1 headings, expected one"]],
  ])("fails a head %j → %j", (from, to, expected) => {
    // Arrange
    const text = swap(DOC, from, to);

    // Act
    const violations = problems(text);

    // Assert
    expect(violations).toEqual(expected);
  });

  it("accepts the template's placeholders only in the template", () => {
    // Act
    const asTemplate = problems(TEMPLATE_DOC, { title: TEMPLATE_TITLE, template: true });
    const asModuleDoc = problems(TEMPLATE_DOC, { title: TEMPLATE_TITLE });
    const datedTemplate = problems(DOC, { template: true });

    // Assert
    expect(asTemplate).toEqual([]);
    expect(asModuleDoc).toEqual(['last-updated is "YYYY-MM-DD", expected a YYYY-MM-DD date']);
    expect(datedTemplate).toEqual(['last-updated is "2026-10-11", expected YYYY-MM-DD']);
  });

  it("resolves the template's links from docs/explanation/, where its copies live", () => {
    // Arrange
    const exists = (rel: string) => EXISTS(rel) || rel === "docs/README.md";
    const template = { file: "docs/_module-template.md", title: TEMPLATE_TITLE, template: true, exists };
    const resolving = swap(TEMPLATE_DOC, "- [ADR 0010]", "- [Docs index](../README.md): writing rules\n- [ADR 0010]");
    const fromDocs = swap(TEMPLATE_DOC, "- [ADR 0010]", "- [Docs index](README.md): writing rules\n- [ADR 0010]");

    // Act & Assert
    expect(docViolations(resolving, { ...OPTIONS, ...template })).toEqual([]);
    expect(docViolations(fromDocs, { ...OPTIONS, ...template })).toEqual([
      `docs/_module-template.md: line ${lineNo(fromDocs, "[Docs index]")}: link README.md does not resolve`,
    ]);
  });

  it("fails the template when it drifts from the six sections", () => {
    // Arrange
    const text = swap(TEMPLATE_DOC, "## Related", "## Change map\n\nNone.\n\n## Related");

    // Act
    const violations = problems(text, { title: TEMPLATE_TITLE, template: true });

    // Assert
    expect(violations).toEqual([
      "sections are Context, Glossary, Structure, Invariants, Open questions, Change map, Related, expected Context, Glossary, Structure, Invariants, Open questions, Related",
    ]);
  });

  it("fails an extra section, sections out of order, and a heading deeper than H2", () => {
    // Arrange
    const extra = swap(DOC, "## Open questions", "## Change map\n\nNone.\n\n## Open questions");
    const outOfOrder = swap(swap(swap(DOC, "## Structure", "## Moved"), "## Invariants", "## Structure"), "## Moved", "## Invariants");
    const deeper = swap(DOC, "- A position older", "### Details\n\n- A position older");

    // Act & Assert
    expect(problems(extra)).toEqual([
      "sections are Context, Glossary, Structure, Invariants, Change map, Open questions, Related, expected Context, Glossary, Structure, Invariants, Open questions, Related",
    ]);
    expect(problems(outOfOrder)).toContain(
      "sections are Context, Glossary, Invariants, Structure, Open questions, Related, expected Context, Glossary, Structure, Invariants, Open questions, Related",
    );
    expect(problems(deeper)).toEqual([`line ${lineNo(deeper, "### Details")}: "### Details" is deeper than H2`]);
  });

  it("wants None. in a section with nothing to say, and nothing beside it", () => {
    // Arrange
    const empty = swap(DOC, "## Open questions\n\nNone.\n", "## Open questions\n");
    const crowded = swap(DOC, "None.\n", "None.\n\n- One open question.\n");

    // Act & Assert
    expect(problems(DOC)).toEqual([]);
    expect(problems(empty)).toEqual(['section "Open questions" is empty: write None.']);
    expect(problems(crowded)).toEqual(['section "Open questions" holds None. and more']);
  });

  it("names a table that is not one of the three, and a table out of place or repeated", () => {
    // Arrange
    const reference = swap(DOC, "- A position older", "| Field | Type | Required |\n| --- | --- | --- |\n| `eta` | `string` | yes |\n\n- A position older");
    const misplaced = swap(DOC, "## Glossary\n", "## Glossary\n\n| System | Quirk tag | Gives | Enters at |\n| --- | --- | --- | --- |\n| TOPIS | — | Arrivals | `TopisClient` |\n");
    const twice = swap(DOC, "| HSSC | `hssc` | Bus positions | `HsscClient` |\n", "| HSSC | `hssc` | Bus positions | `HsscClient` |\n\n| System | Quirk tag | Gives | Enters at |\n| --- | --- | --- | --- |\n| TOPIS | — | Arrivals | `TopisClient` |\n");

    // Act & Assert
    expect(problems(reference)).toEqual([
      `line ${lineNo(reference, "| Field | Type |")}: table "Field | Type | Required" is not one of the three module doc tables`,
    ]);
    expect(problems(misplaced)).toEqual([`line ${lineNo(misplaced, "| TOPIS") - 2}: table "System | Quirk tag | Gives | Enters at" belongs in Context`]);
    expect(problems(twice)).toEqual(['2 "System | Quirk tag | Gives | Enters at" tables in Context, expected one']);
  });

  it("requires the Field | App use table only of a module with a client-facing route", () => {
    // Arrange
    const text = swap(DOC, "| Field | App use |\n| --- | --- |\n| `eta` | `BusScreen` |\n", "");

    // Act
    const clientFacing = problems(text);
    const healthLike = problems(text, { clientFacing: false });

    // Assert
    expect(clientFacing).toEqual(['0 "Field | App use" tables in Structure, expected one (the module serves a client-facing route)']);
    expect(healthLike).toEqual([]);
  });

  it.each([
    ["two diagrams", "## Invariants\n", "```mermaid\nflowchart LR\n  a --> b\n```\n\n## Invariants\n", ["2 mermaid blocks, expected one"]],
    ["a C4 diagram", "flowchart LR", "C4Context", ["the mermaid block uses C4 syntax, not a flowchart"]],
    ["a graph", "flowchart LR", "graph LR", ["the mermaid block is not a flowchart"]],
  ])("fails %s", (_name, from, to, expected) => {
    // Arrange
    const text = swap(DOC, from, to);

    // Act
    const violations = problems(text).map((v) => v.replace(/^line \d+: /, ""));

    // Assert
    expect(violations).toEqual(expected);
  });

  it("fails a diagram outside Structure", () => {
    // Arrange
    const text = swap(swap(DOC, MERMAID, ""), "Bus mirrors one upstream.\n", `Bus mirrors one upstream.\n\n${MERMAID}`);

    // Act
    const violations = problems(text);

    // Assert
    expect(violations).toEqual([`line ${lineNo(text, "```mermaid")}: the mermaid block belongs in Structure`]);
  });

  it("fails a copied number and names its line; a constant's name, code, links, fences and frontmatter pass", () => {
    // Arrange
    const copied = swap(DOC, "- A position older than `MAX_POSITION_AGE_MS` is not served.", "- A run that lists fewer than 50 buildings writes nothing.");
    const named = swap(DOC, "- A position older than `MAX_POSITION_AGE_MS` is not served.", "- A run that lists fewer than `MIN_BUILDINGS_TO_TRUST` buildings writes nothing.");
    const commented = swap(DOC, "## Context\n", "## Context\n\n<!-- keep 3 rows -->\n");

    // Act & Assert
    expect(problems(copied)).toEqual([
      `line ${lineNo(copied, "fewer than 50")}: a digit outside code, a link or a fence: - A run that lists fewer than 50 buildings writes nothing.`,
    ]);
    expect(problems(named)).toEqual([]);
    expect(problems(commented)).toEqual([`line ${lineNo(commented, "<!--")}: a digit outside code, a link or a fence: <!-- keep 3 rows -->`]);
  });

  it("fails history prose", () => {
    // Arrange
    const history = swap(DOC, "Bus mirrors one upstream.", "Bus mirrors one upstream; search used to rank by name.");
    const present = swap(DOC, "Bus mirrors one upstream.", "Bus mirrors one upstream; search ranks by name.");

    // Act & Assert
    expect(problems(history)).toEqual([`line ${lineNo(history, "used to")}: history phrase "used to"`]);
    expect(problems(present)).toEqual([]);
  });

  it("caps a doc at 200 lines, frontmatter included", () => {
    // Arrange
    const padding = (n: number) => "- A rule the code keeps.\n".repeat(n);
    const room = MAX_LINES - parseDoc(DOC).lineCount;
    const atCap = swap(DOC, "## Open questions", `${padding(room)}## Open questions`);
    const overCap = swap(DOC, "## Open questions", `${padding(room + 1)}## Open questions`);

    // Act & Assert
    expect(problems(atCap)).toEqual([]);
    expect(problems(overCap)).toEqual(["201 lines, the cap is 200"]);
  });

  it("fails a relative link that does not resolve; anchors and URLs are not checked", () => {
    // Arrange
    const broken = swap(DOC, "- [ADR 0010]", "- [Gone](../how-to/gone.md)\n- [Site](https://example.com) and [Top](#context)\n- [ADR 0010]");

    // Act & Assert
    expect(problems(broken)).toEqual([`line ${lineNo(broken, "gone.md")}: link ../how-to/gone.md does not resolve`]);
  });

  it("names the rules file and the path it lacks, or the pointer it lacks", () => {
    // Arrange
    const noTests = swap(RULES, '  - "__tests__/nest/bus/**"\n', "");
    const noPointer = swap(RULES, "Read `docs/explanation/bus-architecture.md` first.", "Read the doc first.");

    // Act & Assert
    expect(moduleDocViolations({ ...INPUT, rules: noTests })).toEqual([".claude/rules/bus.md: paths lacks __tests__/nest/bus/**"]);
    expect(moduleDocViolations({ ...INPUT, rules: noPointer })).toEqual([
      ".claude/rules/bus.md: does not point to docs/explanation/bus-architecture.md",
    ]);
    expect(moduleDocViolations({ ...INPUT, rules: undefined })).toEqual([".claude/rules/bus.md: missing"]);
  });

  it.each([
    ["no SEE: line", MODULE_SOURCE.replace("// SEE: docs/explanation/bus-architecture.md\n", ""), false],
    ["a SEE: line cut off by a blank line", MODULE_SOURCE.replace("// WHY:", "\n// WHY:"), false],
    ["a SEE: line for another doc", MODULE_SOURCE.replace("bus-architecture", "map-architecture"), false],
    ["a SEE: line in a block comment", MODULE_SOURCE.replace("// SEE: docs/explanation/bus-architecture.md", "/* SEE: docs/explanation/bus-architecture.md */"), false],
    ["a SEE: line in the run above @Module", MODULE_SOURCE, true],
  ])("reads %s above @Module", (_name, source, found) => {
    // Act
    const pointed = hasSeePointer("src/bus/bus.module.ts", source, "bus");

    // Assert
    expect(pointed).toBe(found);
  });

  it("names the module file whose class lacks the SEE: line", () => {
    // Act
    const violations = moduleDocViolations({ ...INPUT, moduleSource: MODULE_SOURCE.replace("// SEE: docs/explanation/bus-architecture.md\n", "") });

    // Assert
    expect(violations).toEqual(['src/bus/bus.module.ts: no "// SEE: docs/explanation/bus-architecture.md" in the comments just above @Module']);
  });

  it("wants the MD043 override to name the template and exactly the migrated modules' docs", () => {
    // Arrange
    const config = (filter: string[]) => `{\n  // the module docs\n  "overrides": [{ "filter": ${JSON.stringify(filter)}, "config": {} }]\n}`;

    // Act
    const exact = overrideFilterViolations(config(["_module-template.md", "explanation/ad-architecture.md", "explanation/bus-architecture.md"]), ["ad", "bus"]);
    const missing = overrideFilterViolations(config(["_module-template.md", "explanation/ad-architecture.md"]), ["ad", "bus"]);

    // Assert
    expect(exact).toEqual([]);
    expect(missing).toEqual([
      'docs/.markdownlint-cli2.jsonc: overrides[0].filter is ["_module-template.md","explanation/ad-architecture.md"], expected ["_module-template.md","explanation/ad-architecture.md","explanation/bus-architecture.md"]',
    ]);
  });
});

describe("module docs", () => {
  const files = filesUnder("src");
  const modules = featureModules(files);
  const migrated = migratedModules(modules, migratedScopes());

  it.each(migrated)("of %s: the doc, its index entry, its rules file and its SEE: line conform", (module) => {
    // Act
    const violations = moduleDocViolations(realModuleInput(module, files));

    // Assert
    expect(violations).toEqual([]);
  });

  it("are missing or off-format only in the modules not yet migrated, which the allowlist names", () => {
    // Act
    const nonconforming = modules.filter((m) => moduleDocViolations(realModuleInput(m, files)).length > 0);

    // Assert
    expect(migratedEntries(readAllowlist(RULE), migrated)).toEqual([]);
    expectAllowlisted(RULE, nonconforming);
  });

  it("share their structure checks with docs/_module-template.md", () => {
    // Act
    const violations = docViolations(readSource(MODULE_TEMPLATE), {
      file: MODULE_TEMPLATE,
      title: TEMPLATE_TITLE,
      template: true,
      clientFacing: false,
      exists: existsInRepo,
    });

    // Assert
    expect(violations).toEqual([]);
  });

  it("of exactly the migrated modules are what the MD043 override checks, with the template", () => {
    // Act
    const violations = overrideFilterViolations(readSource(MD_CONFIG), migrated);

    // Assert
    expect(violations).toEqual([]);
  });
});
