/**
 * createDatasetLoader: the read contract of ADR 0013 D6 that every dataset
 * reader shares. A value is served for
 * DATASET_CACHE_TTL_MS and reloaded after; a reload that fails inside
 * DATASET_STALE_WINDOW_MS serves the last value; with no good value, a load
 * that finds nothing or fails to read answers the caller's unavailable error,
 * remembered for one TTL with CACHE on, and a read failure is logged once per
 * failed load, throttled. Any other error is a fault and passes through as itself.
 *
 * The cached loader reads `Date.now()`, so time moves with Jest's fake system
 * time and the injected clock together.
 */
jest.mock("./logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { DATASET_CACHE_TTL_MS, DATASET_STALE_WINDOW_MS } from "../shared/dataset.constants";
import type { Clock } from "./clock";
import config from "./config";
import { createDatasetLoader, type DatasetLoaderOptions } from "./dataset-loader";
import logger from "./logger";

const NOW = new Date("2026-10-19T03:00:00.000Z");
const LOG_INTERVAL_MS = 60_000;
const READ_FAILED_EVENT = "test.dataset.read_failed";
const mockedLogger = logger as unknown as Record<"info" | "warn" | "error", jest.Mock>;
const callsOf = (level: "warn" | "error", event: string) =>
  mockedLogger[level].mock.calls.filter(([fields]) => fields?.event === event).map(([fields]) => fields);

class TestUnavailableError extends Error {
  constructor() {
    super("test dataset unavailable");
    this.name = "TestUnavailableError";
  }
}

class TestReadError extends Error {
  constructor(cause: unknown) {
    super("test dataset unreadable", { cause });
    this.name = "TestReadError";
  }
}

let at = NOW;
const clock: Clock = { now: () => at };
const moveTo = (ms: number) => {
  at = new Date(ms);
  jest.setSystemTime(ms);
};

// WHY: like a repository, each failed read throws a new read error around the driver's; a fault is thrown as itself.
let stored: { value: string | null; failWith: Error | null; fault: Error | null };
let loadCount: number;
const load = async (): Promise<string | null> => {
  loadCount += 1;
  if (stored.fault) throw stored.fault;
  if (stored.failWith) throw new TestReadError(stored.failWith);
  return stored.value;
};

const datasetOptions: DatasetLoaderOptions<string> = {
  name: "test.dataset",
  load,
  clock,
  isReadError: (err): err is TestReadError => err instanceof TestReadError,
  toUnavailable: () => new TestUnavailableError(),
  readFailedEvent: READ_FAILED_EVENT,
  logIntervalMs: LOG_INTERVAL_MS,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
  at = NOW;
  stored = { value: null, failWith: null, fault: null };
  loadCount = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

describe("createDatasetLoader", () => {
  it("serves a value for one TTL and reloads it after", async () => {
    // Arrange
    const loader = createDatasetLoader(datasetOptions);
    stored.value = "revision 1";
    await loader.get();
    stored.value = "revision 2";

    // Act
    moveTo(NOW.getTime() + DATASET_CACHE_TTL_MS - 1);
    const beforeTtl = await loader.get();
    moveTo(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const atTtl = await loader.get();

    // Assert
    expect(beforeTtl).toBe("revision 1");
    expect(atTtl).toBe("revision 2");
    expect(DATASET_CACHE_TTL_MS).toBe(60_000);
  });

  it("serves the last value through a failed reload inside the stale window, logging cache.reload_failed", async () => {
    // Arrange
    const loader = createDatasetLoader(datasetOptions);
    stored.value = "revision 1";
    await loader.get();
    stored.failWith = new Error("server selection timed out");

    // Act
    moveTo(NOW.getTime() + DATASET_CACHE_TTL_MS + DATASET_STALE_WINDOW_MS - 1);
    const served = await loader.get();

    // Assert
    expect(served).toBe("revision 1");
    expect(callsOf("warn", "cache.reload_failed")).toEqual([expect.objectContaining({ cache: "test.dataset" })]);
    expect(DATASET_STALE_WINDOW_MS).toBe(24 * 60 * 60_000);
  });

  it("serves the last value when a reload finds no good value", async () => {
    // Arrange
    const loader = createDatasetLoader(datasetOptions);
    stored.value = "revision 1";
    await loader.get();
    stored.value = null;

    // Act
    moveTo(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const served = await loader.get();

    // Assert
    expect(served).toBe("revision 1");
  });

  it("answers the caller's unavailable error when a first load finds no good value, logging no read failure", async () => {
    // Arrange
    const loader = createDatasetLoader(datasetOptions);

    // Act & Assert
    await expect(loader.get()).rejects.toBeInstanceOf(TestUnavailableError);
    expect(callsOf("error", READ_FAILED_EVENT)).toEqual([]);
  });

  it("answers the caller's unavailable error when a first load fails to read, logging the read error's cause", async () => {
    // Arrange
    const driverError = new Error("server selection timed out");
    stored.failWith = driverError;
    const loader = createDatasetLoader(datasetOptions);

    // Act & Assert
    await expect(loader.get()).rejects.toBeInstanceOf(TestUnavailableError);
    expect(callsOf("error", READ_FAILED_EVENT)).toEqual([expect.objectContaining({ err: driverError, suppressed: 0 })]);
  });

  it("gives every caller waiting on one failed load one failure: one load and one log line", async () => {
    // Arrange
    stored.failWith = new Error("server selection timed out");
    const loader = createDatasetLoader(datasetOptions);

    // Act
    const answers = await Promise.allSettled(Array.from({ length: 5 }, () => loader.get()));

    // Assert
    expect(answers).toEqual(Array(5).fill({ status: "rejected", reason: expect.any(TestUnavailableError) }));
    expect(loadCount).toBe(1);
    expect(callsOf("error", READ_FAILED_EVENT)).toHaveLength(1);
  });

  it("lets a fault in the load pass through as itself, logging nothing", async () => {
    // Arrange
    const fault = new TypeError("cannot read properties of undefined");
    stored.fault = fault;
    const loader = createDatasetLoader(datasetOptions);

    // Act & Assert
    await expect(loader.get()).rejects.toBe(fault);
    expect(callsOf("error", READ_FAILED_EVENT)).toEqual([]);
  });
});

describe("createDatasetLoader with no good value and CACHE on", () => {
  it("remembers the unavailable answer for one TTL, loading again after it", async () => {
    // Arrange
    const loader = createDatasetLoader(datasetOptions);

    // Act
    const answers: unknown[] = [];
    for (let request = 0; request < 5; request++) {
      moveTo(NOW.getTime() + request * 1_000);
      answers.push(await loader.get().catch((err: unknown) => err));
    }
    const loadsInFirstTtl = loadCount;
    stored.value = "revision 1";
    moveTo(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const atTtl = await loader.get();

    // Assert
    expect(answers).toEqual(Array(5).fill(expect.any(TestUnavailableError)));
    expect(loadsInFirstTtl).toBe(1);
    expect(atTtl).toBe("revision 1");
  });
});

describe("createDatasetLoader with no good value and CACHE off", () => {
  beforeEach(() => {
    config.cache.enabled = false;
  });

  afterEach(() => {
    config.cache.enabled = true;
  });

  it("loads on every get, remembering no unavailable answer", async () => {
    // Arrange
    const loader = createDatasetLoader(datasetOptions);

    // Act
    await loader.get().catch(() => undefined);
    moveTo(NOW.getTime() + 1_000);
    await loader.get().catch(() => undefined);
    stored.value = "revision 1";
    moveTo(NOW.getTime() + 2_000);
    const served = await loader.get();

    // Assert
    expect(loadCount).toBe(3);
    expect(served).toBe("revision 1");
  });

  it("throttles the read failure to one line per interval, counting the failed loads it skipped in suppressed", async () => {
    // Arrange
    stored.failWith = new Error("server selection timed out");
    const loader = createDatasetLoader(datasetOptions);

    // Act
    for (const offsetMs of [0, 10_000, 20_000, LOG_INTERVAL_MS - 1, LOG_INTERVAL_MS]) {
      moveTo(NOW.getTime() + offsetMs);
      await loader.get().catch(() => undefined);
    }

    // Assert
    expect(loadCount).toBe(5);
    expect(callsOf("error", READ_FAILED_EVENT)).toEqual([
      expect.objectContaining({ suppressed: 0 }),
      expect.objectContaining({ suppressed: 3 }),
    ]);
  });
});
