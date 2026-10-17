import { Injectable } from "@nestjs/common";
import type { TrainEvent } from "../subway.types";
import { SubwaySeoulTrainmapClient } from "./subway-seoul-trainmap.client";
import { SubwaySeoulTrainmapError } from "./subway-seoul-trainmap.error";
import { toTrainEvents, toTrainMapTrains } from "./subway-seoul-trainmap.mapper";
import { isEmptyTooLong, toEmptySpell } from "./subway-seoul-trainmap.rules";
import type { EmptySpell, TrainMapTrain } from "./subway-seoul-trainmap.types";

const OK_STATUS = 200;

// WHY: a line has no train for a while after the window opens each morning, so an empty line fails only once
// its empty spell is too long to be that (MAX_EMPTY_LINE_MS).
@Injectable()
export class SubwaySeoulTrainmapService {
  private readonly emptySpellByLine = new Map<string, EmptySpell>();

  constructor(private readonly client: SubwaySeoulTrainmapClient) {}

  async listLineEvents(line: string, platformIdByName: ReadonlyMap<string, string>, observedAt: Date): Promise<TrainEvent[]> {
    const trains = toTrainMapTrains(await this.client.fetchLinePage(line), line);
    this.assertNotEmptyTooLong(line, trains, observedAt);
    return toTrainEvents(trains, platformIdByName, observedAt);
  }

  private assertNotEmptyTooLong(line: string, trains: readonly TrainMapTrain[], observedAt: Date): void {
    if (trains.length > 0) return void this.emptySpellByLine.delete(line);
    const spell = toEmptySpell(this.emptySpellByLine.get(line), observedAt);
    this.emptySpellByLine.set(line, spell);
    if (isEmptyTooLong(spell)) {
      throw new SubwaySeoulTrainmapError(`line ${line}: no train since ${spell.since.toISOString()}`, OK_STATUS, "unexpected_shape");
    }
  }
}
