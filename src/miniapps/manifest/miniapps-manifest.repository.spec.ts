/**
 * MiniappsManifestRepository's driver call: a manifest is stored as one
 * document of `miniapp_manifests` in the miniapps database, keyed by its
 * origin, upserted with `$set` of its shell fields and when it was fetched, so
 * a poll replaces the last one and a first poll inserts it. The api reads the
 * stored shells of the origins it asks for in one bounded `find`, projected to
 * the shell. This pins the write and the read FakeMiniappsManifestRepository
 * follows.
 */
const updateOne = jest.fn().mockResolvedValue({});
const toArray = jest.fn();
const find = jest.fn(() => ({ toArray }));
const mongoCollection = jest.fn(() => ({ updateOne, find }));

jest.mock("../../infra/mongo", () => ({
  ...jest.requireActual("../../infra/mongo"),
  mongoCollection: (...args: unknown[]) => mongoCollection(...(args as [])),
}));

import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { MiniappsManifestRepository } from "./miniapps-manifest.repository";

const FETCHED_AT = new Date("2026-10-20T01:00:00Z");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("MiniappsManifestRepository.upsertManifest", () => {
  it("upserts the origin's shell fields and fetch time in the miniapps database's miniapp_manifests", async () => {
    // Act
    await new MiniappsManifestRepository().upsertManifest("https://mukja.mini.skkuverse.com", { bar: "top", background: "#F2F4F6" }, FETCHED_AT);

    // Assert
    expect(mongoCollection).toHaveBeenCalledWith(config.miniapps.dbName, "miniapp_manifests");
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "https://mukja.mini.skkuverse.com" },
      { $set: { shell: { bar: "top", background: "#F2F4F6" }, fetchedAt: FETCHED_AT } },
      { upsert: true },
    );
  });

  it("stores an empty shell as {}", async () => {
    // Act
    await new MiniappsManifestRepository().upsertManifest("https://inja.mini.skkuverse.com", {}, FETCHED_AT);

    // Assert
    expect(updateOne).toHaveBeenCalledWith({ _id: "https://inja.mini.skkuverse.com" }, { $set: { shell: {}, fetchedAt: FETCHED_AT } }, { upsert: true });
  });
});

describe("MiniappsManifestRepository.listManifests", () => {
  it("reads the given origins' stored shells from miniapp_manifests in one bounded find, projected to the shell", async () => {
    // Arrange
    const stored = [{ _id: "https://mukja.mini.skkuverse.com", shell: { bar: "top" } }];
    toArray.mockResolvedValue(stored);
    const origins = ["https://mukja.mini.skkuverse.com", "https://inja.mini.skkuverse.com"];

    // Act
    const manifests = await new MiniappsManifestRepository().listManifests(origins);

    // Assert
    expect(manifests).toEqual(stored);
    expect(mongoCollection).toHaveBeenCalledWith(config.miniapps.dbName, "miniapp_manifests");
    expect(find).toHaveBeenCalledWith(
      { _id: { $in: ["https://mukja.mini.skkuverse.com", "https://inja.mini.skkuverse.com"] } },
      { projection: { shell: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
    );
  });
});
