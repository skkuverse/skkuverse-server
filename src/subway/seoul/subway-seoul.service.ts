import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import config from "../../infra/config";
import { DailyCap } from "../../shared/daily-cap.util";
import { SubwaySeoulApiService } from "../seoul-api/subway-seoul-api.service";
import { SubwaySeoulTrainmapService } from "../seoul-trainmap/subway-seoul-trainmap.service";
import { SUBWAY_STATIONS } from "../subway.constants";
import type { ProviderObservations } from "../subway.types";
import { SEOUL_LINE_NAME_BY_SUBWAY_ID, SEOUL_STATION_NAME_BY_ID } from "./subway-seoul.constants";
import { toSeoulLines } from "./subway-seoul.rules";

const SEOUL_LINES = toSeoulLines(SUBWAY_STATIONS, SEOUL_LINE_NAME_BY_SUBWAY_ID, SEOUL_STATION_NAME_BY_ID);
const API_SOURCE = "seoul-subway-api";
const TRAIN_MAP_SOURCE = "seoul-trainmap";

// WHY: no switch here: with SUBWAY=off nothing calls the provider (its pollers do not register). Each upstream
// call takes one from its source's daily ceiling first, so a runaway loop stops at the ceiling.
@Injectable()
export class SubwaySeoulService {
  private readonly apiCap = new DailyCap(API_SOURCE, config.subway.apiDailyCap);
  private readonly trainMapCap = new DailyCap(TRAIN_MAP_SOURCE, config.subway.trainMapDailyCap);

  constructor(
    private readonly api: SubwaySeoulApiService,
    private readonly trainMap: SubwaySeoulTrainmapService,
    private readonly clock: Clock,
  ) {}

  async observeApi(): Promise<ProviderObservations> {
    const take = <T>(call: () => Promise<T>): Promise<T> => this.withCap(this.apiCap, call);
    const [events, countdownRows] = await Promise.all([
      Promise.all(SEOUL_LINES.map((line) => take(() => this.api.listLineEvents(line.lineName, line.stationIdByName)))),
      Promise.all(
        SEOUL_LINES.flatMap((line) =>
          line.stationNames.map((name) => take(() => this.api.listStationCountdownRows(name, line.stationIdByName))),
        ),
      ),
    ]);
    return { source: API_SOURCE, events: events.flat(), countdownRows: countdownRows.flat() };
  }

  async observeTrainMap(): Promise<ProviderObservations> {
    const observedAt = this.clock.now();
    const events = await Promise.all(
      SEOUL_LINES.map((line) =>
        this.withCap(this.trainMapCap, () => this.trainMap.listLineEvents(line.trainMapLine, line.stationIdByName, observedAt)),
      ),
    );
    return { source: TRAIN_MAP_SOURCE, events: events.flat(), countdownRows: [] };
  }

  private async withCap<T>(cap: DailyCap, call: () => Promise<T>): Promise<T> {
    cap.take(this.clock.now());
    return call();
  }
}
