/**
 * toArrivalsDoc: a station's estimated arrivals per direction become its
 * `subway_arrivals` document, keyed by the station id, at the tick's time and
 * service day, each train keeping its absolute arrival instant, its source and
 * its position (or none) and whether it is its service day's first train, and
 * losing the direction its list already names; and, for the call (ADR 0022, D2),
 * whether it is the last run, its timetable arrival and departure at the
 * platform, and the upstream platforms its row passes, left out when none.
 */
import type { TrainArrival } from "../estimate/subway-estimate.types";
import { toArrivalsDoc } from "./subway-tracking.mapper";
import type { DocumentedArrival } from "./subway-tracking.types";

const NOW = new Date("2026-10-16T11:41:00Z");

function arrival(overrides: Partial<TrainArrival> = {}): TrainArrival {
  return {
    trainNo: "0493",
    direction: "down",
    destination: "서동탄",
    express: false,
    arrivalAt: new Date("2026-10-16T11:42:30Z"),
    source: "estimated",
    isFirstTrain: false,
    isLastRun: false,
    position: { platformId: "KR-1-P152", state: "arrived" },
    scheduledArrivalAt: new Date("2026-10-16T11:41:00Z"),
    scheduledDepartureAt: new Date("2026-10-16T11:41:30Z"),
    ...overrides,
  };
}

const documented = (train: TrainArrival, passedPlatformIds: readonly string[] = []): DocumentedArrival => ({ arrival: train, passedPlatformIds });

describe("toArrivalsDoc", () => {
  it("keys the document by the station id and stamps it with the tick's time and service day", () => {
    // Act
    const doc = toArrivalsDoc({ _id: "KR-1-P153", generatedAt: NOW, serviceDate: "2026-10-16" }, { up: [], down: [documented(arrival())] });

    // Assert
    expect(doc).toEqual({
      _id: "KR-1-P153",
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
            isFirstTrain: false,
            position: { stationId: "KR-1-P152", state: "arrived" },
            isLastRun: false,
            scheduledArrivalAt: new Date("2026-10-16T11:41:00Z"),
            scheduledDepartureAt: new Date("2026-10-16T11:41:30Z"),
          },
        ],
      },
    });
  });

  it("keeps a train with no position as one with none", () => {
    // Act
    const doc = toArrivalsDoc({ _id: "KR-1-P153", generatedAt: NOW, serviceDate: "2026-10-16" }, { up: [documented(arrival({ direction: "up", position: null, source: "scheduled" }))], down: [] });

    // Assert
    expect(doc.directions.up).toEqual([expect.objectContaining({ position: null, source: "scheduled" })]);
    expect(doc.directions.up[0]).not.toHaveProperty("direction");
  });

  it("stores the upstream platforms an express's row passes, and no list for a train passing none", () => {
    // Arrange
    const express = documented(arrival({ trainNo: "1913", express: true, isLastRun: true }), ["KR-1-P152", "KR-1-P151"]);

    // Act
    const doc = toArrivalsDoc({ _id: "KR-1-P153", generatedAt: NOW, serviceDate: "2026-10-16" }, { up: [], down: [express, documented(arrival())] });

    // Assert
    expect(doc.directions.down[0]).toMatchObject({ trainNo: "1913", isLastRun: true, passedPlatformIds: ["KR-1-P152", "KR-1-P151"] });
    expect(doc.directions.down[1]).not.toHaveProperty("passedPlatformIds");
  });
});
