import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import config from "../../infra/config";
import { DailyCap } from "../../shared/daily-cap.util";
import { SubwaySeoulApiService } from "../seoul-api/subway-seoul-api.service";
import { SubwaySeoulTrainmapService } from "../seoul-trainmap/subway-seoul-trainmap.service";
import { SUBWAY_STATIONS } from "../subway.constants";
import { SEOUL_LINE_NAME_BY_SUBWAY_ID, SEOUL_STATION_NAME_BY_ID } from "./subway-seoul.constants";
import { toSeoulLines, toSettledObservations } from "./subway-seoul.rules";
import type { SettledObservations } from "./subway-seoul.types";

const SEOUL_LINES = toSeoulLines(SUBWAY_STATIONS, SEOUL_LINE_NAME_BY_SUBWAY_ID, SEOUL_STATION_NAME_BY_ID);
const API_SOURCE = "seoul-subway-api";
const TRAIN_MAP_SOURCE = "seoul-trainmap";

// WHY: no switch here: with SUBWAY=off nothing calls the provider (its pollers do not register). Each upstream
// call takes one from its source's daily ceiling first, so a runaway loop stops at the ceiling. A tick's calls
// settle apart, so one failing line drops no other line's trains (2026-10-17 05:16, line 4's page had no train).
@Injectable()
export class SubwaySeoulService {
  private readonly apiCap = new DailyCap(API_SOURCE, config.subway.apiDailyCap);
  private readonly trainMapCap = new DailyCap(TRAIN_MAP_SOURCE, config.subway.trainMapDailyCap);

  constructor(
    private readonly api: SubwaySeoulApiService,
    private readonly trainMap: SubwaySeoulTrainmapService,
    private readonly clock: Clock,
  ) {}

  async observeApi(): Promise<SettledObservations> {
    const take = <T>(call: () => Promise<T>): Promise<T> => this.withCap(this.apiCap, call);
    const [eventResults, countdownResults] = await Promise.all([
      Promise.allSettled(SEOUL_LINES.map((line) => take(() => this.api.listLineEvents(line.lineName, line.platformIdByName)))),
      Promise.allSettled(
        SEOUL_LINES.flatMap((line) =>
          line.stationNames.map((name) => take(() => this.api.listStationCountdownRows(name, line.platformIdByName))),
        ),
      ),
    ]);
    return toSettledObservations(API_SOURCE, eventResults, countdownResults);
  }

  async observeTrainMap(): Promise<SettledObservations> {
    const observedAt = this.clock.now();
    const eventResults = await Promise.allSettled(
      SEOUL_LINES.map((line) =>
        this.withCap(this.trainMapCap, () => this.trainMap.listLineEvents(line.trainMapLine, line.platformIdByName, observedAt)),
      ),
    );
    return toSettledObservations(TRAIN_MAP_SOURCE, eventResults, []);
  }

  private async withCap<T>(cap: DailyCap, call: () => Promise<T>): Promise<T> {
    cap.take(this.clock.now());
    return call();
  }
}
