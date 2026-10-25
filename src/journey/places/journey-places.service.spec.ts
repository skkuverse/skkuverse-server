/**
 * JourneyPlacesService resolves a cited place through its owning catalog at plan time (ADR 0022, D4): a bus stop
 * through the stop index, named as its stop page names it in the request language, at its coords; an SKKU building by
 * its `_id`, named in the request language with English for Chinese; a served subway station by its title and stored
 * coords, with the platform the leg names; and null for a ref no catalog holds, a stop area, or a station with no
 * stored coords. No place is tappable yet.
 */
import { storedBuilding } from "../../../__tests__/helpers/building/buildings";
import { storedBusRegistryService } from "../../../__tests__/helpers/bus/bus-registry";
import { capturedRoutePathOf } from "../../../__tests__/helpers/bus/bus-route-path";
import { storedBusStopsService } from "../../../__tests__/helpers/bus/bus-stops";
import { FakeBuildingRepository } from "../../../__tests__/helpers/fakes/building/building.repository.fake";
import { FakeBusRoutePathService } from "../../../__tests__/helpers/fakes/bus/bus-route-path.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { storedStationCoordsService } from "../../../__tests__/helpers/subway/station-coords";
import { BuildingService } from "../../building/building.service";
import type { BusRoutePathService } from "../../bus/route-path/bus-route-path.service";
import { BusStopIndexService } from "../../bus/stop-index/bus-stop-index.service";
import { SubwayStationsService } from "../../subway/stations/subway-stations.service";
import { JourneyPlacesService } from "./journey-places.service";

const CLOCK = { now: () => new Date("2026-10-20T05:10:00.000Z") };

function placesService(routePaths = new FakeBusRoutePathService()): JourneyPlacesService {
  const buildings = new FakeBuildingRepository();
  buildings.buildings = [storedBuilding({ _id: 1, buildNo: null, campus: "hssc", type: "facility", name: { ko: "정문", en: "Main Gate" }, location: { type: "Point", coordinates: [126.997131, 37.584865] } })];
  const index = new BusStopIndexService(storedBusStopsService(), storedBusRegistryService(), asReal<BusRoutePathService>(routePaths), CLOCK);
  return new JourneyPlacesService(index, new BuildingService(asReal<ConstructorParameters<typeof BuildingService>[0]>(buildings)), new SubwayStationsService(), storedStationCoordsService());
}

describe("JourneyPlacesService.findPlace", () => {
  it("resolves a bus stop through the stop index, named as its stop page names it", async () => {
    // Act
    const place = await placesService().findPlace("bus_stop:hssc-bus-lot", null, "en");

    // Assert
    expect(place).toEqual({ kind: "bus_stop", id: "hssc-bus-lot", name: "Student Union bus parking lot", coords: { lat: 37.587367, lng: 126.993643 }, platformId: null, action: { actionType: "route", actionValue: "/map?place=bus_stop:hssc-bus-lot" } });
  });

  it("resolves a building by its _id, in Korean and with English for Chinese", async () => {
    // Arrange
    const service = placesService();

    // Act
    const [ko, zh] = await Promise.all([service.findPlace("skku_building:1", null, "ko"), service.findPlace("skku_building:1", null, "zh")]);

    // Assert
    expect(ko).toEqual({ kind: "skku_building", id: "1", name: "정문", coords: { lat: 37.584865, lng: 126.997131 }, platformId: null, action: { actionType: "route", actionValue: "/map?place=skku_building:1" } });
    expect(zh?.name).toBe("Main Gate");
  });

  it("resolves a served station with its stored coords and the platform the leg names", async () => {
    // Act
    const place = await placesService().findPlace("subway_station:hyehwa", "S1-4-420", "ko");

    // Assert
    expect(place).toMatchObject({ kind: "subway_station", id: "hyehwa", name: "혜화역", coords: { lat: 37.582336, lng: 127.001844 }, platformId: "S1-4-420" });
    expect(place?.action).toEqual({ actionType: "route", actionValue: "/map?place=subway_station:hyehwa" });
  });

  it("serves and opens a stop cited by its seoul-<ARS> alias as the pole's nine-digit station id", async () => {
    // Arrange
    const routePaths = new FakeBusRoutePathService();
    // WHY: a pole has no coords of its own; it is drawn on the stored line of a route that stops at it.
    routePaths.routePaths = { routePaths: [{ routeId: "jongro07", code: "07", ...capturedRoutePathOf("jongro07") }], hasMissingRoutes: false };

    // Act
    const place = await placesService(routePaths).findPlace("bus_stop:seoul-01592", null, "ko");

    // Assert
    expect(place?.id).toBe("100900075");
    expect(place?.action).toEqual({ actionType: "route", actionValue: "/map?place=bus_stop:100900075" });
  });

  it.each(["bus_stop:nowhere", "skku_building:999", "subway_station:suwon", "bus_stop_area:hyehwa", "not-a-ref"])("is null for %s", async (ref) => {
    // Act & Assert
    expect(await placesService().findPlace(ref, null, "ko")).toBeNull();
  });
});
