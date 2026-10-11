import type { Collection, Document } from "mongodb";
import { getClient } from "./db";
import logger from "./logger";

export function mongoCollection<T extends Document>(dbName: string, name: string): Collection<T> {
  return getClient().db(dbName).collection<T>(name);
}

export interface EnsureIndexesOptions {
  attempts?: number;
  backoffMs?: number;
  // WHY: "error" where a missing index means full scans on a hot path.
  failLevel?: "warn" | "error";
}

type Outcome = { failed: false } | { failed: true; err: unknown };

async function tryCreate(create: () => Promise<unknown>): Promise<Outcome> {
  try {
    await create();
    return { failed: false };
  } catch (err) {
    return { failed: true, err };
  }
}

// WHY: never fails the boot; the outcome is logged and the next boot tries again (ADR 0010, D2).
export async function ensureIndexesAtBoot(
  scope: string,
  create: () => Promise<unknown>,
  { attempts = 1, backoffMs = 1_000, failLevel = "warn" }: EnsureIndexesOptions = {},
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const outcome = await tryCreate(create);
    if (!outcome.failed) {
      logger.info({ event: `${scope}.indexes.ensured` }, "Indexes ensured");
      return;
    }
    if (attempt >= attempts) {
      logger[failLevel]({ event: `${scope}.indexes.failed`, err: outcome.err, attempts }, "Index setup failed");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
  }
}
