/**
 * NoticesDetailRepository's driver call: one source's notice by article number, unless soft-deleted, with the
 * detail projection and the hot-read bound (which FakeNoticesDetailRepository follows).
 */
const findOne = jest.fn((..._args: unknown[]) => Promise.resolve(null));

jest.mock("../../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: jest.requireActual("../../infra/db").HOT_READ_MAX_TIME_MS,
  getClient: () => ({ db: () => ({ collection: () => ({ findOne }) }) }),
}));

import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { DETAIL_PROJECTION } from "./notices-detail.query";
import { NoticesDetailRepository } from "./notices-detail.repository";

describe("NoticesDetailRepository.findNotice", () => {
  it("reads the notice by source and numeric article number, leaving out a soft-deleted one", async () => {
    // Act
    const doc = await new NoticesDetailRepository().findNotice("skku-notice02", 140482);

    // Assert
    expect(doc).toBeNull();
    expect(findOne.mock.calls[0]).toEqual([
      { sourceId: "skku-notice02", articleNo: 140482, isDeleted: { $ne: true } },
      { projection: DETAIL_PROJECTION, maxTimeMS: HOT_READ_MAX_TIME_MS },
    ]);
  });

  it("projects the Markdown body only, never the HTML or plain-text bodies or the hashes", () => {
    // Assert
    expect(Object.keys(DETAIL_PROJECTION)).toContain("cleanMarkdown");
    expect(Object.keys(DETAIL_PROJECTION).filter((key) => ["content", "cleanHtml", "contentText", "contentHash", "isDeleted"].includes(key))).toEqual([]);
  });
});
