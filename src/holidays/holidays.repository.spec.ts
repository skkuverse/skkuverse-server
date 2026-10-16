/**
 * HolidaysRepository's driver calls on `public_holidays`, one document per
 * year keyed by the year: the read of every stored year, projected and
 * bounded (which FakeHolidaysRepository follows), and the upsert that
 * replaces one year's holidays and its fetch time, so a rerun converges.
 */
const toArray = jest.fn();
const find = jest.fn(() => ({ toArray }));
const updateOne = jest.fn();
const mongoCollection = jest.fn(() => ({ find, updateOne }));

jest.mock("../infra/mongo", () => ({
  ...jest.requireActual("../infra/mongo"),
  mongoCollection: (...args: unknown[]) => mongoCollection(...(args as [])),
}));

import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { HolidaysRepository } from "./holidays.repository";

const FETCHED_AT = new Date("2026-10-16T03:00:00Z");
const YEAR_2026 = {
  _id: 2026,
  holidays: [
    { date: "2026-03-02", name: "대체공휴일(삼일절)" },
    { date: "2026-06-03", name: "전국동시지방선거" },
  ],
  fetchedAt: FETCHED_AT,
};

beforeEach(() => {
  jest.clearAllMocks();
  toArray.mockResolvedValue([]);
  updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 0, upsertedCount: 1 });
});

describe("HolidaysRepository.listYears", () => {
  it("reads every stored year from public_holidays, projected and bounded", async () => {
    // Arrange
    toArray.mockResolvedValue([YEAR_2026]);

    // Act
    const years = await new HolidaysRepository().listYears();

    // Assert
    expect(years).toEqual([YEAR_2026]);
    expect(mongoCollection).toHaveBeenCalledWith(config.mongo.dbName, "public_holidays");
    expect(find).toHaveBeenCalledWith({}, { projection: { _id: 1, holidays: 1, fetchedAt: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });
});

describe("HolidaysRepository.upsertYear", () => {
  it("replaces one year's holidays and fetch time, keyed by the year, inserting the year when it is new", async () => {
    // Act
    await new HolidaysRepository().upsertYear(2026, YEAR_2026.holidays, FETCHED_AT);

    // Assert
    expect(mongoCollection).toHaveBeenCalledWith(config.mongo.dbName, "public_holidays");
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 2026 },
      { $set: { holidays: YEAR_2026.holidays, fetchedAt: FETCHED_AT } },
      { upsert: true },
    );
  });

  it("rejects when the write fails, so the sync reports it", async () => {
    // Arrange
    updateOne.mockRejectedValue(new Error("write concern timeout"));

    // Act & Assert
    await expect(new HolidaysRepository().upsertYear(2026, YEAR_2026.holidays, FETCHED_AT)).rejects.toThrow("write concern timeout");
  });
});
