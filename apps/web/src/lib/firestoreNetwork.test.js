// The real Firestore SDK, not the shared fake: restarting the network must
// keep open listeners attached and queued writes queued (issue #1329). The
// client points at a closed local port, so no request leaves the machine.
import { afterEach, expect, it, vi } from 'vitest';

vi.unmock('firebase/firestore');

const { initializeApp, deleteApp } = await vi.importActual('firebase/app');
const {
  collection, connectFirestoreEmulator, disableNetwork, doc, getFirestore, onSnapshot, setDoc, terminate,
} = await vi.importActual('firebase/firestore');
const { restartFirestoreNetwork } = await import('./firestoreNetwork.js');

let app;
afterEach(async () => {
  await terminate(getFirestore(app));
  await deleteApp(app);
});

it('keeps listeners attached and pending writes queued across a restart', async () => {
  app = initializeApp({ projectId: 'demo-er1329', apiKey: 'test', appId: 'test' }, `er1329-${Date.now()}`);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 9);
  await disableNetwork(db);

  const seen = [];
  const stop = onSnapshot(collection(db, 'notes'), { includeMetadataChanges: true }, (snap) => {
    seen.push(snap.docs.map((d) => [d.id, d.metadata.hasPendingWrites]));
  });
  let firstSettled = false;
  setDoc(doc(db, 'notes', 'a'), { n: 1 }).then(() => { firstSettled = true; }, () => { firstSettled = true; });
  await vi.waitFor(() => expect(seen.at(-1)).toEqual([['a', true]]));

  await restartFirestoreNetwork(db);
  await disableNetwork(db);

  setDoc(doc(db, 'notes', 'b'), { n: 2 }).catch(() => {});
  await vi.waitFor(() => expect(seen.at(-1)).toEqual([['a', true], ['b', true]]));
  expect(firstSettled).toBe(false);
  stop();
});
