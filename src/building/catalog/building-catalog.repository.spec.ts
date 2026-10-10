const find = jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) }));
const createIndex = jest.fn((..._args: unknown[]) => Promise.resolve("ok"));

jest.mock("../../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: jest.requireActual("../../infra/db").HOT_READ_MAX_TIME_MS,
  getClient: () => ({
    db: () => ({
      collection: (name: string) => ({
        find,
        createIndex: (...args: unknown[]) => createIndex(name, ...args),
      }),
    }),
  }),
}));

import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import type { SkkuId } from "../building.types";
import { BuildingCatalogRepository } from "./building-catalog.repository";

describe("listConnectionsBySkkuId", () => {
  it("matches either end and reads only the two ends (connections are hand-authored)", async () => {
    await new BuildingCatalogRepository().listConnectionsBySkkuId(7 as SkkuId);
    expect(find.mock.calls[0]).toEqual([
      { $or: [{ "a.skkuId": 7 }, { "b.skkuId": 7 }] },
      { projection: { _id: 0, a: 1, b: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
    ]);
  });
});

describe("BuildingCatalogRepository.ensureIndexes", () => {
  it("indexes a building's spaces and a connection from either end", async () => {
    await new BuildingCatalogRepository().ensureIndexes();
    expect(createIndex.mock.calls).toEqual([
      ["spaces", { buildNo: 1 }],
      ["connections", { "a.skkuId": 1 }],
      ["connections", { "b.skkuId": 1 }],
    ]);
  });
});
