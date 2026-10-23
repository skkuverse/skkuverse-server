import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../../infra/dataset-loader";
import logger from "../../infra/logger";
import type { LatLng } from "../../shared/lat-lng.types";
import { SUBWAY_STATIONS } from "../subway.constants";
import { STATION_COORDS_LOG_INTERVAL_MS } from "./subway-station-coords.constants";
import type { StoredStationCoords } from "./subway-station-coords.document";
import { SubwayStationCoordsReadError, SubwayStationCoordsUnavailableError } from "./subway-station-coords.error";
import { SubwayStationCoordsRepository } from "./subway-station-coords.repository";
import { toMissingStationIds, toUnknownStationIds } from "./subway-station-coords.rules";
import type { StationCoordsSnapshot } from "./subway-station-coords.types";

// SEE: docs/explanation/subway-architecture.md ("Invariants"): the arrivals route serves a station without coords, never a 503.
@Injectable()
export class SubwayStationCoordsService {
  // WHY: a reload every TTL re-finds the same gap; it is logged once per revision this process loads.
  private loggedRevision: number | null = null;
  private readonly loader: DatasetLoader<StationCoordsSnapshot>;

  constructor(
    private readonly repository: SubwayStationCoordsRepository,
    clock: Clock,
  ) {
    this.loader = createDatasetLoader({
      name: "subway.station_coords",
      load: () => this.loadSnapshot(),
      clock,
      isReadError: (err): err is SubwayStationCoordsReadError => err instanceof SubwayStationCoordsReadError,
      toUnavailable: () => new SubwayStationCoordsUnavailableError(),
      readFailedEvent: "subway.station_coords.read_failed",
      logIntervalMs: STATION_COORDS_LOG_INTERVAL_MS,
    });
  }

  // WHY: null for coords never read (the loader and repository log why at error) or a station the revision lacks.
  async findCoords(stationId: string): Promise<LatLng | null> {
    try {
      return (await this.loader.get()).coordsOf(stationId) ?? null;
    } catch (err) {
      if (err instanceof SubwayStationCoordsUnavailableError) return null;
      throw err;
    }
  }

  private async loadSnapshot(): Promise<StationCoordsSnapshot | null> {
    const stored = await this.repository.findCoords();
    if (stored === null) return null;
    this.logGaps(stored);
    const { revision, data } = stored;
    const servedIds = new Set(SUBWAY_STATIONS.map((station) => station.id));
    return { revision, coordsOf: (stationId) => (servedIds.has(stationId) && Object.hasOwn(data.stations, stationId) ? data.stations[stationId] : undefined) };
  }

  private logGaps({ revision, data }: StoredStationCoords): void {
    if (revision === this.loggedRevision) return;
    this.loggedRevision = revision;
    const stationIds = SUBWAY_STATIONS.map((station) => station.id);
    for (const stationId of toMissingStationIds(data, stationIds)) {
      logger.warn({ event: "subway.station_coords.station_missing", revision, stationId }, "A subway station the code serves has no stored coords; served without them");
    }
    for (const stationId of toUnknownStationIds(data, stationIds)) {
      logger.warn({ event: "subway.station_coords.station_unknown", revision, stationId }, "Stored coords name a subway station the code does not serve; ignored");
    }
  }
}
