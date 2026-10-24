/**
 * `facilities` documents as skkuverse-crawler writes them
 * (fixtures/skkumap-facilities.json of building), unparsed, so a test reads
 * what the crawler wrote rather than a shape built from the server's own type.
 */
import fs from "fs";
import path from "path";

const FIXTURE = path.join(__dirname, "../../nest/building/fixtures/skkumap-facilities.json");

interface SkkumapFacilitiesFile {
  cafeterias: Array<Record<string, unknown>>;
  facility: Record<string, unknown>;
}

/** Three cafeterias (10201030, 20201040 with no spaceCd, 20201251 with no location) and one other facility, fresh copies. */
export function storedFacilities(): SkkumapFacilitiesFile {
  return JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as SkkumapFacilitiesFile;
}
