/**
 * NoticesRowService.renderRows: the door the list flow hands a page of stored notices to. It parses each notice's facts
 * through NoticesFactsService, renders every row at the one `now` the caller's Clock gave, and pairs each notice with its
 * row, or with null when the notice has no facts or facts the schema refuses. The words are notices-row.rules.spec.ts's.
 *
 * src/infra/logger.ts is mocked: the refused record logs `notices.facts.unparsed`.
 */
import fs from "fs";
import path from "path";
import { ObjectId } from "mongodb";
import type { Clock } from "../../infra/clock";

jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { NoticesFactsService } from "../facts/notices-facts.service";
import { NoticesRowService } from "./notices-row.service";
import type { RowNotice } from "./notices-row.types";

const CASE = path.join(__dirname, "../../../__tests__/nest/notices/fixtures/facts-rows/a_deadline_tomorrow_reads_as_one_while_the_window_is_open.json");
const RECORD = (JSON.parse(fs.readFileSync(CASE, "utf8")) as { record: Record<string, unknown> }).record;
const FIXED_CLOCK: Clock = { now: () => new Date("2026-10-28T03:00:00Z") };

const notice = (facts: unknown): RowNotice => ({ _id: new ObjectId(), title: "2026학년도 장학금 신청 안내", facts, factsHistory: [] });

describe("NoticesRowService.renderRows", () => {
  const service = new NoticesRowService(new NoticesFactsService(FIXED_CLOCK));

  it.each([
    ["23:59 KST, the day before the deadline", "2026-10-25T14:59:00Z", "내일 마감"],
    ["00:00 KST, the deadline day", "2026-10-25T15:00:00Z", "오늘"],
  ])("renders the page at the caller's moment: %s", (_label, instant, token) => {
    // Act
    const rendered = service.renderRows([notice(RECORD)], new Date(instant));

    // Assert
    expect(rendered.map(({ row }) => row?.token?.text)).toEqual([token]);
  });

  it("pairs each notice with its row, and with null when it has no facts or facts the schema refuses", () => {
    // Arrange
    const notices = [notice(RECORD), notice(undefined), notice({ ...RECORD, v: 2 })];

    // Act
    const rendered = service.renderRows(notices, new Date("2026-10-25T03:00:00Z"));

    // Assert
    expect(rendered.map(({ notice: paired }) => paired)).toEqual(notices);
    expect(rendered.map(({ row }) => row?.line2 ?? null)).toEqual(["내일 마감", null, null]);
  });
});
