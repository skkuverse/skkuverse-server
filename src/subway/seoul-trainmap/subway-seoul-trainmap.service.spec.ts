/**
 * SubwaySeoulTrainmapService over a scripted client (the typed fake in
 * __tests__/helpers/fakes/subway/). What it guards: one crawl per line, its
 * trains mapped through the station table it is given and stamped with the
 * crawl time it is given, and a page that does not parse rejecting, so the
 * caller's poller reports failing. Parsing is
 * subway-seoul-trainmap.mapper.spec.ts's.
 */
import { FakeSubwaySeoulTrainmapClient } from "../../../__tests__/helpers/fakes/subway/subway-seoul-trainmap.client.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { SubwaySeoulTrainmapClient } from "./subway-seoul-trainmap.client";
import { SubwaySeoulTrainmapService } from "./subway-seoul-trainmap.service";

const STATION_ID_BY_NAME = new Map([["성균관대", "KR-1-0153"]]);
const OBSERVED_AT = new Date("2026-10-16T11:45:00Z");
const PAGE = `<div class="1line_korail"><div class="T1711_Y_2_v2 tip"
     title="K0493열차  성균관대 출발 서동탄행" data-statnTcd="1749"></div><div class="T1712_Y_2_v2 tip"
     title="K0491열차  병점 도착 서동탄행" data-statnTcd="1749"></div></div>`;

function setup() {
  const client = new FakeSubwaySeoulTrainmapClient();
  return { client, service: new SubwaySeoulTrainmapService(asReal<SubwaySeoulTrainmapClient>(client)) };
}

describe("SubwaySeoulTrainmapService.listLineEvents", () => {
  it("crawls the line once and maps its trains at covered stations, stamped with the crawl time", async () => {
    // Arrange
    const { client, service } = setup();
    client.pages.set("1", PAGE);

    // Act
    const events = await service.listLineEvents("1", STATION_ID_BY_NAME, OBSERVED_AT);

    // Assert
    expect(client.calls).toEqual(["1"]);
    expect(events).toEqual([{ trainNo: "0493", stationId: "KR-1-0153", state: "departed", stateChangedAt: OBSERVED_AT, destination: "서동탄" }]);
  });

  it("rejects a page without trains as a parse failure", async () => {
    // Arrange
    const { client, service } = setup();
    client.pages.set("1", '<div class="1line_metro"></div>');

    // Act & Assert
    await expect(service.listLineEvents("1", STATION_ID_BY_NAME, OBSERVED_AT)).rejects.toMatchObject({ source: "seoul-trainmap", code: "unexpected_shape" });
  });
});
