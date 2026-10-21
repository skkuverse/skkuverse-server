import { Injectable } from "@nestjs/common";
import { Clock } from "../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../infra/dataset-loader";
import logger from "../infra/logger";
import { GAME_ID_BY_FIRST_PARTY_ORIGIN } from "../infra/origins";
import { GAMES_LOG_INTERVAL_MS } from "./games.constants";
import type { StoredGames } from "./games.document";
import { GamesRegistryReadError, GamesRegistryUnavailableError } from "./games.error";
import { toGameRegistry } from "./games.mapper";
import { GamesRepository } from "./games.repository";
import { toGameOriginIssues } from "./games.rules";
import type { GameRegistry } from "./games.types";
import type { GameEntry, GameIndex } from "./games.wire";

@Injectable()
export class GamesService {
  // WHY: a reload every TTL re-finds the same mismatch; it is logged once per revision this process loads.
  private loggedRevision: number | null = null;
  private readonly loader: DatasetLoader<GameRegistry>;

  constructor(
    private readonly repository: GamesRepository,
    clock: Clock,
  ) {
    this.loader = createDatasetLoader({
      name: "games.registry",
      load: () => this.loadRegistry(),
      clock,
      isReadError: (err): err is GamesRegistryReadError => err instanceof GamesRegistryReadError,
      toUnavailable: () => new GamesRegistryUnavailableError(),
      readFailedEvent: "games.registry.read_failed",
      logIntervalMs: GAMES_LOG_INTERVAL_MS,
    });
  }

  async index(): Promise<GameIndex> {
    return { games: [...(await this.loader.get()).entries] };
  }

  async detail(id: string): Promise<GameEntry | null> {
    return (await this.loader.get()).entryOf(id) ?? null;
  }

  private async loadRegistry(): Promise<GameRegistry | null> {
    const stored = await this.repository.findGames();
    if (stored === null) return null;
    this.logOwnerMismatches(stored);
    return toGameRegistry(stored.data, stored.revision);
  }

  private logOwnerMismatches({ revision, data }: StoredGames): void {
    if (revision === this.loggedRevision) return;
    this.loggedRevision = revision;
    for (const { path, message } of toGameOriginIssues(data, GAME_ID_BY_FIRST_PARTY_ORIGIN)) {
      logger.error({ event: "games.registry.owner_mismatch", revision, path: path.join("."), reason: message }, "Game registry disagrees with the first-party game origins in code");
    }
  }
}
