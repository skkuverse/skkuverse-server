import { toKstInstant } from "../../../shared/kst-date.util";
import type { Vehicle } from "../../bus.wire";
import { HSSC_GROUP_ID, MAX_STATION_ARRIVALS } from "../bus-live.constants";
import { toGroupOperation } from "../bus-live.rules";
import type { LiveGroup, LiveStation } from "../bus-live.wire";
import { toHsscArrival, toHsscPositionStatus, toHsscTrajectory } from "./bus-live-hssc.rules";
import type { HsscLiveBus, HsscLiveReading, HsscLiveStation } from "./bus-live-hssc.types";

// WHY: the feed states no operation, so a stop with a fresh bus on the line is running (ADR 0019, D8).
function toStation({ stationIndex, stopId, etas }: HsscLiveStation): LiveStation {
  return { stationIndex, stopId, arsId: null, operation: "running", arrivals: etas.slice(0, MAX_STATION_ARRIVALS).map(toHsscArrival) };
}

// WHY: a stop-event feed has no coordinates, section or progress (capabilities.positionSource "stopEvents"), nor plates
// or vehicle types.
function toVehicle(bus: HsscLiveBus, checkedAt: Date): Vehicle {
  const [next] = bus.lapTimes;
  return {
    id: bus.anchor.vehicleId,
    ...{ plateNumber: null, occupancy: null, isLastBus: null, isLowFloor: null },
    position: {
      stationIndex: bus.stationIndex,
      status: toHsscPositionStatus(bus),
      ...{ progress: null, sectionMeters: null, coords: null },
      nextStationAt: next ? toKstInstant(next.arrivesAt.getTime()) : null,
      positionAt: toKstInstant(bus.anchor.observedAt.getTime()),
      checkedAt: toKstInstant(checkedAt.getTime()),
    },
    trajectory: toHsscTrajectory(bus),
  };
}

/** WHY: the HSSC line as the live route serves it (ADR 0019): no stations version, its stops named by bus-stops. */
export function toLiveHsscGroup({ stations, buses, checkedAt }: HsscLiveReading): LiveGroup {
  const served = stations.map(toStation);
  return {
    groupId: HSSC_GROUP_ID,
    stationsVersion: null,
    updatedAt: checkedAt === null ? null : toKstInstant(checkedAt.getTime()),
    operation: toGroupOperation(served),
    vehicles: checkedAt === null ? [] : buses.map((bus) => toVehicle(bus, checkedAt)),
    stations: served,
  };
}
