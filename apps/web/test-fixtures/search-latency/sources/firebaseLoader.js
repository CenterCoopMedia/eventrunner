// The fixture has no Firebase project. Any listener the real pages start
// receives nothing; a load request never settles, so no SDK starts.
export function rememberSignedIn() {}
export function isFirebaseLoading() { return false; }
export function loadFirebase() { return new Promise(() => {}); }
export function firebaseReady() { return false; }
export function subscribeToFirebase() { return () => {}; }
export async function appCheckHeaders() { return {}; }
