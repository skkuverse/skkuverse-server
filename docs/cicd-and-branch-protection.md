---
title: CI and Branch Protection
type: reference
status: accepted
owner: spencer0124
last-updated: 2026-11-01
audience: public
---

# CI and Branch Protection

> What this repository's GitHub workflows run, which secrets they hold, and the rules that protect `dev` and `main`. No workflow deploys: production is deployed from `main` outside GitHub Actions.

## Summary

The repository is public. Every change reaches `main` through a pull request: work lands on `dev`, and the only pull request into `main` is `dev` → `main`, except a Dependabot security update for npm (see [Dependabot security updates](#dependabot-security-updates)). CI runs on pull requests to either branch with a read-only token and no secret, so a fork's pull request runs the same checks as a maintainer's. Two workflows hold a secret. `contracts-sync.yml` never checks out a pull request. `claude.yml` does. On a pull request, including a fork's, the action checks out the pull request's head. It restores only `.claude/`, `CLAUDE.md` and a few other agent configuration files from the base branch. Claude only answers and never pushes: it reads that code with the job's own token, which cannot push, and the workflow has no `id-token` permission, so it cannot mint the action's GitHub App token. Edits are made locally. No file tool or git form that it may use reaches `.git/`, and it may run only read-only git and `gh` commands.

## Workflows

| Workflow | Trigger | Token | Secrets | Does |
| --- | --- | --- | --- | --- |
| `ci.yml` | Pull requests to `dev` or `main` | `contents: read` | None | The job `test`: typecheck, build, contract integrity, conventions, tests, lint, knip and depcheck. The job `workflow-lint`: actionlint and zizmor over `.github/workflows/` |
| `claude.yml` | An issue or pull request comment that mentions `@claude`, from an owner, member or collaborator. Reviews and review comments start nothing | One job, `read`, in the `claude` environment: `contents: read`, `pull-requests: write`, `issues: write` and `actions: read`; Claude gets this job's own token, which cannot push. No `id-token`, so the job cannot mint the action's GitHub App token | `CLAUDE_CODE_OAUTH_TOKEN` | Answers in the pull request or issue and never edits or pushes. `@claude edit` is not a mode: such a comment is answered read-only like any other |
| `contracts-sync.yml` | Daily at 06:00 KST, or by hand | `contents: write`, `pull-requests: write` | `UMBRELLA_DEPLOY_KEY`, `UMBRELLA_REPOSITORY`, `FLEET_READ_TOKEN`, in the `contracts-sync` environment | Compares the vendored contract files with their producers' `main`. When they drift, it checks the pulled files and opens or updates one pull request into `dev` |
| `scorecard.yml` | Pushes to `main`, weekly on Sunday at 07:17 KST, or by hand | One job, `analysis`: `security-events: write` and `contents: read`. No `id-token` | None | Runs the [OpenSSF Scorecard](https://github.com/ossf/scorecard-action) container image, pinned by digest, on the repository and uploads the result to code scanning, so it shows under the Security tab. `INPUT_PUBLISH_RESULTS` is `false`, so nothing is published outside the repository |

Every workflow sets an empty or read-only token at the top and grants more only on the job that needs it. Only `contracts-sync.yml` grants `contents: write`, and only `scorecard.yml` grants `security-events: write`. No workflow uses `pull_request_target`. No `run:` script contains a `${{ }}` expression: an event field, a branch name or a step output reaches a script only through `env:`. Nothing under `.github/` names a private repository. Every action is pinned to a commit SHA with its version as a trailing comment, and Dependabot proposes new pins once a month. For npm it opens security updates only. Two things are pinned by checksum instead, and Dependabot tracks neither. The first is the two linters that `workflow-lint` downloads, pinned by version and the sha256 of the release archive. The second is the Scorecard image, which `scorecard.yml` runs as a `docker://` step pinned by its sha256 digest, with its version as a trailing comment. The Scorecard action is not used, because its `action.yaml` names the image by tag, so a commit pin on the action would leave the image unpinned. To bump the image, read the digest of the new release tag from the `ghcr.io` manifest, check that the image's `org.opencontainers.image.revision` label is the release commit, and change the digest and the version comment together. `__tests__/nest/infra/workflow-secrets.test.ts` and `workflow-pins.test.ts` check these rules.

## Secrets

| Secret | Where | Read by | Why it is safe on a public repository |
| --- | --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Environment `claude`, whose deployment branch policy admits only `main` | `claude.yml` | The `read` job's `if` requires `author_association` `OWNER`, `MEMBER` or `COLLABORATOR`, and no other job exists, so an outsider's `@claude` starts nothing. An issue comment runs in this repository's context even on a fork's pull request, which is why the check sits on a job, not on a step. An issue comment runs on the default branch, which the environment admits; a workflow run on any other ref cannot read the token, so the workflow listens to no review event. Subprocesses run with `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, so a command Claude runs does not inherit the action's credentials |
| `UMBRELLA_DEPLOY_KEY` | `contracts-sync` environment | `contracts-sync.yml` | A read-only deploy key for the private repository that owns the contracts. The workflow runs on a schedule or by hand, so always on the default branch, never for a pull request |
| `UMBRELLA_REPOSITORY` | `contracts-sync` environment | `contracts-sync.yml` | The `owner/name` of that repository. It is a secret, not a variable, so the log masks it |
| `FLEET_READ_TOKEN` | `contracts-sync` environment | `contracts-sync.yml` | A fine-grained token with `contents: read` on the repositories that produce the vendored files, and on nothing else. Same trigger as above |

The `contracts-sync` environment limits deployments to the default branch, so a workflow on any other branch cannot read its secrets. The three secrets exist only there, with no repository-level copy. No secret exists for `ci.yml`. A pull request from Dependabot or a fork gets no secret.

## CI

`ci.yml` runs on every pull request to `dev` or `main`, so a regression shows on the change that causes it, not only on the release. It needs the full history (`fetch-depth: 0`): the architecture tests compare the allowlists, exemptions and ratchets with the pull request's base.

The contract check and the conventions check run tools vendored under `.github/contract-tools/`: the contract checker, the conventions linter and this repository's slice of the contract manifest. They are hash-locked in `.contracts.lock.json` like every other vendored file, so CI clones nothing. `contracts-sync.yml` refreshes them with the rest.

| Failure | Where to look |
| --- | --- |
| Typecheck, lint, tests | The same commands locally: `npm run typecheck`, `npm run lint`, `npm test` |
| Workflow lint | `actionlint` and `zizmor --offline .github/workflows/` from the repository root, at the versions `ci.yml` pins. Each finding names the file, the line and the rule |
| Contract integrity | `python3 .github/contract-tools/exported/sync_contracts.py check --repo server --root .` prints the file and both hashes. Do not hand-edit a vendored file: its owner changes it, and the sync pull request brings it here. The vendored checker only checks. `pull`, which rewrites the lock, runs in the maintainers' umbrella repository or in `contracts-sync.yml` |
| Conventions | `python3 .github/contract-tools/exported/lint_conventions.py --root . --only frontmatter --only structure` |
| knip, depcheck | `npm run knip`, `npm run depcheck` |

The `workflow-lint` job runs [actionlint](https://github.com/rhysd/actionlint) and [zizmor](https://docs.zizmor.sh/) over `.github/workflows/`. It downloads each release archive at a pinned version and checks its sha256 before it unpacks the archive. `zizmor --offline` skips the audits that call the GitHub API, so the job needs no token. A finding fails the job. A deliberate pattern is suppressed in place with `# zizmor: ignore[<rule>]` on the line the finding names, under a `WHY:` comment that gives the reason. A bump changes `<TOOL>_VERSION` and `<TOOL>_SHA256` together in `ci.yml`, with the checksum taken from the release page and confirmed against a download.

A pull request from a fork waits for a maintainer to approve its workflow runs. A pull request opened by `contracts-sync.yml` uses the workflow's own token, which starts no other workflow. The sync job runs the contract check on the pulled files before it opens the pull request, but the rest of CI does not run: close and reopen the pull request, or push to it, to run CI.

## Branch protection

| Rule | `main` | `dev` |
| --- | --- | --- |
| Pull request required | Yes | No |
| Merge method | Merge commit only | — |
| Required status checks | `test` and `workflow-lint` (from `ci.yml`) | — |
| Force push | Blocked | Blocked |
| Deletion | Blocked | Blocked |

Merge `dev` → `main` with a merge commit, never a squash, so `dev` and `main` keep one history.

Pull requests from outside contributors are by invitation ([CONTRIBUTING.md](../CONTRIBUTING.md)); `.github/CODEOWNERS` names the owner for every path.

### Dependabot security updates

Dependabot security updates always use the repository's default branch, which is `main`, and `target-branch` does not change that. `.github/dependabot.yml` therefore sets no `target-branch` for npm, and a security pull request for npm opens against `main`. Merge it by hand once `test` and `workflow-lint` pass, and never enable auto-merge. If it is a major version bump, close it: major upgrades are planned separately. Right after the merge, merge `main` back into `dev`, or the next `dev` → `main` pull request conflicts in `package-lock.json`. npm version updates stay off because dependencies are bumped one package per change by hand. The `nestjs` group keeps the `@nestjs/*` packages in one pull request, because they must move together.

## Related

- [docs/README.md](README.md): writing rules and the docs index
- [CONTRIBUTING.md](../CONTRIBUTING.md) and [SECURITY.md](../SECURITY.md)
