/**
 * CalendarHolidaySyncRepository's write to `public_holidays`, one document per year:
 * the upsert that replaces one year's holidays and its fetch time, keyed by the
 * year so a rerun converges, and a failed write rejecting so the sync reports
 * it. The read is calendar.repository.spec.ts's.
 */
const updateOne = jest.fn();
const mongoCollection = jest.fn(() => ({ updateOne }));

jest.mock("../../infra/mongo", () => ({
  ...jest.requireActual("../../infra/mongo"),
  mongoCollection: (...args: unknown[]) => mongoCollection(...(args as [])),
}));

import config from "../../infra/config";
import { CalendarHolidaySyncRepository } from "./calendar-holiday-sync.repository";

const FETCHED_AT = new Date("2026-10-16T03:00:00Z");
const HOLIDAYS = [
  { date: "2026-03-02", name: "대체공휴일(삼일절)" },
  { date: "2026-06-03", name: "전국동시지방선거" },
];

beforeEach(() => {
  jest.clearAllMocks();
  updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 0, upsertedCount: 1 });
});

describe("CalendarHolidaySyncRepository.upsertYear", () => {
  it("replaces one year's holidays and fetch time, keyed by the year, inserting the year when it is new", async () => {
    // Act
    await new CalendarHolidaySyncRepository().upsertYear(2026, HOLIDAYS, FETCHED_AT);

    // Assert
    expect(mongoCollection).toHaveBeenCalledWith(config.mongo.dbName, "public_holidays");
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledWith({ _id: 2026 }, { $set: { holidays: HOLIDAYS, fetchedAt: FETCHED_AT } }, { upsert: true });
  });

  it("rejects when the write fails, so the sync reports it", async () => {
    // Arrange
    updateOne.mockRejectedValue(new Error("write concern timeout"));

    // Act & Assert
    await expect(new CalendarHolidaySyncRepository().upsertYear(2026, HOLIDAYS, FETCHED_AT)).rejects.toThrow("write concern timeout");
  });
});
