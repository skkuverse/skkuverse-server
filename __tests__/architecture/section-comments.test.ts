/**
 * No section-divider comments in src/ (ADR 0010, D10). A `// --- Sync ---`
 * heading groups code by a comment that nothing checks, and the grouping
 * drifts: in the pilot, response mappers sat under "Enrichment". A part of a
 * file that needs a heading becomes its own file (`building-sync.mapper.ts`)
 * or a better name.
 *
 * A divider is a `//` line that opens with three or more `-`, three or more
 * `=`, or two or more `─`, or the same run as a line of a multi-line block
 * comment; there a bare run underlines the line above it, which is then the
 * heading (` * THE RANKING SIGNAL` over ` * -----`). Specs are not checked.
 */
import { commentLines, commentsOf, numberedKeys } from "../helpers/architecture/comments";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { isGeneratedSource, readSource, sourceFiles } from "../helpers/architecture/tree";

const RULE = String.raw`(?:-{3,}|={3,}|─{2,})`;
const DIVIDER = new RegExp(String.raw`^\s*\/\/\s*${RULE}(?=\s|$)(.*)$`);
const BLOCK_DIVIDER = new RegExp(String.raw`^${RULE}(?=\s|$)(.*)$`);
const TRAILING_RULE = new RegExp(String.raw`${RULE}\s*$`);

function headingOf(rest: string): string {
  return rest.replace(TRAILING_RULE, "").trim();
}

/** Dividers on `//` lines, as [line, heading]. */
function lineDividers(source: string): Array<[number, string]> {
  return source.split("\n").flatMap((line, i): Array<[number, string]> => {
    const match = DIVIDER.exec(line);
    return match ? [[i + 1, headingOf(match[1]!) || "(rule)"]] : [];
  });
}

/** Dividers inside multi-line block comments, as [line, heading]. */
function blockDividers(file: string, source: string): Array<[number, string]> {
  return commentsOf(file, source)
    .filter((c) => c.kind === "block" && c.endLine > c.line)
    .flatMap((c) =>
      commentLines(c).flatMap((text, i, lines): Array<[number, string]> => {
        const match = BLOCK_DIVIDER.exec(text);
        if (!match) return [];
        const above = lines.slice(0, i).reverse().find((l) => l !== "");
        return [[c.line + i, headingOf(match[1]!) || above || "(rule)"]];
      }),
    );
}

/** `<file>: <heading>` for each divider, `#n` on a repeated heading. */
export function sectionCommentViolations(file: string, source: string): string[] {
  if (isGeneratedSource(file)) return [];
  const dividers = [...lineDividers(source), ...blockDividers(file, source)].sort((a, b) => a[0] - b[0]);
  return numberedKeys(
    file,
    dividers.map(([, heading]) => heading),
  );
}

describe("section comment rule applies as specified", () => {
  it("finds dashed, double and box-drawing dividers, and numbers repeats", () => {
    const source = [
      "// --- Sync ---",
      "const a = 1;",
      "// === Responses ===",
      "  // ── Import boundaries (D9) ──",
      "// ------------------",
      "// --- Sync ---",
    ].join("\n");
    expect(sectionCommentViolations("src/x/x.ts", source)).toEqual([
      "src/x/x.ts: Sync",
      "src/x/x.ts: Responses",
      "src/x/x.ts: Import boundaries (D9)",
      "src/x/x.ts: (rule)",
      "src/x/x.ts: Sync #2",
    ]);
  });

  it("finds a divider or an underline inside a multi-line block comment", () => {
    const source = [
      "/**",
      " * Ranking.",
      " *",
      " * THE RANKING SIGNAL",
      " * ------------------",
      " * --- Bands ---",
      " */",
      "const a = 1;",
    ].join("\n");
    expect(sectionCommentViolations("src/x/x.ts", source)).toEqual([
      "src/x/x.ts: THE RANKING SIGNAL",
      "src/x/x.ts: Bands",
    ]);
  });

  it("leaves ordinary comments alone", () => {
    const source = [
      "// -- an aside",
      "// --no-verify is a flag",
      "/* --- block comments are not dividers here --- */",
      "// a - b - c",
      "const s = '// --- not a comment line';",
    ].join("\n");
    expect(sectionCommentViolations("src/x/x.ts", source)).toEqual([]);
  });

  it("skips a generated file: its comments come from its generator", () => {
    expect(sectionCommentViolations("src/x/x.document.generated.ts", "// --- Sync ---\nconst a = 1;")).toEqual([]);
  });
});

describe("section comments", () => {
  it("are not used: a part that needs a heading becomes its own file or a better name", () => {
    const files = sourceFiles();
    expectAllowlisted(
      "section-comments",
      files.flatMap((f) => sectionCommentViolations(f, readSource(f))),
    );
  });
});
