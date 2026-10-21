import type { BusStopsData } from "../bus-stops.document";
import { subwayStationErrors, validateStopCatalog } from "../bus-stops.rules";
import type { BusStopsCheckContext, BusStopsIssue, BusStopsReference } from "./bus-stops-check.types";

const STOP_LABEL = /^stop (\S+): /;
const STOP_INDEX_LABEL = /^stops\[(\d+)\]/;
const SEQUENCE_LABEL = /^sequences ([^.\s:[]+)(?:\.([^\s:[]+))?(?:\[(\d+)\])?/;

// WHY: the catalog checks label each issue in the words the boot failure showed ("stop <id>", "sequences
// <service>.<route type>[<index>]"); the label is read back into the dataset path the push report prints.
function catalogPathOf(message: string, stopIds: readonly string[]): Array<string | number> {
  const stopIndex = STOP_INDEX_LABEL.exec(message);
  if (stopIndex) return ["stops", Number(stopIndex[1])];
  const [, stopId] = STOP_LABEL.exec(message) ?? [];
  if (stopId !== undefined) return ["stops", message.endsWith(": duplicate id") ? stopIds.lastIndexOf(stopId) : stopIds.indexOf(stopId)];
  const [, serviceId, routeType, index] = SEQUENCE_LABEL.exec(message) ?? [];
  if (serviceId === undefined) return [];
  return ["sequences", serviceId, ...(routeType === undefined ? [] : [routeType]), ...(index === undefined ? [] : [Number(index)])];
}

function catalogIssues(data: BusStopsData, { knownServiceIds, optIns, stationIds }: BusStopsCheckContext): BusStopsIssue[] {
  const stopIds = data.stops.map((stop) => stop.id);
  const issues = validateStopCatalog(data, knownServiceIds, optIns).map((message) => ({ path: catalogPathOf(message, stopIds), message }));
  const stationIssues = subwayStationErrors(data, stationIds).map((message) => ({ path: [...catalogPathOf(message, stopIds), "subwayStationId"], message }));
  return [...issues, ...stationIssues];
}

// WHY: a strategy only travels with an estimated sequence: one the code opts in and the data holds.
function laneStrategyIssues({ sequences }: BusStopsData, { optIns, laneStrategies }: BusStopsCheckContext): BusStopsIssue[] {
  return Object.entries(laneStrategies).flatMap(([serviceId, byRouteType]) =>
    Object.keys(byRouteType)
      .filter((routeType) => !(optIns.get(serviceId)?.includes(routeType) && sequences[serviceId]?.[routeType]))
      .map((routeType) => ({
        path: ["sequences", serviceId, routeType],
        message: `"${serviceId} ${routeType}" has a travel strategy in src/bus/eta/lane/bus-eta-lane.constants.ts, but this data does not estimate it`,
      })),
  );
}

function hsscLineIssues({ stops, hssc }: BusStopsData): BusStopsIssue[] {
  const stopIds = new Set(stops.map((stop) => stop.id));
  const positionByStopId = new Map<string, number>();
  const last = hssc.stations.length - 1;
  return hssc.stations.flatMap((station, index) => {
    const at = ["hssc", "stations", index];
    const issues: BusStopsIssue[] = [];
    if (station.isFirstStation && index !== 0) issues.push({ path: [...at, "isFirstStation"], message: "only the first position may be the first station" });
    if (station.isLastStation && index !== last) issues.push({ path: [...at, "isLastStation"], message: "only the last position may be the last station" });
    const { stopId } = station;
    if (stopId === null) return issues;
    const earlier = positionByStopId.get(stopId);
    if (!stopIds.has(stopId)) issues.push({ path: [...at, "stopId"], message: `names the stop "${stopId}", which the dataset's stops do not hold` });
    else if (earlier !== undefined) issues.push({ path: [...at, "stopId"], message: `names the stop "${stopId}", which position ${earlier} names too` });
    else positionByStopId.set(stopId, index);
    return issues;
  });
}

function aliasIssues({ stops }: BusStopsData): BusStopsIssue[] {
  const claimedAt = new Map<string, string>();
  return stops.flatMap((stop, stopIndex) =>
    (stop.arsIds ?? []).flatMap((arsId, aliasIndex) => {
      const path = ["stops", stopIndex, "arsIds", aliasIndex];
      const earlier = claimedAt.get(arsId);
      if (earlier === undefined) claimedAt.set(arsId, path.join("."));
      return earlier === undefined ? [] : [{ path, message: `ARS number ${arsId} is aliased by ${earlier} too` }];
    }),
  );
}

function overlayIssues({ topis = {} }: BusStopsData, { stationIds }: BusStopsCheckContext): BusStopsIssue[] {
  return Object.entries(topis).flatMap(([arsId, overlay]) => {
    const { subwayStationId } = overlay;
    if (subwayStationId === undefined || stationIds.has(subwayStationId)) return [];
    return [{ path: ["topis", arsId, "subwayStationId"], message: `"${subwayStationId}" is not a served subway station` }];
  });
}

/** WHY: every check a bus-stops push runs after its schema, each issue at its path (unify-bus-stops design D1 to D4). */
export function toBusStopsIssues(data: BusStopsData, context: BusStopsCheckContext): BusStopsIssue[] {
  return [...catalogIssues(data, context), ...laneStrategyIssues(data, context), ...hsscLineIssues(data), ...aliasIssues(data), ...overlayIssues(data, context)];
}

/** WHY: what the dataset names in the code-held sources: each stop's and overlay entry's subway station, each sequence's service. */
export function busStopsReferences({ stops, sequences, topis = {} }: BusStopsData): BusStopsReference[] {
  const station = (id: string | undefined, path: Array<string | number>): BusStopsReference[] => (id === undefined ? [] : [{ dataset: "subwayStations", id, path }]);
  return [
    ...stops.flatMap((stop, index) => station(stop.subwayStationId, ["stops", index, "subwayStationId"])),
    ...Object.entries(topis).flatMap(([arsId, overlay]) => station(overlay.subwayStationId, ["topis", arsId, "subwayStationId"])),
    ...Object.keys(sequences).map((serviceId): BusStopsReference => ({ dataset: "busServices", id: serviceId, path: ["sequences", serviceId] })),
  ];
}
