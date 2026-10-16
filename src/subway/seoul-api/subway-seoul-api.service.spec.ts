/**
 * SubwaySeoulApiService over a scripted client (the typed fake in
 * __tests__/helpers/fakes/subway/). What it guards: one request per line or
 * station, its rows mapped through the station table it is given, and a
 * failing request rejecting as it came, so the caller's poller reports it.
 * The payload parsing is subway-seoul-api.client.spec.ts's and the row
 * mapping subway-seoul-api.mapper.spec.ts's.
 */
import { FakeSubwaySeoulApiClient } from "../../../__tests__/helpers/fakes/subway/subway-seoul-api.client.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { SubwaySeoulApiError } from "./subway-seoul-api.error";
import type { SubwaySeoulApiClient } from "./subway-seoul-api.client";
import { SubwaySeoulApiService } from "./subway-seoul-api.service";

const STATION_ID_BY_NAME = new Map([["성균관대", "KR-1-0153"]]);

function setup() {
  const client = new FakeSubwaySeoulApiClient();
  return { client, service: new SubwaySeoulApiService(asReal<SubwaySeoulApiClient>(client)) };
}

describe("SubwaySeoulApiService.listLineEvents", () => {
  it("asks for the line's positions once and maps them to train events", async () => {
    // Arrange
    const { client, service } = setup();
    client.positions.set("1호선", [
      { trainNo: "0493", statnNm: "성균관대", statnTnm: "서동탄", trainSttus: "1", recptnDt: "2026-10-16 20:44:10" },
      { trainNo: "0509", statnNm: "시청", statnTnm: "서동탄", trainSttus: "1", recptnDt: "2026-10-16 20:44:11" },
    ]);

    // Act
    const events = await service.listLineEvents("1호선", STATION_ID_BY_NAME);

    // Assert
    expect(client.calls).toEqual(["realtimePosition 1호선"]);
    expect(events).toEqual([
      { trainNo: "0493", stationId: "KR-1-0153", state: "arrived", stateChangedAt: new Date("2026-10-16T11:44:10Z"), destination: "서동탄" },
    ]);
  });

  it("rejects with the client's error", async () => {
    // Arrange
    const { client, service } = setup();
    client.positions.set("1호선", new SubwaySeoulApiError("realtimePosition: HTTP 500", 500, "ERR_BAD_RESPONSE"));

    // Act & Assert
    await expect(service.listLineEvents("1호선", STATION_ID_BY_NAME)).rejects.toMatchObject({ status: 500, code: "ERR_BAD_RESPONSE" });
  });
});

describe("SubwaySeoulApiService.listStationCountdownRows", () => {
  it("asks for the station's arrivals once and maps them to countdown rows", async () => {
    // Arrange
    const { client, service } = setup();
    client.arrivals.set("성균관대", [{ btrainNo: "0493", statnNm: "성균관대", barvlDt: "120", recptnDt: "2026-10-16 20:44:10" }]);

    // Act
    const countdownRows = await service.listStationCountdownRows("성균관대", STATION_ID_BY_NAME);

    // Assert
    expect(client.calls).toEqual(["realtimeStationArrival 성균관대"]);
    expect(countdownRows).toEqual([
      { trainNo: "0493", stationId: "KR-1-0153", generatedAt: new Date("2026-10-16T11:44:10Z"), remainingSec: 120 },
    ]);
  });
});
