export class DailyCapError extends Error {
  constructor(
    readonly provider: string,
    readonly cap: number,
  ) {
    super(`${provider}: daily cap of ${cap} calls reached`);
    // WHY: the name the poller.* lines have always carried. SEE: docs/reference/logging.md ("Pollers")
    this.name = "DailyCapError";
  }
}
