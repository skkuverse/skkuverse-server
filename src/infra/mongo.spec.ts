/**
 * mongoCollection opens a named collection on the shared client, and
 * ensureIndexesAtBoot retries index setup with a growing wait, logs the outcome
 * under its scope, and never fails the boot.
 */
jest.mock("./logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const collection = jest.fn((name: string) => ({ name }));
const db = jest.fn((_name: string) => ({ collection }));
jest.mock("./db", () => ({ getClient: () => ({ db }) }));

import logger from "./logger";
import { ensureIndexesAtBoot, mongoCollection } from "./mongo";

const info = logger.info as jest.Mock;
const warn = logger.warn as jest.Mock;
const error = logger.error as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe("mongoCollection", () => {
  it("opens the named collection of the named database", () => {
    // Act & Assert
    expect(mongoCollection("building_dev", "spaces")).toEqual({ name: "spaces" });
    expect(db).toHaveBeenCalledWith("building_dev");
    expect(collection).toHaveBeenCalledWith("spaces");
  });
});

describe("ensureIndexesAtBoot", () => {
  it("logs the scope's ensured event once the indexes exist", async () => {
    // Arrange
    const create = jest.fn().mockResolvedValue(undefined);

    // Act
    await ensureIndexesAtBoot("building", create);

    // Assert
    expect(create).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith({ event: "building.indexes.ensured" }, "Indexes ensured");
  });

  it("warns and resolves when setup fails, so the boot goes on", async () => {
    // Arrange
    const err = new Error("not primary");

    // Act & Assert
    await expect(ensureIndexesAtBoot("building.sync", jest.fn().mockRejectedValue(err))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      { event: "building.sync.indexes.failed", err, attempts: 1 },
      "Index setup failed",
    );
    expect(info).not.toHaveBeenCalled();
  });

  it("retries with a growing wait and logs the final failure at the chosen level", async () => {
    // Arrange
    jest.useFakeTimers();
    const err = new Error("timeout");
    const create = jest.fn().mockRejectedValue(err);

    // Act & Assert
    const done = ensureIndexesAtBoot("notices", create, { attempts: 3, backoffMs: 1_000, failLevel: "error" });
    await jest.advanceTimersByTimeAsync(999);
    expect(create).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(create).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(2_000);
    await done;
    expect(create).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledWith({ event: "notices.indexes.failed", err, attempts: 3 }, "Index setup failed");
    expect(warn).not.toHaveBeenCalled();
  });

  it("stops retrying once an attempt succeeds", async () => {
    // Arrange
    jest.useFakeTimers();
    const create = jest.fn().mockRejectedValueOnce(new Error("blip")).mockResolvedValue(undefined);

    // Act
    const done = ensureIndexesAtBoot("notices", create, { attempts: 3 });
    await jest.advanceTimersByTimeAsync(1_000);
    await done;

    // Assert
    expect(create).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledWith({ event: "notices.indexes.ensured" }, "Indexes ensured");
  });
});
