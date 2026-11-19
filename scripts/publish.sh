#!/bin/sh
# Publish generated files to the dedicated GitHub Pages repository.
set -eu
project=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
node "$project/scripts/build.mjs"
checkout=$(mktemp -d)
trap 'rm -rf "$checkout"' EXIT
gh repo clone JS-banana/deals "$checkout" -- --quiet --depth 1
# Only replace paths owned by the generator. Keep repository settings such as CNAME.
for entry in index.html 404.html about offer category topic assets sitemap.xml robots.txt .nojekyll; do
  rm -rf "$checkout/$entry"
  cp -R "$project/dist/$entry" "$checkout/$entry"
done
git -C "$checkout" add --all
if git -C "$checkout" diff --cached --quiet; then
  echo '发布仓库已是最新。'
  exit 0
fi
revision=$(git -C "$project" rev-parse --short HEAD)
git -C "$checkout" commit -m "Publish deal index from $revision"
git -C "$checkout" push origin HEAD:main
