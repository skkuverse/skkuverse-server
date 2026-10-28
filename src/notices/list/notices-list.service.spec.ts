/**
 * NoticesListService over FakeNoticesListRepository: a page of `limit` from the read of `limit + 1`, the list
 * items built at the clock's time, and the cursor of the last item served.
 *
 * Each item's `row` is rendered by the real NoticesRowService over the real NoticesFactsService, which are pure over
 * the clock: a notice with facts gets its row, one with none or with facts the schema refuses gets null, the board
 * name rides only on a multi-source read, and the whole page is rendered at the one instant the clock gave first.
 *
 * src/infra/logger.ts is mocked: a refused record logs `notices.facts.unparsed`.
 */
import fs from "fs";
import path from "path";
import { ObjectId } from "mongodb";
import type { Clock } from "../../infra/clock";

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

import { FakeNoticesListRepository } from "../../../__tests__/helpers/fakes/notices/notices-list.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { NoticesFactsService } from "../facts/notices-facts.service";
import { NoticesLegacyService } from "../legacy/notices-legacy.service";
import type { NoticeDoc } from "../notices.document";
import { NoticesRowService } from "../row/notices-row.service";
import type { NoticesListRepository } from "./notices-list.repository";
import { decodeCursor } from "./notices-list.rules";
import { NoticesListService } from "./notices-list.service";

const NOW = new Date("2026-10-14T03:00:00Z");
const clock: Clock = { now: () => NOW };

const CASE = path.join(__dirname, "../../../__tests__/nest/notices/fixtures/facts-rows/a_deadline_tomorrow_reads_as_one_while_the_window_is_open.json");
const RECORD = (JSON.parse(fs.readFileSync(CASE, "utf8")) as { record: Record<string, unknown> }).record;

const doc = (n: number, date: string, extra: Partial<NoticeDoc> = {}): NoticeDoc => ({
  _id: new ObjectId(n.toString(16).padStart(24, "0")),
  sourceId: "skku-notice02",
  articleNo: n,
  title: `t${n}`,
  date,
  crawledAt: new Date("2026-10-14T00:00:00Z"),
  sourceUrl: "u",
  ...extra,
});

function serviceAt(repository: FakeNoticesListRepository, listClock: Clock = clock): NoticesListService {
  const rows = new NoticesRowService(new NoticesFactsService(listClock));
  return new NoticesListService(asReal<NoticesListRepository>(repository), listClock, rows, new NoticesLegacyService(rows));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("NoticesListService.listNotices", () => {
  it("serves a page newest first with the cursor of its last item, and no cursor on the last page", async () => {
    // Arrange
    const repository = new FakeNoticesListRepository();
    repository.docs = [doc(1, "2026-10-12"), doc(2, "2026-10-13"), doc(3, "2026-10-14")];
    const service = serviceAt(repository);

    // Act
    const first = await service.listNotices("skku-notice02", { limit: 2, cursor: null });
    const second = await service.listNotices("skku-notice02", { limit: 2, cursor: decodeCursor(first.nextCursor) });

    // Assert
    expect(first.notices.map((n) => n.articleNo)).toEqual([3, 2]);
    expect(first.hasMore).toBe(true);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    expect(second.notices.map((n) => n.articleNo)).toEqual([1]);
  });

  it("renders the row of a notice with facts, and serves null for one with none or with facts the schema refuses", async () => {
    // Arrange
    const repository = new FakeNoticesListRepository();
    repository.docs = [
      doc(3, "2026-10-14", { facts: RECORD }),
      doc(2, "2026-10-13"),
      doc(1, "2026-10-12", { facts: { ...RECORD, v: 2 } }),
    ];
    const service = serviceAt(repository, { now: () => new Date("2026-10-25T03:00:00Z") });

    // Act
    const { notices } = await service.listNotices("skku-notice02", { limit: 10, cursor: null });

    // Assert
    expect(notices.map((n) => n.row?.when ?? null)).toEqual(["내일 마감", null, null]);
    expect(notices[0]?.row).toMatchObject({ token: { text: "내일 마감", tone: "urgent" }, urgent: true });
    expect(mockLogger.warn.mock.calls.map(([fields]) => (fields as { event: string; noticeId: string }).noticeId)).toEqual([
      doc(1, "")._id.toHexString(),
    ]);
  });

  it("leaves summary exactly as it was when the notice has a row", async () => {
    // Arrange
    const summaryFields = { summaryAt: new Date("2026-10-13T00:00:00Z"), summaryType: "action_required", summaryOneLiner: "한 줄", summaryPeriods: [{ label: "신청", endDate: "2026-10-26", endTime: "18:00" }] };
    const repository = new FakeNoticesListRepository();
    repository.docs = [doc(2, "2026-10-14", { ...summaryFields, facts: RECORD }), doc(1, "2026-10-13", summaryFields)];
    const service = serviceAt(repository, { now: () => new Date("2026-10-25T03:00:00Z") });

    // Act
    const { notices } = await service.listNotices("skku-notice02", { limit: 10, cursor: null });

    // Assert
    expect(notices[0]?.row).not.toBeNull();
    expect(notices[0]?.summary).toEqual(notices[1]?.summary);
    expect(notices[0]?.summary).toEqual({
      oneLiner: "한 줄",
      type: "action_required",
      startAt: null,
      endAt: { date: "2026-10-26", time: "18:00", label: "신청" },
    });
  });

  it("derives a rough summary from the row for a notice with facts and no summary, and leaves a notice without facts at null", async () => {
    // Arrange
    const repository = new FakeNoticesListRepository();
    repository.docs = [doc(2, "2026-10-14", { facts: RECORD }), doc(1, "2026-10-13")];
    const service = serviceAt(repository, { now: () => new Date("2026-10-25T03:00:00Z") });

    // Act
    const { notices } = await service.listNotices("skku-notice02", { limit: 10, cursor: null });

    // Assert
    expect(notices[0]?.summary).toMatchObject({ oneLiner: "내일 마감", type: "action_required", endAt: { date: "2026-10-26", time: null, label: null } });
    expect(notices[1]?.summary).toBeNull();
  });

  it("files a derived notice under its derived type and keeps stored ones under theirs", async () => {
    // Arrange
    const repository = new FakeNoticesListRepository();
    repository.docs = [doc(3, "2026-10-14", { facts: RECORD }), doc(2, "2026-10-13", { summaryAt: new Date("2026-10-13T00:00:00Z"), summaryType: "event", summaryOneLiner: "x" }), doc(1, "2026-10-12", { summaryAt: new Date("2026-10-13T00:00:00Z"), summaryType: "action_required", summaryOneLiner: "y" })];
    const service = serviceAt(repository, { now: () => new Date("2026-10-25T03:00:00Z") });

    // Act
    const deadlines = await service.listNotices("skku-notice02", { limit: 10, cursor: null, type: "action_required" });
    const events = await service.listNotices("skku-notice02", { limit: 10, cursor: null, type: "event" });

    // Assert
    expect(deadlines.notices.map((n) => n.articleNo)).toEqual([3, 1]);
    expect(events.notices.map((n) => n.articleNo)).toEqual([2]);
  });

  it("leaves a notice whose facts the schema refuses out of a typed read", async () => {
    // Arrange
    const repository = new FakeNoticesListRepository();
    repository.docs = [doc(1, "2026-10-14", { facts: { ...RECORD, v: 2 } })];
    const service = serviceAt(repository);

    // Act
    const page = await service.listNotices("skku-notice02", { limit: 10, cursor: null, type: "informational" });

    // Assert
    expect(page.notices).toEqual([]);
  });

  it("keeps the cursor of the last notice read when the type filter drops the end of the page", async () => {
    // Arrange
    const stored = { summaryAt: new Date("2026-10-13T00:00:00Z"), summaryOneLiner: "x" };
    const repository = new FakeNoticesListRepository();
    repository.docs = [doc(3, "2026-10-14", { ...stored, summaryType: "event" }), doc(2, "2026-10-13", { facts: RECORD }), doc(1, "2026-10-12", { ...stored, summaryType: "event" })];
    const service = serviceAt(repository, { now: () => new Date("2026-10-25T03:00:00Z") });

    // Act
    const page = await service.listNotices("skku-notice02", { limit: 2, cursor: null, type: "event" });

    // Assert
    expect(page.notices.map((n) => n.articleNo)).toEqual([3]);
    expect(page.hasMore).toBe(true);
    expect(decodeCursor(page.nextCursor).i).toBe(doc(2, "")._id.toHexString());
  });

  it("names the board only on a read of two or more sources, as umbrella ADR 0009 adds it for a tab of several boards", async () => {
    // Arrange
    const repository = new FakeNoticesListRepository();
    repository.docs = [doc(1, "2026-10-14", { facts: RECORD })];
    const service = serviceAt(repository, { now: () => new Date("2026-10-25T03:00:00Z") });

    // Act
    const single = await service.listNotices("skku-notice02", { limit: 10, cursor: null });
    const multi = await service.listNotices(["skku-notice02", "health"], { limit: 10, cursor: null });
    const multiOfOne = await service.listNotices(["skku-notice02"], { limit: 10, cursor: null });
    const oneTwice = await service.listNotices(["skku-notice02", "skku-notice02"], { limit: 10, cursor: null });

    // Assert
    expect(single.notices[0]?.row?.board).toBeNull();
    expect(multi.notices[0]?.row?.board).toBe("성균관대_통합(학사)");
    expect(multiOfOne.notices[0]?.row?.board).toBeNull();
    expect(oneTwice.notices[0]?.row?.board).toBeNull();
  });

  it("renders every row and the day groups at the one instant the clock gave first, though it moves past KST midnight", async () => {
    // Arrange
    const instants = [new Date("2026-10-25T14:59:59Z"), new Date("2026-10-25T15:00:01Z")];
    const readClock: Clock = { now: jest.fn(() => instants.shift() ?? new Date("2026-10-25T15:00:01Z")) };
    const repository = new FakeNoticesListRepository();
    repository.docs = [doc(1, "2026-10-25", { facts: RECORD })];
    const service = serviceAt(repository, readClock);

    // Act
    const { notices } = await service.listNotices("skku-notice02", { limit: 10, cursor: null });

    // Assert
    expect(notices[0]?.row).toMatchObject({ token: { text: "내일 마감" }, day: "today" });
    expect(readClock.now).toHaveBeenCalledTimes(1);
  });
});
