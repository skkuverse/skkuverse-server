/**
 * SubwaySeoulTrainmapClient with scripted pages, as the real client hands them
 * back (subway-seoul-trainmap.client.spec.ts covers that). A line with no
 * entry answers an empty page, which the mapper refuses; an Error in its place
 * rejects. `calls` records every line asked for, in order.
 */
import type { SubwaySeoulTrainmapClient } from "../../../../src/subway/seoul-trainmap/subway-seoul-trainmap.client";
import type { PublicOf } from "../public-of";

export class FakeSubwaySeoulTrainmapClient implements PublicOf<SubwaySeoulTrainmapClient> {
  pages = new Map<string, string | Error>();
  calls: string[] = [];

  async fetchLinePage(line: string): Promise<string> {
    this.calls.push(line);
    const page = this.pages.get(line) ?? "";
    if (page instanceof Error) throw page;
    return page;
  }
}
