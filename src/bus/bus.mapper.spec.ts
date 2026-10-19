/**
 * A jongro-routes.json entry becomes a JongroRoute: its id, the route code after
 * the `jongro` prefix, its TOPIS route id and display fields as written, and no
 * TOPIS URL or key, which the client builds at each call (ADR 0012, D4).
 */
import { toJongroRoute } from "./bus.mapper";

describe("toJongroRoute", () => {
  it("keeps the entry's fields and reads the code after the jongro prefix", () => {
    // Arrange
    const entry = {
      id: "jongro07",
      busRouteId: "100900004",
      themeColor: "4CAF50",
      iconType: "village",
      refreshInterval: 40,
      seatCount: 18,
      transferLinesByArsId: { "01877": [{ line: "4", color: "00A5DE" }] },
    };

    // Act
    const route = toJongroRoute(entry);

    // Assert
    expect(route).toEqual({ ...entry, code: "07" });
  });
});
