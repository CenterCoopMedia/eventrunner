#!/usr/bin/env bash
# capture.sh — take named-page screenshots of an Eventrunner worktree for PR
# evidence, using the real app against a fresh, seeded Firebase emulator
# (the same demo event scripts/dev/run-e2e.sh seeds for the e2e suite).
#
# USAGE
#   capture.sh <worktree> <plan.json> [out_dir]
#
#   <worktree>   path to an Eventrunner checkout (any worktree — this repo's
#                own, or another one). Must have node_modules installed.
#   <plan.json>  path to a capture plan; see capture.spec.mjs's header
#                comment for the entry shape, or e2e/global-setup.mjs for
#                how the demo event/admin get seeded.
#   [out_dir]    where PNGs land. Default: /home/user/evidence/out
#                Files are named <name>--<mode>--<width>.png, one per
#                entry × mode × width (capture.spec.mjs does the naming).
#
# EXAMPLE
#   capture.sh /home/user/wt-ev /home/user/evidence/plans/pr1.json \
#       /home/user/evidence/pr1
#
# WHAT IT DOES
#   1. Copies capture.spec.mjs (this directory) into
#      <worktree>/e2e/zz-capture.spec.mjs — a real spec file so it runs
#      through the worktree's own playwright.config.js (globalSetup,
#      webServer, baseURL), sharing the config every other e2e spec uses.
#   2. Runs it alone — `npx playwright test e2e/zz-capture.spec.mjs` inside
#      `firebase emulators:exec`, with the same env vars
#      scripts/dev/run-e2e.sh exports (console email provider, demo project
#      id, the E2E_MAIL_FILE the OTP sign-in reads its code from) — under
#      the shared /tmp/eventrunner-heavy.lock, because the emulators and the
#      dev server bind fixed ports other builders' runs may also need.
#      (run-e2e.sh itself is not reused directly: it always runs the WHOLE
#      e2e/ suite and does not forward a test-file argument.)
#   3. Deletes e2e/zz-capture.spec.mjs from the worktree afterwards, whether
#      the run passed or failed.
#
# The worktree is never left with capture.spec.mjs committed or lying
# around, and nothing here touches git state.
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "usage: capture.sh <worktree> <plan.json> [out_dir]" >&2
  exit 64
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKTREE="$(cd "$1" && pwd)"
PLAN_JSON="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
OUT_DIR="${3:-/home/user/evidence/out}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

if [ ! -f "$WORKTREE/scripts/dev/run-e2e.sh" ] || [ ! -f "$WORKTREE/firebase.json" ]; then
  echo "capture.sh: $WORKTREE does not look like an Eventrunner checkout" \
    "(missing scripts/dev/run-e2e.sh or firebase.json)." >&2
  exit 1
fi
if [ ! -f "$PLAN_JSON" ]; then
  echo "capture.sh: plan file $PLAN_JSON does not exist." >&2
  exit 1
fi

TEMP_SPEC="$WORKTREE/e2e/zz-capture.spec.mjs"
cleanup() {
  rm -f "$TEMP_SPEC"
}
trap cleanup EXIT

cp "$SCRIPT_DIR/capture.spec.mjs" "$TEMP_SPEC"

cd "$WORKTREE"
mkdir -p e2e/.tmp
LOG="$PWD/e2e/.tmp/capture-emulator.log"
MAIL="$PWD/e2e/.tmp/capture-mail.jsonl"
rm -f "$LOG"
: > "$MAIL"

# Same fixed, credential-free values scripts/dev/run-e2e.sh uses — see that
# file's own comments for why each one is set.
export E2E_EMULATOR_LOG="$LOG"
export E2E_MAIL_FILE="$MAIL"
export EVENT_FIREBASE_PROJECT_ID="${EVENT_FIREBASE_PROJECT_ID:-demo-run-of-show}"
export EVENT_FIREBASE_REGION="${EVENT_FIREBASE_REGION:-us-central1}"
export EVENT_SLUG="e2e-suite"
export EVENT_EMAIL_PROVIDER=console
export EVENT_TICKETING_PROVIDER=manual
export EVENT_OPERATOR_NOTIFIER=none
export E2E_APP_URL="${E2E_APP_URL:-http://127.0.0.1:5173}"
export EVENT_PUBLIC_URL="$E2E_APP_URL"
export EVENT_ALLOWED_ORIGINS="$E2E_APP_URL"
export EVENT_STORAGE_BUCKET="${EVENT_FIREBASE_PROJECT_ID}.appspot.com"
export FUNCTIONS_EMULATOR=true

# Read by capture.spec.mjs.
export CAPTURE_PLAN="$PLAN_JSON"
export CAPTURE_OUT_DIR="$OUT_DIR"

echo "capture.sh: worktree=$WORKTREE plan=$PLAN_JSON out=$OUT_DIR"

set +e
flock /tmp/eventrunner-heavy.lock npx firebase emulators:exec \
  --only firestore,storage,auth,functions \
  --project "$EVENT_FIREBASE_PROJECT_ID" \
  "npx playwright test e2e/zz-capture.spec.mjs" 2>&1 | tee "$LOG"
status="${PIPESTATUS[0]}"
set -e

if [ "$status" -ne 0 ]; then
  echo "capture.sh: failed (exit $status). Emulator log: $LOG" >&2
fi
exit "$status"
