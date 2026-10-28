/**
 * NoticesLegacyService over the real row service: a notice with facts and no summary gets a derived brief at the
 * clock's moment, and a notice with a summary of its own, with no facts or with facts the schema refuses gets none.
 *
 * src/infra/logger.ts is mocked: a refused record logs `notices.facts.unparsed`.
 */
import { ObjectId } from "mongodb";

jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { goldenRecord } from "../../../__tests__/helpers/notices/facts-records";
import { NoticesFactsService } from "../facts/notices-facts.service";
import { NoticesRowService } from "../row/notices-row.service";
import { NoticesLegacyService } from "./notices-legacy.service";

const NOW = new Date("2026-10-25T03:00:00Z");
const RECORD = goldenRecord("a_deadline_tomorrow_reads_as_one_while_the_window_is_open");
const service = new NoticesLegacyService(new NoticesRowService(new NoticesFactsService({ now: () => NOW })));

const notice = (extra: Record<string, unknown> = {}) => ({ _id: new ObjectId(), title: "제목", ...extra });

describe("NoticesLegacyService.deriveBrief", () => {
  it("derives the brief of a notice with facts and no summary", () => {
    // Act
    const brief = service.deriveBrief(notice({ facts: RECORD }), NOW);

    // Assert
    expect(brief).toMatchObject({ oneLiner: "내일 마감", type: "action_required", endAt: { date: "2026-10-26" } });
  });

  it("derives nothing for a notice that has a summary, though it has facts", () => {
    // Act & Assert
    expect(service.deriveBrief(notice({ facts: RECORD, summaryAt: new Date("2026-10-13T00:00:00Z") }), NOW)).toBeNull();
  });

  it("derives nothing for a notice with no facts or with facts the schema refuses", () => {
    // Act & Assert
    expect(service.deriveBrief(notice(), NOW)).toBeNull();
    expect(service.deriveBrief(notice({ facts: { ...RECORD, v: 2 } }), NOW)).toBeNull();
  });
});
