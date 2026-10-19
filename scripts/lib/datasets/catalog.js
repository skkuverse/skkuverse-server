/**
 * The datasets `npm run data` knows, and the server code that validates each
 * one (openspec/changes/move-runtime-data-to-db, design D1 and D6).
 *
 * `loadCatalog(load)` takes a loader of server modules by their path under
 * src/, without an extension: scripts/data.js passes one that requires the
 * compiled dist/src/<path>.js, and the tests pass one that requires src/<path>
 * through ts-jest. So the catalog the tests cover is the catalog the tool runs,
 * and the tool validates with the very schema and rules the server parses with.
 *
 * Nothing loaded here may import src/infra/config.ts: it exits on a missing
 * value and picks `_dev` from NODE_ENV, while the tool picks its database from
 * `--prod`. __tests__/nest/infra/data-tool-catalog.test.ts pins that.
 *
 * A dataset entry:
 *
 *   owner            the src/ folder that reads it
 *   schema           the zod schema the server's repository parses `data` with
 *   issuesOf(data)   checks a schema cannot hold, as { path, message }
 *   referencesOf(data)
 *                    every identity the data names, as { dataset, id, path };
 *                    `dataset` is another catalog dataset or a code-held source
 *   idsOf(data)      the identities others may reference (none in this stage)
 *
 * `issuesOf`, `referencesOf` and `idsOf` take the schema's parsed output.
 *
 * A code-held source is an identity list that still lives in code, resolved
 * against the compiled checkout: `has(id)`.
 */

function loadCatalog(load) {
  const { homeLayoutFile } = load("ui/home/ui-home.schema");
  const { homeLayoutReferences, toHomeLayoutIssues } = load("ui/home/ui-home.rules");
  const { MiniappsService } = load("miniapps/miniapps.service");

  // No constructor dependencies: the registry is read from the committed files at import.
  const miniapps = new MiniappsService();

  return {
    sources: {
      miniapps: { owner: "src/miniapps", has: (id) => miniapps.isRegistered(id) },
    },
    datasets: {
      "home-layout": {
        owner: "src/ui/home",
        schema: homeLayoutFile,
        issuesOf: (layout) => toHomeLayoutIssues(layout, miniapps),
        referencesOf: (layout) => homeLayoutReferences(layout, miniapps),
      },
    },
  };
}

module.exports = { loadCatalog };
