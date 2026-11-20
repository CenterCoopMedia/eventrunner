'use strict';

const { isValidDocId } = require('../functions/src/cms/store.cjs');
const { SPEAKER_INVITES } = require('../functions/src/speakers/inviteTokens.cjs');
const { initFirebase } = require('./lib/firebase-init.cjs');

const PAGE_SIZE = 200;
const MARKER = 'speaker-invite-orphans-2026-11-19';

async function findOrphans({ db, reader, page }) {
  const speakers = db.collection('speakers');
  const candidates = page.docs.flatMap((invite) => {
    const { speakerId } = invite.data();
    return isValidDocId(speakerId) ? [{ ref: invite.ref, speakerId }] : [];
  });
  if (!candidates.length) return [];

  const speakerIds = new Set(candidates.map(({ speakerId }) => speakerId));
  const parents = await reader.getAll(...Array.from(speakerIds, (id) => speakers.doc(id)), { fieldMask: ['status'] });
  const missing = new Set(parents.filter((parent) => !parent.exists).map((parent) => parent.id));
  return candidates.filter(({ speakerId }) => missing.has(speakerId));
}

async function sweepOrphanSpeakerInvites({ db, dryRun = true, now = () => new Date() }) {
  const marker = db.collection('data_migrations').doc(MARKER);
  const invites = db.collection(SPEAKER_INVITES).orderBy('__name__').select('speakerId').limit(PAGE_SIZE);
  let cursor;
  let orphans = 0;
  for (;;) {
    const query = cursor === undefined ? invites : invites.startAfter(cursor);
    if (dryRun) {
      const page = await query.get();
      orphans += (await findOrphans({ db, reader: db, page })).length;
      if (page.size < PAGE_SIZE) return { orphans };
      cursor = page.docs.at(-1).id;
      continue;
    }

    const batch = await db.runTransaction(async (tx) => {
      const progress = (await tx.get(marker)).data();
      if (progress?.complete) return { result: { skipped: true } };

      const page = await tx.get(query);
      const removals = await findOrphans({ db, reader: tx, page });
      const deleted = (progress?.totals?.deleted ?? 0) + removals.length;
      for (const { ref } of removals) tx.delete(ref);

      // Commit the count alongside each deletion batch so an interrupted
      // sweep can rescan from the beginning and retain its full audit total.
      const complete = page.size < PAGE_SIZE;
      if (complete || removals.length) {
        tx.set(marker, { complete, totals: { deleted }, ...(complete ? { completedAt: now() } : {}) });
      }
      return complete ? { result: { deleted } } : { cursor: page.docs.at(-1).id };
    });
    if (batch.result) return batch.result;
    cursor = batch.cursor;
  }
}

async function runCli({ args, init = initFirebase, log = console }) {
  if (args.length !== 1 || !['--dry-run', '--apply'].includes(args[0])) {
    log.error('Usage: EVENT_FIREBASE_PROJECT_ID=<client-project-id> node scripts/sweep-orphan-speaker-invites.cjs --dry-run|--apply');
    return 2;
  }
  try {
    const { db } = init();
    const result = await sweepOrphanSpeakerInvites({ db, dryRun: args[0] === '--dry-run' });
    log.log(JSON.stringify(result));
    return 0;
  } catch {
    log.error('Speaker invitation sweep failed. Verify the client project and Firestore access, then retry.');
    return 1;
  }
}

if (require.main === module) {
  runCli({ args: process.argv.slice(2) }).then((code) => { process.exitCode = code; });
}

module.exports = { runCli, sweepOrphanSpeakerInvites };
