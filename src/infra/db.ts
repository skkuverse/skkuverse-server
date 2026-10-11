import { MongoClient, type MongoClientOptions } from "mongodb";
import config from "./config";

/**
 * WHY: a hot read past this is already a failed request to the client, and running on only holds a
 * pooled connection the next request needs. Long-running work must not use it.
 */
export const HOT_READ_MAX_TIME_MS = 3_000;

/**
 * WHY: bounded, so a slow cluster fails requests fast instead of queueing them until nginx times out
 * every upstream. The pool wait is bounded on `api` only: poller bulk writes hold every connection by
 * design. No socket or operation timeout: long operations are legitimate; hot reads carry their own.
 */
export function mongoClientOptions(
  role = process.env.ROLE || "combined",
): MongoClientOptions {
  return {
    maxPoolSize: 5,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    ...(role === "api" ? { waitQueueTimeoutMS: 2_000 } : {}),
  };
}

let client: MongoClient | undefined;

function getClient(): MongoClient {
  if (!client) {
    client = new MongoClient(config.mongo.url, mongoClientOptions());
  }
  return client;
}

async function closeClient(): Promise<void> {
  if (client) {
    await client.close();
    client = undefined;
  }
}

async function ping(): Promise<void> {
  const c = getClient();
  await c.db("admin").command({ ping: 1 });
}

export { getClient, closeClient, ping };
