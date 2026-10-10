const find = jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) }));

jest.mock("../../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: jest.requireActual("../../infra/db").HOT_READ_MAX_TIME_MS,
  getClient: () => ({ db: () => ({ collection: () => ({ find }) }) }),
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
