/**
 * No comment in src/ narrates the code's history (ADR 0010, D10): what it used
 * to be, what it was ported from, what it always did. Git holds the history; a
 * comment states the constraint that holds now. Specs are not checked.
 */
import { commentBlocks, commentsOf, numberedKeys } from "../helpers/architecture/comments";
import { HISTORY_PHRASES } from "../helpers/architecture/history";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { isGeneratedSource, readSource, sourceFiles } from "../helpers/architecture/tree";

/** `<file>: <phrase>` for each comment that uses one, `#n` on a repeat. */
export function historyCommentViolations(file: string, source: string): string[] {
  if (isGeneratedSource(file)) return [];
  const phrases = commentBlocks(commentsOf(file, source)).flatMap((block) => {
    const text = block.text.join(" ");
    return HISTORY_PHRASES.filter(([, pattern]) => pattern.test(text)).map(([phrase]) => phrase);
  });
  return numberedKeys(file, phrases);
}

describe("history comment rule applies as specified", () => {
  it.each([
    ["// This used to be a 24 h window.", ["used to"]],
    ["/** Ported from packages/shared. */", ["ported"]],
    ["// Read with parseInt, as it always has been.", ["as it always has"]],
    ["// The legacy route.\n// Previously the old one.", ["legacy", "previously"]],
    ["// WHY: only the undrawable is checked, as before the parse moved.", ["as before"]],
    ["// Keyed the same as it was in v1.", ["as before"]],
    ["// Twice as fast than before.", ["as before"]],
    ["// Originally a per-campus list.", ["originally"]],
    ["// A token is valid from its issue until now plus its TTL.", []],
    ["// Used to decide the rule below.", []],
    ["// Run before the first read, as the boot does.", []],
    ["// A list that is used to build the index.", []],
    ["const s = 'it used to be';", []],
  ])("%j → %j", (source, phrases) => {
    expect(historyCommentViolations("src/x/x.ts", source)).toEqual(
      phrases.map((p, i) => `src/x/x.ts: ${p}${phrases.indexOf(p) < i ? " #2" : ""}`),
    );
  });

  it("numbers a phrase used in two comments", () => {
    const source = "// legacy one\nconst a = 1;\n// legacy two";
    expect(historyCommentViolations("src/x/x.ts", source)).toEqual(["src/x/x.ts: legacy", "src/x/x.ts: legacy #2"]);
  });

  it("skips a generated file: its comments come from its generator", () => {
    expect(historyCommentViolations("src/x/x.document.generated.ts", "// The legacy field.")).toEqual([]);
  });
});

describe("history comments", () => {
  it("are not written: a comment states what holds now, git keeps what was", () => {
    expectAllowlisted(
      "history-comments",
      sourceFiles().flatMap((f) => historyCommentViolations(f, readSource(f))),
    );
  });
});
