/**
 * A Jongro route's identity in code becomes a JongroRoute: its id, the route
 * code after the `jongro` prefix and its TOPIS route id, and no TOPIS URL or
 * key, which the client builds at each call (ADR 0012, D4). The attributes are
 * stored, not part of the route (ADR 0013, D2).
 */
import { toJongroRoute } from "./bus.mapper";

describe("toJongroRoute", () => {
  it("keeps the identity's fields and reads the code after the jongro prefix", () => {
    // Arrange
    const identity = { id: "jongro07", busRouteId: "100900004" };

    // Act
    const route = toJongroRoute(identity);

    // Assert
    expect(route).toEqual({ id: "jongro07", code: "07", busRouteId: "100900004" });
  });

  it("reads a two-digit code past 09", () => {
    // Act & Assert
    expect(toJongroRoute({ id: "jongro13", busRouteId: "1" }).code).toBe("13");
  });
});
