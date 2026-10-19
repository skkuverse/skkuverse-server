/**
 * MiniappsCatalogClient: the cache layer over a first-party mini app's own
 * `public/skkuverse.json`, whose shell fields the catalog merges into
 * GET /miniapps/:id. The fetch itself is MiniappsManifestService's
 * (move-miniapp-registry task 2.3), here over the manifest client fake;
 * miniapps-manifest.client.spec.ts holds the request, the parse and every
 * refusal. What these guard: only a first-party mini app is fetched; a fetch
 * is cached for the TTL and served past it while the origin fails; a mini app
 * never fetched or currently failing answers `{}` with a warning; and the boot
 * prefetches every first-party mini app without one down stopping another.
 *
 * MiniappsService is stubbed with a plain object carrying only `.map` — the
 * one member this client reads — rather than going through Nest DI, so
 * these stay fast unit tests.
 */
jest.mock("../../infra/logger", () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { FakeMiniappsManifestClient } from "../../../__tests__/helpers/fakes/miniapps/miniapps-manifest.client.fake";
import { FakeMiniappsManifestRepository } from "../../../__tests__/helpers/fakes/miniapps/miniapps-manifest.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import logger from "../../infra/logger";
import type { MiniappsManifestClient } from "../manifest/miniapps-manifest.client";
import type { MiniappsManifestRepository } from "../manifest/miniapps-manifest.repository";
import { MiniappsManifestService } from "../manifest/miniapps-manifest.service";
import type { MiniAppDetailRaw } from "../miniapps.schema";
import type { MiniappsService } from "../miniapps.service";
import { MiniappsCatalogClient } from "./miniapps-catalog.client";
import { CACHE_TTL_MS } from "./miniapps-catalog.constants";

const warn = logger.warn as jest.Mock;

const MUKJA = "https://mukja.mini.skkuverse.com";
const PLAYLIST = "https://playlist.mini.skkuverse.com";

let manifestClient: FakeMiniappsManifestClient;

function detail(overrides: Partial<MiniAppDetailRaw> = {}): MiniAppDetailRaw {
  return {
    version: 1,
    id: "mukja",
    startUrl: "https://mukja.mini.skkuverse.com/",
    verified: true,
    relatedLinks: [],
    ...overrides,
  };
}

function clientWith(...details: MiniAppDetailRaw[]): MiniappsCatalogClient {
  const map = new Map(details.map((d) => [d.id, d]));
  const stub = { map } as unknown as MiniappsService;
  const manifests = new MiniappsManifestService(
    asReal<MiniappsManifestClient>(manifestClient),
    asReal<MiniappsManifestRepository>(new FakeMiniappsManifestRepository()),
    { now: () => new Date("2026-10-20T01:00:00Z") },
  );
  return new MiniappsCatalogClient(stub, manifests);
}

beforeEach(() => {
  warn.mockClear();
  manifestClient = new FakeMiniappsManifestClient();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("MiniappsCatalogClient.fetchShellFields", () => {
  it("never fetches a manifest for a non-first-party mini app", async () => {
    // Arrange
    const client = clientWith(detail({ id: "hssc", startUrl: "https://student.skku.edu/student/notice2.do" }));

    // Act & Assert
    await expect(client.fetchShellFields({ id: "hssc", startUrl: "https://student.skku.edu/student/notice2.do" })).resolves.toEqual({});
    expect(manifestClient.calls).toEqual([]);
  });

  it("returns the manifest's shell fields, fetched from the mini app's origin", async () => {
    // Arrange
    manifestClient.answers.set(MUKJA, { bar: "none", background: "#ABCDEF" });
    const client = clientWith(detail());

    // Act & Assert
    await expect(client.fetchShellFields(detail())).resolves.toEqual({
      bar: "none",
      background: "#ABCDEF",
    });
    expect(manifestClient.calls).toEqual([MUKJA]);
  });

  it("returns {} and warns when the origin never answers (no cached value to fall back on)", async () => {
    // Arrange
    manifestClient.answers.set(MUKJA, new Error("ECONNREFUSED"));
    const client = clientWith(detail());

    // Act & Assert
    await expect(client.fetchShellFields(detail())).resolves.toEqual({});
    expect(warn).toHaveBeenCalled();
  });

  it("caches a successful fetch for the TTL: a second call within it does not refetch", async () => {
    // Arrange
    manifestClient.answers.set(MUKJA, { bar: "top" });
    const client = clientWith(detail());

    await client.fetchShellFields(detail());
    await client.fetchShellFields(detail());

    // Act & Assert
    expect(manifestClient.calls).toHaveLength(1);
  });

  it("stale-while-revalidate: past the TTL, still serves the last good value at once while refreshing behind it", async () => {
    // Arrange
    jest.useFakeTimers({ now: 1_000_000 });
    manifestClient.answers.set(MUKJA, { bar: "top" });
    const client = clientWith(detail());

    // Act & Assert
    await expect(client.fetchShellFields(detail())).resolves.toEqual({ bar: "top" });

    manifestClient.answers.set(MUKJA, new Error("down after that"));
    jest.setSystemTime(1_000_000 + CACHE_TTL_MS + 1);
    // Answered immediately from the stale value, not blocked on the failing reload.
    await expect(client.fetchShellFields(detail())).resolves.toEqual({ bar: "top" });
    await jest.advanceTimersByTimeAsync(0);
    expect(manifestClient.calls).toHaveLength(2);

    // The failed background reload did not evict the last good value.
    await expect(client.fetchShellFields(detail())).resolves.toEqual({ bar: "top" });
  });

  it("keeps serving the last good value across many repeated failures", async () => {
    // Act & Assert
    jest.useFakeTimers({ now: 1_000_000 });
    manifestClient.answers.set(MUKJA, { bar: "top", background: "#123456" });
    const client = clientWith(detail());

    await client.fetchShellFields(detail());
    manifestClient.answers.set(MUKJA, new Error("down"));
    for (let i = 1; i <= 3; i += 1) {
      jest.setSystemTime(1_000_000 + (CACHE_TTL_MS + 1) * i);
      await expect(client.fetchShellFields(detail())).resolves.toEqual({
        bar: "top",
        background: "#123456",
      });
      await jest.advanceTimersByTimeAsync(0);
    }
  });
});

describe("MiniappsCatalogClient.onModuleInit", () => {
  it("prefetches every first-party mini app without blocking or throwing", async () => {
    // Arrange
    manifestClient.answers.set(MUKJA, { bar: "top" });
    manifestClient.answers.set(PLAYLIST, { bar: "top" });
    const client = clientWith(
      detail({ id: "mukja", startUrl: "https://mukja.mini.skkuverse.com/" }),
      detail({ id: "playlist", startUrl: "https://playlist.mini.skkuverse.com/" }),
      detail({ id: "hssc", startUrl: "https://student.skku.edu/student/notice2.do" }),
    );

    // Act & Assert
    expect(() => client.onModuleInit()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(manifestClient.calls).toEqual([MUKJA, PLAYLIST]);
  });

  it("one mini app being down does not stop another's prefetch, and warns rather than throwing", async () => {
    // Arrange
    manifestClient.answers.set(MUKJA, new Error("down"));
    manifestClient.answers.set(PLAYLIST, { bar: "top" });
    const client = clientWith(
      detail({ id: "mukja", startUrl: "https://mukja.mini.skkuverse.com/" }),
      detail({ id: "playlist", startUrl: "https://playlist.mini.skkuverse.com/" }),
    );

    client.onModuleInit();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Act & Assert
    await expect(
      client.fetchShellFields(detail({ id: "playlist", startUrl: "https://playlist.mini.skkuverse.com/" })),
    ).resolves.toEqual({ bar: "top" });
    expect(manifestClient.calls).toEqual([MUKJA, PLAYLIST]);
  });
});
