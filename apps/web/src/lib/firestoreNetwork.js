import { disableNetwork, enableNetwork } from 'firebase/firestore';

// Restart the Firestore client's network now (issue #1329). After a failed
// stream the SDK marks itself offline and waits out its reconnect backoff
// (up to 60 s); getDocs answers from the cache meanwhile. The browser's
// `online` event restarts the network inside the SDK, but a blocked request
// ends without one. Stopping and starting the network does the same restart:
// the backoff resets and the next read asks the server. Open listeners stay
// attached and resume; queued writes stay in the SDK's mutation queue and are
// sent again.
export async function restartFirestoreNetwork(db) {
  try {
    await disableNetwork(db);
  } finally {
    await enableNetwork(db);
  }
}
