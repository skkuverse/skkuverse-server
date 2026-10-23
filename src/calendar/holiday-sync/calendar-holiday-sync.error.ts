// WHY: never wraps the original error: an AxiosError carries the request URL, whose query holds the service
// key, and the poller registry logs whatever a sync rejects with. Only the source, a status and a code leave.
export class CalendarHolidaySyncError extends Error {
  readonly source = "getRestDeInfo";

  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(`getRestDeInfo: ${message}`);
    this.name = "CalendarHolidaySyncError";
  }
}
