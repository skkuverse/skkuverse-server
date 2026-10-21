/**
 * In-memory GamesRepository: the content database's `games` dataset. The read reads as the real one does (pinned
 * in src/games/games.repository.spec.ts): the revision and data only, parsed with the same schema, so a missing or
 * invalid document reads as `null`. `storeGames` stores data unchecked at the next revision, as `npm run data`
 * would without its checks, so a test can seed an invalid one; `seededWith(data)` builds a fake holding it as
 * revision 1. `failWith` makes the next reads reject, as a database error would, wrapped in GamesRegistryReadError
 * as the real read wraps it; `readCount` counts the reads that reached the store.
 */
import type { StoredGames } from "../../../../src/games/games.document";
import { GamesRegistryReadError } from "../../../../src/games/games.error";
import type { GamesRepository } from "../../../../src/games/games.repository";
import { storedGames } from "../../../../src/games/games.schema";
import type { PublicOf } from "../public-of";

export class FakeGamesRepository implements PublicOf<GamesRepository> {
  stored: { revision: unknown; data: unknown } | null = null;
  failWith: Error | null = null;
  readCount = 0;

  static seededWith(data: unknown): FakeGamesRepository {
    const repository = new FakeGamesRepository();
    repository.storeGames(data);
    return repository;
  }

  /** Stores `data` as the next revision of `games`, unchecked, and returns that revision. */
  storeGames(data: unknown): number {
    const revision = typeof this.stored?.revision === "number" ? this.stored.revision + 1 : 1;
    this.stored = { revision, data: structuredClone(data) };
    return revision;
  }

  async findGames(): Promise<StoredGames | null> {
    if (this.failWith) throw new GamesRegistryReadError(this.failWith);
    this.readCount += 1;
    if (this.stored === null) return null;
    const parsed = storedGames.safeParse(structuredClone(this.stored));
    return parsed.success ? parsed.data : null;
  }
}
