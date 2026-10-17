/**
 * SubwaySeoulTrainmapService over a scripted client (the typed fake in
 * __tests__/helpers/fakes/subway/). What it guards: one crawl per line, its
 * trains mapped through the station table it is given and stamped with the
 * crawl time it is given, and a page that does not parse rejecting, so the
 * caller's poller reports failing. A line with no train is no failure until it
 * has had none for over MAX_EMPTY_LINE_MS of crawls at most
 * MAX_EMPTY_CRAWL_GAP_MS apart: each morning a line has no train for a while
 * after the service window opens (line 4 at 05:16 KST on 2026-10-17), and the
 * overnight closure is no crawl. Parsing is
 * subway-seoul-trainmap.mapper.spec.ts's.
 */
import { FakeSubwaySeoulTrainmapClient } from "../../../__tests__/helpers/fakes/subway/subway-seoul-trainmap.client.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { SubwaySeoulTrainmapClient } from "./subway-seoul-trainmap.client";
import { MAX_EMPTY_CRAWL_GAP_MS, MAX_EMPTY_LINE_MS } from "./subway-seoul-trainmap.constants";
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
    expect(events).toEqual([{ trainNo: "0493", platformId: "KR-1-0153", state: "departed", stateChangedAt: OBSERVED_AT, destination: "서동탄" }]);
  });

  it("rejects a page without the line's blocks as a parse failure", async () => {
    // Arrange
    const { client, service } = setup();
    client.pages.set("1", "<html>점검 중</html>");

    // Act & Assert
    await expect(service.listLineEvents("1", STATION_ID_BY_NAME, OBSERVED_AT)).rejects.toMatchObject({ source: "seoul-trainmap", code: "unexpected_shape" });
  });
});

describe("SubwaySeoulTrainmapService.listLineEvents on a line with no train", () => {
  const EMPTY_LINE_4 = '<div class="4line_metro"></div><div class="4line_korail"></div>';
  const SERVICE_START = new Date("2026-10-16T20:16:00Z");
  const after = (start: Date, ms: number): Date => new Date(start.getTime() + ms);
  const STEP_MS = MAX_EMPTY_CRAWL_GAP_MS / 2;

  async function crawlEmptyUntil(service: SubwaySeoulTrainmapService, start: Date, lastMs: number): Promise<void> {
    for (let ms = 0; ms <= lastMs; ms += STEP_MS) await service.listLineEvents("4", STATION_ID_BY_NAME, after(start, ms));
  }

  it("answers no events for line 4's empty page at 05:16 KST, as at the start of service on 2026-10-17", async () => {
    // Arrange
    const { client, service } = setup();
    client.pages.set("4", EMPTY_LINE_4);

    // Act
    const events = await service.listLineEvents("4", STATION_ID_BY_NAME, SERVICE_START);

    // Assert
    expect(events).toEqual([]);
  });

  it("answers no events while the line has been empty for MAX_EMPTY_LINE_MS, and rejects once it has been empty longer", async () => {
    // Arrange
    const { client, service } = setup();
    client.pages.set("4", EMPTY_LINE_4);
    await crawlEmptyUntil(service, SERVICE_START, MAX_EMPTY_LINE_MS);

    // Act
    const overdue = service.listLineEvents("4", STATION_ID_BY_NAME, after(SERVICE_START, MAX_EMPTY_LINE_MS + 1000));

    // Assert
    await expect(overdue).rejects.toMatchObject({ source: "seoul-trainmap", code: "unexpected_shape", message: expect.stringContaining("line 4") });
  });

  it("starts the spell over after a crawl that finds a train", async () => {
    // Arrange
    const { client, service } = setup();
    client.pages.set("4", EMPTY_LINE_4);
    await crawlEmptyUntil(service, SERVICE_START, MAX_EMPTY_LINE_MS);
    client.pages.set("4", `<div class="4line_metro">${'<div class="T0421_Y_1_v2 tip" title="4050열차  동대문 도착 진접행"></div>'}</div>`);
    await service.listLineEvents("4", STATION_ID_BY_NAME, after(SERVICE_START, MAX_EMPTY_LINE_MS + 1000));
    client.pages.set("4", EMPTY_LINE_4);

    // Act
    const events = await service.listLineEvents("4", STATION_ID_BY_NAME, after(SERVICE_START, MAX_EMPTY_LINE_MS + 2000));

    // Assert
    expect(events).toEqual([]);
  });

  it("does not count the overnight closure, a gap of over MAX_EMPTY_CRAWL_GAP_MS between crawls, toward the spell", async () => {
    // Arrange
    const { client, service } = setup();
    client.pages.set("4", EMPTY_LINE_4);
    const lastNightAt = new Date("2026-10-16T15:50:00Z");
    await crawlEmptyUntil(service, lastNightAt, MAX_EMPTY_LINE_MS);

    // Act
    const events = await service.listLineEvents("4", STATION_ID_BY_NAME, after(lastNightAt, MAX_EMPTY_LINE_MS + MAX_EMPTY_CRAWL_GAP_MS + 1000));

    // Assert
    expect(events).toEqual([]);
  });

  it("keeps each line's spell apart", async () => {
    // Arrange
    const { client, service } = setup();
    client.pages.set("4", EMPTY_LINE_4);
    client.pages.set("1", '<div class="1line_metro"></div>');
    await crawlEmptyUntil(service, SERVICE_START, MAX_EMPTY_LINE_MS);

    // Act
    const events = await service.listLineEvents("1", STATION_ID_BY_NAME, after(SERVICE_START, MAX_EMPTY_LINE_MS + 1000));

    // Assert
    expect(events).toEqual([]);
  });
});
