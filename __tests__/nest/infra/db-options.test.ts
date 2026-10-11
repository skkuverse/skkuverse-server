/**
 * The MongoDB client options per role: server selection and connect are
 * bounded everywhere, the pool wait only on the api role, nothing cuts long
 * work, and hot reads are capped within the server-selection budget.
 */
import {
  closeClient,
  getClient,
  HOT_READ_MAX_TIME_MS,
  mongoClientOptions,
} from "../../../src/infra/db";

describe("mongoClientOptions", () => {
  it("bounds server selection and connect for every role", () => {
    // Act & Assert
    for (const role of ["api", "poller", "combined"]) {
      expect(mongoClientOptions(role)).toMatchObject({
        serverSelectionTimeoutMS: 5_000,
        connectTimeoutMS: 5_000,
        maxPoolSize: 5,
        minPoolSize: 1,
      });
    }
  });

  it("bounds the pool wait only on the api role", () => {
    // Act & Assert
    expect(mongoClientOptions("api").waitQueueTimeoutMS).toBe(2_000);
    // Both run the building sync, whose bulk writes legitimately hold the pool.
    expect(mongoClientOptions("poller")).not.toHaveProperty("waitQueueTimeoutMS");
    expect(mongoClientOptions("combined")).not.toHaveProperty("waitQueueTimeoutMS");
  });

  it("sets no socket or operation-wide timeout that would cut long work", () => {
    // Act
    const opts = mongoClientOptions("api");

    // Assert
    expect(opts).not.toHaveProperty("socketTimeoutMS");
    expect(opts).not.toHaveProperty("timeoutMS");
  });

  it("caps hot reads within the server-selection budget", () => {
    // Assert
    expect(HOT_READ_MAX_TIME_MS).toBeGreaterThan(0);
    expect(HOT_READ_MAX_TIME_MS).toBeLessThanOrEqual(5_000);
  });
});

describe("getClient", () => {
  const savedRole = process.env.ROLE;

  afterEach(async () => {
    await closeClient();
    if (savedRole === undefined) delete process.env.ROLE;
    else process.env.ROLE = savedRole;
  });

  it("builds the client from the role's options without connecting", () => {
    // Arrange
    process.env.ROLE = "api";

    // Act
    const { options } = getClient();

    // Assert
    expect(options.serverSelectionTimeoutMS).toBe(5_000);
    expect(options.waitQueueTimeoutMS).toBe(2_000);
  });
});
