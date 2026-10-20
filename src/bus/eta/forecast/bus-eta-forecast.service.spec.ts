/**
 * BusEtaForecastService, the baseline flow's door to its predictions, over a
 * scripted TMAP client, the committed lane config and an in-memory store: the
 * TMAP forecast with the configured key, and the fixed value a bus-lane run's
 * prediction reuses (design D7): the latest of the same service, route type,
 * KST weekday and departure time that is fixed, live, unexpired and fits the
 * sequence; never one for a car run.
 */
import { FakeBusEtaForecastClient } from "../../../../__tests__/helpers/fakes/bus/bus-eta-forecast.client.fake";
import { FakeBusEtaRepository } from "../../../../__tests__/helpers/fakes/bus/bus-eta.repository.fake";
import { FakeBusEtaLaneRepository } from "../../../../__tests__/helpers/fakes/bus/bus-eta-lane.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import config from "../../../infra/config";
import type { LatLng } from "../../../shared/lat-lng.types";
import type { BusScheduleService } from "../../schedule/bus-schedule.service";
import { BusStopsService } from "../../stops/bus-stops.service";
import { SubwayStationsService } from "../../../subway/stations/subway-stations.service";
import type { ShuttleEtaDoc } from "../bus-eta.document";
import type { BusEtaRepository } from "../bus-eta.repository";
import { BusEtaService } from "../bus-eta.service";
import type { EtaRun } from "../bus-eta.types";
import type { BusEtaLaneRepository } from "../lane/bus-eta-lane.repository";
import { BusEtaLaneService } from "../lane/bus-eta-lane.service";
import type { BusEtaForecastClient } from "./bus-eta-forecast.client";
import { BusEtaForecastService } from "./bus-eta-forecast.service";

// 04:00 KST on Tuesday 2026-10-20, still the 19th in UTC.

// The baseline flow reads only the lane strategies, never the stored corridor (move-reference-datasets D9).
function laneWithNoCorridor(eta: BusEtaService): BusEtaLaneService {
  return new BusEtaLaneService(eta, asReal<BusEtaLaneRepository>(new FakeBusEtaLaneRepository()), { now: () => new Date("2026-10-20T00:00:00.000Z") });
}
const NOW = new Date("2026-10-19T19:00:00.000Z");
const STOPS: LatLng[] = [
  { lat: 37.587367, lng: 126.993643 },
  { lat: 37.292298, lng: 126.975057 },
];
const HOUR_MS = 3600_000;

const kstInstant = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`);
const run = (date: string, time: string, routeType = "regular"): EtaRun => ({ serviceId: "campus-inja", routeType, date, time, departAt: kstInstant(date, time) });

function liveFixed(date: string, time: string, opts: { offsetsSec?: number[]; frozen?: boolean; kind?: "live" | "baseline"; expiresAt?: Date } = {}): ShuttleEtaDoc {
  const departAt = kstInstant(date, time);
  const kind = opts.kind ?? "live";
  return {
    _id: `campus-inja|regular|${date}|${time}|${kind}`,
    kind,
    serviceId: "campus-inja",
    routeType: "regular",
    date,
    time,
    departAt,
    offsetsSec: opts.offsetsSec ?? [0, 4320],
    source: kind === "live" ? "naver" : "tmap",
    fetchedAt: departAt,
    ...(opts.frozen === false ? {} : { frozen: true as const, frozenAt: departAt }),
    expiresAt: opts.expiresAt ?? new Date(departAt.getTime() + 192 * HOUR_MS),
  };
}

function setup(stored: ShuttleEtaDoc[] = []) {
  const repository = new FakeBusEtaRepository();
  for (const doc of stored) repository.docs.set(doc._id, doc);
  const eta = new BusEtaService(asReal<BusEtaRepository>(repository), {} as BusScheduleService, new BusStopsService(new SubwayStationsService()));
  const tmap = new FakeBusEtaForecastClient();
  const forecast = new BusEtaForecastService(laneWithNoCorridor(eta), asReal<BusEtaForecastClient>(tmap), eta);
  return { forecast, tmap, repository };
}

describe("BusEtaForecastService.fetchOffsets", () => {
  it("asks TMAP for the run's forecast with the configured app key", async () => {
    // Arrange
    const { forecast, tmap } = setup();
    const departAt = kstInstant("2026-10-27", "13:30");

    // Act
    const offsetsSec = await forecast.fetchOffsets(STOPS, departAt);

    // Assert
    expect(offsetsSec).toEqual([0, 5040]);
    expect(tmap.calls).toEqual([{ stops: STOPS, departAt, appKey: config.shuttleEta.tmapAppKey }]);
  });
});

describe("BusEtaForecastService.reusableFixedByRun", () => {
  it("gives a Tuesday 13:30 bus-lane run the latest fixed Tuesday 13:30 value, by its prediction's id", async () => {
    // Arrange
    const thisTuesday = liveFixed("2026-10-13", "13:30", { offsetsSec: [0, 4320] });
    const weekBefore = liveFixed("2026-10-06", "13:30", { offsetsSec: [0, 5040], expiresAt: new Date(NOW.getTime() + HOUR_MS) });
    const { forecast } = setup([thisTuesday, weekBefore]);

    // Act
    const byRun = await forecast.reusableFixedByRun([run("2026-10-20", "13:30")], NOW);

    // Assert
    expect([...byRun]).toEqual([
      ["campus-inja|regular|2026-10-20|13:30|baseline", { _id: thisTuesday._id, serviceId: "campus-inja", routeType: "regular", date: "2026-10-13", time: "13:30", offsetsSec: [0, 4320] }],
    ]);
  });

  it("gives a car run nothing, even with an earlier week's fixed value", async () => {
    // Arrange
    const { forecast } = setup([liveFixed("2026-10-13", "21:30")]);

    // Act
    const byRun = await forecast.reusableFixedByRun([run("2026-10-20", "21:30")], NOW);

    // Assert
    expect(byRun.size).toBe(0);
  });

  it.each([
    ["a live value that was never fixed", liveFixed("2026-10-13", "13:30", { frozen: false })],
    ["a prediction", liveFixed("2026-10-13", "13:30", { kind: "baseline" })],
    ["an expired fixed value", liveFixed("2026-10-13", "13:30", { expiresAt: NOW })],
    ["a fixed value for another stop count", liveFixed("2026-10-13", "13:30", { offsetsSec: [0, 4500, 4620] })],
  ])("gives a bus-lane run nothing from %s", async (_case, stored) => {
    // Arrange
    const { forecast } = setup([stored]);

    // Act
    const byRun = await forecast.reusableFixedByRun([run("2026-10-20", "13:30")], NOW);

    // Assert
    expect(byRun.size).toBe(0);
  });

  it("reads nothing when no run is a bus-lane run", async () => {
    // Arrange
    const { forecast, repository } = setup();
    repository.failWith = new Error("no read expected");

    // Act
    const byRun = await forecast.reusableFixedByRun([run("2026-10-20", "21:30"), run("2026-10-20", "06:30")], NOW);

    // Assert
    expect(byRun.size).toBe(0);
  });
});
