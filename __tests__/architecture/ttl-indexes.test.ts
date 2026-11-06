/**
 * A TTL index deletes documents on its own, so `expireAfterSeconds` appears in
 * `src/`, specs left out, only in the repositories listed here. A new TTL index
 * takes a reviewed entry in this list, naming the collection it expires.
 */
import { sourceFiles, readSource } from "../helpers/architecture/tree";

const TTL_REPOSITORIES: Readonly<Record<string, readonly string[]>> = {
  "src/bus/cache/bus-cache.repository.ts": ["bus_cache"],
  "src/bus/realtime/hssc/bus-realtime-hssc.repository.ts": ["hssc_feed_events"],
  "src/bus/eta/bus-eta.repository.ts": ["shuttle_eta"],
  "src/bus/eta/probe/bus-eta-probe.repository.ts": ["bus_lane_spans"],
  "src/perimeter/perimeter-counters.repository.ts": ["perimeter_counters"],
  "src/subway/history/subway-history.repository.ts": ["subway_events", "subway_predictions"],
};

/** The files whose text names `expireAfterSeconds` and are not in `allowed`. */
export function unlistedTtlFiles(files: ReadonlyArray<readonly [string, string]>, allowed: readonly string[]): string[] {
  return files.filter(([file, text]) => text.includes("expireAfterSeconds") && !allowed.includes(file)).map(([file]) => file);
}

describe("the TTL index rule applies as specified", () => {
  it("refuses a file outside the list that names expireAfterSeconds", () => {
    // Arrange
    const files = [
      ["src/notices/notices.repository.ts", "createIndex({ a: 1 }, { expireAfterSeconds: 60 })"],
      ["src/bus/cache/bus-cache.repository.ts", "createIndex({ a: 1 }, { expireAfterSeconds: 60 })"],
      ["src/map/map.repository.ts", "createIndex({ a: 1 })"],
    ] as const;

    // Act
    const found = unlistedTtlFiles(files, ["src/bus/cache/bus-cache.repository.ts"]);

    // Assert
    expect(found).toEqual(["src/notices/notices.repository.ts"]);
  });
});

describe("src/", () => {
  it("names expireAfterSeconds only in the listed repositories", () => {
    // Arrange
    const files = sourceFiles().map((file) => [file, readSource(file)] as const);

    // Act
    const found = unlistedTtlFiles(files, Object.keys(TTL_REPOSITORIES));

    // Assert
    expect(found).toEqual([]);
  });

  it("lists only repositories that still hold a TTL index", () => {
    // Arrange
    const sources = new Map(sourceFiles().map((file) => [file, readSource(file)]));

    // Act
    const stale = Object.keys(TTL_REPOSITORIES).filter((file) => !(sources.get(file) ?? "").includes("expireAfterSeconds"));

    // Assert
    expect(stale).toEqual([]);
  });
});
