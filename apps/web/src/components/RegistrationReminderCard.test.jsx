// The dashboard's "Complete your registration" reminder (ADR 0008 §5).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

let state;
vi.mock('../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../lib/useRegistrationTargets.js', () => ({ useRegistrationTargets: () => state }));
const { default: RegistrationReminderCard } = await import('./RegistrationReminderCard.jsx');

const TARGETS = [{ id: 't1', label: 'Ticket: General for Ada' }, { id: 't2', label: 'Ticket: General for Bo' }];
const renderCard = () => render(<MemoryRouter><RegistrationReminderCard /></MemoryRouter>);

beforeEach(() => {
  state = { status: 'ready', questionCount: 3, targets: TARGETS, saved: { t1: { answers: {} }, t2: null } };
});

describe('RegistrationReminderCard', () => {
  it('says how many are left and links to the questions', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: 'Complete your registration' })).toBeInTheDocument();
    expect(screen.getByText('1 of 2 tickets still needs answers.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Answer the questions' })).toHaveAttribute('href', '/registration');
  });

  it('words a single registration plainly', () => {
    state = { ...state, targets: [{ id: 'account-u1', account: true, label: 'Your registration' }], saved: {} };
    renderCard();
    expect(screen.getByText('The organizers have a few questions for you.')).toBeInTheDocument();
  });

  it('is hidden while loading, when nothing is asked, and when everything is answered', () => {
    state = { ...state, status: 'loading' };
    const { container, rerender } = renderCard();
    expect(container).toBeEmptyDOMElement();
    state = { status: 'ready', questionCount: 0, targets: TARGETS, saved: {} };
    rerender(<MemoryRouter><RegistrationReminderCard /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
    state = { status: 'ready', questionCount: 2, targets: TARGETS, saved: { t1: {}, t2: {} } };
    rerender(<MemoryRouter><RegistrationReminderCard /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
    state = { status: 'error', questionCount: 2, targets: [], saved: {} };
    rerender(<MemoryRouter><RegistrationReminderCard /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
