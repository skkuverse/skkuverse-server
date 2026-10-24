import type { TrainArrival } from "../estimate/subway-estimate.types";
import type { StoredTrainArrival, SubwayArrivalsDoc } from "../subway.document";
import type { SubwayDirection } from "../subway.types";

function toStoredArrival({ trainNo, destination, express, arrivalAt, source, position, isFirstTrain }: TrainArrival): StoredTrainArrival {
  const storedPosition = position && { stationId: position.platformId, state: position.state };
  return { trainNo, destination, express, arrivalAt, source, isFirstTrain, position: storedPosition };
}

export function toArrivalsDoc(
  stamp: Pick<SubwayArrivalsDoc, "_id" | "generatedAt" | "serviceDate">,
  arrivalsByDirection: Readonly<Record<SubwayDirection, readonly TrainArrival[]>>,
): SubwayArrivalsDoc {
  const { up, down } = arrivalsByDirection;
  return { ...stamp, directions: { up: up.map(toStoredArrival), down: down.map(toStoredArrival) } };
}
