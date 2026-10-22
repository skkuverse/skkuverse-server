/**
 * SubwayTopologyService, the door to the stored `subway-topology` dataset (ADR 0013, D6),
 * read over an in-memory store and a fixed clock. `current()` answers one revision with its registry: the code-held
 * network joined to the stored directions and neighbors, built once per revision, cached for DATASET_CACHE_TTL_MS so
 * a push is served within a minute and kept through a failed reload for DATASET_STALE_WINDOW_MS. An entry for a
 * platform the code does not serve is ignored, and a served platform the revision lacks is left out; each is logged
 * at error once per revision, as is a previous or next stop the registry has no name for, which the route serves as
 * null. With no good value, `current()` throws the 503 SubwayTopologyUnavailableError.
 *
 * The cached loader reads `Date.now()`, so the TTL is crossed with Jest's fake system time.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
import { FakeSubwayTopologyRepository } from "../../../__tests__/helpers/fakes/subway/subway-topology.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { subwayTopologyFixture } from "../../../__tests__/helpers/subway/topology";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { DATASET_CACHE_TTL_MS, DATASET_STALE_WINDOW_MS } from "../../shared/dataset.constants";
import { SUBWAY_NETWORK } from "../subway.constants";
import { SubwayTopologyUnavailableError } from "./subway-topology.error";
import { toSubwayRegistry } from "./subway-topology.mapper";
import type { SubwayTopologyRepository } from "./subway-topology.repository";
import { SubwayTopologyService } from "./subway-topology.service";

const NOW = new Date("2026-10-20T04:00:00.000Z");
const mockedLogger = logger as unknown as Record<"error" | "warn", jest.Mock>;

function setup() {
  let now = NOW;
  const clock: Clock = { now: () => now };
  const repository = new FakeSubwayTopologyRepository();
  const topology = new SubwayTopologyService(asReal<SubwayTopologyRepository>(repository), clock);
  // The clock and Date.now() move together: the dataset loader reads the one, the cached loader the other.
  const advanceTo = (msAfterNow: number): void => {
    now = new Date(NOW.getTime() + msAfterNow);
    jest.setSystemTime(now);
  };
  return { repository, topology, advanceTo };
}

const loggedEvents = (level: "error" | "warn") => mockedLogger[level].mock.calls.map(([fields]) => fields);
const platformIdsOf = (stationId: string, registry: Awaited<ReturnType<SubwayTopologyService["current"]>>["registry"]) =>
  registry.stations.find((station) => station.id === stationId)?.platforms.map((platform) => platform.id);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("SubwayTopologyService.current", () => {
  it("answers the stored revision with the network joined to its directions and neighbors", async () => {
    // Arrange
    const { repository, topology } = setup();
    repository.storeTopology(subwayTopologyFixture());

    // Act
    const snapshot = await topology.current();

    // Assert
    expect(snapshot.revision).toBe(1);
    expect(snapshot.registry).toEqual(toSubwayRegistry(SUBWAY_NETWORK, subwayTopologyFixture()));
    expect(loggedEvents("error")).toEqual([]);
  });

  it("Neighbor renamed: serves a push that names KR-1-P154 Hwaseo Stn. in English once the TTL has passed, and not before", async () => {
    // Arrange
    const { repository, topology, advanceTo } = setup();
    repository.storeTopology(subwayTopologyFixture());
    await topology.current();
    const renamed = subwayTopologyFixture();
    renamed.neighbors["KR-1-P154"] = { ...renamed.neighbors["KR-1-P154"]!, name: { ko: "화서", en: "Hwaseo Stn.", zh: "华西" } };
    repository.storeTopology(renamed);

    // Act
    advanceTo(DATASET_CACHE_TTL_MS - 1);
    const before = await topology.current();
    advanceTo(DATASET_CACHE_TTL_MS);
    const after = await topology.current();

    // Assert
    expect([before.revision, before.registry.neighbors["KR-1-P154"]?.name?.en]).toEqual([1, "Hwaseo"]);
    expect([after.revision, after.registry.neighbors["KR-1-P154"]?.name?.en]).toEqual([2, "Hwaseo Stn."]);
  });

  it("builds the registry once per revision, across reloads that find the same revision", async () => {
    // Arrange
    const { repository, topology, advanceTo } = setup();
    repository.storeTopology(subwayTopologyFixture());

    // Act
    const first = await topology.current();
    advanceTo(DATASET_CACHE_TTL_MS);
    const reloaded = await topology.current();

    // Assert
    expect(repository.readCount).toBe(2);
    expect(reloaded.registry).toBe(first.registry);
  });

  it("Topology pushed ahead of a deploy: ignores an entry for a platform the code does not serve, logged at error once per revision", async () => {
    // Arrange
    const { repository, topology, advanceTo } = setup();
    const ahead = subwayTopologyFixture();
    ahead.platforms["S1-9-999"] = ahead.platforms["S1-4-420"]!;
    repository.storeTopology(ahead);

    // Act
    const snapshot = await topology.current();
    advanceTo(DATASET_CACHE_TTL_MS);
    await topology.current();

    // Assert
    expect(snapshot.registry).toEqual(toSubwayRegistry(SUBWAY_NETWORK, subwayTopologyFixture()));
    expect(loggedEvents("error")).toEqual([expect.objectContaining({ event: "subway.topology.platform_unknown", revision: 1, platformId: "S1-9-999" })]);
  });

  it("Topology pushed ahead of a deploy: logs a neighbor the push promotes to a served platform as unknown and as an unnamed stop, once per revision", async () => {
    // Arrange
    const { repository, topology, advanceTo } = setup();
    const ahead = subwayTopologyFixture();
    ahead.platforms["KR-1-P154"] = ahead.platforms["KR-1-0153"]!;
    delete ahead.neighbors["KR-1-P154"];
    repository.storeTopology(ahead);

    // Act
    const snapshot = await topology.current();
    advanceTo(DATASET_CACHE_TTL_MS);
    await topology.current();

    // Assert
    expect(snapshot.registry.neighbors["KR-1-P154"]).toBeUndefined();
    expect(loggedEvents("error")).toEqual([
      expect.objectContaining({ event: "subway.topology.platform_unknown", revision: 1, platformId: "KR-1-P154" }),
      expect.objectContaining({ event: "subway.topology.stop_unnamed", revision: 1, platformId: "KR-1-P154" }),
    ]);
  });

  it("Deploy ahead of the topology: leaves a served platform the revision lacks out of its station, logged at error once per revision", async () => {
    // Arrange
    const { repository, topology, advanceTo } = setup();
    const lacking = subwayTopologyFixture();
    delete lacking.platforms["S1-2-222"];
    repository.storeTopology(lacking);

    // Act
    const snapshot = await topology.current();
    advanceTo(DATASET_CACHE_TTL_MS);
    await topology.current();
    repository.storeTopology(lacking);
    advanceTo(2 * DATASET_CACHE_TTL_MS);
    await topology.current();

    // Assert
    expect(platformIdsOf("gangnam", snapshot.registry)).toEqual(["DX-D1-4307"]);
    expect(loggedEvents("error")).toEqual([
      expect.objectContaining({ event: "subway.topology.platform_missing", revision: 1, platformId: "S1-2-222" }),
      expect.objectContaining({ event: "subway.topology.platform_missing", revision: 2, platformId: "S1-2-222" }),
    ]);
  });

  it("Fresh replica, database down: throws SUBWAY_TOPOLOGY_UNAVAILABLE (503) on a first read that fails", async () => {
    // Arrange
    const { repository, topology } = setup();
    repository.failWith = new Error("server selection timed out");

    // Act
    const failure = await topology.current().catch((err: unknown) => err);

    // Assert
    expect(failure).toBeInstanceOf(SubwayTopologyUnavailableError);
    expect(failure).toMatchObject({ code: "SUBWAY_TOPOLOGY_UNAVAILABLE", httpStatus: 503 });
    expect(loggedEvents("error")).toEqual([expect.objectContaining({ event: "subway.topology.read_failed" })]);
  });

  it("throws the unavailable error with no topology stored, and with only an invalid revision", async () => {
    // Arrange
    const { repository, topology, advanceTo } = setup();

    // Act
    const missing = await topology.current().catch((err: unknown) => err);
    repository.storeTopology({ platforms: { "S1-4-420": {} }, neighbors: {} });
    advanceTo(DATASET_CACHE_TTL_MS);
    const invalid = await topology.current().catch((err: unknown) => err);

    // Assert
    expect(missing).toBeInstanceOf(SubwayTopologyUnavailableError);
    expect(invalid).toBeInstanceOf(SubwayTopologyUnavailableError);
    expect(repository.readCount).toBe(2);
  });

  it("Database blip after a good read: keeps the last good revision through failed reloads for the stale window, then answers unavailable", async () => {
    // Arrange
    const { repository, topology, advanceTo } = setup();
    repository.storeTopology(subwayTopologyFixture());
    await topology.current();
    repository.failWith = new Error("server selection timed out");

    // Act
    advanceTo(DATASET_STALE_WINDOW_MS - 1);
    const held = await topology.current();
    advanceTo(DATASET_STALE_WINDOW_MS + DATASET_CACHE_TTL_MS);
    const past = await topology.current().catch((err: unknown) => err);

    // Assert
    expect(held.revision).toBe(1);
    expect(platformIdsOf("hyehwa", held.registry)).toEqual(["S1-4-420"]);
    expect(past).toBeInstanceOf(SubwayTopologyUnavailableError);
  });
});
