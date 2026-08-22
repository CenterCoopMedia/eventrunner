// Storage rules tests, run against the emulator via `npm run test:rules`.
// Pins the v1 rules from docs/adr/0001-event-platform-v1.md §8.5:
//
//   • `profile-photos/{uid}/**` is the ONLY client-writable namespace, and
//     only for its owner, only for an image, only under 2 MiB;
//   • `cms-images/`, `branding/`, and `speaker-photos/` are fetchable but
//     never writable by a client — their writers are admin-gated functions
//     using the Admin SDK, which bypasses these rules;
//   • reads are `get` only: no namespace grants `list`, so no client can
//     enumerate the bucket and read back assets that only unpublished
//     drafts reference (the leak firestore.rules keeps `media_assets`
//     admin-only to prevent);
//   • `session-materials/` is closed on both verbs (embargo is a per-request
//     decision, not a static grant);
//   • everything else is denied by the catch-all.
//
// Every read assertion targets an object seeded through
// withSecurityRulesDisabled. Without the seed, getBytes rejects with
// storage/object-not-found even under allow-all rules, and assertFails
// accepts any rejection — the read assertions would be vacuously green.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteObject, getBytes, listAll, ref, uploadBytes } from "firebase/storage";

const OWNER = "attendee-1";
const OTHER = "attendee-2";

/** A 2 MiB budget with a little headroom either side of the rule's limit. */
const TWO_MIB = 2 * 1024 * 1024;

/** Objects seeded before the suite so read assertions are not vacuous. */
const SEEDED = [
  `profile-photos/${OWNER}/avatar.png`,
  "speaker-photos/speaker-1/headshot.png",
  "cms-images/asset-1/hero.png",
  "branding/logo.svg",
  "session-materials/session-1/slides.pdf",
  "exports/schedule.pdf",
  "unclaimed/whatever.png",
];

let testEnv;

/** A PNG-ish payload of the requested size. */
function bytes(size = 8) {
  return new Uint8Array(size).fill(1);
}

/** Upload helper: uploadBytes with an explicit content type. */
function put(storage, path, { contentType = "image/png", size = 8 } = {}) {
  return uploadBytes(ref(storage, path), bytes(size), { contentType });
}

function anon() {
  return testEnv.unauthenticatedContext().storage();
}

function asUser(uid) {
  return testEnv
    .authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true })
    .storage();
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-run-of-show",
    storage: { rules: readFileSync("storage.rules", "utf8") },
  });
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const storage = context.storage();
    for (const path of SEEDED) {
      await uploadBytes(ref(storage, path), bytes(), { contentType: "image/png" });
    }
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe("profile-photos/{uid} — the one client-writable namespace", () => {
  it("lets the owner write their own photo", async () => {
    await assertSucceeds(put(asUser(OWNER), `profile-photos/${OWNER}/avatar.png`));
  });

  it("lets the owner write into a nested path under their own prefix", async () => {
    await assertSucceeds(put(asUser(OWNER), `profile-photos/${OWNER}/thumbs/small.png`));
  });

  it("denies writing another user's photo — the hole §8.5 names", async () => {
    await assertFails(put(asUser(OTHER), `profile-photos/${OWNER}/avatar.png`));
  });

  it("denies an unauthenticated write", async () => {
    await assertFails(put(anon(), `profile-photos/${OWNER}/avatar.png`));
  });

  it("denies a photo at or over the 2 MiB cap", async () => {
    await assertFails(
      put(asUser(OWNER), `profile-photos/${OWNER}/huge.png`, { size: TWO_MIB }),
    );
  });

  it("allows a photo just under the 2 MiB cap", async () => {
    await assertSucceeds(
      put(asUser(OWNER), `profile-photos/${OWNER}/big.png`, { size: TWO_MIB - 1024 }),
    );
  });

  it("allows jpeg and webp", async () => {
    await assertSucceeds(
      put(asUser(OWNER), `profile-photos/${OWNER}/a.jpg`, { contentType: "image/jpeg" }),
    );
    await assertSucceeds(
      put(asUser(OWNER), `profile-photos/${OWNER}/a.webp`, { contentType: "image/webp" }),
    );
  });

  it("denies a non-image content type", async () => {
    await assertFails(
      put(asUser(OWNER), `profile-photos/${OWNER}/a.pdf`, { contentType: "application/pdf" }),
    );
  });

  it("denies image/svg+xml — a stored SVG is a script-execution surface", async () => {
    await assertFails(
      put(asUser(OWNER), `profile-photos/${OWNER}/a.svg`, { contentType: "image/svg+xml" }),
    );
  });

  it("denies a content type that merely contains an allowed one", async () => {
    // matches() is a full-string match; this pins that it stays one.
    await assertFails(
      put(asUser(OWNER), `profile-photos/${OWNER}/a.png`, {
        contentType: "application/image/png",
      }),
    );
  });

  it("is publicly readable", async () => {
    await assertSucceeds(getBytes(ref(anon(), `profile-photos/${OWNER}/avatar.png`)));
  });

  it("lets the owner delete their own photo", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(ref(context.storage(), `profile-photos/${OWNER}/gone.png`), bytes(), {
        contentType: "image/png",
      });
    });
    await assertSucceeds(deleteObject(ref(asUser(OWNER), `profile-photos/${OWNER}/gone.png`)));
  });

  it("denies deleting another user's photo", async () => {
    await assertFails(deleteObject(ref(asUser(OTHER), `profile-photos/${OWNER}/avatar.png`)));
  });
});

describe("cms-images — server-authorized writes only (§8.5)", () => {
  it("denies an authenticated client write", async () => {
    // The legacy hole this rule closes: any signed-in user could write here.
    await assertFails(put(asUser(OTHER), "cms-images/asset-9/hero.png"));
  });

  it("denies an unauthenticated write", async () => {
    await assertFails(put(anon(), "cms-images/asset-9/hero.png"));
  });

  it("denies a client delete", async () => {
    await assertFails(deleteObject(ref(asUser(OTHER), "cms-images/asset-1/hero.png")));
  });

  it("is publicly readable", async () => {
    await assertSucceeds(getBytes(ref(anon(), "cms-images/asset-1/hero.png")));
  });
});

describe("branding — server-authorized writes only (§8.5)", () => {
  it("denies an authenticated client write", async () => {
    await assertFails(put(asUser(OTHER), "branding/logo.svg"));
  });

  it("denies a client delete", async () => {
    await assertFails(deleteObject(ref(asUser(OTHER), "branding/logo.svg")));
  });

  it("is publicly readable", async () => {
    await assertSucceeds(getBytes(ref(anon(), "branding/logo.svg")));
  });
});

describe("speaker-photos — server-authorized writes only (§8.5)", () => {
  it("denies a write even from the matching uid", async () => {
    // The path segment is a speakerId, not a uid, and ownership is a
    // Firestore fact these rules cannot read: updateSpeakerProfile decides.
    await assertFails(put(asUser("speaker-1"), "speaker-photos/speaker-1/headshot.png"));
  });

  it("denies an unauthenticated write", async () => {
    await assertFails(put(anon(), "speaker-photos/speaker-1/headshot.png"));
  });

  it("is publicly readable", async () => {
    await assertSucceeds(getBytes(ref(anon(), "speaker-photos/speaker-1/headshot.png")));
  });
});

describe("session-materials — closed on both verbs", () => {
  it("denies reads even for an authenticated user (embargo is per-request)", async () => {
    await assertFails(getBytes(ref(asUser(OTHER), "session-materials/session-1/slides.pdf")));
  });

  it("denies writes", async () => {
    await assertFails(
      put(asUser(OTHER), "session-materials/session-1/slides.pdf", {
        contentType: "application/pdf",
      }),
    );
  });
});

describe("exports — readable output, never client-written", () => {
  it("is publicly readable", async () => {
    await assertSucceeds(getBytes(ref(anon(), "exports/schedule.pdf")));
  });

  it("denies a client write", async () => {
    await assertFails(
      put(asUser(OTHER), "exports/schedule.pdf", { contentType: "application/pdf" }),
    );
  });
});

// `get` is what rendering needs (fetch THIS object by its known path);
// `list` is enumeration and is granted nowhere. Both the namespace root and
// a nested prefix are pinned: a rule that granted list at one depth and not
// the other would still be an enumeration hole.
describe("no namespace grants list — enumeration is denied everywhere", () => {
  for (const prefix of [
    "cms-images",
    "cms-images/asset-1",
    "branding",
    "speaker-photos",
    `profile-photos/${OWNER}`,
    "exports",
  ]) {
    it(`denies an anonymous listing of ${prefix}`, async () => {
      await assertFails(listAll(ref(anon(), prefix)));
    });

    it(`denies an authenticated listing of ${prefix}`, async () => {
      await assertFails(listAll(ref(asUser(OTHER), prefix)));
    });
  }

  it("still allows the owner to fetch their own photo by path", async () => {
    // The counterpart the list denial must not break: get is what the site
    // actually uses, and it still works for everyone.
    await assertSucceeds(getBytes(ref(asUser(OWNER), `profile-photos/${OWNER}/avatar.png`)));
  });
});

describe("unmatched namespaces stay denied", () => {
  it("denies reads", async () => {
    await assertFails(getBytes(ref(asUser(OTHER), "unclaimed/whatever.png")));
  });

  it("denies writes", async () => {
    await assertFails(put(asUser(OTHER), "uploads/attendee-1/a.png"));
  });

  it("denies a write to a bare profile-photos path with no uid segment", async () => {
    await assertFails(put(asUser(OWNER), "profile-photos/loose.png"));
  });
});
