/**
 * busStopsDataset is the shape of the `bus-stops` dataset (unify-bus-stops
 * design D1, D3 and D4): a push is refused on it and the read parses with it.
 * Revision 1 (the fixture) passes as it is; a copy that is not the catalog's
 * structure fails at its path, a stop id outside the stop id grammar or under
 * the TOPIS prefix fails, the HSSC line holds exactly HSSC_POSITION_COUNT
 * positions, and every alias and overlay key is a five-digit ARS number. The
 * catalog's own checks run at push (toBusStopsIssues, bus-stops.rules.spec.ts).
 * storedBusStops, the stored document as the repository reads it, needs its
 * revision and data.
 *
 * Ported from this file's stopCatalogFile cases, which went with the
 * committed stop catalog in unify-bus-stops task 4.3 (design D15): "passes the
 * committed catalog through as it is" → "passes revision 1 as it is"; "fails a
 * broken catalog with the check's words" → "fails a copy that is not the
 * catalog's structure" here and "rejects a malformed root" in
 * bus-stops.rules.spec.ts; the subway station cases → "Unknown station stops
 * the boot" and "reports a catalog issue beside a station issue" of
 * toBusStopsIssues.
 */
import { busStopsFixture } from "../../../__tests__/helpers/bus/bus-stops";
import { HSSC_POSITION_COUNT } from "../bus.constants";
import { busStopsDataset, storedBusStops } from "./bus-stops.schema";

// The fixture as untyped JSON, so a test can break its shape.
const fixture = (): Record<string, any> => busStopsFixture();

function messagesOf(pushed: unknown): string[] {
  const result = busStopsDataset.safeParse(pushed);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

const withStop = (index: number, patch: Record<string, unknown>): Record<string, any> => {
  const data = fixture();
  data.stops[index] = { ...data.stops[index], ...patch };
  return data;
};

describe("busStopsDataset", () => {
  it("passes revision 1 as it is, in its order", () => {
    // Act
    const parsed = busStopsDataset.parse(fixture());

    // Assert
    expect(parsed).toEqual(fixture());
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(fixture()));
  });

  it.each(["stops", "sequences", "hssc"])("fails a copy without %s, naming it", (field) => {
    // Arrange
    const data = fixture();
    delete data[field];

    // Act & Assert
    expect(messagesOf(data)).toEqual([expect.stringMatching(new RegExp(`^${field}: `))]);
  });

  it("passes a copy without the optional overlay, and one with an empty overlay", () => {
    // Act & Assert
    expect(messagesOf({ ...fixture(), topis: {} })).toEqual([]);
    expect(messagesOf(fixture())).toEqual([]);
  });

  it.each([
    ["is not an object", []],
    ["has stops that are not a list", { ...busStopsFixture(), stops: {} }],
    ["has sequences that are not keyed by service", { ...busStopsFixture(), sequences: [] }],
    ["has a service's sequences that are not keyed by route type", { ...busStopsFixture(), sequences: { "campus-inja": [] } }],
    ["has a route type whose stops are not a list", { ...busStopsFixture(), sequences: { "campus-inja": { regular: {} } } }],
    ["has a stop that is not an object", { ...busStopsFixture(), stops: ["jeongja-exit3"] }],
  ])("fails a copy that is not the catalog's structure: one that %s", (_case, broken) => {
    // Act & Assert
    expect(messagesOf(broken)).not.toEqual([]);
  });

  it("fails a stop without an id, naming its path", () => {
    // Arrange
    const data = fixture();
    delete data.stops[0].id;

    // Act & Assert
    expect(messagesOf(data)).toEqual([expect.stringMatching(/^stops\.0\.id: /)]);
  });

  it.each([
    ["an empty id", ""],
    ["an upper-case letter", "Jeongja-exit3"],
    ["an underscore", "jeongja_exit3"],
    ["a doubled hyphen", "jeongja--exit3"],
    ["a trailing hyphen", "jeongja-exit3-"],
  ])("fails a stop id with %s, naming its path", (_case, id) => {
    // Act & Assert
    expect(messagesOf(withStop(0, { id }))).toEqual([expect.stringMatching(/^stops\.0\.id: /)]);
  });

  it("Reserved prefix: fails a local stop named seoul-01618, naming that stop's path", () => {
    // Act & Assert
    expect(messagesOf(withStop(13, { id: "seoul-01618" }))).toEqual(['stops.13.id: must not start with "seoul-", which a TOPIS pole\'s stop id takes']);
  });

  it("passes a stop that aliases a five-digit ARS number", () => {
    // Act & Assert
    expect(messagesOf(withStop(13, { arsIds: ["01618"] }))).toEqual([]);
  });

  it.each([["1618"], ["016180"], ["0161a"], [""]])("fails an alias %j that is not a five-digit ARS number, naming its path", (arsId) => {
    // Act & Assert
    expect(messagesOf(withStop(13, { arsIds: [arsId] }))).toEqual(["stops.13.arsIds.0: must be a five-digit ARS number"]);
  });

  it("fails an overlay keyed by something other than a five-digit ARS number, naming the key", () => {
    // Act & Assert
    expect(messagesOf({ ...fixture(), topis: { "1592": { subwayStationId: "hyehwa" } } })).toEqual([expect.stringMatching(/^topis\.1592: /)]);
  });

  it("passes an overlay entry with English and Chinese names and a subway station", () => {
    // Act & Assert
    expect(messagesOf({ ...fixture(), topis: { "01592": { name: { en: "Hyehwa Station Exit 1", zh: "惠化站1号出口" }, subwayStationId: "hyehwa" } } })).toEqual([]);
  });

  it("fails an overlay entry with a field the overlay does not hold, naming it", () => {
    // Act & Assert
    expect(messagesOf({ ...fixture(), topis: { "01592": { stationName: "혜화역1번출구" } } })).toEqual(['topis.01592: Unrecognized key: "stationName"']);
  });

  it.each([HSSC_POSITION_COUNT - 1, HSSC_POSITION_COUNT + 1])("Ten positions: fails an HSSC line of %i positions, naming the line and the count", (count) => {
    // Arrange
    const data = fixture();
    const stations = data.hssc.stations;
    data.hssc.stations = Array.from({ length: count }, (_, index) => stations[Math.min(index, stations.length - 1)]);

    // Act & Assert
    expect(messagesOf(data)).toEqual([`hssc.stations: must list exactly ${HSSC_POSITION_COUNT} positions, the count the HSSC realtime view fills`]);
  });

  it.each(["stopId", "name", "subtitle", "isFirstStation", "isLastStation", "isRotationStation", "transferLines"])("fails an HSSC position without %s, naming it", (field) => {
    // Arrange
    const data = fixture();
    delete data.hssc.stations[2][field];

    // Act & Assert
    expect(messagesOf(data)).toEqual([expect.stringMatching(new RegExp(`^hssc\\.stations\\.2\\.${field}: `))]);
  });

  it("fails an HSSC position with a field the line does not hold, naming it", () => {
    // Arrange
    const data = fixture();
    data.hssc.stations[0].busType = "BusType.hsscBus";

    // Act & Assert
    expect(messagesOf(data)).toEqual(['hssc.stations.0: Unrecognized key: "busType"']);
  });

  it("fails a root field the dataset does not hold, naming it", () => {
    // Act & Assert
    expect(messagesOf({ ...fixture(), places: [] })).toEqual([': Unrecognized key: "places"']);
  });
});

describe("storedBusStops", () => {
  it("passes the stored document of revision 1", () => {
    // Act
    const parsed = storedBusStops.safeParse({ revision: 1, data: fixture() });

    // Assert
    expect(parsed.success).toBe(true);
  });

  it.each(["revision", "data"])("fails a stored document without %s", (field) => {
    // Arrange
    const doc: Record<string, unknown> = { revision: 1, data: fixture() };
    delete doc[field];

    // Act
    const parsed = storedBusStops.safeParse(doc);

    // Assert
    expect(parsed.success).toBe(false);
  });
});
