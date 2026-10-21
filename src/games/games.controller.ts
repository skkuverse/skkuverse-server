import { Controller, Get, Param } from "@nestjs/common";
import { CacheControl } from "../http/cache-control.decorator";
import { GAMES_CACHE_CONTROL } from "./games.constants";
import { toGameNotFound } from "./games.rules";
import { GamesService } from "./games.service";
import type { GameEntry, GameIndex } from "./games.wire";

@Controller("games")
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Get()
  @CacheControl(GAMES_CACHE_CONTROL)
  index(): Promise<GameIndex> {
    return this.games.index();
  }

  @Get(":id")
  @CacheControl(GAMES_CACHE_CONTROL)
  async detail(@Param("id") id: string): Promise<GameEntry> {
    const entry = await this.games.detail(id);
    if (!entry) throw toGameNotFound(id);
    return entry;
  }
}
