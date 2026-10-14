/**
 * The detail route's input: the source is checked before the article number, which must be all digits and is
 * read as a number.
 */
import { noticeDetailRequest } from "./notices-detail.schema";

describe("noticeDetailRequest", () => {
  it("reads the article number as a number", () => {
    // Act & Assert
    expect(noticeDetailRequest.parse({ sourceId: "skku-notice02", articleNo: "00140482" })).toEqual({ sourceId: "skku-notice02", articleNo: 140482 });
  });

  it.each([
    [{ sourceId: "nope", articleNo: "abc" }, ["sourceId", "unknown sourceId: nope"]],
    [{ sourceId: "skku-notice02", articleNo: "12a" }, ["articleNo", "articleNo must be numeric"]],
    [{ sourceId: "skku-notice02", articleNo: "-1" }, ["articleNo", "articleNo must be numeric"]],
  ])("reports %j as %j", (input, issue) => {
    // Act
    const first = noticeDetailRequest.safeParse(input).error?.issues[0];

    // Assert
    expect([first?.path.join("."), first?.message]).toEqual(issue);
  });
});
