import type { Collection, Document } from "mongodb";
import { getClient } from "./db";
import logger from "./logger";

/**
 * A typed collection. Like `getClient`, only a `*.repository.ts` may import it
 * (ESLint `boundaries/get-client`).
 */
export function mongoCollection<T extends Document>(dbName: string, name: string): Collection<T> {
  return getClient().db(dbName).collection<T>(name);
}

export interface EnsureIndexesOptions {
  /** Tries before giving up; each retry waits `backoffMs` times its number. */
  attempts?: number;
  backoffMs?: number;
  /** Level of the final failure line: `error` where a missing index means full scans on a hot path. */
  failLevel?: "warn" | "error";
}

/**
 * A repository's index setup at boot (ADR 0010, D2). It never fails the boot:
 * the outcome is logged as `<scope>.indexes.ensured` or `<scope>.indexes.failed`
 * and the next boot tries again.
 */
export async function ensureIndexesAtBoot(
  scope: string,
  create: () => Promise<unknown>,
  { attempts = 1, backoffMs = 1_000, failLevel = "warn" }: EnsureIndexesOptions = {},
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await create();
      logger.info({ event: `${scope}.indexes.ensured` }, "Indexes ensured");
      return;
    } catch (err) {
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
        continue;
      }
      if (failLevel === "error") {
        logger.error({ event: `${scope}.indexes.failed`, err, attempts }, "Index setup failed");
      } else {
        logger.warn({ event: `${scope}.indexes.failed`, err, attempts }, "Index setup failed");
      }
      return;
    }
  }
}
