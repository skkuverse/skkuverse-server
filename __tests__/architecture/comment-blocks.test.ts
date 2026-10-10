/**
 * No comment in src/ runs past three lines of text (ADR 0010, D10). A comment
 * holds only what the code cannot say; a rationale that needs more goes to
 * docs/ and the comment cites its path. A block comment, or a run of adjacent
 * own-line `//` comments, counts as one; blank lines and eslint directives do
 * not count. Specs are not checked (.claude/rules/tests.md).
 */
import { commentBlocks, commentsOf, numberedKeys } from "../helpers/architecture/comments";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

export const MAX_COMMENT_LINES = 3;

/** `<file>: <first line of the comment>` for each comment over the limit, `#n` on a repeat. */
export function longCommentViolations(file: string, source: string): string[] {
  const long = commentBlocks(commentsOf(file, source)).filter((b) => b.text.length > MAX_COMMENT_LINES);
  return numberedKeys(
    file,
    long.map((b) => b.text[0]!.slice(0, 60).trimEnd()),
  );
}

describe("comment block rule applies as specified", () => {
  it("flags a block comment or a run of // lines over three lines of text", () => {
    const source = [
      "/**",
      " * One.",
      " *",
      " * Two.",
      " * Three.",
      " * Four.",
      " */",
      "const a = 1;",
      "// one",
      "// two",
      "// three",
      "// four",
      "const b = 2;",
    ].join("\n");
    expect(longCommentViolations("src/x/x.ts", source)).toEqual(["src/x/x.ts: One.", "src/x/x.ts: one"]);
  });

  it("allows three lines, and splits // runs at code, a blank line or a trailing comment", () => {
    const source = [
      "/** One.",
      " * Two.",
      " * Three. */",
      "// one",
      "// two",
      "",
      "// three",
      "// four",
      "const a = 1; // trailing",
      "// five",
      "// six",
      "// seven",
    ].join("\n");
    expect(longCommentViolations("src/x/x.ts", source)).toEqual([]);
  });

  it("does not count eslint directives, and reads no comment out of strings or regexes", () => {
    const source = [
      "// eslint-disable-next-line no-console -- a reason",
      "// one",
      "// two",
      "// three",
      'const url = "https://a.dev/x"; // one line',
      "const re = /\\/\\/ not a comment/;",
      "const t = `",
      "// not",
      "// a",
      "// comment",
      "// either",
      "`;",
    ].join("\n");
    expect(longCommentViolations("src/x/x.ts", source)).toEqual([]);
  });

  it("numbers comments that open with the same line", () => {
    const four = ["// Same.", "// b", "// c", "// d"];
    const source = [...four, "const a = 1;", ...four].join("\n");
    expect(longCommentViolations("src/x/x.ts", source)).toEqual(["src/x/x.ts: Same.", "src/x/x.ts: Same. #2"]);
  });
});

describe("comment blocks", () => {
  it("hold at most three lines; a longer rationale lives in docs/", () => {
    expectAllowlisted(
      "comment-blocks",
      sourceFiles().flatMap((f) => longCommentViolations(f, readSource(f))),
    );
  });
});
