/**
 * AppConfigService.getConfig, the /app/config body, read over an in-memory `app-platform-gates` store and a
 * fixed clock. The platform gates (`ios`, `android`) come from the stored dataset (ADR 0013, D6), cached for
 * DATASET_CACHE_TTL_MS so a raised floor is served within a minute, and kept through a failed reload for
 * DATASET_STALE_WINDOW_MS; the origins come from src/infra/origins.ts. The body ends at `games`.
 *
 * The gates carry the force-update floor, so there is no default to serve: with no good value (nothing
 * stored, only an invalid revision, or a database that never answered) getConfig rejects as
 * AppConfigPlatformGatesUnavailableError, a 503, never a permissive gate; a failed read is logged at error.
 *
 * The cached loader reads `Date.now()`, so the TTL is crossed with Jest's fake system time.
 */
jest.mock("../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
import { appPlatformGatesFixture } from "../../__tests__/helpers/app-config/app-platform-gates";
import { FakeAppConfigRepository } from "../../__tests__/helpers/fakes/app-config/app-config.repository.fake";
import { asReal } from "../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../infra/clock";
import logger from "../infra/logger";
import { BRIDGE_ORIGINS, GAME_ID_BY_FIRST_PARTY_ORIGIN, MINIAPP_ID_BY_FIRST_PARTY_ORIGIN, WEB_ORIGIN } from "../infra/origins";
import { DATASET_CACHE_TTL_MS, DATASET_STALE_WINDOW_MS } from "../shared/dataset.constants";
import type { AppConfigRepository } from "./app-config.repository";
import { AppConfigService } from "./app-config.service";

const NOW = new Date("2026-10-25T04:00:00.000Z");
const mockedLogger = logger as unknown as Record<"error" | "warn", jest.Mock>;
const UNAVAILABLE = { name: "AppConfigPlatformGatesUnavailableError", code: "APP_PLATFORM_GATES_UNAVAILABLE", httpStatus: 503 };

function raisedGates() {
  const gates = appPlatformGatesFixture();
  gates.ios.minVersion = "3.6.2";
  gates.android.minVersion = "3.6.2";
  return gates;
}

function setup() {
  let now = NOW;
  const clock: Clock = { now: () => now };
  const repository = new FakeAppConfigRepository();
  const appConfig = new AppConfigService(asReal<AppConfigRepository>(repository), clock);
  // The clock and Date.now() move together: the dataset loader reads the one, the cached loader the other.
  const advanceTo = (msAfterNow: number): void => {
    now = new Date(NOW.getTime() + msAfterNow);
    jest.setSystemTime(now);
  };
  return { repository, appConfig, advanceTo };
}

const loggedEvents = (level: "error" | "warn") => mockedLogger[level].mock.calls.map(([fields]) => fields);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("AppConfigService.getConfig", () => {
  it("serves the stored platform gates beside the origins, ending the body at games", async () => {
    // Arrange
    const { repository, appConfig } = setup();
    repository.storePlatformGates(appPlatformGatesFixture());

    // Act
    const body = await appConfig.getConfig();

    // Assert
    expect(Object.keys(body)).toEqual(["ios", "android", "webview", "web", "miniapps", "games"]);
    expect({ ios: body.ios, android: body.android }).toEqual(appPlatformGatesFixture());
    expect(body.webview.bridgeOrigins).toEqual([...BRIDGE_ORIGINS]);
    expect(body.web.origin).toBe(WEB_ORIGIN);
    expect(body.miniapps.origins).toEqual({ ...MINIAPP_ID_BY_FIRST_PARTY_ORIGIN });
    expect(body.games?.origins).toEqual({ ...GAME_ID_BY_FIRST_PARTY_ORIGIN });
    expect(loggedEvents("error")).toEqual([]);
  });

  it("Floor raised: serves the push once the TTL has passed, and not before", async () => {
    // Arrange
    const { repository, appConfig, advanceTo } = setup();
    repository.storePlatformGates(appPlatformGatesFixture());
    await appConfig.getConfig();
    repository.storePlatformGates(raisedGates());

    // Act
    advanceTo(DATASET_CACHE_TTL_MS - 1);
    const before = await appConfig.getConfig();
    advanceTo(DATASET_CACHE_TTL_MS);
    const after = await appConfig.getConfig();

    // Assert
    expect([before.ios.minVersion, before.android.minVersion]).toEqual(["3.5.0", "3.5.0"]);
    expect([after.ios.minVersion, after.android.minVersion]).toEqual(["3.6.2", "3.6.2"]);
  });

  it("Nothing stored: rejects as unavailable, reading once per TTL", async () => {
    // Arrange
    const { repository, appConfig } = setup();

    // Act
    const first = appConfig.getConfig();
    await expect(first).rejects.toMatchObject(UNAVAILABLE);
    const second = appConfig.getConfig();

    // Assert
    await expect(second).rejects.toMatchObject(UNAVAILABLE);
    expect(repository.readCount).toBe(1);
  });

  it("Only an invalid revision stored: rejects as unavailable, serving no gate", async () => {
    // Arrange
    const { repository, appConfig } = setup();
    repository.storePlatformGates({ ...appPlatformGatesFixture(), ios: { minVersion: "1.0.0" } });

    // Act & Assert
    await expect(appConfig.getConfig()).rejects.toMatchObject(UNAVAILABLE);
  });

  it("Fresh replica, database down: rejects as unavailable and logs the failed read at error", async () => {
    // Arrange
    const { repository, appConfig } = setup();
    repository.failWith = new Error("server selection timed out");

    // Act
    const config = appConfig.getConfig();

    // Assert
    await expect(config).rejects.toMatchObject(UNAVAILABLE);
    expect(loggedEvents("error")).toEqual([expect.objectContaining({ event: "app_config.platform_gates.read_failed" })]);
  });

  it("keeps the last good revision through failed reloads for the stale window, then rejects as unavailable", async () => {
    // Arrange
    const { repository, appConfig, advanceTo } = setup();
    repository.storePlatformGates(raisedGates());
    await appConfig.getConfig();
    repository.failWith = new Error("server selection timed out");

    // Act
    advanceTo(DATASET_STALE_WINDOW_MS - 1);
    const held = await appConfig.getConfig();
    advanceTo(DATASET_STALE_WINDOW_MS + DATASET_CACHE_TTL_MS);
    const past = appConfig.getConfig();

    // Assert
    expect(held.ios.minVersion).toBe("3.6.2");
    await expect(past).rejects.toMatchObject(UNAVAILABLE);
  });

  it("keeps the last good revision when an invalid one is pushed", async () => {
    // Arrange
    const { repository, appConfig, advanceTo } = setup();
    repository.storePlatformGates(raisedGates());
    await appConfig.getConfig();
    repository.storePlatformGates({ ...raisedGates(), android: { ...raisedGates().android, minOsVersion: "7.0" } });

    // Act
    advanceTo(DATASET_CACHE_TTL_MS);
    const body = await appConfig.getConfig();

    // Assert
    expect(body.android).toEqual(raisedGates().android);
  });
});
