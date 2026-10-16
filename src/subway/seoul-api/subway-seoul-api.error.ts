// WHY: never wraps the original error: the key sits in the request path, and an AxiosError carries the URL in
// its config and request, which the poller registry would log. Only the source, a status and a code leave.
export class SubwaySeoulApiError extends Error {
  readonly source = "seoul-subway-api";

  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(`seoul-subway-api: ${message}`);
    this.name = "SubwaySeoulApiError";
  }
}
