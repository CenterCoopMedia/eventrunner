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
  // The DEFAULT app specifically, not "any app": getFirestore() with no
  // argument resolves `[DEFAULT]` and throws if only named apps exist. A
  // bare length check reads a named app somebody else registered as
  // "already initialized" and then throws on the very next line — which is
  // what happens to every background trigger under the Functions emulator,
  // where the runtime registers its own app before our handler runs. The
  // observable symptom is a Firestore trigger that fails on every delivery
  // ("The default Firebase app does not exist"), so the projection it
  // maintains never appears.
  if (!getApps().some((app) => app?.name === '[DEFAULT]')) initializeApp();
  cachedDb = getFirestore();
  return cachedDb;
}

module.exports = { getDb };
