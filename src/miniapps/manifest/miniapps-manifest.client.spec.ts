/**
 * MiniappsManifestClient: the fetch of a first-party mini app's own
 * `public/skkuverse.json`, over a stubbed global fetch, turned into the shell
 * fields it declares. What it guards: one GET of `<origin>/skkuverse.json`
 * that follows no redirect; the tolerant parse, which keeps the valid fields
 * and drops a bad value; and a rejection for anything untrustworthy, so the
 * poller keeps the last stored manifest: an unreachable origin, a non-2xx, a
 * redirect (raw or opaque), a body that is not JSON, a body over
 * MAX_MANIFEST_BYTES whether announced or read, and the FETCH_TIMEOUT_MS
 * abort.
 */
import { FETCH_TIMEOUT_MS, MAX_MANIFEST_BYTES } from "./miniapps-manifest.constants";
import { MiniappsManifestClient } from "./miniapps-manifest.client";

const ORIGIN = "https://mukja.mini.skkuverse.com";

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

const client = new MiniappsManifestClient();

afterEach(() => {
  delete (global as { fetch?: typeof fetch }).fetch;
  jest.useRealTimers();
});

describe("MiniappsManifestClient.fetchShellFields", () => {
  it("returns the manifest's parsed shell fields on a successful fetch", async () => {
    // Arrange
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ shell: { bar: "none", background: "#abcdef" } })) as unknown as typeof fetch;

    // Act & Assert
    await expect(client.fetchShellFields(ORIGIN)).resolves.toEqual({
      bar: "none",
      background: "#ABCDEF",
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://mukja.mini.skkuverse.com/skkuverse.json",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("keeps the valid fields and drops a bad value", async () => {
    // Arrange
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ shell: { bar: "middle", background: "#073e32" } })) as unknown as typeof fetch;

    // Act & Assert
    await expect(client.fetchShellFields(ORIGIN)).resolves.toEqual({ background: "#073E32" });
  });

  it("returns {} for a manifest with no shell", async () => {
    // Arrange
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ name: "mukja" })) as unknown as typeof fetch;

    // Act & Assert
    await expect(client.fetchShellFields(ORIGIN)).resolves.toEqual({});
  });

  it("rejects when the origin never answers", async () => {
    // Arrange
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    // Act & Assert
    await expect(client.fetchShellFields(ORIGIN)).rejects.toThrow("ECONNREFUSED");
  });

  it("rejects a non-2xx status", async () => {
    // Arrange
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ shell: { bar: "top" } }, 500)) as unknown as typeof fetch;

    // Act & Assert
    await expect(client.fetchShellFields(ORIGIN)).rejects.toThrow("manifest 500 from https://mukja.mini.skkuverse.com");
  });

  it("rejects a redirect", async () => {
    // Arrange
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.example/" } })) as unknown as typeof fetch;

    // Act & Assert
    await expect(client.fetchShellFields(ORIGIN)).rejects.toThrow("manifest redirected from https://mukja.mini.skkuverse.com");
  });

  it("rejects the opaque status-0 response a manual redirect answers with", async () => {
    // Arrange
    const opaque = { ok: false, status: 0, type: "opaqueredirect", headers: { get: () => null }, body: null };
    global.fetch = jest.fn().mockResolvedValue(opaque) as unknown as typeof fetch;

    // Act & Assert
    await expect(client.fetchShellFields(ORIGIN)).rejects.toThrow("manifest redirected from https://mukja.mini.skkuverse.com");
  });

  it("rejects unparsable JSON", async () => {
    // Arrange
    global.fetch = jest.fn().mockResolvedValue(new Response("not json", { status: 200 })) as unknown as typeof fetch;

    // Act & Assert
    await expect(client.fetchShellFields(ORIGIN)).rejects.toThrow(SyntaxError);
  });

  it("rejects when Content-Length announces a body over the cap", async () => {
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

    // Act & Assert
    await expect(client.fetchShellFields(ORIGIN)).rejects.toThrow(`manifest content-length exceeds ${MAX_MANIFEST_BYTES} bytes`);
  });

  it("rejects when the actual body exceeds the cap, even with no Content-Length header", async () => {
    // Arrange
    const big = JSON.stringify({ shell: { bar: "top" } }).padEnd(MAX_MANIFEST_BYTES + 1, " ");
    global.fetch = jest.fn().mockResolvedValue(streamResponse(big)) as unknown as typeof fetch;

    // Act & Assert
    await expect(client.fetchShellFields(ORIGIN)).rejects.toThrow(`manifest body exceeds ${MAX_MANIFEST_BYTES} bytes`);
  });

  it("reads a body of exactly the cap", async () => {
    // Arrange
    const full = JSON.stringify({ shell: { bar: "top" } }).padEnd(MAX_MANIFEST_BYTES, " ");
    global.fetch = jest.fn().mockResolvedValue(streamResponse(full)) as unknown as typeof fetch;

    // Act & Assert
    await expect(client.fetchShellFields(ORIGIN)).resolves.toEqual({ bar: "top" });
  });

  it("aborts and rejects once the fetch timeout elapses", async () => {
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
    const pending = client.fetchShellFields(ORIGIN);
    const outcome = expect(pending).rejects.toThrow("aborted");

    // Act
    await jest.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);

    // Assert
    await outcome;
    expect(FETCH_TIMEOUT_MS).toBe(3_000);
  });
});
