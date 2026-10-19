/**
 * MiniappsManifestRepository's driver call: a manifest is stored as one
 * document of `miniapp_manifests` in the miniapps database, keyed by its
 * origin, upserted with `$set` of its shell fields and when it was fetched, so
 * a poll replaces the last one and a first poll inserts it. This pins the
 * write FakeMiniappsManifestRepository follows.
 */
const updateOne = jest.fn().mockResolvedValue({});
const mongoCollection = jest.fn(() => ({ updateOne }));

jest.mock("../../infra/mongo", () => ({
  ...jest.requireActual("../../infra/mongo"),
  mongoCollection: (...args: unknown[]) => mongoCollection(...(args as [])),
}));

import config from "../../infra/config";
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
