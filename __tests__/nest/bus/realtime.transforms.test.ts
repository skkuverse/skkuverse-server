/**
 * buildStationEtas matches TOPIS busList rows to registry stations by TOPIS
 * station ID. Name matching dropped ETAs when TOPIS renamed a stop and piled
 * both ETAs of a same-named stop pair onto the first occurrence.
 */

import { buildStationEtas } from "../../../src/bus/realtime/realtime.transforms";
import { getJongroRouteById } from "../../../src/bus/registry/jongro-registry";

describe("buildStationEtas", () => {
  const r07 = getJongroRouteById("jongro07")!;

  it("puts each same-named stop's ETA on its own index", () => {
    const etas = buildStationEtas(r07.mapping, [
      { stationId: "100000423", stationName: "비천당", eta: "2분후[1번째 전]" },
      { stationId: "100000424", stationName: "비천당", eta: "7분후[3번째 전]" },
    ]);
    expect(etas).toEqual([
      { stationIndex: 15, eta: "2분후[1번째 전]" },
      { stationIndex: 19, eta: "7분후[3번째 전]" },
    ]);
  });

  it("matches by ID even when the row carries a different name", () => {
    const etas = buildStationEtas(r07.mapping, [
      { stationId: "100000125", stationName: "옛 이름", eta: "곧 도착" },
    ]);
    expect(etas).toEqual([{ stationIndex: 6, eta: "곧 도착" }]);
  });

  it("drops unmapped stations, rows without an eta, and non-array input", () => {
    expect(
      buildStationEtas(r07.mapping, [
        { stationId: "999999999", stationName: "비천당", eta: "곧 도착" },
        { stationId: "100900197", stationName: "명륜새마을금고" },
      ]),
    ).toEqual([]);
    expect(buildStationEtas(r07.mapping, undefined)).toEqual([]);
  });
});
