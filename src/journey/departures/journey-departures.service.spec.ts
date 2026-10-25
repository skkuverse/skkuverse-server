/**
 * JourneyDeparturesService, the registry (ADR 0022, D6): a dataset line's source picks its door, and the query reaches
 * it unchanged, so a `busTimetable` line is answered by the timetabled-shuttle door with its runs and its next service,
 * a `subway` line by the subway timetable door with its trains between the two platforms, and a `topis` line by the
 * TOPIS door with the live route's predicted vehicles and the stored headway.
 */
import { storedJongroRouteDocuments } from "../../../__tests__/helpers/bus/bus-registry";
import { jongroArrivalDoc } from "../../../__tests__/helpers/bus/bus-cache-docs";
import { topisDepartures } from "../../../__tests__/helpers/bus/topis-departures";
import { storedBusStopsService } from "../../../__tests__/helpers/bus/bus-stops";
import { FakeBusCacheRepository } from "../../../__tests__/helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusLiveGroupService } from "../../../__tests__/helpers/fakes/bus/bus-live-group.service.fake";
import { FakeBusEtaSmartService } from "../../../__tests__/helpers/fakes/bus/bus-eta-smart.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { storedSubwayTimetableService } from "../../../__tests__/helpers/subway/timetables";
import { BusDeparturesTimetableService } from "../../bus/departures/timetable/bus-departures-timetable.service";
import type { BusEtaSmartService } from "../../bus/eta/smart/bus-eta-smart.service";
import { FakeSubwayArrivalsService } from "../../../__tests__/helpers/fakes/subway/subway-arrivals.service.fake";
import type { SubwayArrivalsService } from "../../subway/arrivals/subway-arrivals.service";
import { SubwayTimetableDeparturesService } from "../../subway/timetable/departures/subway-timetable-departures.service";
import { JourneyDeparturesService } from "./journey-departures.service";

const kst = (time: string) => new Date(`2026-10-20T${time}:00+09:00`);
const stopTime = (at: Date | null) => ({ shownAt: at, isEstimated: false, latestEstimateAt: null, timetableAt: at });
const run = (time: string) => ({
  runId: `campus-inja|regular|2026-10-20|${time}`,
  ...{ routeType: "regular", date: "2026-10-20", departureAt: kst(time), isFirstOfDay: false, isLastOfDay: false },
  stopTimes: [stopTime(kst(time)), stopTime(null)],
  estimate: null,
});

const CLOCK = { now: () => kst("19:07") };

function registryOver(smart = new FakeBusEtaSmartService(), { live = new FakeBusLiveGroupService(), cache = new FakeBusCacheRepository() } = {}): JourneyDeparturesService {
  const timetable = new BusDeparturesTimetableService(asReal<BusEtaSmartService>(smart), storedBusStopsService());
  const subway = new SubwayTimetableDeparturesService(storedSubwayTimetableService(), asReal<SubwayArrivalsService>(new FakeSubwayArrivalsService()));
  return new JourneyDeparturesService(timetable, subway, topisDepartures({ live, cache, clock: CLOCK }));
}

describe("JourneyDeparturesService.listDepartures", () => {
  it("answers a busTimetable line from the timetabled-shuttle door", async () => {
    // Arrange
    const smart = new FakeBusEtaSmartService();
    smart.runLists.set("campus-inja", { status: "active", runs: [run("14:30"), run("18:00")] });
    const registry = registryOver(smart);
    const query = { lineId: "campus-inja", boardStopId: "hssc-bus-lot", alightStopId: "nsc-n-center", from: kst("14:10"), until: kst("17:10"), lang: "ko" as const };

    // Act
    const board = await registry.listDepartures("busTimetable", query);

    // Assert
    expect(board.departures.map((departure) => departure.board.runId)).toEqual(["campus-inja|regular|2026-10-20|14:30"]);
    expect(board.nextServiceAt).toEqual(kst("18:00"));
  });

  it("answers a subway line from the subway timetable door", async () => {
    // Arrange
    const query = { lineId: "4", boardStopId: "S1-4-420", alightStopId: "KR-4-443", from: kst("06:20"), until: kst("06:40"), lang: "ko" as const };

    // Act
    const board = await registryOver().listDepartures("subway", query);

    // Assert
    expect(board.departures.map((departure) => [departure.board.runId, departure.alight?.runId])).toEqual([
      ["4/2026-10-20/4517", "4/2026-10-20/4517"],
      ["4/2026-10-20/4519", "4/2026-10-20/4519"],
      ["4/2026-10-20/4521", "4/2026-10-20/4521"],
    ]);
  });

  it("answers a topis line from the TOPIS door", async () => {
    // Arrange
    const live = new FakeBusLiveGroupService();
    const predicted = {
      status: "enRoute" as const,
      ...{ expectedArrivalAt: "2026-10-20T19:09:09+09:00", expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
      basis: "provider" as const,
      ...{ stopsAway: 3, runId: null, vehicleId: "100000074", headsign: null, isFirstRun: null, isLastRun: false, isExpress: null, providerText: "2분후[2번째 전]" },
    };
    const stationsVersion = storedJongroRouteDocuments().find((doc) => doc._id === "jongro08")!.stationsVersion;
    live.groups.set("jongro08", { groupId: "jongro08", stationsVersion, updatedAt: null, operation: "running", vehicles: [], stations: [{ stationIndex: 3, stopId: "100900046", arsId: "01531", operation: "running", arrivals: [predicted] }] });
    const cache = new FakeBusCacheRepository();
    cache.values.set("jongro_stations_08", [jongroArrivalDoc({ stationId: "100900046", sequence: "4", term: 9 })]);
    const query = { lineId: "jongro08", boardStopId: "100900046", alightStopId: "100900191", from: kst("19:07"), until: kst("22:07"), lang: "ko" as const };

    // Act
    const board = await registryOver(undefined, { live, cache }).listDepartures("topis", query);

    // Assert
    expect(board.departures.map((departure) => [departure.board.vehicleId, departure.board.expectedArrivalAt])).toEqual([["100000074", new Date("2026-10-20T19:09:09+09:00")]]);
    expect(board.continuation).toEqual({ kind: "headway", headwaySec: 540, serviceEndsAt: null });
  });
});
