// WHY: never wraps the original error, as the Seoul API's does not: only the source, a status and a code
// leave, so a failing crawl reads the same in the poller registry's log.
export class SubwaySeoulTrainmapError extends Error {
  readonly source = "seoul-trainmap";

  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(`seoul-trainmap: ${message}`);
    this.name = "SubwaySeoulTrainmapError";
  }
}
