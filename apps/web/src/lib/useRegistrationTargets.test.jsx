// The hook reads tickets and saved answers only when the form asks
// something, and reports loading until that read is done.
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

let pushForm;
vi.mock('./registrationFormSource.js', () => ({ subscribeRegistrationForm: (onNext) => { pushForm = onNext; return () => {}; } }));
const ticketingRequestMock = vi.fn(async () => ({ tickets: [{ id: 't-1', status: 'valid', ticketClass: 'General' }], nextCursor: null }));
vi.mock('./ticketingCommerce.js', () => ({ ticketingRequest: (...args) => ticketingRequestMock(...args) }));
vi.mock('./useRegistrationLink.js', () => ({ readTicketingCatalog: async () => ({ provider: 'manual' }) }));
vi.mock('./registrationAnswersApi.js', async (importOriginal) => ({ ...(await importOriginal()), readOwnAnswers: async () => null }));
vi.mock('../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ eventConfig: { id: 'event' } }) }));

const { useRegistrationTargets } = await import('./useRegistrationTargets.js');
const user = { uid: 'ada', emailVerified: true, getIdToken: async () => 't' };

describe('useRegistrationTargets', () => {
  it('reads no tickets when the form asks nothing', async () => {
    const { result } = renderHook(() => useRegistrationTargets(user));
    expect(result.current.status).toBe('loading');
    act(() => pushForm({ revision: 1, standard: {}, custom: [] }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.questionCount).toBe(0);
    expect(ticketingRequestMock).not.toHaveBeenCalled();
  });

  it('stays loading until the tickets for a form that asks something are read', async () => {
    const { result } = renderHook(() => useRegistrationTargets(user));
    act(() => pushForm({ revision: 1, standard: { organization: { enabled: true } }, custom: [] }));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.targets.map((target) => target.id)).toEqual(['t-1']);
    expect(result.current.saved).toEqual({ 't-1': null });
  });
});
