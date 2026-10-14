/**
 * The shuttle_eta documents (design D9): keyed by run and source; a TMAP
 * prediction expires 24 hours after its fetch, a NAVER value 8 days after its
 * departure, and a fixed one says when it was fixed.
 */
import { baselineDoc, etaDocId, liveDoc } from "./bus-eta.mapper";
import type { EtaRun } from "./bus-eta.types";

const RUN: EtaRun = {
  serviceId: "campus-inja",
  routeType: "regular",
  date: "2026-10-12",
  time: "10:00",
  departAt: new Date("2026-10-12T01:00:00.000Z"),
};
const FETCHED = new Date("2026-10-12T00:20:00.000Z");

describe("etaDocId, baselineDoc and liveDoc", () => {
  it("are keyed by run and source", () => {
    // Act & Assert
    expect(etaDocId(RUN, "live")).toBe("campus-inja|regular|2026-10-12|10:00|live");
  });

  it("a prediction expires 24 hours after its fetch (TMAP terms)", () => {
    // Act
    const doc = baselineDoc(RUN, [0, 3000, 3200], FETCHED);

    // Assert
    expect(doc).toMatchObject({ _id: "campus-inja|regular|2026-10-12|10:00|baseline", kind: "baseline", source: "tmap" });
    expect(doc.expiresAt.toISOString()).toBe("2026-10-13T00:20:00.000Z");
    expect(doc).not.toHaveProperty("frozen");
  });

  it("a live value expires 8 days after its departure; a frozen one says when it was fixed", () => {
    // Act
    const live = liveDoc(RUN, { offsetsSec: [0, 3000, 3200], fetchedAt: FETCHED });

    // Assert
    expect(live.expiresAt.toISOString()).toBe("2026-10-20T01:00:00.000Z");
    expect(live).not.toHaveProperty("frozen");
    const frozenAt = new Date("2026-10-12T01:00:30.000Z");
    expect(liveDoc(RUN, { offsetsSec: [0, 3000, 3200], fetchedAt: frozenAt, frozenAt })).toMatchObject({ frozen: true, frozenAt, source: "naver" });
  });
});

