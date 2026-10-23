import { toKstInstant } from "../../bus.mapper";
import { toPoleStopId, toServedArsId } from "../../bus.rules";
import type { Vehicle, VehiclePosition } from "../../bus.wire";
import type { TimedArrival } from "../../realtime/arrival/bus-realtime-arrival.types";
import type { JongroReading, PlacedArrivalRow, TrackedPosition } from "../../realtime/group/bus-realtime-group.types";
import { toGroupOperation } from "../bus-live.rules";
import type { LiveGroup, LiveStation } from "../bus-live.wire";
import { POSITION_STATUS_BY_TRACKED_STATUS } from "./bus-live-jongro.constants";
import {
  toJongroArrival,
  toLowFloor,
  toNearestSlot,
  toOccupancy,
  toOlderInstant,
  toPlateNumber,
  toStationArrivals,
  toStationOperation,
  toVehicleStates,
} from "./bus-live-jongro.rules";
import type { JongroStationContext, JongroVehicleStates } from "./bus-live-jongro.types";

const SECOND_MS = 1000;

function toStation(row: PlacedArrivalRow, { route, stopIdByArsId, states }: JongroStationContext): LiveStation {
  const arsId = route.registryStations[row.stationIndex]?.arsId ?? null;
  const rowArrivals = row.slots.flatMap((slot) => toJongroArrival(slot, row.madeAtMs) ?? []);
  return {
    stationIndex: row.stationIndex,
    stopId: toPoleStopId(arsId, stopIdByArsId),
    arsId: toServedArsId(arsId),
    operation: toStationOperation(row.slots),
    arrivals: toStationArrivals(rowArrivals, row.stationIndex, states),
  };
}

function toPosition({ position, tracking, checkedAt }: TrackedPosition): VehiclePosition {
  const observedAtMs = Date.parse(position.observedAt);
  return {
    stationIndex: Number(position.sequence) - 1,
    status: POSITION_STATUS_BY_TRACKED_STATUS[tracking.status],
    progress: tracking.progress,
    sectionMeters: tracking.segmentMeters,
    coords: { lat: Number(position.latitude), lng: Number(position.longitude) },
    nextStationAt: tracking.nextStopInSec === null ? null : toKstInstant(observedAtMs + tracking.nextStopInSec * SECOND_MS),
    positionAt: toKstInstant(observedAtMs),
    checkedAt: toKstInstant(checkedAt.getTime()),
  };
}

function toNearestFields(nearest: TimedArrival | undefined, lastBusIds: ReadonlySet<string>): Pick<Vehicle, "occupancy" | "isLastBus"> {
  return nearest ? { occupancy: toOccupancy(nearest.arrival), isLastBus: lastBusIds.has(nearest.bus.vehId) } : { occupancy: null, isLastBus: null };
}

// WHY: low-floor is the vehicle's own, so its position row alone decides it and its rows never give two answers (ADR 0019, D13).
function toTrackedVehicle(tracked: TrackedPosition, namedSlots: readonly TimedArrival[], lastBusIds: ReadonlySet<string>): Vehicle {
  const { position, tracking } = tracked;
  const trajectory = tracking.trajectory.map(({ atMs, s }) => ({ at: toKstInstant(atMs), s }));
  return {
    id: position.vehicleId,
    plateNumber: toPlateNumber(position.plainNo),
    ...toNearestFields(toNearestSlot(namedSlots, Number(position.sequence)), lastBusIds),
    isLowFloor: toLowFloor(position.busType),
    position: toPosition(tracked),
    trajectory: trajectory.length > 0 ? trajectory : null,
  };
}

// WHY: TOPIS can name a bus its position rows lack (ADR 0019, D6); it is served once, with no position, its plate and
// low-floor flag from the one row nearest ahead of it.
function toUntrackedVehicle(vehicleId: string, namedSlots: readonly TimedArrival[], lastBusIds: ReadonlySet<string>): Vehicle {
  const nearest = toNearestSlot(namedSlots, null);
  const plateNumber = nearest ? toPlateNumber(nearest.bus.plainNo) : null;
  return { id: vehicleId, plateNumber, ...toNearestFields(nearest, lastBusIds), isLowFloor: toLowFloor(nearest?.bus.busType), position: null, trajectory: null };
}

function toVehicles(reading: JongroReading, stations: readonly LiveStation[], { lastBusIds }: JongroVehicleStates): Vehicle[] {
  const slots = reading.rows.flatMap((row) => row.slots);
  const slotsOf = (vehicleId: string) => slots.filter(({ bus, arrival }) => arrival.stopsAway !== null && bus.vehId === vehicleId);
  const tracked = reading.positions.map((position) => toTrackedVehicle(position, slotsOf(position.position.vehicleId), lastBusIds));
  const trackedIds = new Set(tracked.map(({ id }) => id));
  const namedIds = new Set(stations.flatMap(({ arrivals }) => arrivals.flatMap(({ vehicleId }) => (vehicleId === null ? [] : [vehicleId]))));
  const untracked = [...namedIds].filter((vehicleId) => !trackedIds.has(vehicleId)).map((vehicleId) => toUntrackedVehicle(vehicleId, slotsOf(vehicleId), lastBusIds));
  return [...tracked, ...untracked];
}

/** WHY: a Jongno group as the live route serves it (ADR 0019), its stops named through the bus-stops aliases. */
export function toLiveJongroGroup(groupId: string, reading: JongroReading, stopIdByArsId: ReadonlyMap<string, string>): LiveGroup {
  const states = toVehicleStates(reading);
  const stations = reading.rows.map((row) => toStation(row, { route: reading.route, stopIdByArsId, states }));
  const updatedAt = toOlderInstant(reading.arrivalsCheckedAt, reading.positionsCheckedAt);
  return {
    groupId,
    stationsVersion: reading.route.stationsVersion,
    updatedAt: updatedAt === null ? null : toKstInstant(updatedAt.getTime()),
    operation: toGroupOperation(stations),
    vehicles: toVehicles(reading, stations, states),
    stations,
  };
}
