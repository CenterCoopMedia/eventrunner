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
import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const ADMIN_EMAIL = "admin@example.com";

/**
 * All six publishable collections from ADR §8.4 — the rules blocks are
 * hand-duplicated per collection, so the matrix below must pin every one.
 */
const PUBLISHABLE = [
  "cmsContent",
  "cmsSchedule",
  "cmsOrganizations",
  "cmsTimeline",
  "cmsUpdates",
  "cmsPages",
];

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

/**
 * Signed-in client for one of the seeded attendee accounts below (§3.4).
 * Their `users` doc — not the token — decides directory access.
 */
function attendee(uid) {
  return testEnv
    .authenticatedContext(uid, {
      email: `${uid}@example.com`,
      email_verified: true,
    })
    .firestore();
}

/** Flip config/features.publicAttendeeProfiles (server-owned: rules-disabled). */
async function setPublicProfilesFeature(enabled) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "config/features"), {
      attendeeDirectory: true,
      publicAttendeeProfiles: enabled,
    });
  });
}

/**
 * The attendee accounts the §3.4 read rules branch on. `registrationStatus`
 * and `speakerId` are server-owned, so these are seeded with rules disabled,
 * exactly as the users/ triggers would write them.
 */
const ATTENDEES = {
  "pending-1": { registrationStatus: "pending", speakerId: null },
  "approved-1": { registrationStatus: "approved", speakerId: null },
  // A speaker whose registration never advanced past pending: speakerId, not
  // the status, is what grants them attendee access (§3.4).
  "speaker-1": { registrationStatus: "pending", speakerId: "spk-1" },
};

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
    // publicAttendeeProfiles starts OFF: the rules gate a move to `public`
    // profile visibility on it, and setPublicProfilesFeature() flips it.
    await setDoc(doc(db, "config/features"), {
      attendeeDirectory: true,
      publicAttendeeProfiles: false,
    });
    for (const c of PUBLISHABLE) {
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

    for (const [uid, account] of Object.entries(ATTENDEES)) {
      await setDoc(doc(db, `users/${uid}`), {
        uid,
        email: `${uid}@example.com`,
        displayName: uid,
        pronouns: "",
        bio: "",
        organization: "",
        jobTitle: "",
        photoPath: null,
        socialHandles: {},
        badges: [],
        profileVisibility: "attendees_only",
        profileComplete: true,
        approvalSource: null,
        role: "attendee",
        ...account,
      });
      await setDoc(doc(db, `users_public/${uid}`), {
        uid,
        displayName: uid,
        badges: [],
        profileVisibility: "attendees_only",
        speakerId: account.speakerId,
      });
    }
    // One projection per visibility value, owned by nobody in the test set,
    // so every read below is a read of somebody else's profile.
    for (const [id, visibility] of [
      ["public-profile", "public"],
      ["attendees-profile", "attendees_only"],
      ["private-profile", "private"],
    ]) {
      await setDoc(doc(db, `users_public/${id}`), {
        uid: id,
        displayName: id,
        badges: [],
        profileVisibility: visibility,
        speakerId: null,
      });
    }
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

for (const c of PUBLISHABLE) {
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

    it("allows admin read with a mixed-case token email (rules lowercase it)", async () => {
      const db = testEnv
        .authenticatedContext("admin-3", {
          email: "Admin@Example.com",
          email_verified: true,
        })
        .firestore();
      await assertSucceeds(getDoc(doc(db, `${c}_drafts/pub`)));
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
    "auth_send_ceiling",
    "sent_emails",
    "email_claims",
    "system_errors",
    "client_error_rate_limits",
    "email_templates",
    "speaker_slugs",
  ]) {
    it(`denies all access to ${c}, admin included`, async () => {
      await assertFails(getDoc(doc(anon(), `${c}/d1`)));
      await assertFails(getDoc(doc(admin(), `${c}/d1`)));
      await assertFails(setDoc(doc(admin(), `${c}/d1`), { x: 1 }));
    });
  }

  it("denies unmatched collections (catch-all)", async () => {
    await assertFails(getDoc(doc(anon(), "activity_logs/a1")));
    await assertFails(setDoc(doc(nonAdmin(), "activity_logs/a1"), { x: 1 }));
    await assertFails(setDoc(doc(admin(), "activity_logs/a1"), { x: 1 }));
  });
});

describe("the private bookmarks subcollection under users/{uid}", () => {
  it("allows a user to read their own bookmark membership docs, denies everyone else", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/attendee-1/bookmarks/session-1"), {
        bookmarkedAt: new Date(),
      });
    });
    await assertSucceeds(getDoc(doc(nonAdmin(), "users/attendee-1/bookmarks/session-1")));
    await assertFails(getDoc(doc(anon(), "users/attendee-1/bookmarks/session-1")));
    const other = testEnv
      .authenticatedContext("attendee-2", { email: "other@example.com", email_verified: true })
      .firestore();
    await assertFails(getDoc(doc(other, "users/attendee-1/bookmarks/session-1")));
  });

  it("denies all client writes to the bookmarks subcollection, owner included", async () => {
    await assertFails(
      setDoc(doc(nonAdmin(), "users/attendee-1/bookmarks/session-1"), { bookmarkedAt: new Date() }),
    );
  });
});

// The six branches issue #17 requires pinned, plus the self-read and
// list-query shapes §3.4 calls out. The gap being closed: `attendees_only`
// used to be readable by ANY authenticated user, so a brand-new pending
// account could enumerate the whole directory.
describe("users_public directory visibility (spec §3.4)", () => {
  it("denies a pending account an attendees_only profile", async () => {
    await assertFails(
      getDoc(doc(attendee("pending-1"), "users_public/attendees-profile")),
    );
  });

  it("allows an approved attendee an attendees_only profile", async () => {
    await assertSucceeds(
      getDoc(doc(attendee("approved-1"), "users_public/attendees-profile")),
    );
  });

  it("allows a speaker (speakerId set, still pending) an attendees_only profile", async () => {
    await assertSucceeds(
      getDoc(doc(attendee("speaker-1"), "users_public/attendees-profile")),
    );
  });

  it("allows an admin an attendees_only profile", async () => {
    await assertSucceeds(getDoc(doc(admin(), "users_public/attendees-profile")));
  });

  it("allows anyone, signed out included, a public profile", async () => {
    await assertSucceeds(getDoc(doc(anon(), "users_public/public-profile")));
    await assertSucceeds(
      getDoc(doc(attendee("pending-1"), "users_public/public-profile")),
    );
  });

  it("denies a private profile to everyone but its owner and admins", async () => {
    await assertFails(getDoc(doc(anon(), "users_public/private-profile")));
    await assertFails(
      getDoc(doc(attendee("approved-1"), "users_public/private-profile")),
    );
    await assertFails(
      getDoc(doc(attendee("speaker-1"), "users_public/private-profile")),
    );
    await assertSucceeds(getDoc(doc(admin(), "users_public/private-profile")));
  });

  it("allows self-read at any visibility, even while pending", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users_public/pending-1"), {
        uid: "pending-1",
        displayName: "pending-1",
        badges: [],
        profileVisibility: "private",
        speakerId: null,
      });
    });
    await assertSucceeds(
      getDoc(doc(attendee("pending-1"), "users_public/pending-1")),
    );
    // Restore the seeded visibility for the list-query expectations below.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users_public/pending-1"), {
        uid: "pending-1",
        displayName: "pending-1",
        badges: [],
        profileVisibility: "attendees_only",
        speakerId: null,
      });
    });
  });

  it("denies an unauthenticated read of an attendees_only profile", async () => {
    await assertFails(getDoc(doc(anon(), "users_public/attendees-profile")));
  });

  it("pins the directory list-query shape: the visibility filter is load-bearing", async () => {
    const publicOnly = (db) =>
      getDocs(
        query(collection(db, "users_public"), where("profileVisibility", "==", "public")),
      );
    const directory = (db) =>
      getDocs(
        query(
          collection(db, "users_public"),
          where("profileVisibility", "in", ["public", "attendees_only"]),
        ),
      );

    // Anonymous and pending clients may list public profiles only.
    await assertSucceeds(publicOnly(anon()));
    await assertSucceeds(publicOnly(attendee("pending-1")));
    await assertFails(directory(attendee("pending-1")));
    // An approved attendee may list the directory; an unfiltered list still
    // fails, because private docs would be in the result set.
    await assertSucceeds(directory(attendee("approved-1")));
    await assertFails(getDocs(collection(attendee("approved-1"), "users_public")));
  });

  it("denies every client write to users_public, admin included", async () => {
    await assertFails(
      setDoc(doc(attendee("approved-1"), "users_public/approved-1"), {
        displayName: "self-published",
      }),
    );
    await assertFails(
      setDoc(doc(admin(), "users_public/attendees-profile"), { displayName: "x" }),
    );
  });
});

describe("users account documents (spec §3.4)", () => {
  it("allows an account owner and an admin to read the account, and nobody else", async () => {
    await assertSucceeds(getDoc(doc(attendee("pending-1"), "users/pending-1")));
    await assertSucceeds(getDoc(doc(admin(), "users/pending-1")));
    await assertFails(getDoc(doc(attendee("approved-1"), "users/pending-1")));
    await assertFails(getDoc(doc(anon(), "users/pending-1")));
  });

  it("allows the owner to update their own profile fields", async () => {
    await assertSucceeds(
      updateDoc(doc(attendee("approved-1"), "users/approved-1"), {
        displayName: "Rae Okonkwo",
        pronouns: "they/them",
        bio: "Community reporter.",
        badges: ["writer"],
        profileVisibility: "attendees_only",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("denies a non-string value in any rendered profile field", async () => {
    for (const patch of [
      { displayName: { first: "Rae" } },
      { displayName: 42 },
      { pronouns: ["they", "them"] },
      { bio: { html: "<b>hi</b>" } },
      { organization: 7 },
      { jobTitle: ["Editor"] },
      { photoPath: 12 },
      { socialHandles: ["mastodon"] },
      { badges: "writer" },
      { updatedAt: "2026-08-21" },
    ]) {
      await assertFails(
        updateDoc(doc(attendee("pending-1"), "users/pending-1"), patch),
      );
    }
  });

  it("allows the same fields with the right types", async () => {
    await assertSucceeds(
      updateDoc(doc(attendee("pending-1"), "users/pending-1"), {
        displayName: "Rae",
        pronouns: "they/them",
        bio: "Reporter",
        organization: "The Weekly",
        jobTitle: "Editor",
        photoPath: null,
        socialHandles: { mastodon: "@rae@example.social" },
        badges: ["writer"],
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("denies a move to public visibility while config/features.publicAttendeeProfiles is off", async () => {
    await setPublicProfilesFeature(false);
    await assertFails(
      updateDoc(doc(attendee("pending-1"), "users/pending-1"), {
        profileVisibility: "public",
      }),
    );
  });

  it("allows a move to public visibility once the operator turns the feature on", async () => {
    await setPublicProfilesFeature(true);
    await assertSucceeds(
      updateDoc(doc(attendee("pending-1"), "users/pending-1"), {
        profileVisibility: "public",
      }),
    );
    await setPublicProfilesFeature(false);
  });

  it("keeps an already-public profile editable after the feature is turned off", async () => {
    await setPublicProfilesFeature(true);
    await assertSucceeds(
      updateDoc(doc(attendee("speaker-1"), "users/speaker-1"), {
        profileVisibility: "public",
      }),
    );
    await setPublicProfilesFeature(false);
    // The stored value stays `public`; editing other fields must still work,
    // and switching away from public must too.
    await assertSucceeds(
      updateDoc(doc(attendee("speaker-1"), "users/speaker-1"), { bio: "Still here." }),
    );
    await assertSucceeds(
      updateDoc(doc(attendee("speaker-1"), "users/speaker-1"), {
        profileVisibility: "attendees_only",
      }),
    );
  });

  it("denies a self-update that touches the server-owned registrationStatus", async () => {
    await assertFails(
      updateDoc(doc(attendee("pending-1"), "users/pending-1"), {
        registrationStatus: "approved",
      }),
    );
    await assertFails(
      updateDoc(doc(attendee("pending-1"), "users/pending-1"), {
        displayName: "Sneaky",
        registrationStatus: "approved",
      }),
    );
  });

  it("denies a self-update that touches the server-owned speakerId", async () => {
    await assertFails(
      updateDoc(doc(attendee("pending-1"), "users/pending-1"), {
        speakerId: "spk-9",
      }),
    );
  });

  it("denies self-updates to the other server-owned fields", async () => {
    for (const patch of [
      { approvalSource: "admin" },
      { role: "admin" },
      { email: "someone-else@example.com" },
      // The seeded value is true, so flip it — a write that changes nothing
      // affects no keys and is a permitted no-op.
      { profileComplete: false },
      { uid: "someone-else" },
    ]) {
      await assertFails(
        updateDoc(doc(attendee("pending-1"), "users/pending-1"), patch),
      );
    }
  });

  it("denies an invalid profileVisibility and a non-list badges field", async () => {
    await assertFails(
      updateDoc(doc(attendee("pending-1"), "users/pending-1"), {
        profileVisibility: "everyone",
      }),
    );
    await assertFails(
      updateDoc(doc(attendee("pending-1"), "users/pending-1"), {
        badges: "writer",
      }),
    );
  });

  it("denies writing another attendee's account document", async () => {
    await assertFails(
      updateDoc(doc(attendee("approved-1"), "users/pending-1"), {
        displayName: "Not mine",
      }),
    );
    await assertFails(
      updateDoc(doc(admin(), "users/pending-1"), { displayName: "Not mine" }),
    );
  });

  it("denies client account creation and deletion (the auth trigger owns both)", async () => {
    const db = testEnv
      .authenticatedContext("brand-new", {
        email: "brand-new@example.com",
        email_verified: true,
      })
      .firestore();
    await assertFails(
      setDoc(doc(db, "users/brand-new"), {
        uid: "brand-new",
        registrationStatus: "approved",
        profileVisibility: "public",
        badges: [],
      }),
    );
    await assertFails(deleteDoc(doc(attendee("pending-1"), "users/pending-1")));
    await assertFails(deleteDoc(doc(admin(), "users/pending-1")));
  });
});

// The canonical speaker store and its one-way projection (spec §4.3,
// issue #20). The property under test: everything that would let a client
// break a reference outside the transaction that owns it is denied — and
// the canonical document's pipeline fields (email, inviteToken, uid) never
// reach a non-admin at all.
describe("speakers canonical store and speakers_public projection (spec §4.3)", () => {
  beforeAll(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "speakers/spk-1"), {
        firstName: "Demo",
        lastName: "Speaker",
        slug: "demo-speaker",
        email: "speaker@example.com",
        inviteToken: "tok_secret",
        status: "approved",
        uid: "speaker-1",
        approvedAt: new Date(),
      });
      await setDoc(doc(db, "speakers_public/spk-1"), {
        speakerId: "spk-1",
        firstName: "Demo",
        lastName: "Speaker",
        displayName: "Demo Speaker",
        slug: "demo-speaker",
        bio: "",
        headshotPath: null,
        organization: "",
        jobTitle: "",
        socialHandles: {},
      });
    });
  });

  it("denies the canonical speaker document to anonymous and non-admin clients", async () => {
    await assertFails(getDoc(doc(anon(), "speakers/spk-1")));
    await assertFails(getDoc(doc(nonAdmin(), "speakers/spk-1")));
    // Not even the linked speaker reads their own canonical record: the
    // invite token and the users.speakerId link half live on it.
    await assertFails(getDoc(doc(attendee("speaker-1"), "speakers/spk-1")));
    await assertFails(getDocs(collection(anon(), "speakers")));
  });

  it("allows an admin to read speakers, for the list and the session typeahead", async () => {
    await assertSucceeds(getDoc(doc(admin(), "speakers/spk-1")));
    await assertSucceeds(getDocs(collection(admin(), "speakers")));
  });

  it("denies every client write to speakers, admin included", async () => {
    // Every write is a Cloud Function (createSpeaker / updateSpeaker /
    // deleteSpeaker / the invite transaction) — that is what makes §4.3's
    // seams transactional rather than advisory.
    await assertFails(setDoc(doc(admin(), "speakers/spk-2"), { firstName: "New" }));
    await assertFails(updateDoc(doc(admin(), "speakers/spk-1"), { status: "removed" }));
    await assertFails(updateDoc(doc(admin(), "speakers/spk-1"), { uid: "attendee-1" }));
    await assertFails(deleteDoc(doc(admin(), "speakers/spk-1")));
    await assertFails(setDoc(doc(nonAdmin(), "speakers/spk-1"), { firstName: "Hijacked" }));
  });

  it("allows anyone to read the public projection", async () => {
    await assertSucceeds(getDoc(doc(anon(), "speakers_public/spk-1")));
    await assertSucceeds(getDoc(doc(nonAdmin(), "speakers_public/spk-1")));
    await assertSucceeds(getDocs(collection(anon(), "speakers_public")));
  });

  it("denies every client write to the projection, admin included", async () => {
    await assertFails(setDoc(doc(admin(), "speakers_public/spk-1"), { displayName: "Edited" }));
    await assertFails(setDoc(doc(anon(), "speakers_public/spk-9"), { displayName: "Injected" }));
    await assertFails(deleteDoc(doc(admin(), "speakers_public/spk-1")));
  });
});

describe("sessionBookmarks aggregate", () => {
  beforeAll(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "sessionBookmarks/session-1"), { count: 3 });
    });
  });

  it("allows anyone, including anonymous, to read the aggregate count", async () => {
    await assertSucceeds(getDoc(doc(anon(), "sessionBookmarks/session-1")));
    await assertSucceeds(getDoc(doc(nonAdmin(), "sessionBookmarks/session-1")));
  });

  it("denies all client writes, admin included", async () => {
    await assertFails(setDoc(doc(admin(), "sessionBookmarks/session-1"), { count: 99 }));
    await assertFails(setDoc(doc(nonAdmin(), "sessionBookmarks/session-1"), { count: 99 }));
  });
});
