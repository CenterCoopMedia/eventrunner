#!/usr/bin/env bash
# Regenerate every generated output on the current checkout, then commit it.
set -euo pipefail
cd "${1:-/home/user/eventrunner}"
npm run prepare:functions >/dev/null
rm -rf functions/node_modules/shared
npm install --no-audit --no-fund >/dev/null 2>&1
node scripts/generate-content.cjs --demo >/dev/null
flock /tmp/eventrunner-heavy.lock node scripts/build-demo.cjs >/dev/null
node scripts/build-pages.cjs >/dev/null
git add -A docs/docs docs/demo apps/web/src/generated package-lock.json functions/package-lock.json
if git diff --cached --quiet; then echo "regen: nothing changed"; else
  git commit -s -q -m "Regenerate generated output" && echo "regen: committed $(git rev-parse --short HEAD)"; fi
git status --short | head -20
