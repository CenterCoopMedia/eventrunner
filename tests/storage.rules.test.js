// Storage rules tests, run against the emulator via `npm run test:rules`.
// The scaffold rules deny everything (issue #5); the media-library port
// replaces both the rules and these assertions per spec §8.5.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";
import {
  assertFails,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { getBytes, ref, uploadString } from "firebase/storage";

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-run-of-show",
    storage: { rules: readFileSync("storage.rules", "utf8") },
  });
  // Seed the object the read tests target. Without it, getBytes rejects
  // with storage/object-not-found even under allow-all rules, and
  // assertFails accepts any rejection — the read assertions would be
  // vacuously green.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await uploadString(ref(context.storage(), "media/logo.png"), "seeded");
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe("storage scaffold rules deny all access", () => {
  it("denies unauthenticated reads", async () => {
    const storage = testEnv.unauthenticatedContext().storage();
    await assertFails(getBytes(ref(storage, "media/logo.png")));
  });

  it("denies unauthenticated writes", async () => {
    const storage = testEnv.unauthenticatedContext().storage();
    await assertFails(uploadString(ref(storage, "media/logo.png"), "x"));
  });

  it("denies authenticated reads", async () => {
    const storage = testEnv.authenticatedContext("attendee-1").storage();
    await assertFails(getBytes(ref(storage, "media/logo.png")));
  });

  it("denies authenticated writes", async () => {
    const storage = testEnv.authenticatedContext("attendee-1").storage();
    await assertFails(uploadString(ref(storage, "uploads/attendee-1/a.txt"), "x"));
  });
});
