/**
 * A real `mongod` for boundary and characterization tests (harden-test-suite
 * design D6): one per test file, started in `beforeAll` by `startMongod()` and
 * stopped in `afterAll`. Jest runs a worker's files one after another, so this
 * is also one per worker at a time.
 *
 * src/infra/config.ts reads MONGO_URL when it is first imported, so a test calls
 * `startMongod()` before it loads any `src/` module: it imports `src/` only as
 * types at the top and `require()`s the rest in `beforeAll` (ts-jest keeps an
 * `await import()` native, which Jest refuses without --experimental-vm-modules).
 * `stop()` puts the previous MONGO_URL back.
 *
 * The binary is fetched by the package's postinstall during `npm ci`, never by
 * a test: `config.mongodbMemoryServer` in package.json pins the version (the
 * one Atlas runs) and turns runtime downloads off, so a missing binary fails
 * here with "could not find an valid binary path" instead of a download.
 *
 * mongodb-memory-server probes for a free port by listening on every address,
 * which the network guard refuses; the port is taken here on 127.0.0.1 and
 * handed over with port generation off.
 */
import net from "node:net";
import type { Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

export interface TestMongod {
  /** `mongodb://127.0.0.1:<port>/`, also set as MONGO_URL until `stop()`. */
  readonly uri: string;
  stop(): Promise<void>;
}

function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export async function startMongod(): Promise<TestMongod> {
  const port = await freeLoopbackPort();
  const server = await MongoMemoryServer.create({
    instance: { ip: "127.0.0.1", port, portGeneration: false },
  });
  const uri = server.getUri();
  const previousUrl = process.env.MONGO_URL;
  process.env.MONGO_URL = uri;
  return {
    uri,
    async stop(): Promise<void> {
      try {
        await server.stop({ doCleanup: true, force: true });
      } finally {
        if (previousUrl === undefined) delete process.env.MONGO_URL;
        else process.env.MONGO_URL = previousUrl;
      }
    },
  };
}

/**
 * Empties every collection of `db` and keeps its indexes: a read that hints an
 * index (notices' FORCE_INDEX) fails once the index is gone, and the app
 * creates its indexes only at boot.
 */
export async function clearCollections(db: Db): Promise<void> {
  const collections = await db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}
