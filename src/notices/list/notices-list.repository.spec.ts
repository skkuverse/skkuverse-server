/**
 * NoticesListRepository's driver calls: the list read's filter, projection, sort, index hint and limit (which
 * FakeNoticesListRepository follows), and the boot index the hint names. These pin the query objects; what they
 * match against real documents is notices-characterization.routes.test.ts over a real mongod.
 */
const limit = jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) }));
const hint = jest.fn(() => ({ limit }));
const sort = jest.fn(() => ({ hint }));
const find = jest.fn((..._args: unknown[]) => ({ sort }));
const createIndex = jest.fn((..._args: unknown[]) => Promise.resolve("ok"));

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

jest.mock("../../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: jest.requireActual("../../infra/db").HOT_READ_MAX_TIME_MS,
  getClient: () => ({ db: () => ({ collection: () => ({ find, createIndex }) }) }),
}));

import { ObjectId } from "mongodb";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { FORCE_INDEX, LIST_PROJECTION } from "./notices-list.query";
import { NoticesListRepository } from "./notices-list.repository";

const START = "2026-03-09";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("NoticesListRepository.listNotices", () => {
  it("reads one source's undeleted notices from the start date, newest first, hinted, one past the limit", async () => {
    // Act
    await new NoticesListRepository().listNotices("skku-notice02", { limit: 20, cursor: null });

    // Assert
    expect(find.mock.calls[0]).toEqual([
      { sourceId: "skku-notice02", isDeleted: { $ne: true }, $and: [{ date: { $gte: START } }] },
      { projection: LIST_PROJECTION, maxTimeMS: HOT_READ_MAX_TIME_MS },
    ]);
    expect(sort).toHaveBeenCalledWith({ date: -1, _id: -1 });
    expect(hint).toHaveBeenCalledWith({ sourceId: 1, date: -1, _id: -1 });
    expect(limit).toHaveBeenCalledWith(21);
  });

  it("reads several sources with $in, and adds the type, the cursor and an escaped case-insensitive search", async () => {
    // Arrange
    const cursor = { d: "2026-04-01", i: "66a1b2c3d4e5f6a7b8c9d0e1" };

    // Act
    await new NoticesListRepository().listNotices(["a", "b"], { limit: 5, type: "event", cursor, q: "a.b" });

    // Assert
    expect(find.mock.calls[0]?.[0]).toEqual({
      sourceId: { $in: ["a", "b"] },
      isDeleted: { $ne: true },
      $and: [
        { date: { $gte: START } },
        { $or: [{ summaryType: "event" }, { summaryAt: null, facts: { $type: "object" } }] },
        { $or: [{ date: { $lt: "2026-04-01" } }, { date: "2026-04-01", _id: { $lt: new ObjectId(cursor.i) } }] },
        {
          $or: [
            { title: { $regex: "a\\.b", $options: "i" } },
            { summaryOneLiner: { $regex: "a\\.b", $options: "i" } },
            { "facts.shortTitle.text": { $regex: "a\\.b", $options: "i" } },
            { "facts.shortTitle.compact": { $regex: "a\\.b", $options: "i" } },
          ],
        },
      ],
    });
    expect(limit).toHaveBeenCalledWith(6);
  });

  it("projects no body field and never the crawler's bookkeeping", () => {
    // Assert
    expect(Object.keys(LIST_PROJECTION)).not.toEqual(expect.arrayContaining(["cleanMarkdown"]));
    expect(Object.keys(LIST_PROJECTION).filter((key) => ["content", "cleanHtml", "contentText", "editHistory", "isDeleted"].includes(key))).toEqual([]);
  });
});

describe("NoticesListRepository.listNotices projection for the row", () => {
  it("loads the facts and their history the row is rendered from, and no first-seen instant: the day group reads the posting date", async () => {
    // Act
    await new NoticesListRepository().listNotices("skku-notice02", { limit: 20, cursor: null });

    // Assert
    const options = find.mock.calls[0]?.[1] as { projection: Record<string, number> };
    expect(options.projection).toMatchObject({ facts: 1, factsHistory: 1, date: 1 });
    expect(Object.keys(options.projection).filter((key) => ["factsAt", "factsGate", "groupId", "firstSeenAt"].includes(key))).toEqual([]);
  });
});

describe("NoticesListRepository.onModuleInit", () => {
  it("creates the index the list read hints", async () => {
    // Act
    await new NoticesListRepository().onModuleInit();

    // Assert
    expect(createIndex).toHaveBeenCalledWith(FORCE_INDEX);
    expect(mockLogger.info).toHaveBeenCalledWith({ event: "notices.indexes.ensured" }, "Indexes ensured");
  });
});
