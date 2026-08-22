#!/usr/bin/env bash
# Runs the Playwright e2e suite against the full Firebase emulator suite
# (spec §8.1, issue #38). Wraps `firebase emulators:exec` the same way
# `test:rules` does, plus points the console email provider at a captured-mail
# file — that file is the suite's "inbox" (see e2e/helpers.mjs), holding one
# JSON line per sent message so the OTP/invite journeys can read codes and
# tokens that exist nowhere else server-side.
#
# The emulators' combined stdout is also tee'd to a log, but purely as a
# post-mortem debugging aid: no test reads it. It used to be the inbox, and
# that was the source of a CI-only failure — under `emulators:exec`
# firebase-tools re-prints captured lines with a "> " prefix it ANSI-colorizes
# when it thinks the terminal supports color (true on GitHub Actions, false
# through a local pipe), which corrupted the multi-line JSON blobs the tests
# parsed. E2E_MAIL_FILE removes that channel from the test path entirely.
#
# Credential-free by design: no secrets, no real project, no real email —
# every env var below is a fixed emulator/demo value, so this is exactly as
# runnable from a fork PR as `npm run test:rules` is.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

mkdir -p e2e/.tmp
LOG="$PWD/e2e/.tmp/emulator.log"
MAIL="$PWD/e2e/.tmp/mail.jsonl"
rm -f "$LOG"
# Truncate into existence before the emulators start, so that a spec finding
# no file at all is unambiguous evidence of a wiring problem rather than of
# "no mail sent yet" (e2e/helpers.mjs asserts on exactly that distinction).
: > "$MAIL"

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

npx firebase emulators:exec \
  --only firestore,storage,auth,functions \
  --project "$EVENT_FIREBASE_PROJECT_ID" \
  "npx playwright test" 2>&1 | tee "$LOG"
status="${PIPESTATUS[0]}"

# Belt and suspenders on top of e2e/helpers.mjs's own runtime check: if the
# suite failed AND not one message ever reached the captured-mail file, the
# capture path itself is broken (not the app) — say so loudly here, since a
# run that fails for THIS reason should never be mistaken for a real app
# regression by whoever reads the CI log next. Only on failure: a green run
# that happens to send no mail is not a problem.
if [ "$status" -ne 0 ] && [ ! -s "$MAIL" ]; then
  echo "run-e2e.sh: $MAIL is empty — the console email provider never appended" \
    "a single message. Every OTP/invite journey reads its mail from this file," \
    "so this is a wiring failure (E2E_MAIL_FILE did not reach the functions" \
    "emulator, or the console provider was not selected), not an app" \
    "regression. Full emulator output: $LOG" >&2
fi

exit "$status"
