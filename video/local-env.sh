#!/usr/bin/env bash
# Source from a terminal using Node 22. All values belong to a local demo project.
video_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export EVENT_FIREBASE_PROJECT_ID=demo-run-of-show
export EVENT_FIREBASE_REGION=us-central1
export EVENT_SLUG=video-fixture
export EVENT_EMAIL_PROVIDER=console
export EVENT_TICKETING_PROVIDER=manual
export EVENT_OPERATOR_NOTIFIER=none
export EVENT_PUBLIC_URL=http://127.0.0.1:5173
export EVENT_ALLOWED_ORIGINS=http://127.0.0.1:5173
export EVENT_STORAGE_BUCKET=demo-run-of-show.appspot.com
export FUNCTIONS_EMULATOR=true
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
export VITE_FIREBASE_API_KEY=demo-api-key
export VITE_FIREBASE_AUTH_DOMAIN=demo-run-of-show.firebaseapp.com
export VITE_FIREBASE_PROJECT_ID=demo-run-of-show
export VITE_FIREBASE_STORAGE_BUCKET=demo-run-of-show.appspot.com
export VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
export VITE_FIREBASE_APP_ID=1:000000000000:web:0000000000000000000000
export VITE_FIREBASE_REGION=us-central1
export VITE_FUNCTIONS_ORIGIN=http://127.0.0.1:5001/demo-run-of-show/us-central1
export VITE_USE_EMULATORS=true
export GENERATED_DIR="${GENERATED_DIR:-/tmp/eventrunner-video-generated}"
export E2E_MAIL_FILE="${E2E_MAIL_FILE:-$video_repo_root/video/.cache/mail.jsonl}"
unset VITE_DEMO_MODE
mkdir -p "$(dirname "$E2E_MAIL_FILE")"
touch "$E2E_MAIL_FILE"
unset video_repo_root
