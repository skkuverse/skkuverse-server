/**
 * Scripted JourneyDeparturesService: `listDepartures` answers the board set in `boards` for a line's source line id,
 * or rejects with the error `failWith` holds for it, or with a DepartureUnavailableError for a line it has none of. It
 * records each query in `queries`, so a test can count the door reads a plan paid for.
 */
import type { JourneyDeparturesService } from "../../../../src/journey/departures/journey-departures.service";
import type { JourneySourceId } from "../../../../src/journey/journey.types";
import { DepartureUnavailableError } from "../../../../src/shared/departure.error";
import type { DepartureBoard, DepartureQuery } from "../../../../src/shared/departure.types";
import type { PublicOf } from "../public-of";

export class FakeJourneyDeparturesService implements PublicOf<JourneyDeparturesService> {
  boards = new Map<string, DepartureBoard>();
  failWith = new Map<string, Error>();
  queries: Array<{ source: JourneySourceId; query: DepartureQuery }> = [];

  async listDepartures(source: JourneySourceId, query: DepartureQuery): Promise<DepartureBoard> {
    this.queries.push({ source, query });
    const failure = this.failWith.get(query.lineId);
    if (failure) throw failure;
    const board = this.boards.get(query.lineId);
    if (!board) throw new DepartureUnavailableError(`no board for ${query.lineId}`);
    return structuredClone(board);
  }
}
