---
title: Edit Runtime Data
type: how-to
status: draft
owner: zoyoong124@gmail.com
last-updated: 2026-10-19
audience: internal
---

# Edit Runtime Data

> How to read and change a dataset in the content database with `npm run data`: pull, edit, push, history, rollback, copying production into `_dev`, and the `check` to run before a deploy that changes a dataset's schema or removes an identity a dataset names.

## Overview

Runtime data the server serves lives in MongoDB as datasets ([ADR 0013](../decisions/0013-runtime-data-in-mongodb.md)). Each dataset is one document in the content database's `datasets` collection, with a revision that only moves forward; every version stored is kept in `dataset_revisions`, the newest 50 per dataset. `npm run data` is the only writer, and the server only reads. The datasets the tool knows, and the server code that validates each one, are listed in `scripts/lib/datasets/catalog.js`; `home-layout` is the first.

Every push is validated with the server's own schema and rules, compiled from your checkout, and checked for references: a home layout tile that names a mini app the registry does not have is refused, naming the tile's path. Nothing is written while any issue stands.

| Target | Database | How |
| --- | --- | --- |
| Development (default) | `$MONGO_CONTENT_DB_NAME` plus `_dev` | no flag |
| Production | `$MONGO_CONTENT_DB_NAME` | `--prod` |

The tool prints the database name first on every run. The `_dev` database lives on the production cluster, so it is real data too, but nothing user-facing reads it.

## Prerequisites

- A `.env` with `MONGO_URL` and `MONGO_CONTENT_DB_NAME`: `npm run env:pull` renders it from Doppler `backend/dev_server`.
- `git config user.email` set, or `--by <email>` on every write: it is stored as the author of the revision.
- A checkout of the code you mean to validate against. `npm run data` runs `npm run build` first and loads the schemas from `dist/src`, so the build output is always this checkout's.

> [!WARNING]
> Never print, paste or share `MONGO_URL`, in a terminal log, an issue or a chat. The tool itself prints database names only, and removes the URL's credentials and hosts from every line, error messages included. Keep it that way when you report a failure: copy the tool's output, not your `.env`.

## Steps

### Edit a dataset

1. Pull it. This writes `.data/dev/<dataset>.json` (git-ignored) holding the data and the revision you pulled:

   ```bash
   npm run data -- pull home-layout
   ```

2. Edit the `data` field of that file. Leave `dataset`, `target` and `baseRevision` alone.
3. Preview the change. `--dry-run` prints the target and a diff of every changed path, and writes nothing:

   ```bash
   npm run data -- push home-layout --dry-run
   ```

4. Push it, with a note saying why:

   ```bash
   npm run data -- push home-layout --note "add the library tile"
   ```

   The push stores the next revision, prints it, and moves the working file's `baseRevision` to it, so you can keep editing the same file. A file whose data equals the stored revision reports "no change" and writes nothing.

Every api replica that serves the dataset reads the new revision within 60 seconds, with no restart and no deploy.

### Edit production

Production has its own working file, `.data/prod/<dataset>.json`, and a file is only ever pushed to the database it was pulled from:

```bash
npm run data -- pull home-layout --prod
# edit .data/prod/home-layout.json
npm run data -- push home-layout --prod --note "add the library tile"
```

The push prints the diff and asks you to type `y`. Anything else writes nothing. A run without a terminal (a script, CI) writes nothing to production unless it passes `--yes`, which skips the question; use it only where the diff is printed to someone who will read it.

To try an edit on `_dev` first, make it there, then pull production and make the same edit to the production file. No command copies `_dev` data into production.

### Create a dataset

A dataset that is not stored yet is created from a plain JSON file holding the data itself (no working-file wrapper), as revision 1:

```bash
npm run data -- push home-layout --create --file path/to/home-layout.json --note "import from <commit>"
```

`--create` refuses a dataset that already exists, and a push without it refuses one that does not.

### Read the history

```bash
npm run data -- history home-layout
npm run data -- history home-layout --prod --limit 10
```

It lists revisions newest first, each with its time, author, command (`create`, `push`, `rollback to <n>`, `copy-prod-to-dev from <database>@<n>`) and note, and marks the current one.

### Roll back

A rollback stores an earlier revision's data as a new revision; history is never rewritten:

```bash
npm run data -- rollback home-layout <revision> --prod
```

It runs the same checks as a push, so a revision the current code no longer accepts, or one that names a mini app since removed, is refused with the issues listed. Only the newest 50 revisions are kept; a rollback to an older one is refused, naming the oldest kept.

### Refresh `_dev` from production

```bash
npm run data -- copy-prod-to-dev home-layout
```

It stores production's current data as the next `_dev` revision and records which production revision it copied. Pull `_dev` again afterwards: a working file pulled before the copy is now stale.

### Check before a deploy

The server reads datasets the code may no longer accept. A deploy restarts every replica with an empty cache, so a stored home layout the new schema rejects answers 503 on `/ui/home` until a valid push, and a removed mini app loses every tile that names it. Before merging a change that tightens a dataset's schema or rules, or removes an identity a dataset references (a mini app from the registry), run from that change's checkout:

```bash
npm run data -- check --prod
```

It runs the push checks on the stored data of every dataset, writes nothing, and exits non-zero on any issue. `check <dataset>` checks one. Fix the data first (pull, edit, push), then merge.

## Troubleshooting

| Message | Meaning | What to do |
| --- | --- | --- |
| `CONFLICT: <dataset> is at revision <n>, stored by <who> at <time>` | Someone pushed since you pulled. Nothing was written. | Pull again, redo your edit on the new file, push. |
| `REFUSED: <n> issue(s), nothing written`, one line per `<dataset> <path> <message>` | The data fails the schema, a rule, or a reference. | Fix each path. An unknown key such as `actoinType` is a typo; `"<id>" is not a registered mini app` names the registry. |
| `... was pulled from the development database, so it cannot be pushed to <prod>` | You pushed a `_dev` working file with `--prod`. | `pull --prod` and redo the edit on `.data/prod/`. |
| `refusing to write ... (PRODUCTION) without a confirmation` | A production write with no terminal and no `--yes`. | Run it in a terminal, or pass `--yes` where the diff is reviewed. |
| `dist/src is missing: run npm run build first` | You ran `node scripts/data.js` without a build. | Use `npm run data`, which builds first. |
| `repaired: ... had no history entry` | A push stopped between storing the dataset and recording its history. The tool recorded the entry. | Nothing. `check` and `--dry-run` only report it as a `note:`. |
| `MongoServerSelectionError: ...` with `<redacted>` in it | The database could not be reached; the host is hidden on purpose. | Check your network and `.env`, without printing them. |

## Related

- [ADR 0013](../decisions/0013-runtime-data-in-mongodb.md): why runtime data lives in MongoDB, and the read contract every dataset reader keeps
- [configure-home.md](configure-home.md): what the home layout holds
- [register-a-miniapp.md](register-a-miniapp.md): the registry a home layout's references resolve against
- `scripts/data.js`: the command line; `scripts/lib/datasets/`: the catalog, checks, store and working file
- [docs/README.md](../README.md): writing rules
