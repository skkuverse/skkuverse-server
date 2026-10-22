/**
 * The shuttle_eta document id: keyed by run and source.
 */
import { etaDocId } from "./bus-eta.mapper";
import type { EtaRun } from "./bus-eta.types";

const RUN: EtaRun = {
  serviceId: "campus-inja",
  routeType: "regular",
  date: "2026-10-12",
  time: "10:00",
  departAt: new Date("2026-10-12T01:00:00.000Z"),
};

describe("etaDocId", () => {
  it("is keyed by run and source", () => {
    // Act & Assert
    expect(etaDocId(RUN, "live")).toBe("campus-inja|regular|2026-10-12|10:00|live");
  });
});
