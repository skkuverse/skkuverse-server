import type { StoredTrainArrival, SubwayArrivalsDoc } from "../subway.document";
import type { SubwayDirection } from "../subway.types";
import type { DocumentedArrival } from "./subway-tracking.types";

function toStoredArrival({ arrival, passedPlatformIds }: DocumentedArrival): StoredTrainArrival {
  const { trainNo, destination, express, arrivalAt, source, position, isFirstTrain, isLastRun, scheduledArrivalAt, scheduledDepartureAt } = arrival;
  const storedPosition = position && { stationId: position.platformId, state: position.state };
  const passed = passedPlatformIds.length > 0 ? { passedPlatformIds } : {};
  return { trainNo, destination, express, arrivalAt, source, isFirstTrain, position: storedPosition, isLastRun, scheduledArrivalAt, scheduledDepartureAt, ...passed };
}

export function toArrivalsDoc(
  stamp: Pick<SubwayArrivalsDoc, "_id" | "generatedAt" | "serviceDate">,
  arrivalsByDirection: Readonly<Record<SubwayDirection, readonly DocumentedArrival[]>>,
): SubwayArrivalsDoc {
  const { up, down } = arrivalsByDirection;
  return { ...stamp, directions: { up: up.map(toStoredArrival), down: down.map(toStoredArrival) } };
}
