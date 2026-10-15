export class BusScheduleDroppedOverrideError extends Error {
  constructor(readonly dropped: readonly string[]) {
    super(`bus_overrides documents left out, so their days serve the pattern: ${dropped.join("; ")}`);
    this.name = "BusScheduleDroppedOverrideError";
  }
}
