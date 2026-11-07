'use strict';

// Run with the client project's operator credentials. DNS must remain owned
// until Firebase sign-in authorization and Hosting have both been revoked.
const { applicationDefault, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { removeWebAddress, createHostingClient, createIdentityClient } = require('../functions/src/admin/webAddress.cjs');
const projectId = process.env.EVENT_FIREBASE_PROJECT_ID;
const domain = process.argv[2];
if (!projectId || !domain) throw new Error('Set EVENT_FIREBASE_PROJECT_ID and pass the exact stored domain');
const credential = applicationDefault();
initializeApp({ projectId, credential });
const getAccessToken = async () => (await credential.getAccessToken()).access_token;
const hosting = createHostingClient({ projectId, site: process.env.EVENT_HOSTING_SITE || projectId, getAccessToken });
const identity = createIdentityClient({ projectId, getAccessToken });
removeWebAddress({ db: getFirestore(), hosting, identity, domain })
  .then(() => console.log('Sign-in authorization and Hosting domain removed. DNS may now be retired.'))
  .catch(() => { console.error('Domain removal did not finish. Keep the DNS registration and retry.'); process.exitCode = 1; });
