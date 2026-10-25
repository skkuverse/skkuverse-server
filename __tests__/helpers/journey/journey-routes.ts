/**
 * Revision 1 of the `journey-routes` dataset as it is pushed (fixtures/journey-routes.dataset.json of journey,
 * without its provenance note): the two 인자셔틀 options between 인사캠 정문 and 자과캠 정문. A test that needs other
 * routes changes a copy.
 */
import fs from "fs";
import path from "path";

const FIXTURE = path.join(__dirname, "../../nest/journey/fixtures/journey-routes.dataset.json");

/** A fresh copy of revision 1 of `journey-routes`, as the push imports it. */
export function journeyRoutesFixture(): Record<string, any> {
  const data = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
  delete data._about;
  return data;
}
