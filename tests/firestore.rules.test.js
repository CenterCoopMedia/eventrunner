// Firestore rules tests, run against the emulator via `npm run test:rules`.
// The scaffold rules deny everything (issue #5); feature ports replace both
// the rules and these assertions per spec §4 and §8.5.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";
import {
  assertFails,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-run-of-show",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe("firestore scaffold rules deny all access", () => {
  it("denies unauthenticated reads", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "config/site")));
  });

  it("denies unauthenticated writes", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, "config/site"), { title: "x" }));
  });

  it("denies authenticated reads", async () => {
    const db = testEnv.authenticatedContext("attendee-1").firestore();
    await assertFails(getDoc(doc(db, "config/site")));
  });

  it("denies authenticated writes", async () => {
    const db = testEnv.authenticatedContext("attendee-1").firestore();
    await assertFails(setDoc(doc(db, "users/attendee-1"), { name: "x" }));
  });
});
