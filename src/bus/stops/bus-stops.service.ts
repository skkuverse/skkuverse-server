import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../../infra/dataset-loader";
import type { SupportedLang } from "../../infra/types";
import { SubwayStationsService } from "../../subway/stations/subway-stations.service";
import type { LocalizedName } from "../../subway/subway.types";
import { SERVICE_CONFIG } from "../bus.constants";
import { BUS_STOPS_LOG_INTERVAL_MS } from "./bus-stops.constants";
import { BusStopsReadError, BusStopsUnavailableError } from "./bus-stops.error";
import { resolveStopSequences, toBusStopsSnapshot } from "./bus-stops.mapper";
import { BusStopsRepository } from "./bus-stops.repository";
import { etaOptIns } from "./bus-stops.rules";
import type { BusStopsSnapshot, EtaOptIns, ResolvedStops } from "./bus-stops.types";

// SEE: docs/explanation/bus-architecture.md ("Invariants"): the config groups, the smart view and the estimate pollers read the stops here.
@Injectable()
export class BusStopsService {
  // WHY: a reload every TTL finds the same revision; its snapshot is built, and frozen, once.
  private built: BusStopsSnapshot | null = null;
  private readonly loader: DatasetLoader<BusStopsSnapshot>;
  private readonly subwayTitles: ReadonlyMap<string, LocalizedName>;

  constructor(
    private readonly repository: BusStopsRepository,
    stations: SubwayStationsService,
    clock: Clock,
  ) {
    this.subwayTitles = new Map(stations.listStations().map((station) => [station.id, station.title]));
    this.loader = createDatasetLoader({
      name: "bus.stops",
      load: () => this.loadSnapshot(),
      clock,
      isReadError: (err): err is BusStopsReadError => err instanceof BusStopsReadError,
      toUnavailable: () => new BusStopsUnavailableError(),
      readFailedEvent: "bus.stops.read_failed",
      logIntervalMs: BUS_STOPS_LOG_INTERVAL_MS,
    });
  }

  current(): Promise<BusStopsSnapshot> {
    return this.loader.get();
  }

  servedSequences(snapshot: BusStopsSnapshot, serviceIds: readonly string[], { lang, hasStopMaps }: { lang: SupportedLang; hasStopMaps: boolean }): ResolvedStops {
    return resolveStopSequences(serviceIds, lang, { catalog: snapshot.catalog, subwayTitles: this.subwayTitles, hasStopMaps });
  }

  etaOptIns(): EtaOptIns {
    return etaOptIns(SERVICE_CONFIG);
  }

  private async loadSnapshot(): Promise<BusStopsSnapshot | null> {
    const stored = await this.repository.findStops();
    if (stored === null) return null;
    if (stored.revision === this.built?.revision) return this.built;
    this.built = toBusStopsSnapshot(stored);
    return this.built;
  }
}
