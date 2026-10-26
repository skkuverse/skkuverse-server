# Contributing

Thanks for your interest in skkuverse-server.

## Issues are welcome

Open an issue for a bug, a wrong answer from the API, unclear documentation or an idea. Say what you expected, what happened, and how to reproduce it. For a security problem, do not open an issue: follow [SECURITY.md](SECURITY.md).

## Pull requests are by invitation

This server runs a live service with one maintainer, so we accept pull requests only when a maintainer has asked for one, usually in an issue. A pull request that nobody asked for may be closed without review. If you want to work on something, open an issue first and ask.

Workflows on a pull request from a fork wait for a maintainer's approval before they run.

## How changes flow

- `dev` is the working branch. Every change reaches `dev`, by pull request or by a maintainer's commit.
- `main` is the release branch. It takes only the `dev` → `main` pull request, merged with a merge commit, and production is deployed from `main`.
- An invited pull request targets `dev`.

## Before you open an invited pull request

Run the same checks as CI ([docs/cicd-and-branch-protection.md](docs/cicd-and-branch-protection.md)):

```bash
npm ci
npm run typecheck
npm run build
python3 .github/contract-tools/exported/sync_contracts.py check --repo server --root .
npm test
npm run lint
npm run knip
npm run depcheck
```

- Follow [CLAUDE.md](CLAUDE.md) and the architecture decision ([docs/decisions/0010-server-architecture.md](docs/decisions/0010-server-architecture.md)). The architecture tests in `__tests__/architecture/` and the ESLint rules enforce most of it.
- Write the test first ([docs/decisions/0011-test-strategy.md](docs/decisions/0011-test-strategy.md)). Never weaken, skip or delete an existing test to get green.
- Do not edit a vendored file listed in `.contracts.lock.json` by hand: its owner changes it, and a sync pull request brings it here.
- Write code, comments, docs and commit messages in English. Use conventional commit subjects, such as `fix(bus): …`.

By contributing, you agree that your contribution is licensed under the [Apache License 2.0](LICENSE).
