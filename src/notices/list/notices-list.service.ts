import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { NoticesLegacyService } from "../legacy/notices-legacy.service";
import { noticesConfig } from "../notices.config";
import { clusterKeyOf } from "../notices.rules";
import { NoticesRowService } from "../row/notices-row.service";
import { CLUSTER_SCAN_FACTOR } from "./notices-list.constants";
import type { ScannedRow } from "./notices-list.document";
import { toItemRow, toListItem, toNextPage, toNoticePage, withDerivedBrief } from "./notices-list.mapper";
import { NoticesListRepository } from "./notices-list.repository";
import { hasSeveralSources, selectShownRows } from "./notices-list.rules";
import type { NoticeListQuery, NoticePage, NoticeScope } from "./notices-list.types";
import type { NoticeList } from "./notices-list.wire";

@Injectable()
export class NoticesListService {
  private readonly boardNameById = new Map(noticesConfig.sources.map((source) => [source.id, source.name]));

  constructor(
    private readonly repository: NoticesListRepository,
    private readonly clock: Clock,
    private readonly rows: NoticesRowService,
    private readonly legacy: NoticesLegacyService,
  ) {}

  async listNotices(scope: NoticeScope, query: NoticeListQuery): Promise<NoticeList> {
    const isSeveralSources = hasSeveralSources(scope);
    const page = isSeveralSources ? await this.listShownPage(scope, query) : toNoticePage(await this.repository.listNotices(scope, query), query.limit);
    const now = this.clock.now();
    const options = { now, boardNameById: isSeveralSources ? this.boardNameById : null };
    const notices = this.rows
      .renderRows(page.items, now)
      .map(({ notice, row }) => ({ notice, row, derived: this.legacy.deriveBrief(notice, now) }))
      .filter(({ notice, derived }) => !query.type || notice.summaryAt || derived?.type === query.type)
      .map(({ notice, row, derived }) => withDerivedBrief(toListItem(notice, now, row && toItemRow(row, notice, options)), derived));
    return { notices, nextCursor: page.nextCursor, hasMore: page.hasMore };
  }

  private async listShownPage(scope: NoticeScope, query: NoticeListQuery): Promise<NoticePage> {
    const shownRows = await this.scanShownRows(scope, query);
    const servedRows = shownRows.slice(0, query.limit);
    const items = await this.repository.listNoticesByIds(servedRows.map((row) => row._id));
    return { items, ...toNextPage(shownRows.length > query.limit ? servedRows.at(-1) : undefined) };
  }

  // WHY: copies drop out of a scan, so it reads past the page until `limit + 1` rows are shown; the next scan starts
  // after the last row scanned, and only a cluster no earlier scan held is looked up before the cursor.
  private async scanShownRows(scope: NoticeScope, query: NoticeListQuery): Promise<ScannedRow[]> {
    const shownRows: ScannedRow[] = [];
    const decidedKeys = new Set<string>();
    const scanSize = CLUSTER_SCAN_FACTOR * (query.limit + 1);
    for (let cursor = query.cursor; ; ) {
      const batch = await this.repository.listScannedRows(scope, { ...query, cursor }, scanSize);
      const keys = [...new Set(batch.map(clusterKeyOf))].filter((key) => !decidedKeys.has(key));
      const servedCopies = query.cursor && keys.length > 0 ? await this.repository.listClusterMembers(scope, query, { keys, cursor: query.cursor }) : [];
      for (const copy of servedCopies) decidedKeys.add(clusterKeyOf(copy));
      shownRows.push(...selectShownRows(batch, decidedKeys));
      for (const row of batch) decidedKeys.add(clusterKeyOf(row));
      const last = batch.at(-1);
      if (!last || shownRows.length > query.limit || batch.length < scanSize) return shownRows;
      cursor = { d: last.date, i: last._id.toHexString() };
    }
  }
}
