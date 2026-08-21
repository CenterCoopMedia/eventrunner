'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { main, readDeployment } = require('./generate-content.cjs');

const ROOT = path.resolve(__dirname, '..');

/**
 * Minimal Firestore read fake. The cms test fake deliberately exposes no
 * unfiltered `collection().get()` (nothing in functions/ does one);
 * readDeployment does, so it gets a fake shaped for reads only.
 *
 * @param {{ config?: Record<string, object|null>,
 *           collections?: Record<string, Array<object>>,
 *           failing?: string[] }} seed
 */
function readFake({ config = {}, collections = {}, failing = [] } = {}) {
  const list = (name) => {
    if (failing.includes(name)) throw new Error(`transient read failure reading ${name}`);
    // `__id` is the document id; everything else is the stored data,
    // which may itself contain a field named `id`.
    return (collections[name] || []).map(({ __id, ...data }) => ({ id: __id, data: () => data }));
  };
  return {
    collection(name) {
      return {
        doc: (id) => ({ _col: name, id }),
        async get() {
          const docs = list(name);
          return { docs, size: docs.length, empty: docs.length === 0 };
        },
        // readVisibleCollection queries `visible == true` server-side
        // (spec §8.4 point 4) — filtered in-memory here, '==' only, which
        // is all generate-content.cjs issues.
        where(field, op, value) {
          if (op !== '==') throw new Error(`readFake: unsupported operator ${op}`);
          return {
            async get() {
              const docs = list(name).filter((d) => d.data()[field] === value);
              return { docs, size: docs.length, empty: docs.length === 0 };
            },
          };
        },
      };
    },
    async getAll(...refs) {
      return refs.map((ref) => {
        const data = config[ref.id] ?? null;
        return { exists: data !== null, data: () => data };
      });
    },
  };
}

const CONFIG = { event: { name: 'x' }, features: {}, theme: { colors: {} } };

function quietly(fn) {
  const log = console.log;
  const error = console.error;
  const output = [];
  console.log = (...a) => output.push(a.join(' '));
  console.error = (...a) => output.push(a.join(' '));
  return Promise.resolve()
    .then(fn)
    .then((value) => ({ value, output: output.join('\n') }))
    .finally(() => { console.log = log; console.error = error; });
}

test('--demo --check passes against the committed snapshot', async () => {
  const { value } = await quietly(() => main(['--demo', '--check']));
  assert.equal(value, 0);
});

test('reading a real project refuses ANY output path inside the repository', async () => {
  // Not just the committed directory: a client's real event config landing
  // anywhere in the checkout of a public repo is the §8.6 hazard, and it
  // is one `git add -A` from being committed.
  for (const out of ['apps/web/src/generated', 'apps/web/client-generated', '.', 'scripts/../tmp-out']) {
    const { value, output } = await quietly(() => main(['--out', out]));
    assert.equal(value, 2, `--out ${out} should have been refused`);
    assert.match(output, /Refusing to write a real deployment inside the repository/);
  }
});

test('a sibling directory whose name starts with the repo name is not "inside" it', async () => {
  // Prefix matching would reject /work/run-of-show-out; path containment
  // must not be a string test. Getting past the guard means reaching the
  // credential resolver, which has nothing to work with in a test.
  const sibling = `${ROOT}-out`;
  await quietly(() => assert.rejects(
    () => main(['--out', sibling]),
    /EVENT_FIREBASE_PROJECT_ID/,
  ));
});

test('--demo may write inside the repo: that is what the committed snapshot is', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-content-'));
  const { value } = await quietly(() => main(['--demo', '--out', tmp]));
  assert.equal(value, 0);
  assert.equal(fs.existsSync(path.join(tmp, 'eventConfig.js')), true);
});

test('a stored `id` field never overrides the document id', async () => {
  // cmsPages docs legitimately carry an `id` field (§5.2). Spreading it
  // after doc.id would key the emitted set by the stored field, so two
  // documents could collapse onto one entry.
  const db = readFake({
    config: CONFIG,
    collections: {
      // Both documents carry a stale stored `id` of 'home'.
      cmsPages: [
        { __id: 'faq', id: 'home', label: 'FAQ', path: '/faq', visible: true },
        { __id: 'travel', id: 'home', label: 'Travel', path: '/travel', visible: true },
      ],
    },
  });
  const snapshot = await readDeployment({ db });
  assert.deepEqual(snapshot.pages.map((p) => p.id).sort(), ['faq', 'travel']);
});

test('a failing collection read fails generation instead of shipping an empty section', async () => {
  const db = readFake({ config: CONFIG, failing: ['speakers_public'] });
  await assert.rejects(() => readDeployment({ db }), /transient read failure/);
});

test('a missing config document names itself rather than emitting a broken bundle', async () => {
  const db = readFake({ config: {} });
  await assert.rejects(() => readDeployment({ db }), /config\/event is missing/);
});

// Regression guard for the bug this section exists to catch: unpublish
// (spec §8.4 point 4) sets `visible: false` on the LIVE doc without
// deleting it — reading the live collection unfiltered would ship an
// explicitly-unpublished doc into the public JS bundle.
test('readDeployment filters every publishable collection to visible docs only', async () => {
  const db = readFake({
    config: CONFIG,
    collections: {
      cmsPages: [{ __id: 'home', path: '/', visible: true }, { __id: 'hidden', path: '/hidden', visible: false }],
      cmsContent: [{ __id: 'a', visible: true }, { __id: 'b', visible: false }],
      cmsSchedule: [{ __id: 's1', visible: true }, { __id: 's2', visible: false }],
      cmsOrganizations: [{ __id: 'o1', visible: true }, { __id: 'o2', visible: false }],
    },
  });

  const snapshot = await readDeployment({ db });

  assert.deepEqual(snapshot.pages.map((d) => d.id), ['home']);
  assert.deepEqual(snapshot.content.map((d) => d.id), ['a']);
  assert.deepEqual(snapshot.sessions.map((d) => d.id), ['s1']);
  assert.deepEqual(snapshot.organizations.map((d) => d.id), ['o1']);
});

test('an unpublished (visible: false) live doc never reaches the snapshot', async () => {
  const db = readFake({
    config: CONFIG,
    collections: { cmsContent: [{ __id: 'secret', title: 'should never ship', visible: false }] },
  });

  const snapshot = await readDeployment({ db });

  assert.deepEqual(snapshot.content, []);
});

// Speakers come from the one-way `speakers_public` projection, never from
// the canonical `speakers` store (spec §4.3): the canonical record carries
// `email`, `uid`, and `inviteToken`, and the bundle is publicly served
// JavaScript. The projection also has no `visible` field — a speaker who
// is not `approved` simply has no document there — so it is read
// unfiltered.
test('speakers are read from speakers_public, never from the canonical store', async () => {
  const db = readFake({
    config: CONFIG,
    collections: {
      speakers: [{ __id: 'canonical', firstName: 'A', email: 'a@example.org', inviteToken: 'tok' }],
      speakers_public: [{ __id: 's1', speakerId: 's1', displayName: 'A B' }],
    },
  });

  const snapshot = await readDeployment({ db });

  assert.deepEqual(snapshot.speakers.map((d) => d.id), ['s1']);
  assert.equal('email' in snapshot.speakers[0], false);
  assert.equal('inviteToken' in snapshot.speakers[0], false);
  // `speakerId` is the doc id under another name; the snapshot keys on `id`.
  assert.equal('speakerId' in snapshot.speakers[0], false);
});

test('--demo --check flags an unexpected extra file, not just content differences', async () => {
  // A byte-for-byte match on the expected six files is not the whole
  // hygiene gate — it says nothing about an EXTRA file sitting in the
  // directory (a leaked real-deployment artifact, a stray debug file).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-content-check-'));
  await quietly(() => main(['--demo', '--out', tmp]));
  fs.writeFileSync(path.join(tmp, 'leaked-client-data.js'), 'export const secret = 1;\n');

  const { value, output } = await quietly(() => main(['--demo', '--out', tmp, '--check']));

  assert.equal(value, 1);
  assert.match(output, /unexpected file/);
  assert.match(output, /leaked-client-data\.js/);
});
