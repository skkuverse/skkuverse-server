/**
 * Every comment in src/ opens with a tag naming why it exists (ADR 0010, D10):
 * WHY:, QUIRK(<system>):, CONTRACT(<repo>): with a cited path, EVIDENCE: or
 * SEE: docs/…. Blocks as in comment-blocks; specs and __tests__/ are not checked.
 */
import fs from "fs";
import path from "path";
import { commentBlocks, commentsOf, numberedKeys, type SourceComment } from "../helpers/architecture/comments";
import { expectAllowlisted, ROOT } from "../helpers/architecture/ratchet";
import { isGeneratedSource, isNonSpecSource, readSource, sourceFiles } from "../helpers/architecture/tree";

/** The repos of CLAUDE.md "Ecosystem", and the in-repo consumers outside src/. */
export const CONTRACT_REPOS = [
  "skkuverse",
  "skkuverse-app",
  "skkuverse-crawler",
  "skkuverse-ai",
  "skkuverse-web",
  "skkuverse-mini",
  "skkuverse-codepush",
  "scripts",
  "infra",
] as const;

const SYSTEM = String.raw`[a-z][a-z0-9]*(?:-[a-z0-9]+)*`;
const TAG = new RegExp(String.raw`^(?:WHY:|QUIRK\(${SYSTEM}\):|CONTRACT\((${SYSTEM})\):|EVIDENCE:|SEE:)\s+\S`);
const CITED_PATH = new RegExp(String.raw`(?<![\w/.-])(?:${CONTRACT_REPOS.join("|")})\/[\w.-]+`);
const SEE_PATH = /^SEE:\s+(docs\/[^\s#]+?)[.,;:)]*(?:[\s#]|$)/;

/** Comments no tag applies to: compiler directives and the shebang. */
function isDirective(comment: SourceComment): boolean {
  return /^(?:\/\/\/\s*<|\/\/\s*@ts-expect-error\s+\S|#!)/.test(comment.raw);
}

/** Why a block's text fails the rule, or undefined when it passes. */
function tagProblem(text: readonly string[], exists: (rel: string) => boolean): string | undefined {
  const first = text[0] ?? "";
  const tag = TAG.exec(first);
  if (!tag) return "untagged";
  const contractRepo = tag[1];
  if (contractRepo !== undefined) {
    if (!(CONTRACT_REPOS as readonly string[]).includes(contractRepo)) return `unknown repo ${contractRepo}`;
    if (!CITED_PATH.test(text.join(" "))) return "no <repo>/<path> cited";
  }
  if (first.startsWith("SEE:")) {
    const cited = SEE_PATH.exec(first)?.[1];
    if (cited === undefined) return "no docs/ path";
    // src-docs-paths already checks a cited .md exists.
    if (!cited.endsWith(".md") && !exists(cited)) return `missing ${cited}`;
  }
  return undefined;
}

/** Hash-locked vendored files (.contracts.lock.json): their comments are not edited here. */
function vendoredSources(): Set<string> {
  const lock = JSON.parse(readSource(".contracts.lock.json")) as { contracts: Record<string, { path: string }> };
  return new Set(Object.values(lock.contracts).map((c) => c.path));
}

/** `<file>: <first line>` per untagged comment, `[reason]` appended when a tag is malformed, `#n` on a repeat. */
export function commentTagViolations(
  file: string,
  source: string,
  exists: (rel: string) => boolean = (rel) => fs.existsSync(path.join(ROOT, rel)),
): string[] {
  if (!isNonSpecSource(file) || isGeneratedSource(file)) return [];
  const blocks = commentBlocks(commentsOf(file, source).filter((c) => !isDirective(c)));
  const labels = blocks.flatMap((block) => {
    const problem = tagProblem(block.text, exists);
    if (problem === undefined) return [];
    const head = block.text[0]!.slice(0, 60).trimEnd();
    return [problem === "untagged" ? head : `${head} [${problem}]`];
  });
  return numberedKeys(file, labels);
}

describe("comment tag rule applies as specified", () => {
  const none = (): boolean => false;

  it("passes each tag with text after it, on a block's first line", () => {
    // Arrange
    const source = [
      "// WHY: a choice someone might undo.",
      "/** QUIRK(hssc): the API answers 200 with an error body. */",
      "// CONTRACT(skkuverse-crawler): it writes this collection",
      "// (skkuverse-crawler/src/notices/writer.ts).",
      "const s = 0;",
      "// CONTRACT(scripts): read by scripts/schedule.js.",
      "/**",
      " * EVIDENCE: 2026-10-01 incident, p99 1.2 s.",
      " * More lines need no tag.",
      " */",
      "// SEE: docs/decisions/0010-server-architecture.md",
      "const a = 1; // WHY: trailing comments are blocks too.",
    ].join("\n");

    // Act
    const violations = commentTagViolations("src/x/x.ts", source, none);

    // Assert
    expect(violations).toEqual([]);
  });

  it("flags an untagged comment, a lowercase tag and a tag with nothing after it", () => {
    // Arrange
    const source = ["// Root module.", "const a = 1;", "// Why: lowercase.", "const b = 2;", "/** WHY: */"].join("\n");

    // Act
    const violations = commentTagViolations("src/x/x.ts", source, none);

    // Assert
    expect(violations).toEqual(["src/x/x.ts: Root module.", "src/x/x.ts: Why: lowercase.", "src/x/x.ts: WHY:"]);
  });

  it("flags a CONTRACT without a cited path or naming an unknown repo, and a SEE without a docs/ path", () => {
    // Arrange
    const source = [
      "// CONTRACT(skkuverse-app): the app reads this field.",
      "const a = 1;",
      "// CONTRACT(other-repo): see other-repo/x.ts.",
      "const b = 2;",
      "// SEE: the ADR.",
      "const c = 3;",
      "// SEE: docs/how-to/missing.json",
      "const d = 4;",
      "// QUIRK(HSSC): uppercase system.",
    ].join("\n");

    // Act
    const violations = commentTagViolations("src/x/x.ts", source, none);

    // Assert
    expect(violations).toEqual([
      "src/x/x.ts: CONTRACT(skkuverse-app): the app reads this field. [no <repo>/<path> cited]",
      "src/x/x.ts: CONTRACT(other-repo): see other-repo/x.ts. [unknown repo other-repo]",
      "src/x/x.ts: SEE: the ADR. [no docs/ path]",
      "src/x/x.ts: SEE: docs/how-to/missing.json [missing docs/how-to/missing.json]",
      "src/x/x.ts: QUIRK(HSSC): uppercase system.",
    ]);
  });

  it("reads no comment out of strings, and exempts eslint, @ts-expect-error and triple-slash directives", () => {
    // Arrange
    const source = [
      "#!/usr/bin/env node",
      '/// <reference types="node" />',
      "// eslint-disable-next-line no-console -- a reason",
      "console.log(1);",
      "// @ts-expect-error the upstream type omits it",
      "const x: number = 'a';",
      'const url = "https://a.dev/x // not a comment";',
      "const t = `// not a comment either`;",
    ].join("\n");

    // Act
    const violations = commentTagViolations("src/x/x.ts", source, none);

    // Assert
    expect(violations).toEqual([]);
  });

  it("checks a block's first text line after an eslint directive, and flags a bare @ts-expect-error", () => {
    // Arrange
    const source = [
      "// eslint-disable-next-line no-console -- a reason",
      "// Logs once.",
      "console.log(1);",
      "// @ts-expect-error",
      "const x: number = 'a';",
    ].join("\n");

    // Act
    const violations = commentTagViolations("src/x/x.ts", source, none);

    // Assert
    expect(violations).toEqual(["src/x/x.ts: Logs once.", "src/x/x.ts: @ts-expect-error"]);
  });

  it("skips specs and __tests__/: their comments follow .claude/rules/tests.md", () => {
    // Arrange
    const source = "// Untagged.\nconst a = 1;";

    // Act
    const checked = ["src/x/x.spec.ts", "__tests__/helpers/x.ts", "src/x/x.ts"].map((f) =>
      commentTagViolations(f, source, none),
    );

    // Assert
    expect(checked).toEqual([[], [], ["src/x/x.ts: Untagged."]]);
  });

  it("skips a generated file: its comments come from its generator", () => {
    // Act
    const violations = commentTagViolations("src/x/x.document.generated.ts", "// Untagged.\nconst a = 1;", none);

    // Assert
    expect(violations).toEqual([]);
  });
});

describe("comment tags", () => {
  it("open every comment in src/: a comment carries only what the code cannot", () => {
    // Arrange
    const vendored = vendoredSources();

    // Act
    const violations = sourceFiles()
      .filter((f) => !vendored.has(f))
      .flatMap((f) => commentTagViolations(f, readSource(f)));

    // Assert
    expectAllowlisted("comment-tags", violations);
  });
});
