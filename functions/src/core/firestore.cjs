'use strict';

/**
 * Lazy firebase-admin initialization (spec §1.3 core/).
 *
 * The only module that imports firebase-admin for Firestore access. Every
 * other module takes a `db` handle so tests drive them with fakes and no
 * emulator. Lazy so that requiring a domain module never initializes the
 * Admin SDK at deploy analysis time.
 */

let cachedDb = null;

function getDb() {
  if (cachedDb) return cachedDb;
  const { initializeApp, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  if (getApps().length === 0) initializeApp();
  cachedDb = getFirestore();
  return cachedDb;
}

module.exports = { getDb };
