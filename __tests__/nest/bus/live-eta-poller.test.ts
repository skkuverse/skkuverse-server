/**
 * `shuttle-eta-live` (design D10): the window, the 10-minute cadence, one call
 * per window, fixing at departure, the fallback, fixed values never changing,
 * failure reporting and the daily cap. Ticks take an explicit `now`, over an
 * in-memory store with writeEtas' frozen-skip rule.
 */
import moment from "moment-timezone";
import { DailyCap, DailyCapError } from "../../../src/bus/eta/daily-cap";
import { DirectionsError } from "../../../src/bus/eta/directions-error";
import type { EtaRun } from "../../../src/bus/eta/eta-runs";
import type { EtaSequence } from "../../../src/bus/eta/eta-sequences";
import { etaDocId, liveDoc, type ShuttleEtaDoc } from "../../../src/bus/eta/eta-store";
import { LiveEtaPoller } from "../../../src/bus/eta/live-eta-poller";

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

const at = (hhmm: string, seconds = 0) => moment.tz(`${DATE} ${hhmm}`, "YYYY-MM-DD HH:mm", "Asia/Seoul").add(seconds, "s").toDate();
const run = (time: string): EtaRun => ({ serviceId: SEQ.serviceId, routeType: SEQ.routeType, date: DATE, time, departAt: at(time) });

function setup(times: string[], opts: { cap?: number } = {}) {
  const store = new Map<string, ShuttleEtaDoc>();
  const fetchOffsets = jest.fn().mockResolvedValue(OFFSETS);
  const poller = new LiveEtaPoller({
    sequences: [SEQ],
    runsOn: async (_s, date) => (date === DATE ? times.map(run) : []),
    fetchOffsets,
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

describe("LiveEtaPoller", () => {
  it("Window boundaries: nothing before T−60, a live value from T−60, a fixed one at T0", async () => {
    const { poller, fetchOffsets, doc } = setup(["10:00"]);
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
    const { poller, fetchOffsets } = setup(["10:00"]);
    for (let m = 0; m <= 30; m++) await poller.tick(at("09:00", m * 60));
    // 09:00, 09:10, 09:20, 09:30: a 9.5-minute-old value is refreshed on the next minute tick.
    expect(fetchOffsets).toHaveBeenCalledTimes(4);
  });

  it("One call for 10:00, 10:10 and 10:30: every run in the window shares it", async () => {
    const { poller, fetchOffsets, doc } = setup(["10:00", "10:10", "10:30", "12:00"]);
    await expect(poller.tick(at("09:35"))).resolves.toEqual({ calls: 1, written: 3 });
    expect(fetchOffsets).toHaveBeenCalledWith(SEQ.stops);
    for (const t of ["10:00", "10:10", "10:30"]) expect(doc(t)!.fetchedAt).toEqual(at("09:35"));
    expect(doc("12:00")).toBeUndefined();
  });

  it("a run entering its window gets a value at once, even if the others are fresh", async () => {
    const { poller, fetchOffsets, doc } = setup(["10:00", "10:05"]);
    await poller.tick(at("09:00"));
    await poller.tick(at("09:05"));
    expect(fetchOffsets).toHaveBeenCalledTimes(2);
    expect(doc("10:05")!.fetchedAt).toEqual(at("09:05"));
  });

  it("Departure: a fresh call fixes the run, and the call also refreshes the window", async () => {
    const { poller, fetchOffsets, doc } = setup(["10:00", "10:30"]);
    await poller.tick(at("09:55"));
    fetchOffsets.mockResolvedValueOnce([0, 4700, 4800]);
    await expect(poller.tick(at("10:00"))).resolves.toEqual({ calls: 1, written: 2 });
    expect(doc("10:00")).toMatchObject({ frozen: true, offsetsSec: [0, 4700, 4800], frozenAt: at("10:00") });
    expect(doc("10:30")).toMatchObject({ offsetsSec: [0, 4700, 4800], fetchedAt: at("10:00") });
    expect(doc("10:30")!.frozen).toBeUndefined();
  });

  it("Fallback: a run still unfixed 10 minutes after departure keeps its last live value", async () => {
    const { poller, fetchOffsets, doc } = setup(["10:00"]);
    await poller.tick(at("09:50"));
    fetchOffsets.mockRejectedValue(new DirectionsError("naver", "timeout", "timed out (ECONNABORTED)"));
    for (let m = 0; m < 10; m++) await expect(poller.tick(at("10:00", m * 60))).rejects.toThrow("timed out");
    expect(fetchOffsets).toHaveBeenCalledTimes(11);

    // 10:10: no more calls for it; the 09:50 value (10 minutes before departure) is fixed.
    await expect(poller.tick(at("10:10"))).rejects.toThrow("timed out");
    expect(fetchOffsets).toHaveBeenCalledTimes(11);
    expect(doc("10:00")).toMatchObject({ frozen: true, fetchedAt: at("09:50"), frozenAt: at("10:10"), offsetsSec: OFFSETS });
  });

  it("Fallback: a last live value older than 15 minutes before departure is not fixed", async () => {
    const { poller, store, fetchOffsets, doc } = setup(["10:00"]);
    store.set(etaDocId(run("10:00"), "live"), liveDoc(run("10:00"), OFFSETS, at("09:44")));
    await expect(poller.tick(at("10:10"))).resolves.toEqual({ calls: 0, written: 0 });
    expect(fetchOffsets).not.toHaveBeenCalled();
    expect(doc("10:00")!.frozen).toBeUndefined();
  });

  it("a fixed run never changes", async () => {
    const { poller, store, fetchOffsets, doc } = setup(["10:00"]);
    const fixed = liveDoc(run("10:00"), [0, 1, 2], at("10:00"), at("10:00"));
    store.set(fixed._id, fixed);
    for (const t of ["10:01", "10:05", "10:30", "11:00"]) await poller.tick(at(t));
    expect(fetchOffsets).not.toHaveBeenCalled();
    expect(doc("10:00")).toBe(fixed);
  });

  it("A failing tick rejects until a call succeeds, after writing what it got", async () => {
    const { poller, fetchOffsets, doc } = setup(["10:00"]);
    const down = new DirectionsError("naver", "auth", "authentication refused (HTTP 401)", 401);
    fetchOffsets.mockRejectedValueOnce(down);
    await expect(poller.tick(at("09:00"))).rejects.toBe(down);
    expect(doc("10:00")).toBeUndefined();

    // 09:00:30 makes the retry call (no value yet) and succeeds: the outage is over.
    await expect(poller.tick(at("09:00", 30))).resolves.toEqual({ calls: 1, written: 1 });
    // A tick that needs no call while healthy resolves.
    await expect(poller.tick(at("09:01"))).resolves.toEqual({ calls: 0, written: 0 });
  });

  it("keeps rejecting on ticks that make no call, while the last call failed", async () => {
    const { poller, fetchOffsets } = setup(["10:00"]);
    const down = new DirectionsError("naver", "http", "HTTP 503", 503);
    fetchOffsets.mockRejectedValueOnce(down);
    await expect(poller.tick(at("09:00"))).rejects.toBe(down);
    // Outside any window: no call is needed, but nothing has proven NAVER back.
    await expect(poller.tick(at("12:00"))).rejects.toBe(down);
  });

  it("Daily cap: a crossed cap rejects the tick without calling", async () => {
    const { poller, fetchOffsets } = setup(["10:00"], { cap: 2 });
    await poller.tick(at("09:00"));
    await poller.tick(at("09:10"));
    const err = await poller.tick(at("09:20")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DailyCapError);
    expect((err as Error).message).toBe("naver: daily cap of 2 calls reached");
    expect(fetchOffsets).toHaveBeenCalledTimes(2);
  });
});

describe("DailyCap", () => {
  it("starts over at 00:00 KST", () => {
    const cap = new DailyCap("tmap", 1);
    cap.take(at("23:59"));
    expect(() => cap.take(at("23:59", 30))).toThrow(DailyCapError);
    expect(() => cap.take(moment(at("00:00")).add(1, "day").toDate())).not.toThrow();
  });
});
