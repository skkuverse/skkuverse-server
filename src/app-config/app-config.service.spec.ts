/**
 * AppConfigService.getConfig, the /app/config body, read over an in-memory
 * `app-features` store and a fixed clock. The platform gates and origins come
 * from boot-time values; `features` comes from the stored `app-features`
 * dataset (ADR 0013, D6), cached for DATASET_CACHE_TTL_MS so a flip is served
 * within a minute, and kept through a failed reload for
 * DATASET_STALE_WINDOW_MS. It is a kill switch: with no good value (nothing
 * stored, only an invalid revision, or a database that never answered) the
 * features are served off, never a 503, and a failed read is logged at error.
 *
 * The cached loader reads `Date.now()`, so the TTL is crossed with Jest's fake system time.
 */
jest.mock("../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
import { appFeaturesFixture } from "../../__tests__/helpers/app-config/app-features";
import { FakeAppConfigRepository } from "../../__tests__/helpers/fakes/app-config/app-config.repository.fake";
import { asReal } from "../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../infra/clock";
import logger from "../infra/logger";
import { BRIDGE_ORIGINS, WEB_ORIGIN } from "../infra/origins";
import { DATASET_CACHE_TTL_MS, DATASET_STALE_WINDOW_MS } from "../shared/dataset.constants";
import type { AppConfigRepository } from "./app-config.repository";
import { AppConfigService } from "./app-config.service";

const NOW = new Date("2026-10-23T04:00:00.000Z");
const ON = { sharedMapShell: true };
const mockedLogger = logger as unknown as Record<"error" | "warn", jest.Mock>;

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
  it("serves the stored features beside the boot-time gates and origins", async () => {
    // Arrange
    const { repository, appConfig } = setup();
    repository.storeFeatures(ON);

    // Act
    const body = await appConfig.getConfig();

    // Assert
    expect(body.features).toEqual({ sharedMapShell: true });
    expect(body.webview.bridgeOrigins).toEqual([...BRIDGE_ORIGINS]);
    expect(body.web.origin).toBe(WEB_ORIGIN);
    expect(Object.keys(body)).toEqual(["ios", "android", "webview", "web", "miniapps", "games", "features"]);
    expect(loggedEvents("error")).toEqual([]);
  });

  it("Kill switch flipped off: serves the push once the TTL has passed, and not before", async () => {
    // Arrange
    const { repository, appConfig, advanceTo } = setup();
    repository.storeFeatures(ON);
    await appConfig.getConfig();
    repository.storeFeatures(appFeaturesFixture());

    // Act
    advanceTo(DATASET_CACHE_TTL_MS - 1);
    const before = await appConfig.getConfig();
    advanceTo(DATASET_CACHE_TTL_MS);
    const after = await appConfig.getConfig();

    // Assert
    expect(before.features).toEqual({ sharedMapShell: true });
    expect(after.features).toEqual({ sharedMapShell: false });
  });

  it("Nothing stored: serves the switches off, reading once per TTL", async () => {
    // Arrange
    const { repository, appConfig } = setup();

    // Act
    const first = await appConfig.getConfig();
    const second = await appConfig.getConfig();

    // Assert
    expect([first.features, second.features]).toEqual([{ sharedMapShell: false }, { sharedMapShell: false }]);
    expect(first.ios).toHaveProperty("minVersion");
    expect(repository.readCount).toBe(1);
  });

  it("Only an invalid revision stored: serves the switches off", async () => {
    // Arrange
    const { repository, appConfig } = setup();
    repository.storeFeatures({ sharedMapShell: "true" });

    // Act
    const body = await appConfig.getConfig();

    // Assert
    expect(body.features).toEqual({ sharedMapShell: false });
  });

  it("Fresh replica, database down: serves the switches off and logs the failed read at error", async () => {
    // Arrange
    const { repository, appConfig } = setup();
    repository.failWith = new Error("server selection timed out");

    // Act
    const body = await appConfig.getConfig();

    // Assert
    expect(body.features).toEqual({ sharedMapShell: false });
    expect(loggedEvents("error")).toEqual([expect.objectContaining({ event: "app_config.features.read_failed" })]);
  });

  it("keeps the last good revision through failed reloads for the stale window, then serves the switches off", async () => {
    // Arrange
    const { repository, appConfig, advanceTo } = setup();
    repository.storeFeatures(ON);
    await appConfig.getConfig();
    repository.failWith = new Error("server selection timed out");

    // Act
    advanceTo(DATASET_STALE_WINDOW_MS - 1);
    const held = await appConfig.getConfig();
    advanceTo(DATASET_STALE_WINDOW_MS + DATASET_CACHE_TTL_MS);
    const past = await appConfig.getConfig();

    // Assert
    expect(held.features).toEqual({ sharedMapShell: true });
    expect(past.features).toEqual({ sharedMapShell: false });
  });
});
