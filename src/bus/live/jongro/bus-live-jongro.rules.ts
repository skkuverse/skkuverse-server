import { toKstInstant } from "../../../shared/kst-date.util";
import type { Arrival, Operation, Vehicle } from "../../bus.wire";
import type { JongroBusType } from "../../cache/bus-cache.document";
import type { TimedArrival } from "../../realtime/arrival/bus-realtime-arrival.types";
import type { JongroReading } from "../../realtime/group/bus-realtime-group.types";
import type { RealtimeArrival } from "../../realtime/group/bus-realtime-group.wire";
import { MAX_STATION_ARRIVALS } from "../bus-live.constants";
import { STANDING_ARRIVAL, STATUS_BY_STATE } from "./bus-live-jongro.constants";
import type { JongroVehicleStates } from "./bus-live-jongro.types";

const SECOND_MS = 1000;

// WHY: TOPIS's own prediction counts from when it made the row (mkTm); an arriving-soon bus keeps an instant when TOPIS gives one.
function toExpectedArrivalAt({ arrival, travelSeconds }: TimedArrival, madeAtMs: number | null): string | null {
  const isTimed = arrival.state === "running" || arrival.state === "arriving";
  return isTimed && madeAtMs !== null && travelSeconds !== null ? toKstInstant(madeAtMs + travelSeconds * SECOND_MS) : null;
}

// QUIRK(topis): an arrival row's sectOrd is the staOrd of the bus's next stop (EVIDENCE: src/bus/realtime/group/bus-realtime-group.rules.ts),
// so staOrd − sectOrd counts the stops between, and ADR 0019 D4, which counts the next stop as 1, is one more.
function toLiveStopsAway(topisStopsAway: number | null): number | null {
  return topisStopsAway === null ? null : topisStopsAway + 1;
}

/** WHY: null for TOPIS's end-of-service and no-information texts, which say what the station's operation is rather than where a bus is. */
export function toJongroArrival(slot: TimedArrival, madeAtMs: number | null): Arrival | null {
  const { bus, arrival } = slot;
  const stated = STATUS_BY_STATE[arrival.state];
  if (stated === null) return null;
  const expectedArrivalAt = toExpectedArrivalAt(slot, madeAtMs);
  return {
    status: stated === "enRoute" && expectedArrivalAt === null ? "unknown" : stated,
    expectedArrivalAt,
    ...{ expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
    basis: "provider",
    stopsAway: toLiveStopsAway(arrival.stopsAway),
    isLastBus: arrival.isLastBus,
    // WHY: TOPIS names a vehicle exactly when the slot has stops away (toStopsAway).
    vehicleId: arrival.stopsAway === null ? null : bus.vehId,
    providerText: bus.arrmsg,
  };
}

// WHY: TOPIS flags the last bus per row, and one bus's rows can disagree (EVIDENCE: on 2026-10-22 jongro08's arriving-soon
// rows carried no last-bus text beside its other rows'), so a bus is the last one when any row naming it says so.
export function toVehicleStates({ rows, positions }: Pick<JongroReading, "rows" | "positions">): JongroVehicleStates {
  const standing = positions.filter(({ tracking }) => tracking.status === "atStop");
  const namedSlots = rows.flatMap(({ slots }) => slots).filter(({ arrival }) => arrival.stopsAway !== null);
  return {
    standingStationIndexById: new Map(standing.map(({ position }) => [position.vehicleId, Number(position.sequence) - 1])),
    lastBusIds: new Set(namedSlots.filter(({ arrival }) => arrival.isLastBus).map(({ bus }) => bus.vehId)),
    namedVehicleIds: new Set(namedSlots.map(({ bus }) => bus.vehId)),
  };
}

// WHY: the last bus is the bus's, so every arrival naming it carries the vehicle's flag (ADR 0019, D6).
export function withVehicleState(arrival: Arrival, { lastBusIds }: JongroVehicleStates): Arrival {
  return arrival.vehicleId === null ? arrival : { ...arrival, isLastBus: lastBusIds.has(arrival.vehicleId) };
}

function toStandingArrival(vehicleId: string, named: Arrival | undefined, { lastBusIds, namedVehicleIds }: JongroVehicleStates): Arrival {
  const isLastBus = namedVehicleIds.has(vehicleId) ? lastBusIds.has(vehicleId) : null;
  return { ...STANDING_ARRIVAL, vehicleId, isLastBus, providerText: named?.providerText ?? null };
}

// WHY: a bus standing at the station is the one a rider boards, arriving until it leaves (ADR 0019, D14); TOPIS drops it
// from that station's row, and a row still naming it there is one its newer position outran, so it comes first, listed once.
export function toStationArrivals(rowArrivals: readonly Arrival[], stationIndex: number, states: JongroVehicleStates): Arrival[] {
  const standingIds = [...states.standingStationIndexById].filter(([, standingIndex]) => standingIndex === stationIndex).map(([vehicleId]) => vehicleId);
  const standing = standingIds.map((vehicleId) => toStandingArrival(vehicleId, rowArrivals.find((arrival) => arrival.vehicleId === vehicleId), states));
  const rest = rowArrivals.filter(({ vehicleId }) => vehicleId === null || !standingIds.includes(vehicleId)).map((arrival) => withVehicleState(arrival, states));
  return [...standing, ...rest].slice(0, MAX_STATION_ARRIVALS);
}

// WHY: ended only when every slot says the service ended (ADR 0019, D8); a slot with a bus, waiting or not, is a running station.
export function toStationOperation(slots: readonly TimedArrival[]): Operation {
  if (slots.some(({ arrival }) => STATUS_BY_STATE[arrival.state] !== null)) return "running";
  return slots.length > 0 && slots.every(({ arrival }) => arrival.state === "ended") ? "ended" : "noData";
}

/** WHY: the row nearest ahead of the vehicle, its next stop's, else the first in station order, as the realtime view reads it. */
export function toNearestSlot(namedSlots: readonly TimedArrival[], sectOrd: number | null): TimedArrival | undefined {
  const inOrder = [...namedSlots].sort((a, b) => a.bus.staOrd - b.bus.staOrd);
  return inOrder.find(({ bus }) => sectOrd !== null && bus.staOrd === sectOrd + 1) ?? inOrder[0];
}

export function toOccupancy({ crowding, passengerCount }: Pick<RealtimeArrival, "crowding" | "passengerCount">): Vehicle["occupancy"] {
  return crowding === null ? null : { level: crowding, passengerCount };
}

// QUIRK(topis): a plate comes padded with spaces, and a single space when there is none.
export function toPlateNumber(plainNo: string): string | null {
  return plainNo.trim() || null;
}

// WHY: an articulated bus's type says nothing of its floor, and no type is unknown rather than general.
export function toLowFloor(busType: JongroBusType | undefined): boolean | null {
  if (busType === "lowFloor") return true;
  return busType === "general" ? false : null;
}

/** WHY: a group is as fresh as its staler key, so a stopped writer of either shows (ADR 0019, D6). */
export function toOlderInstant(first: Date | null, second: Date | null): Date | null {
  if (first === null || second === null) return first ?? second;
  return first.getTime() <= second.getTime() ? first : second;
}
