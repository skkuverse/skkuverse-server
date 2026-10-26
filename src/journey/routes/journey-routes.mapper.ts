import { LEG_LABELS, WARNING_MESSAGES } from "./journey-routes.constants";
import type { SupportedLang } from "../../infra/types";
import type { StopCall } from "../../shared/call.types";
import { toAlightTime, toBoardTime, toCall } from "../../shared/call.util";
import { toKstInstant } from "../../shared/kst-date.util";
import type { Place } from "../../shared/place.wire";
import type { JourneyLeg, JourneyOption, JourneyRoute } from "../journey.document";
import { toLegBasis } from "./journey-routes.rules";
import type { CitedLegPlace, PlannedLeg, PlannedOption, PlannedRide, PlannedStep, PlannedWarning, ServedLeg, ServedOption, ServedRoute } from "./journey-routes.types";

const MINUTE_S = 60;

type Served = { places: ReadonlyMap<string, Place>; lang: SupportedLang };

export const toPlaceKey = ({ ref, platformId }: CitedLegPlace): string => `${ref}@${platformId ?? ""}`;

export function toLegPlaces(leg: JourneyLeg): [CitedLegPlace, CitedLegPlace] {
  if (leg.kind === "walk") return [{ ref: leg.from, platformId: null }, { ref: leg.to, platformId: null }];
  if (leg.kind === "transfer") return [{ ref: leg.at, platformId: leg.fromPlatformId }, { ref: leg.at, platformId: leg.toPlatformId }];
  return [{ ref: leg.board.place, platformId: leg.board.platformId ?? null }, { ref: leg.alight.place, platformId: leg.alight.platformId ?? null }];
}

function placesOf([from, to]: [CitedLegPlace, CitedLegPlace], served: Served): { from: Place; to: Place } {
  return { from: placeOf(from, served), to: placeOf(to, served) };
}

const servedInstant = (at: Date): string => toKstInstant(at.getTime());

function placeOf(cited: CitedLegPlace, { places }: Served): Place {
  const place = places.get(toPlaceKey(cited));
  if (!place) throw new Error(`journey: ${toPlaceKey(cited)} was planned without its place resolved`);
  return place;
}

function toServedStep({ leg, startAt, endAt }: PlannedStep, served: Served): ServedLeg {
  const { from, to } = placesOf(toLegPlaces(leg), served);
  const base = { from, to, startAt: servedInstant(startAt), endAt: servedInstant(endAt), basis: "estimate" as const, durationSec: leg.minutes * MINUTE_S };
  if (leg.kind === "transfer") return { kind: "transfer", mode: "subway", ...base, distanceM: null, label: LEG_LABELS.transfer[served.lang], icon: "transfer", color: null };
  return { kind: "walk", mode: "walk", ...base, distanceM: leg.distanceM, label: LEG_LABELS.walk[served.lang], icon: "walk", color: null, path: leg.path ?? null };
}

function timeOf(call: StopCall): Date {
  const at = toBoardTime(call);
  if (!at) throw new Error("journey: a ride was planned on a call with no time");
  return at;
}

function toServedRide({ leg, line, board, alight, later, upcoming, vehicles, waitSec, observedAt }: PlannedRide, served: Served): ServedLeg {
  const { from, to } = placesOf(toLegPlaces(leg), served);
  const [startAt, endAt] = [timeOf(board), toAlightTime(alight)];
  if (!endAt) throw new Error("journey: a ride was planned on an alight call with no time");
  const name = line.name[served.lang];
  return {
    kind: "ride",
    ...{ mode: line.mode, from, to, startAt: servedInstant(startAt), endAt: servedInstant(endAt), basis: toLegBasis(board, alight) },
    ...{ durationSec: Math.round((endAt.getTime() - startAt.getTime()) / 1000), distanceM: null, label: name, icon: line.icon, color: line.color },
    line: { id: line.id, name },
    ...{ board: toCall(board), alight: toCall(alight), later: later.map(toCall), upcoming: upcoming.map(toCall), vehicles, waitSec, observedAt: observedAt && servedInstant(observedAt) },
  };
}

const isRide = (leg: PlannedLeg): leg is PlannedRide => leg.leg.kind === "ride";

function toServedWarning(option: JourneyOption, { code, legIndex }: PlannedWarning, served: Served): ServedOption["warnings"][number] {
  const leg = option.legs[legIndex];
  const place = leg ? placesOf(toLegPlaces(leg), served).from.name : "";
  return { code, message: WARNING_MESSAGES[code][served.lang].replace("{place}", place) };
}

function toServedOption(option: JourneyOption, planned: PlannedOption, served: Served): ServedOption {
  const base = { id: option.id, name: option.name[served.lang], mode: option.mode, status: planned.status };
  if (planned.status === "notRunning") {
    const nextServiceAt = planned.nextServiceAt && servedInstant(planned.nextServiceAt);
    return { ...base, reason: planned.reason, nextServiceAt, leaveAt: null, arriveAt: null, legs: [], warnings: [] };
  }
  const legs = planned.legs.map((leg) => (isRide(leg) ? toServedRide(leg, served) : toServedStep(leg, served)));
  const warnings = planned.warnings.map((warning) => toServedWarning(option, warning, served));
  return { ...base, reason: null, nextServiceAt: null, leaveAt: servedInstant(planned.leaveAt), arriveAt: servedInstant(planned.arriveAt), legs, warnings };
}

/** WHY: the route as served, its options in the planner's order; every place a running option cites is resolved before. */
export function toServedRoute(route: JourneyRoute, { planned, order }: { planned: readonly PlannedOption[]; order: readonly number[] }, served: Served): ServedRoute {
  const options = order.flatMap((index) => {
    const option = route.options[index];
    const plannedOption = planned[index];
    return option && plannedOption ? [toServedOption(option, plannedOption, served)] : [];
  });
  const { from, to } = placesOf([{ ref: route.from, platformId: null }, { ref: route.to, platformId: null }], served);
  return { id: route.id, name: route.name[served.lang], from, to, options };
}
