/**
 * BusHsscRouteLineService, the door to the stored `hssc-route-line` dataset (ADR 0013, D6), read over an in-memory
 * store and a fixed clock. `findCurrent()` answers the stored revision and its line, cached for DATASET_CACHE_TTL_MS
 * so a push is seen within a minute and kept through a failed reload for DATASET_STALE_WINDOW_MS. With no good line
 * ever read (missing, invalid, unreadable) it answers null, so the map serves the Jongno lines without the HSSC one;
 * the repository and the loader have logged the cause at error.
 *
 * The cached loader reads `Date.now()`, so the TTL is crossed with Jest's fake system time.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
import { hsscRouteLineFixture } from "../../../__tests__/helpers/bus/hssc-route-line";
import { FakeBusHsscRouteLineRepository } from "../../../__tests__/helpers/fakes/bus/bus-hssc-route-line.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { DATASET_CACHE_TTL_MS, DATASET_STALE_WINDOW_MS } from "../../shared/dataset.constants";
import type { BusHsscRouteLineRepository } from "./bus-hssc-route-line.repository";
import { BusHsscRouteLineService } from "./bus-hssc-route-line.service";

const NOW = new Date("2026-10-23T04:00:00.000Z");
const mockedLogger = logger as unknown as Record<"error", jest.Mock>;

function setup() {
  let now = NOW;
  const clock: Clock = { now: () => now };
  const repository = new FakeBusHsscRouteLineRepository();
  const routeLine = new BusHsscRouteLineService(asReal<BusHsscRouteLineRepository>(repository), clock);
  // The clock and Date.now() move together: the dataset loader reads the one, the cached loader the other.
  const advanceTo = (msAfterNow: number): void => {
    now = new Date(NOW.getTime() + msAfterNow);
    jest.setSystemTime(now);
  };
  return { repository, routeLine, advanceTo };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("BusHsscRouteLineService.findCurrent", () => {
  it("answers the stored revision and its line as stored", async () => {
    // Arrange
    const { repository, routeLine } = setup();
    repository.storeRouteLine(hsscRouteLineFixture());

    // Act
    const current = await routeLine.findCurrent();

    // Assert
    expect(current).toEqual({ revision: 1, path: hsscRouteLineFixture().path });
  });

  it("answers null when no line is stored", async () => {
    // Arrange
    const { routeLine } = setup();

    // Act & Assert
    expect(await routeLine.findCurrent()).toBeNull();
  });

  it("answers null when the stored line fails its schema", async () => {
    // Arrange
    const { repository, routeLine } = setup();
    repository.storeRouteLine({ path: [[37.58, 126.99]] });

    // Act & Assert
    expect(await routeLine.findCurrent()).toBeNull();
  });

  it("answers null when the read fails with nothing read before, logged at error as bus.hssc_route_line.read_failed", async () => {
    // Arrange
    const { repository, routeLine } = setup();
    repository.failWith = new Error("atlas down");

    // Act
    const current = await routeLine.findCurrent();

    // Assert
    expect(current).toBeNull();
    expect(mockedLogger.error.mock.calls.map(([fields]) => fields)).toEqual([expect.objectContaining({ event: "bus.hssc_route_line.read_failed" })]);
  });

  it("serves a push once the TTL has passed, and not before", async () => {
    // Arrange
    const { repository, routeLine, advanceTo } = setup();
    repository.storeRouteLine(hsscRouteLineFixture());
    await routeLine.findCurrent();
    const moved = hsscRouteLineFixture();
    moved.path = moved.path.slice(0, 100);
    repository.storeRouteLine(moved);

    // Act
    advanceTo(DATASET_CACHE_TTL_MS - 1);
    const before = await routeLine.findCurrent();
    advanceTo(DATASET_CACHE_TTL_MS + 1);
    const after = await routeLine.findCurrent();

    // Assert
    expect(before?.revision).toBe(1);
    expect(after).toEqual({ revision: 2, path: moved.path });
  });

  it("keeps the last good line through failed reloads inside the stale window, and null past it", async () => {
    // Arrange
    const { repository, routeLine, advanceTo } = setup();
    repository.storeRouteLine(hsscRouteLineFixture());
    await routeLine.findCurrent();
    repository.failWith = new Error("atlas down");

    // Act
    advanceTo(DATASET_CACHE_TTL_MS + 1);
    const inside = await routeLine.findCurrent();
    advanceTo(DATASET_CACHE_TTL_MS + DATASET_STALE_WINDOW_MS + 1);
    const past = await routeLine.findCurrent();

    // Assert
    expect(inside?.revision).toBe(1);
    expect(past).toBeNull();
  });
});
