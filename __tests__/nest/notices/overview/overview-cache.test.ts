/**
 * OverviewCache: TTL, eviction, and the entry replacement that keeps a later
 * request from being answered with an earlier request's input.
 */
import { OverviewCache } from "../../../../src/notices/overview/overview.cache";

afterEach(() => jest.useRealTimers());

describe("OverviewCache", () => {
  it("replaces an expired entry with the new caller's loader", async () => {
    jest.useFakeTimers({ now: new Date("2026-10-06T00:00:00Z") });
    const cache = new OverviewCache<string>(1_000, 10);

    await cache.get("k", async () => "first");
    jest.setSystemTime(new Date("2026-10-06T00:00:02Z"));
    const later = await cache.get("k", async () => "second");

    expect(later).toEqual({ value: "second", cached: false });
  });

  it("evicts the oldest key when full", async () => {
    const cache = new OverviewCache<string>(60_000, 2);
    const load = jest.fn(async () => "v");

    await cache.get("a", load);
    await cache.get("b", load);
    await cache.get("c", load);
    await cache.get("a", load);

    expect(cache.size).toBe(2);
    expect(load).toHaveBeenCalledTimes(4);
  });
});

describe("OverviewCache with CACHE=off", () => {
  // Every other createCachedLoader passes through under CACHE=off; this one is
  // exempt, because each miss is an LLM call.
  const config = require("../../../../src/infra/config");
  afterEach(() => {
    config.cache.enabled = true;
  });

  it("still answers a repeated key from the cache", async () => {
    config.cache.enabled = false;
    const cache = new OverviewCache<string>(60_000, 10);
    const load = jest.fn(async () => "v");

    await cache.get("k", load);
    const second = await cache.get("k", load);

    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ value: "v", cached: true });
  });
});
