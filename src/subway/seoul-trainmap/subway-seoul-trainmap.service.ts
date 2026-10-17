import { Injectable } from "@nestjs/common";
import type { TrainEvent } from "../subway.types";
import { SubwaySeoulTrainmapClient } from "./subway-seoul-trainmap.client";
import { ALL_LINES_PAGE } from "./subway-seoul-trainmap.constants";
import { SubwaySeoulTrainmapError } from "./subway-seoul-trainmap.error";
import { toTrainEvents, toTrainMapTrains } from "./subway-seoul-trainmap.mapper";
import { isEmptyTooLong, toEmptySpell } from "./subway-seoul-trainmap.rules";
import type { EmptySpell, TrainMapLine, TrainMapTrain } from "./subway-seoul-trainmap.types";

const OK_STATUS = 200;

// WHY: one request reads every line, and each line's blocks are parsed on their own, so markup that breaks one line
// fails that line alone. A line has no train for a while after the window opens each morning, so an empty line fails
// only once its empty spell is too long to be that (MAX_EMPTY_LINE_MS).
@Injectable()
export class SubwaySeoulTrainmapService {
  private readonly emptySpellByLine = new Map<string, EmptySpell>();

  constructor(private readonly client: SubwaySeoulTrainmapClient) {}

  async listLineEventResults(lines: readonly TrainMapLine[], observedAt: Date): Promise<Array<PromiseSettledResult<TrainEvent[]>>> {
    const page = await this.client.fetchLinePage(ALL_LINES_PAGE);
    return lines.map((line): PromiseSettledResult<TrainEvent[]> => {
      try {
        return { status: "fulfilled", value: this.toLineEvents(page, line, observedAt) };
      } catch (reason: unknown) {
        return { status: "rejected", reason };
      }
    });
  }

  private toLineEvents(page: string, { trainMapLine, platformIdByName }: TrainMapLine, observedAt: Date): TrainEvent[] {
    const trains = toTrainMapTrains(page, trainMapLine);
    this.assertNotEmptyTooLong(trainMapLine, trains, observedAt);
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
