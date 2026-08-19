// Firestore rules tests, run against the emulator via `npm run test:rules`.
// Pins the v1 rules from docs/adr/0001-event-platform-v1.md §4 and §8.4:
// public config (minus config/bootstrap), visibility-gated published CMS
// collections, admin-only drafts and bookkeeping, deny-all everywhere else.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

const ADMIN_EMAIL = "admin@example.com";

let testEnv;

/** Anonymous client. */
function anon() {
  return testEnv.unauthenticatedContext().firestore();
}

/** Signed-in client whose (verified) email is on config/bootstrap.adminEmails. */
function admin() {
  return testEnv
    .authenticatedContext("admin-1", {
      email: ADMIN_EMAIL,
      email_verified: true,
    })
    .firestore();
}

/** Signed-in client whose email is NOT on the admin allowlist. */
function nonAdmin() {
  return testEnv
    .authenticatedContext("attendee-1", {
      email: "attendee@example.com",
      email_verified: true,
    })
    .firestore();
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-run-of-show",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
  // Seed server-written docs with rules disabled: the rules themselves
  // allow no client writes anywhere.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "config/bootstrap"), {
      adminEmails: [ADMIN_EMAIL],
    });
    await setDoc(doc(db, "config/event"), { title: "Test event" });
    for (const c of ["cmsContent", "cmsPages"]) {
      await setDoc(doc(db, `${c}/pub`), {
        body: "published",
        visible: true,
        revision: 1,
      });
      await setDoc(doc(db, `${c}/hidden`), {
        body: "unpublished",
        visible: false,
        revision: 1,
      });
      await setDoc(doc(db, `${c}_drafts/pub`), {
        body: "draft",
        visible: true,
        status: "dirty",
        basedOnRevision: 1,
      });
    }
    await setDoc(doc(db, "cmsVersionHistory/v1"), { collection: "cmsPages" });
    await setDoc(doc(db, "cmsPublishQueue/q1"), { status: "complete" });
    await setDoc(doc(db, "admin_logs/l1"), { action: "cmsPublish" });
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe("config", () => {
  it("allows anonymous reads of public config docs", async () => {
    await assertSucceeds(getDoc(doc(anon(), "config/event")));
  });

  it("denies config/bootstrap to anonymous clients", async () => {
    await assertFails(getDoc(doc(anon(), "config/bootstrap")));
  });

  it("denies config/bootstrap to non-admin clients", async () => {
    await assertFails(getDoc(doc(nonAdmin(), "config/bootstrap")));
  });

  it("denies config/bootstrap even to admin-token clients", async () => {
    await assertFails(getDoc(doc(admin(), "config/bootstrap")));
  });

  it("denies all client writes to config", async () => {
    await assertFails(setDoc(doc(anon(), "config/event"), { title: "x" }));
    await assertFails(setDoc(doc(admin(), "config/event"), { title: "x" }));
  });
});

for (const c of ["cmsContent", "cmsPages"]) {
  describe(`${c} two-revision model`, () => {
    it("allows anonymous read of a visible live doc", async () => {
      await assertSucceeds(getDoc(doc(anon(), `${c}/pub`)));
    });

    it("denies anonymous read of a visible:false live doc", async () => {
      await assertFails(getDoc(doc(anon(), `${c}/hidden`)));
    });

    it("denies anonymous read of any draft", async () => {
      await assertFails(getDoc(doc(anon(), `${c}_drafts/pub`)));
    });

    it("denies authenticated non-admin read of any draft", async () => {
      await assertFails(getDoc(doc(nonAdmin(), `${c}_drafts/pub`)));
    });

    it("allows admin read of hidden live docs and drafts", async () => {
      await assertSucceeds(getDoc(doc(admin(), `${c}/hidden`)));
      await assertSucceeds(getDoc(doc(admin(), `${c}_drafts/pub`)));
    });

    it("denies admin read when the token email is unverified", async () => {
      const db = testEnv
        .authenticatedContext("admin-2", {
          email: ADMIN_EMAIL,
          email_verified: false,
        })
        .firestore();
      await assertFails(getDoc(doc(db, `${c}_drafts/pub`)));
    });

    it("denies all client writes, admin included", async () => {
      await assertFails(setDoc(doc(admin(), `${c}/pub`), { body: "x" }));
      await assertFails(
        setDoc(doc(admin(), `${c}_drafts/pub`), { body: "x" }),
      );
    });
  });
}

describe("publish bookkeeping collections", () => {
  for (const path of [
    "cmsVersionHistory/v1",
    "cmsPublishQueue/q1",
    "admin_logs/l1",
  ]) {
    it(`allows admin read of ${path} but no one else`, async () => {
      await assertSucceeds(getDoc(doc(admin(), path)));
      await assertFails(getDoc(doc(nonAdmin(), path)));
      await assertFails(getDoc(doc(anon(), path)));
    });

    it(`denies all client writes to ${path}`, async () => {
      await assertFails(setDoc(doc(admin(), path), { x: 1 }));
    });
  }
});

describe("server-only collections stay deny-all", () => {
  for (const c of [
    "auth_challenges",
    "auth_rate_limits",
    "sent_emails",
    "email_claims",
    "system_errors",
    "email_templates",
  ]) {
    it(`denies all access to ${c}, admin included`, async () => {
      await assertFails(getDoc(doc(anon(), `${c}/d1`)));
      await assertFails(getDoc(doc(admin(), `${c}/d1`)));
      await assertFails(setDoc(doc(admin(), `${c}/d1`), { x: 1 }));
    });
  }

  it("denies unmatched collections (catch-all)", async () => {
    await assertFails(getDoc(doc(anon(), "users/attendee-1")));
    await assertFails(
      setDoc(doc(nonAdmin(), "users/attendee-1"), { name: "x" }),
    );
    await assertFails(setDoc(doc(admin(), "users/attendee-1"), { name: "x" }));
  });
});
