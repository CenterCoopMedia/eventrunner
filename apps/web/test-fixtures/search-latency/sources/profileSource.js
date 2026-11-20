import { fixture } from '../data.js';

// The directory listener answers with the synthetic profiles the reader's
// access allows, the same split the Firestore rules make.
export function subscribeDirectory({ includeAttendeesOnly }, onNext) {
  onNext(includeAttendeesOnly ? fixture.directory : fixture.directory.filter((p) => p.profileVisibility === 'public'));
  return () => {};
}
export function subscribeOwnProfile() { return () => {}; }
export function ownProfileFields(fields) { return fields; }
export function saveOwnProfile() { return Promise.resolve(); }
export async function fetchPublicProfile(uid) { return fixture.directory.find((p) => p.id === uid) ?? null; }
