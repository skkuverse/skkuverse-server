---
title: CI and Branch Protection
type: reference
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-29
audience: public
---

# CI and Branch Protection

> What this repository's GitHub workflows run, which secrets they hold, and the rules that protect `dev` and `main`. No workflow deploys: production is deployed from `main` outside GitHub Actions.

## Summary

The repository is public. Every change reaches `main` through a pull request: work lands on `dev`, and the only pull request into `main` is `dev` → `main`, except a Dependabot security update for npm (see [Dependabot security updates](#dependabot-security-updates)). CI runs on pull requests to either branch with a read-only token and no secret, so a fork's pull request runs the same checks as a maintainer's. Two workflows hold a secret. `contracts-sync.yml` never checks out a pull request. `claude.yml` does. On a pull request, including a fork's, the action checks out the pull request's head. It restores only `.claude/`, `CLAUDE.md` and a few other agent configuration files from the base branch. In read mode, Claude reads that code without a write token. No file tool or git form that it may use reaches `.git/`, and it may run only read-only git and `gh` commands.

## Workflows

| Workflow | Trigger | Token | Secrets | Does |
| --- | --- | --- | --- | --- |
| `ci.yml` | Pull requests to `dev` or `main` | `contents: read` | None | The job `test`: typecheck, build, contract integrity, conventions, tests, lint, knip and depcheck |
| `claude.yml` | A comment or review that mentions `@claude`, from an owner, member or collaborator. A review or review comment on a fork's pull request is skipped: GitHub runs it without secrets | Job `mode`: none. Job `read`: `contents: read`, `pull-requests: write`, `issues: write` and `actions: read`; Claude gets this job token. Job `edit`: the same plus `id-token: write`; Claude gets the action's GitHub App token, which can push | `CLAUDE_CODE_OAUTH_TOKEN` | Answers in the pull request or issue. Read-only unless the comment asks `@claude edit` |
| `contracts-sync.yml` | Daily at 06:00 KST, or by hand | `contents: write`, `pull-requests: write` | `UMBRELLA_DEPLOY_KEY`, `UMBRELLA_REPOSITORY`, `FLEET_READ_TOKEN`, in the `contracts-sync` environment | Compares the vendored contract files with their producers' `main`. When they drift, it checks the pulled files and opens or updates one pull request into `dev` |

Every workflow sets an empty or read-only token at the top and grants more only on the job that needs it. Only `contracts-sync.yml` grants `contents: write`. No workflow uses `pull_request_target`. No `run:` script contains a `${{ }}` expression: an event field, a branch name or a step output reaches a script only through `env:`. Nothing under `.github/` names a private repository. Every action is pinned to a commit SHA with its version as a trailing comment, and Dependabot proposes new pins once a month. For npm it opens security updates only. `__tests__/nest/infra/workflow-secrets.test.ts` and `workflow-pins.test.ts` check these rules.

## Secrets

| Secret | Where | Read by | Why it is safe on a public repository |
| --- | --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Repository secret | `claude.yml` | Every branch of the `mode` job's `if` requires `author_association` `OWNER`, `MEMBER` or `COLLABORATOR`. The jobs that hold the secret need `mode`, so an outsider's `@claude` starts nothing. An issue comment runs in this repository's context even on a fork's pull request, which is why the check sits on a job, not on a step. A review or review comment on a fork's pull request runs without secrets, so the `mode` job skips it; on a fork's pull request, a maintainer asks `@claude` in a top-level comment instead. Subprocesses run with `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, so a command Claude runs does not inherit the action's credentials |
| `UMBRELLA_DEPLOY_KEY` | `contracts-sync` environment | `contracts-sync.yml` | A read-only deploy key for the private repository that owns the contracts. The workflow runs on a schedule or by hand, so always on the default branch, never for a pull request |
| `UMBRELLA_REPOSITORY` | `contracts-sync` environment | `contracts-sync.yml` | The `owner/name` of that repository. It is a secret, not a variable, so the log masks it |
| `FLEET_READ_TOKEN` | `contracts-sync` environment | `contracts-sync.yml` | A fine-grained token with `contents: read` on the repositories that produce the vendored files, and on nothing else. Same trigger as above |

This table is the target configuration, which the maintainers apply before the repository goes public (release step 2B-8). The `contracts-sync` environment limits deployments to the default branch, so a workflow on any other branch cannot read its secrets. The three secrets exist only there, with no repository-level copy. Until the environment is set up, the workflow's first step fails before it fetches anything, because the secrets it needs are missing. No secret exists for `ci.yml`. A pull request from Dependabot or a fork gets no secret.

## CI

`ci.yml` runs on every pull request to `dev` or `main`, so a regression shows on the change that causes it, not only on the release. It needs the full history (`fetch-depth: 0`): the architecture tests compare the allowlists, exemptions and ratchets with the pull request's base.

The contract check and the conventions check run tools vendored under `.github/contract-tools/`: the contract checker, the conventions linter and this repository's slice of the contract manifest. They are hash-locked in `.contracts.lock.json` like every other vendored file, so CI clones nothing. `contracts-sync.yml` refreshes them with the rest.

| Failure | Where to look |
| --- | --- |
| Typecheck, lint, tests | The same commands locally: `npm run typecheck`, `npm run lint`, `npm test` |
| Contract integrity | `python3 .github/contract-tools/exported/sync_contracts.py check --repo server --root .` prints the file and both hashes. Do not hand-edit a vendored file: its owner changes it, and the sync pull request brings it here. The vendored checker only checks. `pull`, which rewrites the lock, runs in the maintainers' umbrella repository or in `contracts-sync.yml` |
| Conventions | `python3 .github/contract-tools/exported/lint_conventions.py --root . --only frontmatter --only structure` |
| knip, depcheck | `npm run knip`, `npm run depcheck` |

A pull request from a fork waits for a maintainer to approve its workflow runs. A pull request opened by `contracts-sync.yml` uses the workflow's own token, which starts no other workflow. The sync job runs the contract check on the pulled files before it opens the pull request, but the rest of CI does not run: close and reopen the pull request, or push to it, to run CI.

## Branch protection

| Rule | `main` | `dev` |
| --- | --- | --- |
| Pull request required | Yes, no approving review required | No |
| Merge method | Merge commit only | — |
| Required status check | `test` (from `ci.yml`) | — |
| Force push | Blocked | Blocked |
| Deletion | Blocked | Blocked |
| Bypass | Repository admins | Repository admins |

Merge `dev` → `main` with a merge commit, never a squash, so `dev` and `main` keep one history.

Pull requests from outside contributors are by invitation ([CONTRIBUTING.md](../CONTRIBUTING.md)); `.github/CODEOWNERS` names the owner for every path.

### Dependabot security updates

Dependabot security updates always use the repository's default branch, which is `main`, and `target-branch` does not change that. `.github/dependabot.yml` therefore sets no `target-branch` for npm, and a security pull request for npm opens against `main`. Merge it by hand once `test` passes, and never enable auto-merge. If it is a major version bump, close it: major upgrades are planned separately. Right after the merge, merge `main` back into `dev`, or the next `dev` → `main` pull request conflicts in `package-lock.json`. npm version updates stay off because dependencies are bumped one package per change by hand. The `nestjs` group keeps the `@nestjs/*` packages in one pull request, because they must move together.

## Related

- [docs/README.md](README.md): writing rules and the docs index
- [CONTRIBUTING.md](../CONTRIBUTING.md) and [SECURITY.md](../SECURITY.md)
