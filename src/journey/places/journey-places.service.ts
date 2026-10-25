import { Injectable } from "@nestjs/common";
import { BuildingService } from "../../building/building.service";
import { BusStopIndexService } from "../../bus/stop-index/bus-stop-index.service";
import { pick } from "../../infra/i18n";
import type { SupportedLang } from "../../infra/types";
import type { LatLng } from "../../shared/lat-lng.types";
import { toPlaceAction } from "../../shared/place.util";
import type { Place } from "../../shared/place.wire";
import { SubwayStationCoordsService } from "../../subway/station-coords/subway-station-coords.service";
import { SubwayStationsService } from "../../subway/stations/subway-stations.service";
import { toPlaceRef } from "../journey.rules";
import type { PlaceRef } from "../journey.types";

// WHY: `id` is the one the catalog serves, a stop's canonical id for a `seoul-<arsId>` alias, as /bus/stops serves it.
type Located = { id: string; name: string; coords: LatLng };

// SEE: docs/explanation/journey-architecture.md ("Glossary"): a place ref resolves through its owning catalog at plan time, never copied.
@Injectable()
export class JourneyPlacesService {
  constructor(
    private readonly stops: BusStopIndexService,
    private readonly buildings: BuildingService,
    private readonly stations: SubwayStationsService,
    private readonly stationCoords: SubwayStationCoordsService,
  ) {}

  // WHY: null for a ref its catalog no longer holds or holds without coords; a place is served only with both (ADR 0022, D4).
  async findPlace(ref: string, platformId: string | null, lang: SupportedLang): Promise<Place | null> {
    const placeRef = toPlaceRef(ref);
    const located = placeRef && (await this.locate(placeRef, lang));
    if (!placeRef || !located) return null;
    return { kind: placeRef.kind, id: located.id, name: located.name, coords: located.coords, platformId, action: toPlaceAction(placeRef.kind, located.id) };
  }

  private locate({ kind, id }: PlaceRef, lang: SupportedLang): Promise<Located | null> {
    if (kind === "bus_stop") return this.locateStop(id, lang);
    if (kind === "skku_building") return this.locateBuilding(id, lang);
    if (kind === "subway_station") return this.locateStation(id, lang);
    return Promise.resolve(null);
  }

  private async locateStop(id: string, lang: SupportedLang): Promise<Located | null> {
    const stop = await this.stops.findStop(id);
    if (!stop?.coords) return null;
    const name = this.stops.servedRecordOf(stop, lang)?.name ?? stop.poles[0]?.stationName ?? id;
    return { id: stop.id, name, coords: stop.coords };
  }

  private async locateBuilding(id: string, lang: SupportedLang): Promise<Located | null> {
    const building = (await this.buildings.listAllBuildings()).find((each) => String(each._id) === id);
    if (!building) return null;
    const [lng, lat] = building.location.coordinates;
    return { id, name: pick(building.name, lang) ?? id, coords: { lat, lng } };
  }

  private async locateStation(id: string, lang: SupportedLang): Promise<Located | null> {
    const station = this.stations.listStations().find((each) => each.id === id);
    const coords = station ? await this.stationCoords.findCoords(id) : null;
    return station && coords ? { id, name: station.title[lang], coords } : null;
  }
}
