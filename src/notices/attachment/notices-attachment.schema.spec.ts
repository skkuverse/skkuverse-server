/**
 * The attachment route's query: a captured request passes, `url` is required and must parse as a URL (checked
 * before the host policy, which is the service's), and the optional fields are strings.
 */
import { attachmentRequest } from "./notices-attachment.schema";

const CAPTURED = {
  url: "http://bio.skku.edu/bbs/download.php?bo_table=N4&wr_id=352&no=0&page=3",
  referer: "http://bio.skku.edu/bbs/board.php?bo_table=N4&wr_id=352&page=3",
  mode: "download",
  name: "붙임1.hwp",
};

describe("attachmentRequest", () => {
  it("passes a captured request", () => {
    // Act & Assert
    expect(attachmentRequest.parse(CAPTURED)).toEqual(CAPTURED);
  });

  it.each([
    ["no url", {}, "url is required"],
    ["an empty url", { url: "" }, "url is required"],
    ["a repeated url", { url: ["https://www.skku.edu/a", "https://www.skku.edu/b"] }, "url is required"],
    ["a url that does not parse", { url: "::nope" }, "malformed url"],
  ])("fails %s with its message", (_label, query, message) => {
    // Act & Assert
    expect(attachmentRequest.safeParse(query).error?.issues[0]?.message).toBe(message);
  });

  it.each(["referer", "mode", "name"])("fails a repeated %s", (field) => {
    // Act & Assert
    expect(attachmentRequest.safeParse({ ...CAPTURED, [field]: ["a", "b"] }).success).toBe(false);
  });
});
