/**
 * Module docs as the module-docs and glossary-coverage rules read them
 * (refactor design D16, openspec module-docs spec): which top-level src/
 * folders are feature modules, where each one's doc lives, and a doc parsed
 * line by line into its frontmatter, fenced blocks, HTML comments, headings,
 * sections and tables, so a check reads a cell or a section, never a raw
 * pattern over the whole file.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";
import { ROOT } from "./ratchet";
import { filesUnder, readSource } from "./tree";

/** The top-level src/ folders that are a shared role, not a feature (folders.test.ts). */
const SHARED_ROLES = new Set(["config", "http", "infra", "scheduling", "shared"]);

export const MODULE_TEMPLATE = "docs/_module-template.md";
export const SECTIONS = ["Context", "Glossary", "Structure", "Invariants", "Open questions", "Related"];
export const CONTEXT_HEADER = "System | Quirk tag | Gives | Enters at";
export const GLOSSARY_HEADER = "Term | Means | Derived from | Not";
export const FIELD_HEADER = "Field | App use";
/** Written in a cell that has nothing to name. */
export const NONE_CELL = "—";

export const docPathOf = (module: string): string => `docs/explanation/${module}-architecture.md`;
export const rulesPathOf = (module: string): string => `.claude/rules/${module}.md`;
export const moduleFileOf = (module: string): string => `src/${module}/${module}.module.ts`;

/** `app-config` → `App Config Architecture`. */
export function titleOf(module: string): string {
  const words = module.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return `${words.join(" ")} Architecture`;
}

/** Top-level src/ folders that hold `<m>/<m>.module.ts` and are not a shared role, sorted. */
export function featureModules(files: readonly string[] = filesUnder("src")): string[] {
  const present = new Set(files);
  const tops = new Set(files.map((f) => f.split("/")).filter((p) => p.length > 2).map((p) => p[1]!));
  return [...tops].filter((m) => !SHARED_ROLES.has(m) && present.has(moduleFileOf(m))).sort();
}

/** The modules whose `src/<m>/` is a migrated scope. */
export function migratedModules(modules: readonly string[], scopes: readonly string[]): string[] {
  return modules.filter((m) => scopes.includes(`src/${m}/`));
}

/** Allowlist entries that name a migrated module: a migrated module is never allowlisted. */
export function migratedEntries(allowlist: readonly string[], migrated: readonly string[]): string[] {
  return allowlist.filter((entry) => migrated.includes(entry));
}

export const existsInRepo = (rel: string): boolean => fs.existsSync(path.join(ROOT, rel));

export function readIfExists(rel: string): string | undefined {
  return existsInRepo(rel) ? readSource(rel) : undefined;
}

export type LineKind = "frontmatter" | "fence" | "comment" | "prose";

export interface DocLine {
  /** 1-based. */
  n: number;
  text: string;
  kind: LineKind;
  /** The H2 the line sits under, if any. */
  section: string | undefined;
}

export interface Heading {
  level: number;
  text: string;
  line: number;
}

export interface Table {
  /** The header cells joined by ` | `: `Field | App use`. */
  header: string;
  columns: string[];
  rows: string[][];
  line: number;
  section: string | undefined;
}

export interface Fence {
  /** The first word of the info string: `mermaid`, `ts`, or empty. */
  info: string;
  line: number;
  section: string | undefined;
  body: string[];
}

export interface ParsedDoc {
  /** Key → value, or → items for a key followed by a `- item` list; undefined when the file has none. */
  frontmatter: Map<string, string | string[]> | undefined;
  lines: DocLine[];
  headings: Heading[];
  tables: Table[];
  fences: Fence[];
  /** Lines as `wc -l` counts them, frontmatter included. */
  lineCount: number;
}

const unquote = (value: string): string => value.trim().replace(/^(["'])(.*)\1$/, "$2");

function parseFrontmatter(lines: readonly string[]): Map<string, string | string[]> {
  const out = new Map<string, string | string[]>();
  let list: string[] | undefined;
  for (const line of lines) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && list) {
      list.push(unquote(item[1]!));
      continue;
    }
    const pair = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    if (pair[2] === "") {
      list = [];
      out.set(pair[1]!, list);
    } else {
      list = undefined;
      out.set(pair[1]!, unquote(pair[2]!));
    }
  }
  return out;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const DELIMITER_ROW = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** A table row's cells, split on unescaped pipes (GFM splits inside code spans too). */
export function rowCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

const isRow = (line: DocLine | undefined): line is DocLine =>
  line !== undefined && line.kind === "prose" && /^\s{0,3}\|/.test(line.text);

export function parseDoc(text: string): ParsedDoc {
  const raw = (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
  const lines: DocLine[] = [];
  const headings: Heading[] = [];
  const fences: Fence[] = [];
  let frontmatter: Map<string, string | string[]> | undefined;
  let start = 0;
  if (raw[0] === "---") {
    const end = raw.indexOf("---", 1);
    if (end > 0) {
      frontmatter = parseFrontmatter(raw.slice(1, end));
      for (let i = 0; i <= end; i++) lines.push({ n: i + 1, text: raw[i]!, kind: "frontmatter", section: undefined });
      start = end + 1;
    }
  }
  let fence: { marker: string; block: Fence } | undefined;
  let inComment = false;
  let section: string | undefined;
  for (let i = start; i < raw.length; i++) {
    const textLine = raw[i]!;
    const line: DocLine = { n: i + 1, text: textLine, kind: "prose", section };
    lines.push(line);
    if (fence) {
      line.kind = "fence";
      const closing = new RegExp(`^ {0,3}${fence.marker[0]}{${fence.marker.length},}\\s*$`);
      if (closing.test(textLine)) fence = undefined;
      else fence.block.body.push(textLine);
      continue;
    }
    if (inComment || textLine.trimStart().startsWith("<!--")) {
      line.kind = "comment";
      const close = textLine.indexOf("-->", inComment ? 0 : textLine.indexOf("<!--") + 4);
      inComment = close < 0;
      continue;
    }
    const open = FENCE_OPEN.exec(textLine);
    if (open) {
      line.kind = "fence";
      const block: Fence = { info: open[2]!, line: line.n, section, body: [] };
      fences.push(block);
      fence = { marker: open[1]!, block };
      continue;
    }
    const heading = HEADING.exec(textLine);
    if (heading) {
      const level = heading[1]!.length;
      headings.push({ level, text: heading[2]!, line: line.n });
      if (level <= 2) section = level === 2 ? heading[2]! : undefined;
      line.section = section;
    }
  }
  const tables: Table[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i];
    const delimiter = lines[i + 1];
    if (!isRow(head) || !isRow(delimiter) || !DELIMITER_ROW.test(delimiter.text) || isRow(lines[i - 1])) continue;
    const columns = rowCells(head.text);
    const rows: string[][] = [];
    let j = i + 2;
    for (; isRow(lines[j]); j++) rows.push(rowCells(lines[j]!.text));
    tables.push({ header: columns.join(" | "), columns, rows, line: head.n, section: head.section });
    i = j - 1;
  }
  return { frontmatter, lines, headings, tables, fences, lineCount: text === "" ? 0 : raw.length };
}

/** The cells of one column of a table, by header name; empty when the table has no such column. */
export function columnCells(table: Table, column: string): string[] {
  const index = table.columns.indexOf(column);
  return index < 0 ? [] : table.rows.map((row) => row[index] ?? "");
}

const CODE_SPAN = /(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g;
const LINK = /!?\[([^\]]*)\]\(([^)]*)\)/g;

/** The contents of a line's code spans. */
export function codeSpans(text: string): string[] {
  return [...text.matchAll(CODE_SPAN)].map((m) => m[2]!.trim());
}

export const withoutCodeSpans = (text: string): string => text.replace(CODE_SPAN, " ");

/** Removes each whole `[text](target)` link. */
export const withoutLinks = (text: string): string => text.replace(LINK, " ");

/** Keeps each link's text and drops its target. */
export const linkTexts = (text: string): string => text.replace(LINK, "$1");

/** The targets of a line's links, title and angle brackets dropped. */
export function linkTargets(text: string): string[] {
  return [...withoutCodeSpans(text).matchAll(LINK)].map((m) => m[2]!.trim().replace(/^<(.*)>$/, "$1").split(/\s+/)[0]!);
}

/** The text of every `mermaid` block, joined. */
export function mermaidText(doc: ParsedDoc): string {
  return doc.fences
    .filter((f) => f.info === "mermaid")
    .flatMap((f) => f.body)
    .join("\n");
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `<METHOD> <path>` in a diagram, not as the start of a longer path: `GET /health` is not in `GET /health/ready`. */
export function namesRoute(diagram: string, route: string): boolean {
  return new RegExp(`(?<![\\w/])${escapeRegex(route)}(?![\\w/:.-])`).test(diagram);
}

/** A collection name on word boundaries: `buildings` is not in `buildings_raw`. */
export function namesWord(diagram: string, word: string): boolean {
  return new RegExp(`\\b${escapeRegex(word)}\\b`).test(diagram);
}

/** `HISTORY_PHRASES`, read from history-comments.test.ts so both rules share one list. */
export function historyPhrases(): Array<[string, RegExp]> {
  // WHY: parsed, not imported: importing a test file registers its tests in the importer too.
  const file = "__tests__/architecture/history-comments.test.ts";
  const sf = ts.createSourceFile(file, readSource(file), ts.ScriptTarget.Latest, true);
  const declaration = sf.statements
    .filter(ts.isVariableStatement)
    .flatMap((s) => [...s.declarationList.declarations])
    .find((d) => ts.isIdentifier(d.name) && d.name.text === "HISTORY_PHRASES");
  const list = declaration?.initializer;
  if (!list || !ts.isArrayLiteralExpression(list)) throw new Error(`${file}: HISTORY_PHRASES is not an array literal`);
  return list.elements.map((element) => {
    const [phrase, pattern] = ts.isArrayLiteralExpression(element) ? element.elements : [];
    if (!phrase || !ts.isStringLiteral(phrase) || pattern?.kind !== ts.SyntaxKind.RegularExpressionLiteral) {
      throw new Error(`${file}: a HISTORY_PHRASES entry is not ["phrase", /regex/]`);
    }
    const literal = pattern.getText(sf);
    const flagsAt = literal.lastIndexOf("/");
    return [phrase.text, new RegExp(literal.slice(1, flagsAt), literal.slice(flagsAt + 1))];
  });
}
