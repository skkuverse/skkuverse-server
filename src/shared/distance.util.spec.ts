/**
 * haversineM, the great-circle distance the stop catalog bounds walks with and
 * the directions clients check a route's stops against.
 */
import { haversineM } from "./distance.util";

describe("haversineM", () => {
  it("is zero between a point and itself", () => {
    // Act & Assert
    expect(haversineM({ lat: 37.5, lng: 127 }, { lat: 37.5, lng: 127 })).toBe(0);
  });

  it("measures one degree of latitude as about 111.2 km", () => {
    // Act & Assert
    expect(Math.round(haversineM({ lat: 37, lng: 127 }, { lat: 38, lng: 127 }))).toBe(111195);
  });

  it("is symmetric", () => {
    // Arrange
    const a = { lat: 37.3595, lng: 127.1052 };
    const b = { lat: 37.2939, lng: 126.9748 };

    // Act & Assert
    expect(haversineM(a, b)).toBe(haversineM(b, a));
  });
});
