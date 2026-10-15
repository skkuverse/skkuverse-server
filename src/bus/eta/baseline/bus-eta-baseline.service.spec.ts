/**
 * `shuttle-eta-baseline` (design D10): the 04:00 KST refresh, no refetch after
 * a restart, the 30-minute backoff, the 250 ms spacing, the daily cap and
 * non-operating days. Ticks take an explicit `now`.
 */
import moment from "moment-timezone";
import { FakeBusEtaRepository } from "../../../../__tests__/helpers/fakes/bus/bus-eta.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import { BusEtaDailyCapError } from "../bus-eta.error";
import { BusEtaDirectionsError } from "../bus-eta.error";
import type { BusScheduleService } from "../../schedule/bus-schedule.service";
import { BusStopsService } from "../../stops/bus-stops.service";
import type { ShuttleEtaDoc } from "../bus-eta.document";
import { etaDocId } from "../bus-eta.mapper";
import { baselineDoc } from "./bus-eta-baseline.mapper";
import type { BusEtaRepository } from "../bus-eta.repository";
import { DailyCap } from "../bus-eta.rules";
import { BusEtaService } from "../bus-eta.service";
import type { EtaRun, EtaSequence } from "../bus-eta.types";
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
    fetchOffsets,
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
    expect(err).toBeInstanceOf(BusEtaDailyCapError);
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
    } as unknown as BusScheduleService;
    const eta = new BusEtaService(asReal<BusEtaRepository>(new FakeBusEtaRepository()), schedule, new BusStopsService());
    const fetchOffsets = jest.fn().mockResolvedValue(OFFSETS);
    const poller = new BusEtaBaselineService({
      sequences: [SEQ],
      upcomingRuns: (s, now) => eta.upcomingRuns(s, now),
      fetchOffsets,
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
