import { beforeEach, expect, it, vi } from 'vitest';
import { completesRegistration, saveRegistrationProfile } from './profileRegistration.js';

const { readTicketingCatalog, readRegistrationQuestions, loadFirebase } = vi.hoisted(() => ({
  readTicketingCatalog: vi.fn(), readRegistrationQuestions: vi.fn(), loadFirebase: vi.fn(),
}));

vi.mock('./useRegistrationLink.js', () => ({ readTicketingCatalog }));
vi.mock('./registrationFormSource.js', () => ({ readRegistrationQuestions }));
vi.mock('./firebaseLoader.js', () => ({ loadFirebase, subscribeToFirebase: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

it('uses profile completion when there is no ticket provider or registration question', async () => {
  readTicketingCatalog.mockResolvedValueOnce({ provider: 'none' });
  readRegistrationQuestions.mockResolvedValueOnce(null);
  expect(await completesRegistration('fixture')).toBe(true);
  readTicketingCatalog.mockResolvedValueOnce({ provider: 'stripe' });
  expect(await completesRegistration('fixture')).toBe(false);
  expect(readRegistrationQuestions).toHaveBeenCalledTimes(1);
  readTicketingCatalog.mockResolvedValueOnce({ provider: 'none' });
  readRegistrationQuestions.mockResolvedValueOnce({ standard: { organization: { enabled: true } } });
  expect(await completesRegistration('fixture')).toBe(false);
});

it('commits a single registration language with the private profile fields', async () => {
  const profileRef = { path: 'users/example' };
  const eventRef = { path: 'config/event' };
  let stored = { displayName: '', profileVisibility: 'private' };
  const writes = [];
  const event = { contentLanguages: { default: 'en', available: ['en', 'es'] } };
  const tx = {
    get: vi.fn(async (ref) => ({ data: () => ref === eventRef ? event : stored })),
    update: vi.fn((ref, patch) => { writes.push([ref, patch]); stored = { ...stored, ...patch }; }),
  };
  loadFirebase.mockResolvedValue({ db: {}, doc: (_db, collection) => collection === 'config' ? eventRef : profileRef,
    serverTimestamp: () => 123, runTransaction: (_db, callback) => callback(tx) });
  const fields = { displayName: 'Example Attendee', profileVisibility: 'private', role: 'operator' };
  await saveRegistrationProfile('example', fields, 'es');
  await saveRegistrationProfile('example', fields, 'en');
  expect(writes[0]).toEqual([profileRef, { displayName: fields.displayName, profileVisibility: 'private', registrationLanguage: 'es', updatedAt: 123 }]);
  expect(writes[1][1]).not.toHaveProperty('registrationLanguage');
  expect(stored.registrationLanguage).toBe('es');
  expect(stored).not.toHaveProperty('role');
});
