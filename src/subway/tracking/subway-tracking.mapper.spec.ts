/**
 * toArrivalsDoc: a station's estimated arrivals per direction become its
 * `subway_arrivals` document, keyed by the station id, at the tick's time and
 * service day, each train keeping its absolute arrival instant, its source and
 * its position (or none) and losing the direction its list already names.
 */
import type { TrainArrival } from "../estimate/subway-estimate.types";
import { toArrivalsDoc } from "./subway-tracking.mapper";

const NOW = new Date("2026-10-16T11:41:00Z");

function arrival(overrides: Partial<TrainArrival> = {}): TrainArrival {
  return {
    trainNo: "0493",
    direction: "down",
    destination: "서동탄",
    express: false,
    arrivalAt: new Date("2026-10-16T11:42:30Z"),
    source: "estimated",
    position: { platformId: "KR-1-P152", state: "arrived" },
    ...overrides,
  };
}

describe("toArrivalsDoc", () => {
  it("keys the document by the station id and stamps it with the tick's time and service day", () => {
    // Act
    const doc = toArrivalsDoc({ _id: "KR-1-0153", generatedAt: NOW, serviceDate: "2026-10-16" }, { up: [], down: [arrival()] });

    // Assert
    expect(doc).toEqual({
      _id: "KR-1-0153",
      generatedAt: NOW,
      serviceDate: "2026-10-16",
      directions: {
        up: [],
        down: [
          {
            trainNo: "0493",
            destination: "서동탄",
            express: false,
            arrivalAt: new Date("2026-10-16T11:42:30Z"),
            source: "estimated",
            position: { stationId: "KR-1-P152", state: "arrived" },
          },
        ],
      },
    });
  });

  it("keeps a train with no position as one with none", () => {
    // Act
    const doc = toArrivalsDoc({ _id: "KR-1-0153", generatedAt: NOW, serviceDate: "2026-10-16" }, { up: [arrival({ direction: "up", position: null, source: "scheduled" })], down: [] });

    // Assert
    expect(doc.directions.up).toEqual([expect.objectContaining({ position: null, source: "scheduled" })]);
    expect(doc.directions.up[0]).not.toHaveProperty("direction");
  });
});
