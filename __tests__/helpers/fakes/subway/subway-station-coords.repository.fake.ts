/**
 * In-memory SubwayStationCoordsRepository: the content database's
 * `subway-station-coords` dataset. The read reads as the real one does
 * (pinned in src/subway/station-coords/subway-station-coords.repository.spec.ts):
 * the revision and data only, parsed with the same schema, so a missing or
 * invalid document reads as `null`. `storeCoords` stores data unchecked at
 * the next revision, as `npm run data` would without its checks, so a test can
 * seed an invalid one. `failWith` makes the next reads reject, as a database
 * error would, wrapped in SubwayStationCoordsReadError as the real read wraps
 * it; `readCount` counts the reads that reached the store.
 */
import type { StoredStationCoords } from "../../../../src/subway/station-coords/subway-station-coords.document";
import { SubwayStationCoordsReadError } from "../../../../src/subway/station-coords/subway-station-coords.error";
import type { SubwayStationCoordsRepository } from "../../../../src/subway/station-coords/subway-station-coords.repository";
import { storedStationCoords } from "../../../../src/subway/station-coords/subway-station-coords.schema";
import type { PublicOf } from "../public-of";

export class FakeSubwayStationCoordsRepository implements PublicOf<SubwayStationCoordsRepository> {
  stored: { revision: unknown; data: unknown } | null = null;
  failWith: Error | null = null;
  readCount = 0;

  /** Stores `data` as the next revision of `subway-station-coords`, unchecked, and returns that revision. */
  storeCoords(data: unknown): number {
    const revision = typeof this.stored?.revision === "number" ? this.stored.revision + 1 : 1;
    this.stored = { revision, data: structuredClone(data) };
    return revision;
  }

  async findCoords(): Promise<StoredStationCoords | null> {
    if (this.failWith) throw new SubwayStationCoordsReadError(this.failWith);
    this.readCount += 1;
    if (this.stored === null) return null;
    const parsed = storedStationCoords.safeParse(structuredClone(this.stored));
    return parsed.success ? parsed.data : null;
  }
}
