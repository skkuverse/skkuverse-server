/**
 * The live shuttle_eta document (design D9): a NAVER value expires 8 days
 * after its departure, and a fixed one says when it was fixed; a bus-lane run's
 * value records its travel model, and any other carries no `travel` key.
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

describe("liveDoc travel", () => {
  it("records the travel model it is given, fixed or not", () => {
    // Arrange
    const travel = { model: "busLane" as const, corridorCarSec: 1920, corridorSec: 1080, spanCount: 6, coverage: 0.81 };
    const frozenAt = new Date("2026-10-12T01:00:30.000Z");

    // Act
    const live = liveDoc(RUN, { offsetsSec: [0, 3000, 3200], fetchedAt: FETCHED, travel });
    const fixed = liveDoc(RUN, { offsetsSec: [0, 3000, 3200], fetchedAt: frozenAt, frozenAt, travel: { model: "car" } });

    // Assert
    expect(live.travel).toEqual(travel);
    expect(fixed.travel).toEqual({ model: "car" });
  });

  it("leaves the key out without a travel model", () => {
    // Act
    const live = liveDoc(RUN, { offsetsSec: [0, 3000, 3200], fetchedAt: FETCHED, travel: undefined });

    // Assert
    expect(live).not.toHaveProperty("travel");
  });
});

describe("liveDoc life (design D7)", () => {
  it("keeps a fixed value at least 8 days after its run: predictions reuse the fixed value of the same weekday 7 days earlier, with a day's margin for the refresh", () => {
    // Arrange
    const reuseAfterMs = 7 * 24 * 60 * 60_000;
    const marginMs = 24 * 60 * 60_000;

    // Act
    const fixed = liveDoc(RUN, { offsetsSec: [0, 3000, 3200], fetchedAt: FETCHED, frozenAt: FETCHED });

    // Assert
    expect(fixed.expiresAt.getTime() - RUN.departAt.getTime()).toBeGreaterThanOrEqual(reuseAfterMs + marginMs);
  });
});
