// WHY: a source with nothing usable for a query (no stored state, a line that does not call at the stops) is no
// empty board, which means no service in the window; a planner reports it as unavailable.
export class DepartureUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepartureUnavailableError";
  }
}
