#!/usr/bin/env bash
# Every check CI runs, in CI's order: `npm run check:ci`, which .github/workflows/ci.yml passes to the shared workflow
# as its check command, and which a local hook can run on the commit being pushed. The install comes first and stays
# outside: CI runs `sfw npm ci` and `npm audit signatures`. __tests__/nest/infra/ci-workflow.test.ts pins the steps.
#
# Usage: check-ci.sh [--skip <step>]...  A skipped step is named in the output; a step name this script does not
# have, or any other argument, fails before the first step runs.
# WHY: the local push gate passes `--skip test`, because the full suite outlasts a push on a shared machine; the
# commit gate's related tests, CI on every push to dev and the release pull request's `ci / gate` run it. CI never
# passes --skip (ci-workflow.test.ts).
set -euo pipefail
export CI=true TZ=UTC LANG=C.UTF-8

self=${BASH_SOURCE[0]}
known_steps() { sed -n 's/^step \([^ ]*\) .*/\1/p' "$self" | tr '\n' ' '; }
skip=" "
while [ $# -gt 0 ]; do
  case "$1" in
    --skip)
      name=${2:-}
      case "$name" in "" | *[!a-z0-9-]*) echo "check-ci: --skip needs a step name: $(known_steps)" >&2; exit 2 ;; esac
      if ! grep -q "^step $name " "$self"; then
        echo "check-ci: no step named '$name' to skip; the steps are: $(known_steps)" >&2
        exit 2
      fi
      skip="$skip$name "
      shift 2
      ;;
    *)
      echo "check-ci: unknown argument '$1' (usage: check-ci.sh [--skip <step>]...)" >&2
      exit 2
      ;;
  esac
done

step() {
  local name=$1
  shift
  case "$skip" in *" $name "*) echo "check-ci: skipped $name (--skip $name)"; return 0 ;; esac
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
