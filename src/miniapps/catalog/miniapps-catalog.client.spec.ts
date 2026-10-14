/**
 * MiniappsCatalogClient: the fetch/cache layer that pulls a first-party mini
 * app's own `public/skkuverse.json` and turns it into the shell fields the
 * catalog merges into GET /miniapps/:id, over a stubbed global fetch.
 *
 * MiniappsService is stubbed with a plain object carrying only `.map` — the
 * one member this client reads — rather than going through Nest DI, so
 * these stay fast unit tests.
 */
jest.mock("../../infra/logger", () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import logger from "../../infra/logger";
import type { MiniAppDetailRaw } from "../miniapps.schema";
import type { MiniappsService } from "../miniapps.service";
import { MiniappsCatalogClient } from "./miniapps-catalog.client";
import { CACHE_TTL_MS, FETCH_TIMEOUT_MS, MAX_MANIFEST_BYTES } from "./miniapps-catalog.constants";

const warn = logger.warn as jest.Mock;

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
  return new MiniappsCatalogClient(stub);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A body served as a stream, so no automatic Content-Length header is set. */
function streamResponse(text: string, status = 200): Response {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, { status });
}

beforeEach(() => {
  warn.mockClear();
});

afterEach(() => {
  delete (global as { fetch?: typeof fetch }).fetch;
  jest.useRealTimers();
});

describe("MiniappsCatalogClient.fetchShellFields", () => {
  it("never calls fetch for a non-first-party mini app", async () => {
    // Arrange
    global.fetch = jest.fn() as unknown as typeof fetch;
    const client = clientWith(detail({ id: "hssc", startUrl: "https://student.skku.edu/student/notice2.do" }));

    // Act & Assert
    await expect(client.fetchShellFields({ id: "hssc", startUrl: "https://student.skku.edu/student/notice2.do" })).resolves.toEqual({});
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns the manifest's parsed shell fields on a successful fetch", async () => {
    // Arrange
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ shell: { bar: "none", background: "#abcdef" } })) as unknown as typeof fetch;
    const client = clientWith(detail());

    // Act & Assert
    await expect(client.fetchShellFields(detail())).resolves.toEqual({
      bar: "none",
      background: "#ABCDEF",
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://mukja.mini.skkuverse.com/skkuverse.json",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("returns {} and warns when the origin never answers (no cached value to fall back on)", async () => {
    // Arrange
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    const client = clientWith(detail());

    // Act & Assert
    await expect(client.fetchShellFields(detail())).resolves.toEqual({});
    expect(warn).toHaveBeenCalled();
  });

  it("returns {} on a non-2xx status", async () => {
    // Arrange
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ shell: { bar: "top" } }, 500)) as unknown as typeof fetch;
    const client = clientWith(detail());

    // Act & Assert
    await expect(client.fetchShellFields(detail())).resolves.toEqual({});
  });

  it("returns {} on a redirect", async () => {
    // Arrange
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.example/" } })) as unknown as typeof fetch;
    const client = clientWith(detail());

    // Act & Assert
    await expect(client.fetchShellFields(detail())).resolves.toEqual({});
  });

  it("returns {} on unparsable JSON", async () => {
    // Arrange
    global.fetch = jest.fn().mockResolvedValue(new Response("not json", { status: 200 })) as unknown as typeof fetch;
    const client = clientWith(detail());

    // Act & Assert
    await expect(client.fetchShellFields(detail())).resolves.toEqual({});
  });

  it("returns {} when Content-Length announces a body over the cap", async () => {
    // Arrange
    const oversized = {
      ok: true,
      status: 200,
      type: "basic",
      headers: { get: (name: string) => (name === "content-length" ? String(MAX_MANIFEST_BYTES + 1) : null) },
      body: undefined,
      text: async () => JSON.stringify({ shell: { bar: "top" } }),
    };
    global.fetch = jest.fn().mockResolvedValue(oversized) as unknown as typeof fetch;
    const client = clientWith(detail());

    // Act & Assert
    await expect(client.fetchShellFields(detail())).resolves.toEqual({});
  });

  it("returns {} when the actual body exceeds the cap, even with no Content-Length header", async () => {
    // Arrange
    const big = JSON.stringify({ shell: { bar: "top" } }).padEnd(MAX_MANIFEST_BYTES + 1, " ");
    global.fetch = jest.fn().mockResolvedValue(streamResponse(big)) as unknown as typeof fetch;
    const client = clientWith(detail());

    // Act & Assert
    await expect(client.fetchShellFields(detail())).resolves.toEqual({});
  });

  it("aborts and returns {} once the fetch timeout elapses", async () => {
    // Arrange
    jest.useFakeTimers();
    global.fetch = jest.fn().mockImplementation(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    ) as unknown as typeof fetch;
    const client = clientWith(detail());

    const pending = client.fetchShellFields(detail());
    await jest.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);

    // Act & Assert
    await expect(pending).resolves.toEqual({});
  });

  it("caches a successful fetch for the TTL: a second call within it does not refetch", async () => {
    // Arrange
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ shell: { bar: "top" } }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = clientWith(detail());

    await client.fetchShellFields(detail());
    await client.fetchShellFields(detail());

    // Act & Assert
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stale-while-revalidate: past the TTL, still serves the last good value at once while refreshing behind it", async () => {
    // Arrange
    jest.useFakeTimers({ now: 1_000_000 });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ shell: { bar: "top" } }))
      .mockRejectedValue(new Error("down after that"));
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = clientWith(detail());

    // Act & Assert
    await expect(client.fetchShellFields(detail())).resolves.toEqual({ bar: "top" });

    jest.setSystemTime(1_000_000 + CACHE_TTL_MS + 1);
    // Answered immediately from the stale value, not blocked on the failing reload.
    await expect(client.fetchShellFields(detail())).resolves.toEqual({ bar: "top" });
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The failed background reload did not evict the last good value.
    await expect(client.fetchShellFields(detail())).resolves.toEqual({ bar: "top" });
  });

  it("keeps serving the last good value across many repeated failures", async () => {
    // Act & Assert
    jest.useFakeTimers({ now: 1_000_000 });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ shell: { bar: "top", background: "#123456" } }))
      .mockRejectedValue(new Error("down"));
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = clientWith(detail());

    await client.fetchShellFields(detail());
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
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ shell: { bar: "top" } }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = clientWith(
      detail({ id: "mukja", startUrl: "https://mukja.mini.skkuverse.com/" }),
      detail({ id: "playlist", startUrl: "https://playlist.mini.skkuverse.com/" }),
      detail({ id: "hssc", startUrl: "https://student.skku.edu/student/notice2.do" }),
    );

    // Act & Assert
    expect(() => client.onModuleInit()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://mukja.mini.skkuverse.com/skkuverse.json",
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://playlist.mini.skkuverse.com/skkuverse.json",
      expect.anything(),
    );
  });

  it("one mini app being down does not stop another's prefetch, and warns rather than throwing", async () => {
    // Arrange
    const fetchMock = jest.fn().mockImplementation((url: string) =>
      url.startsWith("https://mukja")
        ? Promise.reject(new Error("down"))
        : Promise.resolve(jsonResponse({ shell: { bar: "top" } })),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
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
  });
});
