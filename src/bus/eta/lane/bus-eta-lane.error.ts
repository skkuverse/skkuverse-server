// WHY: only a failed read of the dataset counts as the corridor being unreadable; any other error is a fault in this code.
export class BusEtaLaneReadError extends Error {
  constructor(cause: unknown) {
    super(`The bus-lane-corridor dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "BusEtaLaneReadError";
  }
}
