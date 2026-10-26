/** WHY: a ride's stops between its board and alight, never either end; `isCalledAt` leaves out one its runs pass without stopping. */
export function toStopsBetween<T>(stops: readonly T[], { boardIndex, alightIndex }: { boardIndex: number; alightIndex: number }, isCalledAt: (stop: T) => boolean = () => true): T[] {
  return stops.slice(boardIndex + 1, alightIndex).filter(isCalledAt);
}
