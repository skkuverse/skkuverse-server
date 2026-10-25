/**
 * PerimeterCountersRepository's driver calls: one atomic upsert per count, keyed by key and window, that sets the
 * expiry only when it creates the document and returns the count after it, bounded in time, and the TTL index that
 * removes a window once it ends; a count is taken back by the same counter's id, never upserted.
 */
const findOneAndUpdate = jest.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve({ _id: "x", count: 3, expiresAt: new Date(0) }));
const updateOne = jest.fn((..._args: unknown[]) => Promise.resolve({ matchedCount: 1, modifiedCount: 1 }));
const createIndex = jest.fn((..._args: unknown[]) => Promise.resolve("perimeter_counters_ttl"));
const collectionNames: string[] = [];

jest.mock("../infra/db", () => ({
  ...jest.requireActual("../infra/db"),
  getClient: () => ({
    db: () => ({
      collection: (name: string) => {
        collectionNames.push(name);
        return { findOneAndUpdate, updateOne, createIndex };
      },
    }),
  }),
}));

import { PerimeterCountersRepository } from "./perimeter-counters.repository";

const NOW = new Date("2026-10-19T16:30:00Z");
const repository = () => new PerimeterCountersRepository({ now: () => NOW });

beforeEach(() => {
  jest.clearAllMocks();
  collectionNames.length = 0;
});

describe("PerimeterCountersRepository.upsertCount", () => {
  it("counts once into the key's window, sets the expiry on insert only, and returns the count after", async () => {
    // Act
    const { count } = await repository().upsertCount("push:mukja", 3600);

    // Assert
    expect(count).toBe(3);
    expect(collectionNames).toEqual(["perimeter_counters"]);
    expect(findOneAndUpdate.mock.calls[0]).toEqual([
      { _id: "push:mukja@2026-10-19T16:00:00.000Z" },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date("2026-10-19T17:00:00.000Z") } },
      { upsert: true, returnDocument: "after", maxTimeMS: 3_000 },
    ]);
  });

  it("takes the count back from the window it was counted in, after that window ended, without creating one", async () => {
    // Arrange
    let nowMs = NOW.getTime();
    const counted = await new PerimeterCountersRepository({ now: () => new Date(nowMs) }).upsertCount("push:mukja", 3600);
    nowMs += 3600 * 1000;

    // Act
    await counted.release();

    // Assert
    expect(updateOne.mock.calls).toEqual([[{ _id: "push:mukja@2026-10-19T16:00:00.000Z", count: { $gt: 0 } }, { $inc: { count: -1 } }, { maxTimeMS: 3_000 }]]);
  });

  it("throws when the upsert returns no document", async () => {
    // Arrange
    findOneAndUpdate.mockResolvedValueOnce(null);

    // Act & Assert
    await expect(repository().upsertCount("push:mukja", 60)).rejects.toThrow(/was not returned by its upsert/);
  });
});

describe("PerimeterCountersRepository.onModuleInit", () => {
  it("creates the TTL index on expiresAt where pollers run", async () => {
    // Arrange
    const previous = process.env.ROLE;
    process.env.ROLE = "poller";

    try {
      // Act
      await repository().onModuleInit();
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      if (previous === undefined) delete process.env.ROLE;
      else process.env.ROLE = previous;
    }

    // Assert
    expect(createIndex).toHaveBeenCalledWith({ expiresAt: 1 }, { name: "perimeter_counters_ttl", expireAfterSeconds: 0 });
  });
});
