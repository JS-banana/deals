#!/usr/bin/env bash
# Pull-based deploy, run on the server by deals-deploy.timer (or by hand).
# Deploys origin/main once its CI run has succeeded; rolls back if the new web container is unhealthy.
#   deploy/deploy.sh           deploy if origin/main moved and CI is green
#   deploy/deploy.sh --force   rebuild and restart the current origin/main regardless of CI
set -euo pipefail
cd "$(dirname "$0")/.."

exec 9>"${TMPDIR:-/tmp}/deals-deploy.lock"
flock -n 9 || exit 0

branch=${DEPLOY_BRANCH:-main}
force=${1:-}
git fetch --quiet origin "$branch"
current=$(git rev-parse HEAD)
target=$(git rev-parse "origin/$branch")
[[ "$current" == "$target" && "$force" != "--force" ]] && exit 0

if [[ "$force" != "--force" ]]; then
  ci=$(gh run list --repo JS-banana/deals --workflow ci.yml --commit "$target" \
    --json status,conclusion --jq '.[0] | if . == null then "missing" elif .status != "completed" then .status else .conclusion end')
  if [[ "$ci" != "success" ]]; then
    echo "CI for ${target:0:7} is ${ci}; not deploying yet"
    exit 0
  fi
fi

port=$(sed -n 's/^WEB_PORT=//p' .env | tail -1)
# Healthy means the container answering is the one built from the expected commit.
healthy() {
  local want=$1
  for _ in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:${port:-3100}/api/health" 2>/dev/null | grep -q "\"version\":\"$want\"" && return 0
    sleep 3
  done
  return 1
}

echo "Deploying ${target:0:7} (was ${current:0:7})"
git reset --quiet --hard "$target"
export GIT_SHA=${target:0:7}
if docker compose up -d --build --remove-orphans && healthy "$GIT_SHA"; then
  docker image prune -f >/dev/null
  echo "Deployed ${target:0:7}"
else
  echo "Deploy of ${target:0:7} failed; rolling back to ${current:0:7}" >&2
  git reset --quiet --hard "$current"
  GIT_SHA=${current:0:7} docker compose up -d --build --remove-orphans
  exit 1
fi
