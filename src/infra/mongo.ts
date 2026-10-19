import type { Collection, Document } from "mongodb";
import { getClient } from "./db";
import logger from "./logger";
import { envRole, isPollingRole } from "./required-env";

export function mongoCollection<T extends Document>(dbName: string, name: string): Collection<T> {
  return getClient().db(dbName).collection<T>(name);
}

export interface EnsureIndexesOptions {
  attempts?: number;
  backoffMs?: number;
  // WHY: "error" where a hot read hints the index: without it every such read fails its hint (a 500), it never
  // falls back to a full scan.
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

async function runIndexSetup(
  scope: string,
  create: () => Promise<unknown>,
  { attempts = 1, backoffMs = 1_000, failLevel = "warn" }: EnsureIndexesOptions,
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

const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// WHY: never fails the boot, and holds it for one turn of the event loop at most: Nest awaits each
// module's hooks in turn, so waiting on Atlas would add one timeout per module. A setup still waiting
// on the database finishes in the background and logs its outcome then (ADR 0010, D2).
export function ensureIndexesAtBoot(
  scope: string,
  create: () => Promise<unknown>,
  options: EnsureIndexesOptions = {},
): Promise<void> {
  // WHY: an api replica writes nothing at boot; the poller, in every deploy, ensures each index (ADR 0012, D3).
  if (!isPollingRole(envRole(process.env))) return Promise.resolve();
  return Promise.race([runIndexSetup(scope, create, options), nextTurn()]);
}
