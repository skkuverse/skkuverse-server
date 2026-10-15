/**
 * Comments in src/ are English (CLAUDE.md, "English everywhere"): no comment
 * in a `src/**\/*.ts` file, specs included, holds Hangul. Korean is allowed
 * only in product copy, the files `.conventions.json` lists under
 * `productCopy`, in strings, which this rule does not read, and inside a
 * backticked code span in a comment: an `EVIDENCE:` or `QUIRK(…):` that
 * quotes the exact upstream input (`q=관`) quotes data. Prose around it is
 * English, so a block that quotes Hangul also holds at least
 * MIN_ENGLISH_WORDS English words outside its spans and its tag (a whole
 * Korean sentence in backticks is not a quote); a comment that needs a Korean
 * name says it in English or points at the constant that holds it. The umbrella repo's English check (`.conventions.json`
 * names it) reads markdown only; this one covers the comments.
 *
 * Blocks as in comment-blocks (helpers/architecture/comments.ts), labelled
 * by their first line.
 *
 * The rule is strict: no allowlist, and no list may hold an entry under src/
 * (scope-entries.test.ts).
 */
import { commentBlocks, commentsOf, numberedKeys } from "../helpers/architecture/comments";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const RULE = "english-comments";
const HANGUL = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힯ힰ-퟿]/;

/** The files whose Korean is the product: `.conventions.json` `productCopy`. */
export function productCopyFiles(conventions: string): Set<string> {
  const parsed = JSON.parse(conventions) as { productCopy?: unknown };
  if (!Array.isArray(parsed.productCopy) || !parsed.productCopy.every((f): f is string => typeof f === "string")) {
    throw new Error(".conventions.json must list productCopy as an array of paths");
  }
  return new Set(parsed.productCopy);
}

export const MIN_ENGLISH_WORDS = 3;
const ENGLISH_WORD = /\b[A-Za-z]{2,}\b/g;
const COMMENT_TAG = /\b(?:WHY|EVIDENCE|SEE|QUIRK|CONTRACT)(?:\([^)]*\))?:/g;

/** A comment line without its backticked code spans: a quoted upstream input is data, like a string. */
const withoutCodeSpans = (line: string): string => line.replace(/`[^`\n]*`/g, "");

/** A block whose Hangul sits in code spans with too little English prose around them to be a quote. */
const isUnquotedKorean = (text: readonly string[]): boolean => {
  if (!text.some((line) => HANGUL.test(line))) return false;
  const prose = text.map((line) => withoutCodeSpans(line).replace(COMMENT_TAG, "")).join(" ");
  return (prose.match(ENGLISH_WORD) ?? []).length < MIN_ENGLISH_WORDS;
};

/** `<file>: <first line>` per comment block that holds Hangul outside a code span or in spans alone, `#n` on a repeat. */
export function hangulCommentViolations(file: string, source: string, productCopy: ReadonlySet<string>): string[] {
  if (!file.startsWith("src/") || !file.endsWith(".ts") || productCopy.has(file)) return [];
  const labels = commentBlocks(commentsOf(file, source))
    .filter((block) => block.text.some((line) => HANGUL.test(withoutCodeSpans(line))) || isUnquotedKorean(block.text))
    .map((block) => block.text[0]!.slice(0, 60).trimEnd());
  return numberedKeys(file, labels);
}

describe("English comment rule applies as specified", () => {
  const none = new Set<string>();

  it("reports a comment with Hangul, line or block, in a source or a spec", () => {
    // Arrange
    const source = [
      "// 혜화역 poller",
      "const a = 1; // trailing 주석",
      "/**",
      " * The first line is English.",
      " * The second names 인사캠.",
      " */",
      "function f(): void {}",
    ].join("\n");

    // Act & Assert
    expect(hangulCommentViolations("src/x/x.service.ts", source, none)).toEqual([
      "src/x/x.service.ts: 혜화역 poller",
      "src/x/x.service.ts: trailing 주석",
      "src/x/x.service.ts: The first line is English.",
    ]);
    expect(hangulCommentViolations("src/x/x.rules.spec.ts", "// 법학관 has no digits", none)).toEqual([
      "src/x/x.rules.spec.ts: 법학관 has no digits",
    ]);
  });

  it("passes Hangul inside a backticked code span, and still reports Hangul outside one", () => {
    // Arrange
    const quoted = "// EVIDENCE: it trims description-only hits (`q=관`: 29 of 69).";
    const prose = "// EVIDENCE: `q=관` trims 관 hits.";
    const unclosed = "// EVIDENCE: `q=관 trims hits.";

    // Act & Assert
    expect(hangulCommentViolations("src/x/x.rules.ts", quoted, none)).toEqual([]);
    expect(hangulCommentViolations("src/x/x.rules.ts", prose, none)).toHaveLength(1);
    expect(hangulCommentViolations("src/x/x.rules.ts", unclosed, none)).toHaveLength(1);
  });

  it.each([
    ["a whole sentence in backticks", "// `이 함수는 혜화역 도착 정보를 읽는다`"],
    ["a tag and a sentence in backticks", "// QUIRK(skku): `이 함수는 혜화역 도착 정보를 읽는다`"],
    ["spans with one English word between them", "// `혜화역` near `정류장`"],
  ])("reports Hangul in code spans with no English prose around them: %s", (_case, source) => {
    // Act & Assert
    expect(hangulCommentViolations("src/x/x.rules.ts", source, none)).toHaveLength(1);
  });

  it("passes a quote with spaces when English prose says what it is", () => {
    // Arrange
    const source = "// QUIRK(skku): one building's line reads `승장애인 표시 승강기`.";

    // Act & Assert
    expect(hangulCommentViolations("src/x/x.mapper.ts", source, none)).toEqual([]);
  });

  it("passes Hangul in a string or a template, and an English comment", () => {
    // Arrange
    const source = [
      'const label = "캠퍼스 지도"; // the campus map tile',
      "const url = `https://example.com/검색?q=${q}`;",
      "const re = /배리어프리/;",
      "// QUIRK(skku): the barrier-free header comes in three spellings.",
    ].join("\n");

    // Act & Assert
    expect(hangulCommentViolations("src/x/x.mapper.ts", source, none)).toEqual([]);
  });

  it("leaves product copy files and anything outside src/ alone", () => {
    // Arrange
    const source = "// 서버 문구";

    // Act & Assert
    expect(hangulCommentViolations("src/infra/i18n.ts", source, new Set(["src/infra/i18n.ts"]))).toEqual([]);
    expect(hangulCommentViolations("scripts/x.ts", source, none)).toEqual([]);
    expect(hangulCommentViolations("src/x/x.json", source, none)).toEqual([]);
  });

  it("reads productCopy from .conventions.json, and refuses a malformed list", () => {
    // Act & Assert
    expect(productCopyFiles('{ "productCopy": ["src/infra/i18n.ts"] }')).toEqual(new Set(["src/infra/i18n.ts"]));
    expect(() => productCopyFiles("{}")).toThrow(/productCopy/);
    expect(() => productCopyFiles('{ "productCopy": [1] }')).toThrow(/productCopy/);
  });
});

describe("src/ comments", () => {
  it("hold no Hangul outside product copy", () => {
    // Arrange
    const productCopy = productCopyFiles(readSource(".conventions.json"));
    const files = filesUnder("src").filter((f) => f.endsWith(".ts"));

    // Act & Assert
    expect(productCopy.size).toBeGreaterThan(0);
    expectAllowlisted(RULE, files.flatMap((f) => hangulCommentViolations(f, readSource(f), productCopy)));
  });
});
