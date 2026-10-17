/**
 * Fields a wire keeps only for installed builds are published as deprecated,
 * so a client generated from contracts/produced/ learns which field to move
 * off: the realtime group's `stationEtas[].eta`, superseded by
 * `arrivals[].message` (improve-jongro-realtime, the arrivals OTA). The flag
 * survives the draft-07 export the artifacts use, and the committed artifact
 * carries it.
 */
import fs from "fs";
import path from "path";
import { z } from "zod";
import { realtimeGroup } from "../../src/bus/realtime/group/bus-realtime-group.wire";

const ARTIFACT = path.join(__dirname, "../../contracts/produced/bus-realtime-group.realtimeGroup.schema.json");

type JsonSchema = { properties?: Record<string, JsonSchema>; items?: JsonSchema; deprecated?: boolean; description?: string };
const etaOf = (schema: JsonSchema): JsonSchema | undefined => schema.properties?.stationEtas?.items?.properties?.eta;

describe("realtimeGroup stationEtas[].eta", () => {
  it("is deprecated, pointing at arrivals[].message, in the draft-07 export", () => {
    // Act
    const eta = etaOf(z.toJSONSchema(realtimeGroup, { io: "input", target: "draft-7" }) as JsonSchema);

    // Assert
    expect(eta).toMatchObject({ type: "string", deprecated: true });
    expect(eta?.description).toContain("arrivals[].message");
  });

  it("is deprecated in the committed artifact", () => {
    // Act
    const eta = etaOf(JSON.parse(fs.readFileSync(ARTIFACT, "utf8")) as JsonSchema);

    // Assert
    expect(eta?.deprecated).toBe(true);
  });

  it("stays required, so installed builds keep receiving it", () => {
    // Act
    const items = (z.toJSONSchema(realtimeGroup, { io: "input", target: "draft-7" }) as { properties: { stationEtas: { items: { required: string[] } } } })
      .properties.stationEtas.items;

    // Assert
    expect(items.required).toContain("eta");
  });
});
