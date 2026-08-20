import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Tests run credential-free (spec §8.1): no VITE_FIREBASE_* env, no network.
// The firebase entry module and the SDK functions the providers call are
// mocked here for every test file; individual tests steer behavior through
// vi.mocked(...) on the 'firebase/auth' / 'firebase/firestore' imports.
vi.mock('@/firebase.js', () => ({
  app: {},
  auth: {},
  db: {},
  storage: {},
}));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class GoogleAuthProvider {},
  // Default: signed out, synchronously — providers leave loading state fast.
  onAuthStateChanged: vi.fn((_auth, callback) => {
    callback(null);
    return () => {};
  }),
  signInWithPopup: vi.fn(async () => ({ user: {} })),
  signInWithCustomToken: vi.fn(async () => ({ user: {} })),
  signOut: vi.fn(async () => {}),
}));

vi.mock('firebase/firestore', () => {
  const permissionDenied = () => {
    const error = new Error('Missing or insufficient permissions.');
    error.code = 'permission-denied';
    return error;
  };
  return {
    collection: vi.fn((db, path) => ({ db, path })),
    query: vi.fn((ref, ...clauses) => ({ ref, clauses })),
    limit: vi.fn((n) => ({ limit: n })),
    // Default: the anonymous/non-admin answer (firestore.rules deny).
    getDocs: vi.fn(async () => {
      throw permissionDenied();
    }),
    onSnapshot: vi.fn(() => () => {}),
    doc: vi.fn((db, ...path) => ({ db, path })),
    getDoc: vi.fn(async () => {
      throw permissionDenied();
    }),
    where: vi.fn((...args) => ({ where: args })),
    orderBy: vi.fn((...args) => ({ orderBy: args })),
  };
});

afterEach(() => {
  cleanup();
});
