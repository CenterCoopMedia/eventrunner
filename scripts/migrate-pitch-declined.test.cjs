'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../console/functions/src/fakes.cjs');
const { migratePitchDeclined } = require('./migrate-pitch-declined.cjs');

const SENT = { state: 'sent', attempt: 1, templateId: 'pitch.declined', onceKey: 'pitch-notice:p1:rejected:1' };

test('rewrites rejected pitches and their decline email record to declined, once', async () => {
  const db = makeFakeDb({
    'session_pitches/p1': { status: 'rejected', reviewRevision: 4, notices: { receipt: { state: 'sent' }, rejected: SENT } },
    'session_pitches/p2': { status: 'accepted', reviewRevision: 2, notices: { rejected: SENT, accepted: { state: 'sent' } } },
    'session_pitches/p3': { status: 'rejected', reviewRevision: 1 },
    'session_pitches/p4': { status: 'new', reviewRevision: 0 },
    // Both records: the newer `declined` one wins, so the old one is kept, not merged.
    'session_pitches/p5': { status: 'declined', notices: { rejected: SENT, declined: { state: 'failed', attempt: 2 } } },
  });
  assert.deepEqual(await migratePitchDeclined({ db }), { statusRewritten: 2, noticeMoved: 2, noticeKept: 1 });
  assert.deepEqual(db.read('session_pitches/p1'), { status: 'declined', reviewRevision: 4, notices: { receipt: { state: 'sent' }, declined: SENT } });
  assert.deepEqual(db.read('session_pitches/p2'), { status: 'accepted', reviewRevision: 2, notices: { declined: SENT, accepted: { state: 'sent' } } });
  assert.deepEqual(db.read('session_pitches/p3'), { status: 'declined', reviewRevision: 1 });
  assert.deepEqual(db.read('session_pitches/p4'), { status: 'new', reviewRevision: 0 });
  assert.deepEqual(db.read('session_pitches/p5').notices.rejected, SENT);
  assert.equal(db.read('data_migrations/pitch-declined-2026-11-08').complete, true);
  assert.deepEqual(await migratePitchDeclined({ db }), { skipped: true });
});
