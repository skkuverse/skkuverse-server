import fs from "fs";
import path from "path";
import type { z } from "zod";
import { parseConfigFile } from "../infra/config-file";
import { FIRST_PARTY_MINIAPP_ORIGINS, WEB_ORIGIN } from "../infra/origins";
import { isRecord } from "../shared/object.util";
import { SHELL_BARS, SHELL_HEADERS, SHELL_STATUS_BARS } from "./miniapps.constants";
import { toIndexEntry } from "./miniapps.mapper";
import { registryFile, type MiniAppDetailRaw, type RegistryFile } from "./miniapps.schema";
import type { LoadedRegistry } from "./miniapps.types";

type Issue = z.core.$ZodRawIssue;
type Words = (id: string, issue: Issue) => string | undefined;

const LABEL = "miniapp registry";

const firstKey = (issue: Issue): string => (issue.code === "unrecognized_keys" ? String(issue.keys[0]) : "");

const SHELL_VALUES: Readonly<Record<string, readonly string[]>> = {
  bar: SHELL_BARS,
  header: SHELL_HEADERS,
  statusBar: SHELL_STATUS_BARS,
};

const ENTRY_WORDS: Readonly<Record<string, Words>> = {
  "": (id, issue) => `unknown index key "${firstKey(issue)}" in "${id}"`,
  id: (_id, issue) => `invalid id slug "${String(issue.input)}"`,
  hidden: (id) => `hidden for "${id}" must be a boolean`,
};

const LOGO_PART_WORDS: Readonly<Record<string, (field: string, id: string) => string>> = {
  url: (field, id) => `${field}.url for "${id}" must be an object on the media bucket`,
  emoji: (field, id) => `${field}.emoji for "${id}" must be exactly one emoji`,
};

const DETAIL_WORDS: Readonly<Record<string, Words>> = {
  "": (id, issue) => `unknown detail key "${firstKey(issue)}" in "${id}"`,
  startUrl: (id, issue) =>
    issue.code === "custom"
      ? `startUrl for "${id}" must address a page on the web view — no fragment, not the root`
      : `bad startUrl for "${id}"`,
  relatedLinks: (id, issue) =>
    issue.code === "unrecognized_keys" ? `unknown relatedLinks key "${firstKey(issue)}" in "${id}"` : `bad relatedLinks url in "${id}"`,
  noticeBanner: (id, issue) => (issue.code === "unrecognized_keys" ? `unknown noticeBanner key "${firstKey(issue)}" in "${id}"` : undefined),
};

function logoWords({ id, field, part }: { id: string; field: string; part: PropertyKey | undefined }, issue: Issue): string {
  const partWords = LOGO_PART_WORDS[String(part)];
  if (partWords) return partWords(field, id);
  if (part === undefined && issue.code === "invalid_type") return `${field} for "${id}" must be an object`;
  return `${field} for "${id}" must be a site-root-relative path, a media-bucket url, or one emoji`;
}

function shellWords(id: string, [key]: readonly PropertyKey[], issue: Issue): string {
  if (key === undefined && issue.code === "unrecognized_keys") return `unknown shell key "${firstKey(issue)}" in "${id}"`;
  if (key === undefined) return `shell for "${id}" must be an object`;
  const values = SHELL_VALUES[String(key)];
  if (values) return `shell.${String(key)} for "${id}" must be one of ${values.join(", ")}`;
  return `shell.background for "${id}" must be a #RRGGBB string`;
}

function entryIdAt(raw: unknown, position: PropertyKey | undefined): string {
  const entries = isRecord(raw) && isRecord(raw.index) ? raw.index.miniApps : undefined;
  const entry: unknown = Array.isArray(entries) ? entries[Number(position)] : undefined;
  return isRecord(entry) ? String(entry.id) : String(position);
}

function entryWords(raw: unknown, [position, field = "", ...parts]: readonly PropertyKey[], issue: Issue): string | undefined {
  const id = entryIdAt(raw, position);
  if (field === "homeLogo" || field === "shellLogo") return logoWords({ id, field, part: parts[0] }, issue);
  return ENTRY_WORDS[String(field)]?.(id, issue);
}

function detailWords([id, field = "", ...parts]: readonly PropertyKey[], issue: Issue): string | undefined {
  if (field === "shell") return shellWords(String(id), parts, issue);
  return DETAIL_WORDS[String(field)]?.(String(id), issue);
}

// WHY: each refusal names the entry by its id, not its position, so a boot failure says which mini app broke.
export function toRegistryWords(raw: unknown): (issue: Issue) => string | undefined {
  return (issue) => {
    const [file, list, ...rest] = issue.path ?? [];
    if (file === "index" && list === "miniApps" && rest.length > 0) return entryWords(raw, rest, issue);
    if (file === "details" && list !== undefined) return detailWords([list, ...rest], issue);
    return undefined;
  };
}

function crossReferenceIssues({ index, details }: RegistryFile): string[] {
  const ids = index.miniApps.map((entry) => entry.id);
  const detailIds = Object.keys(details);
  const mismatched = Object.entries(details).filter(([id, detail]) => detail.id !== id);
  return [
    ...(new Set(ids).size !== ids.length ? ["duplicate ids in index"] : []),
    ...ids.filter((id) => !detailIds.includes(id)).map((id) => `index id "${id}" has no detail`),
    ...mismatched.map(([id, detail]) => `detail.id "${detail.id}" != index id "${id}"`),
    ...detailIds.filter((id) => !ids.includes(id)).map((id) => `detail "${id}" not present in index`),
  ];
}

export function loadRegistry(index: unknown, details: Readonly<Record<string, unknown>>): Readonly<RegistryFile> {
  const schema = registryFile.superRefine((file, ctx) => {
    for (const message of crossReferenceIssues(file)) ctx.addIssue({ code: "custom", path: [], message });
  });
  const raw = { index, details };
  return parseConfigFile({ label: LABEL, error: toRegistryWords(raw) }, schema, raw);
}

function ownerOf(details: readonly MiniAppDetailRaw[], origin: string): string {
  const owners = details.filter((detail) => new URL(detail.startUrl).origin === origin);
  const [owner] = owners;
  if (owners.length !== 1 || !owner) {
    throw new Error(`${LABEL}: first-party origin ${origin} must be the startUrl origin of exactly one mini app, found ${owners.length}`);
  }
  return owner.id;
}

// WHY: one owner per first-party origin, or a URL there opens in no mini app's shell, or in two.
function toFirstPartyOrigins(details: readonly MiniAppDetailRaw[], origins: readonly string[]): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(origins.map((origin) => [origin, ownerOf(details, origin)])));
}

export function toLoadedRegistry({ index, details }: RegistryFile, firstPartyOrigins: readonly string[]): LoadedRegistry {
  const detailsById = new Map(Object.entries(details).map(([id, detail]) => [id, Object.freeze(detail)]));
  const indexEntries = [...index.miniApps].sort((a, b) => a.order - b.order).map((entry) => toIndexEntry(entry, WEB_ORIGIN));
  const ownerByOrigin = toFirstPartyOrigins([...detailsById.values()], firstPartyOrigins);
  return { version: index.version, indexEntries: Object.freeze(indexEntries), detailsById, firstPartyOrigins: ownerByOrigin };
}

// WHY: read next to the compiled file at runtime; scripts/copy-build-assets.js stages each JSON file into dist/.
function readJson(...segments: string[]): unknown {
  return JSON.parse(fs.readFileSync(path.join(__dirname, ...segments), "utf8"));
}

function indexIdsOf(index: unknown): string[] {
  const entries: unknown[] = isRecord(index) && Array.isArray(index.miniApps) ? index.miniApps : [];
  return entries.flatMap((entry) => (isRecord(entry) && typeof entry.id === "string" ? [entry.id] : []));
}

function readRegistry(): LoadedRegistry {
  const index = readJson("index.json");
  const details = Object.fromEntries(indexIdsOf(index).map((id) => [id, readJson("details", `${id}.json`)]));
  return toLoadedRegistry(loadRegistry(index, details), FIRST_PARTY_MINIAPP_ORIGINS);
}

export const registry: Readonly<LoadedRegistry> = Object.freeze(readRegistry());
