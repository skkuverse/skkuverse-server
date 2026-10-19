/**
 * MiniappsManifestService over the manifest client and repository fakes and a
 * fixed clock. What it guards: a refresh stores the origin's fetched shell
 * fields with the time it ran; a failed fetch rejects, so the poller reports
 * it, and writes nothing, so the last good manifest stays; an empty shell is
 * stored as `{}`.
 *
 * The api's side (move-miniapp-registry D9, spec miniapp-manifests): the shell
 * fields a detail merges are the stored ones of its startUrl's first-party
 * origin, read for all origins at once and cached a minute, so a manifest
 * change on an origin shows within the poll plus that minute. A third-party
 * startUrl reads nothing; a missing document, or no good read yet, merges as
 * no override (`{}`), the latter logged at most once per interval; a failed
 * reload keeps serving the last read. The cached loader reads `Date.now()`, so
 * the TTL is crossed with Jest's fake system time, which the clock follows.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { FakeMiniappsManifestClient } from "../../../__tests__/helpers/fakes/miniapps/miniapps-manifest.client.fake";
import { FakeMiniappsManifestRepository } from "../../../__tests__/helpers/fakes/miniapps/miniapps-manifest.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import logger from "../../infra/logger";
import { READ_FAILED_LOG_INTERVAL_MS } from "./miniapps-manifest.constants";
import type { MiniappsManifestClient } from "./miniapps-manifest.client";
import type { MiniappsManifestRepository } from "./miniapps-manifest.repository";
import { MiniappsManifestService } from "./miniapps-manifest.service";

const MUKJA = "https://mukja.mini.skkuverse.com";
const BOOTH_BOX = "https://booth-box.mini.skkuverse.com";
const EARLIER = new Date("2026-10-20T00:56:00Z");
const NOW = new Date("2026-10-20T01:00:00Z");

let client: FakeMiniappsManifestClient;
let repository: FakeMiniappsManifestRepository;
let service: MiniappsManifestService;

beforeEach(() => {
  client = new FakeMiniappsManifestClient();
  repository = new FakeMiniappsManifestRepository();
  service = new MiniappsManifestService(asReal<MiniappsManifestClient>(client), asReal<MiniappsManifestRepository>(repository), { now: () => NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("MiniappsManifestService.refresh", () => {
  it("stores the origin's fetched shell fields with the time it ran", async () => {
    // Arrange
    client.answers.set(MUKJA, { bar: "top", background: "#F2F4F6" });

    // Act
    await service.refresh(MUKJA);

    // Assert
    expect(client.calls).toEqual([MUKJA]);
    expect(repository.manifests.get(MUKJA)).toEqual({ _id: MUKJA, shell: { bar: "top", background: "#F2F4F6" }, fetchedAt: NOW });
    expect([...repository.manifests.keys()]).toEqual([MUKJA]);
  });

  it("rejects on a failed fetch and leaves the stored manifest unchanged", async () => {
    // Arrange
    const stored = { _id: MUKJA, shell: { bar: "top" as const }, fetchedAt: EARLIER };
    repository.manifests.set(MUKJA, stored);
    client.answers.set(MUKJA, new Error("manifest 503 from https://mukja.mini.skkuverse.com"));

    // Act & Assert
    await expect(service.refresh(MUKJA)).rejects.toThrow("manifest 503 from https://mukja.mini.skkuverse.com");
    expect(repository.manifests.get(MUKJA)).toEqual({ _id: MUKJA, shell: { bar: "top" }, fetchedAt: EARLIER });
  });

  it("stores an empty shell as {}", async () => {
    // Act
    await service.refresh(MUKJA);

    // Assert
    expect(repository.manifests.get(MUKJA)).toEqual({ _id: MUKJA, shell: {}, fetchedAt: NOW });
  });

  it("rejects when the store fails", async () => {
    // Arrange
    repository.failWith = new Error("write failed");

    // Act & Assert
    await expect(service.refresh(MUKJA)).rejects.toThrow("write failed");
  });
});

describe("MiniappsManifestService.shellFieldsFor", () => {
  const warn = logger.warn as jest.Mock;
  const readFailedCalls = () => warn.mock.calls.filter(([fields]) => fields?.event === "miniapps.manifest.read_failed").map(([fields]) => fields);
  const store = (origin: string, shell: Record<string, unknown>) =>
    repository.manifests.set(origin, { _id: origin, shell: shell as never, fetchedAt: EARLIER });

  beforeEach(() => {
    warn.mockClear();
    jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });
    // The log throttle reads the injected clock, so here it follows the fake system time the cached loader reads.
    service = new MiniappsManifestService(asReal<MiniappsManifestClient>(client), asReal<MiniappsManifestRepository>(repository), {
      now: () => new Date(Date.now()),
    });
  });

  it("answers the stored shell fields of the startUrl's first-party origin", async () => {
    // Arrange
    store(MUKJA, { bar: "top", background: "#F2F4F6" });
    store(BOOTH_BOX, { bar: "top", header: "overlay", statusBar: "light", background: "#073E32" });

    // Act
    const shell = await service.shellFieldsFor("https://booth-box.mini.skkuverse.com/");

    // Assert
    expect(shell).toEqual({ bar: "top", header: "overlay", statusBar: "light", background: "#073E32" });
    expect(client.calls).toEqual([]);
  });

  it("answers {} for a third-party startUrl, with no read", async () => {
    // Arrange
    store(MUKJA, { bar: "top" });

    // Act
    const shell = await service.shellFieldsFor("https://student.skku.edu/student/notice2.do");

    // Assert
    expect(shell).toEqual({});
    expect(repository.reads).toBe(0);
  });

  it("answers {} for a first-party origin with no stored document", async () => {
    // Arrange
    store(MUKJA, { bar: "top" });

    // Act & Assert
    await expect(service.shellFieldsFor("https://inja.mini.skkuverse.com/")).resolves.toEqual({});
  });

  it("drops a bad stored value and keeps the valid ones", async () => {
    // Arrange
    store(BOOTH_BOX, { bar: "middle", background: "#073e32" });

    // Act & Assert
    await expect(service.shellFieldsFor("https://booth-box.mini.skkuverse.com/")).resolves.toEqual({ background: "#073E32" });
  });

  it("reads every origin once a minute, and serves a stored change after 60 s", async () => {
    // Arrange
    store(MUKJA, { bar: "top" });
    await service.shellFieldsFor("https://mukja.mini.skkuverse.com/");
    store(MUKJA, { bar: "none" });
    jest.advanceTimersByTime(59_999);
    const withinTheMinute = await service.shellFieldsFor("https://mukja.mini.skkuverse.com/");
    await service.shellFieldsFor("https://booth-box.mini.skkuverse.com/");

    // Act
    jest.advanceTimersByTime(1);
    const afterTheMinute = await service.shellFieldsFor("https://mukja.mini.skkuverse.com/");

    // Assert
    expect(withinTheMinute).toEqual({ bar: "top" });
    expect(afterTheMinute).toEqual({ bar: "none" });
    expect(repository.reads).toBe(2);
  });

  it("keeps serving the last read when a reload fails, a day later too", async () => {
    // Arrange
    store(MUKJA, { bar: "top" });
    await service.shellFieldsFor("https://mukja.mini.skkuverse.com/");
    repository.failWith = new Error("connection refused");
    jest.advanceTimersByTime(60_000);
    const afterAMinute = await service.shellFieldsFor("https://mukja.mini.skkuverse.com/");

    // Act
    jest.advanceTimersByTime(24 * 60 * 60_000 - 60_000);
    const afterADay = await service.shellFieldsFor("https://mukja.mini.skkuverse.com/");

    // Assert
    expect(afterAMinute).toEqual({ bar: "top" });
    expect(afterADay).toEqual({ bar: "top" });
    expect(readFailedCalls()).toEqual([]);
  });

  it("answers {} when no read has succeeded, and logs read_failed once per interval", async () => {
    // Arrange
    store(MUKJA, { bar: "top" });
    const failure = new Error("connection refused");
    repository.failWith = failure;
    const first = await service.shellFieldsFor("https://mukja.mini.skkuverse.com/");
    await service.shellFieldsFor("https://mukja.mini.skkuverse.com/");
    const loggedWithinTheInterval = readFailedCalls().length;

    // Act
    jest.advanceTimersByTime(READ_FAILED_LOG_INTERVAL_MS);
    const afterTheInterval = await service.shellFieldsFor("https://mukja.mini.skkuverse.com/");

    // Assert
    expect(first).toEqual({});
    expect(afterTheInterval).toEqual({});
    expect(loggedWithinTheInterval).toBe(1);
    expect(readFailedCalls()).toEqual([
      expect.objectContaining({ err: failure, suppressed: 0 }),
      expect.objectContaining({ err: failure, suppressed: 1 }),
    ]);
  });
});
