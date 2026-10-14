/**
 * NoticesListService over FakeNoticesListRepository: a page of `limit` from the read of `limit + 1`, the list
 * items built at the clock's time, and the cursor of the last item served.
 */
import { ObjectId } from "mongodb";
import { FakeNoticesListRepository } from "../../../__tests__/helpers/fakes/notices/notices-list.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../infra/clock";
import type { NoticeDoc } from "../notices.document";
import type { NoticesListRepository } from "./notices-list.repository";
import { decodeCursor } from "./notices-list.rules";
import { NoticesListService } from "./notices-list.service";

const NOW = new Date("2026-10-14T03:00:00Z");
const clock: Clock = { now: () => NOW };

const doc = (n: number, date: string): NoticeDoc => ({
  _id: new ObjectId(n.toString(16).padStart(24, "0")),
  sourceId: "skku-notice02",
  articleNo: n,
  title: `t${n}`,
  date,
  crawledAt: new Date("2026-10-14T00:00:00Z"),
  sourceUrl: "u",
});

describe("NoticesListService.listNotices", () => {
  it("serves a page newest first with the cursor of its last item, and no cursor on the last page", async () => {
    // Arrange
    const repository = new FakeNoticesListRepository();
    repository.docs = [doc(1, "2026-10-12"), doc(2, "2026-10-13"), doc(3, "2026-10-14")];
    const service = new NoticesListService(asReal<NoticesListRepository>(repository), clock);

    // Act
    const first = await service.listNotices("skku-notice02", { limit: 2, cursor: null });
    const second = await service.listNotices("skku-notice02", { limit: 2, cursor: decodeCursor(first.nextCursor) });

    // Assert
    expect(first.notices.map((n) => n.articleNo)).toEqual([3, 2]);
    expect(first.hasMore).toBe(true);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    expect(second.notices.map((n) => n.articleNo)).toEqual([1]);
  });
});
