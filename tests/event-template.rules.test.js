// Two event deployments made from one template stay isolated (issue #328).
//
// Runs against the real Firestore emulator with two distinct demo-*
// project ids: a past event is initialized and filled with synthetic
// records, its template is exported, and a new event is initialized from
// that template in its own project. The test then proves, through the
// Admin SDK and through the security rules, that nothing but the template
// crossed over and that neither project's accounts reach the other.
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const { runInit } = require('../scripts/init-event.cjs');
const { runExport } = require('../scripts/export-event-template.cjs');
const store = require('../functions/src/cms/store.cjs');
const {
  SOURCE, TARGET, ENV_FOR, tierAFor, pastEventAnswers, nextEventAnswers, operationalRecords,
} = require('../scripts/lib/event-template.fixtures.cjs');

const RULES = readFileSync('firestore.rules', 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'event-template-'));
const envs = {};
const apps = {};
const dbs = {};

function file(name, value) {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

async function quietly(fn) {
  const saved = [console.log, console.warn, console.error];
  const output = [];
  console.log = (...a) => output.push(a.join(' '));
  console.warn = console.log;
  console.error = console.log;
  try {
    return { value: await fn(), output: output.join('\n') };
  } finally {
    [console.log, console.warn, console.error] = saved;
  }
}

function init(projectId, args) {
  return quietly(() => runInit({
    db: dbs[projectId],
    store,
    bucket: () => { throw new Error('no bucket'); },
    args: { 'skip-branding': true, ...args },
    tierA: tierAFor(projectId),
    env: { ...ENV_FOR(projectId), FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST },
    now: () => Date.parse('2026-10-19T12:00:00Z'),
  }));
}

function client(projectId, uid, email) {
  return envs[projectId].authenticatedContext(uid, { email, email_verified: true }).firestore();
}

async function size(projectId, name) {
  return (await dbs[projectId].collection(name).get()).size;
}

beforeAll(async () => {
  for (const projectId of [SOURCE, TARGET]) {
    envs[projectId] = await initializeTestEnvironment({ projectId, firestore: { rules: RULES } });
    await envs[projectId].clearFirestore();
    apps[projectId] = initializeApp({ projectId }, `event-template-${projectId}-${process.pid}`);
    dbs[projectId] = getFirestore(apps[projectId]);
  }

  // The past event: initialized, then used.
  const past = await init(SOURCE, { answers: file('past.json', pastEventAnswers()), admin: ['past-ops@example.test'] });
  expect(past.value, past.output).toBe(0);
  for (const [path, data] of Object.entries(operationalRecords())) {
    await dbs[SOURCE].doc(path).set(data);
  }
  await dbs[SOURCE].doc('config/theme').update({ radius: 'round' });

  // Its template, then the next event from it, in a separate project.
  const out = join(dir, 'template.json');
  const exported = await quietly(() => runExport({ db: dbs[SOURCE], projectId: SOURCE, args: { out } }));
  expect(exported.value, exported.output).toBe(0);
  const next = await init(TARGET, {
    answers: file('next.json', nextEventAnswers()),
    admin: ['next-ops@example.test', 'next-owner@example.test'],
    template: out,
  });
  expect(next.value, next.output).toBe(0);
});

afterAll(async () => {
  for (const projectId of [SOURCE, TARGET]) {
    await envs[projectId]?.clearFirestore();
    await envs[projectId]?.cleanup();
    if (apps[projectId]) await deleteApp(apps[projectId]);
  }
});

describe('two event deployments from one template', () => {
  it('carries the reviewed template and none of the past event\'s records', async () => {
    const event = (await dbs[TARGET].doc('config/event').get()).data();
    expect(event.name).toBe('Next Example Summit');
    expect(event.legal.operatorName).toBe('Example Newsroom Network');
    expect((await dbs[TARGET].doc('config/theme').get()).data().radius).toBe('round');
    expect((await dbs[TARGET].doc('config/bootstrap').get()).data().adminEmails)
      .toEqual(['next-ops@example.test', 'next-owner@example.test']);

    for (const path of Object.keys(operationalRecords())) {
      const name = path.split('/')[0];
      expect(await size(TARGET, name), `${name} in ${TARGET}`).toBe(0);
      expect(await size(SOURCE, name), `${name} in ${SOURCE}`).toBe(1);
    }
    expect((await dbs[SOURCE].doc('config/event').get()).data().name).toBe('Past Example Summit');
    expect((await dbs[SOURCE].doc('config/template').get()).exists).toBe(false);
  });

  it('keeps each project\'s operators out of the other project', async () => {
    await assertSucceeds(getDocs(collection(client(SOURCE, 'past-op', 'past-ops@example.test'), 'admin_logs')));
    await assertFails(getDocs(collection(client(TARGET, 'past-op', 'past-ops@example.test'), 'admin_logs')));
    await assertSucceeds(getDocs(collection(client(TARGET, 'next-op', 'next-ops@example.test'), 'admin_logs')));
    await assertFails(getDocs(collection(client(SOURCE, 'next-op', 'next-ops@example.test'), 'admin_logs')));
  });

  it('gives a returning attendee no account in the new project', async () => {
    const own = await assertSucceeds(getDoc(doc(client(SOURCE, 'attendee-1', 'attendee@example.test'), 'users/attendee-1')));
    expect(own.exists()).toBe(true);
    const fresh = await assertSucceeds(getDoc(doc(client(TARGET, 'attendee-1', 'attendee@example.test'), 'users/attendee-1')));
    expect(fresh.exists()).toBe(false);
  });

  it('keeps a later edit in one project out of the other', async () => {
    await dbs[TARGET].doc('config/theme').update({ radius: 'sharp' });
    expect((await dbs[SOURCE].doc('config/theme').get()).data().radius).toBe('round');
  });
});
