import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import type { z } from "zod";
import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { createLogThrottle } from "../shared/log-throttle.util";
import logger from "../infra/logger";
import { mongoCollection } from "../infra/mongo";
import { GAMES_DATASET, GAMES_LOG_INTERVAL_MS } from "./games.constants";
import type { GamesDatasetDoc, StoredGames } from "./games.document";
import { GamesRegistryReadError } from "./games.error";
import { storedGames } from "./games.schema";

@Injectable()
export class GamesRepository {
  private readonly logThrottle = createLogThrottle(GAMES_LOG_INTERVAL_MS);

  async findGames(): Promise<StoredGames | null> {
    const doc = await this.datasets()
      .findOne({ _id: GAMES_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new GamesRegistryReadError(err);
      });
    if (doc === null) return this.reportMissing();
    const parsed = storedGames.safeParse(doc);
    return parsed.success ? parsed.data : this.reportInvalid(doc.revision, parsed.error);
  }

  private reportMissing(): null {
    const taken = this.logThrottle.take("missing");
    if (taken) logger.error({ event: "games.registry.missing", dataset: GAMES_DATASET, ...taken }, "Game registry dataset not found");
    return null;
  }

  private reportInvalid(revision: unknown, error: z.ZodError): null {
    const taken = this.logThrottle.take(`invalid:${String(revision)}`);
    if (!taken) return null;
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error({ event: "games.registry.invalid", dataset: GAMES_DATASET, revision, issues, ...taken }, "Game registry dataset fails its schema, not served");
    return null;
  }

  private datasets(): Collection<GamesDatasetDoc> {
    return mongoCollection<GamesDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
