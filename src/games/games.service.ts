import { Injectable } from "@nestjs/common";
import { Clock } from "../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../infra/dataset-loader";
import { GAMES_LOG_INTERVAL_MS } from "./games.constants";
import { GamesRegistryReadError, GamesRegistryUnavailableError } from "./games.error";
import { toGameRegistry } from "./games.mapper";
import { GamesRepository } from "./games.repository";
import type { GameRegistry } from "./games.types";
import type { GameEntry, GameIndex } from "./games.wire";

@Injectable()
export class GamesService {
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
    return stored === null ? null : toGameRegistry(stored.data, stored.revision);
  }
}
