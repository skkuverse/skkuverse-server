/**
 * How a planned route is served (ADR 0022, D5): a walk with its label, icon, minutes as seconds, distance and path (null
 * without one), a transfer between two platforms of one station, a ride with its line's name, icon and color, its
 * board, alight, later and upcoming calls as served calls, its basis the weaker of its calls, its end the alight call's arrival
 * before its departure (ADR 0022, D5, amended 2026-10-25), its start the board call's board time (a late train's
 * expected arrival) and its duration between them; an
 * option not running with no legs and its next service at +09:00; each warning by its code and a message in the request
 * language naming the board place of the ride it warns of; options in the planner's order; a leg's places by
 * ref and platform. Places a running option cites are resolved before; one that is not throws.
 */
import type { Place } from "../../shared/place.wire";
import type { StopCall } from "../../shared/call.types";
import type { JourneyLine, JourneyRoute, RideLeg, TransferLeg, WalkLeg } from "../journey.document";
import { toLegPlaces, toPlaceKey, toServedRoute } from "./journey-routes.mapper";
import type { PlannedOption } from "./journey-routes.types";

const kst = (time: string) => new Date(`2026-10-20T${time}:00+09:00`);
const NAME = { ko: "인자셔틀", en: "INJA Shuttle", zh: "仁自班车" };
const LINE: JourneyLine = { id: "inja", source: "busTimetable", sourceLineId: "campus-inja", mode: "shuttle", name: NAME, color: "003626", icon: "shuttle" };
const WALK: WalkLeg = { kind: "walk", from: "skku_building:1", to: "bus_stop:hssc-bus-lot", minutes: 6, distanceM: 473, evidence: "TMAP" };
const RIDE: RideLeg = { kind: "ride", line: "inja", board: { place: "bus_stop:hssc-bus-lot" }, alight: { place: "bus_stop:nsc-n-center" }, rideMinutes: 82, evidence: "x" };
const TRANSFER: TransferLeg = { kind: "transfer", at: "subway_station:geumjeong", fromPlatformId: "P4", toPlatformId: "P1", minutes: 3, evidence: "x" };
const ROUTE: JourneyRoute = {
  id: "hssc-to-nsc",
  name: { ko: "인사캠 → 자과캠", en: "HSSC → NSC", zh: "人文校区 → 自然校区" },
  from: "skku_building:1",
  to: "bus_stop:nsc-n-center",
  options: [
    { id: "inja", name: NAME, mode: "shuttle", legs: [WALK, RIDE] },
    { id: "late", name: NAME, mode: "shuttle", legs: [WALK, RIDE] },
  ],
};

const place = (ref: string, platformId: string | null = null): Place => ({ kind: "bus_stop", id: ref.split(":")[1] ?? null, name: ref, coords: { lat: 37.5, lng: 127 }, platformId, action: null });
const PLACES = new Map(
  [
    { ref: "skku_building:1", platformId: null },
    { ref: "bus_stop:hssc-bus-lot", platformId: null },
    { ref: "bus_stop:nsc-n-center", platformId: null },
  ].map((cited) => [toPlaceKey(cited), place(cited.ref)]),
);

const call = (extra: Partial<StopCall>): StopCall => ({
  status: "scheduled",
  ...{ expectedArrivalAt: null, expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
  basis: "timetable",
  ...{ stopsAway: null, runId: "r", vehicleId: null, headsign: null, isFirstRun: false, isLastRun: false, isExpress: null, providerText: null },
  ...extra,
});

const RUNNING: PlannedOption = {
  status: "running",
  leaveAt: kst("14:23"),
  arriveAt: kst("15:52"),
  legs: [
    { leg: WALK, startAt: kst("14:23"), endAt: kst("14:29") },
    { leg: RIDE, line: LINE, board: call({ scheduledDepartureAt: kst("14:30") }), alight: call({ expectedArrivalAt: kst("15:52"), basis: "estimate" }), later: [call({ scheduledDepartureAt: kst("15:00") })], upcoming: [call({ scheduledDepartureAt: kst("14:10") }), call({ scheduledDepartureAt: kst("14:30") })], vehicles: [], waitSec: 60, observedAt: null },
  ],
  warnings: [],
};
const ENDED: PlannedOption = { status: "notRunning", reason: "ended", nextServiceAt: new Date("2026-10-21T08:00:00+09:00") };

describe("toServedRoute", () => {
  it("serves a walk and a ride with server-made labels, the ride's basis the weaker of its calls", () => {
    // Act
    const served = toServedRoute(ROUTE, { planned: [RUNNING, ENDED], order: [0, 1] }, { places: PLACES, lang: "en" });

    // Assert
    const [walk, ride] = served.options[0]!.legs;
    expect(walk).toEqual({
      ...{ kind: "walk", mode: "walk", from: place("skku_building:1"), to: place("bus_stop:hssc-bus-lot") },
      ...{ startAt: "2026-10-20T14:23:00+09:00", endAt: "2026-10-20T14:29:00+09:00", basis: "estimate", durationSec: 360, distanceM: 473 },
      ...{ label: "Walk", icon: "walk", color: null, path: null },
    });
    expect(ride).toMatchObject({
      ...{ kind: "ride", mode: "shuttle", label: "INJA Shuttle", icon: "shuttle", color: "003626", line: { id: "inja", name: "INJA Shuttle" } },
      ...{ startAt: "2026-10-20T14:30:00+09:00", endAt: "2026-10-20T15:52:00+09:00", durationSec: 4920, distanceM: null, basis: "estimate", waitSec: 60, observedAt: null },
    });
    expect(ride).toMatchObject({ later: [expect.objectContaining({ scheduledDepartureAt: "2026-10-20T15:00:00+09:00" })], vehicles: [] });
  });

  it("Upcoming: serves a ride's upcoming calls as served calls, in the planner's order", () => {
    // Act
    const served = toServedRoute(ROUTE, { planned: [RUNNING, ENDED], order: [0, 1] }, { places: PLACES, lang: "en" });

    // Assert
    expect(served.options[0]!.legs[1]).toMatchObject({
      upcoming: [
        { scheduledDepartureAt: "2026-10-20T14:10:00+09:00", basis: "timetable", runId: "r" },
        { scheduledDepartureAt: "2026-10-20T14:30:00+09:00", basis: "timetable", runId: "r" },
      ],
    });
  });

  it("Alight time: ends a ride at its alight call's arrival when the call also names a departure there", () => {
    // Arrange
    const [walk, ride] = (RUNNING as Extract<PlannedOption, { status: "running" }>).legs;
    const alight = call({ scheduledArrivalAt: kst("15:51"), scheduledDepartureAt: kst("15:52") });
    const planned: PlannedOption = { status: "running", leaveAt: kst("14:23"), arriveAt: kst("15:51"), legs: [walk!, { ...(ride as Extract<typeof ride, { line: JourneyLine }>), alight }], warnings: [] };

    // Act
    const served = toServedRoute(ROUTE, { planned: [planned, ENDED], order: [0, 1] }, { places: PLACES, lang: "en" });

    // Assert
    expect(served.options[0]!.legs[1]).toMatchObject({ startAt: "2026-10-20T14:30:00+09:00", endAt: "2026-10-20T15:51:00+09:00", durationSec: 4860 });
    expect(served.options[0]!.legs[1]).toMatchObject({ alight: { scheduledArrivalAt: "2026-10-20T15:51:00+09:00", scheduledDepartureAt: "2026-10-20T15:52:00+09:00" } });
  });

  it("Late train: starts a ride at its board call's expected arrival when that is past its scheduled departure", () => {
    // Arrange
    const [walk, ride] = (RUNNING as Extract<PlannedOption, { status: "running" }>).legs;
    const board = call({ scheduledArrivalAt: kst("14:29"), scheduledDepartureAt: kst("14:30"), expectedArrivalAt: kst("14:33"), basis: "provider" });
    const planned: PlannedOption = { status: "running", leaveAt: kst("14:26"), arriveAt: kst("15:52"), legs: [walk!, { ...(ride as Extract<typeof ride, { line: JourneyLine }>), board }], warnings: [] };

    // Act
    const served = toServedRoute(ROUTE, { planned: [planned, ENDED], order: [0, 1] }, { places: PLACES, lang: "en" });

    // Assert
    expect(served.options[0]!.legs[1]).toMatchObject({ startAt: "2026-10-20T14:33:00+09:00", durationSec: 4740, board: { scheduledDepartureAt: "2026-10-20T14:30:00+09:00" } });
  });

  it("serves an option not running with no legs, its next service at +09:00, in the planner's order", () => {
    // Act
    const served = toServedRoute(ROUTE, { planned: [ENDED, RUNNING], order: [1, 0] }, { places: PLACES, lang: "ko" });

    // Assert
    expect(served.options.map((option) => [option.id, option.status])).toEqual([
      ["late", "running"],
      ["inja", "notRunning"],
    ]);
    expect(served.options[1]).toEqual({ id: "inja", name: "인자셔틀", mode: "shuttle", status: "notRunning", reason: "ended", nextServiceAt: "2026-10-21T08:00:00+09:00", leaveAt: null, arriveAt: null, legs: [], warnings: [] });
    expect(served.name).toBe("인사캠 → 자과캠");
  });

  it("serves each warning by its code and a message naming the board place of the ride it warns of, in the request language", () => {
    // Arrange
    const warned: PlannedOption = { ...RUNNING, warnings: [{ code: "tightTransfer", legIndex: 1 }, { code: "connectionAtRisk", legIndex: 1 }] } as PlannedOption;

    // Act
    const [en, ko] = (["en", "ko"] as const).map((lang) => toServedRoute(ROUTE, { planned: [warned, ENDED], order: [0, 1] }, { places: PLACES, lang }).options[0]!.warnings);

    // Assert
    expect(en).toEqual([
      { code: "tightTransfer", message: "Tight transfer at bus_stop:hssc-bus-lot" },
      { code: "connectionAtRisk", message: "You may miss the connection at bus_stop:hssc-bus-lot" },
    ]);
    expect(ko?.[0]).toEqual({ code: "tightTransfer", message: "bus_stop:hssc-bus-lot에서 갈아탈 시간이 빠듯해요" });
  });

  it("serves a not-started option's reason and its next service later this service day", () => {
    // Arrange
    const notStarted: PlannedOption = { status: "notRunning", reason: "notStarted", nextServiceAt: kst("06:00") };

    // Act
    const served = toServedRoute(ROUTE, { planned: [notStarted, RUNNING], order: [1, 0] }, { places: PLACES, lang: "ko" });

    // Assert
    expect(served.options[1]).toMatchObject({ id: "inja", status: "notRunning", reason: "notStarted", nextServiceAt: "2026-10-20T06:00:00+09:00", legs: [] });
  });

  it("throws for a running option citing a place that was not resolved", () => {
    // Arrange
    const places = new Map([...PLACES].filter(([key]) => !key.startsWith("bus_stop:nsc-n-center")));

    // Act & Assert
    expect(() => toServedRoute(ROUTE, { planned: [RUNNING, ENDED], order: [0, 1] }, { places, lang: "ko" })).toThrow(/bus_stop:nsc-n-center/);
  });
});

describe("toLegPlaces", () => {
  it("is a walk's ends, a transfer's station at both platforms and a ride's stops", () => {
    // Act & Assert
    expect([WALK, TRANSFER, RIDE].map(toLegPlaces)).toEqual([
      [{ ref: "skku_building:1", platformId: null }, { ref: "bus_stop:hssc-bus-lot", platformId: null }],
      [{ ref: "subway_station:geumjeong", platformId: "P4" }, { ref: "subway_station:geumjeong", platformId: "P1" }],
      [{ ref: "bus_stop:hssc-bus-lot", platformId: null }, { ref: "bus_stop:nsc-n-center", platformId: null }],
    ]);
  });
});

describe("toPlaceKey", () => {
  it("tells one station's platforms apart", () => {
    // Act & Assert
    expect(toPlaceKey({ ref: "subway_station:geumjeong", platformId: "P4" })).not.toBe(toPlaceKey({ ref: "subway_station:geumjeong", platformId: "P1" }));
  });
});
