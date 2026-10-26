/**
 * The stops a subway ride passes (ADR 0022, D5), from the boarded train's own timetable row: toRideStops lists the
 * platforms that row calls at between the board and alight platforms, in travel order and never either end, so an
 * express lists only those it stops at and a train running the other way lists them reversed; it lists none for a row
 * that does not reach the alight platform after the board one, and none at all when one stop has no place.
 * toRideStopPlace places one platform: a station the code serves keeps its slug, its name in the request language, its
 * stored coords and its tap action; a neighbor of the topology its station id, its own name in the request language
 * and its coords, with no action; a platform neither places, and a neighbor missing its name or coords, is no place.
 */
import { subwayRegistryFixture } from "../../../../__tests__/helpers/subway/topology";
import type { Place } from "../../../shared/place.wire";
import type { ScheduledTrain } from "../subway-timetable.types";
import { toRideStopPlace, toRideStops } from "./subway-timetable-departures.mapper";

const [GEUMJEONG, GUNPO, DANGJEONG, UIWANG, SKKU] = ["KR-1-P149", "KR-1-P150", "KR-1-P151", "KR-1-P152", "KR-1-P153"];

const rowOf = (direction: "up" | "down", platformIds: readonly string[], express = false): ScheduledTrain => ({
  ...{ trainNo: "0001", direction, destination: "천안", express },
  stops: platformIds.map((platformId) => ({ platformId, arrivalAt: null, departureAt: null })),
});

const placeOf = (platformId: string): Place | null =>
  platformId === "KR-1-P999" ? null : { kind: "subway_station", id: platformId.toLowerCase(), name: platformId, coords: { lat: 37.3, lng: 126.9 }, platformId, action: null };

describe("toRideStops", () => {
  it.each([
    ["Local: every platform its row calls at between the two", rowOf("down", [GEUMJEONG, GUNPO, DANGJEONG, UIWANG, SKKU]), [GEUMJEONG, SKKU], [GUNPO, DANGJEONG, UIWANG]],
    ["Express: only the platforms its own row calls at", rowOf("down", [GEUMJEONG, UIWANG, SKKU], true), [GEUMJEONG, SKKU], [UIWANG]],
    ["an express calling nowhere between", rowOf("down", [GEUMJEONG, SKKU], true), [GEUMJEONG, SKKU], []],
    ["Reverse: a train the other way, nearest the board first", rowOf("up", [SKKU, UIWANG, DANGJEONG, GUNPO, GEUMJEONG]), [SKKU, GEUMJEONG], [UIWANG, DANGJEONG, GUNPO]],
    ["a row that starts before the board platform and runs past the alight one", rowOf("down", ["KR-1-P148", GEUMJEONG, GUNPO, SKKU, "KR-1-P154"]), [GEUMJEONG, SKKU], [GUNPO]],
  ] as const)("%s", (_case, train, ride, expected) => {
    // Act
    const stops = toRideStops(train, ride, placeOf);

    // Assert
    expect(stops?.map((place) => place.platformId)).toEqual(expected);
  });

  it.each([
    ["a row that ends before the alight platform", rowOf("down", [GEUMJEONG, GUNPO]), [GEUMJEONG, SKKU]],
    ["a row that reaches the alight platform before the board one", rowOf("up", [SKKU, UIWANG, GEUMJEONG]), [GEUMJEONG, SKKU]],
    ["a row without the board platform", rowOf("down", [GUNPO, SKKU]), [GEUMJEONG, SKKU]],
    ["one stop with no place, never a partial list", rowOf("down", [GEUMJEONG, GUNPO, "KR-1-P999", SKKU]), [GEUMJEONG, SKKU]],
  ] as const)("lists none for %s", (_case, train, ride) => {
    // Act & Assert
    expect(toRideStops(train, ride, placeOf)).toBeNull();
  });
});

describe("toRideStopPlace", () => {
  const registry = subwayRegistryFixture();
  const coordsOf = (stationId: string) => (stationId === "sadang" ? { lat: 37.476746, lng: 126.981597 } : null);

  it("places a served station by its slug, its name, its stored coords and its tap action, at the platform passed", () => {
    // Act
    const place = toRideStopPlace("S1-4-433", { registry, coordsOf, lang: "en" });

    // Assert
    expect(place).toEqual({
      ...{ kind: "subway_station", id: "sadang", name: "Sadang", coords: { lat: 37.476746, lng: 126.981597 }, platformId: "S1-4-433" },
      action: { actionType: "route", actionValue: "/map?place=subway_station:sadang" },
    });
  });

  it.each([
    ["a named neighbor by its own name", "S1-4-432", "en", { id: "chongshin-univ", name: "Chongshin Univ. (Isu)", coords: { lat: 37.486263, lng: 126.981989 } }],
    ["a neighbor whose name differs from its Seoul name, by its own name", "S1-4-426", "en", { id: "seoul-station", name: "Seoul Station", coords: { lat: 37.55281, lng: 126.972556 } }],
    ["a neighbor in Korean", "S1-4-421", "ko", { id: "dongdaemun", name: "동대문", coords: { lat: 37.57093, lng: 127.009287 } }],
  ] as const)("places %s, its station id and coords, with no action", (_case, platformId, lang, expected) => {
    // Act & Assert
    expect(toRideStopPlace(platformId, { registry, coordsOf, lang })).toEqual({ kind: "subway_station", ...expected, platformId, action: null });
  });

  it.each([
    ["a served station with no stored coords", "S1-4-420"],
    ["a neighbor with no station id and coords", "S1-2-225"],
    ["a platform neither served nor a neighbor", "S1-4-499"],
  ])("is no place for %s", (_case, platformId) => {
    // Act & Assert
    expect(toRideStopPlace(platformId, { registry, coordsOf, lang: "ko" })).toBeNull();
  });

  it("is no place for a neighbor with a station id and no name, never its Korean Seoul name in English", () => {
    // Arrange
    const unnamed = subwayRegistryFixture();
    delete unnamed.neighbors["S1-4-426"]?.name;

    // Act & Assert
    expect(toRideStopPlace("S1-4-426", { registry: unnamed, coordsOf, lang: "en" })).toBeNull();
  });
});
