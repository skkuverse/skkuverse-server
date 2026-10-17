/**
 * toStationEtas places TOPIS busList rows by TOPIS ord, confirmed by the
 * station ID at that ord. Name matching dropped ETAs when TOPIS renamed a
 * stop and piled both ETAs of a same-named stop pair onto the first one. ID
 * matching alone can't tell 02's loop terminal (ord 1 departing, ord 27
 * arriving) apart.
 */

import { FakeBusRegistryRepository } from "../../../../__tests__/helpers/fakes/bus/bus-registry.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import type { BusRegistryRepository } from "../../registry/bus-registry.repository";
import { BusRegistryService } from "../../registry/bus-registry.service";
import type { RegistryRoute } from "../../registry/bus-registry.types";
import { toStationEtas } from "./bus-realtime-group.rules";

describe("toStationEtas", () => {
  // WHY: the routes as the registry seeds them from the committed snapshot, which these stop ids come from.
  let r02: RegistryRoute;
  let r07: RegistryRoute;

  beforeAll(async () => {
    const registry = new BusRegistryService(asReal<BusRegistryRepository>(new FakeBusRegistryRepository()), { now: () => new Date("2026-10-17T12:00:00Z") });
    await registry.onModuleInit();
    [r02, r07] = [await registry.routeOf("jongro02"), await registry.routeOf("jongro07")];
  });

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
        { stationId: "100900197", sequence: "6", stationName: "명륜새마을금고", eta: "" },
      ]),
    ).toEqual([]);
    expect(toStationEtas(r07, undefined)).toEqual([]);
  });
});
