import fs from "fs";
import path from "path";
import { parseConfigFile } from "../../infra/config-file";
import { placeLexiconFile, type PlaceLexicon } from "./building-place.schema";

const LEXICON_FILE = "place-lexicon.json";

// WHY: code, not a dataset (ADR 0013, D2): the resolver decides by these names and patterns, and
// the labelled set in building-place-resolve.rules.spec.ts gates every change to them.
// SEE: docs/explanation/building-architecture.md ("Invariants")
export const placeLexicon: Readonly<PlaceLexicon> = Object.freeze(
  parseConfigFile(LEXICON_FILE, placeLexiconFile, JSON.parse(fs.readFileSync(path.join(__dirname, LEXICON_FILE), "utf8"))),
);
