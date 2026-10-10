/**
 * No section-divider comments in src/ (ADR 0010, D10). A `// --- Sync ---`
 * heading groups code by a comment that nothing checks, and the grouping
 * drifts: in the pilot, response mappers sat under "Enrichment". A part of a
 * file that needs a heading becomes its own file (`building-sync.mapper.ts`)
 * or a better name.
 *
 * A divider is a `//` line that opens with three or more `-`, three or more
 * `=`, or two or more `─`. Specs are not checked.
 */
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

const DIVIDER = /^\s*\/\/\s*(?:-{3,}|={3,}|─{2,})(?=\s|$)(.*)$/;

/** `<file>: <heading>` for each divider, `#n` on a repeated heading. */
export function sectionCommentViolations(file: string, source: string): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const line of source.split("\n")) {
    const match = DIVIDER.exec(line);
    if (!match) continue;
    const heading = match[1]!.replace(/(?:-{3,}|={3,}|─{2,})\s*$/, "").trim() || "(rule)";
    const n = (seen.get(heading) ?? 0) + 1;
    seen.set(heading, n);
    out.push(`${file}: ${heading}${n > 1 ? ` #${n}` : ""}`);
  }
  return out;
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
