/**
 * stopCatalogFile carries the catalog checks through a parse: the committed
 * catalog passes as it is, and a broken one fails with each check's own words.
 */
import { SERVICE_CONFIG } from "../bus.constants";
import { stopCatalogFile } from "./bus-stops.schema";
import { etaOptIns } from "./bus-stops.rules";

const raw = require("../schedule/schedule-stops.json");
const schema = stopCatalogFile({ knownServiceIds: new Set(Object.keys(SERVICE_CONFIG)), optIns: etaOptIns(SERVICE_CONFIG) });

describe("stopCatalogFile", () => {
  it("passes the committed catalog through as it is", () => {
    // Act & Assert
    expect(schema.parse(raw)).toBe(raw);
  });

  it("fails a broken catalog with the check's words", () => {
    // Act
    const result = schema.safeParse([]);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.message)).toEqual(["schedule-stops.json must be { stops: [], sequences: {} }"]);
  });
});
