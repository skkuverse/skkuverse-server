import { captureGroups } from "../shared/regex.util";
import { JOURNEY_PLACE_KINDS, PLACE_REF_PATTERN } from "./journey.constants";
import type { JourneyLeg, JourneyLine, JourneyRoutesData, RideLeg } from "./journey.document";
import type { CitedPlace, JourneyCatalog, JourneyIssue, JourneyReference, JourneySourceId, LegEnds, PlaceKind, PlaceRef } from "./journey.types";

type Path = Array<string | number>;

const isPlaceKind = (kind: string): kind is PlaceKind => (JOURNEY_PLACE_KINDS as readonly string[]).includes(kind);

export function toPlaceRef(ref: string): PlaceRef | null {
  const groups = captureGroups(ref, PLACE_REF_PATTERN, 2);
  return groups && isPlaceKind(groups[0]) ? { kind: groups[0], id: groups[1] } : null;
}

export function toLegEnds(leg: JourneyLeg): LegEnds {
  if (leg.kind === "walk") return { from: leg.from, to: leg.to };
  if (leg.kind === "transfer") return { from: leg.at, to: leg.at };
  return { from: leg.board.place, to: leg.alight.place };
}

/** WHY: every place the dataset cites, with where it sits and the role that limits its kind (ADR 0022, D4). */
export function toCitedPlaces({ routes }: JourneyRoutesData): CitedPlace[] {
  return routes.flatMap((route, routeIndex) => [
    { ref: route.from, path: ["routes", routeIndex, "from"], role: "routeEnd" as const, platformId: null },
    { ref: route.to, path: ["routes", routeIndex, "to"], role: "routeEnd" as const, platformId: null },
    ...route.options.flatMap((option, optionIndex) =>
      option.legs.flatMap((leg, legIndex): CitedPlace[] => {
        const at: Path = ["routes", routeIndex, "options", optionIndex, "legs", legIndex];
        if (leg.kind === "walk") return [{ ref: leg.from, path: [...at, "from"], role: "walkEnd", platformId: null }, { ref: leg.to, path: [...at, "to"], role: "walkEnd", platformId: null }];
        if (leg.kind === "transfer") return [leg.fromPlatformId, leg.toPlatformId].map((platformId, side) => ({ ref: leg.at, path: [...at, side === 0 ? "fromPlatformId" : "toPlatformId"], role: "transferAt", platformId }));
        return (["board", "alight"] as const).map((side) => ({ ref: leg[side].place, path: [...at, side, "place"], role: "rideStop", platformId: leg[side].platformId ?? null }));
      }),
    ),
  ]);
}

// WHY: the stops and stop areas cited are bus-stops identities, so its incoming-reference check refuses deleting one.
export function journeyRoutesReferences(data: JourneyRoutesData): JourneyReference[] {
  return toCitedPlaces(data).flatMap(({ ref, path }) => {
    const place = toPlaceRef(ref);
    return place && (place.kind === "bus_stop" || place.kind === "bus_stop_area") ? [{ dataset: "bus-stops", id: place.id, path }] : [];
  });
}

function duplicateIssues(ids: readonly string[], at: (index: number) => Path): JourneyIssue[] {
  return ids.flatMap((id, index) => (ids.indexOf(id) === index ? [] : [{ path: at(index), message: `"${id}" is used twice` }]));
}

function chainIssues(data: JourneyRoutesData): JourneyIssue[] {
  return data.routes.flatMap((route, routeIndex) =>
    route.options.flatMap((option, optionIndex) => {
      const at = ["routes", routeIndex, "options", optionIndex, "legs"];
      const ends = option.legs.map(toLegEnds);
      const starts = [route.from, ...ends.map((end) => end.to)];
      const issues = ends.flatMap((end, legIndex) => (end.from === starts[legIndex] ? [] : [{ path: [...at, legIndex], message: `starts at ${end.from}, not at ${starts[legIndex]}, where the option is by then` }]));
      const last = ends.at(-1)?.to;
      return last === route.to ? issues : [...issues, { path: at, message: `ends at ${last}, not at the route's ${route.to}` }];
    }),
  );
}

// WHY: a shuttle boards at a boarding stop and alights at an alighting one after it; each path is the ride leg's relative.
function busRideIssues({ board, alight }: RideLeg, line: JourneyLine, { sequencesByService }: JourneyCatalog): JourneyIssue[] {
  if (sequencesByService === null) return [{ path: ["line"], message: "no stored bus-stops, so the ride's stop order was not checked", warning: true }];
  const [boardId, alightId] = [toPlaceRef(board.place)?.id ?? "", toPlaceRef(alight.place)?.id ?? ""];
  const isOrdered = Object.values(sequencesByService[line.sourceLineId] ?? {}).some((sequence) => {
    const boardIndex = sequence.findIndex((stop) => stop.stopId === boardId && stop.action === "board");
    return boardIndex >= 0 && sequence.some((stop, index) => index > boardIndex && stop.stopId === alightId && stop.action === "alight");
  });
  return isOrdered ? [] : [{ path: [], message: `${line.sourceLineId} has no sequence that boards at ${boardId} and then alights at ${alightId}` }];
}

function subwayRideIssues({ board, alight }: RideLeg, line: JourneyLine, { subwayRideIssueOf }: JourneyCatalog): JourneyIssue[] {
  if (subwayRideIssueOf === null) return [{ path: ["line"], message: "no stored subway-timetables, so the ride's train order was not checked", warning: true }];
  const message = subwayRideIssueOf({ lineId: line.sourceLineId, boardPlatformId: board.platformId ?? "", alightPlatformId: alight.platformId ?? "" });
  return message === null ? [] : [{ path: [], message }];
}

function topisRideIssues({ board, alight }: RideLeg, line: JourneyLine, { topisRideIssueOf }: JourneyCatalog): JourneyIssue[] {
  if (topisRideIssueOf === null) return [{ path: ["line"], message: "no stored bus-stops, jongro_routes or jongro_route_paths, so the ride's station order was not checked", warning: true }];
  const message = topisRideIssueOf({ lineId: line.sourceLineId, boardStopId: toPlaceRef(board.place)?.id ?? "", alightStopId: toPlaceRef(alight.place)?.id ?? "" });
  return message === null ? [] : [{ path: [], message }];
}

const RIDE_ISSUES_BY_SOURCE: Readonly<Record<JourneySourceId, typeof busRideIssues>> = { busTimetable: busRideIssues, subway: subwayRideIssues, topis: topisRideIssues };

function rideIssues(data: JourneyRoutesData, catalog: JourneyCatalog): JourneyIssue[] {
  const lineById = new Map(data.lines.map((line) => [line.id, line]));
  return data.routes.flatMap((route, routeIndex) =>
    route.options.flatMap((option, optionIndex) =>
      option.legs.flatMap((leg, legIndex): JourneyIssue[] => {
        if (leg.kind !== "ride") return [];
        const [at, line] = [["routes", routeIndex, "options", optionIndex, "legs", legIndex], lineById.get(leg.line)] as const;
        if (!line) return [{ path: [...at, "line"], message: `"${leg.line}" is no line of this dataset` }];
        return RIDE_ISSUES_BY_SOURCE[line.source](leg, line, catalog).map((issue) => ({ ...issue, path: [...at, ...issue.path] }));
      }),
    ),
  );
}

/** WHY: what the dataset must hold together whatever its places resolve to: unique ids, chained legs, known lines, ordered rides. */
export function toJourneyRoutesIssues(data: JourneyRoutesData, catalog: JourneyCatalog): JourneyIssue[] {
  const optionIdIssues = data.routes.flatMap((route, routeIndex) => duplicateIssues(route.options.map((option) => option.id), (index) => ["routes", routeIndex, "options", index, "id"]));
  const lineAndRouteIdIssues = [...duplicateIssues(data.lines.map((line) => line.id), (index) => ["lines", index, "id"]), ...duplicateIssues(data.routes.map((route) => route.id), (index) => ["routes", index, "id"])];
  return [...lineAndRouteIdIssues, ...optionIdIssues, ...chainIssues(data), ...rideIssues(data, catalog)];
}
