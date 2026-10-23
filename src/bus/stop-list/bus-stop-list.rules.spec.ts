/**
 * The decisions of the stop list: which campus a stop is filed under (its catalog field, else HSSC for a stop at a
 * Jongno pole, else none), and an ETag that follows the body. Where a station heads and whether riders board there
 * are the stop page's rules in src/bus/bus.rules.ts.
 */
import type { IndexedStop } from "../stop-index/bus-stop-index.types";
import { toStopCampus, toStopListEtag } from "./bus-stop-list.rules";

const pole = { arsId: "01592", topisId: "100900075", stationName: "혜화역1번출구" };
const localStop = { id: "nsc-n-center", name: { ko: "N센터 앞" } };

describe("toStopCampus", () => {
  it.each<[string, Pick<IndexedStop, "localStop" | "poles">, string | null]>([
    ["a catalog stop's own campus", { localStop: { ...localStop, campus: "nsc" }, poles: [] }, "nsc"],
    ["a catalog stop's own campus over its aliased pole's", { localStop: { ...localStop, campus: "nsc" }, poles: [pole] }, "nsc"],
    ["인사캠 for a TOPIS pole", { localStop: null, poles: [pole] }, "hssc"],
    ["인사캠 for a catalog stop without one that aliases a Jongno pole", { localStop, poles: [pole] }, "hssc"],
    ["none for a catalog stop without one at no pole", { localStop, poles: [] }, null],
  ])("files %s", (_case, stop, expected) => {
    // Act & Assert
    expect(toStopCampus(stop)).toBe(expected);
  });
});

describe("toStopListEtag", () => {
  const body = { stops: [{ id: "seoul-01592", name: { ko: "혜화역1번출구", en: "혜화역1번출구", zh: "혜화역1번출구" }, coords: null, arsIds: ["01592"], campus: "hssc" as const, routes: [] }] };

  it("is a quoted tag that stays while the body stays", () => {
    // Act
    const etag = toStopListEtag(body);

    // Assert
    expect(etag).toMatch(/^"stops-[0-9a-f]{32}"$/);
    expect(toStopListEtag(structuredClone(body))).toBe(etag);
  });

  it("changes when a stop's coordinates do", () => {
    // Arrange
    const moved = { stops: [{ ...body.stops[0]!, coords: { lat: 37.58, lng: 127 } }] };

    // Act & Assert
    expect(toStopListEtag(moved)).not.toBe(toStopListEtag(body));
  });
});
