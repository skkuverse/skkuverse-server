/**
 * The Jongro mapper: a sighting placed on a registry stop becomes the cached
 * bus position the realtime route reads, at its section ord with its vehicle
 * fields, and since when it has stood at its stop (add-jongro-bus-trajectory).
 */
import { jongroSighting } from "../../../../__tests__/helpers/bus/jongro-sighting";
import { toJongroBusPosition } from "./bus-realtime-jongro.mapper";

describe("toJongroBusPosition", () => {
  it("places the sighting on its stop with its dwell", () => {
    // Arrange
    const sighting = jongroSighting({ stationId: "100900197", latitude: "37.587", longitude: "126.998", carNumber: "5537", sectOrd: 6 });

    // Act
    const position = toJongroBusPosition(sighting, { sequence: 6, stationName: "명륜새마을금고" }, {
      firstSeenAt: "2026-10-20T01:00:00.000Z",
      dwellSeconds: 40,
      isStationary: false,
    });

    // Assert
    // WHY: the vehicle fields are what add-jongro-bus-positions adds (task 1.3); every other field is as before.
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
      vehicleId: "100000103",
      sectDist: 0.15,
      fullSectDist: 0.3,
      isAtStop: false,
      observedAt: "2026-10-20T10:00:00+09:00",
      isStationary: false,
    });
  });

  it("takes the sequence from the section ord, so a loop end keeps its own ord", () => {
    // Act
    const position = toJongroBusPosition(jongroSighting({ stationId: "100900204", sectOrd: 27 }), { sequence: 1, stationName: "성균관대학교" }, {
      firstSeenAt: "2026-10-20T01:00:00.000Z",
      dwellSeconds: 0,
      isStationary: true,
    });

    // Assert
    expect(position).toMatchObject({ sequence: "27", stationName: "성균관대학교", isStationary: true });
  });

  it("keeps since when the bus has stood at its stop, and leaves it out for a moving bus", () => {
    // Arrange
    const timing = { firstSeenAt: "2026-10-18T09:08:59.000Z", dwellSeconds: 21, isStationary: false };
    const stop = { sequence: 20, stationName: "성균관대학교" };

    // Act
    const atStop = toJongroBusPosition(jongroSighting({ sectOrd: 20, isAtStop: true }), stop, { ...timing, atStopSince: "2026-10-18T18:08:59+09:00" });
    const moving = toJongroBusPosition(jongroSighting({ sectOrd: 20 }), stop, timing);

    // Assert
    expect(atStop).toMatchObject({ isAtStop: true, atStopSince: "2026-10-18T18:08:59+09:00" });
    expect(moving).not.toHaveProperty("atStopSince");
  });
});
