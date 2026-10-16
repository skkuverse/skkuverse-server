import { Injectable } from "@nestjs/common";
import type { TrainEvent } from "../subway.types";
import { SubwaySeoulTrainmapClient } from "./subway-seoul-trainmap.client";
import { toTrainEvents, toTrainMapTrains } from "./subway-seoul-trainmap.mapper";

@Injectable()
export class SubwaySeoulTrainmapService {
  constructor(private readonly client: SubwaySeoulTrainmapClient) {}

  async listLineEvents(line: string, stationIdByName: ReadonlyMap<string, string>, observedAt: Date): Promise<TrainEvent[]> {
    const page = await this.client.fetchLinePage(line);
    return toTrainEvents(toTrainMapTrains(page, line), stationIdByName, observedAt);
  }
}
