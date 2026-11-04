#!/usr/bin/env bash
# Every check CI runs, in CI's order: `npm run check:ci`, which .github/workflows/ci.yml passes to the shared workflow
# as its check command, and which a local hook can run on the commit being pushed. The install comes first and stays
# outside: CI runs `sfw npm ci` and `npm audit signatures`. __tests__/nest/infra/ci-workflow.test.ts pins the steps.
set -euo pipefail
export CI=true TZ=UTC LANG=C.UTF-8

step() {
  local name=$1
  shift
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::group::$name"; fi
  "$@"
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::endgroup::"; fi
}

# WHY: mongodb-memory-server's postinstall exits 0 when its download fails, so a failed download passes `npm ci` and
# would surface later as test files that find no binary.
mongod_binary_present() {
  node -e '
    require("mongodb-memory-server").DryMongoBinary.locateBinary({}).then((found) => {
      if (found !== undefined) return;
      console.error("No mongod binary for config.mongodbMemoryServer.version in package.json: the download during npm ci failed. Run npm rebuild mongodb-memory-server.");
      process.exit(1);
    });
  '
}

step mongod mongod_binary_present
step typecheck npm run typecheck
step build npm run build
# The vendored files (.contracts.lock.json) still match the lock, after the build, so a vendored JSON file that
# scripts/copy-build-assets.js leaves out of dist/ fails the same run. The checker and the conventions linter are
# vendored and hash-locked too, so nothing is cloned.
step contracts python3 .github/contract-tools/exported/sync_contracts.py check --repo server --root .
step conventions python3 .github/contract-tools/exported/lint_conventions.py --root . --only frontmatter --only structure
# EVIDENCE: 3 workers is Jest's default on a 4-vCPU GitHub-hosted runner (cores - 1); locally it leaves the other
# cores to parallel sessions.
step test npm test -- --ci --maxWorkers=3
step lint npm run lint
step knip npm run knip
