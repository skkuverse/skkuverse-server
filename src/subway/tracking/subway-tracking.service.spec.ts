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
 * logged once per train within the throttle, and so is a rejected one, with
 * its reason; a train only in countdown rows
 * is not served; an upstream is not observed outside the service window; and
 * a failing upstream rejects its tick and writes nothing. On Saturday
 * 2026-10-17 (the holiday tables), shaped like that morning's captures: an
 * express seen departing `성균관대` stays off the list through its events at
 * stations it passes, northbound and southbound, while a late train ahead
 * would lend it a delay; an express first seen at a station it passes is
 * estimated from its departure from its last stop before it; and one seen
 * before its first stop, from the time it is scheduled to pass that station.
 * Its timetable-only document, which the arrivals route serves for a stale
 * state, lists every train `scheduled`, whatever the tracker has observed,
 * and leaves the countdown memory to the ticks.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { FakeHolidaysService } from "../../../__tests__/helpers/fakes/holidays/holidays.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { FakeSubwayRepository } from "../../../__tests__/helpers/fakes/subway/subway.repository.fake";
import type { HolidaysService } from "../../holidays/holidays.service";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { SubwayCountdownService } from "../countdown/subway-countdown.service";
import { SubwayEstimateService } from "../estimate/subway-estimate.service";
import type { SubwayRepository } from "../subway.repository";
import type { CountdownRow, SubwayProvider, TrainEvent } from "../subway.types";
import { SubwayTimetableService } from "../timetable/subway-timetable.service";
import { SubwayTrackingService } from "./subway-tracking.service";

const at = (kst: string): Date => new Date(`2026-10-16T${kst}+09:00`);
const SUNGKYUNKWAN = "KR-1-0153";
const HYEHWA = "S1-4-420";

const onSaturday = (kst: string): Date => new Date(`2026-10-17T${kst}+09:00`);

function setup(atKst = at) {
  let now = atKst("20:39:10");
  const repository = new FakeSubwayRepository();
  const timetable = new SubwayTimetableService(asReal<HolidaysService>(new FakeHolidaysService()));
  const clock = { now: () => now } as Clock;
  const service = new SubwayTrackingService(asReal<SubwayRepository>(repository), timetable, new SubwayEstimateService(new SubwayCountdownService()), clock);
  const tickAt = (kst: string, provider: SubwayProvider): Promise<void> => {
    now = atKst(kst);
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

  it("logs a spent countdown with its reason once per station and train within the throttle, and another train's too", async () => {
    // Arrange
    const { tickAt } = setup();
    const spent = [countdown("4674", "20:40:20", 30), countdown("4676", "20:40:20", 30)];

    // Act
    await tickAt("20:41:00", api([], spent));
    await tickAt("20:41:10", api([], spent));

    // Assert
    const rejected = jest.mocked(logger.info).mock.calls.filter(([fields]) => (fields as { event?: string }).event === "subway.tracking.countdown_rejected");
    expect(rejected.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ trainNo: "4674", stationId: HYEHWA, reason: "spent", liveArrivalAt: at("20:40:50"), suppressed: 0 }),
      expect.objectContaining({ trainNo: "4676", stationId: HYEHWA, reason: "spent", liveArrivalAt: at("20:40:50"), suppressed: 0 }),
    ]);
  });

  it("logs 4676's spent countdown again 10 minutes on, with the rejection it suppressed", async () => {
    // Arrange
    const { tickAt } = setup();
    const spent = [countdown("4676", "20:40:20", 30)];
    await tickAt("20:41:00", api([], spent));
    await tickAt("20:41:10", api([], spent));

    // Act
    await tickAt("20:51:00", api([], [countdown("4676", "20:50:20", 30)]));

    // Assert
    const rejected = jest.mocked(logger.info).mock.calls.filter(([fields]) => (fields as { event?: string }).event === "subway.tracking.countdown_rejected");
    expect(rejected.map(([fields]) => (fields as { suppressed: number }).suppressed)).toEqual([0, 1]);
  });

  it("logs 4674's spent countdown though its divergence was logged 10 s before", async () => {
    // Arrange
    const { tickAt } = setup();
    await tickAt("20:41:00", api([], [countdown("4674", "20:40:20", 600)]));

    // Act
    await tickAt("20:41:10", api([], [countdown("4674", "20:41:05", 0)]));

    // Assert
    const events = jest.mocked(logger.info).mock.calls.map(([fields]) => (fields as { event?: string; trainNo?: string }).event);
    expect(events).toEqual(["subway.tracking.countdown_diverged", "subway.tracking.countdown_rejected"]);
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

describe("SubwayTrackingService.track for an express passing stations it does not call at", () => {
  const expressEvent = (trainNo: string, stationId: string, state: TrainEvent["state"], kst: string): TrainEvent => ({
    trainNo,
    stationId,
    state,
    stateChangedAt: onSaturday(kst),
    destination: Number(trainNo) % 2 === 0 ? "청량리" : "신창",
  });
  const listedAtSungkyunkwan = (repository: FakeSubwayRepository, direction: "up" | "down") =>
    repository.docs.get(SUNGKYUNKWAN)?.directions[direction].map((t) => t.trainNo);

  it("keeps northbound 1912, seen departing 성균관대 at 10:43:36, off the list through its events at 의왕, while 0632 ahead runs 1,185 s late", async () => {
    // Arrange
    const { repository, tickAt } = setup(onSaturday);
    await tickAt("10:42:06", api([expressEvent("1912", SUNGKYUNKWAN, "arrived", "10:42:01")]));
    await tickAt("10:43:36", trainMap([expressEvent("1912", SUNGKYUNKWAN, "departed", "10:43:36")]));

    // Act
    await tickAt("10:44:51", trainMap([expressEvent("1912", "KR-1-P152", "approaching", "10:44:51"), expressEvent("0632", "KR-1-P154", "arrived", "10:44:51")]));
    await tickAt("10:45:15", api([expressEvent("0632", "KR-1-P154", "arrived", "10:44:42")]));

    // Assert
    expect(listedAtSungkyunkwan(repository, "up")).toContain("0632");
    expect(listedAtSungkyunkwan(repository, "up")).not.toContain("1912");
  });

  it("keeps southbound 1913 off the list once seen at 화서, which it passes, though no upstream reported its departure from 성균관대", async () => {
    // Arrange
    const { repository, tickAt } = setup(onSaturday);
    await tickAt("10:25:15", api([expressEvent("1913", SUNGKYUNKWAN, "arrived", "10:25:10")]));

    // Act
    await tickAt("10:26:45", trainMap([expressEvent("1913", "KR-1-P154", "approaching", "10:26:40"), expressEvent("0431", "KR-1-P152", "arrived", "10:26:00")]));

    // Assert
    expect(listedAtSungkyunkwan(repository, "down")).toContain("0431");
    expect(listedAtSungkyunkwan(repository, "down")).not.toContain("1913");
  });

  it("estimates northbound 1910, first seen at 세류 which it passes, 606 s late from its departure from 병점, at 10:15:36", async () => {
    // Arrange
    const { repository, tickAt } = setup(onSaturday);
    for (const [kst, state] of [["10:04:36", "approaching"], ["10:04:51", "arrived"], ["10:06:06", "arrived"]] as const) {
      await tickAt(kst, trainMap([expressEvent("1910", "KR-1-1715", state, kst)]));
    }

    // Act
    await tickAt("10:07:21", trainMap([expressEvent("1910", "KR-1-1715", "arrived", "10:07:21")]));

    // Assert
    expect(repository.docs.get(SUNGKYUNKWAN)?.directions.up.find((t) => t.trainNo === "1910")).toEqual({
      trainNo: "1910",
      destination: "청량리",
      express: true,
      arrivalAt: onSaturday("10:15:36"),
      source: "estimated",
      position: { stationId: "KR-1-P157", state: "departed" },
    });
  });
});

describe("SubwayTrackingService.track for an express seen before its first stop", () => {
  const southbound = (trainNo: string, stationId: string, state: TrainEvent["state"], kst: string, destination: string): TrainEvent => ({
    trainNo,
    stationId,
    state,
    stateChangedAt: onSaturday(kst),
    destination,
  });

  it("estimates southbound 1913, seen departing 의왕 before its first stop 성균관대, from its own pass at 10:26:21, not from 0431's 155 s", async () => {
    // Arrange
    const { repository, tickAt } = setup(onSaturday);
    await tickAt("10:23:21", trainMap([southbound("1913", "KR-1-P152", "departed", "10:23:21", "신창"), southbound("0431", "KR-1-P154", "departed", "10:23:06", "병점")]));

    // Act
    await tickAt("10:23:37", api([southbound("0431", "KR-1-P155", "approaching", "10:23:35", "병점")]));

    // Assert
    // WHY: the 2026-10-17 tick at 10:23:37 served 1913 at 10:27:36, 0431's delay; 1913 arrived at 10:24:48.
    expect(repository.docs.get(SUNGKYUNKWAN)?.directions.down.find((t) => t.trainNo === "1913")).toEqual({
      trainNo: "1913",
      destination: "신창",
      express: true,
      arrivalAt: onSaturday("10:26:21"),
      source: "estimated",
      position: { stationId: "KR-1-P152", state: "departed" },
    });
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

  it("leaves the countdown memory to the ticks: 4674's republished 150 s still counts from 20:40:20 after a build between them", async () => {
    // Arrange
    const { service, repository, tickAt } = setup();
    await tickAt("20:41:00", api([], [countdown("4674", "20:40:20", 150)]));
    await service.findScheduledArrivals(HYEHWA, at("20:41:05"));

    // Act
    await tickAt("20:41:10", api([], [countdown("4674", "20:41:05", 150)]));

    // Assert
    const train = repository.docs.get(HYEHWA)?.directions.up.find((t) => t.trainNo === "4674");
    expect([train?.arrivalAt, train?.source]).toEqual([at("20:42:50"), "live"]);
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
