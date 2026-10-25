/**
 * JourneyRepository: the read of the stored `journey-routes` dataset, which `npm run data` writes and the server only
 * parses (ADR 0013, D6).
 *
 * The query object is pinned here, since FakeJourneyRepository copies it: one document by `_id`, projecting only the
 * revision and the data, bounded by `maxTimeMS`, on the content database's `datasets`. A missing document and one
 * that fails the schema both read as `null`, each logged at error at most once a minute. A failed read rejects as
 * JourneyRoutesReadError.
 *
 * src/infra/db.ts (whose client src/infra/mongo.ts opens collections on) and src/infra/logger.ts are mocked.
 */
const findOne = jest.fn();
const openedCollections: Array<{ dbName: string; name: string }> = [];

jest.mock("../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: jest.requireActual("../infra/db").HOT_READ_MAX_TIME_MS,
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
jest.mock("../infra/logger", () => mockLogger);

import { journeyRoutesFixture } from "../../__tests__/helpers/journey/journey-routes";
import { logText } from "../../__tests__/helpers/log-text";
import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { JourneyRepository } from "./journey.repository";

beforeEach(() => {
  findOne.mockReset();
  openedCollections.length = 0;
  jest.clearAllMocks();
});

describe("JourneyRepository.findRoutes", () => {
  it("reads one document by _id from the content database's datasets, projecting the revision and data, bounded", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "journey-routes", revision: 2, data: journeyRoutesFixture() });

    // Act
    const stored = await new JourneyRepository().findRoutes();

    // Assert
    expect(openedCollections).toEqual([{ dbName: config.content.dbName, name: config.content.collections.datasets }]);
    expect(findOne).toHaveBeenCalledWith({ _id: "journey-routes" }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
    expect(stored).toEqual({ revision: 2, data: journeyRoutesFixture() });
  });

  it("returns null for a missing document, logged at error as journey.routes_dataset.missing", async () => {
    // Arrange
    findOne.mockResolvedValue(null);

    // Act
    const stored = await new JourneyRepository().findRoutes();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "journey.routes_dataset.missing", dataset: "journey-routes" });
  });

  it("returns null for a document that fails the schema, logged with its revision and issues", async () => {
    // Arrange
    const data = journeyRoutesFixture();
    data.routes[0].id = "Hssc";
    findOne.mockResolvedValue({ _id: "journey-routes", revision: 3, data });

    // Act
    const stored = await new JourneyRepository().findRoutes();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "journey.routes_dataset.invalid", revision: 3 });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/data\.routes\.0\.id: must be 1-128 characters/);
  });

  it("rejects a failing read as JourneyRoutesReadError, carrying the driver's error as its cause", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    findOne.mockRejectedValue(failure);

    // Act & Assert
    await expect(new JourneyRepository().findRoutes()).rejects.toMatchObject({ name: "JourneyRoutesReadError", cause: failure });
  });
});
