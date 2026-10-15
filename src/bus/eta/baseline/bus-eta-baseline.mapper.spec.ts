/**
 * The baseline shuttle_eta document (design D9): a TMAP prediction, keyed by
 * run and source, expires 24 hours after its fetch.
 */
import type { EtaRun } from "../bus-eta.types";
import { baselineDoc } from "./bus-eta-baseline.mapper";

const RUN: EtaRun = {
  serviceId: "campus-inja",
  routeType: "regular",
  date: "2026-10-12",
  time: "10:00",
  departAt: new Date("2026-10-12T01:00:00.000Z"),
};
const FETCHED = new Date("2026-10-12T00:20:00.000Z");

describe("baselineDoc", () => {
  it("a prediction expires 24 hours after its fetch (TMAP terms)", () => {
    // Act
    const doc = baselineDoc(RUN, [0, 3000, 3200], FETCHED);

    // Assert
    expect(doc).toMatchObject({ _id: "campus-inja|regular|2026-10-12|10:00|baseline", kind: "baseline", source: "tmap" });
    expect(doc.expiresAt.toISOString()).toBe("2026-10-13T00:20:00.000Z");
    expect(doc).not.toHaveProperty("frozen");
  });
});
