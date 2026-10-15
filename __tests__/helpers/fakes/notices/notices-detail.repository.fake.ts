/**
 * In-memory NoticesDetailRepository over `docs`, with the real read's filter (pinned in
 * notices-detail.repository.spec.ts): the notice of that source and article number, unless soft-deleted, with only
 * the fields of DETAIL_PROJECTION.
 */
import type { NoticeDetailRow } from "../../../../src/notices/detail/notices-detail.document";
import { DETAIL_PROJECTION } from "../../../../src/notices/detail/notices-detail.query";
import type { NoticesDetailRepository } from "../../../../src/notices/detail/notices-detail.repository";
import type { NoticeDoc } from "../../../../src/notices/notices.document";
import type { PublicOf } from "../public-of";

/** An inclusion projection: only the listed fields that the document has. */
const project = (doc: NoticeDoc): NoticeDetailRow =>
  Object.fromEntries(Object.keys(DETAIL_PROJECTION).filter((f) => Object.hasOwn(doc, f)).map((f) => [f, doc[f as keyof NoticeDoc]])) as unknown as NoticeDetailRow;

export class FakeNoticesDetailRepository implements PublicOf<NoticesDetailRepository> {
  docs: NoticeDoc[] = [];

  async findNotice(sourceId: string, articleNo: number): Promise<NoticeDetailRow | null> {
    const doc = this.docs.find((stored) => stored.sourceId === sourceId && stored.articleNo === articleNo && stored.isDeleted !== true);
    return doc ? project(doc) : null;
  }
}
