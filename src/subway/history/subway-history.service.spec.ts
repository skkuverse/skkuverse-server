/**
 * SubwayHistoryService listening to the real tracker (over FakeSubwayRepository,
 * the real timetable door on FakeHolidaysService and the committed weekday
 * tables, the real estimate door), writing to FakeSubwayHistoryRepository, at
 * a scripted Clock, fed one upstream's observations per tick as the pollers
 * feed the tracker. What it guards, by the subway-arrival-accuracy spec's
 * scenarios: a record is written at the tick a train's served lead time first
 * falls to or below a horizon, with the prediction served then; a train first
 * seen 2 minutes out gets only its 1-minute record; an observed arrival
 * resolves the train's records at the station made before the tick that first
 * saw it, each with its own error, never the record made from it (F6), an
 * arrived row replacing an approaching row's resolution, and a horizon crossed
 * once the train is seen arrived gets no record; a record 30 minutes past its
 * predicted arrival with no arrival seen is marked unresolved at the next
 * minute's sweep; each source's first report of a train's state at a served
 * platform is one event, and an event at a stop the tracker only observes
 * (upstream, watched or next) is none (add-commute-station-subway design D10);
 * and a failing history write leaves the served arrivals
 * written and the tick resolved, logged at most once every 10 minutes.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { FakeHolidaysService } from "../../../__tests__/helpers/fakes/holidays/holidays.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { FakeSubwayHistoryRepository } from "../../../__tests__/helpers/fakes/subway/subway-history.repository.fake";
import { FakeSubwayRepository } from "../../../__tests__/helpers/fakes/subway/subway.repository.fake";
import type { HolidaysService } from "../../holidays/holidays.service";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { SubwayCountdownService } from "../countdown/subway-countdown.service";
import { SubwayEstimateService } from "../estimate/subway-estimate.service";
import { SubwayMatchingService } from "../matching/subway-matching.service";
import { SubwayStateService } from "../state/subway-state.service";
import type { SubwayRepository } from "../subway.repository";
import type { SubwayProvider, TrainEvent } from "../subway.types";
import { SubwayTimetableService } from "../timetable/subway-timetable.service";
import { SubwayTrackingService } from "../tracking/subway-tracking.service";
import type { SubwayHistoryRepository } from "./subway-history.repository";
import { SubwayHistoryService } from "./subway-history.service";

const at = (kst: string): Date => new Date(`2026-10-16T${kst}+09:00`);
const SUNGKYUNKWAN = "KR-1-0153";

function setup() {
  let now = at("20:20:00");
  const clock = { now: () => now } as Clock;
  const arrivals = new FakeSubwayRepository();
  const history = new FakeSubwayHistoryRepository();
  const timetable = new SubwayTimetableService(asReal<HolidaysService>(new FakeHolidaysService()));
  const tracking = new SubwayTrackingService(new SubwayStateService(asReal<SubwayRepository>(arrivals)), timetable, new SubwayEstimateService(new SubwayCountdownService()), clock);
  new SubwayMatchingService(tracking, clock).onModuleInit();
  const service = new SubwayHistoryService(asReal<SubwayHistoryRepository>(history), tracking, clock);
  service.onModuleInit();
  const tickAt = (kst: string, provider: SubwayProvider = upstream("seoul-subway-api")): Promise<void> => {
    now = at(kst);
    return tracking.track(provider);
  };
  return { arrivals, history, tickAt };
}

function upstream(source: string, events: TrainEvent[] = []): SubwayProvider {
  return { observe: async () => ({ source, events, countdownRows: [] }) };
}

function event(trainNo: string, platformId: string, state: TrainEvent["state"], kst: string, destination: string): TrainEvent {
  return { trainNo, platformId, state, stateChangedAt: at(kst), destination };
}

const horizonsOf = (history: FakeSubwayHistoryRepository, trainNo: string) => history.recordsOf(trainNo, SUNGKYUNKWAN).map((r) => r.horizonMin);

afterEach(() => {
  jest.clearAllMocks();
});

describe("Predictions recorded at fixed horizons", () => {
  it("Train approaching 성균관대: 0692 dropping from 5 min 20 s to 4 min 50 s writes its 5-minute record with the prediction served then", async () => {
    // Arrange
    const { history, tickAt } = setup();
    await tickAt("20:26:10");

    // Act
    await tickAt("20:26:40");

    // Assert
    expect(history.recordsOf("0692", SUNGKYUNKWAN)).toEqual([
      {
        serviceDate: "2026-10-16",
        trainNo: "0692",
        stationId: SUNGKYUNKWAN,
        horizonMin: 5,
        direction: "up",
        source: "scheduled",
        predictedAt: at("20:31:30"),
        madeAt: at("20:26:40"),
        status: "open",
        observedAt: null,
        observedState: null,
        resolvedAt: null,
        errorSec: null,
      },
    ]);
  });

  it("writes no record at 5 min 20 s, before any horizon is crossed", async () => {
    // Arrange
    const { history, tickAt } = setup();

    // Act
    await tickAt("20:26:10");

    // Assert
    expect(horizonsOf(history, "0692")).toEqual([]);
  });

  it("Horizon already passed: a train first seen 2 minutes out gets only its 1-minute record", async () => {
    // Arrange
    const { history, tickAt } = setup();

    // Act
    for (const kst of ["20:29:30", "20:30:00", "20:30:30", "20:31:00", "20:31:20"]) await tickAt(kst);

    // Assert
    expect(horizonsOf(history, "0692")).toEqual([1]);
    expect(history.recordsOf("0692", SUNGKYUNKWAN)[0]?.madeAt).toEqual(at("20:30:30"));
  });

  it("writes each horizon once however many ticks follow it", async () => {
    // Arrange
    const { history, tickAt } = setup();

    // Act
    for (const kst of ["20:21:00", "20:21:40", "20:26:20", "20:26:40", "20:27:00", "20:28:20", "20:28:40", "20:30:20", "20:30:40", "20:30:50"]) await tickAt(kst);

    // Assert
    expect(horizonsOf(history, "0692")).toEqual([10, 5, 3, 1]);
  });
});

describe("Observed arrivals close the record", () => {
  it("Arrival observed: 0692 predicted for 20:31:30 at its 3-minute record and seen arriving at 20:31:50 has an error of −20 s", async () => {
    // Arrange
    const { history, tickAt } = setup();
    await tickAt("20:28:20");
    await tickAt("20:28:40");

    // Act
    await tickAt("20:31:55", upstream("seoul-trainmap", [event("0692", SUNGKYUNKWAN, "arrived", "20:31:50", "광운대")]));

    // Assert
    const [record] = history.recordsOf("0692", SUNGKYUNKWAN);
    expect(record).toMatchObject({
      horizonMin: 3,
      predictedAt: at("20:31:30"),
      status: "resolved",
      observedAt: at("20:31:50"),
      observedState: "arrived",
      resolvedAt: at("20:31:55"),
      errorSec: -20,
    });
  });

  it("does not take a departure or an arrival at another station as the train's arrival", async () => {
    // Arrange
    const { history, tickAt } = setup();
    await tickAt("20:28:20");
    await tickAt("20:28:40");

    // Act
    await tickAt("20:31:00", upstream("seoul-trainmap", [event("0692", "KR-1-P154", "arrived", "20:30:55", "광운대")]));

    // Assert
    expect(history.recordsOf("0692", SUNGKYUNKWAN)[0]).toMatchObject({ status: "open", errorSec: null });
  });

  it("Train never seen arriving: 0493's records are marked unresolved, with no error, at the first sweep past 30 minutes", async () => {
    // Arrange
    const { history, tickAt } = setup();
    await tickAt("20:35:50");
    await tickAt("20:36:10");
    await tickAt("21:10:59");
    const beforeThirtyMinutes = history.recordsOf("0493", SUNGKYUNKWAN).map((r) => r.status);

    // Act
    await tickAt("21:12:00");

    // Assert
    expect(beforeThirtyMinutes).toEqual(["open"]);
    expect(history.recordsOf("0493", SUNGKYUNKWAN)).toEqual([
      expect.objectContaining({ horizonMin: 5, predictedAt: at("20:41:00"), status: "unresolved", resolvedAt: at("21:12:00"), errorSec: null, observedAt: null }),
    ]);
  });

  it("sweeps at most once a minute", async () => {
    // Arrange
    const { history, tickAt } = setup();
    await tickAt("20:35:50");
    await tickAt("20:36:10");
    await tickAt("21:10:59");

    // Act
    await tickAt("21:11:30");

    // Assert
    expect(history.recordsOf("0493", SUNGKYUNKWAN).map((r) => r.status)).toEqual(["open"]);
  });
});

describe("A record is never resolved by the row it was made from (F6)", () => {
  it("leaves open the 1-minute record made at the tick that first sees 0692 approaching, predicted from that row", async () => {
    // Arrange
    const { history, tickAt } = setup();
    await tickAt("20:30:20");

    // Act
    await tickAt("20:30:30", upstream("seoul-subway-api", [event("0692", SUNGKYUNKWAN, "approaching", "20:30:25", "광운대")]));

    // Assert
    expect(history.recordsOf("0692", SUNGKYUNKWAN)).toEqual([
      expect.objectContaining({ horizonMin: 1, predictedAt: at("20:30:55"), madeAt: at("20:30:30"), status: "open", observedAt: null, errorSec: null }),
    ]);
  });

  it("resolves that 1-minute record by the arrived row seen after it, 10 s past the approach lead", async () => {
    // Arrange
    const { history, tickAt } = setup();
    await tickAt("20:30:20");
    await tickAt("20:30:30", upstream("seoul-subway-api", [event("0692", SUNGKYUNKWAN, "approaching", "20:30:25", "광운대")]));

    // Act
    await tickAt("20:31:10", upstream("seoul-subway-api", [event("0692", SUNGKYUNKWAN, "arrived", "20:31:05", "광운대")]));

    // Assert
    expect(history.recordsOf("0692", SUNGKYUNKWAN)).toEqual([
      expect.objectContaining({ horizonMin: 1, status: "resolved", observedAt: at("20:31:05"), observedState: "arrived", resolvedAt: at("20:31:10"), errorSec: -10 }),
    ]);
  });

  it("marks that 1-minute record unresolved past 30 minutes when no arrived row follows its approaching row", async () => {
    // Arrange
    const { history, tickAt } = setup();
    await tickAt("20:30:20");
    await tickAt("20:30:30", upstream("seoul-subway-api", [event("0692", SUNGKYUNKWAN, "approaching", "20:30:25", "광운대")]));

    // Act
    await tickAt("21:01:00");

    // Assert
    expect(history.recordsOf("0692", SUNGKYUNKWAN)).toEqual([expect.objectContaining({ horizonMin: 1, status: "unresolved", observedAt: null, errorSec: null })]);
  });

  it("resolves a record made before the approaching row from that row 30 s on while no arrived row has been seen", async () => {
    // Arrange
    const { history, tickAt } = setup();
    await tickAt("20:28:20");
    await tickAt("20:28:40");

    // Act
    await tickAt("20:31:25", upstream("seoul-subway-api", [event("0692", SUNGKYUNKWAN, "approaching", "20:31:20", "광운대")]));

    // Assert
    expect(history.recordsOf("0692", SUNGKYUNKWAN)[0]).toMatchObject({ horizonMin: 3, observedAt: at("20:31:50"), observedState: "approaching", errorSec: -20 });
  });

  it("re-resolves that record by the arrived row seen after the approaching row, the arrival itself", async () => {
    // Arrange
    const { history, tickAt } = setup();
    await tickAt("20:28:20");
    await tickAt("20:28:40");
    await tickAt("20:31:25", upstream("seoul-subway-api", [event("0692", SUNGKYUNKWAN, "approaching", "20:31:20", "광운대")]));

    // Act
    await tickAt("20:32:05", upstream("seoul-trainmap", [event("0692", SUNGKYUNKWAN, "arrived", "20:32:05", "광운대")]));

    // Assert
    expect(history.recordsOf("0692", SUNGKYUNKWAN)[0]).toMatchObject({
      horizonMin: 3,
      observedAt: at("20:32:05"),
      observedState: "arrived",
      resolvedAt: at("20:32:05"),
      errorSec: -35,
    });
  });

  it("resolves a record by an arrived row stamped before the record was made but first seen after it, as upstream lag", async () => {
    // Arrange
    const { history, tickAt } = setup();
    await tickAt("20:30:20");
    await tickAt("20:30:30");

    // Act
    await tickAt("20:30:50", upstream("seoul-subway-api", [event("0692", SUNGKYUNKWAN, "arrived", "20:30:25", "광운대")]));

    // Assert
    expect(history.recordsOf("0692", SUNGKYUNKWAN)).toEqual([
      expect.objectContaining({ horizonMin: 1, madeAt: at("20:30:30"), predictedAt: at("20:31:30"), observedAt: at("20:30:25"), errorSec: 65 }),
    ]);
  });

  it("writes no record for the 3- and 1-minute horizons crossed only by the tick that first sees 0692 arrived", async () => {
    // Arrange
    const { history, tickAt } = setup();
    await tickAt("20:28:20");

    // Act
    await tickAt("20:30:00", upstream("seoul-subway-api", [event("0692", SUNGKYUNKWAN, "arrived", "20:29:55", "광운대")]));

    // Assert
    expect(horizonsOf(history, "0692")).toEqual([]);
  });
});

describe("Events stored per source", () => {
  it("stores each source's first report of a train's state at a station once, with its line and time", async () => {
    // Arrange
    const { history, tickAt } = setup();
    const atSungkyunkwan = event("K0493", SUNGKYUNKWAN, "arrived", "20:41:00", "서동탄");

    // Act
    await tickAt("20:41:10", upstream("seoul-subway-api", [atSungkyunkwan]));
    await tickAt("20:41:20", upstream("seoul-subway-api", [atSungkyunkwan]));
    await tickAt("20:41:25", upstream("seoul-trainmap", [event("0493", SUNGKYUNKWAN, "arrived", "20:41:25", "서동탄")]));

    // Assert
    expect(history.events).toEqual([
      { at: at("20:41:00"), meta: { line: "1", trainNo: "0493" }, stationId: SUNGKYUNKWAN, state: "arrived", source: "seoul-subway-api" },
      { at: at("20:41:25"), meta: { line: "1", trainNo: "0493" }, stationId: SUNGKYUNKWAN, state: "arrived", source: "seoul-trainmap" },
    ]);
  });
});

describe("Train events recorded at served platforms only", () => {
  const JAMSIL = "S1-2-216";
  const JAMSILNARU = "S1-2-215";

  it("Event at an upstream stop: 2364 arrived at 잠실나루 moves 잠실's served train and writes no event", async () => {
    // Arrange
    const { arrivals, history, tickAt } = setup();

    // Act
    await tickAt("18:13:40", upstream("seoul-subway-api", [event("2364", JAMSILNARU, "arrived", "18:13:30", "성수")]));

    // Assert
    const served = arrivals.docs.get(JAMSIL)?.directions.up.find((train) => train.trainNo === "2364");
    expect(served?.position).toEqual({ stationId: JAMSILNARU, state: "arrived" });
    expect(history.events).toEqual([]);
  });

  it("Event at the served platform: the train map's first departure of 2364 from 잠실 is one event for S1-2-216", async () => {
    // Arrange
    const { history, tickAt } = setup();
    const departed = event("2364", JAMSIL, "departed", "18:16:10", "내선순환");

    // Act
    await tickAt("18:16:10", upstream("seoul-trainmap", [departed]));
    await tickAt("18:16:25", upstream("seoul-trainmap", [departed]));

    // Assert
    expect(history.events).toEqual([
      { at: at("18:16:10"), meta: { line: "2", trainNo: "2364" }, stationId: JAMSIL, state: "departed", source: "seoul-trainmap" },
    ]);
  });

  it("writes no event at another station's platform of the same line, which 잠실's tick also carries", async () => {
    // Arrange
    const { history, tickAt } = setup();

    // Act
    await tickAt("18:16:10", upstream("seoul-trainmap", [event("2364", "S1-2-222", "arrived", "18:16:00", "내선순환")]));

    // Assert
    expect(history.events.map((record) => record.stationId)).toEqual(["S1-2-222"]);
  });
});

describe("Recording never affects serving", () => {
  it("History write fails: the poll still updates the served arrivals and resolves, logged once within 10 minutes", async () => {
    // Arrange
    const { arrivals, history, tickAt } = setup();
    history.failWith = new Error("connection reset");
    const observed = upstream("seoul-subway-api", [event("0493", "KR-1-P152", "arrived", "20:39:00", "서동탄")]);
    await tickAt("20:26:10", observed);

    // Act
    const tick = tickAt("20:26:40", observed);

    // Assert
    await expect(tick).resolves.toBeUndefined();
    expect(arrivals.docs.get(SUNGKYUNKWAN)?.generatedAt).toEqual(at("20:26:40"));
    expect(history.writes).toBeGreaterThan(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "subway.history.write_failed", err: history.failWith, suppressed: 0 }),
      expect.any(String),
    );
  });

  it("logs a failure that lasts again once 10 minutes have passed, counting the lines it skipped", async () => {
    // Arrange
    const { history, tickAt } = setup();
    history.failWith = new Error("connection reset");
    await tickAt("20:26:10");
    await tickAt("20:26:40");

    // Act
    await tickAt("20:36:10");

    // Assert
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect((logger.warn as jest.Mock).mock.calls[1]?.[0]).toMatchObject({ event: "subway.history.write_failed" });
    expect((logger.warn as jest.Mock).mock.calls[1]?.[0].suppressed).toBeGreaterThan(0);
  });
});
