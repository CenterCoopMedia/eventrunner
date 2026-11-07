'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../console/functions/src/fakes.cjs');
const { migrateSecurityData } = require('./migrate-security-data.cjs');

test('migration removes public actor data and orphaned projections while retaining canonical records and object content', async () => {
  const db = makeFakeDb({
    'config/registration_form': { revision: 3, updatedBy: 'operator@example.test', custom: [] },
    'speaker_logistics/gone': { travel: 'Private travel details' },
    'speaker_logistics/kept': { travel: 'Retained for the current speaker' }, 'speakers/kept': {},
    'schedule_shares/gone': { sessionIds: ['private-interest'] },
    'schedule_shares/kept': { sessionIds: ['session'] }, 'users/kept': {},
    'users/inherited': { profileVisibility: 'public', updatedAt: new Date(1000) },
    'users/edited': { profileVisibility: 'public', updatedAt: new Date(2000) },
    ...Object.fromEntries(['inherited', 'edited'].map((uid) => [`ticket_answers/${uid}`, {
      uid, updatedBy: 'checkout', updatedAt: new Date(1000),
      answers: { organization: 'Gazette', directoryListing: 'public', photoConsent: true },
      questions: [{ id: 'directoryListing' }, { id: 'photoConsent' }, { id: 'organization' }],
    }])),
  });
  const patches = [];
  const bucket = { async getFiles() { return [[{
    async getMetadata() { return [{ metadata: { uploadedBy: 'operator@example.test', seeded: 'false' }, metageneration: '2' }]; },
    async setMetadata(patch, options) { patches.push({ patch, options }); },
  }], null]; } };
  assert.deepEqual(await migrateSecurityData({ db, bucket }), {
    publicActorRemoved: 1, orphanLogisticsRemoved: 1, orphanSharesRemoved: 1, photoMetadataCleaned: 1, checkoutConsentRemoved: 2, inheritedVisibilityReset: 2,
  });
  assert.deepEqual(db.read('config/registration_form'), { revision: 3, custom: [] });
  assert.equal(db.read('speaker_logistics/gone'), undefined);
  assert.equal(db.read('schedule_shares/gone'), undefined);
  assert.ok(db.read('speaker_logistics/kept'));
  assert.ok(db.read('schedule_shares/kept'));
  assert.equal(db.read('users/inherited').profileVisibility, 'private');
  assert.equal(db.read('users/edited').profileVisibility, 'private');
  assert.deepEqual(db.read('ticket_answers/inherited').answers, { organization: 'Gazette' });
  assert.deepEqual(patches, [{ patch: { metadata: { uploadedBy: null, uploadedByUid: null } }, options: { ifMetagenerationMatch: '2' } }]);
});
