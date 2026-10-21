/**
 * `shuttle-eta-live` (design D10): the window, the 10-minute cadence, one call
 * per window, fixing at departure, the fallback, fixed values never changing,
 * failure reporting and the daily cap. Ticks take an explicit `now`, over an
 * in-memory store with writeEtas' frozen-skip rule.
 *
 * By travel model (bus-lane design D2, D5): a bus-lane run's value is the
 * route forced through the corridor with the probe's corridor time in place
 * of the car time; it falls back to the car route when the probe cannot
 * answer or fails; one call per model; the probe primed once, ten minutes
 * before a bus-lane window opens; and a TOPIS failure reported until a
 * position request succeeds, whatever NAVER does.
 *
 * Over the stored corridor (move-reference-datasets D9): the tick reads it once,
 * only when a bus-lane run is due or a corridor failure is held, and hands its
 * snapshot to the travel model; never read, a bus-lane run is served the
 * unforced route marked `car` with no position request, and the tick rejects
 * after storing, until the first tick after a push, while car runs are
 * unaffected.
 *
 * Over the stored schedule content (move-editorial-datasets D9), through the
 * real BusEtaService and BusScheduleService: content never read rejects the
 * tick with no directions call, which the poller registry reports as failing,
 * and a suspension stored in the content plans no run.
 */
import moment from "moment-timezone";
import { DailyCapError } from "../../../shared/daily-cap.error";
import { BusEtaDirectionsError, BusEtaLaneUnavailableError } from "../bus-eta.error";
import type { ShuttleEtaDoc } from "../bus-eta.document";
import { etaDocId } from "../bus-eta.mapper";
import { liveDoc } from "./bus-eta-live.mapper";
import { DailyCap } from "../../../shared/daily-cap.util";
import type { EtaRun, EtaSequence } from "../bus-eta.types";
import type { SequenceStrategy } from "../lane/bus-eta-lane.types";
import type { LegTime } from "../probe/bus-eta-probe.types";
import { BusEtaLiveService } from "./bus-eta-live.service";
import { corridorSnapshot } from "../../../../__tests__/helpers/bus/bus-lane-corridor";
import { serviceNoticesWithSuspension, storedScheduleContentRepository, storedScheduleContentService } from "../../../../__tests__/helpers/bus/schedule-content";
import { FakeBusEtaRepository } from "../../../../__tests__/helpers/fakes/bus/bus-eta.repository.fake";
import { FakeBusScheduleContentRepository } from "../../../../__tests__/helpers/fakes/bus/bus-schedule-content.repository.fake";
import { FakeBusScheduleRepository } from "../../../../__tests__/helpers/fakes/bus/bus-schedule.repository.fake";
import { FakeHolidaysService } from "../../../../__tests__/helpers/fakes/holidays/holidays.service.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import type { HolidaysService } from "../../../holidays/holidays.service";
import type { BusScheduleRepository } from "../../schedule/bus-schedule.repository";
import { BusScheduleService } from "../../schedule/bus-schedule.service";
import { storedBusStopsService } from "../../../../__tests__/helpers/bus/bus-stops";
import type { BusEtaRepository } from "../bus-eta.repository";
import { BusEtaService } from "../bus-eta.service";
import type { LiveTravel } from "./bus-eta-live.types";

const DATE = "2026-10-12"; // a Monday
const SEQ: EtaSequence = {
  serviceId: "campus-inja",
  routeType: "regular",
  stops: [
    { lat: 37.587367, lng: 126.993643 },
    { lat: 37.292298, lng: 126.975057 },
    { lat: 37.293999, lng: 126.973183 },
  ],
};
const OFFSETS = [0, 4500, 4620];

// A car-only travel model: a lane or probe call fails the test.
function carTravel(fetchOffsets: LiveTravel["fetchOffsets"]): LiveTravel {
  const noLaneCall = () => Promise.reject(new Error("no lane or probe call expected"));
  return { strategyOfRun: () => ({ strategy: "car" }), fetchOffsets, corridor: noLaneCall, fetchCorridorRoute: noLaneCall, legTime: noLaneCall, prime: noLaneCall };
}

const at = (hhmm: string, seconds = 0) => moment.tz(`${DATE} ${hhmm}`, "YYYY-MM-DD HH:mm", "Asia/Seoul").add(seconds, "s").toDate();
const run = (time: string): EtaRun => ({ serviceId: SEQ.serviceId, routeType: SEQ.routeType, date: DATE, time, departAt: at(time) });

function setup(times: string[], opts: { cap?: number } = {}) {
  const store = new Map<string, ShuttleEtaDoc>();
  const fetchOffsets = jest.fn().mockResolvedValue(OFFSETS);
  const poller = new BusEtaLiveService({
    sequences: async () => [SEQ],
    runsOn: async (_s, date) => (date === DATE ? times.map(run) : []),
    travel: carTravel(fetchOffsets),
    readEtas: async (serviceIds, dates) =>
      [...store.values()].filter((d) => serviceIds.includes(d.serviceId) && dates.includes(d.date)),
    writeEtas: async (docs) => {
      for (const d of docs) if (!store.get(d._id)?.frozen) store.set(d._id, d);
    },
    cap: new DailyCap("naver", opts.cap ?? 1000),
  });
  const doc = (time: string) => store.get(etaDocId(run(time), "live"));
  return { poller, store, fetchOffsets, doc };
}

describe("BusEtaLiveService.tick", () => {
  it("Window boundaries: nothing before T−60, a live value from T−60, a fixed one at T0", async () => {
    // Arrange
    const { poller, fetchOffsets, doc } = setup(["10:00"]);

    // Act & Assert
    await expect(poller.tick(at("08:59", 59))).resolves.toEqual({ calls: 0, written: 0 });
    expect(doc("10:00")).toBeUndefined();

    await expect(poller.tick(at("09:00"))).resolves.toEqual({ calls: 1, written: 1 });
    expect(doc("10:00")).toMatchObject({ kind: "live", source: "naver", offsetsSec: OFFSETS, fetchedAt: at("09:00") });
    expect(doc("10:00")!.frozen).toBeUndefined();

    await poller.tick(at("10:00"));
    expect(fetchOffsets).toHaveBeenCalledTimes(2);
    expect(doc("10:00")).toMatchObject({ frozen: true, frozenAt: at("10:00"), fetchedAt: at("10:00") });
  });

  it("refreshes on a 10-minute cadence while a run is in its window", async () => {
    // Arrange
    const { poller, fetchOffsets } = setup(["10:00"]);

    // Act
    for (let m = 0; m <= 30; m++) await poller.tick(at("09:00", m * 60));
    // 09:00, 09:10, 09:20, 09:30: a 9.5-minute-old value is refreshed on the next minute tick.

    // Assert
    expect(fetchOffsets).toHaveBeenCalledTimes(4);
  });

  it("One call for 10:00, 10:10 and 10:30: every run in the window shares it", async () => {
    // Arrange
    const { poller, fetchOffsets, doc } = setup(["10:00", "10:10", "10:30", "12:00"]);

    // Act & Assert
    await expect(poller.tick(at("09:35"))).resolves.toEqual({ calls: 1, written: 3 });
    expect(fetchOffsets).toHaveBeenCalledWith(SEQ.stops);
    for (const t of ["10:00", "10:10", "10:30"]) expect(doc(t)!.fetchedAt).toEqual(at("09:35"));
    expect(doc("12:00")).toBeUndefined();
  });

  it("a run entering its window gets a value at once, even if the others are fresh", async () => {
    // Arrange
    const { poller, fetchOffsets, doc } = setup(["10:00", "10:05"]);
    await poller.tick(at("09:00"));

    // Act
    await poller.tick(at("09:05"));

    // Assert
    expect(fetchOffsets).toHaveBeenCalledTimes(2);
    expect(doc("10:05")!.fetchedAt).toEqual(at("09:05"));
  });

  it("Departure: a fresh call fixes the run, and the call also refreshes the window", async () => {
    // Arrange
    const { poller, fetchOffsets, doc } = setup(["10:00", "10:30"]);
    await poller.tick(at("09:55"));
    fetchOffsets.mockResolvedValueOnce([0, 4700, 4800]);

    // Act & Assert
    await expect(poller.tick(at("10:00"))).resolves.toEqual({ calls: 1, written: 2 });
    expect(doc("10:00")).toMatchObject({ frozen: true, offsetsSec: [0, 4700, 4800], frozenAt: at("10:00") });
    expect(doc("10:30")).toMatchObject({ offsetsSec: [0, 4700, 4800], fetchedAt: at("10:00") });
    expect(doc("10:30")!.frozen).toBeUndefined();
  });

  it("Fallback: a run still unfixed 10 minutes after departure keeps its last live value", async () => {
    // Arrange
    const { poller, fetchOffsets, doc } = setup(["10:00"]);
    await poller.tick(at("09:50"));
    fetchOffsets.mockRejectedValue(new BusEtaDirectionsError("naver", "timeout", "timed out (ECONNABORTED)"));

    // Act & Assert
    for (let m = 0; m < 10; m++) await expect(poller.tick(at("10:00", m * 60))).rejects.toThrow("timed out");
    expect(fetchOffsets).toHaveBeenCalledTimes(11);

    // 10:10: no more calls for it; the 09:50 value (10 minutes before departure) is fixed.
    await expect(poller.tick(at("10:10"))).rejects.toThrow("timed out");
    expect(fetchOffsets).toHaveBeenCalledTimes(11);
    expect(doc("10:00")).toMatchObject({ frozen: true, fetchedAt: at("09:50"), frozenAt: at("10:10"), offsetsSec: OFFSETS });
  });

  it("Fallback: a last live value older than 15 minutes before departure is not fixed", async () => {
    // Arrange
    const { poller, store, fetchOffsets, doc } = setup(["10:00"]);
    store.set(etaDocId(run("10:00"), "live"), liveDoc(run("10:00"), { offsetsSec: OFFSETS, fetchedAt: at("09:44") }));

    // Act & Assert
    await expect(poller.tick(at("10:10"))).resolves.toEqual({ calls: 0, written: 0 });
    expect(fetchOffsets).not.toHaveBeenCalled();
    expect(doc("10:00")!.frozen).toBeUndefined();
  });

  it("a fixed run never changes", async () => {
    // Arrange
    const { poller, store, fetchOffsets, doc } = setup(["10:00"]);
    const fixed = liveDoc(run("10:00"), { offsetsSec: [0, 1, 2], fetchedAt: at("10:00"), frozenAt: at("10:00") });
    store.set(fixed._id, fixed);

    // Act
    for (const t of ["10:01", "10:05", "10:30", "11:00"]) await poller.tick(at(t));

    // Assert
    expect(fetchOffsets).not.toHaveBeenCalled();
    expect(doc("10:00")).toBe(fixed);
  });

  it("A failing tick rejects until a call succeeds, after writing what it got", async () => {
    // Arrange
    const { poller, fetchOffsets, doc } = setup(["10:00"]);
    const down = new BusEtaDirectionsError("naver", "auth", "authentication refused (HTTP 401)", 401);
    fetchOffsets.mockRejectedValueOnce(down);

    // Act & Assert
    await expect(poller.tick(at("09:00"))).rejects.toBe(down);
    expect(doc("10:00")).toBeUndefined();

    // 09:00:30 makes the retry call (no value yet) and succeeds: the outage is over.
    await expect(poller.tick(at("09:00", 30))).resolves.toEqual({ calls: 1, written: 1 });
    // A tick that needs no call while healthy resolves.
    await expect(poller.tick(at("09:01"))).resolves.toEqual({ calls: 0, written: 0 });
  });

  it("keeps rejecting on ticks that make no call, while the last call failed", async () => {
    // Arrange
    const { poller, fetchOffsets } = setup(["10:00"]);
    const down = new BusEtaDirectionsError("naver", "http", "HTTP 503", 503);
    fetchOffsets.mockRejectedValueOnce(down);

    // Act & Assert
    await expect(poller.tick(at("09:00"))).rejects.toBe(down);
    // Outside any window: no call is needed, but nothing has proven NAVER back.
    await expect(poller.tick(at("12:00"))).rejects.toBe(down);
  });

  it("Daily cap: a crossed cap rejects the tick without calling", async () => {
    // Arrange
    const { poller, fetchOffsets } = setup(["10:00"], { cap: 2 });
    await poller.tick(at("09:00"));
    await poller.tick(at("09:10"));

    // Act
    const err = await poller.tick(at("09:20")).catch((e: unknown) => e);

    // Assert
    expect(err).toBeInstanceOf(DailyCapError);
    expect((err as Error).message).toBe("naver: daily cap of 2 calls reached");
    expect(fetchOffsets).toHaveBeenCalledTimes(2);
  });
});

describe("the daily cap", () => {
  it("starts over at 00:00 KST", () => {
    // Arrange
    const cap = new DailyCap("tmap", 1);
    cap.take(at("23:59"));

    // Act & Assert
    expect(() => cap.take(at("23:59", 30))).toThrow(DailyCapError);
    expect(() => cap.take(moment(at("00:00")).add(1, "day").toDate())).not.toThrow();
  });
});

const INJA: EtaSequence = { serviceId: "campus-inja", routeType: "regular", stops: [SEQ.stops[0]!, SEQ.stops[1]!] };
const JAIN: EtaSequence = { serviceId: "campus-jain", routeType: "regular", stops: [SEQ.stops[1]!, SEQ.stops[0]!] };
const CAR_OFFSETS = [0, 5400];
const FORCED_ROUTE = { stopOffsetsSec: [0, 4620], corridorCarSec: 1920 };
const PROBE: LegTime = { kind: "probe", corridorSec: 1080, spanCount: 6, coverage: 0.81 };
const BUS_LANE_TRAVEL = { model: "busLane", corridorCarSec: 1920, corridorSec: 1080, spanCount: 6, coverage: 0.81 };
const TOPIS_DOWN = new BusEtaDirectionsError("topis", "http", "HTTP 503", 503);
const CORRIDOR = corridorSnapshot();

// The lane config's rule: campus-inja southbound and campus-jain northbound in lane hours, 07:00 to 21:00.
function laneHours(r: Pick<EtaRun, "serviceId" | "time">): SequenceStrategy {
  if (r.time < "07:00" || r.time >= "21:00") return { strategy: "car" };
  return { strategy: "busLane", direction: r.serviceId === "campus-inja" ? "southbound" : "northbound" };
}

function laneSetup(times: string[], opts: { sequences?: EtaSequence[]; strategyOf?: (r: EtaRun) => SequenceStrategy } = {}) {
  const store = new Map<string, ShuttleEtaDoc>();
  const travel = {
    strategyOfRun: jest.fn(opts.strategyOf ?? laneHours),
    fetchOffsets: jest.fn().mockResolvedValue(CAR_OFFSETS),
    corridor: jest.fn().mockResolvedValue(CORRIDOR),
    fetchCorridorRoute: jest.fn().mockResolvedValue(FORCED_ROUTE),
    legTime: jest.fn().mockResolvedValue(PROBE),
    prime: jest.fn().mockResolvedValue(undefined),
  };
  const sequences = opts.sequences ?? [INJA];
  const live = new BusEtaLiveService({
    sequences: async () => sequences,
    runsOn: async (s, date) => (date === DATE ? times.map((time) => ({ ...run(time), serviceId: s.serviceId })) : []),
    travel,
    readEtas: async (serviceIds, dates) => [...store.values()].filter((d) => serviceIds.includes(d.serviceId) && dates.includes(d.date)),
    writeEtas: async (docs) => {
      for (const d of docs) if (!store.get(d._id)?.frozen) store.set(d._id, d);
    },
    cap: new DailyCap("naver", 1000),
  });
  const doc = (time: string, serviceId = "campus-inja") => store.get(etaDocId({ ...run(time), serviceId }, "live"));
  return { live, travel, doc };
}

describe("BusEtaLiveService.tick by travel model", () => {
  it("Afternoon run: its value is the forced route's legs with the bus-lane corridor time in place of the car time", async () => {
    // Arrange
    const { live, travel, doc } = laneSetup(["14:00"]);

    // Act
    const result = await live.tick(at("13:00"));

    // Assert
    expect(result).toEqual({ calls: 1, written: 1 });
    expect(doc("14:00")).toMatchObject({ offsetsSec: [0, 3780], fetchedAt: at("13:00"), travel: BUS_LANE_TRAVEL });
    expect(travel.fetchCorridorRoute).toHaveBeenCalledWith(INJA.stops, CORRIDOR, "southbound");
    expect(travel.legTime).toHaveBeenCalledWith(CORRIDOR, "southbound", at("13:00"));
    expect(travel.fetchOffsets).not.toHaveBeenCalled();
  });

  it("A mixed window: a bus-lane run and a 21:10 run make one call per model", async () => {
    // Arrange
    const { live, travel, doc } = laneSetup(["20:30", "20:40", "21:10"]);

    // Act
    const result = await live.tick(at("20:15"));

    // Assert
    expect(result).toEqual({ calls: 2, written: 3 });
    expect(travel.fetchCorridorRoute).toHaveBeenCalledTimes(1);
    expect(travel.fetchOffsets).toHaveBeenCalledTimes(1);
    expect(travel.fetchOffsets).toHaveBeenCalledWith(INJA.stops);
    expect(doc("20:30")).toMatchObject({ offsetsSec: [0, 3780], travel: BUS_LANE_TRAVEL });
    expect(doc("20:40")).toMatchObject({ offsetsSec: [0, 3780], travel: BUS_LANE_TRAVEL });
    expect(doc("21:10")).toMatchObject({ offsetsSec: CAR_OFFSETS });
    expect(doc("21:10")).not.toHaveProperty("travel");
  });

  it("Departure: a bus-lane run and a car run are each fixed by their own model", async () => {
    // Arrange
    const { live, travel, doc } = laneSetup(["20:55", "21:00"]);

    // Act
    await live.tick(at("21:00"));

    // Assert
    expect(travel.fetchCorridorRoute).toHaveBeenCalledTimes(1);
    expect(travel.fetchOffsets).toHaveBeenCalledTimes(1);
    expect(doc("20:55")).toMatchObject({ frozen: true, frozenAt: at("21:00"), offsetsSec: [0, 3780], travel: BUS_LANE_TRAVEL });
    expect(doc("21:00")).toMatchObject({ frozen: true, frozenAt: at("21:00"), offsetsSec: CAR_OFFSETS });
    expect(doc("21:00")).not.toHaveProperty("travel");
  });

  it("Too little coverage: the run falls back to the car route at the same tick, marked car, after two NAVER calls", async () => {
    // Arrange
    const { live, travel, doc } = laneSetup(["14:00"]);
    travel.legTime.mockResolvedValue({ kind: "unavailable", reason: "lowCoverage", spanCount: 3, coverage: 0.54 });

    // Act
    const result = await live.tick(at("13:00"));

    // Assert
    expect(result).toEqual({ calls: 2, written: 1 });
    expect(travel.fetchCorridorRoute).toHaveBeenCalledTimes(1);
    expect(travel.fetchOffsets).toHaveBeenCalledWith(INJA.stops);
    expect(doc("14:00")).toMatchObject({ offsetsSec: CAR_OFFSETS, travel: { model: "car" } });
  });

  it("A car-only sequence makes no lane or probe call", async () => {
    // Arrange
    const { live, travel, doc } = laneSetup(["10:00"], { strategyOf: () => ({ strategy: "car" }) });

    // Act
    for (const t of ["08:50", "09:00", "10:00"]) await live.tick(at(t));

    // Assert
    expect(travel.fetchCorridorRoute).not.toHaveBeenCalled();
    expect(travel.legTime).not.toHaveBeenCalled();
    expect(travel.prime).not.toHaveBeenCalled();
    expect(doc("10:00")).toMatchObject({ frozen: true, offsetsSec: CAR_OFFSETS });
  });
});

describe("BusEtaLiveService.tick failures by travel model", () => {
  it("Bus position service down: the car value is stored and served, then the tick rejects", async () => {
    // Arrange
    const { live, travel, doc } = laneSetup(["14:00"]);
    travel.legTime.mockRejectedValue(TOPIS_DOWN);

    // Act
    const err = await live.tick(at("13:00")).catch((e: unknown) => e);

    // Assert
    expect(err).toBe(TOPIS_DOWN);
    expect(travel.fetchOffsets).toHaveBeenCalledTimes(1);
    expect(doc("14:00")).toMatchObject({ offsetsSec: CAR_OFFSETS, fetchedAt: at("13:00"), travel: { model: "car" } });
  });

  it("The TOPIS cap: a capped probe falls back the same way and the tick rejects with the cap error", async () => {
    // Arrange
    const { live, travel, doc } = laneSetup(["14:00"]);
    const capped = new DailyCapError("topis", 2000);
    travel.legTime.mockRejectedValue(capped);

    // Act
    const err = await live.tick(at("13:00")).catch((e: unknown) => e);

    // Assert
    expect(err).toBe(capped);
    expect(doc("14:00")).toMatchObject({ offsetsSec: CAR_OFFSETS, travel: { model: "car" } });
  });

  it("keeps rejecting, NAVER answering or not, until a position request succeeds", async () => {
    // Arrange
    const { live, travel } = laneSetup(["14:00", "21:30"]);
    travel.legTime.mockRejectedValueOnce(TOPIS_DOWN);
    await live.tick(at("13:00")).catch(() => undefined);

    // Act & Assert
    // 13:05: no call is due.
    await expect(live.tick(at("13:05"))).rejects.toBe(TOPIS_DOWN);
    // 20:30: only the 21:30 car run is due, and its NAVER call succeeds.
    await expect(live.tick(at("20:30"))).rejects.toBe(TOPIS_DOWN);
    expect(travel.fetchOffsets).toHaveBeenCalledTimes(2);
    // 14:00: fixing the run at departure asks the probe again, which answers.
    await expect(live.tick(at("14:00"))).resolves.toMatchObject({ calls: 1 });
    await expect(live.tick(at("14:01"))).resolves.toEqual({ calls: 0, written: 0 });
  });

  it("Forced route fails: no value and no car call at that tick, the tick rejects, and the next good call resolves", async () => {
    // Arrange
    const { live, travel, doc } = laneSetup(["14:00"]);
    const down = new BusEtaDirectionsError("naver", "timeout", "timed out (ECONNABORTED)");
    travel.fetchCorridorRoute.mockRejectedValueOnce(down);

    // Act & Assert
    await expect(live.tick(at("13:00"))).rejects.toBe(down);
    expect(doc("14:00")).toBeUndefined();
    expect(travel.fetchOffsets).not.toHaveBeenCalled();
    expect(travel.legTime).not.toHaveBeenCalled();
    await expect(live.tick(at("13:01"))).resolves.toEqual({ calls: 1, written: 1 });
  });
});

describe("BusEtaLiveService.tick priming", () => {
  it("Priming before the window: a 13:30 bus-lane run primes at 12:20, not at 12:19 or 12:21", async () => {
    // Arrange
    const { live, travel } = laneSetup(["13:30"]);

    // Act
    for (const t of ["12:19", "12:20", "12:21"]) await live.tick(at(t));

    // Assert
    expect(travel.prime.mock.calls).toEqual([[CORRIDOR, at("12:20")]]);
  });

  it("never primes for car runs", async () => {
    // Arrange
    const { live, travel } = laneSetup(["13:30", "22:30"], { strategyOf: () => ({ strategy: "car" }) });

    // Act
    for (const t of ["12:20", "21:20"]) await live.tick(at(t));

    // Assert
    expect(travel.prime).not.toHaveBeenCalled();
  });

  it("primes once per tick across sequences and directions", async () => {
    // Arrange
    const { live, travel } = laneSetup(["13:30"], { sequences: [INJA, { ...INJA, routeType: "hakbu" }, JAIN] });

    // Act
    await live.tick(at("12:20"));

    // Assert
    expect(travel.prime).toHaveBeenCalledTimes(1);
  });

  it("a failed prime is held like any failure, and a later position request clears it", async () => {
    // Arrange
    const { live, travel } = laneSetup(["13:30"]);
    travel.prime.mockRejectedValueOnce(TOPIS_DOWN);

    // Act & Assert
    await expect(live.tick(at("12:20"))).rejects.toBe(TOPIS_DOWN);
    await expect(live.tick(at("12:25"))).rejects.toBe(TOPIS_DOWN);
    await expect(live.tick(at("12:30"))).resolves.toEqual({ calls: 1, written: 1 });
  });
});

const COMMUTE: EtaSequence = { serviceId: "commute-jamsil", routeType: "down", stops: [SEQ.stops[0]!, SEQ.stops[2]!] };

// The commute shuttle is a car sequence; the campus shuttle follows the lane hours.
const commuteByCar = (r: EtaRun): SequenceStrategy => (r.serviceId === COMMUTE.serviceId ? { strategy: "car" } : laneHours(r));

describe("BusEtaLiveService.tick over the stored corridor", () => {
  it("reads the corridor once per tick for every bus-lane group, and not on a tick with no bus-lane run due", async () => {
    // Arrange
    const { live, travel } = laneSetup(["14:00", "22:30"], { sequences: [INJA, JAIN] });

    // Act
    await live.tick(at("13:00"));
    await live.tick(at("21:30"));

    // Assert
    expect(travel.fetchCorridorRoute.mock.calls.map(([, , direction]) => direction)).toEqual(["southbound", "northbound"]);
    expect(travel.corridor).toHaveBeenCalledTimes(1);
  });

  it("Corridor never read: a bus-lane run is served the unforced route marked car, with no position request, then the tick rejects", async () => {
    // Arrange
    const { live, travel, doc } = laneSetup(["14:00"]);
    travel.corridor.mockResolvedValue(null);

    // Act
    const err = await live.tick(at("13:00")).catch((e: unknown) => e);

    // Assert
    expect(err).toBeInstanceOf(BusEtaLaneUnavailableError);
    expect(doc("14:00")).toMatchObject({ offsetsSec: CAR_OFFSETS, fetchedAt: at("13:00"), travel: { model: "car" } });
    expect(travel.fetchOffsets).toHaveBeenCalledWith(INJA.stops);
    expect(travel.fetchCorridorRoute).not.toHaveBeenCalled();
    expect(travel.legTime).not.toHaveBeenCalled();
  });

  it("Car runs unaffected: a commute run due at the same tick is stored as before", async () => {
    // Arrange
    const { live, travel, doc } = laneSetup(["14:00"], { sequences: [INJA, COMMUTE], strategyOf: commuteByCar });
    travel.corridor.mockResolvedValue(null);

    // Act
    const err = await live.tick(at("13:00")).catch((e: unknown) => e);

    // Assert
    expect(err).toBeInstanceOf(BusEtaLaneUnavailableError);
    expect(doc("14:00", COMMUTE.serviceId)).toMatchObject({ offsetsSec: CAR_OFFSETS, fetchedAt: at("13:00") });
    expect(doc("14:00", COMMUTE.serviceId)).not.toHaveProperty("travel");
    expect(travel.fetchOffsets.mock.calls).toEqual([[INJA.stops], [COMMUTE.stops]]);
  });

  it("Car runs unaffected: a tick with only car runs due reads no corridor and resolves", async () => {
    // Arrange
    const { live, travel, doc } = laneSetup(["22:30"]);
    travel.corridor.mockResolvedValue(null);

    // Act
    const result = await live.tick(at("21:30"));

    // Assert
    expect(result).toEqual({ calls: 1, written: 1 });
    expect(doc("22:30")).toMatchObject({ offsetsSec: CAR_OFFSETS });
    expect(travel.corridor).not.toHaveBeenCalled();
  });

  it("Corridor never read: the prime minute makes no position request, and the tick rejects", async () => {
    // Arrange
    const { live, travel } = laneSetup(["13:30"]);
    travel.corridor.mockResolvedValue(null);

    // Act
    const err = await live.tick(at("12:20")).catch((e: unknown) => e);

    // Assert
    expect(err).toBeInstanceOf(BusEtaLaneUnavailableError);
    expect(travel.prime).not.toHaveBeenCalled();
  });

  it("keeps rejecting while no corridor reads, and resolves at the first tick after a push, with no bus-lane run due", async () => {
    // Arrange
    // 18:10: the 18:15 run is in its window; at 18:40 it is past departure, so no bus-lane call is due.
    const { live, travel } = laneSetup(["18:15"]);
    travel.corridor.mockResolvedValueOnce(null);
    await expect(live.tick(at("18:10"))).rejects.toBeInstanceOf(BusEtaLaneUnavailableError);

    // Act
    const tick = await live.tick(at("18:40"));

    // Assert
    expect(tick).toMatchObject({ calls: 0 });
    expect(travel.corridor).toHaveBeenCalledTimes(2);
    expect(travel.fetchCorridorRoute).not.toHaveBeenCalled();
  });
});

describe("BusEtaLiveService.tick over the stored schedule content", () => {
  // Monday 2026-10-12, 09:30 KST: the 10:00 run is inside its live window.
  const NOW = at("09:30");
  const clock = { now: () => NOW };
  const WEEKDAYS = [
    { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "10:00", routeType: "regular", busCount: 1, notes: null, stopTimes: ["10:00", null, null] }] },
  ];

  function liveOver(content: FakeBusScheduleContentRepository, fetchOffsets: jest.Mock): BusEtaLiveService {
    const timetable = new FakeBusScheduleRepository();
    timetable.patterns = WEEKDAYS;
    const schedule = new BusScheduleService(asReal<BusScheduleRepository>(timetable), asReal<HolidaysService>(new FakeHolidaysService()), storedScheduleContentService(clock, content), clock);
    const eta = new BusEtaService(asReal<BusEtaRepository>(new FakeBusEtaRepository()), schedule, storedBusStopsService());
    return new BusEtaLiveService({
      sequences: async () => [SEQ],
      runsOn: (sequence, date) => eta.runsOn(sequence, date),
      travel: carTravel(fetchOffsets),
      readEtas: async () => [],
      writeEtas: async () => undefined,
      cap: new DailyCap("naver", 1000),
    });
  }

  it("rejects with BUS_SCHEDULE_UNAVAILABLE, with no directions call, while no schedule content was ever read", async () => {
    // Arrange
    const fetchOffsets = jest.fn().mockResolvedValue(OFFSETS);
    const live = liveOver(new FakeBusScheduleContentRepository(), fetchOffsets);

    // Act & Assert
    await expect(live.tick(NOW)).rejects.toMatchObject({ code: "BUS_SCHEDULE_UNAVAILABLE", httpStatus: 503 });
    expect(fetchOffsets).not.toHaveBeenCalled();
  });

  it("makes no directions call on a day inside a stored suspension", async () => {
    // Arrange
    const suspended = storedScheduleContentRepository();
    suspended.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", { from: "2026-10-12", until: "2026-10-16" }));
    const fetchOffsets = jest.fn().mockResolvedValue(OFFSETS);

    // Act
    const tick = await liveOver(suspended, fetchOffsets).tick(NOW);

    // Assert
    expect(tick).toEqual({ calls: 0, written: 0 });
    expect(fetchOffsets).not.toHaveBeenCalled();
  });

  it("calls directions once for the day's run outside a suspension", async () => {
    // Arrange
    const fetchOffsets = jest.fn().mockResolvedValue(OFFSETS);

    // Act
    const tick = await liveOver(storedScheduleContentRepository(), fetchOffsets).tick(NOW);

    // Assert
    expect(tick).toEqual({ calls: 1, written: 1 });
    expect(fetchOffsets).toHaveBeenCalledTimes(1);
  });
});

describe("BusEtaLiveService.tick after the schedule content recovers", () => {
  const WEEKDAYS = [
    { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "10:00", routeType: "regular", busCount: 1, notes: null, stopTimes: ["10:00", null, null] }] },
  ];

  it("resolves the first tick after the content is pushed, with no NAVER call to clear the failure", async () => {
    // Arrange
    // 07:00 KST: the 10:00 run's live window opens at 09:00, so no tick here calls NAVER.
    let now = at("07:00");
    const clock = { now: () => now };
    const content = new FakeBusScheduleContentRepository();
    const timetable = new FakeBusScheduleRepository();
    timetable.patterns = WEEKDAYS;
    const schedule = new BusScheduleService(asReal<BusScheduleRepository>(timetable), asReal<HolidaysService>(new FakeHolidaysService()), storedScheduleContentService(clock, content), clock);
    const eta = new BusEtaService(asReal<BusEtaRepository>(new FakeBusEtaRepository()), schedule, storedBusStopsService());
    const fetchOffsets = jest.fn().mockResolvedValue(OFFSETS);
    const live = new BusEtaLiveService({
      sequences: async () => [SEQ],
      runsOn: (sequence, date) => eta.runsOn(sequence, date),
      travel: carTravel(fetchOffsets),
      readEtas: async () => [],
      writeEtas: async () => undefined,
      cap: new DailyCap("naver", 1000),
    });
    await expect(live.tick(now)).rejects.toMatchObject({ code: "BUS_SCHEDULE_UNAVAILABLE" });
    const pushed = storedScheduleContentRepository();
    for (const [name, doc] of pushed.datasets) content.datasets.set(name, doc);

    // Act
    // One dataset TTL later, the next read sees the pushed content.
    now = at("07:02");
    const tick = await live.tick(now);

    // Assert
    expect(tick).toEqual({ calls: 0, written: 0 });
    expect(fetchOffsets).not.toHaveBeenCalled();
  });
});
