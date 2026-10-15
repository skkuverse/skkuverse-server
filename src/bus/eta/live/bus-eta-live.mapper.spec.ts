/**
 * The live shuttle_eta document (design D9): a NAVER value expires 8 days
 * after its departure, and a fixed one says when it was fixed.
 */
import type { EtaRun } from "../bus-eta.types";
import { liveDoc } from "./bus-eta-live.mapper";

const RUN: EtaRun = {
  serviceId: "campus-inja",
  routeType: "regular",
  date: "2026-10-12",
  time: "10:00",
  departAt: new Date("2026-10-12T01:00:00.000Z"),
};
const FETCHED = new Date("2026-10-12T00:20:00.000Z");

describe("liveDoc", () => {
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
