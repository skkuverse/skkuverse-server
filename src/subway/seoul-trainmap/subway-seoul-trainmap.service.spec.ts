/**
 * SubwaySeoulTrainmapService over a scripted client (the typed fake in
 * __tests__/helpers/fakes/subway/). What it guards: one request per crawl, the
 * page of every line (`line=0`), each line's blocks then read on their own:
 * its trains mapped through the platform table it is given and stamped with
 * the crawl time it is given, and a line whose blocks do not parse a failure
 * of that line alone, beside the others' events; a request that fails rejects
 * the crawl, so the caller's poller reports failing. A line with no train is
 * no failure until it has had none for over MAX_EMPTY_LINE_MS of crawls at
 * most MAX_EMPTY_CRAWL_GAP_MS apart: each morning a line has no train for a
 * while after the service window opens (line 4 at 05:16 KST on 2026-10-17),
 * and the overnight closure is no crawl. Parsing is
 * subway-seoul-trainmap.mapper.spec.ts's.
 */
import fs from "fs";
import path from "path";
import { FakeSubwaySeoulTrainmapClient } from "../../../__tests__/helpers/fakes/subway/subway-seoul-trainmap.client.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { TrainEvent } from "../subway.types";
import type { SubwaySeoulTrainmapClient } from "./subway-seoul-trainmap.client";
import { MAX_EMPTY_CRAWL_GAP_MS, MAX_EMPTY_LINE_MS } from "./subway-seoul-trainmap.constants";
import { SubwaySeoulTrainmapService } from "./subway-seoul-trainmap.service";

const STATION_ID_BY_NAME = new Map([["성균관대", "KR-1-0153"]]);
const LINE_4_NAMES = new Map([["동대문", "S1-4-421"], ["길음", "S1-4-417"]]);
const OBSERVED_AT = new Date("2026-10-16T11:45:00Z");
const ALL_LINES = "0";
const PAGE = `<div class="1line_korail"><div class="T1711_Y_2_v2 tip"
     title="K0493열차  성균관대 출발 서동탄행" data-statnTcd="1749"></div><div class="T1712_Y_2_v2 tip"
     title="K0491열차  병점 도착 서동탄행" data-statnTcd="1749"></div></div>`;
const ALL_LINES_PAGE = fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/subway/fixtures/trainmap-all-lines.html"), "utf8");

const line1 = { trainMapLine: "1", platformIdByName: STATION_ID_BY_NAME };
const line4 = { trainMapLine: "4", platformIdByName: LINE_4_NAMES };

function setup() {
  const client = new FakeSubwaySeoulTrainmapClient();
  return { client, service: new SubwaySeoulTrainmapService(asReal<SubwaySeoulTrainmapClient>(client)) };
}

const eventsOf = (results: readonly PromiseSettledResult<TrainEvent[]>[]): TrainEvent[] =>
  results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

async function listEvents(service: SubwaySeoulTrainmapService, line: typeof line1, observedAt: Date): Promise<TrainEvent[]> {
  const [result] = await service.listLineEventResults([line], observedAt);
  if (result?.status !== "fulfilled") throw result?.reason;
  return result.value;
}

describe("SubwaySeoulTrainmapService.listLineEventResults", () => {
  it("crawls the page of every line once and maps each line's trains at covered stations, stamped with the crawl time", async () => {
    // Arrange
    const { client, service } = setup();
    client.pages.set(ALL_LINES, PAGE);

    // Act
    const results = await service.listLineEventResults([line1], OBSERVED_AT);

    // Assert
    expect(client.calls).toEqual([ALL_LINES]);
    expect(eventsOf(results)).toEqual([{ trainNo: "0493", platformId: "KR-1-0153", state: "departed", stateChangedAt: OBSERVED_AT, destination: "서동탄" }]);
  });

  it("reads lines 1 and 4 from the one 2026-10-17 21:16 page in one request, each through its own table", async () => {
    // Arrange
    const { client, service } = setup();
    client.pages.set(ALL_LINES, ALL_LINES_PAGE);

    // Act
    const results = await service.listLineEventResults([line1, line4], OBSERVED_AT);

    // Assert
    expect(client.calls).toEqual([ALL_LINES]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(eventsOf(results).map((e) => `${e.trainNo} ${e.platformId} ${e.state}`)).toEqual(["4158 S1-4-417 approaching", "4669 S1-4-421 arrived"]);
  });

  it("One line's page breaks: keeps line 1's events when line 4's block holds a train of another shape, and fails line 4 alone", async () => {
    // Arrange
    const { client, service } = setup();
    const broken = '<div class="4line_metro"><div class="T0421_Q_9_v2 tip" title="4050열차  동대문 도착 진접행"></div></div>';
    client.pages.set(ALL_LINES, `${PAGE}${broken}`);

    // Act
    const results = await service.listLineEventResults([line1, line4], OBSERVED_AT);

    // Assert
    expect(eventsOf(results).map((e) => e.trainNo)).toEqual(["0493"]);
    expect(results[1]).toMatchObject({ status: "rejected", reason: { source: "seoul-trainmap", code: "unexpected_shape", message: expect.stringContaining("line 4") } });
  });

  it("fails a line without blocks on the page as a parse failure", async () => {
    // Arrange
    const { client, service } = setup();
    client.pages.set(ALL_LINES, "<html>점검 중</html>");

    // Act
    const results = await service.listLineEventResults([line1], OBSERVED_AT);

    // Assert
    expect(results).toEqual([{ status: "rejected", reason: expect.objectContaining({ source: "seoul-trainmap", code: "unexpected_shape" }) }]);
  });

  it("rejects the crawl with the client's error when the request fails", async () => {
    // Arrange
    const { client, service } = setup();
    const failure = new Error("seoul-trainmap: line 0: HTTP 503");
    client.pages.set(ALL_LINES, failure);

    // Act & Assert
    await expect(service.listLineEventResults([line1, line4], OBSERVED_AT)).rejects.toBe(failure);
  });
});

describe("SubwaySeoulTrainmapService.listLineEventResults on a line with no train", () => {
  const EMPTY_LINE_4 = '<div class="4line_metro"></div><div class="4line_korail"></div>';
  const SERVICE_START = new Date("2026-10-16T20:16:00Z");
  const after = (start: Date, ms: number): Date => new Date(start.getTime() + ms);
  const STEP_MS = MAX_EMPTY_CRAWL_GAP_MS / 2;

  async function crawlEmptyUntil(service: SubwaySeoulTrainmapService, start: Date, lastMs: number): Promise<void> {
    for (let ms = 0; ms <= lastMs; ms += STEP_MS) await listEvents(service, line4, after(start, ms));
  }

  it("answers no events for line 4's empty page at 05:16 KST, as at the start of service on 2026-10-17", async () => {
    // Arrange
    const { client, service } = setup();
    client.pages.set(ALL_LINES, EMPTY_LINE_4);

    // Act
    const events = await listEvents(service, line4, SERVICE_START);

    // Assert
    expect(events).toEqual([]);
  });

  it("answers no events while the line has been empty for MAX_EMPTY_LINE_MS, and rejects once it has been empty longer", async () => {
    // Arrange
    const { client, service } = setup();
    client.pages.set(ALL_LINES, EMPTY_LINE_4);
    await crawlEmptyUntil(service, SERVICE_START, MAX_EMPTY_LINE_MS);

    // Act
    const overdue = listEvents(service, line4, after(SERVICE_START, MAX_EMPTY_LINE_MS + 1000));

    // Assert
    await expect(overdue).rejects.toMatchObject({ source: "seoul-trainmap", code: "unexpected_shape", message: expect.stringContaining("line 4") });
  });

  it("starts the spell over after a crawl that finds a train", async () => {
    // Arrange
    const { client, service } = setup();
    client.pages.set(ALL_LINES, EMPTY_LINE_4);
    await crawlEmptyUntil(service, SERVICE_START, MAX_EMPTY_LINE_MS);
    client.pages.set(ALL_LINES, `<div class="4line_metro">${'<div class="T0421_Y_1_v2 tip" title="4050열차  동대문 도착 진접행"></div>'}</div>`);
    await listEvents(service, line4, after(SERVICE_START, MAX_EMPTY_LINE_MS + 1000));
    client.pages.set(ALL_LINES, EMPTY_LINE_4);

    // Act
    const events = await listEvents(service, line4, after(SERVICE_START, MAX_EMPTY_LINE_MS + 2000));

    // Assert
    expect(events).toEqual([]);
  });

  it("does not count the overnight closure, a gap of over MAX_EMPTY_CRAWL_GAP_MS between crawls, toward the spell", async () => {
    // Arrange
    const { client, service } = setup();
    client.pages.set(ALL_LINES, EMPTY_LINE_4);
    const lastNightAt = new Date("2026-10-16T15:50:00Z");
    await crawlEmptyUntil(service, lastNightAt, MAX_EMPTY_LINE_MS);

    // Act
    const events = await listEvents(service, line4, after(lastNightAt, MAX_EMPTY_LINE_MS + MAX_EMPTY_CRAWL_GAP_MS + 1000));

    // Assert
    expect(events).toEqual([]);
  });

  it("keeps each line's spell apart", async () => {
    // Arrange
    const { client, service } = setup();
    client.pages.set(ALL_LINES, EMPTY_LINE_4);
    await crawlEmptyUntil(service, SERVICE_START, MAX_EMPTY_LINE_MS);
    client.pages.set(ALL_LINES, `${EMPTY_LINE_4}<div class="1line_metro"></div>`);

    // Act
    const events = await listEvents(service, line1, after(SERVICE_START, MAX_EMPTY_LINE_MS + 1000));

    // Assert
    expect(events).toEqual([]);
  });
});
