/**
 * In-memory NoticesListRepository over `docs`, with the real read's filter, sort and limit (pinned in
 * notices-list.repository.spec.ts and, over a real mongod, notices-characterization.routes.test.ts): the
 * scope's sources, not deleted, on or after the service start date, the type, the cursor and the search text,
 * newest first by (date, _id), and one more than the limit.
 */
import config from "../../../../src/infra/config";
import type { NoticesListRepository } from "../../../../src/notices/list/notices-list.repository";
import type { NoticeListQuery, NoticeScope } from "../../../../src/notices/list/notices-list.types";
import type { NoticeDoc } from "../../../../src/notices/notices.document";
import type { PublicOf } from "../public-of";

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// WHY: Mongo orders strings by code unit, not locale, and stored dates mix "YYYY-MM-DD" with "YYYY-MM-DD HH:mm".
const newestFirst = (a: NoticeDoc, b: NoticeDoc): number =>
  byCodeUnit(b.date, a.date) || byCodeUnit(b._id.toHexString(), a._id.toHexString());

export class FakeNoticesListRepository implements PublicOf<NoticesListRepository> {
  docs: NoticeDoc[] = [];

  async onModuleInit(): Promise<void> {}

  async listNotices(scope: NoticeScope, query: NoticeListQuery): Promise<NoticeDoc[]> {
    const sources = typeof scope === "string" ? [scope] : scope;
    return this.docs
      .filter((doc) => sources.includes(doc.sourceId) && doc.isDeleted !== true && doc.date >= config.notices.serviceStartDate)
      .filter((doc) => !query.type || doc.summaryType === query.type)
      .filter((doc) => !query.cursor || this.isAfterCursor(doc, query.cursor.d, query.cursor.i))
      .filter((doc) => !query.q || this.matchesSearch(doc, query.q))
      .sort(newestFirst)
      .slice(0, query.limit + 1);
  }

  private isAfterCursor(doc: NoticeDoc, date: string, id: string): boolean {
    return doc.date < date || (doc.date === date && doc._id.toHexString() < id.toLowerCase());
  }

  private matchesSearch(doc: NoticeDoc, searchText: string): boolean {
    const needle = searchText.toLowerCase();
    return [doc.title, doc.summaryOneLiner].some((text) => typeof text === "string" && text.toLowerCase().includes(needle));
  }
}
