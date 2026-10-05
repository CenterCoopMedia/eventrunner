// API smoke for the session pitch lifecycle against deployed Functions,
// Auth, and Firestore emulators. All identities use reserved example.test
// addresses. No browser page or ticket is involved.
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import {
  adminDb, adminIdToken, callFunction, ensureUser, idTokenFor,
} from './helpers.mjs';

const SUBMITTER_EMAIL = 'e2e-pitch-submitter@example.test';
const STAFF_EMAIL = 'e2e-pitch-staff@example.test';
const CLOSES_AT = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

test('a signed-in account submits a private pitch and staff reviews it without a ticket', async () => {
  const db = adminDb();
  const config = db.collection('config');
  const bootstrapRef = config.doc('bootstrap');
  const callRef = config.doc('pitch_call');
  const bootstrapBefore = await bootstrapRef.get();
  const callBefore = await callRef.get();
  const createdAuditIds = [];

  const submitterUid = await ensureUser(SUBMITTER_EMAIL);
  const staffUid = await ensureUser(STAFF_EMAIL);
  const submissionKey = `pitch-smoke-${Date.now()}`;
  const pitchId = createHash('sha256')
    .update(`${submitterUid}\0${submissionKey}`)
    .digest('hex');
  const rateId = createHash('sha256').update(submitterUid).digest('hex');

  try {
    const bootstrap = bootstrapBefore.data() || {};
    await bootstrapRef.set({
      ...bootstrap,
      staffEmails: [...new Set([...(bootstrap.staffEmails || []), STAFF_EMAIL])],
    });

    const operatorToken = await adminIdToken();
    const staffToken = await idTokenFor(staffUid);
    const submitterToken = await idTokenFor(submitterUid);

    const opened = await callFunction('updatePitchCall', { enabled: true, closesAt: CLOSES_AT }, operatorToken);
    expect(opened).toEqual({ status: 200, body: { enabled: true, closesAt: CLOSES_AT } });

    const payload = {
      title: 'Building durable local reporting partnerships',
      description: 'A practical discussion of shared reporting and distribution workflows.',
      organization: 'Example newsroom',
      format: 'Panel',
      submissionKey,
      uid: 'forged-uid',
      email: 'forged@example.test',
    };
    const submitted = await callFunction('submitSessionPitch', payload, submitterToken);
    expect(submitted).toEqual({ status: 201, body: { id: pitchId, ok: true } });
    expect(await callFunction('submitSessionPitch', payload, submitterToken)).toEqual(submitted);

    const stored = (await db.collection('session_pitches').doc(pitchId).get()).data();
    expect(stored).toMatchObject({
      uid: submitterUid,
      email: SUBMITTER_EMAIL,
      status: 'new',
      reviewRevision: 0,
    });
    expect((await db.collection('tickets').where('email', '==', SUBMITTER_EMAIL).get()).empty).toBe(true);

    const reviewed = await callFunction('reviewSessionPitch', {
      id: pitchId,
      status: 'in_review',
      expectedStatus: 'new',
      expectedRevision: 0,
      privateNotes: 'Confirm the final presenter list.',
    }, staffToken);
    expect(reviewed).toEqual({
      status: 200,
      body: { id: pitchId, status: 'in_review', revision: 1 },
    });

    const after = (await db.collection('session_pitches').doc(pitchId).get()).data();
    expect(after).toMatchObject({
      status: 'in_review',
      reviewRevision: 1,
      privateNotes: 'Confirm the final presenter list.',
      reviewedBy: STAFF_EMAIL,
    });
    expect((await db.collection('cmsSchedule').doc(pitchId).get()).exists).toBe(false);
    const user = await db.collection('users').doc(submitterUid).get();
    if (user.exists) expect(user.data().role).toBe('attendee');

    for (const doc of (await db.collection('admin_logs').where('docPath', 'in', [
      'config/pitch_call',
      `session_pitches/${pitchId}`,
    ]).get()).docs) createdAuditIds.push(doc.id);
  } finally {
    await Promise.all([
      db.collection('session_pitches').doc(pitchId).delete(),
      db.collection('session_pitch_rate_limits').doc(rateId).delete(),
      ...createdAuditIds.map((id) => db.collection('admin_logs').doc(id).delete()),
    ]);
    if (bootstrapBefore.exists) await bootstrapRef.set(bootstrapBefore.data());
    else await bootstrapRef.delete();
    if (callBefore.exists) await callRef.set(callBefore.data());
    else await callRef.delete();
  }
});
