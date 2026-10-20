/**
 * The Jongro routes the code serves, held in code as their identities only
 * (move-reference-datasets D10): each route's id and TOPIS route id, in the
 * order the app lists the groups. The id is what the pollers, `bus_cache`
 * keys, the registry's `_id`s and the group ids are built from, so each one
 * matches the route id pattern and appears once. The attributes are the
 * `jongro-route-attributes` dataset's; nothing here holds a TOPIS URL or key.
 */
import { JONGRO_ROUTE_ID_PATTERN, JONGRO_ROUTES } from "./bus.constants";

describe("JONGRO_ROUTES", () => {
  it("holds 02, 07 and 08 in order with their TOPIS route ids", () => {
    // Act & Assert
    expect(JONGRO_ROUTES).toEqual([
      { id: "jongro02", busRouteId: "100900008" },
      { id: "jongro07", busRouteId: "100900004" },
      { id: "jongro08", busRouteId: "100900005" },
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
  });
});
