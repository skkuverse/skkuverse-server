/**
 * NoticesDetailService over FakeNoticesDetailRepository: a stored notice comes back as its detail, a missing
 * or soft-deleted one as null, which the controller answers with 404.
 */
import { ObjectId } from "mongodb";
import { FakeNoticesDetailRepository } from "../../../__tests__/helpers/fakes/notices/notices-detail.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { NoticeDoc } from "../notices.document";
import type { NoticesDetailRepository } from "./notices-detail.repository";
import { NoticesDetailService } from "./notices-detail.service";

const doc = (extra: Partial<NoticeDoc> = {}): NoticeDoc => ({
  _id: new ObjectId(),
  sourceId: "skku-notice02",
  articleNo: 1,
  title: "t",
  date: "2026-10-14",
  crawledAt: new Date("2026-10-14T00:00:00Z"),
  sourceUrl: "u",
  ...extra,
});

describe("NoticesDetailService.findNotice", () => {
  it("returns the stored notice's detail, and null for a missing or soft-deleted one", async () => {
    // Arrange
    const repository = new FakeNoticesDetailRepository();
    repository.docs = [doc(), doc({ articleNo: 2, isDeleted: true })];
    const service = new NoticesDetailService(asReal<NoticesDetailRepository>(repository));

    // Act
    const found = await Promise.all([service.findNotice("skku-notice02", 1), service.findNotice("skku-notice02", 2), service.findNotice("skku-notice02", 3)]);

    // Assert
    expect(found.map((detail) => detail?.articleNo ?? null)).toEqual([1, null, null]);
  });
});
