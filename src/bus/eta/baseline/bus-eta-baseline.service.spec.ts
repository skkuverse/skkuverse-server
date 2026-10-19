/**
 * `shuttle-eta-baseline` (design D10): the 04:00 KST refresh, no refetch after
 * a restart, the 30-minute backoff, the 250 ms spacing, the daily cap and
 * non-operating days. Ticks take an explicit `now`. A bus-lane run with a
 * fixed value of the same weekday and time reuses it with no TMAP call (design
 * D7); any other run is forecast by TMAP.
 */
import moment from "moment-timezone";
import { FakeBusEtaRepository } from "../../../../__tests__/helpers/fakes/bus/bus-eta.repository.fake";
import { FakeBusEtaForecastClient } from "../../../../__tests__/helpers/fakes/bus/bus-eta-forecast.client.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import { DailyCapError } from "../../../shared/daily-cap.error";
import { BusEtaDirectionsError } from "../bus-eta.error";
import type { BusScheduleService } from "../../schedule/bus-schedule.service";
import { BusStopsService } from "../../stops/bus-stops.service";
import { SubwayStationsService } from "../../../subway/stations/subway-stations.service";
import type { ShuttleEtaDoc } from "../bus-eta.document";
import { etaDocId } from "../bus-eta.mapper";
import { baselineDoc } from "./bus-eta-baseline.mapper";
import type { BusEtaRepository } from "../bus-eta.repository";
import { DailyCap } from "../../../shared/daily-cap.util";
import { BusEtaService } from "../bus-eta.service";
import type { EtaRun, EtaSequence } from "../bus-eta.types";
import type { BusEtaForecastClient } from "../forecast/bus-eta-forecast.client";
import { BusEtaForecastService } from "../forecast/bus-eta-forecast.service";
import { BusEtaLaneService } from "../lane/bus-eta-lane.service";
import { BusEtaBaselineService } from "./bus-eta-baseline.service";

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

const kst = (date: string, hhmm: string) => moment.tz(`${date} ${hhmm}`, "YYYY-MM-DD HH:mm", "Asia/Seoul").toDate();
const run = (date: string, time: string): EtaRun => ({
  serviceId: SEQ.serviceId,
  routeType: SEQ.routeType,
  date,
  time,
  departAt: kst(date, time),
});
const RUNS = [run("2026-10-12", "10:00"), run("2026-10-12", "12:00"), run("2026-10-13", "07:00")];

function setup(opts: { runs?: EtaRun[]; cap?: number; store?: Map<string, ShuttleEtaDoc> } = {}) {
  const store = opts.store ?? new Map<string, ShuttleEtaDoc>();
  const fetchOffsets = jest.fn().mockResolvedValue(OFFSETS);
  const sleep = jest.fn().mockResolvedValue(undefined);
  const readEtas = jest.fn(async (serviceIds: string[], dates: string[]) =>
    [...store.values()].filter((d) => serviceIds.includes(d.serviceId) && dates.includes(d.date)),
  );
  const runs = opts.runs ?? RUNS;
  const poller = new BusEtaBaselineService({
    sequences: [SEQ],
    upcomingRuns: async (_s, now) => runs.filter((r) => r.departAt.getTime() > now.getTime()),
    forecast: { fetchOffsets, reusableFixedByRun: async () => new Map() },
    readEtas,
    writeEtas: async (docs) => {
      for (const d of docs) store.set(d._id, d);
    },
    cap: new DailyCap("tmap", opts.cap ?? 900),
    sleep,
  });
  return { poller, store, fetchOffsets, sleep, readEtas };
}

describe("BusEtaBaselineService.tick", () => {
  it("fetches every upcoming run once, 250 ms apart, with its own departure time", async () => {
    // Arrange
    const { poller, store, fetchOffsets, sleep } = setup();

    // Act
    const now = kst("2026-10-12", "06:00");

    // Assert
    await expect(poller.tick(now)).resolves.toEqual({ calls: 3, written: 3 });
    expect(fetchOffsets.mock.calls.map((c) => c[1])).toEqual(RUNS.map((r) => r.departAt));
    expect(sleep.mock.calls).toEqual([[250], [250]]);
    const doc = store.get(etaDocId(RUNS[0]!, "baseline"))!;
    expect(doc).toMatchObject({ kind: "baseline", source: "tmap", offsetsSec: OFFSETS, fetchedAt: now });
    expect(doc.expiresAt.getTime() - now.getTime()).toBe(24 * 3600_000);
  });

  it("Restart: no calls when every baseline is fresh", async () => {
    // Arrange
    const first = setup();
    await first.poller.tick(kst("2026-10-12", "06:00"));

    // Act
    const restarted = setup({ store: first.store });

    // Assert
    await expect(restarted.poller.tick(kst("2026-10-12", "06:05"))).resolves.toEqual({ calls: 0, written: 0 });
    expect(restarted.fetchOffsets).not.toHaveBeenCalled();
  });

  it("04:00 cutoff: yesterday's forecast is kept until 04:00, then refreshed", async () => {
    // Arrange
    const runs = [run("2026-10-13", "07:00")];
    const store = new Map<string, ShuttleEtaDoc>();
    const old = baselineDoc(runs[0]!, [0, 1, 2], kst("2026-10-12", "05:00"));
    store.set(old._id, old);
    const { poller, fetchOffsets } = setup({ runs, store });

    // Act
    await poller.tick(kst("2026-10-13", "03:55"));

    // Assert
    expect(fetchOffsets).not.toHaveBeenCalled();
    await poller.tick(kst("2026-10-13", "04:00"));
    expect(fetchOffsets).toHaveBeenCalledTimes(1);
    expect(store.get(old._id)!.fetchedAt).toEqual(kst("2026-10-13", "04:00"));
  });

  it("refetches an expired forecast", async () => {
    // Arrange
    const runs = [run("2026-10-13", "07:00")];
    const store = new Map<string, ShuttleEtaDoc>();
    const doc = { ...baselineDoc(runs[0]!, OFFSETS, kst("2026-10-13", "04:10")), expiresAt: kst("2026-10-13", "05:00") };
    store.set(doc._id, doc);
    const { poller, fetchOffsets } = setup({ runs, store });

    // Act
    await poller.tick(kst("2026-10-13", "05:00"));

    // Assert
    expect(fetchOffsets).toHaveBeenCalledTimes(1);
  });

  it("Backoff: a run whose call failed waits 30 minutes; the tick writes the rest and rejects", async () => {
    // Arrange
    const { poller, store, fetchOffsets } = setup();
    const down = new BusEtaDirectionsError("tmap", "http", "HTTP 500", 500);
    fetchOffsets.mockRejectedValueOnce(down);

    // Act & Assert
    await expect(poller.tick(kst("2026-10-12", "06:00"))).rejects.toBe(down);
    expect(store.size).toBe(2);
    expect(store.has(etaDocId(RUNS[0]!, "baseline"))).toBe(false);

    // 06:29: still backing off, and nothing else is due — the outage is not over.
    await expect(poller.tick(kst("2026-10-12", "06:29"))).rejects.toBe(down);
    expect(fetchOffsets).toHaveBeenCalledTimes(3);
    // 06:30: tried again, succeeds, and the poller recovers.
    await expect(poller.tick(kst("2026-10-12", "06:30"))).resolves.toEqual({ calls: 1, written: 1 });
  });

  it("Daily cap: stops calling and rejects once the cap is spent", async () => {
    // Arrange
    const { poller, store, fetchOffsets } = setup({ cap: 2 });

    // Act
    const err = await poller.tick(kst("2026-10-12", "06:00")).catch((e: unknown) => e);

    // Assert
    expect(err).toBeInstanceOf(DailyCapError);
    expect(fetchOffsets).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(2);
  });

  it("Non-operating day: nothing is fetched for a day the smart view shows as not running", async () => {
    // Arrange
    const schedule = {
      resolveSmartSchedule: jest.fn().mockResolvedValue({
        serviceId: "campus-inja",
        status: "active",
        days: [
          { date: "2026-10-12", dayOfWeek: 1, display: "noService", label: null, notices: [], schedule: [] },
          {
            date: "2026-10-13",
            dayOfWeek: 2,
            display: "schedule",
            label: null,
            notices: [],
            schedule: [{ time: "07:00", routeType: "regular", busCount: 1, notes: null, stopTimes: ["07:00", null, null] }],
          },
        ],
      }),
      isSuspendedOn: jest.fn().mockResolvedValue(false),
    } as unknown as BusScheduleService;
    const eta = new BusEtaService(asReal<BusEtaRepository>(new FakeBusEtaRepository()), schedule, new BusStopsService(new SubwayStationsService()));
    const fetchOffsets = jest.fn().mockResolvedValue(OFFSETS);
    const poller = new BusEtaBaselineService({
      sequences: [SEQ],
      upcomingRuns: (s, now) => eta.upcomingRuns(s, now),
      forecast: { fetchOffsets, reusableFixedByRun: async () => new Map() },
      readEtas: async () => [],
      writeEtas: async () => undefined,
      cap: new DailyCap("tmap", 900),
      sleep: async () => undefined,
    });

    // Act
    await poller.tick(kst("2026-10-12", "06:00"));

    // Assert
    expect(fetchOffsets.mock.calls.map((c) => c[1])).toEqual([kst("2026-10-13", "07:00")]);
  });

  it("makes no read and no call when no run is upcoming", async () => {
    // Arrange
    const { poller, readEtas, fetchOffsets } = setup({ runs: [] });

    // Act & Assert
    await expect(poller.tick(kst("2026-10-12", "06:00"))).resolves.toEqual({ calls: 0, written: 0 });
    expect(readEtas).not.toHaveBeenCalled();
    expect(fetchOffsets).not.toHaveBeenCalled();
  });
});

describe("BusEtaBaselineService.tick bus-lane runs (design D7)", () => {
  // 04:00 KST on Tuesday 2026-10-20, still the 19th in UTC.
  const NOW = new Date("2026-10-19T19:00:00.000Z");
  const tuesday = (time: string): EtaRun => run("2026-10-20", time);

  function fixedLastTuesday(time: string, offsetsSec: number[]): ShuttleEtaDoc {
    const departAt = kst("2026-10-13", time);
    return {
      _id: etaDocId(run("2026-10-13", time), "live"),
      kind: "live",
      serviceId: "campus-inja",
      routeType: "regular",
      date: "2026-10-13",
      time,
      departAt,
      offsetsSec,
      source: "naver",
      fetchedAt: departAt,
      frozen: true,
      frozenAt: departAt,
      expiresAt: new Date(departAt.getTime() + 8 * 24 * 3600_000),
    };
  }

  function setupWithForecast(runs: EtaRun[], stored: ShuttleEtaDoc[]) {
    const repository = new FakeBusEtaRepository();
    for (const doc of stored) repository.docs.set(doc._id, doc);
    const eta = new BusEtaService(asReal<BusEtaRepository>(repository), {} as BusScheduleService, new BusStopsService(new SubwayStationsService()));
    const tmap = new FakeBusEtaForecastClient();
    const forecast = new BusEtaForecastService(new BusEtaLaneService(eta), asReal<BusEtaForecastClient>(tmap), eta);
    const sequence = eta.sequences().find((s) => s.serviceId === "campus-inja" && s.routeType === "regular")!;
    const engine = new BusEtaBaselineService({
      sequences: [sequence],
      upcomingRuns: async (_s, now) => runs.filter((r) => r.departAt.getTime() > now.getTime()),
      forecast,
      readEtas: (serviceIds, dates) => eta.listFitting(serviceIds, dates),
      writeEtas: (docs) => eta.upsertFitting(docs),
      cap: new DailyCap("tmap", 900),
      sleep: async () => undefined,
    });
    return { engine, tmap, repository };
  }

  it("Bus-lane run with last week's fixed value: the prediction is that value, and TMAP is not asked", async () => {
    // Arrange
    const fixed = fixedLastTuesday("13:30", [0, 4320]);
    const { engine, tmap, repository } = setupWithForecast([tuesday("13:30")], [fixed]);

    // Act
    const result = await engine.tick(NOW);

    // Assert
    expect(result).toEqual({ calls: 0, written: 1 });
    expect(tmap.calls).toEqual([]);
    const doc = repository.docs.get(etaDocId(tuesday("13:30"), "baseline"))!;
    expect(doc).toMatchObject({ kind: "baseline", source: "naver", offsetsSec: [0, 4320], derivedFrom: fixed._id, fetchedAt: NOW });
    expect(doc.expiresAt.getTime() - NOW.getTime()).toBe(24 * 3600_000);
  });

  it("Bus-lane run without a fixed value: the prediction comes from TMAP", async () => {
    // Arrange
    const { engine, tmap, repository } = setupWithForecast([tuesday("13:30")], []);

    // Act
    await engine.tick(NOW);

    // Assert
    expect(tmap.calls.map((c) => c.departAt)).toEqual([kst("2026-10-20", "13:30")]);
    const doc = repository.docs.get(etaDocId(tuesday("13:30"), "baseline"))!;
    expect(doc).toMatchObject({ source: "tmap", offsetsSec: [0, 5040] });
    expect(doc).not.toHaveProperty("derivedFrom");
  });

  it("Car run: the prediction comes from TMAP, even with last week's fixed value", async () => {
    // Arrange
    const { engine, tmap, repository } = setupWithForecast([tuesday("21:30")], [fixedLastTuesday("21:30", [0, 3900])]);

    // Act
    await engine.tick(NOW);

    // Assert
    expect(tmap.calls.map((c) => c.departAt)).toEqual([kst("2026-10-20", "21:30")]);
    expect(repository.docs.get(etaDocId(tuesday("21:30"), "baseline"))).toMatchObject({ source: "tmap", offsetsSec: [0, 5040] });
  });

  it("asks TMAP once for each run that does not reuse a fixed value", async () => {
    // Arrange
    const runs = [tuesday("13:30"), tuesday("15:00"), tuesday("21:30")];
    const stored = [fixedLastTuesday("13:30", [0, 4320]), fixedLastTuesday("21:30", [0, 3900])];
    const { engine, tmap } = setupWithForecast(runs, stored);

    // Act
    const result = await engine.tick(NOW);

    // Assert
    expect(result).toEqual({ calls: 2, written: 3 });
    expect(tmap.calls.map((c) => c.departAt)).toEqual([kst("2026-10-20", "15:00"), kst("2026-10-20", "21:30")]);
  });
});
