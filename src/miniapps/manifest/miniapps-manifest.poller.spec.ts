/**
 * MiniappsManifestPoller registers one poller per first-party origin of
 * src/infra/origins.ts, named `miniapp-manifest-<hostname>`, every four
 * minutes, so one mini app's origin down marks only its own poller failing
 * (move-miniapp-registry D8). A tick is that origin's refresh and rejects with
 * it. The registry is a `registerPoller` spy (ADR 0011 D2) and the service a
 * stub; whether a process runs its pollers (ROLE) is the registry's. A game
 * origin serves no mini-app manifest, so none of its hosts is polled.
 */
import { FIRST_PARTY_MINIAPP_ORIGINS, GAME_ID_BY_FIRST_PARTY_ORIGIN } from "../../infra/origins";
import type { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { MiniappsManifestPoller } from "./miniapps-manifest.poller";
import type { MiniappsManifestService } from "./miniapps-manifest.service";

const refresh = jest.fn<Promise<void>, [string]>();
const registerPoller = jest.fn<void, Parameters<PollerRegistryService["registerPoller"]>>();
const registry = { registerPoller } as unknown as PollerRegistryService;
const manifests = { refresh } as unknown as MiniappsManifestService;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("MiniappsManifestPoller.onModuleInit", () => {
  it("registers one four-minute poller per first-party origin, named after its host", () => {
    // Act
    new MiniappsManifestPoller(registry, manifests).onModuleInit();

    // Assert
    expect(registerPoller.mock.calls.map(([, intervalMs, name]) => [intervalMs, name])).toEqual([
      [240_000, "miniapp-manifest-eskara.miniapp.skkuverse.com"],
      [240_000, "miniapp-manifest-mukja.mini.skkuverse.com"],
      [240_000, "miniapp-manifest-playlist.mini.skkuverse.com"],
      [240_000, "miniapp-manifest-booth-box.mini.skkuverse.com"],
      [240_000, "miniapp-manifest-inja.mini.skkuverse.com"],
      [240_000, "miniapp-manifest-timetable.mini.skkuverse.com"],
    ]);
  });

  it("ticks refresh their own origin and reject with it", async () => {
    // Arrange
    const failure = new Error("manifest 503 from https://mukja.mini.skkuverse.com");
    refresh.mockRejectedValue(failure);
    new MiniappsManifestPoller(registry, manifests).onModuleInit();
    const tick = registerPoller.mock.calls[1]![0];

    // Act & Assert
    await expect(Promise.resolve(tick())).rejects.toBe(failure);
    expect(refresh.mock.calls).toEqual([[FIRST_PARTY_MINIAPP_ORIGINS[1]]]);
  });

  it("ticks resolve when the refresh does", async () => {
    // Arrange
    refresh.mockResolvedValue(undefined);
    new MiniappsManifestPoller(registry, manifests).onModuleInit();
    const tick = registerPoller.mock.calls[5]![0];

    // Act & Assert
    await expect(Promise.resolve(tick())).resolves.toBeUndefined();
    expect(refresh.mock.calls).toEqual([["https://timetable.mini.skkuverse.com"]]);
  });

  it("registers no poller for a first-party game origin", () => {
    // Arrange
    const gameHosts = Object.keys(GAME_ID_BY_FIRST_PARTY_ORIGIN).map((origin) => new URL(origin).hostname);

    // Act
    new MiniappsManifestPoller(registry, manifests).onModuleInit();

    // Assert
    const names = registerPoller.mock.calls.map(([, , name]) => name);
    expect(names.filter((name) => gameHosts.some((host) => name.endsWith(host)))).toEqual([]);
  });
});
