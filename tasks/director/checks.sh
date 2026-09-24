#!/usr/bin/env bash
# Every check CI can select, run last, under the shared lock where heavy.
cd "${1:-/home/user/eventrunner}"
L=/tmp/eventrunner-heavy.lock
# A failing step keeps its whole output in a file: a tail alone can lose the
# assertion under a long DOM dump.
run() { local name="$1"; shift; if out=$("$@" 2>&1); then echo "PASS $name :: $(echo "$out" | grep -E 'Tests +[0-9]|# pass|# fail|passed|match|clean|files' | tail -2 | tr '\n' ' ')"; else local log; log="/tmp/claude-0/checks-$name-$(date +%s).log"; mkdir -p /tmp/claude-0; echo "$out" > "$log"; echo "FAIL $name (full output: $log)"; echo "$out" | tail -40; fi; }
run lint npm run lint
run unit npm test
run web flock $L npm run test -w apps/web
run rules flock $L npm run test:rules
run build flock $L npm run build -w apps/web
run budget-client node scripts/ci/bundle-budget.cjs --dist apps/web/dist
run budget-demo node scripts/ci/bundle-budget.cjs --dist docs/demo
run content node scripts/generate-content.cjs --demo --check
run demo flock $L node scripts/build-demo.cjs --check
run pages node scripts/build-pages.cjs --check
run docs node scripts/check-docs.cjs
run copy npm run check:copy
run audit node scripts/ci/audit-policy.cjs
run e2e flock $L npm run test:e2e
