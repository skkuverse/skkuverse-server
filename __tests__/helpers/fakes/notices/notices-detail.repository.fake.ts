/**
 * In-memory NoticesDetailRepository over `docs`, with the real read's filter (pinned in
 * notices-detail.repository.spec.ts): the notice of that source and article number, unless soft-deleted, with only
 * the fields of DETAIL_PROJECTION.
 */
import { DETAIL_PROJECTION } from "../../../../src/notices/detail/notices-detail.query";
import type { NoticesDetailRepository } from "../../../../src/notices/detail/notices-detail.repository";
import type { NoticeDoc } from "../../../../src/notices/notices.document";
import type { PublicOf } from "../public-of";

/** An inclusion projection: only the listed fields that the document has. */
const project = (doc: NoticeDoc, projection: Readonly<Record<string, 1>>): NoticeDoc =>
  Object.fromEntries(Object.keys(projection).filter((f) => Object.hasOwn(doc, f)).map((f) => [f, doc[f as keyof NoticeDoc]])) as unknown as NoticeDoc;

export class FakeNoticesDetailRepository implements PublicOf<NoticesDetailRepository> {
  docs: NoticeDoc[] = [];

  async findNotice(sourceId: string, articleNo: number): Promise<NoticeDoc | null> {
    const doc = this.docs.find((stored) => stored.sourceId === sourceId && stored.articleNo === articleNo && stored.isDeleted !== true);
    return doc ? project(doc, DETAIL_PROJECTION) : null;
  }
}
