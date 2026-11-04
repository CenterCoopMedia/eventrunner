// Security-rules test runner config (spec §8.1). Invoked inside
// `firebase emulators:exec`, which exports FIREBASE_EMULATOR_HUB so
// @firebase/rules-unit-testing can discover the running emulators.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // console/tests holds the client console's own suite (ADR 0007). It
    // loads console/firestore.rules under its own demo project id.
    include: ["tests/*.rules.test.js", "console/tests/*.rules.test.js"],
    // Rules tests share one emulator instance; parallel files would
    // race on clearFirestore()/clearStorage() between suites.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
