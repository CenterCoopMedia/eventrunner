#!/usr/bin/env bash
# Runs the Playwright e2e suite against the full Firebase emulator suite
# (spec §8.1, issue #38). Wraps `firebase emulators:exec` the same way
# `test:rules` does, plus captures the emulators' combined stdout to a log
# file — that log is the console email provider's "inbox" (see e2e/helpers.mjs)
# and is what scripts/dev/{login,invite}-smoke.mjs already read the same way
# outside Playwright.
#
# Credential-free by design: no secrets, no real project, no real email —
# every env var below is a fixed emulator/demo value, so this is exactly as
# runnable from a fork PR as `npm run test:rules` is.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

mkdir -p e2e/.tmp
LOG="$PWD/e2e/.tmp/emulator.log"
rm -f "$LOG"

export E2E_EMULATOR_LOG="$LOG"
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

npx firebase emulators:exec \
  --only firestore,storage,auth,functions \
  --project "$EVENT_FIREBASE_PROJECT_ID" \
  "npx playwright test" 2>&1 | tee "$LOG"
status="${PIPESTATUS[0]}"

# Belt and suspenders on top of e2e/helpers.mjs's own runtime check: if
# nothing at all landed in the tee'd log, the capture path itself is broken
# (not the app) — say so loudly here too, since a run that fails for THIS
# reason should never be mistaken for a real app regression by whoever
# reads the CI log next.
if [ ! -s "$LOG" ]; then
  echo "run-e2e.sh: $LOG is empty or missing — nothing was captured from" \
    "\`firebase emulators:exec\`. Every OTP/invite journey reads its mail" \
    "from this file; an empty one means the tee above never ran, not that" \
    "no mail was sent." >&2
  exit 1
fi

exit "$status"
