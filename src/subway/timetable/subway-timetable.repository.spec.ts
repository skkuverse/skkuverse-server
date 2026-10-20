/**
 * SubwayTimetableRepository: the reads of the stored `subway-timetables` dataset, which `npm run data` writes as a
 * header manifest and one `dataset_parts` document per table, and the server only parses (ADR 0013, D1 and D6;
 * move-reference-datasets D4 and D7).
 *
 * The query objects are pinned here, since FakeSubwayTimetableRepository copies them: the header by `_id` on the
 * content database's `datasets`, projecting the revision and each part's key and id; a table by its part id on
 * `dataset_parts`, projecting its data; both bounded by `maxTimeMS`. A missing or invalid header and a missing or
 * invalid table read as `null`, each logged at error at most once a minute (a table with the revision and the key
 * that named it), so the readers keep their last good copy or answer 503. A failed read rejects as
 * SubwayTimetablesReadError.
 *
 * src/infra/db.ts (whose client src/infra/mongo.ts opens collections on) and src/infra/logger.ts are mocked.
 */
const findOne = jest.fn();
const openedCollections: Array<{ dbName: string; name: string }> = [];

jest.mock("../../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: jest.requireActual("../../infra/db").HOT_READ_MAX_TIME_MS,
  getClient: jest.fn(() => ({
    db: (dbName: string) => ({
      collection: (name: string) => {
        openedCollections.push({ dbName, name });
        return { findOne };
      },
    }),
  })),
}));

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

import { logText } from "../../../__tests__/helpers/log-text";
import { subwayTimetablesFixture } from "../../../__tests__/helpers/subway/timetables";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { SubwayTimetableRepository } from "./subway-timetable.repository";

const NOW = new Date("2026-10-20T03:00:00.000Z");
const LOG_INTERVAL_MS = 60_000;
const KR_1_WEEKDAY = { key: "KR-1-weekday", partId: "subway-timetables/KR-1-weekday@0123456789abcdef" };
const table = () => subwayTimetablesFixture().find((t) => t.line === "1" && t.dayType === "weekday")!;
const header = (revision: unknown) => ({
  _id: "subway-timetables",
  revision,
  data: { parts: [{ ...KR_1_WEEKDAY, summary: { source: table().source, trainCount: table().trains.length } }] },
});

afterEach(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  findOne.mockReset();
  openedCollections.length = 0;
  jest.clearAllMocks();
});

describe("SubwayTimetableRepository.findManifest", () => {
  it("reads the header by _id from the content database's datasets, projecting the revision and each part's key and id, bounded", async () => {
    // Arrange
    findOne.mockResolvedValue(header(4));

    // Act
    await new SubwayTimetableRepository().findManifest();

    // Assert
    expect(openedCollections).toEqual([{ dbName: config.content.dbName, name: config.content.collections.datasets }]);
    expect(findOne).toHaveBeenCalledWith(
      { _id: "subway-timetables" },
      { projection: { revision: 1, "data.parts.key": 1, "data.parts.partId": 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
    );
  });

  it("returns the revision and each table's key and part id", async () => {
    // Arrange
    findOne.mockResolvedValue(header(4));

    // Act
    const manifest = await new SubwayTimetableRepository().findManifest();

    // Assert
    expect(manifest).toEqual({ revision: 4, data: { parts: [KR_1_WEEKDAY] } });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("returns null for a missing header, logged at error as subway.timetables.missing", async () => {
    // Arrange
    findOne.mockResolvedValue(null);

    // Act
    const manifest = await new SubwayTimetableRepository().findManifest();

    // Assert
    expect(manifest).toBeNull();
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([expect.objectContaining({ event: "subway.timetables.missing", dataset: "subway-timetables" })]);
  });

  it("returns null for a header without parts, logged at error as subway.timetables.invalid with its revision and issues", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "subway-timetables", revision: 5, data: {} });

    // Act
    const manifest = await new SubwayTimetableRepository().findManifest();

    // Assert
    expect(manifest).toBeNull();
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "subway.timetables.invalid", dataset: "subway-timetables", revision: 5 });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/data\.parts: /);
  });

  it("rejects a failing read as SubwayTimetablesReadError, carrying the driver's error as its cause", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    findOne.mockRejectedValue(failure);

    // Act & Assert
    await expect(new SubwayTimetableRepository().findManifest()).rejects.toMatchObject({ name: "SubwayTimetablesReadError", cause: failure });
  });

  it("logs a missing header at most once a minute, then with the lines it held back", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const repository = new SubwayTimetableRepository();
    findOne.mockResolvedValue(null);

    // Act
    for (let read = 0; read < 3; read++) await repository.findManifest();
    jest.setSystemTime(NOW.getTime() + LOG_INTERVAL_MS);
    await repository.findManifest();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "subway.timetables.missing", suppressed: 0 }),
      expect.objectContaining({ event: "subway.timetables.missing", suppressed: 2 }),
    ]);
  });
});

describe("SubwayTimetableRepository.findTable", () => {
  it("reads one part by its id from the content database's dataset_parts, projecting its data, bounded", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: KR_1_WEEKDAY.partId, data: table() });

    // Act
    await new SubwayTimetableRepository().findTable(KR_1_WEEKDAY, 4);

    // Assert
    expect(openedCollections).toEqual([{ dbName: config.content.dbName, name: "dataset_parts" }]);
    expect(findOne).toHaveBeenCalledWith({ _id: KR_1_WEEKDAY.partId }, { projection: { data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("returns the table as the server's schema parses it", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: KR_1_WEEKDAY.partId, data: table() });

    // Act
    const found = await new SubwayTimetableRepository().findTable(KR_1_WEEKDAY, 4);

    // Assert
    expect(found).toEqual(table());
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("returns null for a missing part, logged at error as subway.timetables.part_missing with the revision and key", async () => {
    // Arrange
    findOne.mockResolvedValue(null);

    // Act
    const found = await new SubwayTimetableRepository().findTable(KR_1_WEEKDAY, 4);

    // Assert
    expect(found).toBeNull();
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "subway.timetables.part_missing", revision: 4, key: "KR-1-weekday", partId: KR_1_WEEKDAY.partId }),
    ]);
  });

  it("returns null for a part that fails the schema, logged at error as subway.timetables.part_invalid with the revision, key and issues", async () => {
    // Arrange
    const malformed = table();
    findOne.mockResolvedValue({ _id: KR_1_WEEKDAY.partId, data: { ...malformed, trains: [{ ...malformed.trains[0], trainNo: "K602" }] } });

    // Act
    const found = await new SubwayTimetableRepository().findTable(KR_1_WEEKDAY, 4);

    // Assert
    expect(found).toBeNull();
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "subway.timetables.part_invalid", revision: 4, key: "KR-1-weekday" });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/trains\.0\.trainNo: /);
  });

  it("rejects a failing read as SubwayTimetablesReadError, carrying the driver's error as its cause", async () => {
    // Arrange
    const failure = new Error("operation exceeded time limit");
    findOne.mockRejectedValue(failure);

    // Act & Assert
    await expect(new SubwayTimetableRepository().findTable(KR_1_WEEKDAY, 4)).rejects.toMatchObject({ name: "SubwayTimetablesReadError", cause: failure });
  });

  it("logs a missing part at most once a minute per part, and another part at once", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const repository = new SubwayTimetableRepository();
    findOne.mockResolvedValue(null);
    const other = { key: "S1-4-weekday", partId: "subway-timetables/S1-4-weekday@fedcba9876543210" };

    // Act
    for (let read = 0; read < 3; read++) await repository.findTable(KR_1_WEEKDAY, 4);
    await repository.findTable(other, 4);

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => [fields.key, fields.suppressed])).toEqual([
      ["KR-1-weekday", 0],
      ["S1-4-weekday", 0],
    ]);
  });
});
