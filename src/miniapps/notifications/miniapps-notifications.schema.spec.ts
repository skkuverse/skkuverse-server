/**
 * The send's Idempotency-Key header: a key is required, and is
 * 1-128 characters of A-Z, a-z, 0-9, `_` and `-`, refused with the message
 * the 400 shows at one below, at and one above each bound.
 */
import { idempotencyKeyHeader, pushMapTarget } from "./miniapps-notifications.schema";

const MESSAGE = "Idempotency-Key must be 1-128 characters of A-Z, a-z, 0-9, _ and -";

describe("idempotencyKeyHeader", () => {
  it("refuses an absent header", () => {
    // Act & Assert
    expect(idempotencyKeyHeader.safeParse(undefined).success).toBe(false);
  });

  it.each(["k", "k".repeat(127), "k".repeat(128), "Retry_2026-10-22", "0123456789"])("accepts %j as given", (key) => {
    // Act & Assert
    expect(idempotencyKeyHeader.parse(key)).toBe(key);
  });

  it.each(["", "k".repeat(129), "retry 1", " retry", "retry.1", "retry/1", "schlüssel", "retry\t1"])("refuses %j", (key) => {
    // Act
    const result = idempotencyKeyHeader.safeParse(key);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(MESSAGE);
  });
});

/**
 * A push's map target, the optional `chipId` and `placeId` keys a draft may carry so a current app opens
 * the map with that chip or place (skkuverse-app ADR 0022, decision 7). Absent or null is no key. A chip id
 * is 1-64 characters of a-z, 0-9, `_` and `-`, starting with a letter or digit; a place id is the app's
 * `[<kind>:]<id>` grammar with the kinds `skku_building`, `event`, `bus_stop` and `subway_station`, the id
 * 1-128 characters of a-z, 0-9 and `-`. Anything else is refused with the message the 400 shows, at one
 * below, at and one above each bound.
 */
describe("pushMapTarget", () => {
  const CHIP_MESSAGE = "chipId must be 1-64 characters of a-z, 0-9, _ and -, starting with a letter or digit";
  const PLACE_MESSAGE =
    "placeId must be [<kind>:]<id>, kind one of skku_building, event, bus_stop, subway_station and id 1-128 characters of a-z, 0-9 and -";

  it("reads a draft with neither key, or both null, as no map target", () => {
    // Act & Assert
    expect(pushMapTarget.parse({ title_ko: "t" })).toEqual({});
    expect(pushMapTarget.parse({ chipId: null, placeId: null })).toEqual({ chipId: null, placeId: null });
  });

  it.each(["eskara-2026_all", "building_map", "day1", "a", "a".repeat(63), "a".repeat(64)])("accepts the chip id %j", (chipId) => {
    // Act & Assert
    expect(pushMapTarget.parse({ chipId })).toEqual({ chipId });
  });

  it.each<unknown>(["", "a".repeat(65), "_all", "-all", "Day1", "day 1", " day1", "day1\n", "day/1", 7])("refuses the chip id %j", (chipId) => {
    // Act
    const result = pushMapTarget.safeParse({ chipId });

    // Assert
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([CHIP_MESSAGE]);
  });

  it.each([
    "eskara-2026-wristband-guest",
    "skku_building:31",
    "event:eskara-2026-booth-a1",
    "bus_stop:hssc-600th",
    "subway_station:hyehwa",
    "a",
    "a".repeat(128),
    `bus_stop:${"a".repeat(128)}`,
  ])("accepts the place id %j", (placeId) => {
    // Act & Assert
    expect(pushMapTarget.parse({ placeId })).toEqual({ placeId });
  });

  it.each<unknown>([
    "",
    "a".repeat(129),
    "taxi_stand:12",
    "bus_stop:",
    ":hyehwa",
    "subway_station:Hyehwa",
    "bus_stop:hssc_600th",
    "subway_station:hyehwa\n",
    " bus_stop:hssc-600th",
    "..%2Fetc",
    "bus_stop:subway_station:hyehwa",
    12,
  ])("refuses the place id %j", (placeId) => {
    // Act
    const result = pushMapTarget.safeParse({ placeId });

    // Assert
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([PLACE_MESSAGE]);
  });
});
