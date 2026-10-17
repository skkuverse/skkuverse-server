import { Injectable } from "@nestjs/common";
import type { CountdownRow } from "../subway.types";
import { toFirstPublishedRows } from "./subway-countdown.rules";

// WHY: the poller process remembers the last rows it estimated from, so a countdown republished unchanged keeps
// its first publication; a restart counts each countdown from its next row.
@Injectable()
export class SubwayCountdownService {
  private firstPublishedRows: readonly CountdownRow[] = [];

  listFirstPublishedRows(rows: readonly CountdownRow[]): CountdownRow[] {
    this.firstPublishedRows = toFirstPublishedRows(this.firstPublishedRows, rows);
    return [...this.firstPublishedRows];
  }
}
