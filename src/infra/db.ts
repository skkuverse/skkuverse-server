import { MongoClient, type MongoClientOptions } from "mongodb";
import config from "./config";

/**
 * Server-side cap for a query on a request's hot path. A read that takes longer
 * than this is already a failed request from the client's point of view, and
 * letting it run on only holds a pooled connection that the next request needs.
 * Long-running work (building sync, the notices sweep) must not use it.
 */
export const HOT_READ_MAX_TIME_MS = 3_000;

/**
 * (An operations detail is left out of the public history.)
 *
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
    client = new MongoClient(config.mongo.url!, mongoClientOptions());
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
