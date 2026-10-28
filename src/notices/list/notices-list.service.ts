import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { NoticesLegacyService } from "../legacy/notices-legacy.service";
import { noticesConfig } from "../notices.config";
import { clusterKeyOf } from "../notices.rules";
import { NoticesRowService } from "../row/notices-row.service";
import { CLUSTER_SCAN_FACTOR } from "./notices-list.constants";
import type { ClusterMember, NoticeListRow } from "./notices-list.document";
import { toItemRow, toListItem, toNoticePage, withDerivedBrief } from "./notices-list.mapper";
import { NoticesListRepository } from "./notices-list.repository";
import { hasSeveralSources, selectShownRows } from "./notices-list.rules";
import type { NoticeListQuery, NoticeScope } from "./notices-list.types";
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
    const page = toNoticePage(isSeveralSources ? await this.listShownRows(scope, query) : await this.repository.listNotices(scope, query), query.limit);
    const now = this.clock.now();
    const options = { now, boardNameById: isSeveralSources ? this.boardNameById : null };
    const notices = this.rows
      .renderRows(page.items, now)
      .map(({ notice, row }) => ({ notice, row, derived: this.legacy.deriveBrief(notice, now) }))
      .filter(({ notice, derived }) => !query.type || notice.summaryAt || derived?.type === query.type)
      .map(({ notice, row, derived }) => withDerivedBrief(toListItem(notice, now, row && toItemRow(row, notice, options)), derived));
    return { notices, nextCursor: page.nextCursor, hasMore: page.hasMore };
  }

  // WHY: copies drop out of a scan, so it reads past the page until `limit + 1` rows are shown; the next scan starts
  // after the last row scanned, and a cluster decided in an earlier scan is not looked up again.
  private async listShownRows(scope: NoticeScope, query: NoticeListQuery): Promise<NoticeListRow[]> {
    const shownRows: NoticeListRow[] = [];
    const members: ClusterMember[] = [];
    const scan = { ...query, limit: CLUSTER_SCAN_FACTOR * (query.limit + 1) - 1 };
    for (let cursor = query.cursor; ; ) {
      const batch = await this.repository.listNotices(scope, { ...scan, cursor });
      const decidedKeys = new Set(members.map(clusterKeyOf));
      const keys = [...new Set(batch.map(clusterKeyOf))].filter((key) => !decidedKeys.has(key));
      const lookup = { keys, scannedIds: batch.map((row) => row._id) };
      members.push(...batch, ...(keys.length === 0 ? [] : await this.repository.listClusterMembers(scope, query, lookup)));
      shownRows.push(...selectShownRows(batch, members));
      const last = batch.at(-1);
      if (!last || shownRows.length > query.limit || batch.length <= scan.limit) return shownRows;
      cursor = { d: last.date, i: last._id.toHexString() };
    }
  }
}
