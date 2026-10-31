import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import type { z } from "zod";
import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { createLogThrottle } from "../shared/log-throttle.util";
import logger from "../infra/logger";
import { mongoCollection } from "../infra/mongo";
import { APP_PLATFORM_GATES_DATASET, APP_PLATFORM_GATES_LOG_INTERVAL_MS } from "./app-config.constants";
import type { AppPlatformGatesDatasetDoc, StoredAppPlatformGates } from "./app-config.document";
import { AppConfigPlatformGatesReadError } from "./app-config.error";
import { storedAppPlatformGates } from "./app-config.schema";

@Injectable()
export class AppConfigRepository {
  private readonly logThrottle = createLogThrottle(APP_PLATFORM_GATES_LOG_INTERVAL_MS);

  async findPlatformGates(): Promise<StoredAppPlatformGates | null> {
    const doc = await this.datasets()
      .findOne({ _id: APP_PLATFORM_GATES_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new AppConfigPlatformGatesReadError(err);
      });
    if (doc === null) return this.reportMissing();
    const parsed = storedAppPlatformGates.safeParse(doc);
    if (!parsed.success) return this.reportInvalid(doc.revision, parsed.error);
    for (const platform of ["ios", "android"] as const) {
      if (parsed.data.data[platform].updateUrl === null) this.reportUpdateUrlRefused(parsed.data.revision, platform);
    }
    return parsed.data;
  }

  private reportUpdateUrlRefused(revision: number, platform: "ios" | "android"): void {
    const taken = this.logThrottle.take(`update_url_refused:${revision}:${platform}`);
    if (!taken) return;
    logger.error(
      { event: "app_config.platform_gates.update_url_refused", dataset: APP_PLATFORM_GATES_DATASET, revision, platform, ...taken },
      "App platform gate updateUrl is not an app store address, served as null",
    );
  }

  private reportMissing(): null {
    const taken = this.logThrottle.take("missing");
    if (taken) {
      logger.error(
        { event: "app_config.platform_gates.missing", dataset: APP_PLATFORM_GATES_DATASET, ...taken },
        "App platform gates dataset not found; /app/config unavailable",
      );
    }
    return null;
  }

  private reportInvalid(revision: unknown, error: z.ZodError): null {
    const taken = this.logThrottle.take(`invalid:${String(revision)}`);
    if (!taken) return null;
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error(
      { event: "app_config.platform_gates.invalid", dataset: APP_PLATFORM_GATES_DATASET, revision, issues, ...taken },
      "App platform gates dataset fails its schema, not served",
    );
    return null;
  }

  private datasets(): Collection<AppPlatformGatesDatasetDoc> {
    return mongoCollection<AppPlatformGatesDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
