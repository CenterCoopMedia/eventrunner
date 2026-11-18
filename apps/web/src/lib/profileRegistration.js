import { activeQuestions } from 'shared/registrationForm';
import { contentLanguages } from 'shared/contentLanguages';
import { loadFirebase } from './firebaseLoader.js';
import { ownProfileFields } from './profileSource.js';
import { readRegistrationQuestions } from './registrationFormSource.js';
import { readTicketingCatalog } from './useRegistrationLink.js';

export async function completesRegistration(eventId) {
  const catalog = await readTicketingCatalog(eventId).catch(() => null);
  if (catalog?.provider !== 'none') return false;
  const form = await readRegistrationQuestions().catch(() => undefined);
  return form !== undefined && activeQuestions(form).length === 0;
}

export async function saveRegistrationProfile(uid, fields, registrationLanguage) {
  const { db, serverTimestamp, doc, runTransaction } = await loadFirebase();
  const profileRef = doc(db, 'users', uid);
  const payload = { ...ownProfileFields(fields), updatedAt: serverTimestamp() };
  return runTransaction(db, async (tx) => {
    const profile = (await tx.get(profileRef)).data();
    const first = profile && !Object.hasOwn(profile, 'registrationLanguage');
    if (first && registrationLanguage === 'es') {
      const event = (await tx.get(doc(db, 'config', 'event'))).data();
      if (!contentLanguages(event).available.includes('es')) {
        tx.update(profileRef, payload);
        return;
      }
    }
    tx.update(profileRef, first ? { ...payload, registrationLanguage } : payload);
  });
}
