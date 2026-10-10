---
paths:
  - "src/**/*.ts"
---

# Naming

A name is how a reader, or an agent, finds code and understands it without a comment (ADR 0010, D4 and D10). Rules a test can check are tests; this file holds the rest.

## Checked by tests (not restated here)

| Rule | Test in `__tests__/architecture/` |
| --- | --- |
| File = `<meaning>.<role>.ts` from the closed role list, kebab-case | `naming.test.ts` |
| Class = PascalCase(file base) + Role; a role file's main export is named after the file | `naming.test.ts` |
| Exported types only in `.types`, `.document`, `.schema`; type files hold no runtime code | `naming.test.ts` |
| A brand type is cast only in `.client`, `.schema`, `.rules` and specs | `naming.test.ts` |
| Repository and client verbs, and `.rules`/`.mapper` predicates, match the declared return type | `method-verbs.test.ts` |
| No `// --- X ---` section dividers | `section-comments.test.ts` |
| Top-level `src/` folders are shared roles or feature modules | `folders.test.ts` |
| One file per role in a module folder, named after the folder's module (`building-sync.*` in `sync/`) | `folders.test.ts` |

## Picking a name

Asked to name the same thing, two developers pick the same name about 7% of the time. Naming in three explicit steps produced names judged better two to one (Feitelson et al., IEEE TSE 2022). So:

1. **Concepts.** What must a reader know that the type does not say: what it is, its unit, its scope (one or many, raw or derived)?
2. **Words.** Take each concept's word from the glossary below or from the module's existing names. Do not coin a synonym. Use whole words.
3. **Shape.** Assemble them with the shapes below.

## Shapes

| Kind | Shape | Yes | No |
| --- | --- | --- | --- |
| Boolean | `is`/`has`/`can`/`needs`/`should` + … | `needsEnrichment`, `isDrawableGeometry` | `syncFailed` for a function that builds an error |
| Collection | plural noun | `buildings`, `campusSpaces` | `docs`, `items`, `list` |
| Lookup map | `<value>By<key>` | `skkuIdByBuildNo` | `map`, `lookup` |
| Count | `<singular>Count` | `spaceCount` | `spacesCount`, `numSpaces` |
| Instant | `<event>At` (a `Date`) | `syncStartedAt`, `skkuUpdatedAt` | `syncTime` |
| Duration, size | unit suffix | `CACHE_TTL_MS`, `REQUEST_TIMEOUT_MS` | `TIMEOUT` |
| Limit | `MAX_`/`MIN_` + what it guards | `MIN_BUILDINGS_TO_TRUST` | `MIN_BUILDINGS` |
| Conversion | `to<Target>` | `toBuildingSearch`, `toSyncError` | `make`, `build` |
| Adds a field | `with<Field>` | `withCampusLabel` | |
| Constant | what it is | `CAMPUS_MAP_URL` | `SKKU_API` |

## Words

- A name says only what is true: nothing called `All` filters (`listBuildings(campus?)`, not `getAllBuildings`).
- `data`, `info`, `item`, `result`, `value`, `obj`, `tmp`, `helper`, `manager` never stand alone. Add the domain noun: `upsertResult`, `campusSpaces`.
- Abbreviations: `id`, `url`, `ms`, `db`, `api`, and an upstream's own field names (`spaceCd`, `buildNo`). Nothing else.
- A one-letter name only inside a callback of three lines or fewer: `(b) => b.campus`.
- A comment that says *what* becomes a name. Comments keep the *why*: external quirks, incidents, constraints.

| The comment explained | It becomes |
| --- | --- |
| What a block does | A function named for it |
| What a value means | A constant |
| A compound condition | An `is…` function or a named boolean |
| A heading over part of a file | Its own file (`building-sync.mapper.ts`) |

## Glossary

One concept, one name (ADR 0010, D1). A module adds its section when it is migrated.

### building

| Term | Meaning | Not |
| --- | --- | --- |
| `skkuId` (`SkkuId`) | SKKU's building id; `_id` in `buildings` and `buildings_raw` | `id`, `buildingId` |
| `apiId` (`ApiId`) | The same id exactly as buildList sent it; buildInfo takes it back verbatim | |
| `buildNo` (`BuildNo`) | SKKU's building number (`"227"`); a facility has none | `buildingNo` |
| `displayNo` (`DisplayNo`) | The number users see, derived by `toDisplayNo` | |
| `spaceCd` (`SpaceCd`) | A room code | `roomId` |
| space | A room or area inside a building | room |
| buildList, buildInfo, spaceList | The three campusMap.do calls, and the sync phases named after them | |
| raw, enriched | `buildings_raw` holds SKKU's data as sent; `buildings` holds it parsed and served | |
| `EnrichedBuilding` | What `enrichBuilding` derives from a raw building; the sync repository writes it field by field | enrichment fields, `$set` |
| tier, band | A ranking tier scores one kind of match; the strong and weak bands split results at `*_STRONG_MIN_SCORE` | level, bucket |
| ranked result | Rows plus the campus counts the same predicate produced (`RankedSearchResult`) | search data |
| campus shape | A `campus_shapes` document: an authored footprint, boundary or path | geometry doc |
