import type { JongroArrivalBus } from "../../cache/bus-cache.document";
import { toCarNumber } from "../bus-realtime.mapper";
import type { Arrival } from "../group/bus-realtime-group.wire";
import {
  ARRIVAL_STATE_PHRASES,
  BRACKET_TOKEN_PATTERN,
  CONGESTION_CODE_TYPE,
  CROWDING_BY_CONGESTION_CODE,
  LAST_BUS_TOKEN,
  NORMAL_CROWDING_SEAT_RATIO,
  NO_VEHICLE_ID,
  PASSENGER_COUNT_TYPE,
  TIMED_TEXT_PATTERN,
} from "./bus-realtime-arrival.constants";
import type { ArrivalState, Crowding, TimedText } from "./bus-realtime-arrival.types";

function toTimedText(arrmsg: string): TimedText | null {
  const match = TIMED_TEXT_PATTERN.exec(arrmsg.replace(BRACKET_TOKEN_PATTERN, " "));
  if (!match) return null;
  const [, minutes, secondsAfterMinutes, secondsAlone] = match;
  return { minutes: Number(minutes ?? 0), seconds: Number(secondsAfterMinutes ?? secondsAlone ?? 0) };
}

export function toArrivalState(arrmsg: string): ArrivalState {
  const text = arrmsg.trim();
  const phrased = ARRIVAL_STATE_PHRASES.find(([, phrases]) => phrases.some((phrase) => text.includes(phrase)));
  if (phrased) return phrased[0];
  return toTimedText(text) ? "running" : "unknown";
}

export function isLastBus(bus: JongroArrivalBus): boolean {
  return bus.isLast || bus.arrmsg.includes(LAST_BUS_TOKEN);
}

function hasVehicle(bus: JongroArrivalBus): boolean {
  const vehId = bus.vehId.trim();
  return vehId !== "" && vehId !== NO_VEHICLE_ID;
}

function toWholeMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

// WHY: whole minutes only, since a 0–3 min prediction is off by about a minute (proposal.md); a 0 travel time
// falls back to the text's own time.
export function toMinutes(bus: JongroArrivalBus): number | null {
  if (toArrivalState(bus.arrmsg) !== "running") return null;
  if (bus.traTime > 0) return toWholeMinutes(bus.traTime);
  const timed = toTimedText(bus.arrmsg);
  return timed ? toWholeMinutes(timed.minutes * 60 + timed.seconds) : null;
}

export function toStopsAway(bus: JongroArrivalBus): number | null {
  return hasVehicle(bus) ? bus.staOrd - bus.sectOrd : null;
}

export function toArrivalCarNumber(bus: JongroArrivalBus): string | null {
  return hasVehicle(bus) ? toCarNumber(bus.plainNo) : null;
}

export function toCrowding(rerideDiv: number | null, rerideNum: number | null, seatCount: number): Crowding | null {
  if (rerideNum === null) return null;
  if (rerideDiv === CONGESTION_CODE_TYPE) return CROWDING_BY_CONGESTION_CODE[rerideNum] ?? null;
  if (rerideDiv !== PASSENGER_COUNT_TYPE) return null;
  if (rerideNum <= seatCount) return "relaxed";
  return rerideNum <= seatCount * NORMAL_CROWDING_SEAT_RATIO ? "normal" : "crowded";
}

export function toPassengerCount(bus: JongroArrivalBus): number | null {
  return bus.rerideDiv === PASSENGER_COUNT_TYPE ? bus.rerideNum : null;
}

export function toArrival(bus: JongroArrivalBus, seatCount: number): Arrival {
  return {
    minutes: toMinutes(bus),
    stopsAway: toStopsAway(bus),
    state: toArrivalState(bus.arrmsg),
    isLastBus: isLastBus(bus),
    carNumber: toArrivalCarNumber(bus),
    crowding: toCrowding(bus.rerideDiv, bus.rerideNum, seatCount),
    passengerCount: toPassengerCount(bus),
    message: bus.arrmsg,
  };
}
