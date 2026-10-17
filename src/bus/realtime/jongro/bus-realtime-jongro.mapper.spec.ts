/**
 * The Jongro mapper: a sighting placed on a registry stop becomes the cached
 * bus position the realtime route reads.
 */
import { toJongroBusPosition } from "./bus-realtime-jongro.mapper";

describe("toJongroBusPosition", () => {
  it("places the sighting on its stop with its dwell", () => {
    // Arrange
    const sighting = { stationId: "100900197", latitude: "37.587", longitude: "126.998", carNumber: "5537" };

    // Act
    const position = toJongroBusPosition(sighting, { sequence: 6, stationName: "명륜새마을금고" }, {
      firstSeenAt: "2026-10-20T01:00:00.000Z",
      dwellSeconds: 40,
    });

    // Assert
    expect(position).toEqual({
      sequence: "6",
      stationName: "명륜새마을금고",
      carNumber: "5537",
      eventDate: "2026-10-20T01:00:00.000Z",
      estimatedTime: 40,
      stationId: "100900197",
      latitude: "37.587",
      longitude: "126.998",
      recordTime: "2026-10-20T01:00:00.000Z",
    });
  });
});
