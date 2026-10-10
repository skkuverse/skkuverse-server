import ts from "typescript";

export interface SourceComment {
  /** 1-based line of the comment's first character. */
  line: number;
  endLine: number;
  kind: "line" | "block";
  /** Nothing but whitespace precedes the comment on its first line. */
  ownLine: boolean;
  /** The raw comment, markers included. */
  raw: string;
}

/** A run of comments a reader takes in as one: a block comment, or adjacent own-line `//` comments. */
export interface CommentBlock {
  line: number;
  /** Its lines with the comment markers stripped, blank lines and eslint directives left out. */
  text: string[];
}

const ESLINT_DIRECTIVE = /^eslint-(?:disable|enable)/;

/**
 * Every comment in a TypeScript source, found through the parser's token
 * positions, so `//` inside a string, a template or a regex literal is never
 * read as a comment.
 */
export function commentsOf(file: string, source: string): SourceComment[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ranges = new Map<number, ts.CommentRange>();
  const collect = (list: readonly ts.CommentRange[] | undefined): void => {
    for (const range of list ?? []) ranges.set(range.pos, range);
  };
  const visit = (node: ts.Node): void => {
    collect(ts.getLeadingCommentRanges(source, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(source, node.getEnd()));
    for (const child of node.getChildren(sourceFile)) visit(child);
  };
  visit(sourceFile);
  return [...ranges.values()]
    .sort((a, b) => a.pos - b.pos)
    .map((range) => {
      const start = sourceFile.getLineAndCharacterOfPosition(range.pos);
      const lineStart = sourceFile.getPositionOfLineAndCharacter(start.line, 0);
      return {
        line: start.line + 1,
        endLine: sourceFile.getLineAndCharacterOfPosition(range.end).line + 1,
        kind: range.kind === ts.SyntaxKind.SingleLineCommentTrivia ? "line" : "block",
        ownLine: source.slice(lineStart, range.pos).trim() === "",
        raw: source.slice(range.pos, range.end),
      };
    });
}

/** A comment's lines without `//`, `/*`, `*` and `*\/`. */
export function commentLines(comment: SourceComment): string[] {
  return comment.raw
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:\/\/+|\/\*+|\*+(?!\/))/, "")
        .replace(/\*+\/\s*$/, "")
        .trim(),
    );
}

export function commentBlocks(comments: readonly SourceComment[]): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  let previous: SourceComment | undefined;
  for (const comment of comments) {
    const text = commentLines(comment).filter((line) => line !== "" && !ESLINT_DIRECTIVE.test(line));
    const continues =
      previous !== undefined &&
      comment.kind === "line" &&
      previous.kind === "line" &&
      comment.ownLine &&
      previous.ownLine &&
      comment.line === previous.endLine + 1;
    const last = blocks.at(-1);
    if (continues && last) {
      last.text.push(...text);
    } else {
      blocks.push({ line: comment.line, text });
    }
    previous = comment;
  }
  return blocks.filter((block) => block.text.length > 0);
}

/** `<file>: <label>` per item, with `#n` on a repeated label, so an allowlist survives line moves. */
export function numberedKeys(file: string, labels: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((label) => {
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return `${file}: ${label}${n > 1 ? ` #${n}` : ""}`;
  });
}
