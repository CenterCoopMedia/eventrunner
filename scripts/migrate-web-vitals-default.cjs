'use strict';

const { SEED_ACTOR } = require('shared/seed');

/** Remove the old seed's false default without changing a client's choice. */
async function migrateWebVitalsDefault({ db }) {
  const ref = db.collection('config').doc('features');
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const { coreWebVitals, ...features } = snap.data() ?? {};
    if (coreWebVitals !== false || features.updatedBy !== SEED_ACTOR.email) return false;
    tx.set(ref, features);
    return true;
  });
}

if (require.main === module) {
  const { initFirebase } = require('./lib/firebase-init.cjs');
  const { db } = initFirebase({ env: process.env });
  migrateWebVitalsDefault({ db })
    .then((changed) => console.log(changed ? 'Field performance default applied.' : 'Field performance setting unchanged.'))
    .catch(() => {
      console.error('Could not apply the field performance default.');
      process.exitCode = 1;
    });
}

module.exports = { migrateWebVitalsDefault };
