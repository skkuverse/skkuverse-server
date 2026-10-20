/**
 * BusRouteAttributesService, the door to the stored `jongro-route-attributes` dataset (move-reference-datasets D10;
 * ADR 0013, D6), read over an in-memory store and a fixed clock. `current()` answers one revision with each code
 * route's attributes, cached for DATASET_CACHE_TTL_MS so a push is seen within a minute and kept through a failed
 * reload for DATASET_STALE_WINDOW_MS. A route the code serves that the revision lacks, and a stored route the code
 * does not serve, are each logged once per revision. With no good value, `current()` throws the 503
 * BusRouteAttributesUnavailableError the routes that serve the attributes answer with; `findCurrent()` answers null
 * instead, for the readers that serve the other groups without them.
 *
 * The cached loader reads `Date.now()`, so the TTL is crossed with Jest's fake system time.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
import { routeAttributesFixture } from "../../../__tests__/helpers/bus/route-attributes";
import { FakeBusRouteAttributesRepository } from "../../../__tests__/helpers/fakes/bus/bus-route-attributes.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { DATASET_CACHE_TTL_MS, DATASET_STALE_WINDOW_MS } from "../../shared/dataset.constants";
import { BusRouteAttributesUnavailableError } from "./bus-route-attributes.error";
import type { BusRouteAttributesRepository } from "./bus-route-attributes.repository";
import { BusRouteAttributesService } from "./bus-route-attributes.service";

const NOW = new Date("2026-10-20T04:00:00.000Z");
const mockedLogger = logger as unknown as Record<"error" | "warn", jest.Mock>;

function setup() {
  let now = NOW;
  const clock: Clock = { now: () => now };
  const repository = new FakeBusRouteAttributesRepository();
  const attributes = new BusRouteAttributesService(asReal<BusRouteAttributesRepository>(repository), clock);
  // The clock and Date.now() move together: the dataset loader reads the one, the cached loader the other.
  const advanceTo = (msAfterNow: number): void => {
    now = new Date(NOW.getTime() + msAfterNow);
    jest.setSystemTime(now);
  };
  return { repository, attributes, advanceTo };
}

const loggedEvents = (level: "error" | "warn") => mockedLogger[level].mock.calls.map(([fields]) => fields);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("BusRouteAttributesService.current", () => {
  it("answers the stored revision with each route's attributes, and none for a name it does not hold", async () => {
    // Arrange
    const { repository, attributes } = setup();
    repository.storeAttributes(routeAttributesFixture());

    // Act
    const snapshot = await attributes.current();

    // Assert
    expect(snapshot.revision).toBe(1);
    expect(snapshot.attributesOf("jongro07")).toEqual(routeAttributesFixture().routes.jongro07);
    expect(snapshot.attributesOf("jongro08")?.seatCount).toBe(18);
    expect(snapshot.attributesOf("jongro13")).toBeUndefined();
    expect(snapshot.attributesOf("constructor")).toBeUndefined();
    expect(loggedEvents("error")).toEqual([]);
    expect(loggedEvents("warn")).toEqual([]);
  });

  it("Seat count raised: serves a push that raises jongro07's seat count once the TTL has passed, and not before", async () => {
    // Arrange
    const { repository, attributes, advanceTo } = setup();
    repository.storeAttributes(routeAttributesFixture());
    await attributes.current();
    const raised = routeAttributesFixture();
    raised.routes.jongro07 = { ...raised.routes.jongro07!, seatCount: 25 };
    repository.storeAttributes(raised);

    // Act
    advanceTo(DATASET_CACHE_TTL_MS - 1);
    const before = await attributes.current();
    advanceTo(DATASET_CACHE_TTL_MS);
    const after = await attributes.current();

    // Assert
    expect([before.revision, before.attributesOf("jongro07")?.seatCount]).toEqual([1, 18]);
    expect([after.revision, after.attributesOf("jongro07")?.seatCount]).toEqual([2, 25]);
  });

  it("Deploy adds a route before its attributes: logs a code route the revision lacks once per revision, at error", async () => {
    // Arrange
    const { repository, attributes, advanceTo } = setup();
    const lacking = routeAttributesFixture();
    delete lacking.routes.jongro08;
    repository.storeAttributes(lacking);

    // Act
    const snapshot = await attributes.current();
    advanceTo(DATASET_CACHE_TTL_MS);
    await attributes.current();
    repository.storeAttributes(lacking);
    advanceTo(2 * DATASET_CACHE_TTL_MS);
    await attributes.current();

    // Assert
    expect(snapshot.attributesOf("jongro08")).toBeUndefined();
    expect(loggedEvents("error")).toEqual([
      expect.objectContaining({ event: "bus.route_attributes.route_missing", revision: 1, routeId: "jongro08" }),
      expect.objectContaining({ event: "bus.route_attributes.route_missing", revision: 2, routeId: "jongro08" }),
    ]);
  });

  it("ignores stored attributes for a route the code does not serve, logged once per revision", async () => {
    // Arrange
    const { repository, attributes, advanceTo } = setup();
    const extra = routeAttributesFixture();
    extra.routes.jongro13 = extra.routes.jongro07!;
    repository.storeAttributes(extra);

    // Act
    const snapshot = await attributes.current();
    advanceTo(DATASET_CACHE_TTL_MS);
    await attributes.current();

    // Assert
    expect(snapshot.attributesOf("jongro13")).toBeUndefined();
    expect(loggedEvents("warn")).toEqual([expect.objectContaining({ event: "bus.route_attributes.route_unknown", revision: 1, routeId: "jongro13" })]);
    expect(loggedEvents("error")).toEqual([]);
  });

  it("Fresh replica, database down: throws JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE (503) on a first read that fails", async () => {
    // Arrange
    const { repository, attributes } = setup();
    repository.failWith = new Error("server selection timed out");

    // Act
    const failure = await attributes.current().catch((err: unknown) => err);

    // Assert
    expect(failure).toBeInstanceOf(BusRouteAttributesUnavailableError);
    expect(failure).toMatchObject({ code: "JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE", httpStatus: 503 });
    expect(loggedEvents("error")).toEqual([expect.objectContaining({ event: "bus.route_attributes.read_failed" })]);
  });

  it("throws the unavailable error with no attributes stored, and with only an invalid revision", async () => {
    // Arrange
    const { repository, attributes, advanceTo } = setup();

    // Act
    const missing = await attributes.current().catch((err: unknown) => err);
    repository.storeAttributes({ routes: { jongro07: { seatCount: 0 } } });
    advanceTo(DATASET_CACHE_TTL_MS);
    const invalid = await attributes.current().catch((err: unknown) => err);

    // Assert
    expect(missing).toBeInstanceOf(BusRouteAttributesUnavailableError);
    expect(invalid).toBeInstanceOf(BusRouteAttributesUnavailableError);
    expect(repository.readCount).toBe(2);
  });

  it("keeps the last good revision through failed reloads for the stale window, then answers unavailable", async () => {
    // Arrange
    const { repository, attributes, advanceTo } = setup();
    repository.storeAttributes(routeAttributesFixture());
    await attributes.current();
    repository.failWith = new Error("server selection timed out");

    // Act
    advanceTo(DATASET_STALE_WINDOW_MS - 1);
    const held = await attributes.current();
    advanceTo(DATASET_STALE_WINDOW_MS + DATASET_CACHE_TTL_MS);
    const past = await attributes.current().catch((err: unknown) => err);

    // Assert
    expect(held.revision).toBe(1);
    expect(held.attributesOf("jongro07")?.seatCount).toBe(18);
    expect(past).toBeInstanceOf(BusRouteAttributesUnavailableError);
  });
});

describe("BusRouteAttributesService.attributesOf", () => {
  it("answers a served route's stored attributes", async () => {
    // Arrange
    const { repository, attributes } = setup();
    repository.storeAttributes(routeAttributesFixture());

    // Act
    const jongro07 = await attributes.attributesOf("jongro07");

    // Assert
    expect(jongro07).toEqual(routeAttributesFixture().routes.jongro07);
  });

  it.each([["jongro13"], ["constructor"]])("throws JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE for %s, which the revision does not serve", async (routeId) => {
    // Arrange
    const { repository, attributes } = setup();
    const extra = routeAttributesFixture();
    extra.routes.jongro13 = extra.routes.jongro07!;
    repository.storeAttributes(extra);

    // Act
    const failure = await attributes.attributesOf(routeId).catch((err: unknown) => err);

    // Assert
    expect(failure).toBeInstanceOf(BusRouteAttributesUnavailableError);
  });

  it("throws JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE for a route the revision lacks", async () => {
    // Arrange
    const { repository, attributes } = setup();
    const lacking = routeAttributesFixture();
    delete lacking.routes.jongro08;
    repository.storeAttributes(lacking);

    // Act
    const failure = await attributes.attributesOf("jongro08").catch((err: unknown) => err);

    // Assert
    expect(failure).toMatchObject({ code: "JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE", httpStatus: 503 });
  });
});

// WHY: the readers that serve something without the Jongro routes (the bus config, the ui transit routes) take the
// never-read answer as none instead of a 503 (move-reference-datasets review F1).
describe("BusRouteAttributesService.findCurrent", () => {
  it("answers the stored revision as current() does", async () => {
    // Arrange
    const { repository, attributes } = setup();
    repository.storeAttributes(routeAttributesFixture());

    // Act
    const snapshot = await attributes.findCurrent();

    // Assert
    expect(snapshot?.revision).toBe(1);
    expect(snapshot?.attributesOf("jongro07")?.seatCount).toBe(18);
  });

  it("answers null with no attributes stored, and with only an invalid revision", async () => {
    // Arrange
    const { repository, attributes, advanceTo } = setup();

    // Act
    const missing = await attributes.findCurrent();
    repository.storeAttributes({ routes: { jongro07: { seatCount: 0 } } });
    advanceTo(DATASET_CACHE_TTL_MS);
    const invalid = await attributes.findCurrent();

    // Assert
    expect([missing, invalid]).toEqual([null, null]);
    expect(repository.readCount).toBe(2);
  });

  it("Fresh replica, database down: answers null and still logs the failed read at error", async () => {
    // Arrange
    const { repository, attributes } = setup();
    repository.failWith = new Error("server selection timed out");

    // Act
    const snapshot = await attributes.findCurrent();

    // Assert
    expect(snapshot).toBeNull();
    expect(loggedEvents("error")).toEqual([expect.objectContaining({ event: "bus.route_attributes.read_failed" })]);
  });

  it("keeps the last good revision through failed reloads for the stale window, then answers null", async () => {
    // Arrange
    const { repository, attributes, advanceTo } = setup();
    repository.storeAttributes(routeAttributesFixture());
    await attributes.findCurrent();
    repository.failWith = new Error("server selection timed out");

    // Act
    advanceTo(DATASET_STALE_WINDOW_MS - 1);
    const held = await attributes.findCurrent();
    advanceTo(DATASET_STALE_WINDOW_MS + DATASET_CACHE_TTL_MS);
    const past = await attributes.findCurrent();

    // Assert
    expect(held?.revision).toBe(1);
    expect(past).toBeNull();
  });
});
