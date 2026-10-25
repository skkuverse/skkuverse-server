/**
 * BusLiveGroupService: the live route of a realtime group, the HSSC line's or a Jongno route's, with the server's
 * clock in meta; a schedule group has none (404 GROUP_NOT_LIVE) and an unknown group is not found (404 GROUP_NOT_FOUND).
 * The stop page reads a station's direction through it, as /bus/config names it, and each call it serves is headed
 * where its station's direction is, in the request language (ADR 0022, D2).
 */
import { FakeBusLiveHsscService } from "../../../../__tests__/helpers/fakes/bus/bus-live-hssc.service.fake";
import { FakeBusLiveJongroService } from "../../../../__tests__/helpers/fakes/bus/bus-live-jongro.service.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import { storedBusRegistryService } from "../../../../__tests__/helpers/bus/bus-registry";
import { storedBusRoutePathService } from "../../../../__tests__/helpers/bus/bus-route-path";
import { storedRouteAttributesService } from "../../../../__tests__/helpers/bus/route-attributes";
import { storedBusStopsService } from "../../../../__tests__/helpers/bus/bus-stops";
import { AppError } from "../../../http/app.error";
import type { Clock } from "../../../infra/clock";
import { BusConfigService } from "../../config/bus-config.service";
import type { BusLiveHsscService } from "../hssc/bus-live-hssc.service";
import type { BusLiveJongroService } from "../jongro/bus-live-jongro.service";
import type { LiveGroup } from "../bus-live.wire";
import { BusLiveGroupService } from "./bus-live-group.service";

const clock: Clock = { now: () => new Date("2026-10-20T01:00:00Z") };
const jongro07: LiveGroup = { groupId: "jongro07", stationsVersion: "0346768f2b776f45", updatedAt: null, operation: "noData", vehicles: [], stations: [] };

let jongro: FakeBusLiveJongroService;
let hssc: FakeBusLiveHsscService;
let service: BusLiveGroupService;

beforeEach(() => {
  jongro = new FakeBusLiveJongroService();
  hssc = new FakeBusLiveHsscService();
  const config = new BusConfigService(storedBusStopsService(), storedBusRegistryService(), storedRouteAttributesService(), storedBusRoutePathService());
  service = new BusLiveGroupService(asReal<BusLiveJongroService>(jongro), asReal<BusLiveHsscService>(hssc), config, clock);
});

describe("BusLiveGroupService.getLiveGroup", () => {
  it("serves a Jongno route's live group with the server's clock at +09:00", async () => {
    // Arrange
    jongro.groups.set("jongro07", jongro07);

    // Act & Assert
    expect(await service.getLiveGroup("jongro07", "ko")).toEqual({ data: jongro07, meta: { serverNow: "2026-10-20T10:00:00+09:00" } });
  });

  it("serves the HSSC line's live group", async () => {
    // Act & Assert
    expect((await service.getLiveGroup("hssc", "ko")).data).toEqual(hssc.group);
  });

  it.each([
    ["campus", "GROUP_NOT_LIVE"],
    ["commute", "GROUP_NOT_LIVE"],
    ["nope", "GROUP_NOT_FOUND"],
  ])("answers %s with 404 %s", async (groupId, code) => {
    // Act
    const failure = await service.getLiveGroup(groupId, "ko").catch((err: unknown) => err);

    // Assert
    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ code, httpStatus: 404 });
  });
});

describe("BusLiveGroupService.findLiveGroup", () => {
  const call = {
    ...{ status: "enRoute" as const, expectedArrivalAt: null, expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
    ...{ basis: "provider" as const, stopsAway: 2, runId: null, vehicleId: "100000201", headsign: null },
    ...{ isFirstRun: null, isLastRun: false, isExpress: null, providerText: "4분10초후[2번째 전]" },
  };
  const station = (stationIndex: number) => ({ stationIndex, stopId: null, arsId: null, operation: "running" as const, arrivals: [call] });

  it("heads each call where its station's /bus/config direction is, in the request language, keeping the call's key order", async () => {
    // Arrange
    jongro.groups.set("jongro07", { ...jongro07, stations: [station(16), station(17)] });

    // Act
    const group = await service.findLiveGroup("jongro07", "en");

    // Assert
    expect(group.stations.map(({ stationIndex, arrivals }) => [stationIndex, arrivals.map(({ headsign }) => headsign)])).toEqual([
      [16, ["To 성균관대운동장"]],
      [17, ["To 성균관대운동장"]],
    ]);
    expect(Object.keys(group.stations[0]!.arrivals[0]!)).toEqual(Object.keys(call));
  });

  it("heads no call of a group placed by another stations version than the config's", async () => {
    // Arrange
    jongro.groups.set("jongro07", { ...jongro07, stationsVersion: "synced-since", stations: [station(16)] });

    // Act
    const group = await service.findLiveGroup("jongro07", "ko");

    // Assert
    expect(group.stations[0]!.arrivals.map(({ headsign }) => headsign)).toEqual([null]);
  });
});

describe("BusLiveGroupService.findStationDirection", () => {
  it("answers the direction /bus/config names at the station, for the stations version given", async () => {
    // Act
    const [route07, hsscStation, elsewhere] = [
      await service.findStationDirection("jongro07", { stationIndex: 16, stationsVersion: jongro07.stationsVersion }, "ko"),
      await service.findStationDirection("hssc", { stationIndex: 6, stationsVersion: null }, "en"),
      await service.findStationDirection("jongro07", { stationIndex: 16, stationsVersion: "synced-since" }, "ko"),
    ];

    // Assert
    expect(route07).toEqual({ id: "100900220", label: "성균관대운동장 방면" });
    expect(hsscStation).toEqual({ id: "toCampus", label: "To campus" });
    expect(elsewhere).toBeNull();
  });
});
