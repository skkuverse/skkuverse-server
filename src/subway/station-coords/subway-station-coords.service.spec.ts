/**
 * SubwayStationCoordsService, the door to the stored `subway-station-coords`
 * dataset (ADR 0013, D6), read over an in-memory store and a fixed clock.
 * `findCoords(stationId)` answers a served station's camera point from one
 * revision, cached for DATASET_CACHE_TTL_MS so a push is seen within a minute
 * and kept through a failed reload for DATASET_STALE_WINDOW_MS. The coords are
 * an enrichment the arrivals route serves without: with no good value, and
 * for a station the revision lacks or the code does not serve, it answers
 * null, never a 503. A station the code serves that the revision lacks, and a
 * stored station the code does not serve, are each logged at warn once per
 * revision; a failed read with nothing cached is logged at error.
 *
 * The cached loader reads `Date.now()`, so the TTL is crossed with Jest's fake system time.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
import { FakeSubwayStationCoordsRepository } from "../../../__tests__/helpers/fakes/subway/subway-station-coords.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { stationCoordsFixture } from "../../../__tests__/helpers/subway/station-coords";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { DATASET_CACHE_TTL_MS, DATASET_STALE_WINDOW_MS } from "../../shared/dataset.constants";
import type { SubwayStationCoordsRepository } from "./subway-station-coords.repository";
import { SubwayStationCoordsService } from "./subway-station-coords.service";

const NOW = new Date("2026-10-23T04:00:00.000Z");
const HYEHWA = { lat: 37.582336, lng: 127.001844 };
const mockedLogger = logger as unknown as Record<"error" | "warn", jest.Mock>;

function setup() {
  let now = NOW;
  const clock: Clock = { now: () => now };
  const repository = new FakeSubwayStationCoordsRepository();
  const coords = new SubwayStationCoordsService(asReal<SubwayStationCoordsRepository>(repository), clock);
  // The clock and Date.now() move together: the dataset loader reads the one, the cached loader the other.
  const advanceTo = (msAfterNow: number): void => {
    now = new Date(NOW.getTime() + msAfterNow);
    jest.setSystemTime(now);
  };
  return { repository, coords, advanceTo };
}

const loggedEvents = (level: "error" | "warn") => mockedLogger[level].mock.calls.map(([fields]) => fields);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("SubwayStationCoordsService.findCoords", () => {
  it("answers each served station's stored point", async () => {
    // Arrange
    const { repository, coords } = setup();
    repository.storeCoords(stationCoordsFixture());

    // Act
    const hyehwa = await coords.findCoords("hyehwa");
    const jeongja = await coords.findCoords("jeongja");

    // Assert
    expect(hyehwa).toEqual(HYEHWA);
    expect(jeongja).toEqual({ lat: 37.366546, lng: 127.108237 });
    expect(loggedEvents("error")).toEqual([]);
    expect(loggedEvents("warn")).toEqual([]);
  });

  it("Point moved: serves a push that moves hyehwa once the TTL has passed, and not before", async () => {
    // Arrange
    const { repository, coords, advanceTo } = setup();
    repository.storeCoords(stationCoordsFixture());
    await coords.findCoords("hyehwa");
    const moved = stationCoordsFixture();
    moved.stations.hyehwa = { lat: 37.5822, lng: 127.0019 };
    repository.storeCoords(moved);

    // Act
    advanceTo(DATASET_CACHE_TTL_MS - 1);
    const before = await coords.findCoords("hyehwa");
    advanceTo(DATASET_CACHE_TTL_MS);
    const after = await coords.findCoords("hyehwa");

    // Assert
    expect(before).toEqual(HYEHWA);
    expect(after).toEqual({ lat: 37.5822, lng: 127.0019 });
  });

  it("Deploy adds a station before its coords: answers null for it, serves the others, and logs it once per revision at warn", async () => {
    // Arrange
    const { repository, coords, advanceTo } = setup();
    const lacking = stationCoordsFixture();
    delete lacking.stations.dogok;
    repository.storeCoords(lacking);

    // Act
    const dogok = await coords.findCoords("dogok");
    const hyehwa = await coords.findCoords("hyehwa");
    advanceTo(DATASET_CACHE_TTL_MS);
    await coords.findCoords("dogok");
    repository.storeCoords(lacking);
    advanceTo(2 * DATASET_CACHE_TTL_MS);
    await coords.findCoords("dogok");

    // Assert
    expect(dogok).toBeNull();
    expect(hyehwa).toEqual(HYEHWA);
    expect(loggedEvents("warn")).toEqual([
      expect.objectContaining({ event: "subway.station_coords.station_missing", revision: 1, stationId: "dogok" }),
      expect.objectContaining({ event: "subway.station_coords.station_missing", revision: 2, stationId: "dogok" }),
    ]);
    expect(loggedEvents("error")).toEqual([]);
  });

  it.each([["suwon"], ["constructor"]])("answers null for %s, which the code does not serve, even when stored", async (stationId) => {
    // Arrange
    const { repository, coords } = setup();
    const extra = stationCoordsFixture();
    extra.stations.suwon = { lat: 37.266, lng: 127.0 };
    repository.storeCoords(extra);

    // Act
    const found = await coords.findCoords(stationId);

    // Assert
    expect(found).toBeNull();
  });

  it("ignores stored coords for a station the code does not serve, logged once per revision at warn", async () => {
    // Arrange
    const { repository, coords, advanceTo } = setup();
    const extra = stationCoordsFixture();
    extra.stations.suwon = { lat: 37.266, lng: 127.0 };
    repository.storeCoords(extra);

    // Act
    await coords.findCoords("hyehwa");
    advanceTo(DATASET_CACHE_TTL_MS);
    await coords.findCoords("hyehwa");

    // Assert
    expect(loggedEvents("warn")).toEqual([expect.objectContaining({ event: "subway.station_coords.station_unknown", revision: 1, stationId: "suwon" })]);
    expect(loggedEvents("error")).toEqual([]);
  });

  it("Fresh replica, database down: answers null and logs the failed read at error", async () => {
    // Arrange
    const { repository, coords } = setup();
    repository.failWith = new Error("server selection timed out");

    // Act
    const found = await coords.findCoords("hyehwa");

    // Assert
    expect(found).toBeNull();
    expect(loggedEvents("error")).toEqual([expect.objectContaining({ event: "subway.station_coords.read_failed" })]);
  });

  it("answers null with no coords stored, and with only an invalid revision, reading once per TTL", async () => {
    // Arrange
    const { repository, coords, advanceTo } = setup();

    // Act
    const missing = await coords.findCoords("hyehwa");
    await coords.findCoords("hyehwa");
    repository.storeCoords({ stations: { hyehwa: { lat: 127.001844, lng: 37.582336 } } });
    advanceTo(DATASET_CACHE_TTL_MS);
    const invalid = await coords.findCoords("hyehwa");

    // Assert
    expect([missing, invalid]).toEqual([null, null]);
    expect(repository.readCount).toBe(2);
  });

  it("keeps the last good revision through failed reloads for the stale window, then answers null", async () => {
    // Arrange
    const { repository, coords, advanceTo } = setup();
    repository.storeCoords(stationCoordsFixture());
    await coords.findCoords("hyehwa");
    repository.failWith = new Error("server selection timed out");

    // Act
    advanceTo(DATASET_STALE_WINDOW_MS - 1);
    const held = await coords.findCoords("hyehwa");
    advanceTo(DATASET_STALE_WINDOW_MS + DATASET_CACHE_TTL_MS);
    const past = await coords.findCoords("hyehwa");

    // Assert
    expect(held).toEqual(HYEHWA);
    expect(past).toBeNull();
  });
});
