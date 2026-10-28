import fs from "fs";
import path from "path";
import { parseConfigFile } from "../../infra/config-file";
import { placeLexiconFile, type PlaceLexicon } from "./building-place.schema";

const LEXICON_FILE = "place-lexicon.json";

// WHY: code, not a dataset (ADR 0013, D2): a facility slug is an identity that stored notices name.
// SEE: docs/explanation/building-architecture.md ("Invariants")
export const placeLexicon: Readonly<PlaceLexicon> = Object.freeze(
  parseConfigFile(LEXICON_FILE, placeLexiconFile, JSON.parse(fs.readFileSync(path.join(__dirname, LEXICON_FILE), "utf8"))),
);
