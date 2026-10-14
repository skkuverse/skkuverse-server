/**
 * toStationEtas places TOPIS busList rows by TOPIS ord, confirmed by the
 * station ID at that ord. Name matching dropped ETAs when TOPIS renamed a
 * stop and piled both ETAs of a same-named stop pair onto the first one. ID
 * matching alone can't tell 02's loop terminal (ord 1 departing, ord 27
 * arriving) apart.
 */

import { jongroRoutes } from "../../bus.config";
import { toStationEtas } from "./bus-realtime-group.rules";

describe("toStationEtas", () => {
  const r02 = jongroRoutes.find((r) => r.id === "jongro02")!;
  const r07 = jongroRoutes.find((r) => r.id === "jongro07")!;

  it("puts each same-named stop's ETA on its own index", () => {
    // Act
    const etas = toStationEtas(r07, [
      { stationId: "100000423", sequence: "21", stationName: "비천당", eta: "2분후[1번째 전]" },
      { stationId: "100000424", sequence: "3", stationName: "비천당", eta: "7분후[3번째 전]" },
    ]);

    // Assert
    expect(etas).toEqual([
      { stationIndex: 20, eta: "2분후[1번째 전]" },
      { stationIndex: 2, eta: "7분후[3번째 전]" },
    ]);
  });

  it("keeps the departing and arriving ETAs of a loop terminal apart", () => {
    // Act
    const etas = toStationEtas(r02, [
      { stationId: "100900204", sequence: "1", stationName: "성균관대학교", eta: "출발대기" },
      { stationId: "100900204", sequence: "27", stationName: "성균관대학교", eta: "1분45초후[1번째 전]" },
    ]);

    // Assert
    expect(etas).toEqual([
      { stationIndex: 0, eta: "출발대기" },
      { stationIndex: 26, eta: "1분45초후[1번째 전]" },
    ]);
  });

  it("matches by ID even when the row carries a different name", () => {
    // Act
    const etas = toStationEtas(r07, [
      { stationId: "100000125", sequence: "12", stationName: "옛 이름", eta: "곧 도착" },
    ]);

    // Assert
    expect(etas).toEqual([{ stationIndex: 11, eta: "곧 도착" }]);
  });

  it("falls back to the ID when TOPIS has reordered the stop", () => {
    // Act
    const etas = toStationEtas(r07, [
      { stationId: "100900197", sequence: "9", stationName: "명륜새마을금고", eta: "곧 도착" },
    ]);

    // Assert
    expect(etas).toEqual([{ stationIndex: 5, eta: "곧 도착" }]);
  });

  it("drops unmapped stations, rows without an eta, and non-array input", () => {
    // Act & Assert
    expect(
      toStationEtas(r07, [
        { stationId: "999999999", sequence: "1", stationName: "비천당", eta: "곧 도착" },
        { stationId: "100900197", sequence: "6", stationName: "명륜새마을금고" },
      ]),
    ).toEqual([]);
    expect(toStationEtas(r07, undefined)).toEqual([]);
  });
});
