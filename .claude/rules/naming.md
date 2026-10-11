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
| Exported types only in `.types`, `.document`, `.schema`, `.wire`; type files hold no runtime code | `naming.test.ts` |
| A brand is minted only by its one `is<Brand>`/`to<Brand>` in the declaring folder's `.rules`; casts only there or in specs | `naming.test.ts` |
| Repository and client verbs, and `.rules`/`.mapper` predicates, match the declared return type | `method-verbs.test.ts` |
| No `// --- X ---` section dividers | `section-comments.test.ts` |
| Top-level `src/` folders are shared roles or feature modules | `folders.test.ts` |
| One file per role in a module folder, named after the folder's module (`building-sync.*` in `sync/`) | `folders.test.ts` |
| A module with a sub-module keeps no controller or poller at its root | `folders.test.ts` |

## Picking a name

Asked to name the same thing, two developers pick the same name about 7% of the time. Naming in three explicit steps produced names judged better two to one (Feitelson et al., IEEE TSE 2022). So:

1. **Concepts.** What must a reader know that the type does not say: what it is, its unit, its scope (one or many, raw or derived)?
2. **Words.** Take each concept's word from the module's glossary (its architecture doc), the shared terms below, or the module's existing names. Do not coin a synonym. Use whole words.
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
- A comment that says *what* becomes a name. When a comment is allowed at all, and how long it may be, is ADR 0010 D10: only what the code cannot carry, opening with a tag (`WHY:`, `QUIRK(<system>):`, `CONTRACT(<repo>):`, `EVIDENCE:`, `SEE: docs/…`; `comment-tags`), at most three lines.

| The comment explained | It becomes |
| --- | --- |
| What a block does | A function named for it |
| What a value means | A constant |
| A compound condition | An `is…` function or a named boolean |
| A heading over part of a file | Its own file (`building-sync.mapper.ts`) |

## Glossary

One concept, one name (ADR 0010, D1). Each migrated module's glossary is the Glossary of its `docs/explanation/<module>-architecture.md`, whose Not column is an ESLint `id-denylist` block (`glossary/<module>` in `eslint.config.js`); `.claude/rules/<module>.md` loads it. This file keeps only the terms every module shares.

### Every module

| Term | Meaning | Not |
| --- | --- | --- |
| wire | A shape a deployable of this repository writes to another repository (a response body, a push payload); its zod schema is in `<base>.wire.ts`, its type the `z.input` of that schema | `contract` (the `CONTRACT(<repo>):` tag, the umbrella's contracts), `dto` |
