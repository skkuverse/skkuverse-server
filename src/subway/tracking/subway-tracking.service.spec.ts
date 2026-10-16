/**
 * SubwayTrackingService over FakeSubwayRepository, the real timetable door
 * (on FakeHolidaysService and the committed weekday tables), the real estimate
 * door and a scripted Clock, fed one upstream's observations per tick as the
 * pollers hand them. What it guards: each tick replaces both stations'
 * documents with their next three trains per direction, at absolute instants
 * and the tick's time; a train late at `의왕` is estimated late at `성균관대`; a
 * departure the train map shows ends a train the API still lists as arrived;
 * a positive countdown is served `live` until its source has been silent for
 * 90 s; a train missing for a minute keeps its delay and position, and after
 * 90 s is served from the timetable; a countdown far from the estimate is
 * logged once per train within the throttle; a train only in countdown rows
 * is not served; an upstream is not observed outside the service window; and
 * a failing upstream rejects its tick and writes nothing.
 * Its timetable-only document, which the arrivals route serves for a stale
 * state, lists every train `scheduled`, whatever the tracker has observed.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { FakeHolidaysService } from "../../../__tests__/helpers/fakes/holidays/holidays.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { FakeSubwayRepository } from "../../../__tests__/helpers/fakes/subway/subway.repository.fake";
import type { HolidaysService } from "../../holidays/holidays.service";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { SubwayEstimateService } from "../estimate/subway-estimate.service";
import type { SubwayRepository } from "../subway.repository";
import type { CountdownRow, SubwayProvider, TrainEvent } from "../subway.types";
import { SubwayTimetableService } from "../timetable/subway-timetable.service";
import { SubwayTrackingService } from "./subway-tracking.service";

const at = (kst: string): Date => new Date(`2026-10-16T${kst}+09:00`);
const SUNGKYUNKWAN = "KR-1-0153";
const HYEHWA = "S1-4-420";

function setup() {
  let now = at("20:39:10");
  const repository = new FakeSubwayRepository();
  const timetable = new SubwayTimetableService(asReal<HolidaysService>(new FakeHolidaysService()));
  const clock = { now: () => now } as Clock;
  const service = new SubwayTrackingService(asReal<SubwayRepository>(repository), timetable, new SubwayEstimateService(), clock);
  const tickAt = (kst: string, provider: SubwayProvider): Promise<void> => {
    now = at(kst);
    return service.track(provider);
  };
  return { service, repository, tickAt };
}

function upstream(source: string, events: TrainEvent[] = [], countdownRows: CountdownRow[] = []): SubwayProvider {
  return { observe: async () => ({ source, events, countdownRows }) };
}

const api = (events: TrainEvent[] = [], countdownRows: CountdownRow[] = []) => upstream("seoul-subway-api", events, countdownRows);
const trainMap = (events: TrainEvent[] = []) => upstream("seoul-trainmap", events);

function event(trainNo: string, stationId: string, state: TrainEvent["state"], kst: string, destination: string): TrainEvent {
  return { trainNo, stationId, state, stateChangedAt: at(kst), destination };
}

const countdown = (trainNo: string, generatedKst: string, remainingSec: number): CountdownRow => ({
  trainNo,
  stationId: HYEHWA,
  generatedAt: at(generatedKst),
  remainingSec,
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("SubwayTrackingService.track", () => {
  it("replaces both stations' documents with three trains per direction at the tick's time", async () => {
    // Arrange
    const { repository, tickAt } = setup();

    // Act
    await tickAt("20:39:10", api());

    // Assert
    expect([...repository.docs.keys()]).toEqual([SUNGKYUNKWAN, HYEHWA]);
    for (const doc of repository.docs.values()) {
      expect(doc.generatedAt).toEqual(at("20:39:10"));
      expect(doc.serviceDate).toBe("2026-10-16");
      expect([doc.directions.up.length, doc.directions.down.length]).toEqual([3, 3]);
    }
  });

  it("estimates southbound 0493, arriving at 의왕 90 s late, 90 s after its scheduled 성균관대 arrival", async () => {
    // Arrange
    const { repository, tickAt } = setup();

    // Act
    await tickAt("20:39:10", api([event("0493", "KR-1-P152", "arrived", "20:39:00", "서동탄")]));

    // Assert
    expect(repository.docs.get(SUNGKYUNKWAN)?.directions.down[0]).toEqual({
      trainNo: "0493",
      destination: "서동탄",
      express: false,
      arrivalAt: at("20:42:30"),
      source: "estimated",
      position: { stationId: "KR-1-P152", state: "arrived" },
    });
  });

  it("stops listing 0493 at 성균관대 once the train map shows it departed, while the API still says arrived", async () => {
    // Arrange
    const { repository, tickAt } = setup();
    const stuck = event("0493", SUNGKYUNKWAN, "arrived", "20:41:05", "서동탄");
    await tickAt("20:41:10", api([stuck]));
    const listedBefore = repository.docs.get(SUNGKYUNKWAN)?.directions.down.map((t) => t.trainNo);

    // Act
    await tickAt("20:41:40", trainMap([event("0493", SUNGKYUNKWAN, "departed", "20:41:40", "서동탄")]));
    await tickAt("20:41:50", api([stuck]));

    // Assert
    expect(listedBefore).toContain("0493");
    expect(repository.docs.get(SUNGKYUNKWAN)?.directions.down.map((t) => t.trainNo)).not.toContain("0493");
  });

  it("serves a 혜화 row of 150 s generated 40 s before the tick as live, at its generation plus 150 s", async () => {
    // Arrange
    const { repository, tickAt } = setup();

    // Act
    await tickAt("20:41:00", api([], [countdown("4674", "20:40:20", 150)]));

    // Assert
    const train = repository.docs.get(HYEHWA)?.directions.up.find((t) => t.trainNo === "4674");
    expect([train?.arrivalAt, train?.source]).toEqual([at("20:42:50"), "live"]);
  });

  it("keeps the API's countdowns through a train-map tick and drops them once the API has been silent over 90 s", async () => {
    // Arrange
    const { repository, tickAt } = setup();
    await tickAt("20:41:00", api([], [countdown("4674", "20:40:20", 150)]));
    const sourceOf4674 = () => repository.docs.get(HYEHWA)?.directions.up.find((t) => t.trainNo === "4674")?.source;

    // Act
    await tickAt("20:41:15", trainMap());
    const afterTrainMap = sourceOf4674();
    await tickAt("20:42:31", trainMap());

    // Assert
    expect(afterTrainMap).toBe("live");
    expect(sourceOf4674()).toBe("scheduled");
  });

  it("keeps 0692's delay and position while it is missing for a minute, and serves it from the timetable after 90 s", async () => {
    // Arrange
    const { repository, tickAt } = setup();
    await tickAt("20:30:05", trainMap([event("0692", "KR-1-P154", "departed", "20:30:00", "광운대")]));
    const train0692 = () => repository.docs.get(SUNGKYUNKWAN)?.directions.up.find((t) => t.trainNo === "0692");

    // Act
    await tickAt("20:31:05", trainMap());
    const missingAMinute = train0692();
    await tickAt("20:31:36", trainMap());

    // Assert
    expect(missingAMinute).toMatchObject({ arrivalAt: at("20:32:30"), source: "estimated", position: { stationId: "KR-1-P154", state: "departed" } });
    expect(train0692()).toMatchObject({ arrivalAt: at("20:31:30"), source: "scheduled", position: null });
  });

  it("logs a countdown over 120 s from the estimate once per train within the throttle", async () => {
    // Arrange
    const { tickAt } = setup();
    const far = countdown("4674", "20:40:20", 600);

    // Act
    await tickAt("20:41:00", api([], [far]));
    await tickAt("20:41:10", api([], [far]));

    // Assert
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "subway.tracking.countdown_diverged", trainNo: "4674", stationId: HYEHWA, divergenceSec: 470 }),
      expect.any(String),
    );
  });

  it("serves no train that only a countdown row names", async () => {
    // Arrange
    const { repository, tickAt } = setup();

    // Act
    await tickAt("20:41:00", api([], [countdown("9999", "20:40:20", 60)]));

    // Assert
    const trainNos = [...repository.docs.values()].flatMap((doc) => [...doc.directions.up, ...doc.directions.down].map((t) => t.trainNo));
    expect(trainNos).not.toContain("9999");
  });

  it("observes no upstream and writes nothing at 03:00 KST, outside the service window", async () => {
    // Arrange
    const { repository, tickAt } = setup();
    const observe = jest.fn(async () => ({ source: "seoul-subway-api", events: [], countdownRows: [] }));

    // Act
    await tickAt("03:00:00", { observe });

    // Assert
    expect(observe).not.toHaveBeenCalled();
    expect(repository.replaces).toBe(0);
  });

  it("rejects the tick of a failing upstream and writes nothing", async () => {
    // Arrange
    const { repository, service } = setup();
    const failure = new Error("seoul-trainmap: HTTP 503");

    // Act & Assert
    await expect(service.track({ observe: () => Promise.reject(failure) })).rejects.toBe(failure);
    expect(repository.replaces).toBe(0);
  });
});

describe("SubwayTrackingService.findScheduledArrivals", () => {
  it("builds a station's document from its timetable alone, every train scheduled, after observations too", async () => {
    // Arrange
    const { service, tickAt } = setup();
    await tickAt("20:39:10", api([event("0493", "KR-1-P152", "arrived", "20:39:00", "서동탄")]));

    // Act
    const doc = await service.findScheduledArrivals(SUNGKYUNKWAN, at("20:39:20"));

    // Assert
    expect([doc?._id, doc?.generatedAt, doc?.serviceDate]).toEqual([SUNGKYUNKWAN, at("20:39:20"), "2026-10-16"]);
    expect(doc?.directions.down[0]).toMatchObject({ trainNo: "0493", arrivalAt: at("20:41:00"), source: "scheduled", position: null });
    const trains = [...(doc?.directions.up ?? []), ...(doc?.directions.down ?? [])];
    expect([trains.length, trains.every((t) => t.source === "scheduled")]).toEqual([6, true]);
  });

  it("finds no document for a station it does not serve", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const doc = await service.findScheduledArrivals("S1-2-222", at("20:39:20"));

    // Assert
    expect(doc).toBeNull();
  });
});
