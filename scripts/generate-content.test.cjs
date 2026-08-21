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
  return {
    collection(name) {
      return {
        doc: (id) => ({ _col: name, id }),
        async get() {
          if (failing.includes(name)) throw new Error(`transient read failure reading ${name}`);
          // `__id` is the document id; everything else is the stored data,
          // which may itself contain a field named `id`.
          const docs = (collections[name] || []).map(({ __id, ...data }) => ({ id: __id, data: () => data }));
          return { docs, size: docs.length, empty: docs.length === 0 };
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
        { __id: 'faq', id: 'home', label: 'FAQ', path: '/faq' },
        { __id: 'travel', id: 'home', label: 'Travel', path: '/travel' },
      ],
    },
  });
  const snapshot = await readDeployment({ db });
  assert.deepEqual(snapshot.pages.map((p) => p.id).sort(), ['faq', 'travel']);
});

test('a failing collection read fails generation instead of shipping an empty section', async () => {
  const db = readFake({ config: CONFIG, failing: ['speakers'] });
  await assert.rejects(() => readDeployment({ db }), /transient read failure/);
});

test('a missing config document names itself rather than emitting a broken bundle', async () => {
  const db = readFake({ config: {} });
  await assert.rejects(() => readDeployment({ db }), /config\/event is missing/);
});
