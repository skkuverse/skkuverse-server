/**
 * The TOPIS routes the code serves, held in code as their identities and the
 * facts code branches on (ADR 0013, D2): each route's id, explicit TOPIS code
 * and TOPIS route id, in the order the app lists the groups, with what its
 * source can supply on the live route (`capabilities`), whether /bus/config
 * lists it and how often it is polled. The id is what the registry's `_id`s
 * and the group ids are built from, and the code what the pollers and
 * `bus_cache` keys are named by, so each matches its pattern and appears once.
 * The three Jongro routes keep the capabilities and interval they had before
 * the list held them. The attributes are the `jongro-route-attributes`
 * dataset's; nothing here holds a TOPIS URL or key.
 */
import { JONGRO_ROUTES } from "./bus.constants";

// WHY: two-digit codes as Seoul names village buses, so `jongro_locations_07` has no `_007` twin. The ids are code
// (ADR 0013, D2), so a spec checks them.
const JONGRO_ROUTE_ID_PATTERN = /^jongro(0[1-9]|[1-9]\d+)$/;

describe("JONGRO_ROUTES", () => {
  it("holds 02, 07 and 08 in order with their TOPIS route ids", () => {
    // Act & Assert
    expect(JONGRO_ROUTES.map(({ id, busRouteId }) => ({ id, busRouteId }))).toEqual([
      { id: "jongro02", busRouteId: "100900008" },
      { id: "jongro07", busRouteId: "100900004" },
      { id: "jongro08", busRouteId: "100900005" },
    ]);
  });

  it("gives each Jongro route its TOPIS code explicitly, the digits after jongro in its id", () => {
    // Act & Assert
    expect(JONGRO_ROUTES.map(({ id, code }) => [id, code])).toEqual([
      ["jongro02", "02"],
      ["jongro07", "07"],
      ["jongro08", "08"],
    ]);
  });

  it("gives every route a code of digits only, once, since the pollers and bus_cache keys are named by it", () => {
    // Act
    const codes = JONGRO_ROUTES.map((route) => route.code);

    // Assert
    expect(codes.filter((code) => !/^\d+$/.test(code))).toEqual([]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("gives each Jongro route the capabilities its live screen states, GPS positions and every vehicle field, in the order the ETag hashes", () => {
    // Act
    const capabilities = JONGRO_ROUTES.map((route) => route.capabilities);

    // Assert
    for (const routeCapabilities of capabilities) {
      expect(routeCapabilities).toEqual({ positionSource: "gps", occupancy: true, plateNumber: true, lastBus: true, lowFloor: true });
      expect(Object.keys(routeCapabilities)).toEqual(["positionSource", "occupancy", "plateNumber", "lastBus", "lowFloor"]);
    }
  });

  it("lists each Jongro route on /bus/config and polls it every 25 s", () => {
    // Act & Assert
    expect(JONGRO_ROUTES.map(({ isListed, pollIntervalMs }) => [isListed, pollIntervalMs])).toEqual([
      [true, 25_000],
      [true, 25_000],
      [true, 25_000],
    ]);
  });

  it("gives every route an id that matches the route id pattern", () => {
    // Act
    const offPattern = JONGRO_ROUTES.filter((route) => !JONGRO_ROUTE_ID_PATTERN.test(route.id));

    // Assert
    expect(offPattern).toEqual([]);
  });

  it.each([["jongro007"], ["jongroX"], ["jongro00"], ["bus07"]])("the route id pattern refuses %s", (id) => {
    // Act & Assert
    expect(JONGRO_ROUTE_ID_PATTERN.test(id)).toBe(false);
  });

  it("lists each route id once", () => {
    // Act
    const ids = JONGRO_ROUTES.map((route) => route.id);

    // Assert
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every route a TOPIS route id of digits only", () => {
    // Act & Assert
    expect(JONGRO_ROUTES.filter((route) => !/^\d+$/.test(route.busRouteId))).toEqual([]);
  });

  it("holds no TOPIS URL or service key, so a role without the key can import it", () => {
    // Act
    const serialized = JSON.stringify(JONGRO_ROUTES);

    // Assert
    expect(serialized).not.toContain("serviceKey");
    expect(serialized).not.toContain(process.env.SEOUL_BUS_SERVICE_KEY as string);
  });

  it("is frozen, so no request can change a route", () => {
    // Act & Assert
    expect(Object.isFrozen(JONGRO_ROUTES)).toBe(true);
    expect(JONGRO_ROUTES.every((route) => Object.isFrozen(route))).toBe(true);
    expect(JONGRO_ROUTES.every((route) => Object.isFrozen(route.capabilities))).toBe(true);
  });
});
