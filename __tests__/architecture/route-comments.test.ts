/**
 * A controller does not restate its routes in comments (ADR 0010, D10): the
 * `@Controller` path and the method decorator already say `GET /building/list`,
 * and a copy in a comment is the one that goes stale.
 */
import { commentLines, commentsOf, numberedKeys } from "../helpers/architecture/comments";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

const ROUTE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S*)/;

/** `<file>: <METHOD> <path>` for each comment line that opens with a route, `#n` on a repeat. */
export function routeCommentViolations(file: string, source: string): string[] {
  const routes = commentsOf(file, source).flatMap((comment) =>
    commentLines(comment).flatMap((line) => {
      const match = ROUTE.exec(line);
      return match ? [`${match[1]} ${match[2]!.replace(/[.,:;]+$/, "")}`] : [];
    }),
  );
  return numberedKeys(file, routes);
}

describe("route comment rule applies as specified", () => {
  it("finds a route at the start of a comment line", () => {
    const source = [
      "// GET /building/list?campus=hssc",
      "/**",
      " * POST /ad/events. Records one event.",
      " */",
      "// The handler behind GET /building/list.",
      "// GETS no route here",
    ].join("\n");
    expect(routeCommentViolations("src/x/x.controller.ts", source)).toEqual([
      "src/x/x.controller.ts: GET /building/list?campus=hssc",
      "src/x/x.controller.ts: POST /ad/events",
    ]);
  });
});

describe("route comments", () => {
  it("are not written in controllers: the decorators state the route", () => {
    expectAllowlisted(
      "route-comments",
      sourceFiles()
        .filter((f) => f.endsWith(".controller.ts"))
        .flatMap((f) => routeCommentViolations(f, readSource(f))),
    );
  });
});
