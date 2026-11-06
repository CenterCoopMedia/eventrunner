'use strict';

// Run with the client project's operator credentials. DNS must remain owned
// until Firebase sign-in authorization and Hosting have both been revoked.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { removeWebAddress, realClients } = require('../functions/src/admin/webAddress.cjs');
const projectId = process.env.EVENT_FIREBASE_PROJECT_ID;
const domain = process.argv[2];
if (!projectId || !domain) throw new Error('Set EVENT_FIREBASE_PROJECT_ID and pass the exact stored domain');
initializeApp({ projectId });
removeWebAddress({ db: getFirestore(), ...realClients(), domain })
  .then(() => console.log('Sign-in authorization and Hosting domain removed. DNS may now be retired.'))
  .catch(() => { console.error('Domain removal did not finish. Keep the DNS registration and retry.'); process.exitCode = 1; });
