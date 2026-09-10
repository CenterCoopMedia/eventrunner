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
  useEmulators: false,
  // lib/mediaSource.js builds object URLs from these two rather than calling
  // getDownloadURL (Admin-SDK-written objects carry no download token), so a
  // test run needs them or every asset resolves to "missing".
  storageBucketName: 'demo-run-of-show.appspot.com',
  storageDownloadOrigin: 'https://firebasestorage.googleapis.com',
  // App Check is unconfigured in a credential-free test run, which is also
  // its production default: no site key, no attestation header.
  appCheckEnabled: false,
  appCheckHeaders: vi.fn(async () => ({})),
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

// Storage is mocked for every test file the same way: the media components
// resolve object paths to download URLs on mount (lib/mediaSource.js), and
// an unmocked SDK reaches for a real bucket the credential-free run has no
// configuration for. Individual tests override this per file when they need
// to assert on an upload.
vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(() => ({})),
  connectStorageEmulator: vi.fn(),
  ref: vi.fn((_storage, path) => ({ path })),
  getDownloadURL: vi.fn(async (reference) => `https://example.test/${reference?.path ?? ''}`),
  uploadBytes: vi.fn(async () => ({})),
  deleteObject: vi.fn(async () => {}),
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

// jsdom implements <dialog> as markup and nothing else: it ships the
// interface, but showModal, close, the top layer and cancel-on-Escape are
// all missing. A component that opens a dialog would therefore be untestable
// here, so the parts a test can OBSERVE are stood in for below. What is not
// stood in for, because jsdom has no top layer and no focus model to hang it
// on, is the focus trap and the inert page — those belong to the browser,
// and a test asserts that the component ASKS for them by calling showModal()
// rather than pretending to prove them here.
//
// The guard reads the METHOD, not the class: a check for the class finds one
// and stands nothing in.
const dialogPrototype = Object.getPrototypeOf(document.createElement('dialog'));
if (typeof dialogPrototype.showModal !== 'function') {
  dialogPrototype.showModal = function showModal() {
    this.setAttribute('open', '');
    this.querySelector('input, select, textarea, button')?.focus();
  };
  dialogPrototype.show = function show() {
    this.setAttribute('open', '');
  };
  dialogPrototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

afterEach(() => {
  cleanup();
});
