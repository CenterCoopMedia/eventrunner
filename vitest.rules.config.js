// Security-rules test runner config (spec §8.1). Invoked inside
// `firebase emulators:exec`, which exports FIREBASE_EMULATOR_HUB so
// @firebase/rules-unit-testing can discover the running emulators.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/*.rules.test.js"],
    // Rules tests share one emulator instance; parallel files would
    // race on clearFirestore()/clearStorage() between suites.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
