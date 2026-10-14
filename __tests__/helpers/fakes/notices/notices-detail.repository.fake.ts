/**
 * In-memory NoticesDetailRepository over `docs`, with the real read's filter (pinned in
 * notices-detail.repository.spec.ts): the notice of that source and article number, unless soft-deleted.
 */
import type { NoticesDetailRepository } from "../../../../src/notices/detail/notices-detail.repository";
import type { NoticeDoc } from "../../../../src/notices/notices.document";
import type { PublicOf } from "../public-of";

export class FakeNoticesDetailRepository implements PublicOf<NoticesDetailRepository> {
  docs: NoticeDoc[] = [];

  async findNotice(sourceId: string, articleNo: number): Promise<NoticeDoc | null> {
    return this.docs.find((doc) => doc.sourceId === sourceId && doc.articleNo === articleNo && doc.isDeleted !== true) ?? null;
  }
}
